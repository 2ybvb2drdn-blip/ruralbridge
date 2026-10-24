/* ============================================================
 * 乡育心桥 · RuralBridge — TrueType 解析与运行时子集
 *
 * 为什么需要运行时子集：
 *   站点里的 rb-cjk.ttf 是「应用文案 + GB2312 一级字」的合集（3900 字形，
 *   约 1MB）。若整份塞进 PDF，每份报告都会变成 1MB 以上，不适合邮件转发。
 *   而一份班级报告实际只用到一两百个不同的字，所以导出时按需裁剪，
 *   产出的 PDF 通常只有几十 KB。
 *
 * 为什么能在浏览器里做：
 *   构建期已用 fontTools 把复合字形全部展平（rb-cjk.ttf 复合字形数为 0），
 *   所以子集只需搬运 glyf 字节，不必递归解析组件。
 *
 * 对外接口：
 *   RB.pdfFont.parse(arrayBuffer) -> font
 *   RB.pdfFont.subset(font, chars) -> { bytes, gidOf, widthOf, unitsPerEm, ... }
 * ============================================================ */

(function () {
  'use strict';
  const RB = window.RB;

  function toU8(b) {
    if (b instanceof Uint8Array) return b;
    return new Uint8Array(b);
  }

  /* ---------------- 解析 ---------------- */
  function parse(buf) {
    const b = toU8(buf);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);

    const numTables = dv.getUint16(4);
    const tables = Object.create(null);
    for (let i = 0; i < numTables; i++) {
      const o = 12 + i * 16;
      const tag = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
      tables[tag] = { offset: dv.getUint32(o + 8), length: dv.getUint32(o + 12) };
    }
    ['head', 'maxp', 'hhea', 'hmtx', 'loca', 'glyf', 'cmap'].forEach(function (t) {
      if (!tables[t]) throw new Error('字体缺少 ' + t + ' 表，无法导出 PDF');
    });

    const head = tables.head.offset;
    const unitsPerEm = dv.getUint16(head + 18);
    const indexToLocFormat = dv.getInt16(head + 50);
    const bbox = [
      dv.getInt16(head + 36), dv.getInt16(head + 38),
      dv.getInt16(head + 40), dv.getInt16(head + 42)
    ];

    const numGlyphs = dv.getUint16(tables.maxp.offset + 4);
    const hhea = tables.hhea.offset;
    const numberOfHMetrics = dv.getUint16(hhea + 34);
    const ascent = dv.getInt16(hhea + 4);
    const descent = dv.getInt16(hhea + 6);

    /* loca：长格式偏移需 ×1，短格式需 ×2 */
    const locaOff = tables.loca.offset;
    const loca = new Uint32Array(numGlyphs + 1);
    for (let i = 0; i <= numGlyphs; i++) {
      loca[i] = indexToLocFormat === 0
        ? dv.getUint16(locaOff + i * 2) * 2
        : dv.getUint32(locaOff + i * 4);
    }

    /* hmtx：前 numberOfHMetrics 个含 lsb，其余复用最后一个 advance */
    const hmtxOff = tables.hmtx.offset;
    const adv = new Uint16Array(numGlyphs);
    const lsb = new Int16Array(numGlyphs);
    let lastAdv = 0;
    for (let i = 0; i < numGlyphs; i++) {
      if (i < numberOfHMetrics) {
        adv[i] = dv.getUint16(hmtxOff + i * 4);
        lsb[i] = dv.getInt16(hmtxOff + i * 4 + 2);
        lastAdv = adv[i];
      } else {
        adv[i] = lastAdv;
        lsb[i] = dv.getInt16(hmtxOff + numberOfHMetrics * 4 + (i - numberOfHMetrics) * 2);
      }
    }

    const cmap = parseCmap(b, dv, tables.cmap.offset);

    return {
      bytes: b, dv: dv, tables: tables,
      unitsPerEm: unitsPerEm, numGlyphs: numGlyphs,
      bbox: bbox, ascent: ascent, descent: descent,
      loca: loca, adv: adv, lsb: lsb, cmap: cmap,
      glyfOffset: tables.glyf.offset,
      headOffset: head
    };
  }

  /* cmap：优先 (3,10) 格式12（含增补平面），退回 (3,1) 格式4 */
  function parseCmap(b, dv, cmapOff) {
    const n = dv.getUint16(cmapOff + 2);
    let best = -1, bestScore = -1;
    for (let i = 0; i < n; i++) {
      const rec = cmapOff + 4 + i * 8;
      const pid = dv.getUint16(rec);
      const eid = dv.getUint16(rec + 2);
      const off = cmapOff + dv.getUint32(rec + 4);
      const fmt = dv.getUint16(off);
      let score = 0;
      if (pid === 3 && eid === 10 && fmt === 12) score = 4;
      else if (pid === 3 && eid === 1 && fmt === 4) score = 3;
      else if (pid === 0 && fmt === 12) score = 2;
      else if (pid === 0 && fmt === 4) score = 1;
      if (score > bestScore) { bestScore = score; best = off; }
    }
    if (best < 0) throw new Error('字体缺少可用的 Unicode cmap 子表');

    const map = Object.create(null);
    const fmt = dv.getUint16(best);

    if (fmt === 4) {
      const segX2 = dv.getUint16(best + 6);
      const segCount = segX2 / 2;
      const endO = best + 14;
      const startO = endO + segX2 + 2;
      const deltaO = startO + segX2;
      const rangeO = deltaO + segX2;
      for (let s = 0; s < segCount; s++) {
        const end = dv.getUint16(endO + s * 2);
        const start = dv.getUint16(startO + s * 2);
        const delta = dv.getInt16(deltaO + s * 2);
        const ro = dv.getUint16(rangeO + s * 2);
        if (start === 0xFFFF) continue;
        for (let c = start; c <= end && c !== 0xFFFF; c++) {
          let g;
          if (ro === 0) {
            g = (c + delta) & 0xFFFF;
          } else {
            const gi = rangeO + s * 2 + ro + (c - start) * 2;
            if (gi + 1 >= b.length) continue;
            g = dv.getUint16(gi);
            if (g !== 0) g = (g + delta) & 0xFFFF;
          }
          if (g) map[c] = g;
        }
      }
    } else if (fmt === 12) {
      const nGroups = dv.getUint32(best + 12);
      for (let i = 0; i < nGroups; i++) {
        const o = best + 16 + i * 12;
        const sc = dv.getUint32(o);
        const ec = dv.getUint32(o + 4);
        const sg = dv.getUint32(o + 8);
        for (let c = sc; c <= ec; c++) map[c] = sg + (c - sc);
      }
    } else {
      throw new Error('不支持的 cmap 格式 ' + fmt);
    }
    return map;
  }

  /* ---------------- 子集 ---------------- */
  function pad4(n) { return (n + 3) & ~3; }

  function subset(font, chars) {
    const uni = [];
    const seen = Object.create(null);
    String(chars || '').split('').forEach(function (ch) {
      const c = ch.codePointAt(0);
      if (seen[c]) return;
      if (font.cmap[c] == null) return;   // 字体没有这个字，跳过
      seen[c] = 1;
      uni.push(c);
    });
    if (!uni.length) throw new Error('没有可嵌入的字符');

    /* 新字形顺序：0 保留 .notdef，其后按码位升序 */
    const srcGids = uni.map(function (c) { return font.cmap[c]; });
    const order = [0].concat(srcGids);
    const newGid = Object.create(null);
    order.forEach(function (g, i) { newGid[g] = i; });

    const gidOf = Object.create(null);
    uni.forEach(function (c, i) { gidOf[c] = i + 1; });

    /* glyf + loca */
    const n = order.length;
    const chunks = [];
    const loca = new Uint32Array(n + 1);
    let pos = 0;
    for (let i = 0; i < n; i++) {
      const g = order[i];
      loca[i] = pos;
      const start = font.loca[g];
      const end = font.loca[g + 1];
      let len = end - start;
      if (len < 0) len = 0;
      if (len > 0) {
        const slice = font.bytes.subarray(font.glyfOffset + start, font.glyfOffset + start + len);
        const padded = new Uint8Array(pad4(len));
        padded.set(slice, 0);
        chunks.push(padded);
        pos += padded.length;
      }
    }
    loca[n] = pos;

    const glyf = new Uint8Array(pos);
    let off = 0;
    chunks.forEach(function (c) { glyf.set(c, off); off += c.length; });

    const locaBytes = new Uint8Array((n + 1) * 4);
    const lv = new DataView(locaBytes.buffer);
    for (let i = 0; i <= n; i++) lv.setUint32(i * 4, loca[i]);

    /* hmtx：numberOfHMetrics = 字形数，每个都带 advance + lsb */
    const hmtxBytes = new Uint8Array(n * 4);
    const hv = new DataView(hmtxBytes.buffer);
    const widths = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      const g = order[i];
      hv.setUint16(i * 4, font.adv[g]);
      hv.setInt16(i * 4 + 2, font.lsb[g]);
      widths[i] = font.adv[g];
    }

    /* head：改 indexToLocFormat=1（长 loca），清零校验调整值 */
    const headSrc = font.bytes.subarray(font.headOffset, font.headOffset + 54);
    const headBytes = new Uint8Array(54);
    headBytes.set(headSrc, 0);
    const hd = new DataView(headBytes.buffer);
    hd.setInt16(50, 1);
    hd.setUint32(8, 0);

    /* hhea：numberOfHMetrics 同步 */
    const hheaOff = font.tables.hhea.offset;
    const hheaBytes = new Uint8Array(36);
    hheaBytes.set(font.bytes.subarray(hheaOff, hheaOff + 36), 0);
    new DataView(hheaBytes.buffer).setUint16(34, n);

    /* maxp：numGlyphs 同步（v0.5 只有 6 字节，v1.0 有 32 字节） */
    const maxpOff = font.tables.maxp.offset;
    const maxpLen = font.tables.maxp.length >= 32 ? 32 : 6;
    const maxpBytes = new Uint8Array(maxpLen);
    maxpBytes.set(font.bytes.subarray(maxpOff, maxpOff + maxpLen), 0);
    new DataView(maxpBytes.buffer).setUint16(4, n);

    /* post v3：只保留 32 字节头，不含字形名 */
    const postBytes = new Uint8Array(32);
    new DataView(postBytes.buffer).setUint32(0, 0x00030000);

    const out = assemble([
      { tag: 'head', data: headBytes },
      { tag: 'hhea', data: hheaBytes },
      { tag: 'maxp', data: maxpBytes },
      { tag: 'hmtx', data: hmtxBytes },
      { tag: 'loca', data: locaBytes },
      { tag: 'glyf', data: glyf },
      { tag: 'post', data: postBytes }
    ]);

    return {
      bytes: out,
      gidOf: gidOf,
      widths: widths,
      numGlyphs: n,
      unitsPerEm: font.unitsPerEm,
      ascent: font.ascent,
      descent: font.descent,
      bbox: font.bbox
    };
  }

  /* ---------------- 组装 TTF ---------------- */
  function checksum(data, start, len) {
    let sum = 0;
    const end = start + len;
    for (let i = start; i < end; i += 4) {
      const a = data[i] || 0, b = data[i + 1] || 0, c = data[i + 2] || 0, d = data[i + 3] || 0;
      sum = (sum + ((a << 24) | (b << 16) | (c << 8) | d)) >>> 0;
    }
    return sum >>> 0;
  }

  function assemble(tables) {
    tables.sort(function (a, b) { return a.tag < b.tag ? -1 : (a.tag > b.tag ? 1 : 0); });
    const num = tables.length;

    let total = 12 + num * 16;
    tables.forEach(function (t) { total += pad4(t.data.length); });

    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);

    /* sfnt 头 */
    dv.setUint32(0, 0x00010000);
    dv.setUint16(4, num);
    let sr = 1, es = 0;
    while (sr * 2 <= num) { sr *= 2; es++; }
    dv.setUint16(6, sr * 16);
    dv.setUint16(8, es);
    dv.setUint16(10, num * 16 - sr * 16);

    let off = 12 + num * 16;
    let headOff = -1;
    tables.forEach(function (t, i) {
      const rec = 12 + i * 16;
      out[rec] = t.tag.charCodeAt(0);
      out[rec + 1] = t.tag.charCodeAt(1);
      out[rec + 2] = t.tag.charCodeAt(2);
      out[rec + 3] = t.tag.charCodeAt(3);
      out.set(t.data, off);
      dv.setUint32(rec + 4, checksum(out, off, pad4(t.data.length)));
      dv.setUint32(rec + 8, off);
      dv.setUint32(rec + 12, t.data.length);
      if (t.tag === 'head') headOff = off;
      off += pad4(t.data.length);
    });

    /* checkSumAdjustment = 0xB1B0AFBA - 整文件校验和 */
    if (headOff >= 0) {
      const adj = (0xB1B0AFBA - checksum(out, 0, out.length)) >>> 0;
      dv.setUint32(headOff + 8, adj);
    }
    return out;
  }

  RB.pdfFont = { parse: parse, subset: subset };
})();
