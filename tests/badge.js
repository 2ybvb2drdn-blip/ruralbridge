/* 标签栏角标：出现 / 变红 / 完成减少 / 全部完成后消失
 *
 * 背景：概览页底部原先有两个跳转按钮，其中一个带待办计数。
 * 那两个按钮与标签栏重复，已删除；计数迁到标签栏「行动台账」上做角标。
 * 本测试保证这个唯一的任务信号不会消失。
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

/* 角标只挂在「行动台账」标签上 */
function badge(w) {
  return w.document.querySelector('#tabs button[data-tab="actions"] .nav-badge');
}

(async () => {
  console.log('===== 标签栏角标测试 =====');

  const w = boot();
  const d = w.document;
  await login(w);

  /* ---------- 1. 概览页底部按钮已删除 ---------- */
  ok('底部 gotoActions 已删除', !d.getElementById('gotoActions'));
  ok('底部 gotoClassAI 已删除', !d.getElementById('gotoClassAI'));

  /* ---------- 2. 无待办时不显示角标 ---------- */
  ok('无待办时无角标', badge(w) === null, JSON.stringify(badge(w) && badge(w).textContent));

  /* ---------- 3. 有 2 条待办 → 角标显示 2 ---------- */
  const now = Date.now();
  const today0 = new Date(new Date().toDateString()).getTime();
  w.localStorage.setItem('rb_actions', JSON.stringify([
    { id:'a1', text:'红色学生上报心理教师', dim:'个体', target:'学生1',
      source:'ai_student', priority:'P1', due:'', createdAt:now, done:false, doneAt:0 },
    { id:'a2', text:'本周情绪主题班会', dim:'课堂', target:'全班',
      source:'ai_class', priority:'P2', due:'', createdAt:now - 1000, done:false, doneAt:0 }
  ]));
  w.RB.route('dash'); await sleep(250);

  const b1 = badge(w);
  ok('有待办时出现角标', !!b1);
  ok('角标显示 2', b1 && b1.textContent === '2', b1 && b1.textContent);
  ok('无逾期时角标不加 over 类', b1 && !b1.classList.contains('over'),
     b1 && b1.className);
  ok('无逾期时标签不加 has-overdue',
     !d.querySelector('#tabs button[data-tab="actions"]').classList.contains('has-overdue'));
  ok('角标 title 说明条数', b1 && /2 条待办/.test(b1.title || ''), b1 && b1.title);

  /* ---------- 4. 加入一条逾期 → 角标变红 ---------- */
  const yest = new Date(today0 - 3 * 86400000).toISOString().slice(0, 10);
  w.localStorage.setItem('rb_actions', JSON.stringify([
    { id:'a1', text:'红色学生上报心理教师', dim:'个体', target:'学生1',
      source:'ai_student', priority:'P1', due:'', createdAt:now, done:false, doneAt:0 },
    { id:'a2', text:'本周情绪主题班会', dim:'课堂', target:'全班',
      source:'ai_class', priority:'P2', due:'', createdAt:now - 1000, done:false, doneAt:0 },
    { id:'a3', text:'逾期未做的家访', dim:'家校', target:'学生1',
      source:'manual', priority:'P1', due:yest, createdAt:now - 5000, done:false, doneAt:0 }
  ]));
  w.RB.renderChrome ? w.RB.renderChrome() : null;
  w.RB.route('dash'); await sleep(250);

  const b2 = badge(w);
  ok('逾期后角标显示 3', b2 && b2.textContent === '3', b2 && b2.textContent);
  ok('逾期后角标加 over 类', b2 && b2.classList.contains('over'), b2 && b2.className);
  ok('逾期后标签加 has-overdue',
     d.querySelector('#tabs button[data-tab="actions"]').classList.contains('has-overdue'));
  ok('逾期时 title 说明逾期数', b2 && /1 条已逾期/.test(b2.title || ''), b2 && b2.title);

  /* ---------- 5. 完成一条（非逾期）→ 角标自动减少，不需切页面 ---------- */
  w.RB.route('actions'); await sleep(250);
  const doneBtn = d.querySelector('#actTodo [data-act-done]');
  ok('待执行栏有可完成项', !!doneBtn);

  const before = badge(w) ? badge(w).textContent : null;
  if (doneBtn) { doneBtn.click(); await sleep(250); }
  const b3 = badge(w);
  ok('完成后角标自动减少', before === '3' && b3 && b3.textContent === '2',
     before + ' -> ' + (b3 && b3.textContent));
  ok('逾期仍在时角标仍红', b3 && b3.classList.contains('over'), b3 && b3.className);

  /* ---------- 6. 完成逾期那条 → 角标不再红 ---------- */
  const ovBtn = d.querySelector('#actOverdue [data-act-done]');
  ok('逾期栏有可完成项', !!ovBtn);
  if (ovBtn) { ovBtn.click(); await sleep(250); }
  const b4 = badge(w);
  ok('逾期清零后角标显示 1', b4 && b4.textContent === '1', b4 && b4.textContent);
  ok('逾期清零后不再红', b4 && !b4.classList.contains('over'), b4 && b4.className);
  ok('逾期清零后 has-overdue 移除',
     !d.querySelector('#tabs button[data-tab="actions"]').classList.contains('has-overdue'));

  /* ---------- 7. 全部完成 → 角标消失 ---------- */
  const rest = d.querySelectorAll('#actTodo [data-act-done]');
  rest.forEach(x => x.click());
  await sleep(300);
  ok('全部完成后角标消失', badge(w) === null, JSON.stringify(badge(w) && badge(w).textContent));

  /* ---------- 8. 切标签时角标也会刷新 ---------- */
  w.localStorage.setItem('rb_actions', JSON.stringify([
    { id:'z1', text:'新任务', dim:'个体', target:'全班',
      source:'manual', priority:'P2', due:'', createdAt:now, done:false, doneAt:0 }
  ]));
  w.RB.route('students'); await sleep(200);
  const b5 = badge(w);
  ok('切换标签后角标刷新为 1', b5 && b5.textContent === '1', b5 && b5.textContent);

  /* ---------- 9. 台账数据损坏时不崩 ---------- */
  w.localStorage.setItem('rb_actions', 'not-json');
  let crashed = false;
  try { w.RB.renderChrome ? w.RB.renderChrome() : null; w.RB.route('dash'); }
  catch (e) { crashed = true; }
  ok('台账数据损坏不崩', !crashed);

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  if (!fail) console.log('全部通过 ✅');
})().catch(e => { console.error('崩溃:', e.stack || e.message); process.exit(1); });
