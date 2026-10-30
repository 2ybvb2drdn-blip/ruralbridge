/* ============================================================
 * 乡育心桥 · RuralBridge — 可施测量表题库（v1）
 *
 * 本文件提供「真题目 + 真计分」，用于派发、填写、自动判级。
 * （早期的 scales.js 只是一份只读的计分口径速查，无题目、不能施测，
 *   已随界面清理一并删除；施测原则移入 docs/技术文档.md 5.3.1）
 *
 * 收录原则（只选授权干净、学校场景真正需要的）：
 *   PHQ-9   抑郁         公开可用，Kroenke 2001，免费用于临床与研究
 *   GAD-7   焦虑         公开可用，Spitzer 2006
 *   ISI     睡眠         学术免费，Bastien 2001，需注明出处
 *   C-SSRS  自杀风险     哥伦比亚量表筛查版，学术免费，需培训后使用
 *
 * 不收录：
 *   SDQ   —— 需注册授权，不能直接嵌入
 *   PSC   —— 国内版本混杂、常模不明
 *   SDS/SAS —— 国内改编版众多，版本间题目有差异，避免误导
 *
 * 安全设计：
 *   任何量表只要涉及自伤/自杀条目，勾选即为红色，不走总分；
 *   C-SSRS 的 3 级及以上直接判高危并提示启动危机流程。
 * ============================================================ */

