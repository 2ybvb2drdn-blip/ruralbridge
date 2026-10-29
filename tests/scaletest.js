/* 量表测评端到端：教师派发 → 学生填写 → 自动计分 → 结果回填 */
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
  stats: { total: 3, red: 1, yellow: 1, green: 1, submissions: 3 },
  students: [
    { user:'student1', name:'学生1', level:'red', score:9, riskType:'情绪困扰', tags:['情绪困扰'], last:'10-28', createdAt:Date.now() },
    { user:'student2', name:'学生2', level:'yellow', score:5, riskType:'学业压力', tags:[], last:'10-28', createdAt:Date.now() },
    { user:'student3', name:'学生3', level:'green', score:1, riskType:'—', tags:[], last:'10-28', createdAt:Date.now() }
  ],
  submissions: []
};

/* 内存版 scale_tasks 后端，模拟 D1 */
function makeDb() {
  const tasks = [];
  return {
    tasks,
    handler: async (url, opt) => {
      const u = String(url);
      if (u.indexOf('/api/data/scales') === -1) return null;
      const method = (opt && opt.method) || 'GET';
      if (method === 'GET') {
        const m = u.match(/user=([^&]+)/);
        const user = m ? decodeURIComponent(m[1]) : '';
        const list = user ? tasks.filter(t => t.user === user) : tasks;
        return { ok: true, tasks: list, stats: {} };
      }
      const body = JSON.parse((opt && opt.body) || '{}');
      if (body.action === 'assign') {
        const exist = tasks.find(t => t.user === body.user && t.scaleId === body.scaleId && t.status === 'pending');
        if (exist) return { ok: true, id: exist.id, existed: true };
        const t = { id:'st-' + tasks.length, user: body.user, name: body.name,
          scaleId: body.scaleId, assignedAt: Date.now(), due: body.due || '',
          status:'pending', answers:null, score:0, level:'', detail:'', submittedAt:0,
          oneOnOne: body.scaleId === 'C-SSRS' };
        tasks.push(t);
        return { ok: true, id: t.id, existed: false };
      }
      if (body.action === 'submit') {
        const t = tasks.find(x => x.id === body.id);
        if (!t) return { ok:false, error:'任务不存在' };
        t.status = 'done';
        t.answers = body.answers;
        t.score = body.result.score;
        t.level = body.result.level;
        t.detail = body.result.detail;
        t.submittedAt = Date.now();
        return { ok: true, id: body.id, level: body.result.level };
      }
      if (body.action === 'revoke') {
        const i = tasks.findIndex(x => x.id === body.id);
        if (i >= 0) tasks.splice(i, 1);
        return { ok: true };
      }
      return { ok: false, error: 'unknown action' };
    }
  };
}

function boot(db) {
  const dom = new JSDOM(html, { url:'http://localhost/', runScripts:'outside-only', pretendToBeVisual:true,
    beforeParse(w) {
      w.scrollTo = () => {}; w.print = () => {};
      w.alert = (m) => { w.__alerts = (w.__alerts || []).concat([m]); };
      w.confirm = () => true;
      w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
      if (!w.TextEncoder) w.TextEncoder = TextEncoder;
      if (!w.TextDecoder) w.TextDecoder = TextDecoder;
      if (typeof w.CompressionStream === 'undefined') w.CompressionStream = CompressionStream;
      if (typeof w.Response === 'undefined') w.Response = Response;
      w.AbortController = AbortController;
      w.fetch = async (url, opt) => {
        const r = await db.handler(url, opt);
        if (r !== null) return { ok:true, status:200, json: async () => r };
        return { ok:true, status:200, json: async () => DATA };
      };
    }});
  const w = dom.window;
  for (const f of files) w.eval(fs.readFileSync(path.join(WEB, 'js', f), 'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return w;
}

async function login(w, u, p) {
  const d = w.document;
  d.getElementById('u').value = u;
  d.getElementById('p').value = p;
  d.getElementById('loginForm').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true }));
  await sleep(300);
}

