/* ============================================================
 * 乡育心桥 · RuralBridge — 数据层
 * 说明：
 *   - 账号为测试环境账号（班主任 / 心理教师 / 学生）
 *   - 学生真实提交的数据存于服务端（Cloudflare KV），
 *     教师后台通过 /api/data/list 实时读取，本文件不再内置任何
 *     学生名单、趋势、干预方案等模拟数据。
 *   - 本文件仅保留：账号表、心理学理论库、轻量问卷定义。
 * ============================================================ */

const RB = window.RB || {};
window.RB = RB;

/* ---------------- 测试账号（角色：teacher 班主任 / counselor 心理教师 / student 学生） ---------------- */
RB.ACCOUNTS = [
  { user:'banzhuren123', pass:'12345678', name:'王老师', role:'teacher',   roleName:'班主任',     klass:'初一(2)班' },
  { user:'xinli123',     pass:'12345678', name:'李老师', role:'counselor', roleName:'学校心理教师', klass:'全校' },
  { user:'student1', pass:'12345678', name:'学生1', role:'student', roleName:'学生', klass:'初一(2)班' },
  { user:'student2', pass:'12345678', name:'学生2', role:'student', roleName:'学生', klass:'初一(2)班' },
  { user:'student3', pass:'12345678', name:'学生3', role:'student', roleName:'学生', klass:'初一(2)班' },
  { user:'student4', pass:'12345678', name:'学生4', role:'student', roleName:'学生', klass:'初一(2)班' },
  { user:'student5', pass:'12345678', name:'学生5', role:'student', roleName:'学生', klass:'初一(2)班' }
];

/* 是否教师视角（可看后台） */
RB.isStaff = function (acc) { return !!acc && (acc.role === 'teacher' || acc.role === 'counselor'); };

/* ---------------- 角色化导航（两套完全不同的工作台） ----------------
 * 班主任：数据收集 → AI 翻译成管理动作 → 行动台账闭环
 * 心理教师：预警队列 → 专业研判 → 辅导档案 → 转介危机
 */
RB.NAV = {
  teacher: [
    { tab:'dash',     label:'班级概览' },
    { tab:'classai',  label:'班级研判' },
    { tab:'students', label:'学生名单' },
    { tab:'collect',  label:'数据收集' },
    { tab:'actions',  label:'行动台账' },
    { tab:'report',   label:'班级报告' }
  ],
  counselor: [
    { tab:'queue',    label:'预警队列' },
    { tab:'plan',     label:'个案研判' },
    { tab:'cases',    label:'辅导档案' },
    { tab:'climate',  label:'心理态势' },
    { tab:'referral', label:'转介与危机' },
    { tab:'toolbox',  label:'专业工具箱' }
  ],
  student: [
    { tab:'questionnaire', label:'心理问卷' },
    { tab:'record',        label:'日常记录' },
    { tab:'mine',          label:'我的结果' }
  ]
};

/* ---------------- 角色权限表（渲染前判权，不只靠隐藏按钮） ---------------- */
RB.PERMS = {
  teacher:   { counseling:false, cases:false, referralWrite:false, collect:true,  actions:true,  campus:false },
  counselor: { counseling:true,  cases:true,  referralWrite:true,  collect:false, actions:false, campus:true  },
  student:   { counseling:false, cases:false, referralWrite:false, collect:false, actions:false, campus:false }
};

RB.can = function (acc, key) {
  const p = RB.PERMS[acc && acc.role];
  return !!(p && p[key]);
};

/* 角色主题文案（顶栏与首页 hero 共用） */
RB.ROLE_META = {
  teacher: {
    chip:'班主任工作台',
    focus:'班上现在什么情况 · 我明天能做什么',
    hero:'你的关注点：<b>班上现在什么情况、我明天能做什么</b>。数据来自学生真实提交，AI 把数据翻译成可直接执行的班级管理动作。'
  },
  counselor: {
    chip:'心理教师工作台',
    focus:'这个孩子内心在发生什么 · 我该怎么陪他走出来',
    hero:'你的关注点：<b>这个学生内心在发生什么、我该怎么辅导</b>。数据是入口，AI 负责把信号翻译成个案概念化、辅导技术与会谈节奏。'
  }
};

