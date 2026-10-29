#!/usr/bin/env node
/* ============================================================
 * 乡育心桥 · RuralBridge — 测试运行器
 *
 * 用法：
 *   npm test              跑全部
 *   npm test -- pdf       只跑文件名含 pdf 的
 *   node run-all.js --list  列出所有测试
 *
 * 每个测试文件都是独立的 node 脚本，自己输出「通过 N / 失败 M」。
 * 这里负责汇总，并把任一失败作为非零退出码，
 * 便于以后接 CI。
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DIR = __dirname;
const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
const listOnly = process.argv.indexOf('--list') !== -1;

/* 执行顺序：基础 → 功能 → 集成。失败时能更快定位。 */
const ORDER = [
  'regress.js',        // 登录、路由、三端视图、问卷、引擎
  'modal.js',          // 手工录入弹窗
  'source.js',         // 来源标签与执行率
  'recheck.js',        // 滚动容器 + 优先级
  'cleardone.js',      // 已完成栏清空与归档
  'badge.js',          // 标签栏角标
  'toolbox.js',        // 专业工具箱 / 知识库检索
  'scaletest.js',      // 量表派发、填写、计分
  'qualitytest.js',    // 数据质量提示
  'report.js',         // 班级报告页
  'pdfgen.js',         // 班级报告 PDF
  'refpdf.js',         // 转介单 PDF
  'rminsights.js',     // 概览页信息密度
  'scrollbox.js',      // 滚动样式
];

function files() {
  const all = fs.readdirSync(DIR).filter(f => f.endsWith('.js') && f !== 'run-all.js');
  const ordered = ORDER.filter(f => all.indexOf(f) !== -1);
  const rest = all.filter(f => ORDER.indexOf(f) === -1);
  return ordered.concat(rest);
}

function runOne(file) {
  return new Promise(resolve => {
    const t0 = Date.now();
    execFile(process.execPath, [path.join(DIR, file)], { cwd: DIR, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = (stdout || '') + (stderr || '');
        const passM = out.match(/通过\s*(\d+)\s*\/\s*失败\s*(\d+)/);
        const fails = out.split('\n').filter(l => /^\s*[X✗]/.test(l)).map(l => l.trim());
        resolve({
          file,
          ok: err ? false : (passM ? Number(passM[2]) === 0 : false),
          pass: passM ? Number(passM[1]) : 0,
          fail: passM ? Number(passM[2]) : 0,
          ms: Date.now() - t0,
          crashes: !passM,
          fails,
          tail: out.trim().split('\n').slice(-3).join(' | ')
        });
      });
  });
}

(async () => {
  let targets = files();
  if (only.length) {
    targets = targets.filter(f => only.some(k => f.indexOf(k) !== -1));
  }

  if (listOnly) {
    console.log('可用测试：');
    targets.forEach(f => console.log('  ' + f));
    return;
  }

  if (!targets.length) {
    console.log('没有匹配的测试文件');
    process.exit(1);
  }

  console.log('乡育心桥 · 回归测试');
  console.log('='.repeat(58));

  let totalPass = 0, totalFail = 0, bad = [];

  for (const f of targets) {
    process.stdout.write(f.padEnd(20));
    const r = await runOne(f);
    if (r.ok) {
      console.log(`通过 ${String(r.pass).padStart(3)} 项  ${(r.ms / 1000).toFixed(1)}s  OK`);
    } else {
      console.log(`通过 ${r.pass} / 失败 ${r.fail}  ${(r.ms / 1000).toFixed(1)}s  FAIL`);
      if (r.crashes) console.log('    崩溃或未输出统计：' + r.tail);
      r.fails.slice(0, 6).forEach(x => console.log('    ' + x));
      bad.push(f);
    }
    totalPass += r.pass;
    totalFail += r.fail;
  }

  console.log('='.repeat(58));
  console.log(`合计：通过 ${totalPass} / 失败 ${totalFail}，${targets.length} 个文件`);

  if (bad.length) {
    console.log('失败文件：' + bad.join(', '));
    process.exit(1);
  }
  console.log('全部通过');
})();
