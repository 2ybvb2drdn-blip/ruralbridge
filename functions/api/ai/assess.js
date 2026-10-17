/* ============================================================
 * 乡育心桥 · RuralBridge —— AI 评估网关（Cloudflare Pages Function）
 * 路由：POST /api/ai/assess
 *
 * 职责：把「规则引擎硬兜底 + RAG 理论检索 + 大模型语义推理」的
 *      双引擎架构真正落地。大模型 API Key 只存在于服务端环境变量，
 *      绝不下发到浏览器。
 *
 * 角色差异化（role 参数）：
 *   - student   学生本人：关心「我现在能为自己做什么」——自助建议 + 安抚
 *   - teacher   班主任视角：关心「我明天能做什么」——可执行的管理动作
 *   - counselor 心理教师视角：关心「这个学生的心理机制是什么」——专业研判
 *   - 缺省      按班主任视角处理（兼容旧调用）
 *
 * 处理链路：
 *   ① 规则引擎硬筛查（服务端复算，防止前端被篡改绕过）
 *        命中高危 → 直接返回红色预警，不调用大模型（安全 + 省额度）
 *   ② RAG 理论检索（按风险文本召回 Top-K 心理学理论）
 *   ③ 大模型语义推理（按角色使用不同系统提示词，JSON 结构化输出）
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

/* ---------- 高危兜底方案（不调用大模型） ----------
 * 命中高危时必须仍然给出角色化内容，否则班主任/心理教师会看到空白页。
 */