/* ---------------- 心理学理论库（RAG 检索源） ---------------- */
RB.THEORIES = [
  {
    id:'T3', name:'留守儿童心理韧性模型', author:'国内本土研究（心理韧性框架）',
    cat:'发展', alias:['韧性','抗逆力','复原力','resilience','保护因子','留守儿童心理韧性'],
    keywords:['韧性','抗逆','保护因子','留守儿童','适应'],
    summary:'心理韧性由外部保护因子（家庭支持、师生关系、同伴接纳）与内部保护因子（自我效能、情绪调节、目标感）共同构成，可通过干预提升。',
    apply:'双线干预：外部补足支持网络（教师关注+同伴结对+定期家访），内部培养自我效能（设置可达成的小目标并即时肯定）。'
  },
  {
    id:'T4', name:'情绪 ABC 理论', author:'Ellis',
    cat:'情绪', alias:['ABC理论','理性情绪','不合理信念','REBT','情绪ABC'],
    keywords:['情绪','信念','挫折','易激惹','冲动'],
    summary:'A（诱发事件）经 B（信念系统）产生 C（情绪与行为结果）。改变信念可改变结果。',
    apply:'面对易激惹学生，先降温（情绪命名+生理调节），再回溯诱发事件与内在信念，最后协商替代行为。'
  },
  {
    id:'T5', name:'社会支持理论', author:'Cobb / Cohen',
    cat:'发展', alias:['社会支持','支持网络','同伴支持','孤立','归属感'],
    keywords:['支持','孤立','同伴','归属','社交退缩'],
    summary:'社会支持（情感性、工具性、信息性、评价性）缓冲压力对身心的负面影响，是心理健康的重要保护因素。',
    apply:'对社交退缩学生，设计低门槛的同伴合作任务，创造被需要、被接纳的体验，逐步扩大支持网络。'
  },
  {
    id:'T6', name:'马斯洛需求层次理论', author:'Maslow',
    cat:'发展', alias:['马斯洛','需求层次','需要层次','自我实现','缺失性需要'],
    keywords:['需求','安全','归属','尊重','自我实现'],
    summary:'安全、归属与尊重等基本需要未满足时，个体难以投入高层次的学习与成长活动。',
    apply:'排查学生是否存在睡眠、家庭安全、被欺凌等底层需要缺口；底层需要未解决前，学习问题不宜作为首要干预目标。'
  }
];

/* ---------------- 轻量化问卷（3 分钟版） ---------------- */
/* hard: true 表示该题命中即为高危硬触发（规则引擎兜底） */
/* ---------------- 心理健康筛查问卷（v2 · 12 题版） ----------------
 * 依据两个国际通用量表改编，均为 0-3 四级频率计分：
 *   抑郁分量表 6 题 ← PHQ-9（Kroenke 2001，9 条目中取判别力最强的 6 条）
 *   焦虑分量表 3 题 ← GAD-7（Spitzer 2006，7 条目中取核心 3 条）
 *   安全筛查 3 题   ← 分层设计（被动意念 / 具体计划 / 既往行为）
 *
 * 关键设计：安全题不参与总分，走独立通道分层触发。
 * 原 v1 用「q9 ≥1 即判红」，无法区分「偶尔闪过念头」与「已有具体计划」，
 * 会把偶发意念与真实高危混为一谈。PHQ-9 原量表第 9 条也只是计入总分的
 * 普通条目，>0 表示「需进一步评估」，而非直接定性。
 *
 * 分量表阈值按原量表 cut-off 等比折算：
 *   PHQ-9 5/10/15/20（满分 27）→ 6 题满分 18 → 3/7/10/13
 *   GAD-7 5/10/15（满分 21）  → 3 题满分 9  → 2/4/6
 * ---------------- */
