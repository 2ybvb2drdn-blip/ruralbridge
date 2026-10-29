/* 行动台账：三栏滚动容器 / 优先级排序 / 筛选 / 角标联动
 *
 * 这三件事互相耦合：筛选会改变可见条数，但角标统计的是全部未完成，
 * 不能跟着筛选变。这里把它们放在一起验证，避免改一处坏另一处。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const WEB = path.join(__dirname, '..', 'web');
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const files = ['data.js','theories-a.js','theories-b.js','theories-c.js','theories-d.js','theories-e.js',
  'kbsearch.js','scales.js','scalebank.js','engine.js','ui.js','xlsx.js','pdffont.js','pdfdoc.js',
  'pdfreport.js','report.js','teacher.js','counselor.js','student.js','app.js'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(n, c, x) { if (c) pass++; else { fail++; console.log('  X ' + n + (x ? ' -- ' + x : '')); } }
const text = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();

const DATA = {
  ok: true, updatedAt: Date.now(),
  stats: { total: 2, red: 1, yellow: 0, green: 1, submissions: 2 },
  students: [
    { user:'student1', name:'学生1', level:'red', score:9, riskType:'情绪困扰', tags:['情绪困扰'], last:'10-29', createdAt:Date.now() },
    { user:'student2', name:'学生2', level:'green', score:1, riskType:'—', tags:[], last:'10-29', createdAt:Date.now() }
  ],
  submissions: []
};

function boot() {
  const dom = new JSDOM(html, { url:'http://localhost/', runScripts:'outside-only', pretendToBeVisual:true,
    beforeParse(w) {
      w.scrollTo = () => {}; w.alert = () => {}; w.confirm = () => true; w.print = () => {};
      w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
      w.fetch = async () => ({ ok:true, status:200, json: async () => DATA });
      if (!w.TextEncoder) w.TextEncoder = TextEncoder;
      if (!w.TextDecoder) w.TextDecoder = TextDecoder;
      if (typeof w.CompressionStream === 'undefined') w.CompressionStream = CompressionStream;
      if (typeof w.Response === 'undefined') w.Response = Response;
      w.AbortController = AbortController;
    }});
  const w = dom.window;
  for (const f of files) w.eval(fs.readFileSync(path.join(WEB, 'js', f), 'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return w;
}

async function login(w) {
  const d = w.document;
  d.getElementById('u').value = 'banzhuren123';
  d.getElementById('p').value = '12345678';
  d.getElementById('loginForm').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true }));
  await sleep(300);
}

const priOf = el => el.dataset.pri;

(async () => {
  console.log('===== 台账容器与优先级测试 =====');

  const w = boot();
  const d = w.document;
  await login(w);

  /* ---------- 1. 三栏滚动容器 ---------- */
  ['actTodo', 'actOverdue', 'actDone'].forEach(id => {
    const el = d.getElementById(id);
    ok(id + ' 存在', !!el);
    ok(id + ' 带 act-scroll 类', el && /act-scroll/.test(el.className), el && el.className);
  });
  ok('今日建议容器存在', !!d.getElementById('actSuggest'));
  ok('筛选栏容器存在', !!d.getElementById('actFilter'));

  /* ---------- 2. 优先级排序：P1 在前 ---------- */
  const now = Date.now();
  const today0 = new Date(new Date().toDateString()).getTime();
  const yest = new Date(today0 - 3 * 86400000).toISOString().slice(0, 10);
  w.localStorage.setItem('rb_actions', JSON.stringify([
    { id:'p3', text:'常规事项', dim:'课堂', target:'全班', source:'manual',
      priority:'P3', createdAt:now - 2000, done:false, doneAt:0 },
    { id:'p1', text:'红色学生上报心理教师', dim:'个体', target:'学生1', source:'ai_student',
      priority:'P1', createdAt:now, done:false, doneAt:0 },
    { id:'p2', text:'本周情绪主题班会', dim:'课堂', target:'全班', source:'ai_class',
      priority:'P2', createdAt:now - 1000, done:false, doneAt:0 },
    { id:'ov', text:'逾期家访', dim:'家校', target:'学生1', source:'manual',
      priority:'P1', due:yest, createdAt:now - 3000, done:false, doneAt:0 },
    { id:'dn', text:'已完成的事项', dim:'个体', target:'全班', source:'manual',
      priority:'P2', createdAt:now - 4000, done:true, doneAt:now - 3500 }
  ]));
  w.RB.route('actions'); await sleep(300);

  const todoItems = [...d.querySelectorAll('#actTodo .act-item')];
  ok('待执行 3 条', todoItems.length === 3, String(todoItems.length));
  ok('待执行按 P1→P3 排序',
     todoItems.map(priOf).join(',') === 'P1,P2,P3',
     todoItems.map(priOf).join(','));
  ok('逾期 1 条', d.querySelectorAll('#actOverdue .act-item').length === 1,
     String(d.querySelectorAll('#actOverdue .act-item').length));
  ok('已完成 1 条', d.querySelectorAll('#actDone .act-item').length === 1,
     String(d.querySelectorAll('#actDone .act-item').length));
  ok('逾期项不混入待执行',
     !text(d.getElementById('actTodo')).includes('逾期家访'));

  /* ---------- 3. 筛选 chips ---------- */
  const chips = [...d.querySelectorAll('#actFilter .pri-chip')];
  ok('有 4 个筛选 chip', chips.length === 4, String(chips.length));
  ok('含「全部」', chips.some(c => c.dataset.priFilter === ''));
  ok('含 P1/P2/P3', ['P1','P2','P3'].every(k => chips.some(c => c.dataset.priFilter === k)));
  ok('默认选中「全部」', chips[0].classList.contains('on'), chips[0].className);
  ok('chip 带未完成数量', /P1[\s\S]*2|2/.test(text(chips[1])), text(chips[1]));

  /* ---------- 4. 筛选生效 ---------- */
  chips.find(c => c.dataset.priFilter === 'P1').click();
  await sleep(250);
  const p1Items = [...d.querySelectorAll('#actTodo .act-item')];
  ok('筛选 P1 后只剩 1 条', p1Items.length === 1, String(p1Items.length));
  ok('筛选出来的确实是 P1', p1Items[0] && priOf(p1Items[0]) === 'P1',
     p1Items[0] && priOf(p1Items[0]));
  ok('P1 chip 高亮',
     [...d.querySelectorAll('#actFilter .pri-chip')]
       .find(c => c.dataset.priFilter === 'P1').classList.contains('on'));

  /* ---------- 5. 筛选状态角标不受影响 ---------- */
  const b = d.querySelector('#tabs button[data-tab="actions"] .nav-badge');
  ok('筛选时角标仍统计全部未完成 = 4', b && b.textContent === '4', b && b.textContent);

  /* ---------- 6. 切回全部 ---------- */
  [...d.querySelectorAll('#actFilter .pri-chip')]
    .find(c => c.dataset.priFilter === '').click();
  await sleep(250);
  ok('切回全部后 3 条', d.querySelectorAll('#actTodo .act-item').length === 3,
     String(d.querySelectorAll('#actTodo .act-item').length));

  /* ---------- 7. 完成一条 → 角标实时减少（saveActs 触发刷新） ---------- */
  const before = d.querySelector('#tabs button[data-tab="actions"] .nav-badge').textContent;
  const btn = d.querySelector('#actTodo [data-act-done]');
  ok('有可完成按钮', !!btn);
  if (btn) { btn.click(); await sleep(300); }
  const after = d.querySelector('#tabs button[data-tab="actions"] .nav-badge');
  ok('完成后角标减少', before === '4' && after && after.textContent === '3',
     before + ' -> ' + (after && after.textContent));

  /* ---------- 8. 今日建议加入台账 ---------- */
  {
    const w2 = boot();
    await login(w2);
    w2.localStorage.setItem('rb_actions', '[]');
    w2.RB.route('actions'); await sleep(300);
    const d2 = w2.document;
    const quick = d2.querySelector('#actSuggest [data-quick-add]');
    ok('红色学生时有今日建议', !!quick, text(d2.getElementById('actSuggest')).slice(0, 60));
    if (quick) {
      /* 记下被点击那一条的文案。注意页面可能同时有多条建议
         （红色学生上报 + 未提交提醒），只能断言「这一条」消失，
         不能断言所有建议都消失。 */
      const clickedText = quick.dataset.quickAdd.split('|')[0];
      quick.click(); await sleep(300);
      const acts = JSON.parse(w2.localStorage.getItem('rb_actions'));
      ok('建议已加入台账', acts.length === 1, String(acts.length));
      ok('加入的那条不再重复显示',
         !text(d2.getElementById('actSuggest')).includes(clickedText),
         '应为已移除：' + clickedText + ' | 实际：' + text(d2.getElementById('actSuggest')).slice(0, 80));
    }
  }

  /* ---------- 9. 空台账不崩 ---------- */
  {
    const w3 = boot();
    await login(w3);
    w3.localStorage.setItem('rb_actions', '[]');
    let crashed = false;
    try { w3.RB.route('actions'); } catch (e) { crashed = true; }
    await sleep(200);
    ok('空台账不崩', !crashed);
    ok('空台账有待执行提示',
       text(w3.document.getElementById('actTodo')).length > 0);
  }

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  if (!fail) console.log('全部通过 ✅');
})().catch(e => { console.error('崩溃:', e.stack || e.message); process.exit(1); });
