/* 验证手工录入弹窗：开/关、遮罩、Esc、提交、页面不再占位 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const WEB = path.join(__dirname, '..', 'web');
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const files = ['data.js', 'engine.js', 'ui.js', 'report.js', 'teacher.js', 'counselor.js', 'student.js', 'app.js'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0; const errs = [];
const ok = (n, c, x) => { if (c) pass++; else { fail++; errs.push(n + (x ? ' — ' + x : '')); } };
const text = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();

function boot() {
  const dom = new JSDOM(html, {
    url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true,
    beforeParse(w) {
      w.scrollTo = () => {}; w.alert = () => {}; w.confirm = () => true; w.print = () => {};
      w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
      w.fetch = async () => ({ ok: true, status: 200, json: async () => ({
        ok: true, updatedAt: Date.now(),
        stats: { total: 2, red: 1, yellow: 0, green: 1, submissions: 2 },
        students: [
          { user:'student1', name:'学生1', level:'red', score:9, tags:['情绪低落'], last:Date.now(), count:1 },
          { user:'student3', name:'学生3', level:'green', score:1, tags:[], last:Date.now(), count:1 }
        ],
        submissions: [
          { user:'student1', name:'学生1', type:'questionnaire', level:'red', riskType:'情绪困扰', createdAt:Date.now(), answers:{q1:3} }
        ]
      }) });
    }
  });
  const w = dom.window;
  for (const f of files) w.eval(fs.readFileSync(path.join(WEB, 'js', f), 'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return w;
}

(async () => {
  const w = boot();
  w.document.getElementById('u').value = 'banzhuren123';
  w.document.getElementById('p').value = '12345678';
  w.document.getElementById('loginForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(250);
  const RB = w.RB;
  const doc = w.document;

  RB.route('actions'); await sleep(50);

  /* 1. 页面里不再有大块录入卡片 */
  const view = doc.getElementById('view-actions');
  const inlineCard = [...view.querySelectorAll('.card')].some(c => c.querySelector('#actText'));
  ok('台账页内不再有内嵌录入卡片', !inlineCard);
  /* 今日建议已迁入台账页顶部，成为首个卡片；三栏待执行/逾期/已完成紧随其后 */
  /* 标题里可能带操作按钮（如已完成栏的清空/恢复），只取标题文字本身 */
  const headText = h => [...h.childNodes]
    .filter(n => n.nodeType === 3 || (n.nodeType === 1 && !/^(BUTTON|SPAN)$/.test(n.tagName)))
    .map(n => n.textContent).join('').replace(/\s+/g,'');
  const cardHeads = [...view.querySelectorAll('.card h3')].map(headText);
  ok('台账页首个卡片是今日建议', /^今日建议/.test(cardHeads[0] || ''), cardHeads.join(' | '));
  ok('建议区之后是待执行三栏',
     cardHeads[1] === '待执行' && cardHeads[2] === '已逾期' && cardHeads[3] === '已完成',
     cardHeads.join(' | '));

  /* 2. 入口按钮在标题栏 */
  const openBtn = doc.getElementById('btnOpenAct');
  ok('标题栏有手工录入入口', !!openBtn && text(openBtn).includes('手工录入'));

  /* 3. 默认隐藏 */
  const mask = doc.getElementById('actModal');
  ok('弹窗默认隐藏', mask && !mask.classList.contains('open'));

  /* 4. 点击打开 */
  openBtn.click(); await sleep(40);
  ok('点击后弹窗打开', mask.classList.contains('open'));
  ok('打开时锁定滚动', doc.body.style.overflow === 'hidden', doc.body.style.overflow);

  /* 5. 点遮罩关闭 */
  mask.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(30);
  ok('点遮罩可关闭', !mask.classList.contains('open'));
  ok('关闭后恢复滚动', doc.body.style.overflow === '');

  /* 6. 点弹窗本体不关闭 */
  openBtn.click(); await sleep(30);
  doc.querySelector('.modal-box').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(30);
  ok('点弹窗本体不关闭', mask.classList.contains('open'));

  /* 7. Esc 关闭 */
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(30);
  ok('Esc 可关闭', !mask.classList.contains('open'));

  /* 8. 取消按钮关闭 */
  openBtn.click(); await sleep(30);
  doc.getElementById('actModalCancel').click(); await sleep(30);
  ok('取消按钮可关闭', !mask.classList.contains('open'));

  /* 9. 空内容不提交 */
  openBtn.click(); await sleep(30);
  doc.getElementById('actText').value = '   ';
  doc.getElementById('btnAddAct').click(); await sleep(30);
  ok('空内容不提交且弹窗不关', mask.classList.contains('open'));
  ok('空内容未写入台账', !JSON.parse(w.localStorage.getItem('rb_actions') || '[]').length);

  /* 10. 正常提交 */
  doc.getElementById('actText').value = '弹窗录入测试动作';
  doc.getElementById('actStu').value = '学生1';
  /* 用相对日期：写死日期会随时间流逝变成"已逾期"，
     导致动作落到逾期栏而断言却查待执行栏（测试随时间腐烂） */
  const dueD = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  doc.getElementById('actDue').value = dueD;
  doc.getElementById('btnAddAct').click(); await sleep(50);

  ok('提交后弹窗关闭', !mask.classList.contains('open'));
  const acts = JSON.parse(w.localStorage.getItem('rb_actions'));
  const created = acts.find(a => a.text === '弹窗录入测试动作');
  ok('动作已写入台账', !!created);
  ok('source=manual', created && created.source === 'manual', created && created.source);
  ok('对象/截止已保存', created && created.target === '学生1' && created.due === dueD,
     created && (created.target + '|' + created.due));

  /* 11. 提交后表单已清空 */
  openBtn.click(); await sleep(30);
  ok('再次打开时内容已清空', doc.getElementById('actText').value === '' && doc.getElementById('actStu').value === '');
  doc.getElementById('actModalCancel').click(); await sleep(20);

  /* 12. 新动作出现在待执行 */
  ok('新动作显示在待执行列表', text(doc.getElementById('actTodo')).includes('弹窗录入测试动作'));
  ok('新动作带手工录入标签', text(doc.getElementById('actTodo')).includes('教师 · 手工录入'));

  /* 13. 切走再回来，弹窗绑定不重复、入口仍可用 */
  RB.route('dash'); await sleep(30);
  RB.route('actions'); await sleep(30);
  doc.getElementById('btnOpenAct').click(); await sleep(30);
  ok('切换视图后入口仍可用', mask.classList.contains('open'));
  doc.getElementById('actModalCancel').click(); await sleep(20);

  console.log('\n===== 手工录入弹窗测试 =====');
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  if (fail) { errs.forEach(e => console.log('  ✗ ' + e)); process.exitCode = 1; }
  else console.log('全部通过 ✅');
})();