function hardPlan(role) {
  const evidence = [];
  if (role === 'student') {
    return {
      theoryIds: ['T3', 'T6'],
      steps: [
        { t:'现在最重要的一件事', d:'你现在的感受很重，但这并不是你的错。请立刻告诉一位你信任的成年人——班主任、心理老师或家里人，让他们陪着你。' },
        { t:'不要一个人待着', d:'去找一个你信得过的人待在一起，哪怕只是安静地坐在一起也好。' },
        { t:'需要有人立刻帮忙时', d:'如果身边暂时没有人，可以拨打全国心理援助热线 12356，或者走进任何一间办公室找老师。' }
      ],
      talk: [
        '你愿意说出来，已经很勇敢了。',
        '你不是一个人在扛这件事，我们陪着你。'
      ]
    };
  }

  if (role === 'counselor') {
    return {
      theoryIds: ['T3', 'T6'],
      steps: [
        { t:'危机评估（24 小时内完成）', d:'采用结构化风险访谈：确认意念的频率、强度、计划性、可及手段与既往尝试史，判断当前属于"意念"还是"计划+手段"层级。' },
        { t:'安全计划共建', d:'与学生共同制定可执行的"安全计划"：识别预警信号、列出可求助对象（含至少一名成人）、约定求助步骤与应急联系方式。' },
        { t:'支持系统动员', d:'联系监护人告知风险并取得配合，落实"不独处"陪伴安排；与班主任同步需观察的具体行为指标。' },
        { t:'转介与随访', d:'建议转介县级未成年人心理健康辅导中心或专科门诊做专业评估；转介后每周一次随访，持续不少于 4 周并记录变化。' }
      ],
      counseling: {
        conceptualization: '危机信号已由规则引擎硬命中，属需优先处理的急性风险个案。个案概念化需在首次访谈中完成：明确诱因事件、风险意念的性质与强度、维持因素（家庭支持缺口、同伴关系、既往史）。',
        mechanism: '急性风险状态下的认知窄化（绝望感放大、问题解决能力下降）与支持系统薄弱共同作用；此阶段优先恢复安全感与联结感，而非处理深层认知议题。',
        techniques: [
          { t:'安全计划干预（Safety Planning）', d:'与学生协作列出预警信号、自我安抚方式、可求助的人与场所、紧急联系方式，纸质版由学生与心理教师各留一份。' },
          { t:'情绪命名与耐受', d:'训练用具体词语标记情绪强度（0-10 分），配合呼吸调节，降低情绪淹没感。' },
          { t:'支持性访谈', d:'以倾听、反映、不评判为原则建立信任联盟，避免追问细节造成二次压力。' }
        ],
        sessionPlan: [
          { t:'第 1 次 · 危机评估与安全计划', d:'建立关系 + 风险评估 + 共建安全计划 + 告知保密例外。' },
          { t:'第 2 次 · 支持系统动员', d:'与监护人沟通配合方案，落实陪伴安排，评估睡眠与躯体状态。' },
          { t:'第 3-4 次 · 认知与应对', d:'识别绝望感背后的自动化思维，引入问题解决训练。' }
        ],
        riskJudgement: '红色（需干预）。规则引擎硬命中高危信号，属急性风险，须 24 小时内完成首次接触与风险评估，不得仅做常规观察。',
        referral: '必须转介。建议同步通知监护人并转介县级未成年人心理健康辅导中心/专科门诊；转介期间保持在校支持与随访。',
        cautions: [
          '保密例外须提前告知学生：涉及自伤/自杀风险时须通知监护人与学校。',
          '避免在无准备的情况下直接追问自伤细节，可能加重风险。',
          '危机期间不单独依赖线上工具结论，须由专业人员面谈确认。'
        ]
      }
    };
  }
  // teacher（含缺省）
  return {
    theoryIds: ['T3', 'T6'],
    steps: [
      { t:'立即上报（今天内）', d:'第一时间告知学校心理教师与分管领导，不要自行判断严重程度，也不要承诺保密。' },
      { t:'不让学生独处', d:'安排可信赖的同伴或教师陪伴，避免其单独留在教室、宿舍或卫生间等场所。' },
      { t:'通知监护人', d:'用平静、客观的语言告知家长观察到的情况，请家长配合到校沟通，避免指责学生。' },
      { t:'移交专业处理', d:'后续评估与辅导交由心理教师与专业机构，班主任负责配合观察与信息同步。' }
    ],
    teacher: {
      studentSummary: '规则引擎已硬命中高危信号，该生当前处于需立即响应的状态。班主任的首要职责是上报、陪伴与通知家长，而非自行辅导。',
      immediate: [
        { t:'今天内上报心理教师', d:'当面或电话告知心理教师，说明原始记录内容，不加工、不淡化。' },
        { t:'安排陪伴', d:'指定一名可靠同伴与一名教师负责当日陪伴，避免其独处。' },
        { t:'通知监护人', d:'联系家长到校沟通，用客观描述代替评价性语言（如"最近他提到过很累、不想继续"，而非"他心理有问题"）。' }
      ],
      classroomAdjust: [
        { t:'暂停一切学业施压', d:'该生本周的作业量与考试要求暂缓，不公开点名、不催交作业、不在班级中讨论其情况。' },
        { t:'座位与同伴安排', d:'调整到靠近教师、与关系稳定同伴相邻的位置，便于自然观察。' }
      ],
      homeContact: '与家长沟通时先陈述事实与关心，再说明学校已启动的支持措施，避免让家长感到被指责；请家长近期尽量保证晚间陪伴与睡眠监督。',
      watchFor: [
        '情绪是否持续低落、突然平静（可能是已下决心）',
        '是否出现告别式言语、赠送个人物品、交代后事',
        '出勤与作息是否突然异常',
        '是否回避同伴、独处时间明显增加'
      ],
      talk: [
        '"老师注意到你最近状态不太好，我不急着问原因，先陪你把今天过完。"',
        '"有任何时候你觉得撑不住，可以直接来找我，我在办公室。"',
        '"这件事我会和心理老师一起帮你，我们一起想办法。"'
      ]
    }
  };
}

/* ---------- 系统提示词：共同红线 ---------- */
const COMMON = `【共同红线】
1. 禁止给出任何医学诊断结论（如"抑郁症""焦虑症""双相障碍"等疾病名称），只描述状态与机制。
2. 不臆造数据，只依据用户提供的记录、问卷作答与候选理论。
3. 涉及高危信号时，必须提示由专业人员介入。
4. 面向乡村中小学真实场景，语言具体、可执行，避免空泛口号。
5. 只输出 JSON，不要任何解释文字或 Markdown 代码块。`;

