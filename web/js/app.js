/* ============================================================
 * 乡育心桥 · RuralBridge — 应用逻辑
 * 无框架依赖，纯原生 JS，便于弱网与低端机运行
 * ============================================================ */
(function () {
  'use strict';
  const RB = window.RB;
  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  const LV = { green:{txt:'绿色 · 状态良好', cls:'green'}, yellow:{txt:'黄色 · 需关注', cls:'yellow'}, red:{txt:'红色 · 需干预', cls:'red'} };

  let state = { user:null, tab:'dash', records:[], answers:{}, tags:[] };

  /* ---------------- 登录 ---------------- */
  function login(u, p) {
    const acc = RB.ACCOUNTS.find(a => a.user === u && a.pass === p);
    if (!acc) return null;
    state.user = acc;
    return acc;
  }

  function enterApp() {
    $('#login').style.display = 'none';
    $('#app').style.display = 'block';
    $('#whoName').textContent = state.user.name + ' · ' + state.user.role;
    $('#whoClass').textContent = state.user.klass;
    renderDash();
    renderQuestionnaire();
    switchTab('dash');
  }

  /* ---------------- 标签切换 ---------------- */
  function switchTab(tab) {
    state.tab = tab;
    $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + tab));
    window.scrollTo({ top:0, behavior:'smooth' });
    if (tab === 'class') renderClass();
  }

  /* ---------------- 1. 班级概览 ---------------- */
  function renderDash() {
    const S = RB.STUDENTS;
    const cnt = { green:0, yellow:0, red:0 };
    S.forEach(s => cnt[s.risk]++);
    const latest = RB.TREND[RB.TREND.length - 1];

    $('#metrics').innerHTML = [
      metric('green', cnt.green, '绿色 · 状态良好'),
      metric('yellow', cnt.yellow, '黄色 · 需关注'),
      metric('red', cnt.red, '红色 · 需干预'),
      metric('', RB.CLASS.total, '班级总人数')
    ].join('');

    // 三色分布条
    const total = S.length;
    const seg = k => `<div class="bar-seg ${k[0]}" style="width:${(cnt[k] / total * 100).toFixed(1)}%"></div>`;
    $('#distBar').innerHTML = `<div class="bar-track">${seg('green')}${seg('yellow')}${seg('red')}</div>`;
    $('#distLegend').innerHTML =
      `<span><span class="dot" style="background:var(--green)"></span>绿色 ${cnt.green} 人（${(cnt.green/total*100).toFixed(1)}%）</span>` +
      `<span><span class="dot" style="background:var(--yellow)"></span>黄色 ${cnt.yellow} 人（${(cnt.yellow/total*100).toFixed(1)}%）</span>` +
      `<span><span class="dot" style="background:var(--red)"></span>红色 ${cnt.red} 人（${(cnt.red/total*100).toFixed(1)}%）</span>`;

    $('#classMeta').innerHTML =
      kv('班级', RB.CLASS.name) + kv('学校', RB.CLASS.school) +
      kv('总人数', RB.CLASS.total + ' 人') + kv('留守儿童', RB.CLASS.leftBehind + ' 人（' + Math.round(RB.CLASS.leftBehind/RB.CLASS.total*100) + '%）') +
      kv('数据更新', RB.CLASS.updated);

    // 趋势折线
    $('#trend').innerHTML = trendSVG(RB.TREND);

    // 班级共性诱因
    $('#insights').innerHTML = RB.CLASS_INSIGHTS.map(i =>
      `<div class="notice ${i.level}"><div><div class="ttl">${esc(i.title)}</div><div>${esc(i.desc)}</div></div></div>`
    ).join('');
  }

  function metric(cls, num, lbl) {
    return `<div class="card metric ${cls}"><div class="num">${num}</div><div class="lbl">${esc(lbl)}</div></div>`;
  }
  function kv(k, v) { return `<div class="kv"><span>${esc(k)}：</span><b>${esc(v)}</b></div>`; }

  /* 纯 SVG 趋势折线 */
  function trendSVG(data) {
    const W = 760, H = 220, P = { l:38, r:14, t:14, b:28 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const maxY = Math.max.apply(null, data.map(d => d.green)) + 2;
    const minY = Math.min.apply(null, data.map(d => d.red)) - 2;
    const x = i => P.l + iw * (data.length === 1 ? .5 : i / (data.length - 1));
    const y = v => P.t + ih - ih * (v - minY) / Math.max(1, (maxY - minY));
    const path = key => data.map((d, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(d[key]).toFixed(1)).join(' ');
    const dots = (key, color) => data.map((d, i) =>
      `<circle cx="${x(i).toFixed(1)}" cy="${y(d[key]).toFixed(1)}" r="3.2" fill="${color}"/>`).join('');
    const xlabels = data.map((d, i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" font-size="11" fill="#6b7684" text-anchor="middle">${d.week}</text>`).join('');
    // 网格
    let grid = '';
    for (let g = 0; g <= 3; g++) {
      const v = Math.round(minY + (maxY - minY) * g / 3);
      const yy = y(v).toFixed(1);
      grid += `<line x1="${P.l}" y1="${yy}" x2="${W - P.r}" y2="${yy}" stroke="#e3e8ef"/>` +
              `<text x="${P.l - 6}" y="${(+yy + 3.5).toFixed(1)}" font-size="10.5" fill="#6b7684" text-anchor="end">${v}</text>`;
    }
    return `<div class="trend-box"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMidYMid meet">
      ${grid}
      <path d="${path('green')}" fill="none" stroke="#1f9d55" stroke-width="2.4"/>
      <path d="${path('yellow')}" fill="none" stroke="#c77700" stroke-width="2.4"/>
      <path d="${path('red')}" fill="none" stroke="#c62828" stroke-width="2.4"/>
      ${dots('green', '#1f9d55')}${dots('yellow', '#c77700')}${dots('red', '#c62828')}
      ${xlabels}</svg>
      <div class="trend-legend">
        <span><span class="dot" style="background:var(--green)"></span>绿色（状态良好）</span>
        <span><span class="dot" style="background:var(--yellow)"></span>黄色（需关注）</span>
        <span><span class="dot" style="background:var(--red)"></span>红色（需干预）</span>
        <span style="margin-left:auto;color:#6b7684">近 8 周</span>
      </div></div>`;
  }

  /* ---------------- 2. 学生名单 ---------------- */
  function renderStudents() {
    const S = RB.STUDENTS.slice().sort((a, b) => b.score - a.score);
    $('#stuBody').innerHTML = S.map(s => `
      <tr>
        <td>${esc(s.id)}</td>
        <td><b>${esc(s.name)}</b></td>
        <td>${esc(s.gender)}</td>
        <td>${s.leftBehind ? '是' : '—'}</td>
        <td><span class="pill ${s.risk}">${LV[s.risk].txt}</span></td>
        <td>${s.score}</td>
        <td>${s.tags.map(t => '<span class="rule-tag">' + esc(t) + '</span>').join('')}</td>
        <td>${esc(s.last)}</td>
        <td class="acts"><button class="btn ghost sm" data-plan="${esc(s.id)}">查看方案</button></td>
      </tr>`).join('');
    $$('#stuBody [data-plan]').forEach(b => b.onclick = () => openPlan(b.dataset.plan));
  }

  function openPlan(id) {
    const s = RB.STUDENTS.find(x => x.id === id);
    const plan = RB.PLANS[id];
    switchTab('plan');
    if (plan) { renderPlan(s, plan, null); return; }
    // 非预置案例：现场跑一次引擎，生成结构化建议
    $('#planBody').innerHTML = `<div class="loading"><div class="spinner"></div>正在调用 AI 评估引擎生成方案…</div>`;
    setTimeout(() => {
      const r = RB.engine.assess({ text:(s.tags || []).join(' '), answers:{} });
      renderPlan(s, null, r);
    }, 420);
  }

  function renderPlan(s, plan, eng) {
    const risk = plan ? plan.risk : (eng ? eng.level : s.risk);
    const riskType = plan ? plan.riskType : (eng ? eng.riskType : '');
    const evidence = plan ? plan.evidence : (eng ? eng.evidence : []);
    const steps = plan ? plan.steps : (eng ? eng.steps : []);
    const theoryIds = plan ? plan.theory : (eng ? eng.theories.map(t => t.id) : []);
    const theories = RB.THEORIES.filter(t => theoryIds.indexOf(t.id) !== -1);
    const talk = plan ? plan.talk : [];
    const watch = plan ? plan.watch : [];

    $('#planBody').innerHTML = `
      <div class="result-head">
        <div><div class="lv" style="color:var(--${risk})">${LV[risk].txt}</div>
        <div class="kv"><span>学生：</span><b>${esc(s.name)}（${esc(s.id)}）</b></div></div>
        <div style="margin-left:auto;text-align:right">
          <div class="kv"><span>风险类型：</span><b>${esc(riskType)}</b></div>
          <div class="kv"><span>评估引擎：</span><b>${esc(eng ? eng.model : 'RB-Assess v1.0')}</b></div>
        </div>
      </div>

      <div class="section-title">① 判定依据（可追溯）</div>
      <ul class="ev">${evidence.map(e => '<li>' + esc(e) + '</li>').join('')}</ul>

      ${eng && eng.ruleHits && eng.ruleHits.length ? `
      <div class="section-title">② 规则引擎命中记录（硬兜底通道）</div>
      <div>${eng.ruleHits.map(h => `<span class="rule-tag ${h.hard ? 'hard' : ''}">${esc(h.ruleId)} ${esc(h.type)}${h.hard ? ' · 硬触发' : ''}</span>`).join('')}</div>` : ''}

      <div class="section-title">③ 分步干预建议</div>
      <ol class="steps">${steps.map(st => `<li><div class="st">${esc(st.t)}</div><div class="sd">${esc(st.d)}</div></li>`).join('')}</ol>

      ${talk.length ? `<div class="section-title">④ 沟通话术参考</div>
        ${talk.map(t => `<div class="theory"><div class="ts">${esc(t)}</div></div>`).join('')}` : ''}

      <div class="section-title">⑤ 理论来源（RAG 检索结果）</div>
      ${theories.map(t => `<div class="theory">
        <div><span class="tn">${esc(t.name)}</span><span class="ta">${esc(t.author)}</span></div>
        <div class="ts">${esc(t.summary)}</div>
        <div class="tap">▶ 干预要点：${esc(t.apply)}</div></div>`).join('') || '<div class="sub">未检索到匹配理论条目</div>'}

      ${watch.length ? `<div class="section-title">⑥ 后续观察指标</div>
        <div>${watch.map(w => '<span class="rule-tag">' + esc(w) + '</span>').join('')}</div>` : ''}

      <div class="notice info" style="margin-top:18px">
        <div>本方案由 AI 辅助生成，仅供参考，不替代专业心理诊断。涉及高危信号时须由专业人员介入。</div>
      </div>
      <div style="margin-top:14px"><button class="btn ghost sm" id="backStu">← 返回学生名单</button></div>`;
    const b = $('#backStu'); if (b) b.onclick = () => switchTab('students');
  }

  /* ---------------- 3. 轻量问卷 ---------------- */
  function renderQuestionnaire() {
    const Q = RB.QUESTIONNAIRE;
    $('#qTitle').textContent = Q.title;
    $('#qNote').textContent = Q.note;
    $('#qItems').innerHTML = Q.items.map(it => `
      <div class="q-item ${it.hard ? 'hard' : ''}">
        <div class="qt">${esc(it.text)}<span class="dim">${esc(it.dim)}</span></div>
        <div class="q-opts">${Q.options.map(o => `
          <label><input type="radio" name="${it.id}" value="${o.v}">${esc(o.label)}</label>`).join('')}</div>
      </div>`).join('');
    $$('#qItems input[type=radio]').forEach(r => r.onchange = () => {
      state.answers[r.name] = +r.value;
      $('#qProg').textContent = Object.keys(state.answers).length + ' / ' + Q.items.length;
    });
  }

  function submitQuestionnaire() {
    const Q = RB.QUESTIONNAIRE;
    if (Object.keys(state.answers).length < Q.items.length) {
      $('#qResult').innerHTML = `<div class="notice warning"><div>还有 ${Q.items.length - Object.keys(state.answers).length} 题未作答，请完成后再提交。</div></div>`;
      return;
    }
    $('#qResult').innerHTML = `<div class="loading"><div class="spinner"></div>AI 评估中（规则引擎硬筛查 → 语义推理 → RAG 理论检索）…</div>`;
    setTimeout(() => {
      const r = RB.engine.assess({ answers: state.answers, text:'' });
      $('#qResult').innerHTML = resultCard(r, '问卷提交结果');
      window.scrollTo({ top: document.body.scrollHeight, behavior:'smooth' });
    }, 560);
  }

  function resultCard(r, title) {
    return `
      <div class="card" style="margin-top:16px">
        <h3>${esc(title)}</h3>
        <div class="sub">综合风险分 ${r.score} / 100 · 引擎耗时 ${r.latencyMs} ms</div>
        <div class="result-head">
          <div><div class="lv" style="color:var(--${r.level})">${LV[r.level].txt}</div>
          <div class="kv"><span>风险类型：</span><b>${esc(r.riskType)}</b></div></div>
        </div>
        <div class="section-title">判定依据</div>
        <ul class="ev">${r.evidence.map(e => '<li>' + esc(e) + '</li>').join('')}</ul>
        ${r.ruleHits.length ? `<div class="section-title">规则引擎命中</div>
          <div>${r.ruleHits.map(h => `<span class="rule-tag ${h.hard ? 'hard' : ''}">${esc(h.ruleId)} ${esc(h.type)}</span>`).join('')}</div>` : ''}
        <div class="section-title">建议动作</div>
        <ol class="steps">${r.steps.slice(0, 3).map(st => `<li><div class="st">${esc(st.t)}</div><div class="sd">${esc(st.d)}</div></li>`).join('')}</ol>
        <div class="notice info"><div>本结果由 AI 辅助生成，仅供参考，不替代专业心理诊断。</div></div>
      </div>`;
  }

  /* ---------------- 4. 日常记录 ---------------- */
  const TAGS = ['情绪低落', '易激惹', '走神', '社交退缩', '睡眠差', '作业拖延', '同伴冲突', '家庭变故', '状态平稳'];
  function renderRecord() {
    $('#tagChips').innerHTML = TAGS.map(t => `<span class="chip" data-tag="${esc(t)}">${esc(t)}</span>`).join('');
    $$('#tagChips .chip').forEach(c => c.onclick = () => {
      const t = c.dataset.tag;
      const i = state.tags.indexOf(t);
      if (i === -1) state.tags.push(t); else state.tags.splice(i, 1);
      c.classList.toggle('on', i === -1);
    });
  }

  function submitRecord() {
    const text = $('#recText').value.trim();
    if (!text && !state.tags.length) {
      $('#recResult').innerHTML = `<div class="notice warning"><div>请至少填写文字记录或选择行为标签。</div></div>`;
      return;
    }
    const full = text + ' ' + state.tags.join(' ');
    $('#recResult').innerHTML = `<div class="loading"><div class="spinner"></div>规则引擎硬筛查中…</div>`;
    setTimeout(() => {
      const hits = RB.engine.ruleScan(full);
      const r = RB.engine.assess({ text: full, answers:{} });
      $('#recResult').innerHTML = `
        <div class="card" style="margin-top:16px">
          <h3>记录已入库 · AI 实时分析</h3>
          <div class="sub">记录时间 ${new Date().toLocaleString('zh-CN')} · 标签：${state.tags.join('、') || '无'}</div>
          <div class="result-head"><div><div class="lv" style="color:var(--${r.level})">${LV[r.level].txt}</div>
            <div class="kv"><span>风险类型：</span><b>${esc(r.riskType)}</b></div></div></div>
          <div class="section-title">规则引擎硬筛查</div>
          ${hits.length
            ? `<div>${hits.map(h => `<span class="rule-tag ${h.hard ? 'hard' : ''}">${esc(h.ruleId)} ${esc(h.type)}${h.hard ? ' · 硬触发' : ''}</span>`).join('')}</div>
               ${hits.some(h => h.hard) ? '<div class="notice warning"><div><b>命中高危硬触发项</b>：已自动升级为红色等级并推送班主任，建议 24 小时内介入。</div></div>' : ''}`
            : '<div class="sub">未命中高危规则，已并入常规跟踪。</div>'}
          <div class="section-title">判定依据</div>
          <ul class="ev">${r.evidence.map(e => '<li>' + esc(e) + '</li>').join('')}</ul>
          <div class="notice info"><div>AI 分析仅供参考，不替代专业心理诊断。</div></div>
        </div>`;
      state.tags = []; state.answers = {};
      $$('#tagChips .chip').forEach(c => c.classList.remove('on'));
      window.scrollTo({ top: document.body.scrollHeight, behavior:'smooth' });
    }, 460);
  }

  /* ---------------- 5. 班级报告 ---------------- */
  function renderClass() {
    const S = RB.STUDENTS;
    const lb = S.filter(s => s.leftBehind && s.risk !== 'green').length;
    const lbAll = S.filter(s => s.leftBehind).length;
    $('#classReport').innerHTML = `
      <div class="grid g3">
        ${metric('r', S.filter(s => s.risk === 'red').length, '红色 · 需干预')}
        ${metric('y', S.filter(s => s.risk === 'yellow').length, '黄色 · 需关注')}
        ${metric('', lb + '/' + lbAll, '风险学生中留守儿童占比')}
      </div>
      <div class="section-title">AI 归纳的班级共性诱因</div>
      ${RB.CLASS_INSIGHTS.map(i => `<div class="notice ${i.level}"><div><div class="ttl">${esc(i.title)}</div><div>${esc(i.desc)}</div></div></div>`).join('')}
      <div class="section-title">重点学生清单（红色 + 黄色）</div>
      <div class="card" style="padding:6px 0">
        <table class="tb"><thead><tr><th>编号</th><th>姓名</th><th>风险</th><th>风险分</th><th>主要信号</th><th></th></tr></thead>
        <tbody>${S.filter(s => s.risk !== 'green').sort((a,b) => b.score - a.score).map(s => `
          <tr><td>${esc(s.id)}</td><td><b>${esc(s.name)}</b></td>
          <td><span class="pill ${s.risk}">${LV[s.risk].txt}</span></td><td>${s.score}</td>
          <td>${s.tags.map(t => '<span class="rule-tag">' + esc(t) + '</span>').join('')}</td>
          <td class="acts"><button class="btn ghost sm" data-plan="${esc(s.id)}">查看方案</button></td></tr>`).join('')}
        </tbody></table>
      </div>
      <div class="section-title">导出</div>
      <div><button class="btn ghost sm" id="expPdf">导出班级晴雨表（PDF）</button>
           <button class="btn ghost sm" id="expWord" style="margin-left:8px">导出个体方案（Word）</button>
           <button class="btn ghost sm" id="expXls" style="margin-left:8px">导出月度统计（Excel）</button></div>
      <div class="sub" style="margin-top:8px">演示环境：导出按钮使用浏览器打印/CSV 能力模拟，线上版本由后端生成正式文件。</div>`;
    $$('#classReport [data-plan]').forEach(b => b.onclick = () => openPlan(b.dataset.plan));
    $('#expPdf').onclick = () => window.print();
    $('#expXls').onclick = exportCSV;
    $('#expWord').onclick = () => { switchTab('students'); };
  }

  function exportCSV() {
    const rows = [['编号','姓名','性别','留守儿童','风险等级','风险分','主要信号']];
    RB.STUDENTS.forEach(s => rows.push([s.id, s.name, s.gender, s.leftBehind ? '是' : '否',
      LV[s.risk].txt, s.score, s.tags.join(' / ')]));
    const csv = '\ufeff' + rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = '乡育心桥_班级月度统计_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click(); URL.revokeObjectURL(url);
  }

  /* ---------------- 绑定 ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    $('#loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const acc = login($('#u').value.trim(), $('#p').value);
      if (!acc) { $('#loginErr').textContent = '账号或密码不正确'; return; }
      $('#loginErr').textContent = '';
      enterApp();
    });
    $('#fillDemo').onclick = () => { $('#u').value = 'demo'; $('#p').value = 'czb2026'; };
    $('#logout').onclick = () => {
      state = { user:null, tab:'dash', records:[], answers:{}, tags:[] };
      $('#app').style.display = 'none'; $('#login').style.display = 'flex';
      $('#qResult').innerHTML = ''; $('#recResult').innerHTML = '';
      $('#recText').value = ''; $('#qProg').textContent = '0 / 10';
    };
    $$('.tabs button').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
    $('#btnSubmitQ').onclick = submitQuestionnaire;
    $('#btnResetQ').onclick = () => { state.answers = {}; renderQuestionnaire(); $('#qResult').innerHTML = ''; $('#qProg').textContent = '0 / 10'; };
    $('#btnSubmitR').onclick = submitRecord;
    renderStudents();
    renderRecord();
  });
})();
