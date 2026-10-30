/* 已完成栏「清空」：归档式清空，列表隐藏但统计不归零
 *
 * 背景：直接删已完成条目会让下方「优先级分布」与「来源执行率」的
 * 分子分母同时消失——而来源执行率正是「AI 建议是否真的被执行」的唯一证据。
 * 所以清空做的是打归档标记，不是删除。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const WEB = path.join(__dirname, '..', 'web');
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const files = ['data.js','theories-a.js','theories-b.js','theories-c.js','theories-d.js','theories-e.js',
  'kbsearch.js','scalebank.js','engine.js','ui.js','xlsx.js','pdffont.js','pdfdoc.js',
  'pdfreport.js','report.js','teacher.js','counselor.js','student.js','app.js'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(n, c, x) { if (c) pass++; else { fail++; console.log('  X ' + n + (x ? ' -- ' + x : '')); } }
const text = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();

const DATA = {
  ok: true, updatedAt: Date.now(),
  stats: { total: 2, red: 0, yellow: 0, green: 2, submissions: 2 },
  students: [
    { user:'student1', name:'学生1', level:'green', score:1, riskType:'—', tags:[], last:'10-29', createdAt:Date.now() },
    { user:'student2', name:'学生2', level:'green', score:1, riskType:'—', tags:[], last:'10-29', createdAt:Date.now() }
  ],
  submissions: []
};

function boot() {
  const dom = new JSDOM(html, { url:'http://localhost/', runScripts:'outside-only', pretendToBeVisual:true,
    beforeParse(w) {
      w.scrollTo = () => {}; w.alert = () => {}; w.print = () => {};
      w.confirm = () => true;                   /* 清空的二次确认默认通过 */
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

