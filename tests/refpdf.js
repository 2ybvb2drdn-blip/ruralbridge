/* 转介单 PDF：字段完整 / 直接下载不弹打印 / 页数校验
 *
 * 背景：转介单是要交给县级机构的对外文件，原先走 window.print()，
 * 老师还得自己在打印窗口里选「存为 PDF」。现改为直接下载。
 *
 * 曾出现的坑：renderReferral() 忘了调 doc.newPage()，产出 0 页的非法 PDF，
 * 而当时所有结构断言（%PDF- 头 / %%EOF / FontFile2）依然全绿。
 * 所以这里必须专门校验页数。
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
  stats: { total: 1, red: 1, yellow: 0, green: 0, submissions: 1 },
  students: [
    { user:'student1', name:'张小雨', level:'red', score:82, riskType:'情绪困扰',
      tags:['情绪困扰'], last:'10-29', count:1, createdAt: Date.now() }
  ],
  submissions: [
    { id:'a', user:'student1', name:'张小雨', type:'questionnaire', level:'red',
      score:82, riskType:'情绪困扰',
      evidence:[
        '问卷第9题：近两周有消极念头',
        '睡眠困难，入睡超过1小时',
        '课堂注意力明显下降'
      ],
      ruleHits:[{ ruleId:'S2', type:'具体计划', hard:true }],
      answers:{}, text:'', createdAt: Date.now() }
  ]
};

function boot(noFont) {
  const dom = new JSDOM(html, { url:'http://localhost/', runScripts:'outside-only', pretendToBeVisual:true,
    beforeParse(w) {
      w.scrollTo = () => {}; w.alert = () => { w.__alerts = (w.__alerts || []).concat([arguments[0]]); };
      w.confirm = () => true;
      w.print = () => { w.__printed = (w.__printed || 0) + 1; };
      w.__downloads = [];
      w.__alerts = [];
      w.URL.createObjectURL = (b) => { w.__downloads.push({ blob: b }); return 'blob:x'; };
      w.URL.revokeObjectURL = () => {};
      w.fetch = async () => ({ ok:true, status:200, json: async () => DATA });
      if (!w.TextEncoder) w.TextEncoder = TextEncoder;
      if (!w.TextDecoder) w.TextDecoder = TextDecoder;
      if (typeof w.CompressionStream === 'undefined') w.CompressionStream = CompressionStream;
      if (typeof w.Response === 'undefined') w.Response = Response;
      w.AbortController = AbortController;
      const orig = w.HTMLAnchorElement.prototype.click;
      w.HTMLAnchorElement.prototype.click = function () {
        if (this.download) w.__downloads.push({ name: this.download });
        else if (orig) orig.call(this);
      };
    }});
  const w = dom.window;
  for (const f of files) w.eval(fs.readFileSync(path.join(WEB, 'js', f), 'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  if (!noFont && w.RB.pdfReport && w.RB.pdfReport.setFontBytes) {
    w.RB.pdfReport.setFontBytes(fs.readFileSync(path.join(WEB, 'fonts/rb-cjk.ttf')));
  }
  return w;
}

async function login(w) {
  const d = w.document;
  d.getElementById('u').value = 'xinli123';
  d.getElementById('p').value = '12345678';
  d.getElementById('loginForm').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true }));
  await sleep(300);
}

(async () => {
  console.log('===== 转介单 PDF 测试 =====');

  const w = boot();
  const d = w.document;
  await login(w);
  w.RB.state.user = { user:'xinli123', name:'李老师', role:'counselor', roleName:'学校心理教师', klass:'初一(2)班' };
  w.RB.state.data = DATA;
  w.RB.route('referral'); await sleep(350);

  /* ---------- 1. 按钮已是「下载 PDF」 ---------- */
  const btn = d.getElementById('btnRefPrint');
  ok('下载按钮存在', !!btn);
  ok('按钮文案为「下载 PDF」', btn && text(btn) === '下载 PDF', btn && text(btn));
  ok('页面不再提「点击上方打印」',
     !text(d.getElementById('view-referral')).includes('点击上方「打印」'),
     text(d.getElementById('view-referral')).slice(0, 120));

  /* ---------- 2. 网页版转介单仍能生成 ---------- */
  d.getElementById('refStu').value = 'student1';
  d.getElementById('refOrg').value = '县未成年人心理健康辅导中心';
  d.getElementById('refDate').value = '2026-10-29';
  d.getElementById('btnRefGen').click();
  await sleep(250);

  const body = d.getElementById('refBody');
  ok('网页版转介单已渲染', body && body.innerHTML.length > 500,
     body ? String(body.innerHTML.length) : 'null');
  const btxt = text(body);
  ['学生心理转介单', '张小雨', '初一(2)班', '红色',
   '县未成年人心理健康辅导中心', '一、转介依据', '二、已采取的校内措施',
   '三、转介建议', '监护人签字'].forEach(k =>
    ok('网页版含：' + k, btxt.includes(k), btxt.slice(0, 150)));

  /* ---------- 3. 点击直接下载，不弹打印 ---------- */
  w.__downloads = [];
  w.__printed = 0;
  btn.click();
  await sleep(2500);

  ok('未触发打印窗口', w.__printed === 0, 'printed=' + w.__printed);

  const dl = w.__downloads.find(x => x.name && x.name.endsWith('.pdf'));
  ok('已触发 PDF 下载', !!dl, JSON.stringify(w.__downloads.map(x => x.name)));
  ok('文件名含学生名', dl && dl.name.includes('张小雨'), dl && dl.name);
  ok('文件名含日期', dl && /2026-10-29/.test(dl.name), dl && dl.name);

  /* ---------- 4. PDF 结构 ---------- */
  const rec = w.__downloads.find(x => x.blob);
  ok('生成了 blob', !!rec);
  if (rec) {
    const ab = await rec.blob.arrayBuffer();
    const b = new Uint8Array(ab);
    const all = Buffer.from(ab).toString('latin1');

    ok('PDF 非空', b.length > 3000, String(b.length));
    ok('有 %PDF- 头', all.startsWith('%PDF-'), JSON.stringify(all.slice(0, 8)));
    ok('有 %%EOF', all.trimEnd().endsWith('%%EOF'));
    ok('内嵌字体', all.includes('FontFile2'));
    ok('有 ToUnicode', all.includes('/ToUnicode'));
    ok('体积合理（<200KB）', b.length < 200 * 1024, (b.length / 1024).toFixed(1) + 'KB');

    /* 关键：0 页 PDF 也满足以上所有断言，必须单独查页数 */
    const pg = all.match(/\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/) ||
               all.match(/\/Count\s+(\d+)/);
    ok('页数 >= 1（防 0 页非法 PDF）', pg && Number(pg[1]) >= 1,
       pg ? 'Count=' + pg[1] : '未找到 Count');
    ok('页数为单页转介单', pg && Number(pg[1]) === 1,
       pg ? 'Count=' + pg[1] : '未找到');
  }

  /* ---------- 5. 未选学生时提示而不崩 ---------- */
  {
    const w2 = boot();
    await login(w2);
    w2.RB.state.user = { user:'xinli123', name:'李老师', role:'counselor', klass:'初一(2)班' };
    w2.RB.state.data = { ok:true, students:[], submissions:[], stats:{ total:0, red:0, yellow:0, green:0, submissions:0 } };
    w2.RB.route('referral'); await sleep(300);
    let alerted = false;
    w2.alert = () => { alerted = true; };
    w2.document.getElementById('btnRefPrint').click();
    await sleep(400);
    ok('无学生时给出提示而不崩', alerted);
    ok('无学生时不产生下载', (w2.__downloads || []).length === 0,
       JSON.stringify((w2.__downloads || []).map(x => x.name)));
  }

  /* ---------- 6. 转介依据含规则硬命中 ---------- */
  {
    const w3 = boot();
    await login(w3);
    w3.RB.state.user = { user:'xinli123', name:'李老师', role:'counselor', klass:'初一(2)班' };
    w3.RB.state.data = DATA;
    w3.RB.route('referral'); await sleep(300);
    const d3 = w3.document;
    d3.getElementById('refStu').value = 'student1';
    d3.getElementById('btnRefGen').click();
    await sleep(250);
    const t3 = text(d3.getElementById('refBody'));
    ok('转介依据含问卷信号', t3.includes('消极念头'), t3.slice(0, 250));
    ok('转介依据含规则硬命中', t3.includes('S2') || t3.includes('规则引擎'),
       t3.slice(0, 300));
  }

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  if (!fail) console.log('全部通过 ✅');
})().catch(e => { console.error('崩溃:', e.stack || e.message); process.exit(1); });
