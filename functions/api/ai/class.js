/* ============================================================
 * 乡育心桥 · RuralBridge —— 班级宏观研判网关（Cloudflare Pages Function）
 * 路由：POST /api/ai/class
 *
 * 职责：班主任视角的「班级整体状态」分析。把全班学生的聚合数据
 *      （风险分布、共性信号、提交覆盖）交给大模型，产出：
 *        - 班级整体状态判读（一句话结论 + 状态等级）
 *        - 共性诱因（从全班信号里归纳，而非单个学生）
 *        - 可执行的管理层建议：作业量 / 课外活动 / 课堂模式 / 家校协同
 *        - 需要重点关注的群体特征（不是点名）
 *
 * 与 /api/ai/assess 的分工：
 *   assess  = 个体（一名学生一个方案）
 *   class   = 群体（一个班一份研判 + 管理动作清单）
 *
 * 降级：大模型不可用时返回 ok:false，前端回退到本地规则归纳，
 *      保证班级页永不空白。
 * ============================================================ */

const DEFAULT_BASE = 'https://api.aibvv.cn/v1';
const DEFAULT_MODEL = 'deepseek-v4-flash-0731';

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

/* ---------- 大模型输出提取与解析 ----------
 * 实测踩过的坑：直接把 out.choices[0].message.content 丢给 JSON.parse，
 * 一旦模型把正文放在 reasoning_content、或 content 为空、
 * 或返回 markdown 围栏，就会解析失败。
 * 而且报错时用 String(out) 只会得到 "[object Object]"，等于没有诊断信息。
 */
function extractContent(out) {
  const ch = out && out.choices && out.choices[0];
  const msg = ch && ch.message;
  if (!msg) {
    return { text: '', src: 'none', finish: ch && ch.finish_reason, usage: out && out.usage };
  }
  let c = msg.content;
  if (Array.isArray(c)) {
    c = c.map(function (p) { return (p && (p.text || p.content)) || ''; }).join('');
  } else if (c && typeof c === 'object') {
    c = c.text || c.content || JSON.stringify(c);
  }
  let src = 'content';
  if (!c || !String(c).trim()) {
    if (msg.reasoning_content) { c = msg.reasoning_content; src = 'reasoning_content'; }
    else if (msg.reasoning) { c = msg.reasoning; src = 'reasoning'; }
    else src = 'empty';
  }
  return {
    text: String(c == null ? '' : c),
    src: src,
    finish: ch.finish_reason,
    usage: out && out.usage
  };
}