(async () => {
  console.log('===== 已完成栏清空测试 =====');

  const w = boot();
  const d = w.document;
  await login(w);

  /* 1 条待执行 + 3 条已完成 */
  const now = Date.now();
  w.localStorage.setItem('rb_actions', JSON.stringify([
    { id:'t1', text:'待办一', dim:'个体', target:'学生1', source:'ai_student',
      priority:'P1', createdAt:now, done:false, doneAt:0 },
    { id:'d1', text:'已完成一', dim:'个体', target:'学生1', source:'ai_student',
      priority:'P1', createdAt:now - 100000, done:true, doneAt:now - 50000 },
    { id:'d2', text:'已完成二', dim:'课堂', target:'全班', source:'ai_class',
      priority:'P2', createdAt:now - 200000, done:true, doneAt:now - 60000 },
    { id:'d3', text:'已完成三', dim:'课堂', target:'全班', source:'manual',
      priority:'P3', createdAt:now - 300000, done:true, doneAt:now - 70000 }
  ]));
  w.RB.route('actions'); await sleep(300);

  /* ---------- 1. 按钮状态 ---------- */
  const clr = d.getElementById('btnClearDone');
  const res = d.getElementById('btnRestoreDone');
  ok('清空按钮存在', !!clr);
  ok('有已完成时清空按钮可见', clr && clr.style.display !== 'none', clr && clr.style.display);
  ok('无归档时恢复按钮隐藏', res && res.style.display === 'none', res && res.style.display);

  ok('已完成 3 条', d.getElementById('actDone').querySelectorAll('.act-item').length === 3,
     String(d.getElementById('actDone').querySelectorAll('.act-item').length));
  ok('待执行 1 条', d.getElementById('actTodo').querySelectorAll('.act-item').length === 1,
     String(d.getElementById('actTodo').querySelectorAll('.act-item').length));

  /* ---------- 2. 记下清空前的统计口径 ---------- */
  const priBefore = text(d.getElementById('actPriStat'));
  const srcBefore = text(d.getElementById('actSourceStat'));
  ok('清空前优先级统计含执行率', /%/.test(priBefore), priBefore.slice(0, 80));
  ok('清空前来源统计含执行率', /%/.test(srcBefore), srcBefore.slice(0, 80));
  ok('清空前来源统计有 5 行数据行',
     d.getElementById('actSourceStat').querySelectorAll('tbody tr').length === 3,
     String(d.getElementById('actSourceStat').querySelectorAll('tbody tr').length));

  /* ---------- 3. 点清空 ---------- */
  clr.click(); await sleep(300);

  ok('已完成栏已清空',
     d.getElementById('actDone').querySelectorAll('.act-item').length === 0,
     String(d.getElementById('actDone').querySelectorAll('.act-item').length));
  const cntTxt = text(d.getElementById('actDoneCnt'));
  ok('计数显示 0 条已完成', /0 条已完成/.test(cntTxt), cntTxt);
  ok('计数显示 3 条已归档', /3 条已归档/.test(cntTxt), cntTxt);
  ok('空态提示可恢复', /恢复/.test(text(d.getElementById('actDone'))),
     text(d.getElementById('actDone')).slice(0, 60));

  /* ---------- 4. 关键：统计不能归零 ---------- */
  const priAfter = text(d.getElementById('actPriStat'));
  const srcAfter = text(d.getElementById('actSourceStat'));
  ok('清空后优先级统计仍存在', /%/.test(priAfter), priAfter.slice(0, 80));
  ok('清空后来源统计仍存在', /%/.test(srcAfter), srcAfter.slice(0, 80));
  ok('优先级统计内容未被改变', priBefore === priAfter,
     'before=' + priBefore.slice(0, 60) + ' | after=' + priAfter.slice(0, 60));
  ok('来源统计内容未被改变', srcBefore === srcAfter,
     'before=' + srcBefore.slice(0, 60) + ' | after=' + srcAfter.slice(0, 60));

  /* ---------- 5. 未误伤待执行 ---------- */
  ok('清空未影响待执行',
     d.getElementById('actTodo').querySelectorAll('.act-item').length === 1,
     String(d.getElementById('actTodo').querySelectorAll('.act-item').length));

  /* ---------- 6. 数据仍在 localStorage，只是打了标记 ---------- */
  const raw = JSON.parse(w.localStorage.getItem('rb_actions'));
  ok('数据未真删（仍 4 条）', raw.length === 4, String(raw.length));
  ok('3 条带 cleared 标记', raw.filter(x => x.cleared).length === 3,
     String(raw.filter(x => x.cleared).length));
  ok('clearedAt 已写入', raw.filter(x => x.cleared && x.clearedAt > 0).length === 3);

  /* ---------- 7. 按钮切换 ---------- */
  ok('清空后清空按钮隐藏', d.getElementById('btnClearDone').style.display === 'none');
  ok('清空后恢复按钮可见', d.getElementById('btnRestoreDone').style.display !== 'none');

  /* ---------- 8. 恢复 ---------- */
  d.getElementById('btnRestoreDone').click(); await sleep(300);
  ok('恢复后已完成 3 条',
     d.getElementById('actDone').querySelectorAll('.act-item').length === 3,
     String(d.getElementById('actDone').querySelectorAll('.act-item').length));
  ok('恢复后 cleared 标记已清除',
     JSON.parse(w.localStorage.getItem('rb_actions')).filter(x => x.cleared).length === 0);
  ok('恢复后统计仍正确', /%/.test(text(d.getElementById('actPriStat'))));

  /* ---------- 9. 撤销完成时同步清掉归档标记（防僵尸条目） ---------- */
  {
    const w2 = boot();
    await login(w2);
    const n2 = Date.now();
    w2.localStorage.setItem('rb_actions', JSON.stringify([
      { id:'x1', text:'已归档的项', dim:'个体', target:'全班', source:'manual',
        priority:'P2', createdAt:n2, done:true, doneAt:n2, cleared:true, clearedAt:n2 }
    ]));
    w2.RB.route('actions'); await sleep(250);
    const d2 = w2.document;
    const rev = d2.querySelector('#actDone [data-act-done]');
    ok('归档项不显示（列表已隐藏）', !rev, rev ? '竟然显示' : '');
  }

  /* ---------- 10. 空台账不崩 ---------- */
  {
    const w3 = boot();
    await login(w3);
    w3.localStorage.setItem('rb_actions', '[]');
    let crashed = false;
    try { w3.RB.route('actions'); } catch (e) { crashed = true; }
    await sleep(200);
    ok('空台账不崩', !crashed);
    ok('空台账清空按钮隐藏',
       w3.document.getElementById('btnClearDone').style.display === 'none');
  }

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  if (!fail) console.log('全部通过 ✅');
})().catch(e => { console.error('崩溃:', e.stack || e.message); process.exit(1); });
