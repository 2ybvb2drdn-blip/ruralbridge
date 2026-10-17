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
    id:'T1', name:'依恋理论', author:'Bowlby / Ainsworth',
    keywords:['亲子分离','留守儿童','安全感','回避','依恋'],
    summary:'早期亲子依恋关系的质量影响个体终生的情绪调节与社会交往模式。亲子长期分离易形成不安全依恋，表现为回避亲密、过度警觉或情绪压抑。',
    apply:'针对留守儿童，优先建立稳定的"替代性支持关系"（固定教师/结对同伴），通过可预期的陪伴降低不安全感。'
  },
  {
    id:'T2', name:'认知行为疗法（CBT）', author:'Beck / Ellis',
    keywords:['消极认知','自我否定','情绪低落','自动化思维','不合理信念'],
    summary:'情绪困扰多源于对事件的认知解读而非事件本身。识别并修正"自动化负性思维"可有效缓解情绪问题。',
    apply:'用"事件—想法—情绪"三栏记录法，引导学生觉察并检验负性想法，替换为更平衡的解释。'
  },
  {
    id:'T3', name:'留守儿童心理韧性模型', author:'国内本土研究（心理韧性框架）',
    keywords:['韧性','抗逆','保护因子','留守儿童','适应'],
    summary:'心理韧性由外部保护因子（家庭支持、师生关系、同伴接纳）与内部保护因子（自我效能、情绪调节、目标感）共同构成，可通过干预提升。',
    apply:'双线干预：外部补足支持网络（教师关注+同伴结对+定期家访），内部培养自我效能（设置可达成的小目标并即时肯定）。'
  },
  {
    id:'T4', name:'情绪 ABC 理论', author:'Ellis',
    keywords:['情绪','信念','挫折','易激惹','冲动'],
    summary:'A（诱发事件）经 B（信念系统）产生 C（情绪与行为结果）。改变信念可改变结果。',
    apply:'面对易激惹学生，先降温（情绪命名+生理调节），再回溯诱发事件与内在信念，最后协商替代行为。'
  },
  {
    id:'T5', name:'社会支持理论', author:'Cobb / Cohen',
    keywords:['支持','孤立','同伴','归属','社交退缩'],
    summary:'社会支持（情感性、工具性、信息性、评价性）缓冲压力对身心的负面影响，是心理健康的重要保护因素。',
    apply:'对社交退缩学生，设计低门槛的同伴合作任务，创造被需要、被接纳的体验，逐步扩大支持网络。'
  },
  {
    id:'T6', name:'马斯洛需求层次理论', author:'Maslow',
    keywords:['需求','安全','归属','尊重','自我实现'],
    summary:'安全、归属与尊重等基本需要未满足时，个体难以投入高层次的学习与成长活动。',
    apply:'排查学生是否存在睡眠、家庭安全、被欺凌等底层需要缺口；底层需要未解决前，学习问题不宜作为首要干预目标。'
  }
];

/* ---------------- 轻量化问卷（3 分钟版） ---------------- */
/* hard: true 表示该题命中即为高危硬触发（规则引擎兜底） */
RB.QUESTIONNAIRE = {
  title: '心理健康快速筛查（近两周）',
  note: '共 10 题，约 3 分钟完成。答案无对错，请根据真实感受作答。',
  options: [
    { v:0, label:'完全没有' },
    { v:1, label:'偶尔' },
    { v:2, label:'经常' },
    { v:3, label:'几乎每天' }
  ],
  items: [
    { id:'q1',  text:'我感到情绪低落、提不起劲',            dim:'情绪', hard:false },
    { id:'q2',  text:'我对以前喜欢的事情失去兴趣',          dim:'情绪', hard:false },
    { id:'q3',  text:'我难以入睡或睡不安稳',                dim:'睡眠', hard:false },
    { id:'q4',  text:'我觉得自己没有价值、不如别人',        dim:'自我', hard:false },
    { id:'q5',  text:'我担心考试或成绩，紧张到影响发挥',    dim:'焦虑', hard:false },
    { id:'q6',  text:'我不愿和同学来往，喜欢一个人待着',    dim:'社交', hard:false },
    { id:'q7',  text:'我容易烦躁、发脾气，控制不住',        dim:'情绪', hard:false },
    { id:'q8',  text:'我注意力难以集中，上课容易走神',      dim:'学业', hard:false },
    { id:'q9',  text:'我想过伤害自己',                      dim:'高危', hard:true  },
    { id:'q10', text:'我觉得没有人能帮我',                  dim:'高危', hard:false }
  ]
};

/* ---------------- 日常记录可选的课堂行为标签 ---------------- */
RB.RECORD_TAGS = ['情绪低落', '易激惹', '走神', '社交退缩', '睡眠差', '作业拖延', '同伴冲突', '家庭变故', '状态平稳'];