function parseLooseJson(text) {
  let s = String(text || '').trim();
  if (!s) throw new Error('内容为空（可能推理过程耗尽了 max_tokens）');
  s = s.replace(/^```(?:json|JSON)?\s*/, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(s); } catch (e) {}
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i !== -1 && j > i) {
    try { return JSON.parse(s.slice(i, j + 1)); } catch (e) {}
  }
  throw new Error('无法解析为 JSON（首 200 字符：' + s.slice(0, 200) + '）');
}

/* ---------- 二次修复：把非 JSON 输出现场改写成 JSON ----------
 * 实测上游 deepseek-v4-flash-0731 会无视 response_format 直接输出 markdown 散文。
 * 与其赌某个模型遵守协议（本地拿不到 API key，无法枚举验证），
 * 不如在解析失败时做一次补救：把它自己写的散文回灌，
 * 明确要求只输出 JSON。模型对自己的内容有完整上下文，改写成功率很高。
 * 只在失败时多花一次调用，不影响正常路径成本。
 */
async function repairJson(base, key, model, sys, prose) {
  const text = String(prose || '').trim().slice(0, 2000);
  if (!text) return null;
  try {
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: model,
        max_tokens: 4096,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: '下面是一段已经写好的心理研判文字。请把它整理成系统提示要求的 JSON 对象。' },
          { role: 'assistant', content: text },
          { role: 'user', content: '现在只输出一个 JSON 对象。不要解释、不要 markdown 代码块、不要任何 JSON 以外的文字。' }
        ]
      })
    });
    if (!r.ok) return null;
    const out = await r.json();
    const ext = extractContent(out);
    const p = parseLooseJson(ext.text);
    return p.isJson ? p.data : null;
  } catch (e) {
    return null;
  }
}


function strArr(a, n, len) {
  return Array.isArray(a) ? a.slice(0, n).map(x => String(x).slice(0, len || 200)) : [];
}
function objArr(a, n, tLen, dLen) {
  return Array.isArray(a)
    ? a.slice(0, n).map(s => ({ t: String((s && s.t) || '').slice(0, tLen || 40), d: String((s && s.d) || '').slice(0, dLen || 400) }))
    : [];
}

/* 带优先级的动作：p 只接受 P1/P2/P3，非法值由 normalizePriority 兜底 */
const PRIORITIES = ['P1', 'P2', 'P3'];
function normalizePriority(v) {
  const s = String(v || '').toUpperCase().replace(/[^P123]/g, '');
  return PRIORITIES.indexOf(s) !== -1 ? s : 'P2';
}
function actArr(a, n, tLen, dLen) {
  return Array.isArray(a)
    ? a.slice(0, n).map(s => ({
        t: String((s && s.t) || '').slice(0, tLen || 40),
        d: String((s && s.d) || '').slice(0, dLen || 400),
        p: normalizePriority(s && s.p)
      }))
    : [];
}

const SYSTEM_PROMPT = `你是"乡育心桥"的班级管理助手，服务对象是乡村中小学班主任（非心理专业人员）。

【红线】
1. 禁止给出任何医学诊断结论，不得把学生贴上"抑郁""焦虑症"等疾病标签。
2. 只依据给定的班级聚合数据归纳，不臆造学生个体信息，不点名具体学生。
3. 建议必须落在班主任职权范围内、明天就能动手的管理动作上。
4. 涉及红色风险学生时，提醒交由心理教师与专业人员处理，班主任负责配合。
5. 只输出 JSON，不要任何解释文字或 Markdown 代码块。

【你的任务】
从班级聚合数据出发，做三件事：
① 判断班级整体心理气候（不是简单复述数字）；
② 归纳共性诱因（全班层面反复出现的信号模式）；
③ 给出可直接执行的管理层动作，覆盖四个维度：
   - workload  作业量与考试节奏调整（要具体：哪一科、减多少、怎么减）
   - activity  课外活动与班级氛围建设（要具体：什么活动、多久一次、怎么组织）
   - classroom 课堂模式转变（要具体：提问方式、分组方式、评价方式怎么改）
   - home      家校协同动作（要具体：给家长发什么、多久一次）

【输出 JSON 结构】
{
  "climate": "一句话概括班级整体心理气候",
  "climateLevel": "steady|watch|alert",
  "narrative": "2~4 句的班级状态研判，说明数据说明了什么、为什么这样判断",
  "causes": [{"t":"共性诱因","d":"数据依据 + 说明"}],
  "workload": [{"t":"动作标题","d":"具体做法（含数量/频次）","p":"P1|P2|P3"}],
  "activity": [{"t":"动作标题","d":"具体做法（含数量/频次）","p":"P1|P2|P3"}],
  "classroom": [{"t":"动作标题","d":"具体做法（含数量/频次）","p":"P1|P2|P3"}],
  "home": [{"t":"动作标题","d":"具体做法（含数量/频次）","p":"P1|P2|P3"}],
  "focusGroups": ["需要重点关注的学生群体特征（不点名）"],
  "watchSignals": ["未来一周需要留意的班级层面信号"]
}
causes 2~4 条；四个动作维度各 2~3 条；focusGroups 2~4 条；watchSignals 2~4 条。

【优先级 p 的判定标准（每条动作必填，不得省略）】
班主任精力有限，你必须帮他排出先后，不能所有动作都标成高优先级。
- P1 紧急：48 小时内必须完成。出现红色风险学生、安全信号、已发生的冲突或危机。
  不做会直接导致风险升级。每个维度最多 1 条 P1。
- P2 重要：本周内应完成。直接影响学生当前状态（作业量、睡眠、同伴关系、课堂参与）。
- P3 常规：可排期，属于长期氛围建设或预防性动作，晚一周做也不会出事。
判定时请对照数据：班级红色人数、共性信号频次、提交覆盖率。
如果全班没有红色学生、信号集中在个别学生，不要把班级层面动作标成 P1。
同一批动作里，P1 建议控制在 1~2 条，P3 至少保留 1 条。`;

export async function onRequestPost({ request, env }) {
  const t0 = Date.now();
  let body;
  try { body = await request.json(); } catch { return json({ ok:false, error:'请求体不是合法 JSON' }, 400); }

  const klass = String(body.klass || '本班').slice(0, 40);
  const stats = body.stats && typeof body.stats === 'object' ? body.stats : {};
  const students = Array.isArray(body.students) ? body.students.slice(0, 60) : [];
  const submissions = Array.isArray(body.submissions) ? body.submissions.slice(0, 80) : [];

  if (!students.length) {
    return json({ ok:false, error:'暂无学生数据，无法生成班级研判' }, 400);
  }

  const key = env.AI_API_KEY;
  if (!key) {
    return json({ ok:false, error:'服务端未配置 AI_API_KEY，请检查环境变量' }, 503);
  }
  const base = (env.AI_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
  const model = env.AI_MODEL || DEFAULT_MODEL;

  /* 只送聚合特征，不送学生姓名，降低隐私暴露面 */
  const payload = {
    klass,
    stats: {
      total: stats.total || students.length,
      red: stats.red || 0,
      yellow: stats.yellow || 0,
      green: stats.green || 0,
      submissions: stats.submissions || submissions.length
    },
    studentSignals: students.map(s => ({
      level: s.level,
      riskType: s.riskType || '',
      score: s.score || 0,
      signalCount: (s.tags || []).length
    })),
    signalFrequency: (() => {
      const freq = {};
      students.forEach(s => (s.tags || []).forEach(t => { freq[t] = (freq[t] || 0) + 1; }));
      return Object.keys(freq).map(k => ({ signal: k, count: freq[k] })).sort((a, b) => b.count - a.count).slice(0, 12);
    })(),
    recentTypes: submissions.slice(0, 20).map(s => ({ type: s.type, level: s.level }))
  };

  let out;
  try {
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(payload) }
        ]
      })
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return json({ ok:false, error:'大模型接口返回 ' + r.status, detail: detail.slice(0, 300) }, 502);
    }
    out = await r.json();
  } catch (e) {
    return json({ ok:false, error:'大模型调用失败：' + (e && e.message ? e.message : String(e)) }, 502);
  }

  const ext = extractContent(out);
  let parsed;
  let parseErr = null;
  try {
    parsed = parseLooseJson(ext.text);
  } catch (e) {
    parseErr = e;
    /* 上游无视 response_format 输出散文时，先把它写的内容回灌，
       让它自己整理成 JSON。只在失败时触发，不影响正常路径成本。
       注意：修复结果必须真的带该接口需要的字段，否则视为失败——
       否则会用一个空对象拼出假结论（假绿/假黄），比报错危险得多。 */
    parsed = await repairJson(base, key, model, SYSTEM_PROMPT, ext.text);
    if (parsed) {
      let ok2 = false;
      if (parsed && (parsed.climate || parsed.narrative || (Array.isArray(parsed.causes) && parsed.causes.length) || (Array.isArray(parsed.workload) && parsed.workload.length))) ok2 = true;
      if (!ok2) parsed = null;
    }
  }
  if (!parsed) {
    return json({ ok: false,
      error: '大模型输出无法解析为 JSON（二次修复亦未成功）',
      reason: parseErr ? parseErr.message : '修复后仍缺少必要字段',
      contentFrom: ext.src,
      finish: ext.finish,
      completionTokens: ext.usage && ext.usage.completion_tokens,
      reasoningTokens: ext.usage && ext.usage.completion_tokens_details && ext.usage.completion_tokens_details.reasoning_tokens,
      contentHead: ext.text.slice(0, 600),
      upstreamKeys: out && Object.keys(out),
      }, 502);
  }

  const levels = ['steady', 'watch', 'alert'];
  return json({
    ok: true, engine: 'llm',
    climate: String(parsed.climate || '').slice(0, 200),
    climateLevel: levels.indexOf(parsed.climateLevel) !== -1 ? parsed.climateLevel : 'watch',
    narrative: String(parsed.narrative || '').slice(0, 800),
    causes: objArr(parsed.causes, 5, 40, 400),
    workload: actArr(parsed.workload, 4, 40, 400),
    activity: actArr(parsed.activity, 4, 40, 400),
    classroom: actArr(parsed.classroom, 4, 40, 400),
    home: actArr(parsed.home, 4, 40, 400),
    focusGroups: strArr(parsed.focusGroups, 5, 200),
    watchSignals: strArr(parsed.watchSignals, 5, 200),
    latencyMs: Date.now() - t0,
    model: '大模型 ' + model + '（班级宏观研判）'
  });
}

export async function onRequestGet() {
  return json({ ok:false, error:'请使用 POST 调用本接口' }, 405);
}