const PROMPT_STUDENT = `你是"乡育心桥"的学生陪伴助手，服务对象是乡村中小学学生本人（不是老师）。

【红线】
1. 禁止给出任何医学诊断结论，不能说"你得了抑郁症/焦虑症"之类的话。
2. 不臆造，只依据学生自己的问卷作答与记录内容。
3. 语气温和、平等、不说教；始终用"你"称呼。
4. 若出现自伤/自杀等危险信号，必须明确鼓励其立刻告诉一位信任的成年人（老师、家人），或拨打全国心理援助热线 12356，并说明"这不是你的错"。
5. 只输出 JSON，不要任何解释文字或 Markdown 代码块。

【任务】
给学生本人一段温暖的、可操作的自助建议：
- evidence 用中性、不吓人的描述，避免渲染严重性。
- steps：3~4 条"我自己可以做的小事"，门槛要低、当天就能做（例如"今晚提前半小时上床""把烦心事写在本子上""课间去走廊晒两分钟太阳"）。
- talk：2~3 句直接对学生说的鼓励或安抚的话。

【输出 JSON 结构】
{
  "level": "green|yellow|red",
  "riskType": "简短中文短语",
  "evidence": ["中性描述的信号"],
  "steps": [{"t":"小标题","d":"具体做法"}],
  "theoryIds": ["T1"],
  "talk": ["对学生说的话"]
}`;

const PROMPT_TEACHER = `你是"乡育心桥"的班主任助手。使用者是乡村中小学班主任，不是心理专业人员。

${COMMON}

【角色定位】
班主任关心的是："我明天、这一周，具体能做什么？"你的输出必须落到可执行的管理动作上——座位、作业量、课堂提问、同伴搭配、家校沟通、作息要求。不要输出心理学诊断术语，不要把责任推给"专业机构"就结束。

【输出 JSON 结构】
{
  "level": "green|yellow|red",
  "riskType": "简短中文短语",
  "evidence": ["逐条引用具体信号"],
  "steps": [{"t":"动作标题","d":"具体做法"}],
  "theoryIds": ["T1"],
  "talk": ["班主任可直接说的话"],
  "teacher": {
    "studentSummary": "一句话说明该生当前状态（班主任视角）",
    "immediate": [{"t":"本周内可做的事","d":"具体怎么做"}],
    "classroomAdjust": [{"t":"课堂/班级层面调整","d":"具体做法"}],
    "homeContact": "家校沟通要点（一段话）",
    "watchFor": ["需要留意的具体观察指标"],
    "talk": ["可直接使用的话术"]
  }
}
steps 与 teacher.immediate 各 3~4 条；watchFor 3~5 条；talk 2~3 条。`;

const PROMPT_COUNSELOR = `你是"乡育心桥"的学校心理教师助手。使用者是持证/专职心理教师，具备专业判断力。

${COMMON}

【角色定位】
心理教师关心的是："这个学生的心理机制是什么？该用什么技术、按什么节奏做辅导？风险到什么程度、要不要转介？"你的输出要有专业深度：个案概念化、心理机制、具体辅导技术（CBT/依恋/情绪ABC/正念/叙事/焦点解决等）、分次会谈计划、风险研判与转介判断。可以使用专业术语，但每条技术都要写清"具体怎么操作"。

【输出 JSON 结构】
{
  "level": "green|yellow|red",
  "riskType": "简短中文短语",
  "evidence": ["逐条引用具体信号"],
  "steps": [{"t":"研判/辅导要点","d":"具体做法"}],
  "theoryIds": ["T1"],
  "talk": ["首次会谈可用的开放性提问"],
  "counseling": {
    "conceptualization": "个案概念化：主诉 → 机制 → 维持因素 → 保护因子（一段话）",
    "mechanism": "心理机制说明（理论支撑）",
    "techniques": [{"t":"技术名称","d":"具体操作步骤"}],
    "sessionPlan": [{"t":"第 N 次 · 主题","d":"会谈目标与内容"}],
    "riskJudgement": "风险研判：程度、紧迫性、自伤/他伤可能性",
    "referral": "转介判断与依据（或说明暂不需要转介）",
    "cautions": ["辅导注意事项与伦理提醒"]
  }
}
techniques 3~4 条；sessionPlan 3~4 次；cautions 2~4 条。`;