(function () {
  'use strict';
  const RB = window.RB || (window.RB = {});

  /* 通用四级频率选项（PHQ-9 / GAD-7 用） */
  const FREQ4 = [
    { v: 0, label: '完全没有' },
    { v: 1, label: '有几天' },
    { v: 2, label: '一半以上时间' },
    { v: 3, label: '几乎每天' }
  ];

  /* 近两周时间框 */
  const FRAME = '请根据最近两周的实际感受作答';

  RB.SCALE_BANK = [
    /* ---------------- PHQ-9 ---------------- */
    {
      id: 'PHQ-9',
      name: 'PHQ-9 抑郁筛查',
      full: '病人健康问卷抑郁量表',
      author: 'Kroenke, Spitzer & Williams, 2001',
      minutes: 3,
      frame: FRAME,
      options: FREQ4,
      /* 第 9 条为自伤意念，单独走安全通道 */
      safetyItem: 'p9',
      items: [
        { id:'p1', text:'做事时提不起劲或没有兴趣' },
        { id:'p2', text:'感到心情低落、沮丧或绝望' },
        { id:'p3', text:'入睡困难、睡不安稳，或睡得太多' },
        { id:'p4', text:'感觉疲倦或没有活力' },
        { id:'p5', text:'食欲不振，或吃得太多' },
        { id:'p6', text:'觉得自己很糟，或觉得自己很失败，或让自己或家人失望' },
        { id:'p7', text:'对事物专注有困难，例如做作业或看书时' },
        { id:'p8', text:'动作或说话变慢到别人都察觉；或相反，烦躁、坐立不安、动来动去比平时更多' },
        { id:'p9', text:'有「不如死掉」或「想以某种方式伤害自己」的念头' }
      ],
      /* 总分 0-27，按原文献 5/10/15/20 分档 */
      bands: [
        { min: 20, level: 'red',    label: '重度抑郁',   advice: '建议尽快转介专业评估' },
        { min: 15, level: 'red',    label: '中重度抑郁', advice: '建议转介评估，同时校内加强关注' },
        { min: 10, level: 'yellow', label: '中度抑郁',   advice: '建议安排个别访谈，两周后复测' },
        { min: 5,  level: 'yellow', label: '轻度抑郁',   advice: '持续关注，必要时提供支持性谈话' },
        { min: 0,  level: 'green',  label: '无或极轻',   advice: '暂无临床意义，保持常规关注' }
      ],
      note: '第 9 条（自伤意念）不参与总分判级，单独走安全通道。'
    },

    /* ---------------- GAD-7 ---------------- */
    {
      id: 'GAD-7',
      name: 'GAD-7 焦虑筛查',
      full: '广泛性焦虑障碍量表',
      author: 'Spitzer, Kroenke, Williams & Löwe, 2006',
      minutes: 2,
      frame: FRAME,
      options: FREQ4,
      items: [
        { id:'a1', text:'感觉紧张、焦虑或急切' },
        { id:'a2', text:'不能够停止或控制担忧' },
        { id:'a3', text:'对各种各样的事情担忧过多' },
        { id:'a4', text:'很难放松下来' },
        { id:'a5', text:'由于不安而无法静坐' },
        { id:'a6', text:'变得容易烦恼或急躁' },
        { id:'a7', text:'感到似乎将有可怕的事情发生而害怕' }
      ],
      /* 总分 0-21，原文献 cut-off 5/10/15；学校筛查采用 ≥8 纳入关注 */
      bands: [
        { min: 15, level: 'red',    label: '重度焦虑', advice: '建议转介评估' },
        { min: 10, level: 'yellow', label: '中度焦虑', advice: '建议个别访谈，两周后复测' },
        { min: 8,  level: 'yellow', label: '轻中度（达筛查界值）', advice: '纳入关注名单' },
        { min: 5,  level: 'yellow', label: '轻度焦虑', advice: '持续关注' },
        { min: 0,  level: 'green',  label: '无或极轻', advice: '暂无临床意义' }
      ],
      note: '原文献 cut-off ≥8 时灵敏度约 92%、特异度约 76%，学校筛查建议 ≥8 即纳入关注。'
    },

    /* ---------------- ISI ---------------- */
    {
      id: 'ISI',
      name: 'ISI 失眠严重程度',
      full: '失眠严重程度指数',
      author: 'Bastien, Vallières & Morin, 2001',
      minutes: 2,
      frame: '请根据最近两周的睡眠情况作答',
      /* ISI 各题锚点措辞不同，逐题给选项 */
      items: [
        { id:'i1', text:'入睡困难的严重程度', options:[
          {v:0,label:'没有'},{v:1,label:'轻微'},{v:2,label:'中等'},{v:3,label:'严重'},{v:4,label:'非常严重'}] },
        { id:'i2', text:'睡眠维持困难（夜间醒来）的严重程度', options:[
          {v:0,label:'没有'},{v:1,label:'轻微'},{v:2,label:'中等'},{v:3,label:'严重'},{v:4,label:'非常严重'}] },
        { id:'i3', text:'早醒问题的严重程度', options:[
          {v:0,label:'没有'},{v:1,label:'轻微'},{v:2,label:'中等'},{v:3,label:'严重'},{v:4,label:'非常严重'}] },
        { id:'i4', text:'对目前睡眠模式的满意程度', options:[
          {v:0,label:'非常满意'},{v:1,label:'满意'},{v:2,label:'一般'},{v:3,label:'不满意'},{v:4,label:'非常不满意'}] },
        { id:'i5', text:'睡眠问题在多大程度上干扰了你的日间功能（如疲劳、注意力、情绪）', options:[
          {v:0,label:'完全没有'},{v:1,label:'轻微'},{v:2,label:'中等'},{v:3,label:'很大'},{v:4,label:'极大'}] },
        { id:'i6', text:'别人在多大程度上能注意到你的睡眠问题', options:[
          {v:0,label:'完全注意不到'},{v:1,label:'轻微'},{v:2,label:'中等'},{v:3,label:'明显'},{v:4,label:'非常明显'}] },
        { id:'i7', text:'你对目前睡眠问题的担心程度', options:[
          {v:0,label:'完全不担心'},{v:1,label:'轻微'},{v:2,label:'中等'},{v:3,label:'很担心'},{v:4,label:'非常担心'}] }
      ],
      /* 总分 0-28 */
      bands: [
        { min: 22, level: 'red',    label: '重度临床失眠', advice: '建议转介，失眠常与抑郁共病' },
        { min: 15, level: 'yellow', label: '中度临床失眠', advice: '建议个别访谈并做睡眠卫生指导' },
        { min: 8,  level: 'yellow', label: '亚临床失眠',   advice: '纳入关注，指导睡眠卫生' },
        { min: 0,  level: 'green',  label: '无临床意义失眠', advice: '暂无临床意义' }
      ],
      note: '长期失眠是抑郁的独立风险因素，得分偏高时应同时关注情绪状态。'
    },

    /* ---------------- C-SSRS ---------------- */
    {
      id: 'C-SSRS',
      name: 'C-SSRS 自杀风险筛查',
      full: '哥伦比亚自杀严重程度评定量表（筛查版）',
      author: 'Posner et al., 2011',
      minutes: 5,
      frame: '请如实作答。你的回答会帮助老师更好地支持你',
      warn: '本量表涉及自杀风险，须由受过培训的教师一对一施测，不可整班集体填写。',
      /* 是/否二元，逐题递进 */
      items: [
        { id:'s1', text:'你是否希望自己已经死了，或希望自己能睡着不再醒来？', options:[{v:0,label:'否'},{v:1,label:'是'}] },
        { id:'s2', text:'你是否曾有过想杀死自己的想法？', options:[{v:0,label:'否'},{v:1,label:'是'}] },
        { id:'s3', text:'你是否想过自杀的具体方法？', options:[{v:0,label:'否'},{v:1,label:'是'}] },
        { id:'s4', text:'你是否有过自杀的意图，即使没有具体计划？', options:[{v:0,label:'否'},{v:1,label:'是'}] },
        { id:'s5', text:'你是否已有自杀的具体计划？', options:[{v:0,label:'否'},{v:1,label:'是'}] },
        { id:'s6', text:'你过去是否曾有过自杀行为（尝试过自杀）？', options:[{v:0,label:'否'},{v:1,label:'是'}] }
      ],
      /* 按最高「是」的条目判级，不走总分 */
      levels: [
        { item: 's6', level: 'red',    label: '6 级 · 既往自杀行为', advice: '立即启动危机流程：不独处、通知监护人、当日上报、转介精神科' },
        { item: 's5', level: 'red',    label: '5 级 · 有具体计划',   advice: '立即启动危机流程：不独处、通知监护人、当日上报' },
        { item: 's4', level: 'red',    label: '4 级 · 有自杀意图',   advice: '当日上报，通知监护人，转介评估' },
        { item: 's3', level: 'red',    label: '3 级 · 想过具体方法', advice: '当日上报，通知监护人，专业评估' },
        { item: 's2', level: 'yellow', label: '2 级 · 主动自杀意念', advice: '48 小时内访谈，评估保护因素，制定安全计划' },
        { item: 's1', level: 'yellow', label: '1 级 · 被动意念',     advice: '跟进访谈，了解频率与情境，两周内复评' }
      ],
      note: '直接询问自杀想法不会诱发自杀，反而降低风险。任何 3 级及以上必须启动危机流程。'
    }
  ];

  /* ---------------- 计分 ---------------- */
  /**
   * @param {string} scaleId
   * @param {object} answers { itemId: value }
   * @returns {{ scaleId, score, max, level, label, advice, isSafety, detail }}
   */
  function scoreScale(scaleId, answers) {
    const S = (RB.SCALE_BANK || []).find(s => s.id === scaleId);
    if (!S) return { error: '未知量表 ' + scaleId };
    const a = answers || {};
    let total = 0;
    let max = 0;
    const missing = [];

    S.items.forEach(it => {
      const raw = it.options ? it.options[it.options.length - 1].v : 0;
      const itemMax = it.options ? raw : 3;
      max += itemMax;
      const v = a[it.id];
      if (v === undefined || v === null || v === '') { missing.push(it.id); return; }
      total += Number(v) || 0;
    });

    if (missing.length) {
      return { error: '还有 ' + missing.length + ' 题未作答', missing, scaleId };
    }

    /* C-SSRS 走条目递进判级，不算总分 */
    if (S.levels) {
      for (const lv of S.levels) {
        if (Number(a[lv.item]) >= 1) {
          return {
            scaleId: S.id, scaleName: S.name,
            score: 0, max: 0,
            level: lv.level, label: lv.label, advice: lv.advice,
            isSafety: true,
            detail: '触发条目：' + lv.item + '（' + lv.label + '）'
          };
        }
      }
      return {
        scaleId: S.id, scaleName: S.name,
        score: 0, max: 0, level: 'green',
        label: '未报告自杀相关意念或行为',
        advice: '本次筛查未见风险信号，保持常规关注',
        isSafety: true, detail: '全部条目均为「否」'
      };
    }

    /* 普通量表：按分档匹配 */
    const band = (S.bands || []).find(b => total >= b.min) ||
      (S.bands || [])[S.bands.length - 1] || { level: 'green', label: '—', advice: '' };

    /* 安全条目单独升级：涉及自伤的条目只要勾选即至少黄色。
       注意：升级后必须同步改写 label 与 advice。
       否则会出现「红色 + 无或极轻 / 暂无临床意义」这种自相矛盾的结论——
       总分确实低，但自伤意念已经出现，两者必须合并表述，
       不能让卡片上出现任何「暂无问题」的暗示。 */
    let level = band.level;
    let label = band.label;
    let advice = band.advice;
    let escalated = false;

    if (S.safetyItem && Number(a[S.safetyItem]) >= 1) {
      const v = Number(a[S.safetyItem]);
      escalated = true;
      if (v >= 2) {
        level = 'red';
        label = '检出自我伤害意念（经常/几乎每天）';
        advice = '总分虽为 ' + total + ' 分，但自伤意念条目已达高危频率。' +
          '当日上报，不让学生独处，通知监护人，转介专业评估。';
      } else {
        if (level === 'green') level = 'yellow';
        label = '检出自我伤害意念（有几天）';
        advice = '总分 ' + total + ' 分，但自伤意念条目不可忽略。' +
          '48 小时内个别访谈，了解频率与情境，评估保护因素。';
      }
    }

    return {
      scaleId: S.id, scaleName: S.name,
      score: total, max: max,
      level: level,
      label: label,
      advice: advice,
      escalated: escalated,
      isSafety: false,
      detail: '总分 ' + total + ' / ' + max + (escalated ? '（已按安全条目升级）' : '')
    };
  }

  /* 派发任务时给前端用的精简清单 */
  function scaleList() {
    return (RB.SCALE_BANK || []).map(s => ({
      id: s.id, name: s.name, full: s.full, author: s.author,
      minutes: s.minutes, itemCount: s.items.length,
      hasWarn: !!s.warn, warn: s.warn || ''
    }));
  }

  RB.scaleBank = { score: scoreScale, list: scaleList, all: RB.SCALE_BANK };
})();
