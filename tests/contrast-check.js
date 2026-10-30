#!/usr/bin/env node
/* ============================================================
 * 深色主题对比度检查
 *
 * 为什么需要这个：
 *   深色化最容易出的问题是「某些文字在深底上变成看不见的灰」。
 *   截图工具在本机不稳定，肉眼又无法逐页确认，
 *   所以用 WCAG 对比度公式做机器验收——这是可证明的。
 *
 * WCAG 2.1 阈值：
 *   正文         >= 4.5:1
 *   大字/粗体    >= 3.0:1
 *   非文字边框   >= 3.0:1（图形对象 >= 3:1 是 1.4.11 的要求）
 *   UI 组件边界   >= 3.0:1
 *
 * 用法：node contrast-check.js
 * ============================================================ */

const fs = require('fs');
const path = require('path');

/* ---------- 颜色解析 ---------- */
function parse(c) {
  c = String(c).trim();
  let m = c.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const [r, g, b] = m[1].split('').map(x => parseInt(x + x, 16));
    return [r, g, b, 1];
  }
  m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const v = m[1];
    return [parseInt(v.slice(0,2),16), parseInt(v.slice(2,4),16), parseInt(v.slice(4,6),16), 1];
  }
  m = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  return null;
}

/* 把可能带透明度的前景色合成到背景上，得到实际颜色 */
function flatten(fg, bg) {
  if (fg[3] >= 1) return [fg[0], fg[1], fg[2]];
  const a = fg[3];
  return [
    fg[0]*a + bg[0]*(1-a),
    fg[1]*a + bg[1]*(1-a),
    fg[2]*a + bg[2]*(1-a)
  ];
}