/* ---------- 输出裁剪 ---------- */
function strArr(a, n, len) {
  return Array.isArray(a) ? a.slice(0, n).map(x => String(x).slice(0, len || 200)) : [];
}
function objArr(a, n, tLen, dLen) {
  return Array.isArray(a)
    ? a.slice(0, n).map(s => ({ t: String((s && s.t) || '').slice(0, tLen || 40), d: String((s && s.d) || '').slice(0, dLen || 300) }))
    : [];
}

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
  const role = ['student', 'teacher', 'counselor'].indexOf(body.role) !== -1 ? body.role : 'teacher';

  /* ① 规则引擎硬筛查 */
  const ruleHits = ruleScan(text);
  const hard = ruleHits.find(h => h.hard);

  if (hard) {
    const p = hardPlan(role);
    const out = {
      ok: true, engine: 'rule', role,
      level: 'red', riskType: hard.type,
      evidence: [`日常记录命中高危规则 ${hard.ruleId}：${hard.type}（关键词：${hard.matched.join('、')}）`],
      steps: p.steps, theoryIds: p.theoryIds,
      talk: p.talk || (p.teacher && p.teacher.talk) || [],
      ruleHits,
      latencyMs: Date.now() - t0,
      model: '规则引擎硬触发（高危信号，未调用大模型）'
    };
    if (p.teacher) out.teacher = p.teacher;
    if (p.counseling) out.counseling = p.counseling;
    return json(out);
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

  const sys = role === 'counselor' ? PROMPT_COUNSELOR : (role === 'student' ? PROMPT_STUDENT : PROMPT_TEACHER);
  const userPayload = {
    student: studentName,
    role,
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
        temperature: role === 'counselor' ? 0.25 : (role === 'student' ? 0.5 : 0.35),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: sys },
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

  const resp = {
    ok: true, engine: 'llm', role, level,
    riskType: String(parsed.riskType || '一般情绪/学业压力').slice(0, 60),
    evidence: strArr(parsed.evidence, 6, 300),
    steps: objArr(parsed.steps, 6, 40, 400),
    theoryIds: Array.isArray(parsed.theoryIds) ? parsed.theoryIds.filter(x => /^T\d+$/.test(String(x))).slice(0, 3) : [],
    talk: strArr(parsed.talk, 4, 300),
    ruleHits,
    latencyMs: Date.now() - t0,
    model: '大模型 ' + model + '（RAG 增强 · ' +
      (role === 'counselor' ? '心理教师视角' : (role === 'student' ? '学生自助视角' : '班主任视角')) + '）'
  };

  /* ④ 角色专属块裁剪 */
  if (role === 'counselor') {
    const c = parsed.counseling || {};
    resp.counseling = {
      conceptualization: String(c.conceptualization || '').slice(0, 600),
      mechanism: String(c.mechanism || '').slice(0, 600),
      techniques: objArr(c.techniques, 5, 40, 400),
      sessionPlan: objArr(c.sessionPlan, 5, 60, 400),
      riskJudgement: String(c.riskJudgement || '').slice(0, 500),
      referral: String(c.referral || '').slice(0, 500),
      cautions: strArr(c.cautions, 5, 300)
    };
  } else if (role === 'teacher') {
    const t = parsed.teacher || {};
    resp.teacher = {
      studentSummary: String(t.studentSummary || '').slice(0, 400),
      immediate: objArr(t.immediate, 5, 40, 400),
      classroomAdjust: objArr(t.classroomAdjust, 5, 40, 400),
      homeContact: String(t.homeContact || '').slice(0, 500),
      watchFor: strArr(t.watchFor, 6, 200),
      talk: strArr(t.talk, 4, 300)
    };
  }

  return json(resp);
}

/* 非 POST 请求给出明确提示 */
export async function onRequestGet() {
  return json({ ok:false, error:'请使用 POST 调用本接口' }, 405);
}
