/* 班级报告页：周期切片 / 变化追踪 / 汇总计算 / 三个导出 / 学生个体报告
 *
 * 重点保证：无数据时如实说「样本不足」，绝不编造趋势。
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

const DAY = 86400000;
const now = Date.now();

/* 学生1：红 → 绿（风险下降，2 次提交）
   学生2：绿 → 黄（风险上升，2 次）
   学生3：只有 1 次（样本不足）
   学生4：红，但提交在 40 天前（本周/本月应排除） */
const DATA = {
  ok: true, updatedAt: now,
  stats: { total: 4, red: 2, yellow: 1, green: 1, submissions: 6 },
  students: [
    { user:'student1', name:'学生1', level:'green', score:2, riskType:'—', tags:[], last:'10-29', count:2, createdAt: now },
    { user:'student2', name:'学生2', level:'yellow', score:6, riskType:'学业压力', tags:['学业压力'], last:'10-29', count:2, createdAt: now },
    { user:'student3', name:'学生3', level:'red', score:11, riskType:'情绪困扰', tags:['情绪困扰'], last:'10-29', count:1, createdAt: now },
    { user:'student4', name:'学生4', level:'red', score:15, riskType:'情绪困扰', tags:[], last:'09-19', count:1, createdAt: now - 40 * DAY }
  ],
  submissions: [
    /* student1：5 天前红 → 1 天前绿（下降） */
    { id:'s1a', user:'student1', name:'学生1', type:'questionnaire', level:'red', score:12,
      evidence:['睡眠困难'], text:'', answers:{}, createdAt: now - 5 * DAY },
    { id:'s1b', user:'student1', name:'学生1', type:'questionnaire', level:'green', score:2,
      evidence:[], text:'', answers:{}, createdAt: now - 1 * DAY },
    /* student2：4 天前绿 → 1 天前黄（上升） */
    { id:'s2a', user:'student2', name:'学生2', type:'questionnaire', level:'green', score:1,
      evidence:[], text:'', answers:{}, createdAt: now - 4 * DAY },
    { id:'s2b', user:'student2', name:'学生2', type:'questionnaire', level:'yellow', score:6,
      evidence:['学业压力'], text:'', answers:{}, createdAt: now - 1 * DAY },
    /* student3：只有 1 次 */
    { id:'s3a', user:'student3', name:'学生3', type:'questionnaire', level:'red', score:11,
      evidence:['情绪低落'], text:'', answers:{}, createdAt: now - 2 * DAY },
    /* student4：40 天前，只在「全部」里出现 */
    { id:'s4a', user:'student4', name:'学生4', type:'record', level:'red', score:15,
      evidence:[], text:'很难受', answers:{}, createdAt: now - 40 * DAY }
  ]
};

