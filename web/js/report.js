/* ============================================================
 * 乡育心桥 · RuralBridge — 报告层
 * 职责：
 *   1) 时间段切片（本周 / 本月 / 全部）
 *   2) 学生个体周报 / 月报计算（基于真实提交，无数据就如实说明）
 *   3) 变化追踪（对比同一学生多次提交的等级与分数）
 *   4) 导出：Word（.doc，Word 兼容 HTML）/ CSV
 *
 * 设计原则：
 *   - 只用 RB.state.data.submissions 里的真实记录，绝不编造趋势
 *   - 记录不足以支撑结论时，明确写出"样本不足"，不强行给结论
 *   - 纯前端生成文件，不依赖后端与第三方库，离线可用
 * ============================================================ */

(function () {
  'use strict';
  const RB = window.RB;
  const U = RB.ui;
  const esc = U.esc;
  const LV = U.LV;

  const DAY = 86400000;

  /* ---------------- 时间段 ---------------- */
  const PERIODS = {
    week:  { key:'week',  label:'本周',  days:7  },
    month: { key:'month', label:'本月',  days:30 },
    all:   { key:'all',   label:'全部',  days:0  }
  };

  /** 按时间段筛选提交记录（days=0 表示不限） */
  function inPeriod(sub, days, now) {
    if (!days) return true;
    const t = Number(sub.createdAt) || 0;
    return (now || Date.now()) - t <= days * DAY;
  }

  function periodOf(key) { return PERIODS[key] || PERIODS.week; }

  /** 某学生在指定时间段内的提交，按时间正序（旧→新，便于看变化） */
  function subsOf(user, days, now) {
    const all = (RB.state.data && RB.state.data.submissions) || [];
    return all
      .filter(s => s.user === user && inPeriod(s, days, now))
      .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
  }

  /* ---------------- 变化追踪 ---------------- */
  const RANK = { green: 0, yellow: 1, red: 2 };

  /**
   * 对比同一学生的提交序列，得出变化方向。
   * 少于 2 条时返回 null，调用方必须如实显示"样本不足"。
   */
  function trendOf(list) {
    if (!list || list.length < 2) return null;
    const first = list[0];
    const last = list[list.length - 1];
    const r0 = RANK[first.level] != null ? RANK[first.level] : 0;
    const r1 = RANK[last.level] != null ? RANK[last.level] : 0;

    let dir, txt;
    if (r1 > r0) { dir = 'up'; txt = '风险上升'; }
    else if (r1 < r0) { dir = 'down'; txt = '风险下降'; }
    else { dir = 'flat'; txt = '风险等级持平'; }

    return {
      dir,
      txt,
      from: first.level,
      to: last.level,
      scoreFrom: Number(first.score) || 0,
      scoreTo: Number(last.score) || 0,
      scoreDelta: (Number(last.score) || 0) - (Number(first.score) || 0),
      samples: list.length,
      firstAt: first.createdAt,
      lastAt: last.createdAt
    };
  }

  /** 汇总一组提交：次数、等级分布、出现过的信号、最高风险 */
  function summarize(list) {
    const byType = { questionnaire:0, record:0 };
    const signals = [];
    let worst = 'green';
    let scoreSum = 0;

    list.forEach(s => {
      if (byType[s.type] != null) byType[s.type]++;
      if (RANK[s.level] > RANK[worst]) worst = s.level;
      scoreSum += Number(s.score) || 0;
      (s.evidence || []).forEach(e => {
        const t = String(e).slice(0, 60);
        if (t && signals.indexOf(t) === -1 && signals.length < 8) signals.push(t);
      });
    });

    return {
      count: list.length,
      byType,
      worst,
      avgScore: list.length ? Math.round(scoreSum / list.length) : 0,
      signals,
      types: Object.keys(byType).filter(k => byType[k] > 0)
    };
  }

  /* ---------------- 班级层面汇总 ---------------- */
  /** 班级在指定时间段内的整体情况 */
  function classSummary(days, now) {
    const d = RB.state.data || {};
    const S = d.students || [];
    const nowTs = now || Date.now();

    const subs = (d.submissions || []).filter(s => inPeriod(s, days, nowTs));
    const activeUsers = {};
    subs.forEach(s => { activeUsers[s.user] = 1; });

    /* 当前状态仍取每人最近一次（不受时间段限制，反映"现在"） */
    const red = S.filter(s => s.level === 'red').length;
    const yellow = S.filter(s => s.level === 'yellow').length;
    const green = S.filter(s => s.level === 'green').length;

    /* 时间段内等级变化人数 */
    let up = 0, down = 0, flat = 0, insufficient = 0;
    S.forEach(stu => {
      const list = subsOf(stu.user, days, nowTs);
      const tr = trendOf(list);
      if (!tr) { insufficient++; return; }
      if (tr.dir === 'up') up++;
      else if (tr.dir === 'down') down++;
      else flat++;
    });

    return {
      days,
      total: S.length,
      red, yellow, green,
      subsCount: subs.length,
      activeCount: Object.keys(activeUsers).length,
      up, down, flat, insufficient,
      coverage: S.length ? Math.round(Object.keys(activeUsers).length / S.length * 100) : 0
    };
  }

  /* ---------------- 文件导出 ---------------- */

  /** 下载任意文本内容 */
  function download(filename, content, mime) {
    const blob = new Blob(['\ufeff' + content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Word 兼容 HTML 的公共样式：中文报告用宋体/黑体，表格带边框 */
  const DOC_STYLE = `
    body { font-family:"宋体",SimSun,serif; font-size:10.5pt; line-height:1.7; color:#000; }
    h1 { font-family:"黑体",SimHei,sans-serif; font-size:18pt; text-align:center; margin:0 0 6pt; }
    h2 { font-family:"黑体",SimHei,sans-serif; font-size:13pt; margin:16pt 0 6pt;
         border-bottom:1px solid #999; padding-bottom:3pt; }
    h3 { font-family:"黑体",SimHei,sans-serif; font-size:11pt; margin:10pt 0 4pt; }
    .meta { text-align:center; color:#555; font-size:9pt; margin-bottom:14pt; }
    table { border-collapse:collapse; width:100%; font-size:9.5pt; margin:6pt 0; }
    th,td { border:1px solid #666; padding:4pt 6pt; text-align:left; vertical-align:top; }
    th { background:#eef2f6; font-family:"黑体",SimHei,sans-serif; }
    .k { color:#444; }
    .warn { color:#b3261e; font-weight:bold; }
    .ok { color:#1b6b3a; }
    ul { margin:4pt 0 4pt 18pt; padding:0; }
    li { margin:2pt 0; }
    .foot { margin-top:18pt; padding-top:6pt; border-top:1px solid #bbb;
            font-size:8.5pt; color:#666; }
  `;

  /** 包一层 Word 可识别的 HTML */
  function wrapDoc(title, body) {
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>${DOC_STYLE}</style></head><body>${body}</body></html>`;
  }

  function today() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /** 班级名：数据接口不返回，取当前登录账号的 klass */
  function klassName() {
    const u = RB.state && RB.state.user;
    return (u && u.klass) || '本班';
  }

  function fmtDate(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function fmtTime(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    const p = n => String(n).padStart(2, '0');
    return fmtDate(ms) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---- 班级报告 Word ---- */
  function exportClassDoc(periodKey) {
    const p = periodOf(periodKey);
    const c = classSummary(p.days);
    const d = RB.state.data || {};
    const S = d.students || [];
    const acts = (RB.actions && RB.actions.all) ? RB.actions.all() : [];

    const rows = S.map(s => {
      const list = subsOf(s.user, p.days);
      const tr = trendOf(list);
      const trTxt = tr ? tr.txt + '（' + LV[tr.from].short + ' → ' + LV[tr.to].short + '）' : '样本不足';
      return `<tr>
        <td>${esc(s.user)}</td><td>${esc(s.name)}</td>
        <td>${esc(LV[s.level].txt)}</td><td>${s.score}</td>
        <td>${esc((s.tags || []).join('、') || '—')}</td>
        <td>${list.length}</td><td>${esc(trTxt)}</td>
      </tr>`;
    }).join('');

    const actRows = acts.slice(0, 30).map(a => {
      const pr = a.priority || 'P2';
      return `<tr><td>${esc(pr)}</td><td>${esc(a.text)}</td>
        <td>${esc(a.target || '全班')}</td>
        <td>${a.done ? '已完成' : (a.due ? '截止 ' + esc(a.due) : '待执行')}</td></tr>`;
    }).join('');

    const body = `
      <h1>${esc(klassName())} 心理健康状况报告</h1>
      <div class="meta">报告周期：${esc(p.label)} · 生成时间：${fmtTime(Date.now())}</div>

      <h2>一、班级整体情况</h2>
      <table>
        <tr><th>已提交人数</th><th>红色 · 需干预</th><th>黄色 · 需关注</th><th>绿色 · 状态良好</th></tr>
        <tr><td>${c.total} 人</td><td class="warn">${c.red} 人</td><td>${c.yellow} 人</td><td class="ok">${c.green} 人</td></tr>
      </table>
      <p>${esc(p.label)}内共收到 <b>${c.subsCount}</b> 条提交，覆盖 <b>${c.activeCount}</b> 名学生
      （覆盖率 ${c.coverage}%）。</p>

      <h3>周期内变化</h3>
      <table>
        <tr><th>风险上升</th><th>风险下降</th><th>等级持平</th><th>样本不足</th></tr>
        <tr><td class="warn">${c.up} 人</td><td class="ok">${c.down} 人</td><td>${c.flat} 人</td><td>${c.insufficient} 人</td></tr>
      </table>
      ${c.insufficient ? '<p class="k">注：样本不足指该学生在周期内提交少于 2 次，无法判断变化方向。</p>' : ''}

      <h2>二、学生个体情况</h2>
      <table>
        <tr><th>账号</th><th>姓名</th><th>当前状态</th><th>风险分</th>
            <th>主要信号</th><th>周期内提交</th><th>变化</th></tr>
        ${rows || '<tr><td colspan="7">暂无学生数据</td></tr>'}
      </table>

      <h2>三、行动台账执行情况</h2>
      ${actRows ? `<table>
        <tr><th>优先级</th><th>动作</th><th>对象</th><th>状态</th></tr>
        ${actRows}
      </table>` : '<p>本期暂无台账记录。</p>'}
      <p>合计 ${acts.length} 条动作，已完成 ${acts.filter(a => a.done).length} 条。</p>

      <div class="foot">
        本报告由"乡育心桥"根据学生真实提交数据自动生成，仅作学校心理健康工作参考，
        不构成医学诊断。涉及红色风险学生，须由心理教师与专业人员评估处理。
      </div>`;

    download('乡育心桥_' + klassName() + '_' + p.label + '报告_' + today() + '.doc',
      wrapDoc('班级心理健康状况报告', body), 'application/msword;charset=utf-8');
  }

  /* ---- 学生个体报告 Word ---- */
  function exportStudentDoc(user, periodKey) {
    const d = RB.state.data || {};
    const stu = (d.students || []).find(x => x.user === user);
    if (!stu) return false;

    const p = periodOf(periodKey);
    const list = subsOf(user, p.days);
    const all = subsOf(user, 0);
    const sm = summarize(list);
    const tr = trendOf(all);

    const timeline = all.slice().reverse().map(s => `
      <tr>
        <td>${fmtTime(s.createdAt)}</td>
        <td>${s.type === 'questionnaire' ? '心理问卷' : '日常记录'}</td>
        <td>${esc(LV[s.level].txt)}</td>
        <td>${s.score}</td>
        <td>${esc(s.riskType || '—')}</td>
      </tr>`).join('');

    const eviList = [];
    all.forEach(s => (s.evidence || []).forEach(e => {
      const t = String(e).slice(0, 120);
      if (t && eviList.indexOf(t) === -1) eviList.push(t);
    }));

    const body = `
      <h1>学生心理健康状况报告</h1>
      <div class="meta">
        姓名：${esc(stu.name)} · 账号：${esc(stu.user)} ·
        报告周期：${esc(p.label)} · 生成时间：${fmtTime(Date.now())}
      </div>

      <h2>一、当前状态</h2>
      <table>
        <tr><th>风险等级</th><th>风险分</th><th>风险类型</th><th>最近提交</th></tr>
        <tr>
          <td>${esc(LV[stu.level].txt)}</td><td>${stu.score}</td>
          <td>${esc(stu.riskType || '—')}</td><td>${fmtTime(stu.createdAt)}</td>
        </tr>
      </table>

      <h2>二、${esc(p.label)}汇总</h2>
      <p>周期内提交 <b>${sm.count}</b> 次
        ${sm.byType.questionnaire ? `（问卷 ${sm.byType.questionnaire} 次` : ''}
        ${sm.byType.record ? `${sm.byType.questionnaire ? '，' : '（'}日常记录 ${sm.byType.record} 次）` : (sm.byType.questionnaire ? '）' : '')}，
        期间最高风险等级为 <b>${esc(LV[sm.worst].txt)}</b>，平均风险分 ${sm.avgScore}。</p>
      ${sm.count === 0 ? '<p class="k">该学生在所选周期内没有提交记录。</p>' : ''}
      ${sm.count === 1 ? '<p class="k">周期内仅 1 次提交，不足以判断变化趋势。</p>' : ''}

      <h2>三、变化追踪</h2>
      ${tr ? `
        <table>
          <tr><th>首次记录</th><th>最近记录</th><th>等级变化</th><th>风险分变化</th><th>样本数</th></tr>
          <tr>
            <td>${fmtDate(tr.firstAt)} · ${esc(LV[tr.from].short)}</td>
            <td>${fmtDate(tr.lastAt)} · ${esc(LV[tr.to].short)}</td>
            <td>${esc(tr.txt)}</td>
            <td>${tr.scoreDelta > 0 ? '+' : ''}${tr.scoreDelta}</td>
            <td>${tr.samples}</td>
          </tr>
        </table>`
        : '<p>该学生累计提交不足 2 次，暂无法判断变化趋势。建议持续记录后再评估。</p>'}

      <h2>四、主要观察信号</h2>
      ${eviList.length ? `<ul>${eviList.slice(0, 10).map(e => '<li>' + esc(e) + '</li>').join('')}</ul>`
        : '<p>暂未记录到明显风险信号。</p>'}

      <h2>五、历史提交记录</h2>
      ${timeline ? `<table>
        <tr><th>提交时间</th><th>类型</th><th>风险等级</th><th>风险分</th><th>风险类型</th></tr>
        ${timeline}
      </table>` : '<p>暂无提交记录。</p>'}

      <div class="foot">
        本报告依据该学生本人提交的问卷与日常记录自动生成，仅作学校心理健康工作参考，
        不构成医学诊断。报告内容涉及学生隐私，请妥善保管，不得随意传播。
      </div>`;

    download('乡育心桥_' + stu.name + '_' + p.label + '报告_' + today() + '.doc',
      wrapDoc('学生心理健康状况报告', body), 'application/msword;charset=utf-8');
    return true;
  }

  /* ---- 学生明细 CSV ---- */
  function exportStudentsCSV(periodKey) {
    const p = periodOf(periodKey);
    const S = (RB.state.data && RB.state.data.students) || [];
    const rows = [['账号', '姓名', '当前等级', '风险分', '主要信号', '周期内提交数', '变化', '最近更新']];
    S.forEach(s => {
      const list = subsOf(s.user, p.days);
      const tr = trendOf(list);
      rows.push([
        s.user, s.name, LV[s.level].txt, s.score,
        (s.tags || []).join(' / '),
        list.length,
        tr ? tr.txt : '样本不足',
        s.last
      ]);
    });
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    download('乡育心桥_班级统计_' + p.label + '_' + today() + '.csv', csv, 'text/csv;charset=utf-8');
  }

  /* ---------------- 导出到全局 ---------------- */
  RB.report = {
    PERIODS, periodOf, inPeriod, subsOf, trendOf, summarize, classSummary, klassName,
    exportClassDoc, exportStudentDoc, exportStudentsCSV,
    fmtDate, fmtTime, today, RANK
  };
})();
