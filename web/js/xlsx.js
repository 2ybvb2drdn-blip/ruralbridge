/* ============================================================
 * 乡育心桥 · RuralBridge — 极简 XLSX 生成器
 *
 * 为什么自己写：
 *   项目约束是「纯前端生成文件，不依赖后端与第三方库，离线可用」
 *   （见 report.js 头部设计原则）。引入 SheetJS 之类会多出 400KB+
 *   依赖，且需要 CDN 或打包，与离线可用冲突。
 *
 * 实现要点：
 *   XLSX 本质是一个 ZIP，里面装几个固定结构的 XML。
 *   ZIP 用「存储」模式（method=0，不压缩），所以不需要实现 deflate，
 *   只需要 CRC32。文件会比压缩版大，但几百行数据完全可接受，
 *   Excel / WPS / Numbers 都能正常打开。
 *
 * 对外接口：
 *   RB.xlsx.build([{ name, rows, widths }]) -> Uint8Array
 *     rows   二维数组，单元格可为 string / number / null
 *     widths 可选，各列宽度（字符数）
 *   第一行按表头处理（加粗）。
 * ============================================================ */

(function () {
  'use strict';
  const RB = window.RB;

  const enc = new TextEncoder();

  /* ---------- CRC32（ZIP 必需） ---------- */
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- ZIP 打包（存储模式） ---------- */
  function zipStore(files) {
    const parts = [];       // 依次拼接的字节块
    const central = [];
    let offset = 0;

    files.forEach(function (f) {
      const nameB = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const size = data.length;

      /* 本地文件头 30 字节 + 文件名 */
      const local = new Uint8Array(30 + nameB.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);   // 签名
      lv.setUint16(4, 20, true);           // 解压所需版本
      lv.setUint16(6, 0x0800, true);       // 标志位：文件名 UTF-8
      lv.setUint16(8, 0, true);            // 压缩方法 0 = 存储
      lv.setUint16(10, 0, true);           // 修改时间
      lv.setUint16(12, 0x21, true);        // 修改日期（1980-01-01）
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);        // 压缩后大小
      lv.setUint32(22, size, true);        // 原始大小
      lv.setUint16(26, nameB.length, true);
      lv.setUint16(28, 0, true);           // 扩展字段长度
      local.set(nameB, 30);

      parts.push(local, data);

      /* 中央目录项 46 字节 + 文件名 */
      const cen = new Uint8Array(46 + nameB.length);
      const cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);           // 创建版本
      cv.setUint16(6, 20, true);           // 解压所需版本
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameB.length, true);
      cv.setUint16(30, 0, true);           // 扩展字段
      cv.setUint16(32, 0, true);           // 注释
      cv.setUint16(34, 0, true);           // 起始磁盘
      cv.setUint16(36, 0, true);           // 内部属性
      cv.setUint32(38, 0, true);           // 外部属性
      cv.setUint32(42, offset, true);      // 本地头偏移
      cen.set(nameB, 46);
      central.push(cen);

      offset += local.length + size;
    });

    const cdSize = central.reduce(function (n, c) { return n + c.length; }, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    const all = parts.concat(central, [eocd]);
    const total = all.reduce(function (n, p) { return n + p.length; }, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  /* ---------- XML 工具 ---------- */
  function xmlEsc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      /* 去掉 XML 不允许的控制字符，否则 Excel 会报文件损坏 */
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  /* 列号转字母：1→A，27→AA */
  function colName(n) {
    let s = '';
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function sheetXml(rows, widths) {
    const maxCols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);

    let cols = '';
    if (widths && widths.length) {
      cols = '<cols>' + widths.map(function (w, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
      }).join('') + '</cols>';
    }

    const body = rows.map(function (row, ri) {
      const r = ri + 1;
      const cells = row.map(function (v, ci) {
        const ref = colName(ci + 1) + r;
        if (v === null || v === undefined || v === '') {
          return '<c r="' + ref + '"/>';
        }
        /* 数字走数值单元格，其余走内联字符串（省掉 sharedStrings） */
        if (typeof v === 'number' && isFinite(v)) {
          return '<c r="' + ref + '"' + (ri === 0 ? ' s="1"' : '') + '><v>' + v + '</v></c>';
        }
        return '<c r="' + ref + '" t="inlineStr"' + (ri === 0 ? ' s="1"' : '') +
          '><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
      }).join('');
      return '<row r="' + r + '">' + cells + '</row>';
    }).join('');

    /* 冻结首行：表头始终可见 */
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '</sheetView></sheetViews>' +
      cols +
      '<sheetData>' + body + '</sheetData>' +
      (maxCols ? '' : '') +
      '</worksheet>';
  }

  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2">' +
    '<font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '</cellXfs>' +
    /* 必须声明默认命名样式，否则部分 Excel 版本会提示「文件需要修复」 */
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function build(sheets) {
    const list = sheets || [];
    const n = Math.max(1, list.length);

    const sheetFiles = [];
    const overrides = [];
    const rels = [];
    const sheetTags = [];

    for (let i = 0; i < n; i++) {
      const s = list[i] || { name: 'Sheet1', rows: [['']] };
      const idx = i + 1;
      sheetFiles.push({
        name: 'xl/worksheets/sheet' + idx + '.xml',
        data: enc.encode(sheetXml(s.rows || [['']], s.widths))
      });
      overrides.push('<Override PartName="/xl/worksheets/sheet' + idx +
        '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
      rels.push('<Relationship Id="rId' + idx +
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
        idx + '.xml"/>');
      /* 工作表名不能含 : \ / ? * [ ] 且不超过 31 字符 */
      const nm = String(s.name || ('Sheet' + idx)).replace(/[:\\\/?*\[\]]/g, '_').slice(0, 31);
      sheetTags.push('<sheet name="' + xmlEsc(nm) + '" sheetId="' + idx + '" r:id="rId' + idx + '"/>');
    }

    const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      overrides.join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';

    const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + sheetTags.join('') + '</sheets>' +
      '</workbook>';

    const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels.join('') +
      '<Relationship Id="rId' + (n + 1) +
      '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    const files = [
      { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
      { name: '_rels/.rels', data: enc.encode(rootRels) },
      { name: 'xl/workbook.xml', data: enc.encode(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) },
      { name: 'xl/styles.xml', data: enc.encode(STYLES) }
    ].concat(sheetFiles);

    return zipStore(files);
  }

  RB.xlsx = { build: build, _crc32: crc32, _zipStore: zipStore };
})();
