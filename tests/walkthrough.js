/* 全流程走查：三角色登录 → 逐页渲染 → 交互 → 无 JS 异常
 *
 * 这是「从头到尾跑一遍」的自动化版本。与各专项测试的分工：
 *   专项测试（regress / toolbox / scaletest ...）验证具体逻辑是否正确
 *   本文件只验证「整个应用能不能正常跑起来、有没有报错、页面有没有内容」
 *
 * 重点抓两类问题：
 *   1. JS 运行时异常（任何一个 view 抛错都会让页面局部空白）
 *   2. 渲染后内容为空（结构在但没数据，等于白屏）
 * 另外顺带验证深色主题确实生效（背景是深色、正文是浅色）。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const WEB = path.join(__dirname, '..', 'web');
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(WEB, 'css', 'styles.css'), 'utf8');
const files = ['data.js','theories-a.js','theories-b.js','theories-c.js','theories-d.js','theories-e.js',
  'kbsearch.js','scalebank.js','engine.js','ui.js','xlsx.js','pdffont.js','pdfdoc.js',
  'pdfreport.js','report.js','teacher.js','counselor.js','student.js','app.js'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const cnt = { pass: 0, fail: 0 };
function ok(n, c, x) {
  if (c) cnt.pass++;
  else { cnt.fail++; console.log('  X ' + n + (x ? ' -- ' + x : '')); }
}
const text = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();

const now = Date.now(), DAY = 86400000;
const DATA = {
  ok: true, updatedAt: now,
  stats: { total: 3, red: 1, yellow: 1, green: 1, submissions: 8 },
  students: [
    { user:'student1', name:'学生1', level:'red', score:9, riskType:'情绪困扰',
      tags:['情绪困扰'], last:'10-30', count:3, createdAt: now },
    { user:'student2', name:'学生2', level:'yellow', score:5, riskType:'学业压力',
      tags:['学业压力'], last:'10-30', count:3, createdAt: now },
    { user:'student3', name:'学生3', level:'green', score:1, riskType:'—',
      tags:[], last:'10-30', count:2, createdAt: now }
  ],
  submissions: [
    { id:'a1', user:'student1', name:'学生1', type:'questionnaire', level:'red', score:9,
      riskType:'情绪困扰', evidence:['睡眠困难','情绪低落'], steps:[{t:'联系家长',d:'告知情况'}],
      talk:['你可以随时找我'], answers:{d1:2,d2:2}, text:'', createdAt: now - 2*DAY },
    { id:'a2', user:'student1', name:'学生1', type:'record', level:'yellow', score:0,
      riskType:'情绪困扰', evidence:[], answers:{}, text:'最近睡不着，不想上学', createdAt: now - DAY },
    { id:'b1', user:'student2', name:'学生2', type:'questionnaire', level:'yellow', score:5,
      riskType:'学业压力', evidence:['学业压力'], steps:[], talk:[], answers:{d1:1}, text:'',
      createdAt: now - 2*DAY },
    { id:'b2', user:'student2', name:'学生2', type:'questionnaire', level:'green', score:2,
      riskType:'—', evidence:[], steps:[], talk:[], answers:{d1:0}, text:'', createdAt: now - DAY },
    { id:'c1', user:'student3', name:'学生3', type:'questionnaire', level:'green', score:1,
      riskType:'—', evidence:[], steps:[], talk:[], answers:{d1:0}, text:'', createdAt: now - DAY }
  ]
};

function boot() {
  const errors = [];
  const dom = new JSDOM(html, { url:'http://localhost/', runScripts:'outside-only', pretendToBeVisual:true,
    beforeParse(w) {
      w.scrollTo = () => {}; w.print = () => {};
      w.alert = () => {}; w.confirm = () => true;
      w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
      w.fetch = async (url) => {
        const u = String(url);
        if (u.indexOf('/api/data/scales') !== -1) {
          return { ok:true, status:200, json: async () => ({ ok:true, tasks:[], stats:{} }) };
        }
        return { ok:true, status:200, json: async () => DATA };
      };
      if (!w.TextEncoder) w.TextEncoder = TextEncoder;
      if (!w.TextDecoder) w.TextDecoder = TextDecoder;
      if (typeof w.CompressionStream === 'undefined') w.CompressionStream = CompressionStream;
      if (typeof w.Response === 'undefined') w.Response = Response;
      w.AbortController = AbortController;
      w.console.error = (...a) => errors.push(a.join(' '));
      w.addEventListener('error', e => errors.push('ERROR: ' + (e.message || e)));
    }});
  const w = dom.window;
  for (const f of files) w.eval(fs.readFileSync(path.join(WEB, 'js', f), 'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return { w, errors };
}

async function login(w, user, pass) {
  const d = w.document;
  d.getElementById('u').value = user;
  d.getElementById('p').value = pass;
  d.getElementById('loginForm').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true }));
  await sleep(320);
}

const ROLE_VIEWS = {
  teacher: ['dash','classai','students','collect','actions','report'],
  counselor: ['queue','plan','cases','climate','referral','toolbox'],
  student: ['questionnaire','record','mine']
};
const ROLE_LOGIN = { teacher:['banzhuren123','王老师'], counselor:['xinli123','李老师'], student:['student1','学生1'] };

(async () => {
  console.log('===== 全流程走查 =====');

  /* ---------- 0. 深色主题确实生效 ---------- */
  {
    const { w } = boot();
    ok('CSS 定义 --bg 深色', /--bg:\s*#0d131b/i.test(CSS), '');
    ok('CSS 定义 --ink 浅色', /--ink:\s*#dde5ee/i.test(CSS), '');
    ok('CSS 定义 --card 深色', /--card:\s*#151f2b/i.test(CSS), '');
    ok('有 theme-color 深色声明', /name="theme-color"\s+content="#0d131b"/i.test(html));
    ok('声明 color-scheme: dark', /name="color-scheme"\s+content="dark"/i.test(html));
    /* body 背景不再引用浅色。
       注意：CSS 里有两条 body 规则（一条只管 margin/padding），
       必须遍历全部取含 background 的那条，不能只匹配第一条。 */
    const bodyRules = [...CSS.matchAll(/(?:^|\n)body\s*\{([^}]*)\}/g)].map(m => m[1]);
    const bodyMain = bodyRules.find(r => /background/.test(r)) || '';
    ok('body 使用 var(--bg)', /background:\s*var\(--bg\)/.test(bodyMain),
       bodyMain.slice(0, 90));
    ok('body 文字用 var(--ink)', /color:\s*var\(--ink\)/.test(bodyMain),
       bodyMain.slice(0, 90));
    /* 登录页背景是深色渐变 */
    const loginRule = CSS.match(/\.login-wrap\s*\{[^}]*\}/);
    ok('登录页背景非浅色', loginRule && !/#f[0-9a-f]{5}/i.test(loginRule[0]),
       loginRule && loginRule[0].slice(0, 120));
  }

  /* ---------- 1. 三角色逐一走查 ---------- */
  for (const role of Object.keys(ROLE_VIEWS)) {
    const [user, name] = ROLE_LOGIN[role];
    const { w, errors } = boot();
    const d = w.document;
    await login(w, user, '12345678');

    ok(`[${role}] 登录成功`, !!w.RB.state.user, JSON.stringify(w.RB.state.user && w.RB.state.user.user));
    ok(`[${role}] 顶栏显示身份`, text(d.getElementById('whoName')).indexOf(name) !== -1 ||
       text(d.getElementById('whoName')).length > 0, text(d.getElementById('whoName')));

    const tabs = d.querySelectorAll('#tabs button');
    ok(`[${role}] 标签栏 ${ROLE_VIEWS[role].length} 个`, tabs.length === ROLE_VIEWS[role].length,
       String(tabs.length));

    for (const v of ROLE_VIEWS[role]) {
      /* 用标签栏点击切换，模拟真实用户路径（而不是直接调 route） */
      const btn = d.querySelector(`#tabs button[data-tab="${v}"]`);
      ok(`[${role}] 有「${v}」标签`, !!btn);
      if (!btn) continue;
      btn.click();
      await sleep(180);

      const view = d.getElementById('view-' + v);
      ok(`[${role}/${v}] 视图已激活`, view && view.classList.contains('active'),
         view && view.className);
      ok(`[${role}/${v}] 有渲染内容`, view && view.innerHTML.length > 120,
         view ? String(view.innerHTML.length) : 'null');
      /* 关键指标：不是白屏。文本长度是比 innerHTML 长度更强的信号 */
      ok(`[${role}/${v}] 有可见文字`, view && text(view).length > 30,
         view ? String(text(view).length) : 'null');
    }

    ok(`[${role}] 全程无 JS 异常`, errors.length === 0, errors.slice(0, 2).join(' | '));
  }

  /* ---------- 2. 关键交互串一遍（班主任） ---------- */
  {
    const { w, errors } = boot();
    const d = w.document;
    await login(w, 'banzhuren123', '12345678');

    /* 台账：手工录入一条 */
    d.querySelector('#tabs button[data-tab="actions"]').click();
    await sleep(200);
    const openBtn = d.getElementById('btnOpenAct');
    ok('台账有手工录入入口', !!openBtn);
    if (openBtn) {
      openBtn.click(); await sleep(150);
      ok('弹窗已打开', d.getElementById('actModal').classList.contains('open'));
      d.getElementById('actText').value = '走查录入的动作';
      d.getElementById('actStu').value = '全班';
      d.getElementById('btnAddAct').click();
      await sleep(250);
      ok('动作已写入台账', text(d.getElementById('actTodo')).indexOf('走查录入的动作') !== -1 ||
         JSON.parse(w.localStorage.getItem('rb_actions') || '[]').length === 1,
         text(d.getElementById('actTodo')).slice(0, 60));
    }

    /* 报告页：切周期 */
    d.querySelector('#tabs button[data-tab="report"]').click();
    await sleep(250);
    const periods = [...d.querySelectorAll('#classReport [data-rep-period]')];
    ok('报告页有周期按钮', periods.length === 3, String(periods.length));
    if (periods.length === 3) {
      periods[2].click(); await sleep(220);
      ok('切到「全部」成功', periods[2].classList.contains('on') ||
         [...d.querySelectorAll('#classReport [data-rep-period]')]
           .find(x => x.dataset.repPeriod === 'all').classList.contains('on'));
    }

    /* 学生个体报告开关 */
    const stuBtn = d.querySelector('#classReport [data-rep-stu]');
    ok('报告页有学生入口', !!stuBtn);
    if (stuBtn) {
      stuBtn.click(); await sleep(250);
      ok('学生报告面板打开', d.getElementById('stuReportHost').innerHTML.length > 200);
      const close = d.querySelector('#stuReportHost [data-stu-close]');
      if (close) { close.click(); await sleep(150); }
    }

    ok('班主任交互全程无异常', errors.length === 0, errors.slice(0, 2).join(' | '));
  }

  /* ---------- 3. 心理教师：知识库 + 量表派发 ---------- */
  {
    const { w, errors } = boot();
    const d = w.document;
    await login(w, 'xinli123', '12345678');
    d.querySelector('#tabs button[data-tab="toolbox"]').click();
    await sleep(250);

    /* 知识库搜索 */
    const q = d.getElementById('ragQ');
    ok('知识库有搜索框', !!q);
    if (q) {
      q.value = '破窗效应';
      q.dispatchEvent(new w.Event('input'));
      await sleep(200);
      ok('搜索有结果', d.getElementById('ragOut').querySelectorAll('.theory').length > 0,
         text(d.getElementById('ragOut')).slice(0, 60));
    }

    /* 量表派发面板 */
    ok('有派发面板', !!d.getElementById('scalePanel'));
    ok('有量表下拉', !!d.getElementById('spScale'));
    const opts = [...d.querySelectorAll('#spScale option')].map(o => o.value);
    ok('四个量表可选', ['PHQ-9','GAD-7','ISI','C-SSRS'].every(x => opts.includes(x)),
       opts.join(','));

    /* 转介单生成 */
    d.querySelector('#tabs button[data-tab="referral"]').click();
    await sleep(250);
    const gen = d.getElementById('btnRefGen');
    ok('有生成转介单按钮', !!gen);
    if (gen) {
      d.getElementById('refStu').value = 'student1';
      gen.click(); await sleep(250);
      ok('转介单已生成', text(d.getElementById('refBody')).indexOf('转介单') !== -1,
         text(d.getElementById('refBody')).slice(0, 60));
    }

    ok('心理教师交互全程无异常', errors.length === 0, errors.slice(0, 2).join(' | '));
  }

  /* ---------- 4. 学生端：答题流程 ---------- */
  {
    const { w, errors } = boot();
    const d = w.document;
    await login(w, 'student1', '12345678');
    d.querySelector('#tabs button[data-tab="questionnaire"]').click();
    await sleep(300);

    const items = d.querySelectorAll('#qItems .q-item');
    ok('问卷渲染 12 题', items.length === 12, String(items.length));

    /* 全部选第一个选项 */
    const radios = [...d.querySelectorAll('#qItems input[type=radio]')];
    const firsts = {};
    radios.forEach(r => { if (!firsts[r.name]) { firsts[r.name] = r; } });
    Object.values(firsts).forEach(r => { r.checked = true; r.onchange && r.onchange(); });
    await sleep(200);
    ok('进度显示满格', text(d.getElementById('qProg')).indexOf('12') !== -1,
       text(d.getElementById('qProg')));

    /* 日常记录 */
    d.querySelector('#tabs button[data-tab="record"]').click();
    await sleep(250);
    ok('记录页有输入框', !!d.querySelector('textarea.rec'));

    /* 我的结果 */
    d.querySelector('#tabs button[data-tab="mine"]').click();
    await sleep(250);
    ok('结果页有内容', text(d.getElementById('view-mine')).length > 30,
       String(text(d.getElementById('view-mine')).length));

    ok('学生端交互全程无异常', errors.length === 0, errors.slice(0, 2).join(' | '));
  }

  /* ---------- 5. 登出与切换角色 ---------- */
  {
    const { w, errors } = boot();
    const d = w.document;
    await login(w, 'banzhuren123', '12345678');
    const logout = d.getElementById('btnLogout') || d.querySelector('[id*="ogout"]');
    ok('有登出入口', !!logout);
    if (logout) {
      logout.click(); await sleep(250);
      ok('登出后回到登录页', d.getElementById('login').style.display !== 'none' ||
         w.RB.state.user === null, JSON.stringify(w.RB.state.user));
    }
    ok('登出过程无异常', errors.length === 0, errors.slice(0, 2).join(' | '));
  }

  console.log('\n通过 ' + cnt.pass + ' / 失败 ' + cnt.fail);
  if (!cnt.fail) console.log('全部通过 OK');
  process.exit(cnt.fail ? 1 : 0);
})().catch(e => { console.error('崩溃:', e.stack || e.message); process.exit(1); });