(async () => {
  console.log('===== 量表测评端到端测试 =====');
  const db = makeDb();

  /* ---------- 1. 题库完整性 ---------- */
  const w0 = boot(db);
  const B = w0.RB.scaleBank;
  ok('题库有 4 个量表', B.list().length === 4, String(B.list().length));
  ['PHQ-9','GAD-7','ISI','C-SSRS'].forEach(id =>
    ok('含 ' + id, !!B.all.find(x => x.id === id)));
  const phq = B.all.find(x => x.id === 'PHQ-9');
  ok('PHQ-9 有 9 道真题', phq.items.length === 9, String(phq.items.length));
  ok('题目有实际文本', phq.items.every(i => i.text && i.text.length > 4));
  ok('ISI 每题独立选项', B.all.find(x=>x.id==='ISI').items.every(i => Array.isArray(i.options)));
  ok('C-SSRS 标记一对一施测', !!B.all.find(x=>x.id==='C-SSRS').warn);

  /* ---------- 2. 计分正确性 ---------- */
  const all0 = {}; phq.items.forEach(i => all0[i.id] = 0);
  ok('PHQ-9 全 0 → green', B.score('PHQ-9', all0).level === 'green');
  ok('PHQ-9 全 0 总分 0', B.score('PHQ-9', all0).score === 0);

  const mid = { p1:2,p2:2,p3:1,p4:2,p5:1,p6:2,p7:1,p8:0,p9:0 };  // 11 分
  const rMid = B.score('PHQ-9', mid);
  ok('PHQ-9 11 分 → 中度', rMid.score === 11 && rMid.label.indexOf('中度') !== -1,
     rMid.score + ' / ' + rMid.label);
  ok('PHQ-9 11 分 → yellow', rMid.level === 'yellow', rMid.level);

  const sui = { p1:1,p2:1,p3:0,p4:0,p5:0,p6:0,p7:0,p8:0,p9:2 };
  const rSui = B.score('PHQ-9', sui);
  ok('自伤条目经常 → red', rSui.level === 'red', rSui.level);
  ok('自伤升级后标签不再说「无」', rSui.label.indexOf('无或极轻') === -1, rSui.label);
  ok('自伤升级标记清晰', rSui.escalated === true);

  const suiOcc = { p1:0,p2:0,p3:0,p4:0,p5:0,p6:0,p7:0,p8:0,p9:1 };
  ok('自伤条目偶尔 → 至少 yellow', B.score('PHQ-9', suiOcc).level === 'yellow',
     B.score('PHQ-9', suiOcc).level);

  /* C-SSRS 走条目递进 */
  const cssrs = { s1:1,s2:0,s3:0,s4:0,s5:0,s6:0 };
  ok('C-SSRS 1 级 → yellow', B.score('C-SSRS', cssrs).level === 'yellow',
     B.score('C-SSRS', cssrs).level);
  const cssrs5 = { s1:1,s2:1,s3:1,s4:1,s5:1,s6:0 };
  const r5 = B.score('C-SSRS', cssrs5);
  ok('C-SSRS 5 级 → red', r5.level === 'red', r5.level);
  ok('C-SSRS 5 级标签含计划', r5.label.indexOf('计划') !== -1, r5.label);
  const cssrs0 = { s1:0,s2:0,s3:0,s4:0,s5:0,s6:0 };
  ok('C-SSRS 全否 → green', B.score('C-SSRS', cssrs0).level === 'green');

  const miss = B.score('PHQ-9', { p1:1 });
  ok('缺题返回错误', !!miss.error, miss.error);

  /* ---------- 3. 教师端派发 ---------- */
  const w = boot(db);
  await login(w, 'xinli123', '12345678');
  w.RB.state.user = { user:'xinli123', name:'李老师', role:'counselor', roleName:'学校心理教师', klass:'全校' };
  w.RB.route('toolbox');
  await sleep(400);
  const d = w.document;

  ok('派发面板已渲染', !!d.getElementById('scalePanel'));
  ok('有学生下拉', !!d.getElementById('spStu'));
  ok('有量表下拉', !!d.getElementById('spScale'));
  ok('有派发按钮', !!d.getElementById('spAssign'));
  const scaleOpts = [...d.querySelectorAll('#spScale option')].map(o => o.value);
  ok('下拉列出 4 个量表', scaleOpts.length === 4, scaleOpts.join(','));
  ok('初始提示「还没有派发过」', text(d.getElementById('spList')).indexOf('还没有派发') !== -1,
     text(d.getElementById('spList')));
  ok('施测通用原则仍在', text(d.getElementById('scalePanel')).indexOf('筛查不等于诊断') !== -1);

  /* 派发 PHQ-9 给学生1 */
  d.getElementById('spStu').value = 'student1';
  d.getElementById('spScale').value = 'PHQ-9';
  d.getElementById('spAssign').click();
  await sleep(600);
  ok('任务已写入后端', db.tasks.length === 1, String(db.tasks.length));
  ok('任务绑定学生1', db.tasks[0] && db.tasks[0].user === 'student1');
  ok('任务量表为 PHQ-9', db.tasks[0] && db.tasks[0].scaleId === 'PHQ-9');
  ok('列表显示已派发', text(d.getElementById('spList')).indexOf('学生1') !== -1,
     text(d.getElementById('spList')));

  /* 重复派发不产生第二条 */
  d.getElementById('spAssign').click();
  await sleep(500);
  ok('重复派发已去重', db.tasks.length === 1, String(db.tasks.length));

  /* ---------- 4. 学生端填写 ---------- */
  const w2 = boot(db);
  await login(w2, 'student1', '12345678');
  w2.RB.state.user = { user:'student1', name:'学生1', role:'student', roleName:'学生', klass:'初一(2)班' };
  w2.RB.route('questionnaire');
  await sleep(600);
  const d2 = w2.document;

  ok('学生端出现待填区', !!d2.getElementById('stuScaleTasks'));
  const stxt = text(d2.getElementById('stuScaleTasks'));
  ok('提示有 1 份待填', stxt.indexOf('1 份待填') !== -1, stxt.slice(0, 80));
  ok('显示量表名', stxt.indexOf('PHQ-9') !== -1, stxt.slice(0, 100));
  ok('有开始填写按钮', !!d2.querySelector('#stuScaleTasks [data-sst-open]'));

  /* 展开填写 */
  d2.querySelector('#stuScaleTasks [data-sst-open]').click();
  await sleep(300);
  const items = d2.querySelectorAll('#stuScaleTasks .sst-item');
  ok('展开后显示 9 道题', items.length === 9, String(items.length));
  ok('提交按钮初始禁用',
     d2.querySelector('#stuScaleTasks [data-sst-submit]').disabled === true);

  /* 逐题作答（造一个中度：11 分） */
  const ans = { p1:2,p2:2,p3:1,p4:2,p5:1,p6:2,p7:1,p8:0,p9:0 };
  Object.keys(ans).forEach(k => {
    const el = d2.querySelector(`#stuScaleTasks input[data-ti="${k}"][value="${ans[k]}"]`);
    if (el) { el.checked = true; el.onchange && el.onchange(); }
  });
  await sleep(200);
  ok('全部作答后提交按钮可用',
     d2.querySelector('#stuScaleTasks [data-sst-submit]').disabled === false);

  d2.querySelector('#stuScaleTasks [data-sst-submit]').click();
  await sleep(800);
  ok('任务状态变为 done', db.tasks[0].status === 'done', db.tasks[0].status);
  ok('后端记录总分 11', db.tasks[0].score === 11, String(db.tasks[0].score));
  ok('后端记录等级 yellow', db.tasks[0].level === 'yellow', db.tasks[0].level);
  ok('提交后待填区清空', text(d2.getElementById('stuScaleTasks')).indexOf('份待填') === -1,
     text(d2.getElementById('stuScaleTasks')).slice(0, 80));

  /* ---------- 5. 教师端看到结果 ---------- */
  const w3 = boot(db);
  await login(w3, 'xinli123', '12345678');
  w3.RB.state.user = { user:'xinli123', name:'李老师', role:'counselor', klass:'全校' };
  w3.RB.route('toolbox');
  await sleep(500);
  const d3 = w3.document;
  const ltxt = text(d3.getElementById('spList'));
  ok('教师端显示已提交', ltxt.indexOf('学生1') !== -1, ltxt.slice(0, 100));
  ok('教师端显示等级', ltxt.indexOf('黄色') !== -1, ltxt.slice(0, 120));
  ok('教师端显示总分', ltxt.indexOf('11') !== -1, ltxt.slice(0, 120));
  ok('已完成项无撤回按钮', !d3.querySelector('#spList [data-sp-revoke]'));

  /* ---------- 6. C-SSRS 高危场景 ---------- */
  db.tasks.length = 0;
  const w4 = boot(db);
  await login(w4, 'xinli123', '12345678');
  w4.RB.state.user = { user:'xinli123', name:'李老师', role:'counselor', klass:'全校' };
  w4.RB.route('toolbox');
  await sleep(400);
  const d4 = w4.document;
  d4.getElementById('spStu').value = 'student1';
  d4.getElementById('spScale').value = 'C-SSRS';
  d4.getElementById('spScale').dispatchEvent(new w4.Event('change'));
  await sleep(150);
  ok('选 C-SSRS 时显示一对一施测警告',
     text(d4.getElementById('spTip')).indexOf('一对一') !== -1,
     text(d4.getElementById('spTip')));
  d4.getElementById('spAssign').click();
  await sleep(600);
  ok('C-SSRS 已派发', db.tasks.length === 1, String(db.tasks.length));
  ok('C-SSRS 任务标记一对一', db.tasks[0].oneOnOne === true);

  /* 学生填写 C-SSRS 到 3 级 */
  const w5 = boot(db);
  await login(w5, 'student1', '12345678');
  w5.RB.state.user = { user:'student1', name:'学生1', role:'student', klass:'初一(2)班' };
  w5.RB.route('questionnaire');
  await sleep(600);
  const d5 = w5.document;
  d5.querySelector('#stuScaleTasks [data-sst-open]').click();
  await sleep(250);
  const cs = { s1:1, s2:1, s3:1, s4:0, s5:0, s6:0 };
  Object.keys(cs).forEach(k => {
    const el = d5.querySelector(`#stuScaleTasks input[data-ti="${k}"][value="${cs[k]}"]`);
    if (el) { el.checked = true; el.onchange && el.onchange(); }
  });
  await sleep(200);
  d5.querySelector('#stuScaleTasks [data-sst-submit]').click();
  await sleep(800);
  ok('C-SSRS 3 级判 red', db.tasks[0].level === 'red', db.tasks[0].level);
  ok('C-SSRS 详情含条目', String(db.tasks[0].detail).indexOf('s3') !== -1, db.tasks[0].detail);

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  if (!fail) console.log('全部通过 OK');
})().catch(e => { console.error('崩溃:', e.stack || e.message); process.exit(1); });
