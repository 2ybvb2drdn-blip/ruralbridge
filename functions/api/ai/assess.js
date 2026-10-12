/* ============================================================
 * 乡育心桥 · RuralBridge —— AI 评估网关（Cloudflare Pages Function）
 * 路由：POST /api/ai/assess
 *
 * 职责：把「规则引擎硬兜底 + RAG 理论检索 + 大模型语义推理」的
 *      双引擎架构真正落地。大模型 API Key 只存在于服务端环境变量，
 *      绝不下发到浏览器。
 *
 * 处理链路：
 *   ① 规则引擎硬筛查（服务端复算，防止前端被篡改绕过）
 *        命中高危 → 直接返回红色预警，不调用大模型（安全 + 省额度）
 *   ② RAG 理论检索（按风险文本召回 Top-K 心理学理论）
 *   ③ 大模型语义推理（JSON 结构化输出：风险等级/类型/依据/分步方案）
 *   ④ 结果回填理论来源，返回前端
 * ============================================================ */

const DEFAULT_BASE = 'https://api.aibvv.cn/v1';
const DEFAULT_MODEL = 'deepseek-v4-flash-0731';

/* ---------- 规则引擎（与前端同源，服务端复算） ---------- */
const RULES = [
  { id:'R-HARD-1', kw:['伤害自己','自杀','不想活','活不下去','结束生命'], level:'red',    type:'高危—自伤/自杀意念', hard:true },
  { id:'R-HARD-2', kw:['没人能帮我','没有希望','绝望'],                   level:'red',    type:'高危—绝望感',        hard:true },
  { id:'R-HARD-3', kw:['被欺负','被打了','校园欺凌','没人跟我玩'],         level:'yellow', type:'同伴关系风险',        hard:false },
  { id:'R-HARD-4', kw:['爸妈不在','留守儿童','想爸妈','没人管我'],         level:'yellow', type:'亲子分离应激',        hard:false },
  { id:'R-HARD-5', kw:['睡不着','失眠','做噩梦'],                          level:'yellow', type:'睡眠困扰',            hard:false }
];

function ruleScan(text) {
  const hits = [];
  if (!text) return hits;
  for (const r of RULES) {
    const matched = r.kw.filter(k => text.indexOf(k) !== -1);
    if (matched.length) {
      hits.push({ ruleId:r.id, type:r.type, level:r.level, hard:r.hard, matched });
    }
  }
  return hits;
}

/* ---------- RAG 理论检索（关键词召回 + 打分排序） ---------- */
function ragRetrieve(theories, query, topK) {
  const q = String(query || '');
  const scored = (theories || []).map(t => {
    let s = 0;
    (t.keywords || []).forEach(k => { if (q.indexOf(k) !== -1) s += 3; });
    const segs = String(t.summary || '').split(/[，。、；]/);
    segs.forEach(seg => {
      if (seg.length >= 2 && q.indexOf(seg.slice(0, 2)) !== -1) s += 1;
    });
    return { t, s };
  }).sort((a, b) => b.s - a.s);
  const picked = scored.filter(x => x.s > 0).slice(0, topK || 3);
  return (picked.length ? picked : scored.slice(0, 2)).map(x => x.t);
}

/* ---------- 高危兜底方案（不调用大模型） ---------- */
function hardPlan(rule) {
  const base = [
    { t:'立即响应（24 小时内）', d:'由班主任与学校心理教师共同约谈，采取非评判、倾听式沟通，先建立信任再评估风险的具体程度与紧迫性。' },
    { t:'安全兜底', d:'评估是否存在自伤/自杀的计划性与可及手段；必要时联系监护人并启动学校危机干预流程，安排专人陪伴。' },
    { t:'转介与跟踪', d:'建议转介县级未成年人心理健康辅导中心做专业评估；此后每周一次约谈并记录变化，持续不少于 4 周。' }
  ];
  return { steps: base, theoryIds: ['T3', 'T6'] };
}