RB.QUESTIONNAIRE = {
  version: 'v2',
  title: '心理健康快速筛查（近两周）',
  note: '共 12 题，约 4 分钟完成。答案无对错，请根据最近两周的真实感受作答。',
  options: [
    { v:0, label:'完全没有' },
    { v:1, label:'偶尔' },
    { v:2, label:'经常' },
    { v:3, label:'几乎每天' }
  ],
  /* part: dep 抑郁 / anx 焦虑 / safe 安全筛查（不计总分） */
  items: [
    { id:'d1', part:'dep',  text:'我对以前喜欢的事情提不起兴趣' },
    { id:'d2', part:'dep',  text:'我感到情绪低落、沮丧，或者看不到希望' },
    { id:'d3', part:'dep',  text:'我睡不好：难以入睡、容易醒，或者睡得太多' },
    { id:'d4', part:'dep',  text:'我觉得很累，没有力气' },
    { id:'d5', part:'dep',  text:'我觉得自己没用，或者让家人失望' },
    { id:'d6', part:'dep',  text:'我很难集中注意力，比如上课或写作业时' },

    { id:'a1', part:'anx',  text:'我感到紧张、不安，或者心里发慌' },
    { id:'a2', part:'anx',  text:'我控制不住地担心各种事情' },
    { id:'a3', part:'anx',  text:'我很难让自己放松下来' },

    { id:'s1', part:'safe', text:'我觉得活着没什么意思，或者希望自己消失' },
    { id:'s2', part:'safe', text:'我想过具体要怎么伤害自己' },
    { id:'s3', part:'safe', text:'过去一年里，我真的做过伤害自己的事' }
  ],
  /* 分量表分组，供学生端分区展示 */
  groups: [
    { part:'dep',  title:'最近的情绪和状态' },
    { part:'anx',  title:'紧张和担心' },
    { part:'safe', title:'安全情况', note:'这几题用来判断是否需要及时帮你，如实填写才能获得有效支持。' }
  ],
  /* 分量表严重度分档（含端点，从高到低匹配） */
  bands: {
    dep: [ { min:10, label:'中重度' }, { min:7, label:'中度' }, { min:3, label:'轻度' }, { min:0, label:'无' } ],
    anx: [ { min:6,  label:'重度'   }, { min:4, label:'中度' }, { min:2, label:'轻度' }, { min:0, label:'无' } ]
  }
};

/* ---------------- 旧版问卷（v1 · 10 题） ----------------
 * 仅用于给历史提交计分与复核，不再向学生展示。
 * 保留原样：改版后若用新题表去算旧作答，所有题都取不到值，
 * 分数会变 0，会把真实高危记录抹平成绿色。
 * ---------------- */
RB.QUESTIONNAIRE_V1 = {
  version: 'v1',
  title: '心理健康快速筛查（近两周）',
  note: '共 10 题，约 3 分钟完成。',
  options: [
    { v:0, label:'完全没有' },
    { v:1, label:'偶尔' },
    { v:2, label:'经常' },
    { v:3, label:'几乎每天' }
  ],
  items: [
    { id:'q1',  text:'我感到情绪低落、提不起劲',            dim:'情绪' },
    { id:'q2',  text:'我对以前喜欢的事情失去兴趣',          dim:'情绪' },
    { id:'q3',  text:'我难以入睡或睡不安稳',                dim:'睡眠' },
    { id:'q4',  text:'我觉得自己没有价值、不如别人',        dim:'自我' },
    { id:'q5',  text:'我担心考试或成绩，紧张到影响发挥',    dim:'焦虑' },
    { id:'q6',  text:'我不愿和同学来往，喜欢一个人待着',    dim:'社交' },
    { id:'q7',  text:'我容易烦躁、发脾气，控制不住',        dim:'情绪' },
    { id:'q8',  text:'我注意力难以集中，上课容易走神',      dim:'学业' },
    { id:'q9',  text:'我想过伤害自己',                      dim:'高危', hard:true },
    { id:'q10', text:'我觉得没有人能帮我',                  dim:'高危' }
  ]
};

/* ---------------- 日常记录可选的课堂行为标签 ---------------- */
RB.RECORD_TAGS = ['情绪低落', '易激惹', '走神', '社交退缩', '睡眠差', '作业拖延', '同伴冲突', '家庭变故', '状态平稳'];
