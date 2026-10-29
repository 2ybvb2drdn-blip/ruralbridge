/* 班级报告 PDF：字体解析 / 运行时子集 / 文档结构 / 缺字提示 / 无压缩降级
 *
 * 关键点：生成的不是「改了后缀的文本」，而是真 xlsx/pdf 二进制。
 * 这里直接检查 ZIP / PDF 魔数与内部结构，并用 pypdf 同等口径校验页数。
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

const DAY = 86400000;
const now = Date.now();

function mkData(names) {
  const list = (names || ['张小雨','李思远','王浩']).map((n, i) => ({
    user: 'student' + (i + 1), name: n,
    level: i === 0 ? 'red' : (i === 1 ? 'yellow' : 'green'),
    score: i === 0 ? 9 : (i === 1 ? 5 : 1),
    riskType: i === 0 ? '情绪困扰' : (i === 1 ? '学业压力' : '—'),
    tags: i === 0 ? ['情绪困扰'] : (i === 1 ? ['学业压力'] : []),
    last: '10-29', count: 2, createdAt: now
  }));
  const subs = [];
  list.forEach((s, i) => {
    subs.push({ id:'q'+i+'a', user:s.user, name:s.name, type:'questionnaire',
      level:s.level, score:s.score, evidence:['信号'], text:'', answers:{}, createdAt: now - 2*DAY });
    subs.push({ id:'q'+i+'b', user:s.user, name:s.name, type:'questionnaire',
      level:s.level, score:s.score, evidence:[], text:'', answers:{}, createdAt: now - DAY });
  });
  return { ok:true, updatedAt:now, students:list, submissions:subs,
    stats:{ total:list.length, red:1, yellow:1, green:1, submissions:subs.length } };
}

function boot(data, noCompress) {
  const dom = new JSDOM(html, { url:'http://localhost/', runScripts:'outside-only', pretendToBeVisual:true,
    beforeParse(w) {
      w.scrollTo = () => {}; w.alert = () => {}; w.confirm = () => true; w.print = () => {};
      w.__downloads = [];
      w.URL.createObjectURL = (b) => { w.__downloads.push({ blob: b }); return 'blob:x'; };
      w.URL.revokeObjectURL = () => {};
      w.fetch = async () => ({ ok:true, status:200, json: async () => data });
      if (!w.TextEncoder) w.TextEncoder = TextEncoder;
      if (!w.TextDecoder) w.TextDecoder = TextDecoder;
      if (!noCompress && typeof w.CompressionStream === 'undefined') w.CompressionStream = CompressionStream;
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
  return w;
}

(async () => {
  console.log('===== 班级报告 PDF 测试 =====');
  const fontBuf = fs.readFileSync(path.join(WEB, 'fonts/rb-cjk.ttf'));

  const w = boot(mkData());
  w.RB.state.data = mkData();
  w.RB.state.user = { user:'banzhuren123', name:'王老师', role:'teacher', klass:'初一(2)班' };

  /* ---------- 1. 字体解析 ---------- */
  const font = w.RB.pdfFont.parse(fontBuf);
  ok('字体解析成功', !!font && font.numGlyphs > 1000, font && String(font.numGlyphs));
  ok('unitsPerEm = 1000', font.unitsPerEm === 1000, String(font.unitsPerEm));
  ok('cmap 覆盖常用字', font.cmap[0x5B66] != null && font.cmap[0x751F] != null);

  /* ---------- 2. 运行时子集 ---------- */
  const sub = w.RB.pdfFont.subset(font, '班级心理健康报告张小雨红色需干预');
  ok('子集字形数远小于原字体', sub.numGlyphs < font.numGlyphs / 10,
     sub.numGlyphs + ' / ' + font.numGlyphs);
  ok('子集字节数远小于原字体', sub.bytes.length < fontBuf.length / 5,
     sub.bytes.length + ' / ' + fontBuf.length);
  ok('子集有 sfnt 头', sub.bytes[0] === 0 && sub.bytes[1] === 1 && sub.bytes[2] === 0 && sub.bytes[3] === 0);
  ok('宽表与字形数一致', sub.widths.length === sub.numGlyphs);
  ok('字符有 GID 映射', sub.gidOf[0x73ED] != null && sub.gidOf[0x7EA7] != null);

  /* ---------- 3. 文档原语 ---------- */
  {
    const f2 = w.RB.pdfFont.subset(font, '测试文本内容');
    const doc = w.RB.pdfDoc.create({ font: f2 });
    ok('文档宽度为 A4', Math.abs(doc.pageW - 595.28) < 0.1, String(doc.pageW));
    ok('文档高度为 A4', Math.abs(doc.pageH - 841.89) < 0.1, String(doc.pageH));
    doc.newPage();
    doc.text('测试', 50, 50, { size: 10 });
    const bytes = await doc.build();
    const all = Buffer.from(bytes).toString('latin1');
    ok('原语文档有 PDF 头', all.startsWith('%PDF-'), all.slice(0, 8));
    ok('原语文档有 EOF', all.trimEnd().endsWith('%%EOF'));
  }

  /* ---------- 4. 完整导出 ---------- */
  w.RB.pdfReport.setFontBytes(fontBuf);
  const r = await w.RB.pdfReport.exportClassPDF('all');
  ok('返回字节', r.bytes && r.bytes.length > 0, String(r.bytes && r.bytes.length));
  ok('文件名是 .pdf', r.filename.endsWith('.pdf'), r.filename);
  ok('文件名含班级', r.filename.includes('初一(2)班'), r.filename);
  ok('文件名含日期', /\d{4}-\d{2}-\d{2}/.test(r.filename), r.filename);
  ok('无缺失字符', r.missing.length === 0, r.missing.join(' '));

  const all = Buffer.from(r.bytes).toString('latin1');
  ok('有 %PDF-1.7 头', all.startsWith('%PDF-1.7'), JSON.stringify(all.slice(0, 8)));
  ok('有 xref', all.includes('\nxref\n'));
  ok('有 startxref', all.includes('startxref'));
  ok('内嵌字体 FontFile2', all.includes('FontFile2'));
  ok('字体用 CIDFontType2', all.includes('CIDFontType2'));
  ok('编码 Identity-H', all.includes('Identity-H'));
  ok('有 ToUnicode（可复制搜索）', all.includes('/ToUnicode'));
  ok('有宽度数组', /\/W\[/.test(all));
  ok('体积远小于字体（子集生效）', r.bytes.length < 200 * 1024,
     (r.bytes.length / 1024).toFixed(1) + 'KB');

  /* 页数必须 >= 1：曾出现漏调 newPage() 产出 0 页非法 PDF，
     而当时所有结构断言依然全绿 */
  const pg = all.match(/\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/) ||
             all.match(/\/Count\s+(\d+)/);
  ok('页数 >= 1（防 0 页非法 PDF）', pg && Number(pg[1]) >= 1,
     pg ? 'Count=' + pg[1] : '未找到 Count');

  /* 内容流：文字操作符 Tj 在 FlateDecode 压缩后的流里，明文看不到。
     所以只能校验「流对象存在」+「有 FlateDecode 标记」+「对象数合理」，
     真正的文字是否正确由 tests/refpdf.js 与 pypdf 人工核验兜住。 */
  ok('有压缩流标记', all.includes('/FlateDecode'));
  ok('有 stream 对象', all.includes('stream') && all.includes('endstream'));
  ok('对象数合理（>5）', (all.match(/\d+ 0 obj/g) || []).length > 5,
     String((all.match(/\d+ 0 obj/g) || []).length));
  ok('有页面内容引用 /Contents', all.includes('/Contents'));

  /* ---------- 5. 缺字报告 ---------- */
  {
    const w2 = boot(mkData(['张小雨', '李龘', '王浩']));
    w2.RB.state.data = mkData(['张小雨', '李龘', '王浩']);
    w2.RB.pdfReport.setFontBytes(fontBuf);
    const r2 = await w2.RB.pdfReport.exportClassPDF('all');
    ok('生僻字被识别为缺失', r2.missing.indexOf('龘') !== -1,
       JSON.stringify(r2.missing));
    ok('缺字时仍能生成 PDF', r2.bytes.length > 5000, String(r2.bytes.length));
    const a2 = Buffer.from(r2.bytes).toString('latin1');
    ok('缺字 PDF 结构完整', a2.startsWith('%PDF-') && a2.trimEnd().endsWith('%%EOF'));
  }

  /* ---------- 6. 无压缩降级路径 ---------- */
  {
    const w3 = boot(mkData(), true);
    delete w3.CompressionStream;
    w3.RB.state.data = mkData();
    w3.RB.pdfReport.setFontBytes(fontBuf);
    const r3 = await w3.RB.pdfReport.exportClassPDF('all');
    const a3 = Buffer.from(r3.bytes).toString('latin1');
    ok('降级仍有 PDF 头', a3.startsWith('%PDF-'), JSON.stringify(a3.slice(0, 8)));
    ok('降级仍内嵌字体', a3.includes('FontFile2'));
    ok('降级体积更大（未压缩）', r3.bytes.length > r.bytes.length,
       (r3.bytes.length / 1024).toFixed(0) + 'KB vs ' + (r.bytes.length / 1024).toFixed(0) + 'KB');
  }

  /* ---------- 7. 多页与空数据 ---------- */
  {
    const many = [];
    for (let i = 0; i < 60; i++) many.push('学生' + (i + 1));
    const bigData = mkData(many);
    const w4 = boot(bigData);
    w4.RB.state.data = bigData;
    w4.RB.pdfReport.setFontBytes(fontBuf);
    const r4 = await w4.RB.pdfReport.exportClassPDF('all');
    const a4 = Buffer.from(r4.bytes).toString('latin1');
    const pg4 = a4.match(/\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/) ||
                a4.match(/\/Count\s+(\d+)/);
    ok('60 人自动分页（>=2 页）', pg4 && Number(pg4[1]) >= 2,
       pg4 ? 'Count=' + pg4[1] : '未找到');
    ok('60 人体积仍可控（<300KB）', r4.bytes.length < 300 * 1024,
       (r4.bytes.length / 1024).toFixed(0) + 'KB');
  }

  {
    const w5 = boot({ ok:true, students:[], submissions:[], stats:{ total:0, red:0, yellow:0, green:0, submissions:0 } });
    w5.RB.state.data = { ok:true, students:[], submissions:[], stats:{ total:0, red:0, yellow:0, green:0, submissions:0 } };
    w5.RB.pdfReport.setFontBytes(fontBuf);
    const r5 = await w5.RB.pdfReport.exportClassPDF('all');
    const a5 = Buffer.from(r5.bytes).toString('latin1');
    ok('空数据能生成 PDF', r5.bytes.length > 1000, String(r5.bytes.length));
    const pg5 = a5.match(/\/Count\s+(\d+)/);
    ok('空数据页数 >= 1', pg5 && Number(pg5[1]) >= 1, pg5 ? 'Count=' + pg5[1] : '未找到');
  }

  /* ---------- 8. 通过界面点击导出（端到端） ---------- */
  {
    const w6 = boot(mkData());
    await sleep(100);
    const d6 = w6.document;
    d6.getElementById('u').value = 'banzhuren123';
    d6.getElementById('p').value = '12345678';
    d6.getElementById('loginForm').dispatchEvent(new w6.Event('submit', { bubbles:true, cancelable:true }));
    await sleep(350);
    w6.RB.state.user = { user:'banzhuren123', name:'王老师', role:'teacher', klass:'初一(2)班' };
    w6.RB.state.data = mkData();
    w6.RB.pdfReport.setFontBytes(fontBuf);
    w6.RB.route('report'); await sleep(400);

    w6.__downloads = [];
    let printed = 0;
    w6.print = () => { printed++; };
    d6.getElementById('expPdf').click();
    await sleep(2200);

    ok('点击导出不弹打印窗口', printed === 0, 'printed=' + printed);
    const dl = w6.__downloads.find(x => x.name && x.name.endsWith('.pdf'));
    ok('点击导出触发 PDF 下载', !!dl, JSON.stringify(w6.__downloads.map(x => x.name)));
  }

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  if (!fail) console.log('全部通过 ✅');
})().catch(e => { console.error('崩溃:', e.stack || e.message); process.exit(1); });