const SYSTEM_PROMPT = `你是"乡育心桥"——一款面向乡村中小学班主任的心理健康辅助工具。你的角色是有心理学理论支撑的教研助手，不是医生。

【红线约束】
1. 禁止给出任何医学诊断结论（如"抑郁症""焦虑症"等疾病名称）。
2. 你的输出仅供参考，必须建议涉及高危信号时由专业人员介入。
3. 不臆造数据，只依据用户提供的记录与问卷作答。

【任务】
依据学生数据与候选心理学理论，输出结构化评估：
- 风险等级 level：green（平稳）/ yellow（需关注）/ red（需干预）
- 风险类型 riskType：简短中文短语
- 判定依据 evidence：字符串数组，逐条引用具体信号（来自记录文本或问卷）
- 分步干预建议 steps：对象数组 [{t:标题, d:具体做法}]，3~5 条，面向非专业教师，口语化、可执行
- 理论来源 theoryIds：从候选理论中选 1~3 个最相关的 id
- 沟通话术参考 talk：字符串数组，2~3 条班主任可直接使用的话术

【输出格式】只输出 JSON，不要任何解释或 Markdown 代码块：
{"level":"...","riskType":"...","evidence":["..."],"steps":[{"t":"...","d":"..."}],"theoryIds":["T1"],"talk":["..."]}`;

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function onRequestPost({ request, env }) {
  const t0 = Date.now();
  let body;
  try { body = await request.json(); } catch { return json({ ok:false, error:'请求体不是合法 JSON' }, 400); }

  const text = String(body.text || '').slice(0, 2000);
  const answers = body.answers || {};
  const theories = Array.isArray(body.theories) ? body.theories.slice(0, 20) : [];
  const studentName = String(body.studentName || '该学生').slice(0, 40);

  /* ① 规则引擎硬筛查 */
  const ruleHits = ruleScan(text);
  const hard = ruleHits.find(h => h.hard);

  if (hard) {
    const p = hardPlan(hard);
    return json({
      ok: true, engine: 'rule', level: 'red', riskType: hard.type,
      evidence: [`日常记录命中高危规则 ${hard.ruleId}：${hard.type}（关键词：${hard.matched.join('、')}）`],
      steps: p.steps, theoryIds: p.theoryIds, talk: [], ruleHits,
      latencyMs: Date.now() - t0,
      model: '规则引擎硬触发（高危信号，未调用大模型）'
    });
  }

  /* ② RAG 理论检索 */
  const picked = ragRetrieve(theories, text + ' ' + Object.keys(answers).join(' '), 3);

  /* ③ 大模型语义推理 */
  const key = env.AI_API_KEY;
  if (!key) {
    return json({ ok:false, error:'服务端未配置 AI_API_KEY，请检查环境变量', ruleHits }, 503);
  }
  const base = (env.AI_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
  const model = env.AI_MODEL || DEFAULT_MODEL;

  const userPayload = {
    student: studentName,
    record: text || '（无文字记录）',
    questionnaire: answers,
    candidateTheories: picked.map(t => ({ id:t.id, name:t.name, summary:t.summary, apply:t.apply }))
  };

  let out;
  try {
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(userPayload) }
        ]
      })
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return json({ ok:false, error:'大模型接口返回 ' + r.status, detail: detail.slice(0, 300), ruleHits }, 502);
    }
    out = await r.json();
  } catch (e) {
    return json({ ok:false, error:'大模型调用失败：' + (e && e.message ? e.message : String(e)), ruleHits }, 502);
  }

  let parsed;
  try {
    const content = out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content;
    parsed = JSON.parse(content);
  } catch (e) {
    return json({ ok:false, error:'大模型输出无法解析为 JSON', raw: String(out).slice(0, 300), ruleHits }, 502);
  }

  const validLevels = ['green', 'yellow', 'red'];
  const level = validLevels.indexOf(parsed.level) !== -1 ? parsed.level : 'yellow';

  return json({
    ok: true, engine: 'llm', level,
    riskType: String(parsed.riskType || '一般情绪/学业压力').slice(0, 60),
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.slice(0, 6).map(String) : [],
    steps: Array.isArray(parsed.steps) ? parsed.steps.slice(0, 6).map(s => ({ t:String(s.t || '').slice(0, 40), d:String(s.d || '').slice(0, 300) })) : [],
    theoryIds: Array.isArray(parsed.theoryIds) ? parsed.theoryIds.filter(x => /^T\d+$/.test(String(x))).slice(0, 3) : [],
    talk: Array.isArray(parsed.talk) ? parsed.talk.slice(0, 4).map(String) : [],
    ruleHits,
    latencyMs: Date.now() - t0,
    model: '大模型 ' + model + '（RAG 增强）'
  });
}

/* 非 POST 请求给出明确提示 */
export async function onRequestGet() {
  return json({ ok:false, error:'请使用 POST 调用本接口' }, 405);
}
