/* ============================================================
 * 乡育心桥 · RuralBridge — 极简 PDF 生成器
 *
 * 不引第三方库（jsPDF / pdfmake 都要 200KB+，与「离线可用」冲突），
 * 直接按 ISO 32000 拼 PDF 对象。
 *
 * 字体：CIDFontType2 + Identity-H
 *   - 文字按 2 字节 GID 写入，字形数据来自 pdffont.js 的运行时子集
 *   - 因此 PDF 里只带真正用到的字，通常几十 KB
 *
 * 坐标：对外用「左上角为原点、y 向下」，内部换算成 PDF 的左下角原点。
 * ============================================================ */

(function () {
  'use strict';
  const RB = window.RB;

  const enc = new TextEncoder();

  /* 有 CompressionStream 就压，没有就不压（PDF 仍合法，只是更大）。
     直接用 writer/reader 读写，不走 Blob.stream()——后者在部分环境缺失，
     一旦抛错会被吞掉，导致「以为压了其实没压」。 */
  async function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const cs = new CompressionStream('deflate');
      const writer = cs.writable.getWriter();
      writer.write(bytes);
      writer.close();

      const reader = cs.readable.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        chunks.push(r.value);
        total += r.value.length;
      }
      const out = new Uint8Array(total);
      let p = 0;
      chunks.forEach(function (c) { out.set(c, p); p += c.length; });
      return out;
    } catch (e) {
      return null;
    }
  }

  function latin1(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xFF;
    return out;
  }

  function num(n) {
    /* PDF 数值不要科学计数法，最多 2 位小数 */
    const v = Math.round(n * 100) / 100;
    return String(v);
  }

  function hex4(n) {
    return (n < 16 ? '000' : n < 256 ? '00' : n < 4096 ? '0' : '') + n.toString(16);
  }

  /* 生成 ToUnicode CMap：GID -> Unicode，让 PDF 里的中文可复制、可搜索 */
  function buildToUnicode(font) {
    const pairs = [];
    Object.keys(font.gidOf).forEach(function (k) {
      const cp = Number(k);
      const gid = font.gidOf[k];
      let dst;
      if (cp > 0xFFFF) {
        /* 增补平面需用 UTF-16 代理对（8 位十六进制） */
        const v = cp - 0x10000;
        const hi = 0xD800 + (v >> 10);
        const lo = 0xDC00 + (v & 0x3FF);
        dst = hex4(hi) + hex4(lo);
      } else {
        dst = hex4(cp);
      }
      pairs.push('<' + hex4(gid) + '> <' + dst + '>');
    });
    /* 缺失字统一退回 '?' 的那个 GID，也要给出映射 */
    const qGid = font.gidOf[63];
    if (qGid != null) pairs.push('<' + hex4(qGid) + '> <003F>');

    let body = '';
    for (let i = 0; i < pairs.length; i += 100) {
      const chunk = pairs.slice(i, i + 100);
      body += chunk.length + ' beginbfchar\n' + chunk.join('\n') + '\nendbfchar\n';
    }

    return '/CIDInit /ProcSet findresource begin\n' +
      '12 dict begin\n' +
      'begincmap\n' +
      '/CIDSystemInfo <</Registry (Adobe) /Ordering (UCS) /Supplement 0>> def\n' +
      '/CMapName /Adobe-Identity-UCS def\n' +
      '/CMapType 2 def\n' +
      '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
      body +
      'endcmap\n' +
      'CMapName currentdict /CMap defineresource pop\n' +
      'end\nend\n';
  }

  /* ---------------- 文档 ---------------- */
  function create(opts) {
    const o = opts || {};
    const font = o.font;
    const pageW = o.pageW || 595.28;   // A4
    const pageH = o.pageH || 841.89;

    const objs = [];        // 1-based：objs[i-1] 是对象 i
    function reserve() { objs.push(null); return objs.length; }
    function set(id, body) { objs[id - 1] = body; }

    const pages = [];       // { id, content: [ops] }

    const catalogId = reserve();
    const pagesId = reserve();

    /* 字体对象 id 预留 */
    const fontId = reserve();
    const cidFontId = reserve();
    const descId = reserve();
    const fileId = reserve();

    /* 全局内容缓冲，按页切换 */
    let ops = [];

    function newPage() {
      const id = reserve();
      pages.push({ id: id, ops: ops = [] });
      return id;
    }

    /* ---- 度量 ---- */
    const upem = font.unitsPerEm || 1000;
    function measure(str, size) {
      let w = 0;
      for (const ch of String(str)) {
        const g = font.gidOf[ch.codePointAt(0)];
        if (g == null) { w += upem * 0.5; continue; }
        w += font.widths[g];
      }
      return w / upem * size;
    }

    /* ---- 绘制原语（y 从页面顶部往下） ---- */
    function ty(y) { return pageH - y; }

    function text(str, x, y, st) {
      const s = st || {};
      const size = s.size || 10;
      const color = s.color || [0.1, 0.12, 0.15];
      let t = String(str);
      if (s.maxWidth) t = ellipsis(t, s.maxWidth, size);

      const gids = [];
      for (const ch of t) {
        const g = font.gidOf[ch.codePointAt(0)];
        gids.push(g == null ? font.gidOf[63] || 1 : g);   // 缺失字退回 '?'
      }
      if (!gids.length) return 0;

      const hex = gids.map(hex4).join('');
      ops.push('BT');
      ops.push(num(color[0]) + ' ' + num(color[1]) + ' ' + num(color[2]) + ' rg');
      ops.push('/F1 ' + num(size) + ' Tf');
      ops.push('1 0 0 1 ' + num(x) + ' ' + num(ty(y) - size * 0.8) + ' Tm');
      ops.push('<' + hex + '> Tj');
      ops.push('ET');
      return measure(t, size);
    }

    /* 自动换行，返回实际占用高度 */
    function paragraph(str, x, y, maxW, st) {
      const s = st || {};
      const size = s.size || 10;
      const lh = s.lineHeight || size * 1.6;
      const lines = wrap(String(str), maxW, size);
      lines.forEach(function (ln, i) { text(ln, x, y + i * lh, s); });
      return lines.length * lh;
    }

    function wrap(str, maxW, size) {
      const out = [];
      let cur = '';
      for (const ch of String(str)) {
        if (ch === '\n') { out.push(cur); cur = ''; continue; }
        const test = cur + ch;
        if (measure(test, size) > maxW && cur) { out.push(cur); cur = ch; }
        else cur = test;
      }
      if (cur) out.push(cur);
      return out.length ? out : [''];
    }

    function ellipsis(str, maxW, size) {
      if (measure(str, size) <= maxW) return str;
      const arr = Array.from(str);
      while (arr.length && measure(arr.join('') + '…', size) > maxW) arr.pop();
      return arr.join('') + '…';
    }

    function line(x1, y1, x2, y2, st) {
      const s = st || {};
      ops.push(num(s.width || 0.5) + ' w');
      const c = s.color || [0.8, 0.84, 0.88];
      ops.push(num(c[0]) + ' ' + num(c[1]) + ' ' + num(c[2]) + ' RG');
      ops.push(num(x1) + ' ' + num(ty(y1)) + ' m ' + num(x2) + ' ' + num(ty(y2)) + ' l S');
    }

    function rect(x, y, w, h, st) {
      const s = st || {};
      const yy = ty(y + h);
      if (s.fill) {
        ops.push(num(s.fill[0]) + ' ' + num(s.fill[1]) + ' ' + num(s.fill[2]) + ' rg');
        ops.push(num(x) + ' ' + num(yy) + ' ' + num(w) + ' ' + num(h) + ' re f');
      }
      if (s.stroke) {
        ops.push(num(s.width || 0.5) + ' w');
        ops.push(num(s.stroke[0]) + ' ' + num(s.stroke[1]) + ' ' + num(s.stroke[2]) + ' RG');
        ops.push(num(x) + ' ' + num(yy) + ' ' + num(w) + ' ' + num(h) + ' re S');
      }
    }

    /* ---------------- 输出 ---------------- */
    async function build() {
      /* 1) 页面内容流 */
      const contentIds = [];
      for (const pg of pages) {
        const raw = enc.encode(pg.ops.join('\n'));
        const z = await deflate(raw);
        const data = z || raw;
        const id = reserve();
        const dict = z
          ? '<</Length ' + data.length + '/Filter/FlateDecode>>'
          : '<</Length ' + data.length + '>>';
        set(id, { dict: dict, stream: data });
        contentIds.push(id);
      }

      /* 2) 页对象 */
      const kids = pages.map(function (pg, i) {
        return '<</Type/Page/Parent ' + pagesId + ' 0 R/MediaBox[0 0 ' +
          num(pageW) + ' ' + num(pageH) + ']/Resources<</Font<</F1 ' + fontId +
          ' 0 R>>>>/Contents ' + contentIds[i] + ' 0 R>>';
      });
      pages.forEach(function (pg, i) { set(pg.id, kids[i]); });

      /* 3) ToUnicode 映射：没有它，复制粘贴和搜索会得到乱码 */
      const toUniId = reserve();
      const cmapText = buildToUnicode(font);
      const cmapRaw = enc.encode(cmapText);
      const cmapZ = await deflate(cmapRaw);
      const cmapData = cmapZ || cmapRaw;
      set(toUniId, {
        dict: cmapZ
          ? '<</Length ' + cmapData.length + '/Filter/FlateDecode>>'
          : '<</Length ' + cmapData.length + '>>',
        stream: cmapData
      });

      /* 4) 字体 */
      set(fontId, '<</Type/Font/Subtype/Type0/BaseFont/RBCJK/Encoding/Identity-H' +
        '/ToUnicode ' + toUniId + ' 0 R' +
        '/DescendantFonts[' + cidFontId + ' 0 R]>>');

      /* 宽度数组：紧凑写法 [gid [w w ...]]，把相邻等宽的字形合成一段 */
      const wArray = [];
      const ws = font.widths;
      let k = 0;
      while (k < ws.length) {
        let m = k;
        while (m + 1 < ws.length && ws[m + 1] === ws[k]) m++;
        if (m > k) {
          const vals = [];
          for (let q = k; q <= m; q++) vals.push(ws[q]);
          wArray.push(k + ' [' + vals.join(' ') + ']');
        } else {
          wArray.push(k + ' [' + ws[k] + ']');
        }
        k = m + 1;
      }

      const scale = 1000 / upem;
      const bb = font.bbox;
      const bbox = [
        Math.round(bb[0] * scale), Math.round(bb[1] * scale),
        Math.round(bb[2] * scale), Math.round(bb[3] * scale)
      ];

      set(cidFontId, '<</Type/Font/Subtype/CIDFontType2/BaseFont/RBCJK' +
        '/CIDSystemInfo<</Registry(Adobe)/Ordering(Identity)/Supplement 0>>' +
        '/FontDescriptor ' + descId + ' 0 R/DW 1000/CIDToGIDMap/Identity' +
        '/W[' + wArray.join('') + ']>>');

      set(descId, '<</Type/FontDescriptor/FontName/RBCJK/Flags 4' +
        '/FontBBox[' + bbox.join(' ') + ']' +
        '/ItalicAngle 0/Ascent ' + Math.round(font.ascent * scale) +
        '/Descent ' + Math.round(font.descent * scale) +
        '/CapHeight ' + Math.round(font.ascent * scale) +
        '/StemV 80/FontFile2 ' + fileId + ' 0 R>>');

      /* 5) 字体文件（压缩） */
      const fz = await deflate(font.bytes);
      const fdata = fz || font.bytes;
      set(fileId, {
        dict: fz
          ? '<</Length ' + fdata.length + '/Length1 ' + font.bytes.length + '/Filter/FlateDecode>>'
          : '<</Length ' + fdata.length + '/Length1 ' + font.bytes.length + '>>',
        stream: fdata
      });

      /* 6) 目录与页树 */
      set(catalogId, '<</Type/Catalog/Pages ' + pagesId + ' 0 R>>');
      set(pagesId, '<</Type/Pages/Kids[' + pages.map(function (p) { return p.id + ' 0 R'; }).join('') +
        ']/Count ' + pages.length + '>>');

      /* 7) 拼文件 */
      const chunks = [];
      let len = 0;
      function push(x) { chunks.push(x); len += x.length; }

      push(latin1('%PDF-1.7\n'));
      push(latin1('%\xE2\xE3\xCF\xD3\n'));   // 二进制标记，提示工具按二进制处理

      const offsets = new Array(objs.length + 1).fill(0);
      for (let idx = 0; idx < objs.length; idx++) {
        const id = idx + 1;
        const body = objs[idx];
        offsets[id] = len;
        push(latin1(id + ' 0 obj\n'));
        if (body && typeof body === 'object') {
          push(latin1(body.dict + '\nstream\n'));
          push(body.stream);
          push(latin1('\nendstream\nendobj\n'));
        } else {
          push(latin1((body || '<</Type/Pages/Kids[]/Count 0>>') + '\nendobj\n'));
        }
      }

      const xrefPos = len;
      let xref = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
      for (let id = 1; id <= objs.length; id++) {
        xref += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
      }
      push(latin1(xref));
      push(latin1('trailer\n<</Size ' + (objs.length + 1) + '/Root ' + catalogId +
        ' 0 R>>\nstartxref\n' + xrefPos + '\n%%EOF\n'));

      const out = new Uint8Array(len);
      let p = 0;
      chunks.forEach(function (c) { out.set(c, p); p += c.length; });
      return out;
    }

    return {
      pageW: pageW, pageH: pageH,
      newPage: newPage,
      text: text, paragraph: paragraph, wrap: wrap, measure: measure,
      line: line, rect: rect,
      build: build
    };
  }

  RB.pdfDoc = { create: create };
})();
