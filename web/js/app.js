/* ============================================================
 * 乡育心桥 · RuralBridge — 应用逻辑
 * 无框架依赖，纯原生 JS，便于弱网与低端机运行
 *
 * 角色分流：
 *   学生（student）    → 心理问卷 / 日常记录 / 我的结果
 *   班主任（teacher）  → 班级概览 / 学生名单 / 班级报告 / 干预方案
 *   心理教师（counselor）→ 同班主任，可重置数据
 * 所有后台数据均来自学生真实提交（/api/data/*），无内置模拟数据。
 * ============================================================ */
(function () {
  'use strict';
  const RB = window.RB;
  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  const LV = { green:{txt:'绿色 · 状态良好'}, yellow:{txt:'黄色 · 需关注'}, red:{txt:'红色 · 需干预'} };

  const state = { user:null, tab:'dash', answers:{}, tags:[], data:null, loading:false };

  /* ---------------- 登录 ---------------- */
  function login(u, p) {
    const acc = RB.ACCOUNTS.find(a => a.user === u && a.pass === p);
    return acc || null;
  }

  function enterApp() {
    $('#login').style.display = 'none';
    $('#app').style.display = 'block';
    const u = state.user;
    $('#whoName').textContent = u.name + ' · ' + u.roleName;
    $('#whoClass').textContent = u.klass;

    const staff = RB.isStaff(u);
    // 顶部导航按角色显隐
    $$('.tabs button').forEach(b => {
      const owner = b.dataset.role || 'staff';
      b.style.display = (owner === 'student') === !staff ? '' : 'none';
    });

    if (staff) {
      loadData().then(() => switchTab('dash'));
    } else {
      renderQuestionnaire();
      renderRecord();
      switchTab('questionnaire');
    }
  }

  function switchTab(tab) {
    state.tab = tab;
    $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + tab));
    window.scrollTo({ top:0, behavior:'smooth' });
    if (tab === 'class') renderClass();
    if (tab === 'dash') renderDash();
    if (tab === 'students') renderStudents();
  }

  /* ---------------- 数据加载（教师后台） ---------------- */
  async function loadData() {
    state.loading = true;
    try {
      const res = await fetch('/api/data/list', { headers: { 'Accept': 'application/json' } });
      const data = await res.json();
      if (!data || data.ok !== true) throw new Error((data && data.error) || ('HTTP ' + res.status));
      state.data = data;
    } catch (e) {
      state.data = { ok:false, error: e.message || String(e), submissions:[], students:[], stats:{ total:0, red:0, yellow:0, green:0, submissions:0 } };
    } finally {
      state.loading = false;
    }
    return state.data;
  }

  /* ---------------- 班级概览（真实数据） ---------------- */
  function renderDash() {
    const d = state.data || { students:[], stats:{ total:0, red:0, yellow:0, green:0, submissions:0 } };
    const S = d.students || [];
    const cnt = { green:0, yellow:0, red:0 };
    S.forEach(s => cnt[s.level]++);

    if (d.ok === false) {
      $('#metrics').innerHTML = '';
      $('#distBar').innerHTML = `<div class="notice warning"><div>数据读取失败：${esc(d.error)}</div></div>`;
      $('#distLegend').innerHTML = '';
      $('#classMeta').innerHTML = '';
      $('#insights').innerHTML = '';
      return;
    }

    $('#metrics').innerHTML = [
      metric('red', cnt.red, '红色 · 需干预'),
      metric('yellow', cnt.yellow, '黄色 · 需关注'),
      metric('green', cnt.green, '绿色 · 状态良好'),
      metric('', d.stats.submissions, '累计提交次数')
    ].join('');

    const total = S.length;
    if (total === 0) {
      $('#distBar').innerHTML = `<div class="empty">暂无数据 · 等待学生填写问卷</div>`;
      $('#distLegend').innerHTML = '';
    } else {
      const seg = k => `<div class="bar-seg ${k[0]}" style="width:${(cnt[k] / total * 100).toFixed(1)}%"></div>`;
      $('#distBar').innerHTML = `<div class="bar-track">${seg('green')}${seg('yellow')}${seg('red')}</div>`;
      $('#distLegend').innerHTML =
        `<span><span class="dot" style="background:var(--green)"></span>绿色 ${cnt.green} 人（${(cnt.green/total*100).toFixed(1)}%）</span>` +
        `<span><span class="dot" style="background:var(--yellow)"></span>黄色 ${cnt.yellow} 人（${(cnt.yellow/total*100).toFixed(1)}%）</span>` +
        `<span><span class="dot" style="background:var(--red)"></span>红色 ${cnt.red} 人（${(cnt.red/total*100).toFixed(1)}%）</span>`;
    }

    $('#classMeta').innerHTML =
      kv('班级', state.user.klass) + kv('学校', '示范乡镇中学') +
      kv('已提交学生', total + ' 人') + kv('累计提交', d.stats.submissions + ' 条') +
      kv('数据更新', d.updatedAt ? new Date(d.updatedAt).toLocaleString('zh-CN') : '—');

    $('#insights').innerHTML = classInsights(d).map(i =>
      `<div class="notice ${i.level}"><div><div class="ttl">${esc(i.title)}</div><div>${esc(i.desc)}</div></div></div>`
    ).join('');

    // 最近提交
    const recent = (d.submissions || []).slice(0, 6);
    $('#recent').innerHTML = recent.length ? recent.map(s => `
      <div class="notice info"><div>
        <div class="ttl">${esc(s.name)} · ${s.type === 'questionnaire' ? '心理问卷' : '日常记录'}
          <span class="pill ${s.level}" style="margin-left:6px">${LV[s.level].txt}</span></div>
        <div>${esc(s.riskType || '—')} · ${new Date(s.createdAt).toLocaleString('zh-CN')}</div>
      </div></div>`).join('')
      : `<div class="empty">暂无提交记录</div>`;
  }

  function classInsights(d) {
    const S = d.students || [];
    const out = [];
    if (!S.length) {
      return [{ level:'info', title:'等待学生提交', desc:'当前尚无学生提交数据。请用 student1~student5 账号登录并完成问卷后，此处将自动汇总班级心理状况。' }];
    }
    const risk = S.filter(s => s.level !== 'green');
    if (d.stats.red > 0) out.push({ level:'warning', title:`红色预警 ${d.stats.red} 人`, desc:'存在需干预的学生，建议 24 小时内安排一对一面谈，必要时联系心理教师与监护人。' });
    if (risk.length) out.push({ level:'warning', title:`需关注学生 ${risk.length} 人`, desc:`共 ${risk.length} 名学生处于黄色或红色状态，占已提交人数的 ${Math.round(risk.length / S.length * 100)}%。` });
    out.push({ level:'info', title:'数据实时同步', desc:`本页数据来自学生端真实提交，共 ${d.stats.submissions} 条记录，随学生填写自动更新。` });
    return out;
  }

  function metric(cls, num, lbl) {
    return `<div class="card metric ${cls}"><div class="num">${num}</div><div class="lbl">${esc(lbl)}</div></div>`;
  }
  function kv(k, v) { return `<div class="kv"><span>${esc(k)}：</span><b>${esc(v)}</b></div>`; }

  /* ---------------- 学生名单（真实数据） ---------------- */
  function renderStudents() {
    const S = ((state.data && state.data.students) || []).slice();
    if (!S.length) {
      $('#stuBody').innerHTML = `<tr><td colspan="9"><div class="empty">暂无学生提交数据</div></td></tr>`;
      return;
    }
    $('#stuBody').innerHTML = S.map(s => `
      <tr>
        <td>${esc(s.user)}</td>
        <td><b>${esc(s.name)}</b></td>
        <td>—</td>
        <td>—</td>
        <td><span class="pill ${s.level}">${LV[s.level].txt}</span></td>
        <td>${s.score}</td>
        <td>${(s.tags || []).map(t => '<span class="rule-tag">' + esc(t) + '</span>').join('') || '—'}</td>
        <td>${esc(s.last)}</td>
        <td class="acts"><button class="btn ghost sm" data-plan="${esc(s.user)}">查看方案</button></td>
      </tr>`).join('');
    $$('#stuBody [data-plan]').forEach(b => b.onclick = () => openPlan(b.dataset.plan));
  }

  /* 从真实提交里取该学生最近一条，展示方案 */
  function openPlan(user) {
    const d = state.data || {};
    const stu = (d.students || []).find(x => x.user === user);
    const sub = (d.submissions || []).find(x => x.user === user);
    switchTab('plan');
    if (!stu || !sub) {
      $('#planBody').innerHTML = `<div class="empty">该学生暂无提交记录</div>`;
      return;
    }
    renderPlan(stu, sub);
  }

  function renderPlan(s, sub) {
    const risk = sub.level;
    const riskType = sub.riskType || '';
    const evidence = sub.evidence || [];
    const steps = sub.steps || [];
    const talk = sub.talk || [];
    const ruleHits = sub.ruleHits || [];

    $('#planBody').innerHTML = `
      <div class="result-head">
        <div><div class="lv" style="color:var(--${risk})">${LV[risk].txt}</div>
        <div class="kv"><span>学生：</span><b>${esc(s.name)}（${esc(s.user)}）</b></div></div>
        <div style="margin-left:auto;text-align:right">
          <div class="kv"><span>风险类型：</span><b>${esc(riskType || '—')}</b></div>
          <div class="kv"><span>综合风险分：</span><b>${esc(sub.score)} / 100</b></div>
          <div class="kv"><span>提交时间：</span><b>${new Date(sub.createdAt).toLocaleString('zh-CN')}</b></div>
        </div>
      </div>

      ${evidence.length ? `<div class="section-title">① 判定依据（来自学生真实提交）</div>
        <ul class="ev">${evidence.map(e => '<li>' + esc(e) + '</li>').join('')}</ul>` : ''}

      ${ruleHits.length ? `<div class="section-title">② 规则引擎命中记录</div>
        <div>${ruleHits.map(h => `<span class="rule-tag ${h.hard ? 'hard' : ''}">${esc(h.ruleId)} ${esc(h.type)}${h.hard ? ' · 硬触发' : ''}</span>`).join('')}</div>` : ''}

      ${steps.length ? `<div class="section-title">③ 分步干预建议</div>
        <ol class="steps">${steps.map(st => `<li><div class="st">${esc(st.t)}</div><div class="sd">${esc(st.d)}</div></li>`).join('')}</ol>` : ''}

      ${talk.length ? `<div class="section-title">④ 沟通话术参考</div>
        ${talk.map(t => `<div class="theory"><div class="ts">${esc(t)}</div></div>`).join('')}` : ''}

      <div class="notice info" style="margin-top:18px">
        <div>本方案由 AI 辅助生成，仅供参考，不替代专业心理诊断。涉及高危信号时须由专业人员介入。</div>
      </div>
      <div style="margin-top:14px"><button class="btn ghost sm" id="backStu">← 返回学生名单</button></div>`;
    const b = $('#backStu'); if (b) b.onclick = () => switchTab('students');
  }

  /* ---------------- 学生端：轻量问卷 ---------------- */
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
    const answered = Object.keys(state.answers).length;
    if (answered < Q.items.length) {
      $('#qResult').innerHTML = `<div class="notice warning"><div>还有 ${Q.items.length - answered} 题未作答，请完成后再提交。</div></div>`;
      return;
    }
    $('#qResult').innerHTML = `<div class="loading"><div class="spinner"></div>AI 评估中（规则引擎硬筛查 → 语义推理 → RAG 理论检索）…</div>`;
    $('#btnSubmitQ').disabled = true;
    setTimeout(async () => {
      const r = await RB.engine.assessAsync({ answers: state.answers, text:'', studentName: state.user.name });
      // 落库（真实数据）
      const saved = await postSubmit({ type:'questionnaire', answers: state.answers, text:'', result: r });
      $('#qResult').innerHTML = resultCard(r, '问卷提交结果', saved);
      $('#btnSubmitQ').disabled = false;
      window.scrollTo({ top: document.body.scrollHeight, behavior:'smooth' });
    }, 400);
  }

  /* 学生端：日常记录 */
  function renderRecord() {
    $('#tagChips').innerHTML = RB.RECORD_TAGS.map(t => `<span class="chip" data-tag="${esc(t)}">${esc(t)}</span>`).join('');
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
    $('#recResult').innerHTML = `<div class="loading"><div class="spinner"></div>AI 分析中（规则引擎硬筛查 → 大模型语义推理 → RAG 理论检索）…</div>`;
    $('#btnSubmitR').disabled = true;
    setTimeout(async () => {
      const hits = RB.engine.ruleScan(full);
      const r = await RB.engine.assessAsync({ text: full, answers:{}, studentName: state.user.name });
      const saved = await postSubmit({ type:'record', answers:{}, text: full, result: r });
      $('#recResult').innerHTML = `
        <div class="card" style="margin-top:16px">
          <h3>记录已提交${saved ? '并入库' : ''} · AI 实时分析</h3>
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
      $('#btnSubmitR').disabled = false;
      state.tags = [];
      $$('#tagChips .chip').forEach(c => c.classList.remove('on'));
      $('#recText').value = '';
      window.scrollTo({ top: document.body.scrollHeight, behavior:'smooth' });
    }, 400);
  }

  /* 提交到服务端（真实落库） */
  async function postSubmit(payload) {
    try {
      const res = await fetch('/api/data/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ user: state.user.user, name: state.user.name }, payload))
      });
      const data = await res.json();
      return data && data.ok === true;
    } catch (e) {
      return false;
    }
  }

  function resultCard(r, title, saved) {
    return `
      <div class="card" style="margin-top:16px">
        <h3>${esc(title)}</h3>
        <div class="sub">综合风险分 ${r.score} / 100 · 引擎耗时 ${r.latencyMs} ms · ${saved ? '已同步至教师后台' : '本地展示（未能同步，请检查网络）'}</div>
        <div class="result-head">
          <div><div class="lv" style="color:var(--${r.level})">${LV[r.level].txt}</div>
          <div class="kv"><span>风险类型：</span><b>${esc(r.riskType)}</b></div></div>
        </div>
        <div class="section-title">判定依据</div>
        <ul class="ev">${r.evidence.map(e => '<li>' + esc(e) + '</li>').join('')}</ul>
        ${(r.ruleHits && r.ruleHits.length) ? `<div class="section-title">规则引擎命中</div>
          <div>${r.ruleHits.map(h => `<span class="rule-tag ${h.hard ? 'hard' : ''}">${esc(h.ruleId)} ${esc(h.type)}</span>`).join('')}</div>` : ''}
        ${(r.steps && r.steps.length) ? `<div class="section-title">建议动作</div>
          <ol class="steps">${r.steps.slice(0, 3).map(st => `<li><div class="st">${esc(st.t)}</div><div class="sd">${esc(st.d)}</div></li>`).join('')}</ol>` : ''}
        <div class="notice info"><div>本结果由 AI 辅助生成，仅供参考，不替代专业心理诊断。</div></div>
      </div>`;
  }

  /* ---------------- 班级报告（真实数据） ---------------- */
  function renderClass() {
    const d = state.data || { students:[], stats:{ red:0, yellow:0, green:0, submissions:0 } };
    const S = d.students || [];
    const risk = S.filter(s => s.level !== 'green').sort((a, b) => b.score - a.score);

    $('#classReport').innerHTML = `
      <div class="grid g3">
        ${metric('red', d.stats.red, '红色 · 需干预')}
        ${metric('yellow', d.stats.yellow, '黄色 · 需关注')}
        ${metric('', d.stats.submissions, '累计提交次数')}
      </div>
      <div class="section-title">AI 归纳的班级共性诱因</div>
      ${classInsights(d).map(i => `<div class="notice ${i.level}"><div><div class="ttl">${esc(i.title)}</div><div>${esc(i.desc)}</div></div></div>`).join('')}
      <div class="section-title">重点学生清单（红色 + 黄色）</div>
      <div class="card" style="padding:6px 0">
        <table class="tb"><thead><tr><th>账号</th><th>姓名</th><th>风险</th><th>风险分</th><th>主要信号</th><th></th></tr></thead>
        <tbody>${risk.length ? risk.map(s => `
          <tr><td>${esc(s.user)}</td><td><b>${esc(s.name)}</b></td>
          <td><span class="pill ${s.level}">${LV[s.level].txt}</span></td><td>${s.score}</td>
          <td>${(s.tags || []).map(t => '<span class="rule-tag">' + esc(t) + '</span>').join('') || '—'}</td>
          <td class="acts"><button class="btn ghost sm" data-plan="${esc(s.user)}">查看方案</button></td></tr>`).join('')
          : '<tr><td colspan="6"><div class="empty">暂无重点学生</div></td></tr>'}
        </tbody></table>
      </div>
      <div class="section-title">导出</div>
      <div><button class="btn ghost sm" id="expPdf">导出班级晴雨表（PDF）</button>
           <button class="btn ghost sm" id="expXls" style="margin-left:8px">导出月度统计（Excel）</button></div>
      <div class="sub" style="margin-top:8px">演示环境：导出按钮使用浏览器打印/CSV 能力模拟，线上版本由后端生成正式文件。</div>
      <div class="section-title" style="color:#c62828">测试工具</div>
      <div class="card" style="border-color:#f0d0d0">
        <div class="sub" style="margin-top:0">清空全部学生提交数据（问卷 + 日常记录），用于反复测试。此操作不可恢复。</div>
        <div style="margin-top:12px"><button class="btn" id="btnReset" style="background:#c62828">重置学生数据</button></div>
      </div>`;
    $$('#classReport [data-plan]').forEach(b => b.onclick = () => openPlan(b.dataset.plan));
    $('#expPdf').onclick = () => window.print();
    $('#expXls').onclick = exportCSV;
    $('#btnReset').onclick = doReset;
  }

  async function doReset() {
    if (!window.confirm('确定要清空全部学生数据吗？此操作不可恢复，将删除所有问卷与日常记录。')) return;
    if (!window.confirm('再次确认：重置后教师后台将回到「暂无数据」状态。继续？')) return;
    const btn = $('#btnReset');
    btn.disabled = true; btn.textContent = '正在重置…';
    try {
      const res = await fetch('/api/data/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'RESET' })
      });
      const data = await res.json();
      if (!data || data.ok !== true) throw new Error((data && data.error) || ('HTTP ' + res.status));
      await loadData();
      switchTab('dash');
      alert('已清空 ' + (data.deleted || 0) + ' 条学生数据。');
    } catch (e) {
      alert('重置失败：' + (e.message || e));
    } finally {
      btn.disabled = false; btn.textContent = '重置学生数据';
    }
  }

  function exportCSV() {
    const S = (state.data && state.data.students) || [];
    const rows = [['账号','姓名','风险等级','风险分','主要信号','最近更新']];
    S.forEach(s => rows.push([s.user, s.name, LV[s.level].txt, s.score, (s.tags || []).join(' / '), s.last]));
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
      state.user = acc;
      enterApp();
    });

    // 一键填入按钮
    $$('#fillBtns [data-fill]').forEach(b => b.onclick = () => {
      $('#u').value = b.dataset.fill;
      $('#p').value = b.dataset.pass || '12345678';
      $('#loginErr').textContent = '';
    });

    $('#logout').onclick = () => {
      state.user = null; state.answers = {}; state.tags = []; state.data = null;
      $('#app').style.display = 'none'; $('#login').style.display = 'flex';
      $('#qResult').innerHTML = ''; $('#recResult').innerHTML = '';
      $('#recText').value = ''; $('#qProg').textContent = '0 / 10';
      $('#u').value = ''; $('#p').value = '';
    };

    $$('.tabs button').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
    $('#btnSubmitQ').onclick = submitQuestionnaire;
    $('#btnResetQ').onclick = () => { state.answers = {}; renderQuestionnaire(); $('#qResult').innerHTML = ''; $('#qProg').textContent = '0 / 10'; };
    $('#btnSubmitR').onclick = submitRecord;
  });
})();
