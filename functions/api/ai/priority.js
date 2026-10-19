/* ============================================================
 * 乡育心桥 · RuralBridge —— 手工任务优先级判级（Cloudflare Pages Function）
 * 路由：POST /api/ai/priority
 *
 * 职责：老师手工录入台账的动作没有 AI 上下文，需要单独判级。
 *      输入一条或多条动作 + 班级当前风险概况，输出 P1/P2/P3。
 *
 * 与 /api/ai/class、/api/ai/assess 的分工：
 *   assess   = 个体心理研判（顺带给动作标级）
 *   class    = 班级宏观研判（顺带给动作标级）
 *   priority = 只判级，不改动作内容，用于手工录入与批量重判
 *
 * 降级：大模型不可用时返回 ok:false，前端回退到 engine.gradeAction()，
 *      保证录入流程永远不阻塞。
 * ============================================================ */

const DEFAULT_BASE = 'https://api.aibvv.cn/v1';
const DEFAULT_MODEL = 'deepseek-v4-flash-0731';

const PRIORITIES = ['P1', 'P2', 'P3'];

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function normalizePriority(v) {
  const s = String(v || '').toUpperCase().replace(/[^P123]/g, '');
  return PRIORITIES.indexOf(s) !== -1 ? s : 'P2';
}

const SYSTEM_PROMPT = `你是"乡育心桥"的任务优先级判定助手，服务对象是乡村中小学班主任。

【你的任务】
班主任手工录入了一条班级管理动作，需要你判断它的紧急程度，帮助他排出先后顺序。

【红线】
1. 只判级，不要改写动作内容，不要新增动作。
2. 不得给出任何医学诊断，不得评价学生个人。
3. 只输出 JSON，不要解释文字或 Markdown 代码块。

【判定标准】
- P1 紧急：48 小时内必须完成。涉及安全、危机、已发生的冲突、需上报的事项、
  红色风险学生的处置。不做会直接导致风险升级。
- P2 重要：本周内应完成。直接影响学生当前状态的管理调整
  （作业量、座位、课堂提问方式、家校沟通、睡眠作息）。
- P3 常规：可排期。长期氛围建设、习惯培养、预防性动作，晚一周做也不会出事。

【重要约束】
- 不要因为"是老师录入的"就一律标 P1，也不要一律标 P2。
- 如果班级当前没有红色学生，涉及安全上报类以外的动作不应标 P1。
- 判断要基于动作的实际影响面与时间刚性，而不是措辞的强烈程度。
- 给每条动作写一句不超过 40 字的判级理由，说明为什么是这个等级。

【输出 JSON 结构】
{
  "items": [
    { "i": 0, "p": "P1|P2|P3", "why": "一句话判级理由" }
  ]
}
i 必须对应输入 actions 数组的下标，items 条数必须与 actions 条数一致。`;

export async function onRequestPost({ request, env }) {
  const t0 = Date.now();
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: '请求体不是合法 JSON' }, 400); }

  const actions = Array.isArray(body.actions) ? body.actions.slice(0, 20) : [];
  if (!actions.length) return json({ ok: false, error: '没有需要判级的动作' }, 400);

  const ctx = body.context && typeof body.context === 'object' ? body.context : {};

  /* 规整输入，防止超长文本撑爆上下文 */
  const clean = actions.map((a, i) => ({
    i,
    t: String((a && a.t) || (a && a.text) || '').slice(0, 120),
    d: String((a && a.d) || '').slice(0, 300),
    dim: String((a && a.dim) || '').slice(0, 20),
    target: String((a && a.target) || '').slice(0, 40),
    due: String((a && a.due) || '').slice(0, 20)
  }));

  const key = env.AI_API_KEY;
  if (!key) {
    return json({ ok: false, error: '服务端未配置 AI_API_KEY，请检查环境变量' }, 503);
  }
  const base = (env.AI_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
  const model = env.AI_MODEL || DEFAULT_MODEL;

  const payload = {
    classContext: {
      total: Number(ctx.total) || 0,
      red: Number(ctx.red) || 0,
      yellow: Number(ctx.yellow) || 0,
      green: Number(ctx.green) || 0,
      pendingActions: Number(ctx.pendingActions) || 0,
      overdueActions: Number(ctx.overdueActions) || 0
    },
    today: new Date().toISOString().slice(0, 10),
    actions: clean
  };

  let out;
  try {
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model,
        temperature: 0.15,
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

  const raw = Array.isArray(parsed.items) ? parsed.items : [];

  /* 按下标回填，缺失的补 P2，保证返回条数与输入一致 */
  const items = clean.map(a => {
    const hit = raw.find(x => Number(x && x.i) === a.i);
    return {
      i: a.i,
      p: normalizePriority(hit && hit.p),
      why: String((hit && hit.why) || '').slice(0, 60)
    };
  });

  /* 批量一致性修正：P1 最多 2 条，绿色班级不得出现 P1 */
  let p1 = 0;
  items.forEach(x => {
    if (x.p === 'P1') { p1++; if (p1 > 2) x.p = 'P2'; }
  });
  if ((Number(ctx.red) || 0) === 0) {
    items.forEach(x => { if (x.p === 'P1') x.p = 'P2'; });
  }

  return json({
    ok: true,
    engine: 'llm',
    items,
    latencyMs: Date.now() - t0,
    model: '大模型 ' + model + '（任务优先级判定）'
  });
}

export async function onRequestGet() {
  return json({ ok: false, error: '请使用 POST 调用本接口' }, 405);
}
