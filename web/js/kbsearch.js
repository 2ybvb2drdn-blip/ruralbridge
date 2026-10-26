/* ============================================================
 * 乡育心桥 · RuralBridge — 理论库检索
 *
 * 为什么重写检索：
 *   原实现是对 name/keywords/summary/apply 做 indexOf 子串匹配，
 *   实测 60 个心理教师常用词只命中 4 个（7%）。
 *   连「焦虑」「抑郁」「考试焦虑」都搜不到——
 *   因为没有任何条目把「焦虑」写进关键词，而子串匹配无法联想。
 *
 * 新检索三层：
 *   1) 同义词扩展：查「考试焦虑」→ 展开为「考试 / 焦虑 / 怯场 / 发挥失常…」
 *   2) 多字段加权：name > alias > keywords > summary > apply
 *   3) 分类过滤 + 空结果兜底提示（而不是干巴巴的"未找到"）
 *
 * 设计取舍：
 *   不上向量检索。理论库只有 84 条，全量打分是微秒级；
 *   向量检索需要模型与网络，与"断网可查"冲突。
 * ============================================================ */

(function () {
  'use strict';
  const RB = window.RB || (window.RB = {});

  /* 同义词表：左为常用说法，右为需要一起展开的词
     目的是让「搜不到」变成「能联想到」 */
  const SYN = {
    '焦虑': ['紧张', '担忧', '心慌', '不安', '考试焦虑', '社交焦虑', '恐慌'],
    '紧张': ['焦虑', '担忧', '心慌', '不安'],
    '抑郁': ['情绪低落', '无望', '自责', '兴趣减退', '悲观', '消沉'],
    '情绪低落': ['抑郁', '难过', '低落', '悲观'],
    '自伤': ['自我伤害', '割伤', '划手', 'NSSI', '自残'],
    '自杀': ['轻生', '结束生命', '意念', '遗书', '危机'],
    '霸凌': ['欺凌', '校园暴力', '排挤', '起外号', '网络欺凌'],
    '欺凌': ['霸凌', '校园暴力', '排挤'],
    '厌学': ['拒学', '不上学', '逃学', '缺勤', '休学'],
    '网瘾': ['手机成瘾', '游戏成瘾', '沉迷', '短视频', '屏幕'],
    '手机': ['网瘾', '游戏', '短视频', '沉迷', '屏幕时间'],
    '留守': ['留守儿童', '隔代教养', '亲子分离', '务工'],
    '单亲': ['离异', '父母离婚', '重组家庭'],
    '离异': ['单亲', '父母离婚', '重组家庭'],
    '学习': ['学业', '成绩', '考试', '作业', '上课'],
    '学业': ['学习', '成绩', '考试压力', '作业'],
    '成绩': ['学业', '学习', '考试'],
    '考试': ['考试焦虑', '怯场', '发挥失常', '成绩'],
    '人际': ['同伴', '社交', '交友', '关系', '孤立'],
    '社交': ['人际', '同伴', '交友', '退缩', '害羞'],
    '孤立': ['排挤', '排斥', '同伴', '社交'],
    '愤怒': ['易激惹', '冲动', '发脾气', '攻击', '暴躁'],
    '易激惹': ['愤怒', '冲动', '暴躁', '攻击'],
    '失眠': ['睡眠', '入睡', '早醒', '熬夜'],
    '睡眠': ['失眠', '入睡', '熬夜'],
    '创伤': ['PTSD', '闪回', '应激', '噩梦', '灾后'],
    '哀伤': ['丧亲', '死亡', '丧失', '悲伤', '告别'],
    '丧亲': ['哀伤', '死亡', '丧失'],
    '多动': ['ADHD', '注意缺陷', '注意力', '坐不住', '冲动'],
    '注意力': ['ADHD', '多动', '走神', '专注'],
    '自闭': ['孤独症', 'ASD', '阿斯伯格', '谱系'],
    '孤独症': ['自闭症', 'ASD', '阿斯伯格', '谱系'],
    '强迫': ['OCD', '反复检查', '洗手', '仪式'],
    '双相': ['躁郁', '躁狂', '情绪高涨', 'bipolar'],
    '进食': ['厌食', '暴食', '催吐', '节食', '身材'],
    '完美主义': ['自我要求高', '怕失败', '高标准', '拖延'],
    '拖延': ['完美主义', '启动困难', '磨蹭'],
    '动机': ['不想学', '没动力', '内在动机', '厌学'],
    '逆反': ['对抗', '阻抗', '不服管', '叛逆'],
    '叛逆': ['逆反', '对抗', '阻抗'],
    '家暴': ['家庭暴力', '虐待', '打骂', '体罚'],
    '虐待': ['家暴', '家庭暴力', '忽视', '体罚'],
    '手机成瘾': ['网瘾', '游戏', '沉迷', '屏幕'],
    '危机': ['自杀', '干预', '紧急', '转介', '上报'],
    '转介': ['就医', '精神科', '上报', '危机'],
    '标签': ['污名', '贴标签', '自我实现预言'],
    '期望': ['罗森塔尔', '皮格马利翁', '自我实现预言'],
    '损失厌恶': ['损失规避', '前景理论', '得失'],
    '破窗': ['破窗效应', '秩序', '规则'],
    '吊桥': ['吊桥效应', '唤醒', '归因'],
    '野马': ['野马结局', '情绪失控', '愤怒'],
    '从众': ['羊群效应', '同伴压力', '随大流'],
    '旁观者': ['责任分散', '见死不救', '求助'],
    '第一印象': ['首因效应', '印象'],
    '光环': ['晕轮效应', '以偏概全'],
    '乐观': ['解释风格', '悲观', '韧性'],
    '韧性': ['抗逆力', '复原力', '保护因子', 'resilience'],
    '正念': ['冥想', '觉察', '呼吸', 'mindfulness'],
    '放松': ['呼吸', '肌肉放松', '渐进'],
    '沟通': ['谈话', '倾听', '共情', '提问'],
    '共情': ['倾听', '理解', '人本', '无条件积极关注']
  };

  /* 字段权重：名称命中权重最高 */
  const W = { name: 12, alias: 8, keywords: 6, summary: 2, apply: 2, cat: 3 };

  function norm(s) {
    return String(s || '').toLowerCase().trim();
  }

  /* 把查询词展开为同义词集合（含原词） */
  function expand(q) {
    const base = norm(q);
    const set = Object.create(null);
    set[base] = 1;
    /* 精确同义词 */
    Object.keys(SYN).forEach(function (k) {
      const kn = norm(k);
      if (kn === base) SYN[k].forEach(function (v) { set[norm(v)] = 1; });
      /* 查询词包含该键（如「考试焦虑」含「焦虑」）也展开。
         注意要把键本身也加进去——否则「考试焦虑」不会命中关键词
         写着「焦虑」的条目（如焦虑的认知模型）。 */
      else if (base.length >= 2 && base.indexOf(kn) !== -1) {
        set[kn] = 1;
        SYN[k].forEach(function (v) { set[norm(v)] = 1; });
      }
      /* 键包含查询词（如查「社交焦」→ 展开到「社交」这一族） */
      else if (base.length >= 3 && kn.indexOf(base) !== -1) {
        set[kn] = 1;
        SYN[k].forEach(function (v) { set[norm(v)] = 1; });
      }
    });
    /* 去掉空串与过短项 */
    return Object.keys(set).filter(function (t) { return t.length >= 1; });
  }

  /* 单条目对一组词的得分 */
  function scoreEntry(t, terms) {
    const name = norm(t.name);
    const alias = (t.alias || []).map(norm).join(' ');
    const kws = (t.keywords || []).map(norm).join(' ');
    const sum = norm(t.summary);
    const app = norm(t.apply);
    const cat = norm(t.cat);

    let total = 0;
    const hitFields = [];

    terms.forEach(function (term) {
      if (!term) return;
      let s = 0;
      if (name.indexOf(term) !== -1) s += W.name;
      if (alias.indexOf(term) !== -1) s += W.alias;
      if (kws.indexOf(term) !== -1) s += W.keywords;
      if (sum.indexOf(term) !== -1) s += W.summary;
      if (app.indexOf(term) !== -1) s += W.apply;
      if (cat.indexOf(term) !== -1) s += W.cat;
      /* 完全等于名称额外加分，避免长摘要稀释 */
      if (name === term) s += 20;
      total += s;
      if (s > 0) hitFields.push(term);
    });

    return { score: total, matched: hitFields };
  }

  /**
   * 检索
   * @param {string} q 查询词
   * @param {object} opt { cat: 分类过滤, limit: 返回上限 }
   * @returns {{ hits: Array, terms: Array, empty: boolean }}
   */
  function search(q, opt) {
    const o = opt || {};
    const limit = o.limit || 20;
    const raw = String(q || '').trim();
    if (!raw) return { hits: [], terms: [], empty: true };

    const terms = expand(raw);
    let pool = RB.THEORIES || [];
    if (o.cat) pool = pool.filter(function (t) { return t.cat === o.cat; });

    const scored = pool.map(function (t) {
      const r = scoreEntry(t, terms);
      return { t: t, score: r.score, matched: r.matched };
    }).filter(function (x) { return x.score > 0; })
      .sort(function (a, b) {
        return b.score - a.score ||
          String(a.t.name).localeCompare(String(b.t.name), 'zh');
      })
      .slice(0, limit);

    return {
      hits: scored,
      terms: terms,
      empty: scored.length === 0
    };
  }

  /* 分类列表（含每类数量），供界面做筛选 */
  function categories() {
    const m = Object.create(null);
    (RB.THEORIES || []).forEach(function (t) {
      const c = t.cat || '未分类';
      m[c] = (m[c] || 0) + 1;
    });
    const order = ['疗法', '发展', '情绪', '效应', '议题', '危机', '群体', '未分类'];
    return order.filter(function (c) { return m[c]; })
      .map(function (c) { return { cat: c, n: m[c] }; });
  }

  /* 推荐词：界面空状态时给可点的示例，避免"不知道该搜什么" */
  const SUGGEST = ['考试焦虑', '留守儿童', '自伤', '校园欺凌', '亲子冲突',
    '手机成瘾', '损失厌恶', '破窗效应', '吊桥效应', '罗森塔尔效应',
    '危机干预', '社交退缩', 'ADHD', '失眠', '哀伤辅导'];

  RB.kb = { search: search, expand: expand, categories: categories, SUGGEST: SUGGEST, SYN: SYN };
})();
