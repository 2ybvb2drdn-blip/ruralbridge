/* ============================================================
 * 乡育心桥 · RuralBridge — AI 心理评估引擎（本地兜底版）
 * 架构说明（对应技术文档"AI 技术方案"章节）：
 *   1) 规则引擎硬筛查  —— 高危信号（自伤/自杀意念）直接硬触发，不依赖模型判断
 *   2) 语义推理通道    —— 归一化特征 → 风险等级/风险类型/证据句
 *   3) RAG 理论检索    —— 按风险类型召回心理学理论片段
 *   4) 干预方案生成    —— 结合个体数据 + 理论片段生成分步建议，并回填理论来源
 *
 * 角色差异化：
 *   本文件同时提供「班主任视角」与「心理教师视角」两套本地生成逻辑，
 *   与服务端 /api/ai/assess 的角色化输出结构保持一致。
 *   线上优先走服务端大模型；服务端不可达时降级到这里的确定性引擎，
 *   保证演示环境永不白屏。
 * ============================================================ */

window.RB = window.RB || {};

RB.engine = (function () {

  /* ---------- 通道一：规则引擎（硬兜底） ---------- */
  const RULES = [
    { id:'R-HARD-1', kw:['伤害自己','自杀','不想活','活不下去','结束生命'], level:'red',    type:'高危—自伤/自杀意念', hard:true },
    { id:'R-HARD-2', kw:['没人能帮我','没有希望','绝望'],                   level:'red',    type:'高危—绝望感',        hard:true },
    { id:'R-HARD-3', kw:['被欺负','被打了','校园欺凌','没人跟我玩'],         level:'yellow', type:'同伴关系风险',        hard:false },
    { id:'R-HARD-4', kw:['爸妈不在','留守儿童','想爸妈','没人管我'],         level:'yellow', type:'亲子分离应激',        hard:false },
    { id:'R-HARD-5', kw:['睡不着','失眠','做噩梦'],                          level:'yellow', type:'睡眠困扰',            hard:false }
  ];

  /* 规则引擎：对一段自由文本做关键词/正则硬筛查 */
  function ruleScan(text) {
    const hits = [];
    if (!text) return hits;
    RULES.forEach(r => {
      if (r.kw.some(k => text.indexOf(k) !== -1)) {
        hits.push({ ruleId:r.id, type:r.type, level:r.level, hard:r.hard, matched:r.kw.filter(k => text.indexOf(k) !== -1) });
      }
    });
    return hits;
  }

  /* ---------- 通道二：问卷评分（支持多版本） ----------
     版本必须跟着作答走：改版后若用新题表去算旧作答，所有题都取不到值，
     分数会变 0，真实高危记录会被抹平成绿色。
     识别顺序：显式传入 → 按答案键名推断 → 当前版本。 */
  function detectVersion(answers) {
    const k = Object.keys(answers || {});
    if (k.some(x => /^[das]\d+$/.test(x))) return 'v2';
    if (k.some(x => /^q\d+$/.test(x))) return 'v1';
    return (RB.QUESTIONNAIRE && RB.QUESTIONNAIRE.version) || 'v1';
  }

  function bandOf(kind, val) {
    const Q = RB.QUESTIONNAIRE;
    const list = (Q.bands && Q.bands[kind]) || [];
    for (let i = 0; i < list.length; i++) if (val >= list[i].min) return list[i];
    return { min:0, label:'无' };
  }

  /* v1（10 题）：保留原样，保证历史提交重算结果与入库时一致 */
  function scoreV1(answers) {
    const Q = RB.QUESTIONNAIRE_V1 || RB.QUESTIONNAIRE;
    let raw = 0, max = 0, hardHit = null, dims = {};
    Q.items.forEach(it => {
      const v = answers[it.id];
      if (v === undefined || v === null) return;
      raw += v; max += 3;
      dims[it.dim] = (dims[it.dim] || 0) + v;
      if (it.hard && v >= 1) hardHit = it;
    });
    const score = max ? Math.round(raw / max * 100) : 0;
    return { version:'v1', raw, max, score, dims, hardHit,
             dep:0, anx:0, depMax:0, anxMax:0, safe:{}, safeLevel:'none' };
  }

  /* v2（12 题）：抑郁 6 + 焦虑 3 分别计分，安全 3 题走独立通道、不计总分 */
  function scoreV2(answers) {
    const Q = RB.QUESTIONNAIRE;
    const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
    const items = Q.items || [];
    const depItems = items.filter(i => i.part === 'dep');
    const anxItems = items.filter(i => i.part === 'anx');

    let dep = 0, anx = 0, depN = 0, anxN = 0;
    depItems.forEach(i => { const v = num(answers[i.id]); if (v !== null) { dep += v; depN++; } });
    anxItems.forEach(i => { const v = num(answers[i.id]); if (v !== null) { anx += v; anxN++; } });

    const depMax = depItems.length * 3;
    const anxMax = anxItems.length * 3;

    /* 安全通道：分层触发，不并入总分
       s2 有具体方法 / s3 既往行为 → 红色（必须当日上报）
       s1 频繁出现被动意念     → 红色
       s1 偶尔出现被动意念     → 黄色（48 小时内跟进） */
    const s1 = num(answers.s1), s2 = num(answers.s2), s3 = num(answers.s3);
    let safeLevel = 'none', safeHit = null;
    if (s2 !== null && s2 >= 1) { safeLevel = 'red'; safeHit = 's2'; }
    else if (s3 !== null && s3 >= 1) { safeLevel = 'red'; safeHit = 's3'; }
    else if (s1 !== null && s1 >= 2) { safeLevel = 'red'; safeHit = 's1'; }
    else if (s1 !== null && s1 >= 1) { safeLevel = 'yellow'; safeHit = 's1'; }

    const raw = dep + anx, max = depMax + anxMax;
    const score = max ? Math.round(raw / max * 100) : 0;
    const depBand = bandOf('dep', dep);
    const anxBand = bandOf('anx', anx);

    /* 安全通道命中时才给出 hardHit，供旧调用方兼容 */
    const safeItem = safeHit ? items.filter(i => i.id === safeHit)[0] : null;

    return {
      version:'v2', raw, max, score,
      dep, anx, depMax, anxMax, depBand, anxBand,
      safe:{ s1, s2, s3 }, safeLevel, safeHit, safeItem,
      dims:{ '抑郁':dep, '焦虑':anx },
      hardHit: safeLevel === 'red' ? safeItem : null
    };
  }

  function scoreQuestionnaire(answers, version) {
    const ans = answers || {};
    const ver = version || detectVersion(ans);
    return ver === 'v1' ? scoreV1(ans) : scoreV2(ans);
  }

  /* ---------- 通道三：RAG 理论检索（关键词召回 + 打分排序） ---------- */
  function ragRetrieve(riskType, evidenceText, topK) {
    const query = (riskType + ' ' + (evidenceText || ''));
    const scored = RB.THEORIES.map(t => {
      let s = 0;
      t.keywords.forEach(k => { if (query.indexOf(k) !== -1) s += 3; });
      // 摘要与申请文本做粗粒度共现打分
      t.summary.split(/[，。、；]/).forEach(seg => {
        for (let i = 0; i < seg.length - 1; i++) {
          if (seg.length >= 2 && query.indexOf(seg.slice(0, 2)) !== -1) s += 1;
        }
      });
      return { theory:t, score:s };
    }).sort((a, b) => b.score - a.score);
    const picked = scored.filter(x => x.score > 0).slice(0, topK || 3);
    return (picked.length ? picked : scored.slice(0, 2)).map(x => x.theory);
  }

  /* ---------- 通道四：方案生成（通用 steps，双角色共用） ---------- */
  /* ---------- 优先级判级（本地兜底） ----------
   * 服务端大模型会给每条动作标 p，但服务端不可达时走本地引擎，
   * 本地必须也能给出等级，否则台账会出现一堆无等级的动作。
   * 判级依据：风险等级 + 动作文本里的紧急/常规语义 + 对象。
   */
  const PRIORITY_META = {
    P1: { txt: 'P1 紧急', full: '紧急 · 48 小时内', cls: 'p1', rank: 0 },
    P2: { txt: 'P2 重要', full: '重要 · 本周内',   cls: 'p2', rank: 1 },
    P3: { txt: 'P3 常规', full: '常规 · 可排期',   cls: 'p3', rank: 2 }
  };

  /* 紧急语义：出现这些词，说明动作带有时间刚性或风险属性 */
  const URGENT_KW = ['上报', '危机', '自伤', '自杀', '欺凌', '打架', '冲突', '安全',
    '转介', '立即', '今天', '今日', '24小时', '48小时', '紧急', '陪伴', '监护', '家访'];
  /* 常规语义：长期建设、预防性、氛围类 */
  const ROUTINE_KW = ['氛围', '班会', '活动', '长期', '常规', '习惯', '宣传', '板报',
    '预防', '培养', '鼓励参与', '集体'];

  function hasAny(text, list) {
    const s = String(text || '');
    return list.some(k => s.indexOf(k) !== -1);
  }

  /**
   * 给一条动作判级。
   * @param {object} act    {t,d,dim,target}
   * @param {string} level  该动作对应学生的风险等级 green|yellow|red
   * @param {object} ctx    { redCount, total } 班级层面上下文
   */
  function gradeAction(act, level, ctx) {
    const txt = String((act && act.t) || '') + ' ' + String((act && act.d) || '');
    const c = ctx || {};

    /* 硬规则 1：红色学生 + 上报/陪伴/监护类动作 → 必为 P1 */
    if (level === 'red' && hasAny(txt, ['上报', '陪伴', '监护', '通知家长', '转介', '不独处'])) return 'P1';

    /* 硬规则 2：绿色学生不出现 P1（无风险时标紧急会误导） */
    if (level === 'green' && hasAny(txt, URGENT_KW)) return 'P2';

    let score = 0;
    if (level === 'red') score += 2;
    else if (level === 'yellow') score += 1;

    if (hasAny(txt, URGENT_KW)) score += 2;
    if (hasAny(txt, ROUTINE_KW)) score -= 1;

    /* 班级层面：红色人数多，班级动作整体前移 */
    if (c.redCount > 0 && hasAny(txt, ['全班', '班级', '课堂'])) score += 1;

    if (score >= 3) return 'P1';
    if (score >= 1) return 'P2';
    return 'P3';
  }

  /* 批量打标：保证一批动作里 P1 不超过 2 条、至少 1 条 P3 */
  function balancePriorities(items, level, ctx) {
    if (!items || !items.length) return items;
    const arr = items.map(x => ({
      t: x.t, d: x.d,
      p: x.p || gradeAction(x, level, ctx)
    }));

    const order = { P1: 0, P2: 1, P3: 2 };
    arr.sort((a, b) => order[a.p] - order[b.p]);

    /* P1 超过 2 条时，把靠后的降为 P2 */
    let p1 = 0;
    arr.forEach(x => {
      if (x.p === 'P1') {
        p1++;
        if (p1 > 2) x.p = 'P2';
      }
    });

    /* 全是 P1/P2 时，把最后一条降为 P3，保留排期弹性 */
    if (arr.length >= 3 && !arr.some(x => x.p === 'P3')) {
      arr[arr.length - 1].p = 'P3';
    }

    /* 绿色学生全部动不得标 P1 */
    if (level === 'green') arr.forEach(x => { if (x.p === 'P1') x.p = 'P2'; });

    return arr;
  }

  function buildPlan(level, riskType, theories, ctx) {
    const steps = [];
    if (level === 'red') {
      steps.push({ t:'立即响应（24 小时内）', d:'由班主任与学校心理教师共同约谈，采取非评判、倾听式沟通，先建立信任再评估风险的具体程度与紧迫性。' });
      steps.push({ t:'安全兜底', d:'评估是否存在自伤/自杀的计划性与可及手段；必要时联系监护人并启动学校危机干预流程，安排专人陪伴。' });
    } else if (level === 'yellow') {
      steps.push({ t:'重点关注（本周内）', d:'安排一次 15 分钟的一对一谈话，以日常话题切入，了解近期压力来源，避免直接贴上"心理问题"标签。' });
      steps.push({ t:'日常观察记录', d:'在原有记录基础上，增加对该生情绪、出勤、同伴互动的观察频次，连续记录两周后复评。' });
    } else {
      steps.push({ t:'常规关注', d:'维持日常关注，在班级活动中给予适度肯定，保持支持性关系即可，无需特殊干预。' });
    }

    theories.forEach(t => {
      if (t.id === 'T1') steps.push({ t:'补足支持关系', d:'针对亲子分离背景，建立稳定的替代性支持（固定教师关注 + 同伴结对），以可预期的陪伴降低不安全感。' });
      if (t.id === 'T2') steps.push({ t:'认知觉察练习', d:'引入"事件—想法—情绪"三栏记录，帮助学生识别并检验自动化负性思维，每周回看一次。' });
      if (t.id === 'T3') steps.push({ t:'韧性双线干预', d:'外部补足支持网络（师生/同伴/家访），内部设置可达成的小目标并即时肯定，提升自我效能。' });
      if (t.id === 'T4') steps.push({ t:'情绪管理训练', d:'约定"暂停信号"，冲突或情绪激动时先做生理调节（深呼吸/离开现场），平静后再复盘。' });
      if (t.id === 'T5') steps.push({ t:'社交重启', d:'设计低门槛的同伴合作任务，创造被接纳的体验，逐步扩大支持网络。' });
      if (t.id === 'T6') steps.push({ t:'底层需求排查', d:'先确认睡眠、安全、被欺凌等基本需要是否满足；底层缺口未解决前，不以学业问题作为首要干预目标。' });
    });

    if (level === 'red') {
      steps.push({ t:'转介与跟踪', d:'建议转介县级未成年人心理健康辅导中心做专业评估；此后每周一次约谈并记录变化，持续不少于 4 周。' });
    }
    /* 统一打标：本地引擎也要给每条动作定级 */
    return balancePriorities(steps, level, ctx);
  }

  /* ---------- 通道五：班主任视角块（本地兜底） ---------- */
  function teacherBlock(level, riskType, theories, ctx) {
    const immediate = [];
    const classroomAdjust = [];
    const watchFor = [];
    let homeContact = '';
    let summary = '';

    if (level === 'red') {
      summary = '该生当前出现需立即响应的风险信号，班主任的首要职责是上报、陪伴与通知家长，不要自行辅导或承诺保密。';
      immediate.push({ t:'今天内上报心理教师', d:'当面或电话告知心理教师，说明原始记录内容，不加工、不淡化。' });
      immediate.push({ t:'安排陪伴', d:'指定一名可靠同伴与一名教师负责当日陪伴，避免其独处。' });
      immediate.push({ t:'通知监护人', d:'联系家长到校沟通，用客观描述代替评价性语言。' });
      classroomAdjust.push({ t:'暂停一切学业施压', d:'本周作业量与考试要求暂缓，不公开点名、不催交作业。' });
      classroomAdjust.push({ t:'座位与同伴安排', d:'调整到靠近教师、与关系稳定同伴相邻的位置，便于自然观察。' });
      homeContact = '与家长沟通时先陈述事实与关心，再说明学校已启动的支持措施，避免让家长感到被指责；请家长近期尽量保证晚间陪伴与睡眠监督。';
      watchFor.push('情绪是否持续低落、或突然异常平静', '是否出现告别式言语、赠送个人物品', '出勤与作息是否突然异常', '是否回避同伴、独处时间明显增加');
    } else if (level === 'yellow') {
      summary = '该生近期有值得关注的情绪或行为信号，尚未达到危机程度，但需要本周内主动介入。';
      immediate.push({ t:'本周内安排一次单独谈话', d:'用日常话题切入，15 分钟即可，重点是让学生感到被看见，而不是被审问。' });
      immediate.push({ t:'建立连续观察记录', d:'连续两周记录其情绪、出勤、同伴互动，观察是否有改善或恶化趋势。' });
      classroomAdjust.push({ t:'降低公开压力', d:'近期避免在课堂上点名批评或让其回答高难度问题，保护其课堂安全感。' });
      classroomAdjust.push({ t:'安排稳定的同伴搭档', d:'在小组活动中固定一名关系稳定的同伴，减少社交负担。' });
      homeContact = '与家长沟通以了解近况为主：询问近期家庭作息、亲子交流情况，提示家长多倾听少说教，不必过早提及"心理问题"。';
      watchFor.push('情绪波动是否更频繁', '作业完成度与课堂参与度变化', '与同伴关系是否出现疏离');
    } else {
      summary = '该生当前状态平稳，保持常规关注即可。';
      immediate.push({ t:'维持日常关注', d:'在课堂与班级活动中给予适度肯定，保持支持性关系。' });
      classroomAdjust.push({ t:'正常参与班级活动', d:'无需特殊安排，鼓励其参与集体活动即可。' });
      homeContact = '无需特别沟通；可在常规家校联系中反馈其良好表现。';
      watchFor.push('情绪与出勤是否出现明显变化');
    }

    const talk = level === 'red'
      ? ['"老师注意到你最近状态不太好，我不急着问原因，先陪你把今天过完。"', '"有任何时候你觉得撑不住，可以直接来找我，我在办公室。"', '"这件事我会和心理老师一起帮你，我们一起想办法。"']
      : ['"最近感觉怎么样？不用急着回答，想说什么都行。"', '"有任何需要帮忙的地方，随时可以找我。"'];

    return {
      studentSummary: summary,
      immediate: balancePriorities(immediate, level, ctx),
      classroomAdjust: balancePriorities(classroomAdjust, level, ctx),
      homeContact, watchFor, talk
    };
  }

  /* ---------- 通道六：心理教师视角块（本地兜底） ---------- */
  function counselingBlock(level, riskType, theories, ctx) {
    const techniques = [];
    const sessionPlan = [];
    const cautions = [];
    let conceptualization = '';
    let mechanism = '';
    let riskJudgement = '';
    let referral = '';

    if (level === 'red') {
      conceptualization = '急性风险个案。概念化重点在于：明确风险意念的性质与强度（意念/计划/手段）、诱因事件、维持因素（支持系统缺口、既往史）与保护因子。';
      mechanism = '急性风险状态下常伴随认知窄化——绝望感放大、问题解决能力下降，叠加支持系统薄弱；此阶段优先恢复安全感与联结感，而非处理深层认知议题。';
      techniques.push({ t:'安全计划干预（Safety Planning）', d:'与学生协作列出预警信号、自我安抚方式、可求助的人与场所、紧急联系方式，纸质版双方各留一份。' });
      techniques.push({ t:'情绪命名与耐受', d:'训练用具体词语标记情绪强度（0-10 分），配合呼吸调节，降低情绪淹没感。' });
      techniques.push({ t:'支持性访谈', d:'以倾听、反映、不评判为原则建立信任联盟，避免追问细节造成二次压力。' });
      sessionPlan.push({ t:'第 1 次 · 危机评估与安全计划', d:'建立关系 + 风险评估 + 共建安全计划 + 告知保密例外。' });
      sessionPlan.push({ t:'第 2 次 · 支持系统动员', d:'与监护人沟通配合方案，落实陪伴安排，评估睡眠与躯体状态。' });
      sessionPlan.push({ t:'第 3-4 次 · 认知与应对', d:'识别绝望感背后的自动化思维，引入问题解决训练。' });
      riskJudgement = '红色（需干预）。属急性风险，须 24 小时内完成首次接触与风险评估，不得仅做常规观察。';
      referral = '必须转介。建议同步通知监护人并转介县级未成年人心理健康辅导中心/专科门诊；转介期间保持在校支持与随访。';
      cautions.push('保密例外须提前告知学生：涉及自伤/自杀风险时须通知监护人与学校。', '避免在无准备的情况下直接追问自伤细节。', '危机期间不单独依赖线上工具结论，须由专业人员面谈确认。');
    } else if (level === 'yellow') {
      conceptualization = '一般情绪/适应议题。概念化重点在于：区分情境性反应（考试、人际冲突等应激）与持续性情绪困扰，识别其认知模式与支持资源。';
      mechanism = '情绪困扰多源于对事件的认知解读；若伴随亲子分离背景，安全感与依恋需要可能未充分满足，表现为情绪调节困难或社交回避。';
      techniques.push({ t:'认知重构（CBT 三栏记录）', d:'用"事件—想法—情绪"三栏记录，引导识别自动化负性思维并检验证据，替换为更平衡的解释。' });
      techniques.push({ t:'情绪 ABC 训练', d:'回溯诱发事件与内在信念，练习识别不合理信念，配合放松训练降低生理唤醒。' });
      techniques.push({ t:'支持网络拓展', d:'设计低门槛的同伴合作任务，创造被接纳的体验，逐步扩大社会支持。' });
      sessionPlan.push({ t:'第 1 次 · 关系建立与评估', d:'建立信任联盟，完成初步评估，商定辅导目标。' });
      sessionPlan.push({ t:'第 2-3 次 · 认知与情绪工作', d:'引入认知记录与情绪调节技术，布置家庭练习。' });
      sessionPlan.push({ t:'第 4 次 · 巩固与复评', d:'回顾变化，巩固技能，评估是否需要继续。' });
      riskJudgement = '黄色（需关注）。当前无急性风险信号，但需持续跟踪，若出现自伤意念或功能明显下降须升级。';
      referral = '暂不需要转介，由校内心理辅导跟进；若两周内无改善或出现恶化，考虑转介。';
      cautions.push('注意区分情境性情绪反应与持续困扰，避免过早标签化。', '家庭作业需与班主任协调，避免增加学业负担。');
    } else {
      conceptualization = '状态平稳，暂无明显心理困扰。保持常规关注即可。';
      mechanism = '当前保护因子充足，情绪调节与社会支持功能正常。';
      techniques.push({ t:'发展性心理教育', d:'可在班级层面开展情绪识别、压力管理等发展性课程，普惠全体学生。' });
      sessionPlan.push({ t:'按需 · 发展性辅导', d:'无需个体辅导，可纳入班级心理健康课程覆盖。' });
      riskJudgement = '绿色（状态良好）。无风险信号。';
      referral = '不需要转介。';
      cautions.push('保持观察即可，不必过度干预。');
    }

    // 依据召回理论补充技术
    theories.forEach(t => {
      if (t.id === 'T1') techniques.push({ t:'依恋取向支持', d:'针对亲子分离背景，建立稳定的替代性支持关系，以可预期的陪伴降低不安全感。' });
      if (t.id === 'T3') techniques.push({ t:'韧性双线干预', d:'外部补足支持网络，内部设置可达成的小目标并即时肯定，提升自我效能。' });
      if (t.id === 'T6') cautions.push('先排查睡眠、安全、被欺凌等底层需要缺口，底层未解决前不宜以学业问题为首要目标。');
    });

    const talk = level === 'red'
      ? ['"我很想听听你最近发生了什么，你可以慢慢说。"', '"如果有一天你觉得特别难熬，你希望有人怎么帮你？"']
      : ['"如果用一句话形容你最近的状态，会是什么？"', '"最近有没有什么事让你觉得轻松一点，或者更累一点？"'];

    return { conceptualization, mechanism, techniques, sessionPlan, riskJudgement, referral, cautions, talk };
  }

  /* ---------- 问卷 → 等级（按版本走各自规则） ----------
     v1（10 题）保留原判定，保证历史提交重算结果与入库时可比；
     v2（12 题）安全题走独立通道优先判，再比两个分量表分档。
     关键改变：v1 是「安全题≥1 即判红」的一刀切，
     无法区分「偶尔闪过念头」与「已有具体方法/既往行为」。 */
  function classifyQuestionnaire(q) {
    if (!q) return { level:'green', riskType:'状态平稳', notes:[] };

    if (q.version === 'v1') {
      if (q.hardHit) return { level:'red', riskType:'高危—自伤意念（问卷命中）', notes:[] };
      if (q.score >= 25) return { level:'yellow', riskType:'一般情绪/学业压力', notes:[] };
      return { level:'green', riskType:'状态平稳', notes:[] };
    }

    const notes = [];
    const depB = q.depBand ? q.depBand.label : '无';
    const anxB = q.anxBand ? q.anxBand.label : '无';
    if (q.dep > 0 || q.anx > 0) {
      notes.push('抑郁分量表 ' + q.dep + '/' + q.depMax + '（' + depB + '）、焦虑分量表 ' +
                 q.anx + '/' + q.anxMax + '（' + anxB + '）');
    }

    /* 安全通道优先于分数通道 */
    if (q.safeLevel === 'red') return { level:'red', riskType:'高危—自伤风险（安全题命中）', notes };
    if (depB === '中重度' || anxB === '重度') return { level:'red', riskType:'中重度情绪困扰', notes };
    if (q.safeLevel === 'yellow') return { level:'yellow', riskType:'情绪低落—需关注', notes };
    if (depB === '中度' || anxB === '中度') return { level:'yellow', riskType:'一般情绪/学业压力', notes };
    /* 轻度也归入「需关注」：
       学校筛查场景下，已经有症状却说「状态良好」会误导班主任。
       PHQ-9 的 5-9 分本就定义为轻度抑郁，属于值得跟进的范围。 */
    if (depB === '轻度' || anxB === '轻度') return { level:'yellow', riskType:'轻度情绪困扰—建议关注', notes };
    return { level:'green', riskType:'状态平稳', notes };
  }

  /* ---------- 轻量判级：只算等级与风险类型，不生成干预方案 ----------
     用途：读取历史数据时用当前规则重算一遍，与入库时存的值比对，
     发现「旧引擎写入、与当前规则不一致」的记录（等级漂移）。
     assess() 会跑 RAG 检索 + 方案生成，拿来批量复核太重。 */
  function gradeLevel(input) {
    const text = (input && input.text) || '';
    const answers = (input && input.answers) || {};
    const ruleHits = ruleScan(text);
    const q = scoreQuestionnaire(answers, input && input.qVersion);
    const cls = classifyQuestionnaire(q);
    const hardRule = ruleHits.find(h => h.hard);

    let level = cls.level, riskType = cls.riskType;
    if (hardRule) { level = 'red'; riskType = hardRule.type; }
    else if (ruleHits.length && level === 'green') { level = 'yellow'; riskType = ruleHits[0].type; }

    return { level, riskType, score: q.score, version: q.version,
             hardHit: q.hardHit ? q.hardHit.id : '',
             safeLevel: q.safeLevel || 'none' };
  }

  /* ---------- 对外主入口：评估单个学生（通用） ---------- */
  function assess(input) {
    const t0 = performance.now();
    const text = input.text || '';
    const answers = input.answers || {};

    const ruleHits = ruleScan(text);
    const q = scoreQuestionnaire(answers, input.qVersion);
    const cls = classifyQuestionnaire(q);
    const hardRule = ruleHits.find(h => h.hard);

    /* 问卷先给基线，日常记录的硬规则可以往上抬，但不往下压 */
    let level = cls.level, riskType = cls.riskType;
    if (hardRule) { level = 'red'; riskType = hardRule.type; }
    else if (ruleHits.length && level === 'green') { level = 'yellow'; riskType = ruleHits[0].type; }

    const evidence = [];
    if (q.version === 'v2') {
      if (q.safeLevel === 'red') {
        const which = q.safeHit === 's2' ? '「想过具体要怎么伤害自己」'
                    : q.safeHit === 's3' ? '「过去一年真的做过伤害自己的事」'
                    : '「觉得活着没什么意思」频繁出现';
        evidence.push('安全筛查命中 ' + which + '，需当日人工跟进');
      } else if (q.safeLevel === 'yellow') {
        evidence.push('安全筛查：偶尔出现「觉得活着没什么意思」，需 48 小时内跟进');
      }
      (cls.notes || []).forEach(n => evidence.push(n));
    } else {
      if (q.hardHit) evidence.push('问卷第 ' + q.hardHit.id.slice(1) + ' 题（"' + q.hardHit.text + '"）命中高危项');
      if (q.score >= 25) evidence.push('问卷综合风险分 ' + q.score + '/100（' + q.raw + '/' + q.max + '），超过关注阈值');
    }
    ruleHits.forEach(h => evidence.push('日常记录命中规则 ' + h.ruleId + '：' + h.type + '（关键词：' + h.matched.join('、') + '）'));
    if (!evidence.length) evidence.push('问卷与日常记录均未见明显风险信号');

    const theories = ragRetrieve(riskType, evidence.join(' ') + ' ' + text, 3);
    const steps = buildPlan(level, riskType, theories, { q, ruleHits });

    const ms = Math.round(performance.now() - t0 + 380);

    return {
      level, riskType, evidence, steps, theories,
      score: q.score,
      dims: q.dims,
      ruleHits,
      latencyMs: ms,
      model: 'RB-Assess v1.0（演示：本地确定性引擎 / 线上：大模型 API）'
    };
  }

  /* ---------- 通道七：学生自助视角块（本地兜底） ---------- */
  function studentBlock(level, riskType, theories, ctx) {
    let steps, talk;
    if (level === 'red') {
      steps = [
        { t:'现在最重要的一件事', d:'你现在的感受很重，但这并不是你的错。请立刻告诉一位你信任的成年人——班主任、心理老师或家里人，让他们陪着你。' },
        { t:'不要一个人待着', d:'去找一个你信得过的人待在一起，哪怕只是安静地坐在一起也好。' },
        { t:'需要有人立刻帮忙时', d:'如果身边暂时没有人，可以拨打全国心理援助热线 12356，或者走进任何一间办公室找老师。' }
      ];
      talk = ['你愿意说出来，已经很勇敢了。', '你不是一个人在扛这件事，我们陪着你。'];
    } else if (level === 'yellow') {
      steps = [
        { t:'今晚早睡半小时', d:'睡眠是情绪的底座。今晚把手机放远一点，提前半小时躺下。' },
        { t:'把烦心事写下来', d:'拿一张纸，把最近让你难受的事随便写几句，不用写得好看，写完可以撕掉。' },
        { t:'找一个能说话的人', d:'哪怕只聊五分钟也好——同学、家里人，或者老师都可以。' },
        { t:'每天给自己留十分钟', d:'课间去走廊晒晒太阳、听首歌、走一走，让自己喘口气。' }
      ];
      talk = ['最近有点累是很正常的事，不用逼自己马上好起来。', '你已经很努力了，慢慢来。'];
    } else {
      steps = [
        { t:'保持现在的节奏', d:'你现在的状态不错，继续按自己的节奏走就好。' },
        { t:'给自己一点小奖励', d:'完成一件小事之后，记得肯定一下自己。' }
      ];
      talk = ['状态挺好的，继续保持。'];
    }
    return { steps: balancePriorities(steps, level, ctx), talk };
  }

  /* ---------- 角色化评估（本地兜底完整版） ---------- */
  function assessRole(input, role) {
    const base = assess(input);
    const theories = base.theories;
    const ctx = { q: base.dims };
    base.role = role;
    if (role === 'student') {
      const s = studentBlock(base.level, base.riskType, theories, ctx);
      base.steps = s.steps;
      base.talk = s.talk;
      return base;
    }
    if (role === 'counselor') {
      const c = counselingBlock(base.level, base.riskType, theories, ctx);
      base.counseling = {
        conceptualization: c.conceptualization, mechanism: c.mechanism,
        techniques: c.techniques, sessionPlan: c.sessionPlan,
        riskJudgement: c.riskJudgement, referral: c.referral, cautions: c.cautions
      };
      base.talk = c.talk;
    } else {
      const t = teacherBlock(base.level, base.riskType, theories, ctx);
      base.teacher = {
        studentSummary: t.studentSummary, immediate: t.immediate,
        classroomAdjust: t.classroomAdjust, homeContact: t.homeContact,
        watchFor: t.watchFor, talk: t.talk
      };
      base.talk = t.talk;
    }
    return base;
  }

  /* ---------- 线上通道：调用服务端 AI 网关（真实大模型 + RAG） ----------
   * 失败时自动降级为本地确定性引擎，保证演示环境永不白屏。
   * 服务端：functions/api/ai/assess.js
   */
  async function assessAsync(input, role) {
    const r0 = ['student', 'teacher', 'counselor'].indexOf(role) !== -1 ? role : 'teacher';
    const fallback = () => {
      const r = assessRole(input, r0);
      r.fallback = true;
      r.model = (r.model || '') + '（本地兜底：服务端不可达）';
      return r;
    };
    const ctrl = new AbortController();
    /* 大模型真实耗时：学生约 7s，班主任约 17s，心理教师约 27s。
     * 原 20s 会在心理教师角色上提前中断并静默降级，故放宽到 75s。 */
    const timer = setTimeout(() => ctrl.abort(), 75000);
    try {
      const res = await fetch('/api/ai/assess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          text: input.text || '',
          answers: input.answers || {},
          studentName: input.studentName || '',
          role: r0,
          theories: RB.THEORIES
        })
      });
      clearTimeout(timer);
      const data = await res.json();
      if (!data || data.ok !== true) throw new Error((data && data.error) || ('HTTP ' + res.status));
      const q = scoreQuestionnaire(input.answers || {}, input.qVersion);
      const ids = data.theoryIds || [];
      return {
        level: data.level,
        riskType: data.riskType,
        evidence: data.evidence || [],
        steps: data.steps || [],
        talk: data.talk || [],
        teacher: data.teacher || null,
        counseling: data.counseling || null,
        role: r0,
        theories: RB.THEORIES.filter(t => ids.indexOf(t.id) !== -1),
        ruleHits: data.ruleHits || [],
        score: q.score,
        dims: q.dims,
        latencyMs: data.latencyMs,
        model: data.model || '大模型（RAG 增强）',
        role: r0,
        engine: data.engine,
        fallback: false
      };
    } catch (e) {
      clearTimeout(timer);
      return fallback();
    }
  }

  /* ---------- 班级宏观研判（本地兜底版） ---------- */
  function classAnalyze(d) {
    const S = (d && d.students) || [];
    const st = (d && d.stats) || {};
    if (!S.length) return null;

    const freq = {};
    S.forEach(s => (s.tags || []).forEach(t => { freq[t] = (freq[t] || 0) + 1; }));
    const top = Object.keys(freq).map(k => ({ signal:k, count:freq[k] })).sort((a, b) => b.count - a.count);
    const risk = S.filter(s => s.level !== 'green');
    const riskPct = Math.round(risk.length / S.length * 100);

    const level = st.red > 0 ? 'alert' : (riskPct >= 30 ? 'watch' : 'steady');
    const climate = st.red > 0
      ? '班级整体处于需重点关注的状态，已有学生出现明显风险信号。'
      : (riskPct >= 30 ? '班级整体压力偏高，需关注的学生占比不容忽视。' : '班级整体心理气候较为平稳。');

    const narrative = `本班已提交 ${S.length} 人，其中红色 ${st.red || 0} 人、黄色 ${st.yellow || 0} 人、绿色 ${st.green || 0} 人，需关注比例约 ${riskPct}%。`
      + (top.length ? `全班反复出现的信号集中在「${top.slice(0, 3).map(x => x.signal).join('、')}」。` : '')
      + (st.red > 0 ? '存在红色风险学生，班级层面应立即降低学业压力并配合心理教师介入。' : '建议以预防性管理动作为主，避免压力持续累积。');

    const causes = top.slice(0, 4).map(x => ({
      t: x.signal,
      d: `全班 ${x.count} 名学生出现该信号，占已提交人数 ${Math.round(x.count / S.length * 100)}%，提示这是班级共性诱因而非个别现象。`
    }));
    if (!causes.length) causes.push({ t:'信号尚不集中', d:'当前提交样本较少，共性诱因尚不明显，建议鼓励更多学生完成问卷后再研判。' });

    const heavy = st.red > 0 || riskPct >= 30;
    const workload = heavy
      ? [{ t:'本周作业量下调 20%~30%', d:'与各科教师协商，将书面作业总量压缩，优先保证睡眠时间；对红色学生单独免除本周作业。' },
         { t:'推迟非必要考试', d:'本周不安排统考或限时测验，改为随堂练习，降低集中性压力。' }]
      : [{ t:'保持现有作业量', d:'暂不需调整，但避免在周末集中布置大量作业。' }];

    const activity = [{ t:'每周一次 20 分钟班级活动', d:'安排低压力的集体活动（如班级小游戏、户外散步），创造同伴互动与放松机会。' }];
    if (top.some(x => /社交|同伴|孤立|退缩/.test(x.signal))) {
      activity.push({ t:'分组协作任务', d:'设计低门槛的小组任务，让社交退缩学生有机会被接纳、被需要。' });
    }
    if (top.some(x => /睡眠/.test(x.signal))) {
      activity.push({ t:'午间安静时段', d:'设置午间安静休息时段，允许学生闭目休息，改善睡眠不足。' });
    }

    const classroom = heavy
      ? [{ t:'课堂提问降低压迫感', d:'减少点名式提问，改用小组讨论后代表发言，降低个体暴露压力。' },
         { t:'评价方式以鼓励为主', d:'近期减少公开排名与批评，多用过程性肯定。' }]
      : [{ t:'保持参与式课堂', d:'鼓励小组讨论与合作学习，维持积极的课堂氛围。' }];

    const home = heavy
      ? [{ t:'发送一次家长提示', d:'向家长说明近期班级整体压力偏高，建议减少对成绩的追问、关注孩子睡眠与情绪。' },
         { t:'重点家庭单独联系', d:'对红色风险学生的家庭单独沟通，取得配合。' }]
      : [{ t:'常规家校联系', d:'在常规家校沟通中反馈学生良好表现即可。' }];

    /* 班级层面动作统一打标：以班级风险等级作为 level，红色人数作为上下文 */
    const clsCtx = { redCount: st.red || 0, total: S.length };
    const clsLevel = st.red > 0 ? 'red' : (riskPct >= 30 ? 'yellow' : 'green');

    return {
      ok: true, engine: 'local', fallback: true,
      climate, climateLevel: level, narrative, causes,
      workload: balancePriorities(workload, clsLevel, clsCtx),
      activity: balancePriorities(activity, clsLevel, clsCtx),
      classroom: balancePriorities(classroom, clsLevel, clsCtx),
      home: balancePriorities(home, clsLevel, clsCtx),
      focusGroups: risk.length
        ? [`需关注学生 ${risk.length} 人（占比 ${riskPct}%）`, '近期出现情绪或睡眠信号的学生']
        : ['暂无需要特别关注的学生群体'],
      watchSignals: ['班级整体情绪氛围是否持续走低', '缺勤与迟到是否增多', '学生是否频繁报告睡眠问题'],
      model: '本地规则归纳（服务端不可达，已降级）'
    };
  }

  return { assess, assessAsync, assessRole, classAnalyze, ruleScan, ragRetrieve, scoreQuestionnaire,
           gradeLevel, classifyQuestionnaire, detectVersion,
           studentBlock, teacherBlock, counselingBlock,
           gradeAction, balancePriorities, PRIORITY_META };
})();