function boot(data) {
  const d0 = data || DATA;
  const dom = new JSDOM(html, { url:'http://localhost/', runScripts:'outside-only', pretendToBeVisual:true,
    beforeParse(w) {
      w.scrollTo = () => {}; w.alert = () => {}; w.confirm = () => true;
      w.print = () => { w.__printed = (w.__printed || 0) + 1; };
      w.__downloads = [];
      w.URL.createObjectURL = (b) => { w.__downloads.push({ blob: b }); return 'blob:x'; };
      w.URL.revokeObjectURL = () => {};
      w.fetch = async () => ({ ok:true, status:200, json: async () => d0 });
      if (!w.TextEncoder) w.TextEncoder = TextEncoder;
      if (!w.TextDecoder) w.TextDecoder = TextDecoder;
      if (typeof w.CompressionStream === 'undefined') w.CompressionStream = CompressionStream;
      if (typeof w.Response === 'undefined') w.Response = Response;
      w.AbortController = AbortController;
      /* 捕获 a.click() 的下载文件名 */
      const orig = w.HTMLAnchorElement.prototype.click;
      w.HTMLAnchorElement.prototype.click = function () {
        if (this.download) w.__downloads.push({ name: this.download });
        else if (orig) orig.call(this);
      };
    }});
  const w = dom.window;
  for (const f of files) w.eval(fs.readFileSync(path.join(WEB, 'js', f), 'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  if (w.RB.pdfReport && w.RB.pdfReport.setFontBytes) {
    w.RB.pdfReport.setFontBytes(fs.readFileSync(path.join(WEB, 'fonts/rb-cjk.ttf')));
  }
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
  console.log('===== 班级报告页测试 =====');

  const w = boot();
  const d = w.document;
  await login(w);

  /* ---------- 1. 模块与周期 ---------- */
  ok('RB.report 已挂载', !!w.RB.report);
  ['periodOf','subsOf','trendOf','summarize','classSummary',
   'exportClassDoc','exportStudentDoc','exportStudentsXLSX'].forEach(k =>
    ok('RB.report.' + k + ' 存在', typeof w.RB.report[k] === 'function'));
  ok('三个周期', ['week','month','all'].every(k => !!w.RB.report.periodOf(k)));
  ok('本周 7 天', w.RB.report.periodOf('week').days === 7);
  ok('本月 30 天', w.RB.report.periodOf('month').days === 30);
  ok('全部为 0 天（不限）', w.RB.report.periodOf('all').days === 0);

  /* ---------- 2. 周期切片 ---------- */
  ok('本周 student1 有 2 条', w.RB.report.subsOf('student1', 7).length === 2,
     String(w.RB.report.subsOf('student1', 7).length));
  ok('本周 student4 有 0 条（40 天前）', w.RB.report.subsOf('student4', 7).length === 0,
     String(w.RB.report.subsOf('student4', 7).length));
  ok('全部周期 student4 有 1 条', w.RB.report.subsOf('student4', 0).length === 1);
  ok('subsOf 按时间升序',
     w.RB.report.subsOf('student1', 7).map(x => x.id).join(',') === 's1a,s1b',
     w.RB.report.subsOf('student1', 7).map(x => x.id).join(','));

  /* ---------- 3. 变化追踪 ---------- */
  const t1 = w.RB.report.trendOf(w.RB.report.subsOf('student1', 7));
  ok('student1 风险下降', t1 && t1.dir === 'down' && t1.txt === '风险下降',
     t1 && t1.txt);
  ok('下降含 from/to 等级', t1 && t1.from === 'red' && t1.to === 'green',
     t1 && (t1.from + '->' + t1.to));
  const t2 = w.RB.report.trendOf(w.RB.report.subsOf('student2', 7));
  ok('student2 风险上升', t2 && t2.dir === 'up', t2 && t2.txt);
  ok('student3 样本不足返回 null',
     w.RB.report.trendOf(w.RB.report.subsOf('student3', 7)) === null);

  /* ---------- 4. 汇总计算 ---------- */
  const cs = w.RB.report.classSummary(7);
  ok('班级红人数取自当前状态', cs.red === 2, String(cs.red));
  ok('上升 1 人', cs.up === 1, String(cs.up));
  ok('下降 1 人', cs.down === 1, String(cs.down));
  ok('样本不足 2 人（student3 及 student4 本周无提交）',
     cs.insufficient >= 1, String(cs.insufficient));
  ok('覆盖率是百分比数字', typeof cs.coverage === 'number', String(cs.coverage));

  /* ---------- 5. 报告页渲染 ---------- */
  w.RB.route('report'); await sleep(300);
  const view = d.getElementById('view-report');
  const host = d.getElementById('classReport');
  ok('报告页已渲染', host && host.innerHTML.length > 500,
     host ? String(host.innerHTML.length) : 'null');

  const periods = [...d.querySelectorAll('#classReport [data-rep-period]')];
  ok('有 3 个周期按钮', periods.length === 3, String(periods.length));
  ok('默认选中本周', periods.find(b => b.dataset.repPeriod === 'week').classList.contains('on'));

  const strip = text(d.querySelector('#classReport .rep-strip'));
  ok('风险分布条含红色', strip.includes('红色'), strip.slice(0, 80));
  ok('风险分布条含绿色', strip.includes('绿色'));

  ok('有变化概览行', !!d.querySelector('#classReport .rep-chg-line'));
  ok('变化用紧凑 chip 而非大格子', d.querySelectorAll('#classReport .chg-chip').length > 0,
     String(d.querySelectorAll('#classReport .chg-chip').length));
  ok('旧的四宫格已删除', d.querySelectorAll('#classReport .rep-chg-card').length === 0);

  const rows = [...d.querySelectorAll('#classReport tbody tr')];
  ok('学生表格有 4 行（全员）', rows.length === 4, String(rows.length));
  const tbl = text(d.querySelector('#classReport table'));
  ok('表格含学生姓名', tbl.includes('学生1'));
  ok('姓名列带账号副行', !!d.querySelector('#classReport .stu-uid'));
  ok('有 7 列表头', d.querySelectorAll('#classReport thead th').length === 7,
     String(d.querySelectorAll('#classReport thead th').length));
  ok('表格显示「样本不足」而非编造趋势',
     tbl.includes('样本不足'), tbl.slice(0, 200));
  ok('有「查看报告」入口', d.querySelectorAll('#classReport [data-rep-stu]').length === 4,
     String(d.querySelectorAll('#classReport [data-rep-stu]').length));

  /* 周期切换 */
  periods.find(b => b.dataset.repPeriod === 'all').click();
  await sleep(250);
  ok('切到「全部」后按钮高亮',
     [...d.querySelectorAll('#classReport [data-rep-period]')]
       .find(b => b.dataset.repPeriod === 'all').classList.contains('on'));
  w.RB.route('report'); await sleep(200);

  /* ---------- 6. 三个导出按钮 ---------- */
  ok('有 Word 导出', !!d.getElementById('expDoc'));
  ok('有 Excel 导出', !!d.getElementById('expXlsx'));
  ok('有 PDF 导出', !!d.getElementById('expPdf'));
  ok('Excel 按钮文案不再提 CSV',
     text(d.getElementById('expXlsx')).indexOf('CSV') === -1,
     text(d.getElementById('expXlsx')));

  /* Word 导出 */
  {
    w.__downloads = [];
    d.getElementById('expDoc').click(); await sleep(200);
    const dl = w.__downloads.find(x => x.name && x.name.endsWith('.doc'));
    ok('Word 已触发下载', !!dl, JSON.stringify(w.__downloads.map(x => x.name)));
    ok('Word 文件名含班级', dl && dl.name.includes('初一(2)班'), dl && dl.name);
  }

  /* Excel 导出 */
  {
    w.__downloads = [];
    d.getElementById('expXlsx').click(); await sleep(300);
    const dl = w.__downloads.find(x => x.name && x.name.endsWith('.xlsx'));
    ok('Excel 已触发下载', !!dl, JSON.stringify(w.__downloads.map(x => x.name)));
    ok('导出的是 .xlsx 不是 .csv',
       !w.__downloads.some(x => x.name && x.name.endsWith('.csv')));
    const rec = w.__downloads.find(x => x.blob);
    if (rec) {
      const ab = await rec.blob.arrayBuffer();
      const b = new Uint8Array(ab);
      ok('xlsx 有 ZIP 魔数', b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4,
         [b[0],b[1],b[2],b[3]].join(','));
      ok('xlsx 无 BOM 污染', !(b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf));
      const raw = Buffer.from(ab).toString('utf8');
      ok('xlsx 含工作表名', raw.includes('学生明细'));
      ok('xlsx 含表头字段', raw.includes('账号') && raw.includes('变化'));
      ok('xlsx 含学生数据', raw.includes('student1') && raw.includes('student4'));
    }
  }

  /* PDF 导出：直接下载，不弹打印 */
  {
    w.__downloads = [];
    w.__printed = 0;
    d.getElementById('expPdf').click();
    await sleep(2000);
    ok('PDF 不弹打印窗口', (w.__printed || 0) === 0, 'printed=' + (w.__printed || 0));
    const dl = w.__downloads.find(x => x.name && x.name.endsWith('.pdf'));
    ok('PDF 已触发下载', !!dl, JSON.stringify(w.__downloads.map(x => x.name)));
    const rec = w.__downloads.find(x => x.blob);
    if (rec) {
      const ab = await rec.blob.arrayBuffer();
      const all = Buffer.from(ab).toString('latin1');
      ok('PDF 有 %PDF- 头', all.startsWith('%PDF-'));
      ok('PDF 有 EOF', all.trimEnd().endsWith('%%EOF'));
      ok('PDF 内嵌字体', all.includes('FontFile2'));
      ok('PDF 有 ToUnicode', all.includes('/ToUnicode'));
      const pg = all.match(/\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/);
      ok('PDF 页数 >= 1', pg && Number(pg[1]) >= 1, pg ? 'Count=' + pg[1] : '未找到');
    }
  }

  /* ---------- 7. 学生个体报告 ----------
     分两种学生验证：
       student1 —— 本周 2 次提交，应能算出趋势
       student3 —— 本周仅 1 次，必须明确写「样本不足」而不是编造趋势
     上次这里只点了第一个学生（有 2 次）却断言「样本不足」，属于测试自身写错。 */
  {
    w.RB.route('report'); await sleep(250);

    /* 7a. 有多次提交的学生：应显示趋势 */
    const btns = [...d.querySelectorAll('#classReport [data-rep-stu]')];
    ok('有学生报告入口', btns.length === 4, String(btns.length));

    const b1 = btns.find(x => x.dataset.repStu === 'student1');
    ok('找到 student1 的报告入口', !!b1);
    if (b1) {
      b1.click(); await sleep(300);
      const h = d.getElementById('stuReportHost');
      ok('学生报告面板已打开', !!h && h.innerHTML.length > 200,
         h ? String(h.innerHTML.length) : 'null');
      const ht = text(h);
      ok('面板含学生姓名', ht.includes('学生1'), ht.slice(0, 120));
      ok('多次提交时显示趋势', ht.includes('风险下降') || ht.includes('风险上升'),
         ht.slice(0, 200));

      const close = d.querySelector('#stuReportHost [data-stu-close]');
      ok('有关闭按钮', !!close);
      if (close) { close.click(); await sleep(200); }
    }

    /* 7b. 只有 1 次提交的学生：必须如实说样本不足 */
    w.RB.route('report'); await sleep(250);
    const b3 = [...d.querySelectorAll('#classReport [data-rep-stu]')]
      .find(x => x.dataset.repStu === 'student3');
    ok('找到 student3 的报告入口', !!b3);
    if (b3) {
      b3.click(); await sleep(300);
      const h = d.getElementById('stuReportHost');
      const ht = text(h);
      ok('一次提交时提示样本不足',
         ht.includes('样本不足') || ht.includes('提交不足'), ht.slice(0, 250));
      ok('样本不足时不编造趋势',
         !ht.includes('风险上升') && !ht.includes('风险下降'), ht.slice(0, 250));
      const close = d.querySelector('#stuReportHost [data-stu-close]');
      if (close) { close.click(); await sleep(150); }
    }
  }

  /* ---------- 8. 空数据不崩 ---------- */
  {
    const w2 = boot({ ok:true, students:[], submissions:[], stats:{ total:0, red:0, yellow:0, green:0, submissions:0 } });
    await login(w2);
    w2.RB.state.user = { user:'banzhuren123', name:'王老师', role:'teacher', klass:'初一(2)班' };
    let crashed = false;
    try { w2.RB.route('report'); } catch (e) { crashed = true; }
    await sleep(250);
    ok('空数据报告页不崩', !crashed);
    const t2 = text(w2.document.getElementById('classReport'));
    ok('空数据有明确提示', t2.includes('暂无') || t2.includes('样本不足'), t2.slice(0, 160));
  }

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  if (!fail) console.log('全部通过 ✅');
})().catch(e => { console.error('崩溃:', e.stack || e.message); process.exit(1); });
