/* ============================================================
 * 乡育心桥 · RuralBridge — 班级报告 PDF 导出
 *
 * 与 Word / Excel 导出并列的第三种格式。区别：
 *   Word   —— 可继续编辑
 *   Excel  —— 明细可筛选排序
 *   PDF    —— 版式固定，适合直接发给家长/存档
 *
 * 为什么不用 window.print()：
 *   打印走系统对话框，用户还得自己选「存为 PDF」，无法做到「点了就下载」。
 *   浏览器没有生成 PDF 的 API，所以这里自己拼 PDF 字节。
 *
 * 字体策略：
 *   站点带一份 rb-cjk.ttf（应用文案 + GB2312 一级字，3900 字形），
 *   导出时按本次实际用到的字做二次子集，PDF 通常只有几十 KB。
 *   字体是懒加载的——不进首屏，只在点「导出 PDF」时才拉。
 * ============================================================ */

(function () {
  'use strict';
  const RB = window.RB;

  const FONT_URL = 'fonts/rb-cjk.ttf';
  let fontCache = null;      // 解析后的字体对象
  let loading = null;

  const C = {
    text:   [0.13, 0.15, 0.18],
    muted:  [0.42, 0.46, 0.50],
    faint:  [0.60, 0.64, 0.68],
    red:    [0.78, 0.20, 0.20],
    yellow: [0.72, 0.45, 0.06],
    green:  [0.07, 0.42, 0.24],
    brand:  [0.12, 0.38, 0.62],
    line:   [0.84, 0.87, 0.90],
    headBg: [0.95, 0.97, 0.99],
    rowBg:  [0.98, 0.99, 1.00]
  };

  /* ---------------- 字体加载 ---------------- */
  function setFontBytes(bytes) {
    fontCache = RB.pdfFont.parse(bytes);
    return fontCache;
  }

  function loadFont() {
    if (fontCache) return Promise.resolve(fontCache);
    if (loading) return loading;
    loading = fetch(FONT_URL, { cache: 'force-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('字体下载失败 HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        fontCache = RB.pdfFont.parse(buf);
        return fontCache;
      })
      .catch(function (e) {
        loading = null;
        throw new Error('PDF 字体加载失败：' + (e.message || e) +
          '（首次导出需要下载字体，请检查网络后重试）');
      });
    return loading;
  }

  /* ---------------- 数据 ---------------- */
  function collect(periodKey) {
    const R = RB.report;
    const p = R.periodOf(periodKey || 'week');
    const d = RB.state.data || {};
    const S = d.students || [];
    const cs = R.classSummary(p.days);
    const acts = (RB.actions && RB.actions.all) ? RB.actions.all() : [];

    const students = S.map(function (s) {
      const list = R.subsOf(s.user, p.days);
      const tr = R.trendOf(list);
      return {
        name: s.name || s.user,
        uid: s.user,
        level: s.level,
        levelTxt: (RB.ui.LV[s.level] || { txt: '—' }).txt,
        score: s.score,
        tags: (s.tags || []).join(' / ') || '—',
        subs: list.length,
        trend: tr ? tr.txt : '样本不足',
        trendDir: tr ? tr.dir : 'na'
      };
    });

    return {
      klass: R.klassName(),
      label: p.label,
      cs: cs,
      students: students,
      ledger: {
        todo: acts.filter(function (x) { return !x.done; }).length,
        done: acts.filter(function (x) { return x.done; }).length,
        total: acts.length
      },
      generated: R.today()
    };
  }

  /* ---------------- 排版 ---------------- */
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const M = 48;                       // 页边距
  const CW = PAGE_W - M * 2;          // 内容宽

  function render(doc, model) {
    const cs = model.cs;
    let pageNo = 0;

    function beginPage(first) {
      doc.newPage();
      pageNo++;
      if (!first) {
        /* 续页：一行页眉，避免读者不知道这是哪份报告 */
        doc.text(model.klass + ' · 班级心理健康报告（续）', M, M - 14, {
          size: 9, color: C.muted, maxWidth: CW
        });
        doc.line(M, M - 2, PAGE_W - M, M - 2, { width: 0.5, color: C.line });
        return M + 16;
      }
      return M;
    }

    let y = beginPage(true);

    /* ---- 页头 ---- */
    y += 14;
    doc.text(model.klass + ' · 班级心理健康报告', M, y, { size: 19, color: C.text, maxWidth: CW });
    y += 20;
    doc.text('数据来源：学生真实提交 · 周期内 ' + cs.subsCount +
      ' 条记录，覆盖 ' + cs.activeCount + '/' + cs.total + ' 人（' + cs.coverage + '%）',
      M, y, { size: 9, color: C.muted, maxWidth: CW });
    y += 18;

    /* ---- 风险分布条 ---- */
    const boxH = 46;
    doc.rect(M, y, CW, boxH, { fill: C.headBg, stroke: C.line, width: 0.6 });
    const cellW = CW / 4;
    const items = [
      { n: cs.red, t: '红色 · 需干预', c: C.red },
      { n: cs.yellow, t: '黄色 · 需关注', c: C.yellow },
      { n: cs.green, t: '绿色 · 状态良好', c: C.green },
      { n: cs.total, t: '人已提交', c: C.brand }
    ];
    items.forEach(function (it, i) {
      const cx = M + cellW * i;
      if (i > 0) doc.line(cx, y + 10, cx, y + boxH - 10, { width: 0.5, color: C.line });
      doc.text(String(it.n), cx + cellW / 2 - 6, y + 20, { size: 15, color: it.c });
      doc.text(it.t, cx + 10, y + 36, { size: 8, color: C.muted, maxWidth: cellW - 16 });
    });
    y += boxH + 16;

    /* ---- 变化概览 ---- */
    const chg = [
      { n: cs.up, t: '上升' }, { n: cs.down, t: '下降' },
      { n: cs.flat, t: '持平' }, { n: cs.insufficient, t: '样本不足' }
    ].filter(function (x) { return x.n > 0 || x.t === '样本不足'; });

    doc.text(model.label + '变化', M, y, { size: 9.5, color: C.text });
    let cx2 = M + doc.measure(model.label + '变化', 9.5) + 12;
    chg.forEach(function (x) {
      const s = x.t + ' ' + x.n;
      doc.text(s, cx2, y, { size: 9, color: C.muted });
      cx2 += doc.measure(s, 9) + 14;
    });
    y += 12;
    doc.text('「样本不足」指该学生在周期内提交少于 2 次，无法判断变化方向。',
      M, y, { size: 8, color: C.faint, maxWidth: CW });
    y += 22;

    /* ---- 学生表格 ---- */
    y = sectionTitle(doc, '学生个体情况', y);

    const cols = [
      { k: 'name',   t: '学生',     w: 112 },
      { k: 'level',  t: '风险等级', w: 88 },
      { k: 'score',  t: '风险分',   w: 44 },
      { k: 'tags',   t: '主要信号', w: 120 },
      { k: 'subs',   t: '提交',     w: 38 },
      { k: 'trend',  t: '变化',     w: 97 }
    ];
    y = drawTable(doc, cols, model.students.map(function (s) {
      return {
        name: s.name, level: s.levelTxt, score: String(s.score),
        tags: s.tags, subs: s.subs + ' 次', trend: s.trend,
        _dir: s.trendDir, _level: s.level
      };
    }), y, function () {
      y = beginPage(false);
      y = sectionTitle(doc, '学生个体情况（续）', y);
      return y;
    });

    y += 20;

    /* ---- 台账执行 ---- */
    if (y > PAGE_H - M - 130) { y = beginPage(false); }
    y = sectionTitle(doc, '行动台账执行情况', y);

    const mw = CW / 3;
    const mets = [
      { n: model.ledger.todo, t: '待执行' },
      { n: model.ledger.done, t: '已完成' },
      { n: model.ledger.total, t: '累计记录' }
    ];
    mets.forEach(function (mt, i) {
      const bx = M + mw * i;
      doc.rect(bx, y, mw - 8, 44, { fill: C.headBg, stroke: C.line, width: 0.6 });
      doc.text(String(mt.n), bx + (mw - 8) / 2 - 5, y + 19, { size: 15, color: C.brand });
      doc.text(mt.t, bx + (mw - 8) / 2 - doc.measure(mt.t, 8.5) / 2, y + 35,
        { size: 8.5, color: C.muted });
    });
    y += 60;

    /* ---- 页脚声明 ---- */
    if (y > PAGE_H - M - 60) { y = beginPage(false); }
    doc.line(M, y, PAGE_W - M, y, { width: 0.5, color: C.line });
    y += 12;
    doc.paragraph(
      '本报告依据学生本人提交的问卷与日常记录自动生成，仅作学校心理健康工作参考，' +
      '不构成医学诊断。报告内容涉及学生隐私，请妥善保管，不得随意传播。',
      M, y, CW, { size: 8, color: C.faint, lineHeight: 13 });
    y += 30;
    doc.text('乡育心桥 · RuralBridge　生成日期 ' + model.generated + '　共 ' + pageNo + ' 页',
      M, y, { size: 8, color: C.faint, maxWidth: CW });
  }

  function sectionTitle(doc, txt, y) {
    doc.text(txt, M, y, { size: 11.5, color: C.text });
    return y + 10;
  }

  /* 表格：表头带底色，行间细分隔线，跨页自动续表头 */
  function drawTable(doc, cols, rows, y, onBreak) {
    const rowH = 22;
    const headH = 22;

    function drawHead(yy) {
      doc.rect(M, yy, CW, headH, { fill: C.headBg });
      let x = M + 6;
      cols.forEach(function (c) {
        doc.text(c.t, x, yy + 15, { size: 8.5, color: C.muted, maxWidth: c.w - 8 });
        x += c.w;
      });
      doc.line(M, yy + headH, M + CW, yy + headH, { width: 0.6, color: C.line });
      return yy + headH;
    }

    y = drawHead(y);

    if (!rows.length) {
      doc.text('暂无学生提交数据', M + 6, y + 15, { size: 9, color: C.faint });
      return y + rowH;
    }

    rows.forEach(function (r, i) {
      if (y + rowH > PAGE_H - M - 70) {
        y = onBreak();
        y = drawHead(y);
      }
      if (i % 2 === 1) doc.rect(M, y, CW, rowH, { fill: C.rowBg });

      let x = M + 6;
      cols.forEach(function (c) {
        let col = C.text;
        if (c.k === 'level') {
          col = r._level === 'red' ? C.red : r._level === 'yellow' ? C.yellow
              : r._level === 'green' ? C.green : C.text;
        } else if (c.k === 'trend') {
          col = r._dir === 'up' ? C.red : r._dir === 'down' ? C.green : C.muted;
        } else if (c.k === 'score' || c.k === 'subs') {
          col = C.muted;
        }
        doc.text(String(r[c.k] == null ? '' : r[c.k]), x, y + 15,
          { size: 8.5, color: col, maxWidth: c.w - 8 });
        x += c.w;
      });
      doc.line(M, y + rowH, M + CW, y + rowH, { width: 0.35, color: C.line });
      y += rowH;
    });

    return y;
  }

  /* 试渲染一遍，把真正要画到纸上的文字全收下来。
     手写「用到的字」清单会漏（曾经漏了 %，导致百分号显示成别的字），
     所以改成让排版自己汇报。 */
  function collectText(model) {
    const got = [];
    const fake = {
      pageW: PAGE_W, pageH: PAGE_H,
      newPage: function () {},
      text: function (s) { got.push(String(s)); return 0; },
      paragraph: function (s) { got.push(String(s)); return 0; },
      measure: function () { return 0; },
      wrap: function (s) { return [String(s)]; },
      line: function () {}, rect: function () {},
      build: function () { return Promise.resolve(new Uint8Array(0)); }
    };
    render(fake, model);
    return got.join('');
  }

  /* 截断用的省略号、缺字回退的 ? 等，可能不在正文里但要能画 */
  const SAFETY = '…—·/：（）%.,:;?!-0123456789 ';

  /* ---------------- 导出入口 ---------------- */
  async function exportClassPDF(periodKey) {
    const font = await loadFont();
    const model = collect(periodKey);

    const allText = collectText(model) + SAFETY + model.klass;
    const missing = [];
    Array.from(new Set(Array.from(allText))).forEach(function (ch) {
      if (font.cmap[ch.codePointAt(0)] == null) missing.push(ch);
    });

    const sub = RB.pdfFont.subset(font, allText);
    const doc = RB.pdfDoc.create({ font: sub, pageW: PAGE_W, pageH: PAGE_H });
    render(doc, model);
    const bytes = await doc.build();

    const name = '乡育心桥_' + model.klass + '_' + model.label + '报告_' +
      model.generated + '.pdf';
    return { bytes: bytes, filename: name, missing: missing };
  }

  function downloadPDF(result) {
    const blob = new Blob([result.bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  RB.pdfReport = {
    exportClassPDF: exportClassPDF,
    downloadPDF: downloadPDF,
    setFontBytes: setFontBytes,
    _collect: collect,
    _FONT_URL: FONT_URL
  };
})();
