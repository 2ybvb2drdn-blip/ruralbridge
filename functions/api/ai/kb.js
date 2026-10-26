/* ============================================================
 * 乡育心桥 · RuralBridge —— 心理学知识库 AI 兜底（Cloudflare Pages Function）
 * 路由：POST /api/ai/kb
 *
 * 职责：心理教师在知识库搜不到时，由大模型补充解释。
 *
 * 为什么要有这个接口：
 *   本地理论库已收录 90+ 条，但心理学概念数量远超任何静态库。
 *   搜不到时的正确做法不是"给个空白"，而是：
 *     本地库命中 → 直接用（快、可离线、有出处）
 *     本地库未命中 → AI 补充（标注未经审核）
 *   这个接口只负责后一半。
 *
 * 安全红线（写进 system prompt，服务端也做兜底校验）：
 *   1. 必须标注"AI 生成，未经专业审核"
 *   2. 不得编造文献、作者、年份
 *   3. 不确定的概念必须直说"无可靠出处"，不能硬编
 *   4. 涉及诊断、用药、危机处置的，一律指向专业人员
 *
 * 与 /api/ai/assess 的分工：
 *   assess = 学生个案研判（有具体学生数据）
 *   kb     = 概念解释（无学生数据，纯知识查询）
 * ============================================================ */

const DEFAULT_BASE = 'https://api.aibvv.cn/v1';
const DEFAULT_MODEL = 'deepseek-v4-flash-0731';

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

const SYSTEM_PROMPT = `你是"乡育心桥"的心理学知识助手，服务对象是乡村中小学的心理教师与班主任。

【任务】
用户查询一个心理学概念，本地知识库没有收录。请给出准确、可用的解释。

【输出格式】严格返回 JSON：
{
  "found": true 或 false,
  "name": "概念规范名称",
  "alias": ["常见别名或英文名"],
  "category": "疗法/发展/情绪/效应/议题/危机/群体 之一",
  "author": "提出者（若确实不知道就写空字符串）",
  "summary": "机制说明，2-4 句，说清是什么、为什么",
  "apply": "学校场景怎么用，2-3 句，要具体可操作",
  "cautions": ["使用时的注意事项，1-3 条"],
  "confidence": "high/medium/low"
}

【绝对红线】
1. 不要编造文献、作者、年份。不确定作者就留空字符串，不要猜。
2. 如果这个概念并非公认的心理学概念（例如网络流传的说法、伪心理学、成功学话术），
   必须把 found 设为 false，并在 summary 里直接说明"这不是公认的心理学概念"及原因。
3. 如果概念真实存在但你不确定细节，把 confidence 设为 low，并在 cautions 里说明需核实。
4. 不要给出诊断标准、药物建议、具体用药剂量。涉及这些一律指向精神科医师。
5. 不要给具体学生的干预方案（本接口没有学生数据）。
6. 语言面向中国乡村中小学教师，避免过度学术化，但不要牺牲准确性。

【特别注意】
中文网络流传的很多"心理学效应"并无实证来源（例如"野马结局""蝴蝶效应用于心理"）。
遇到这类概念，要如实说明它是比喻还是实证结论，不要包装成科学事实。`;

export async function onRequestPost({ request, env }) {
  const t0 = Date.now();
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: '请求体不是合法 JSON' }, 400); }

  const query = String(body.query || '').slice(0, 80).trim();
  if (!query) return json({ ok: false, error: '请输入要查询的概念' }, 400);

  /* 已收录的条目直接返回，不必调用大模型（省时省钱） */
  const local = Array.isArray(body.localHits) ? body.localHits.slice(0, 3) : [];
  if (local.length) {
    return json({ ok: true, engine: 'local', skipped: true, query, latencyMs: Date.now() - t0 });
  }

  const key = env.AI_API_KEY;
  if (!key) {
    return json({ ok: false, error: '服务端未配置 AI_API_KEY，请检查环境变量' }, 503);
  }
  const base = (env.AI_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
  const model = env.AI_MODEL || DEFAULT_MODEL;

  const payload = {
    query,
    role: '心理教师/班主任',
    context: '乡村中小学心理健康工作场景'
  };

  let out;
  try {
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(payload) }
        ]
      })
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return json({ ok: false, error: '大模型接口返回 ' + r.status, detail: detail.slice(0, 300) }, 502);
    }
    out = await r.json();
  } catch (e) {
    return json({ ok: false, error: '大模型调用失败：' + (e && e.message ? e.message : String(e)) }, 502);
  }

  let parsed;
  try {
    const content = out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content;
    parsed = JSON.parse(content);
  } catch (e) {
    return json({ ok: false, error: '大模型输出无法解析为 JSON', raw: String(out).slice(0, 300) }, 502);
  }

  const CATS = ['疗法', '发展', '情绪', '效应', '议题', '危机', '群体'];
  const CONF = ['high', 'medium', 'low'];

  const strArr = (a, n, len) => Array.isArray(a)
    ? a.slice(0, n).map(x => String(x).slice(0, len || 200)).filter(Boolean)
    : [];

  const resp = {
    ok: true,
    engine: 'llm',
    query,
    found: parsed.found === true,
    name: String(parsed.name || query).slice(0, 60),
    alias: strArr(parsed.alias, 5, 40),
    category: CATS.indexOf(parsed.category) !== -1 ? parsed.category : '效应',
    author: String(parsed.author || '').slice(0, 80),
    summary: String(parsed.summary || '').slice(0, 600),
    apply: String(parsed.apply || '').slice(0, 600),
    cautions: strArr(parsed.cautions, 3, 300),
    confidence: CONF.indexOf(parsed.confidence) !== -1 ? parsed.confidence : 'medium',
    /* 前端据此显示"AI 生成"标记，不可省略 */
    aiGenerated: true,
    disclaimer: 'AI 生成，未经专业审核，仅供参考。涉及诊断与处置请咨询专业人员。',
    latencyMs: Date.now() - t0,
    model: '大模型 ' + model + '（知识库补充）'
  };

  /* 服务端兜底：模型若返回空摘要，视为失败，避免前端显示空白卡片 */
  if (!resp.summary) {
    return json({ ok: false, error: '大模型未给出有效内容，请换个说法再试', latencyMs: Date.now() - t0 }, 502);
  }

  return json(resp);
}

export async function onRequestGet() {
  return json({ ok: false, error: '请使用 POST 调用本接口' }, 405);
}