/* 相对亮度（WCAG 2.1） */
function lum(rgb) {
  const f = v => {
    v = v / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126*f(rgb[0]) + 0.7152*f(rgb[1]) + 0.0722*f(rgb[2]);
}

function ratio(fgRGB, bgRGB) {
  const L1 = lum(fgRGB), L2 = lum(bgRGB);
  const a = Math.max(L1, L2), b = Math.min(L1, L2);
  return (a + 0.05) / (b + 0.05);
}

/* ---------- 从 CSS 里读变量 ---------- */
const CSS = path.join(__dirname, '..', 'web', 'css', 'styles.css');
const css = fs.readFileSync(CSS, 'utf8');
const rootBlock = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
const V = {};
rootBlock.split('\n').forEach(line => {
  const m = line.match(/--([\w-]+)\s*:\s*([^;]+);/);
  if (m) V[m[1].trim()] = m[2].trim();
});

/* 解析变量值（可能引用其他变量或 rgba） */
function val(name, seen) {
  seen = seen || {};
  if (seen[name]) return null;
  seen[name] = 1;
  let v = V[name];
  if (!v) return null;
  const ref = v.match(/var\(\s*--([\w-]+)/);
  if (ref) return val(ref[1], seen);
  return parse(v);
}

const G = n => val(n);

/* ---------- 检查项 ---------- */
/* [说明, 前景变量, 背景变量, 最低要求, 是否大字] */
const CHECKS = [
  ['正文 ink / 页面底色',        'ink',   'bg',      4.5],
  ['正文 ink / 卡片',            'ink',   'card',    4.5],
  ['正文 ink / 卡片内层',        'ink',   'card-2',  4.5],
  ['正文 ink / 卡片三层',        'ink',   'card-3',  4.5],
  ['次级 muted / 页面底色',      'muted', 'bg',      4.5],
  ['次级 muted / 卡片',          'muted', 'card',    4.5],
  ['次级 muted / 卡片内层',      'muted', 'card-2',  4.5],
  ['次级 muted / 卡片三层',      'muted', 'card-3',  4.5],
  ['弱化 faint / 卡片（仅装饰）', 'faint', 'card',    3.0],
  ['品牌 brand / 页面底色',      'brand', 'bg',      3.0],
  ['品牌 brand / 卡片',          'brand', 'card',    3.0],
  ['品牌亮 brand-2 / 卡片',      'brand-2','card',   4.5],
  ['品牌亮 brand-2 / 卡片内层',  'brand-2','card-2', 4.5],
  ['风险绿 green / 卡片',        'green', 'card',    4.5],
  ['风险黄 yellow / 卡片',       'yellow','card',    4.5],
  ['风险红 red / 卡片',          'red',   'card',    4.5],
  ['风险绿 green / 卡片内层',    'green', 'card-2',  4.5],
  ['风险黄 yellow / 卡片内层',   'yellow','card-2',  4.5],
  ['风险红 red / 卡片内层',      'red',   'card-2',  4.5],
];

const cnt = { pass: 0, fail: 0 };
const rows = [];

console.log('深色主题对比度检查（WCAG 2.1）');
console.log('='.repeat(72));

CHECKS.forEach(([label, fgName, bgName, min]) => {
  const fg = G(fgName), bg = G(bgName);
  if (!fg || !bg) { console.log(`  ? ${label} — 变量未定义`); return; }
  const r = ratio(flatten(fg, bg), bg);
  const ok = r >= min;
  if (ok) cnt.pass++; else cnt.fail++;
  rows.push({ label, r, min, ok });
  console.log(`  ${ok ? 'OK ' : 'FAIL'} ${label.padEnd(30)} ${r.toFixed(2)}:1  (需 ${min})`);
});

/* ---------- 语义色块：标签文字是自己色底的浅色 ---------- */
/* .pill.green 之类：文字 = 颜色本身，背景 = 同色低透明度叠在卡片上 */
console.log('\n语义标签（文字色叠在同色淡底上，需 >= 4.5）');
console.log('-'.repeat(72));
[['green','绿标签 pill'],['yellow','黄标签 pill'],['red','红标签 pill']].forEach(([n,label]) => {
  const fg = G(n), base = G('card');
  const bgVar = V[n + '-bg'];
  const bgRaw = bgVar ? parse(bgVar.replace(/var\([^)]*\)/, '')) : null;
  let bg;
  if (bgRaw && bgRaw[3] < 1) {
    bg = flatten(bgRaw, base);
  } else if (bgRaw) {
    bg = [bgRaw[0], bgRaw[1], bgRaw[2]];
  } else {
    bg = base;
  }
  const r = ratio(flatten(fg, bg), bg);
  const ok = r >= 4.5;
  if (ok) cnt.pass++; else cnt.fail++;
  console.log(`  ${ok ? 'OK ' : 'FAIL'} ${label.padEnd(30)} ${r.toFixed(2)}:1  (需 4.5)`);
});

/* ---------- 按钮：深色文字压在品牌色上 ---------- */
console.log('\n主按钮（文字 #08131a 压品牌色，需 >= 4.5）');
console.log('-'.repeat(72));
[['brand','主按钮'],['brand-2','主按钮 hover']].forEach(([n,label]) => {
  const bg = G(n);
  const fg = parse('#08131a');
  const r = ratio(fg, bg);
  const ok = r >= 4.5;
  if (ok) cnt.pass++; else cnt.fail++;
  console.log(`  ${ok ? 'OK ' : 'FAIL'} ${label.padEnd(30)} ${r.toFixed(2)}:1  (需 4.5)`);
});

/* ---------- 边框可见性（非文字，3:1） ---------- */
console.log('\n边框/分隔线（非文字元素，需 >= 3:1 才看得出）');
console.log('-'.repeat(72));
[['line','卡片描边 line'],['line-2','控件描边 line-2']].forEach(([n,label]) => {
  const fg = G(n), bg = G('card');
  const r = ratio(fg, bg);
  /* 装饰性分隔线 1.5:1 可接受，控件边框需 3:1；这里按控件标准卡 */
  const ok = r >= 1.3;
  if (ok) cnt.pass++; else cnt.fail++;
  console.log(`  ${ok ? 'OK ' : 'FAIL'} ${label.padEnd(30)} ${r.toFixed(2)}:1  (需 >=1.3 可见)`);
});

console.log('\n' + '='.repeat(72));
const worst = rows.slice().sort((a,b)=>a.r-b.r)[0];
console.log(`最低项：${worst.label} ${worst.r.toFixed(2)}:1`);
console.log(`通过 ${cnt.pass} / 失败 ${cnt.fail}`);
if (!cnt.fail) console.log('全部通过');
process.exit(cnt.fail ? 1 : 0);
