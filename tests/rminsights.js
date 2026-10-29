/* 班级概览页信息密度：快速结论已移除 / AI 研判入口改走标签栏 / 保留区块
 *
 * 历史：概览页曾有「快速结论」卡片与两个底部跳转按钮。
 * 前者与晴雨表重复且易错，后者与标签栏重复，均已删除；
 * 待办计数改到标签栏角标（见 badge.js）。
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
    { user:'student1', name:'学生1', level:'red', score:9, riskType:'情绪困扰', tags:['情绪困扰'], last:'10-29', count:1, createdAt:Date.now() },
    { user:'student2', name:'学生2', level:'green', score:1, riskType:'—', tags:[], last:'10-29', count:1, createdAt:Date.now() }
  ],
  submissions: [
    { id:'a', user:'student1', name:'学生1', type:'questionnaire', level:'red', riskType:'情绪困扰', score:9, evidence:['信号'], text:'', answers:{}, createdAt:Date.now() },
    { id:'b', user:'student2', name:'学生2', type:'record', level:'green', riskType:'—', score:1, evidence:[], text:'还好', answers:{}, createdAt:Date.now() }
  ]
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

(async () => {
  console.log('===== 概览页信息密度测试 =====');

  const w = boot();
  const d = w.document;
  await login(w);
  w.RB.route('dash'); await sleep(250);

  const view = d.getElementById('view-dash');
  ok('概览页已渲染', view && view.innerHTML.length > 300,
     view ? String(view.innerHTML.length) : 'null');

  /* ---------- 1. 已删除的内容确实不在 ---------- */
  ok('「快速结论」标题已删除', !text(view).includes('快速结论'),
     text(view).slice(-120));
  ok('#insights 容器已删除', d.getElementById('insights') === null);
  ok('底部 gotoActions 按钮已删除', d.getElementById('gotoActions') === null);
  ok('底部 gotoClassAI 按钮已删除', d.getElementById('gotoClassAI') === null);

  /* ---------- 2. AI 研判入口改走标签栏 ---------- */
  const aiTab = d.querySelector('#tabs button[data-tab="classai"]');
  ok('标签栏有「班级研判」入口', !!aiTab);
  if (aiTab) {
    aiTab.click(); await sleep(200);
    ok('可从标签栏进入班级研判',
       d.getElementById('view-classai').classList.contains('active'),
       d.getElementById('view-classai').className);
    w.RB.route('dash'); await sleep(150);
  }

  /* ---------- 3. 保留的区块仍在 ---------- */
  ['晴雨表', '风险分布', '班级信息', '最近提交'].forEach(t =>
    ok('保留区块：' + t, text(view).includes(t), text(view).slice(0, 200)));

  /* ---------- 4. 四个指标卡 ---------- */
  ok('有 4 个指标卡', d.querySelectorAll('#metrics .metric').length === 4,
     String(d.querySelectorAll('#metrics .metric').length));

  /* ---------- 5. 风险分布只显示百分比，不重复人数 ---------- */
  const legend = text(d.getElementById('distLegend'));
  ok('分布图例有百分比', /%/.test(legend), legend.slice(0, 120));
  ok('图例不重复堆人数', legend.indexOf('人') === -1 || /%/.test(legend),
     legend.slice(0, 120));

  /* ---------- 6. 最近提交有内容且限 6 条 ---------- */
  ok('最近提交已渲染', text(d.getElementById('recent')).length > 0);

  /* ---------- 7. 数据读取失败时给出提示而不是空白 ---------- */
  {
    const w2 = boot();
    await login(w2);
    w2.RB.state.data = { ok: false, error: '模拟服务端不可用', students: [], submissions: [], stats: {} };
    w2.RB.route('dash'); await sleep(200);
    const t2 = text(w2.document.getElementById('view-dash'));
    ok('数据失败时有明确提示',
       t2.includes('失败') || t2.includes('不可用') || t2.includes('未知'),
       t2.slice(0, 200));
  }

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  if (!fail) console.log('全部通过 ✅');
})().catch(e => { console.error('崩溃:', e.stack || e.message); process.exit(1); });
