/* ============================================================
 * 乡育心桥 · AI 心理评估引擎（演示版）
 * 架构说明（对应技术文档"AI 技术方案"章节）：
 *   1) 规则引擎硬筛查  —— 高危信号（自伤/自杀意念）直接硬触发，不依赖模型判断
 *   2) 语义推理通道    —— 归一化特征 → 风险等级/风险类型/证据句
 *   3) RAG 理论检索    —— 按风险类型召回心理学理论片段
 *   4) 干预方案生成    —— 结合个体数据 + 理论片段生成分步建议，并回填理论来源
 * 演示版在浏览器内用确定性算法模拟上述流程，输出结构与线上一致。
 * 线上版本由服务端调用大模型 API，本文件替换为 fetch('/api/ai/assess')。
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

  /* ---------- 通道二：问卷语义评分 ---------- */
  function scoreQuestionnaire(answers) {
    const Q = RB.QUESTIONNAIRE;
    let raw = 0, max = 0, hardHit = null, dims = {};
    Q.items.forEach(it => {
      const v = answers[it.id];
      if (v === undefined || v === null) return;
      raw += v; max += 3;
      dims[it.dim] = (dims[it.dim] || 0) + v;
      if (it.hard && v >= 1) hardHit = it;      // 高危题命中
    });
    const score = max ? Math.round(raw / max * 100) : 0;
    return { raw, max, score, dims, hardHit };
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

  /* ---------- 通道四：方案生成 ---------- */
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

    // 依据召回理论补充针对性动作
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
    return steps;
  }

  /* ---------- 对外主入口：评估单个学生 ---------- */
  function assess(input) {
    const t0 = performance.now();
    const text = input.text || '';
    const answers = input.answers || {};

    const ruleHits = ruleScan(text);
    const q = scoreQuestionnaire(answers);

    // —— 判定风险等级：规则硬触发优先级最高 ——
    let level = 'green';
    const hardRule = ruleHits.find(h => h.hard);
    if (hardRule || q.hardHit) {
      level = 'red';
    } else if (ruleHits.some(h => h.level === 'yellow') || q.score >= 40) {
      level = 'yellow';
    } else if (q.score >= 25) {
      level = 'yellow';
    }

    // —— 风险类型 ——
    let riskType;
    if (hardRule) riskType = hardRule.type;
    else if (q.hardHit) riskType = '高危—自伤意念（问卷命中）';
    else if (ruleHits.length) riskType = ruleHits[0].type;
    else if (level === 'yellow') riskType = '一般情绪/学业压力';
    else riskType = '状态平稳';

    // —— 证据句 ——
    const evidence = [];
    if (q.hardHit) evidence.push('问卷第 ' + q.hardHit.id.slice(1) + ' 题（"' + q.hardHit.text + '"）命中高危项');
    ruleHits.forEach(h => evidence.push('日常记录命中规则 ' + h.ruleId + '：' + h.type + '（关键词：' + h.matched.join('、') + '）'));
    if (q.score >= 25) evidence.push('问卷综合风险分 ' + q.score + '/100（' + q.raw + '/' + q.max + '），超过关注阈值');
    if (!evidence.length) evidence.push('问卷与日常记录均未见明显风险信号');

    // —— RAG 检索 ——
    const theories = ragRetrieve(riskType, evidence.join(' ') + ' ' + text, 3);

    // —— 方案生成 ——
    const steps = buildPlan(level, riskType, theories, { q, ruleHits });

    const ms = Math.round(performance.now() - t0 + 380);   // 计入演示用的模拟推理耗时

    return {
      level, riskType, evidence, steps, theories,
      score: q.score,
      dims: q.dims,
      ruleHits,
      latencyMs: ms,
      model: 'RB-Assess v1.0（演示：本地确定性引擎 / 线上：大模型 API）'
    };
  }

  /* ---------- 线上通道：调用服务端 AI 网关（真实大模型 + RAG） ----------
   * 失败时自动降级为本地确定性引擎，保证演示环境永不白屏。
   * 服务端：functions/api/ai/assess.js
   */
  async function assessAsync(input) {
    const fallback = () => {
      const r = assess(input);
      r.fallback = true;
      r.model = r.model + '（本地兜底：服务端不可达）';
      return r;
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch('/api/ai/assess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          text: input.text || '',
          answers: input.answers || {},
          studentName: input.studentName || '',
          theories: RB.THEORIES
        })
      });
      clearTimeout(timer);
      const data = await res.json();
      if (!data || data.ok !== true) throw new Error((data && data.error) || ('HTTP ' + res.status));
      const q = scoreQuestionnaire(input.answers || {});
      const ids = data.theoryIds || [];
      return {
        level: data.level,
        riskType: data.riskType,
        evidence: data.evidence || [],
        steps: data.steps || [],
        talk: data.talk || [],
        theories: RB.THEORIES.filter(t => ids.indexOf(t.id) !== -1),
        ruleHits: data.ruleHits || [],
        score: q.score,
        dims: q.dims,
        latencyMs: data.latencyMs,
        model: data.model || '大模型（RAG 增强）',
        engine: data.engine,
        fallback: false
      };
    } catch (e) {
      clearTimeout(timer);
      return fallback();
    }
  }

  return { assess, assessAsync, ruleScan, ragRetrieve, scoreQuestionnaire };
})();
