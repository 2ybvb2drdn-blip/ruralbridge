/* ============================================================
 * 乡育心桥 · RuralBridge — 学生端
 * 视图：questionnaire / record / mine
 * 原则：只给「我现在能为自己做什么」，不给诊断、不给管理动作
 * ============================================================ */
(function () {
  'use strict';
  const RB = window.RB;
  const U = RB.ui;
  const { $, $$, esc, LV, notice, empty, steps, pill, aiBlock, loading, ts } = U;

  /* ---------------- 教师派发的量表任务 ----------------
   * 与上面的 12 题普查问卷是两回事：
   *   12 题问卷 = 全班普查，固定题目
   *   量表任务 = 教师针对某个学生派发的单量表（PHQ-9 / GAD-7 / ISI / C-SSRS）
   * 数据存 D1 scale_tasks 表，通过 /api/data/scales 读写。
   */
  let scaleTasks = [];
  let scaleTasksLoaded = false;
  let openTaskId = '';          /* 当前展开填写的任务 */
  let taskAnswers = {};         /* { itemId: value } */

  async function loadScaleTasks() {
    try {
      const res = await fetch('/api/data/scales?user=' +
        encodeURIComponent(RB.state.user.user), { headers: { 'Accept': 'application/json' } });
      const data = await res.json();
      scaleTasks = (data && data.ok && data.tasks) ? data.tasks : [];
    } catch (e) {
      scaleTasks = [];
    }
    scaleTasksLoaded = true;
    return scaleTasks;
  }

  function pendingTasks() {
    return scaleTasks.filter(t => t.status === 'pending');
  }

  function renderScaleTasks() {
    const host = $('#stuScaleTasks');
    if (!host) return;

    const pending = pendingTasks();
    if (!pending.length) { host.innerHTML = ''; return; }

    host.innerHTML = `<div class="card stu-scale-card">
      <h3>老师希望你填写的量表<span class="sst-cnt">${pending.length} 份待填</span></h3>
      <div class="sub">这些量表是老师为了更好地了解你的情况而安排的，填完会自动提交给老师。</div>
      <div id="stuScaleList"></div>
    </div>`;

    const list = $('#stuScaleList');
    list.innerHTML = pending.map(t => {
      const S = (RB.scaleBank.all || []).find(x => x.id === t.scaleId);
      if (!S) return '';
      const open = openTaskId === t.id;
      const answered = S.items.filter(it => taskAnswers[it.id] !== undefined).length;

      const body = open ? `
        <div class="sst-body">
          <div class="sst-frame">${esc(S.frame || '')}</div>
          ${S.warn ? `<div class="sst-warn">⚠ ${esc(S.warn)}</div>` : ''}
          ${S.items.map((it, idx) => {
            const opts = it.options || S.options || [];
            return `<div class="sst-item">
              <div class="sst-qt">${idx + 1}. ${esc(it.text)}</div>
              <div class="sst-opts">${opts.map(o => `
                <label><input type="radio" name="st_${t.id}_${it.id}" value="${o.v}"
                  ${taskAnswers[it.id] === o.v ? 'checked' : ''}
                  data-ti="${esc(it.id)}">${esc(o.label)}</label>`).join('')}</div>
            </div>`;
          }).join('')}
          <div class="sst-foot">
            <button class="btn" data-sst-submit="${esc(t.id)}"
              ${answered < S.items.length ? 'disabled' : ''}>提交量表</button>
            <button class="btn ghost" data-sst-cancel="${esc(t.id)}">收起</button>
            <span class="sub" style="margin:0">已答 <b>${answered} / ${S.items.length}</b></span>
          </div>
        </div>` : '';

      return `<div class="sst-row ${open ? 'open' : ''}">
        <div class="sst-head">
          <div class="sst-main">
            <div class="sst-name">${esc(S.name)}</div>
            <div class="sst-meta">${S.items.length} 题 · 约 ${S.minutes} 分钟${t.due ? ' · 截止 ' + esc(t.due) : ''}</div>
          </div>
          ${open ? '' : `<button class="btn ghost sm" data-sst-open="${esc(t.id)}">开始填写</button>`}
        </div>
        ${body}
      </div>`;
    }).join('');

    /* 绑定 */
    $$('#stuScaleList [data-sst-open]').forEach(b => b.onclick = () => {
      openTaskId = b.dataset.sstOpen;
      taskAnswers = {};
      renderScaleTasks();
    });
    $$('#stuScaleList [data-sst-cancel]').forEach(b => b.onclick = () => {
      openTaskId = '';
      taskAnswers = {};
      renderScaleTasks();
    });
    $$('#stuScaleList input[type=radio]').forEach(r => r.onchange = () => {
      taskAnswers[r.dataset.ti] = +r.value;
      /* 只更新进度与提交按钮，不整块重渲染——
         重渲染会丢焦点、跳滚动位置，填到第 7 题时体验很差 */
      const row = r.closest('.sst-row');
      if (!row) return;
      const id = row.querySelector('[data-sst-submit]');
      const tid = id ? id.dataset.sstSubmit : '';
      const t = scaleTasks.find(x => x.id === tid);
      const S = t ? (RB.scaleBank.all || []).find(x => x.id === t.scaleId) : null;
      if (!S) return;
      const n = S.items.filter(it => taskAnswers[it.id] !== undefined).length;
      if (id) id.disabled = n < S.items.length;
      const prog = row.querySelector('.sst-foot .sub b');
      if (prog) prog.textContent = n + ' / ' + S.items.length;
    });
    $$('#stuScaleList [data-sst-submit]').forEach(b => b.onclick = () => {
      submitScaleTask(b.dataset.sstSubmit, b);
    });
  }

  async function submitScaleTask(taskId, btn) {
    const t = scaleTasks.find(x => x.id === taskId);
    if (!t) return;
    const S = (RB.scaleBank.all || []).find(x => x.id === t.scaleId);
    if (!S) return;

    const score = RB.scaleBank.score(t.scaleId, taskAnswers);
    if (score.error) { alert(score.error); return; }

    const old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }

    try {
      const res = await fetch('/api/data/scales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit', id: taskId, answers: taskAnswers, result: score })
      });
      const data = await res.json();
      if (!data || data.ok !== true) throw new Error((data && data.error) || '提交失败');

      openTaskId = '';
      taskAnswers = {};
      await loadScaleTasks();
      renderScaleTasks();
      showScaleResult(S, score);
    } catch (e) {
      alert('提交失败：' + (e && e.message ? e.message : e));
      if (btn) { btn.disabled = false; btn.textContent = old; }
    }
  }

  /* 学生端结果反馈：只给可做的事，不出现诊断名词与分级术语 */
  function showScaleResult(S, r) {
    const host = $('#stuScaleTasks');
    if (!host) return;
    const warm = r.level === 'red'
      ? '你的回答里有一些需要认真对待的信号。老师会尽快联系你，请先不要一个人待着。'
      : (r.level === 'yellow'
        ? '你的回答说明最近有些辛苦。老师会找时间和你聊聊。'
        : '谢谢你的如实作答。目前没有发现需要特别担心的情况。');
    const card = document.createElement('div');
    card.className = 'card stu-scale-done';
    card.innerHTML = `<h3>已提交：${esc(S.name)}</h3>
      <div class="sst-thanks">${esc(warm)}</div>
      <div class="sub">如果现在很难受，可以随时找班主任或心理老师，也可以拨打全国心理援助热线 12356。</div>`;
    host.insertBefore(card, host.firstChild);
    setTimeout(() => { if (card.parentNode) card.parentNode.removeChild(card); }, 12000);
  }

  /* ---------------- 问卷 ---------------- */
  function renderQuestionnaire() {
    /* 先拉取教师派发的量表任务（异步，不阻塞问卷渲染） */
    loadScaleTasks().then(() => renderScaleTasks());

    const Q = RB.QUESTIONNAIRE;
    $('#qTitle').textContent = Q.title;
    $('#qNote').textContent = Q.note;

    /* 按分组渲染：情绪 / 紧张担心 / 安全情况
       安全题单独成区，避免学生把它们当成普通情绪题随手点 */
    const groups = Q.groups || [{ part:'', title:'' }];
    $('#qItems').innerHTML = groups.map(g => {
      const list = Q.items.filter(it => (it.part || '') === (g.part || ''));
      if (!list.length) return '';
      const head = g.title
        ? `<div class="q-group"><div class="q-group-t">${esc(g.title)}</div>` +
          (g.note ? `<div class="q-group-n">${esc(g.note)}</div>` : '') + '</div>'
        : '';
      const body = list.map(it => `
        <div class="q-item ${it.part === 'safe' ? 'hard' : ''}">
          <div class="qt">${esc(it.text)}</div>
          <div class="q-opts">${Q.options.map(o => `
            <label><input type="radio" name="${it.id}" value="${o.v}"
              ${RB.state.answers[it.id] === o.v ? 'checked' : ''}>${esc(o.label)}</label>`).join('')}</div>
        </div>`).join('');
      return head + body;
    }).join('');

    const prog = () => {
      const n = Q.items.filter(it => RB.state.answers[it.id] !== undefined).length;
      $('#qProg').textContent = n + ' / ' + Q.items.length;
    };
    $$('#qItems input[type=radio]').forEach(r => r.onchange = () => {
      RB.state.answers[r.name] = +r.value;
      prog();
    });
    prog();
  }

  async function submitQuestionnaire() {
    const Q = RB.QUESTIONNAIRE;
    const answered = Q.items.filter(it => RB.state.answers[it.id] !== undefined).length;
    if (answered < Q.items.length) {
      $('#qResult').innerHTML = notice('warning', '还有题目未作答', '还剩 ' + (Q.items.length - answered) + ' 题，请完成后提交。');
      return;
    }
    $('#qResult').innerHTML = loading('AI 评估中（规则引擎硬筛查 → 语义推理 → RAG 理论检索）…');
    $('#btnSubmitQ').disabled = true;
    try {
      const r = await RB.engine.assessAsync({
        answers: RB.state.answers, text: '', studentName: RB.state.user.name,
        qVersion: Q.version
      }, 'student');
      const saved = await postSubmit({
        type:'questionnaire', answers: RB.state.answers, text:'',
        qVersion: Q.version, result: r
      });
      $('#qResult').innerHTML = resultCard(r, '问卷提交结果', saved);
    } catch (e) {
      $('#qResult').innerHTML = notice('warning', '提交失败', e.message || String(e));
    } finally {
      $('#btnSubmitQ').disabled = false;
      window.scrollTo({ top: document.body.scrollHeight, behavior:'smooth' });
    }
  }

  /* ---------------- 日常记录 ---------------- */
  function renderRecord() {
    $('#tagChips').innerHTML = RB.RECORD_TAGS.map(t =>
      `<span class="chip ${RB.state.tags.indexOf(t) !== -1 ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</span>`).join('');
    $$('#tagChips .chip').forEach(c => c.onclick = () => {
      const t = c.dataset.tag;
      const i = RB.state.tags.indexOf(t);
      if (i === -1) RB.state.tags.push(t); else RB.state.tags.splice(i, 1);
      c.classList.toggle('on', i === -1);
    });
  }

  async function submitRecord() {
    const text = $('#recText').value.trim();
    if (!text && !RB.state.tags.length) {
      $('#recResult').innerHTML = notice('warning', '内容为空', '请至少填写文字记录或选择行为标签。');
      return;
    }
    const full = text + ' ' + RB.state.tags.join(' ');
    $('#recResult').innerHTML = loading('AI 分析中（规则引擎硬筛查 → 大模型语义推理 → RAG 理论检索）…');
    $('#btnSubmitR').disabled = true;
    try {
      const hits = RB.engine.ruleScan(full);
      const r = await RB.engine.assessAsync({ text: full, answers:{}, studentName: RB.state.user.name }, 'student');
      const saved = await postSubmit({ type:'record', answers:{}, text: full, result: r });

      $('#recResult').innerHTML = `
        <div class="card" style="margin-top:16px">
          <h3>记录已提交${saved ? '并同步给老师' : ''}</h3>
          <div class="sub">记录时间 ${new Date().toLocaleString('zh-CN')} · 标签：${esc(RB.state.tags.join('、') || '无')}</div>
          <div class="result-head"><div><div class="lv" style="color:var(--${r.level})">${LV[r.level].txt}</div>
            <div class="kv"><span>风险类型：</span><b>${esc(r.riskType)}</b></div></div></div>
          <div class="section-title">规则引擎硬筛查</div>
          ${hits.length
            ? `<div>${hits.map(h => `<span class="rule-tag ${h.hard ? 'hard' : ''}">${esc(h.ruleId)} ${esc(h.type)}${h.hard ? ' · 硬触发' : ''}</span>`).join('')}</div>
               ${hits.some(h => h.hard) ? notice('warning', '已升级为最高关注', '系统已自动通知班主任与心理老师，今天会有人来找你聊聊。你不需要一个人扛。') : ''}`
            : '<div class="sub">未命中高危规则，已并入常规跟踪。</div>'}
          ${r.steps && r.steps.length ? `<div class="section-title">你可以做的小事</div>${steps(r.steps.slice(0, 4))}` : ''}
          ${r.talk && r.talk.length ? r.talk.map(t => `<div class="theory"><div class="ts">${esc(t)}</div></div>`).join('') : ''}
          <div class="notice info"><div>如果现在很难受，可以拨打心理援助热线 <b>12356</b>，或直接去找班主任、心理老师。</div></div>
        </div>`;
      RB.state.tags = [];
      $$('#tagChips .chip').forEach(c => c.classList.remove('on'));
      $('#recText').value = '';
    } catch (e) {
      $('#recResult').innerHTML = notice('warning', '提交失败', e.message || String(e));
    } finally {
      $('#btnSubmitR').disabled = false;
      window.scrollTo({ top: document.body.scrollHeight, behavior:'smooth' });
    }
  }

  async function postSubmit(payload) {
    try {
      const res = await fetch('/api/data/submit', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify(Object.assign({ user: RB.state.user.user, name: RB.state.user.name }, payload))
      });
      const data = await res.json();
      return !!(data && data.ok === true);
    } catch (e) { return false; }
  }

  function resultCard(r, title, saved) {
    return `
      <div class="card" style="margin-top:16px">
        <h3>${esc(title)}</h3>
        <div class="sub">综合风险分 ${r.score} / 100 · ${saved ? '已同步给老师' : '本地展示（未能同步，请检查网络）'}</div>
        <div class="result-head">
          <div><div class="lv" style="color:var(--${r.level})">${LV[r.level].txt}</div>
          <div class="kv"><span>风险类型：</span><b>${esc(r.riskType)}</b></div></div>
        </div>
        ${r.steps && r.steps.length ? `<div class="section-title">你可以做的小事</div>${steps(r.steps)}` : ''}
        ${r.talk && r.talk.length ? `<div class="section-title">想对你说</div>${r.talk.map(t => `<div class="theory"><div class="ts">${esc(t)}</div></div>`).join('')}` : ''}
        <div class="notice info"><div>如果现在很难受，可以拨打心理援助热线 <b>12356</b>，或直接去找班主任、心理老师。</div></div>
      </div>`;
  }

  /* ---------------- 我的结果 ---------------- */
  async function renderMine() {
    const host = $('#mineBody');
    host.innerHTML = loading('正在读取你的记录…');

    let subs = [];
    try {
      const res = await fetch('/api/data/list', { headers:{ 'Accept':'application/json' } });
      const data = await res.json();
      const all = (data && data.submissions) || [];
      subs = all.filter(s => s.user === RB.state.user.user);
    } catch (e) { /* 忽略 */ }

    if (!subs.length) {
      host.innerHTML = empty('你还没有提交过问卷或记录。完成问卷后会在这里看到自己的结果与建议。');
      return;
    }

    host.innerHTML = subs.map(s => `
      <div class="card" style="margin-bottom:14px">
        <div class="result-head">
          <div><div class="lv" style="color:var(--${s.level})">${LV[s.level].txt}</div>
            <div class="kv"><span>类型：</span><b>${s.type === 'questionnaire' ? '心理问卷' : '日常记录'}</b></div></div>
          <div style="margin-left:auto;text-align:right">
            <div class="kv"><span>风险分：</span><b>${s.score} / 100</b></div>
            <div class="kv"><span>时间：</span><b>${ts(s.createdAt)}</b></div>
          </div>
        </div>
        ${s.riskType ? `<div class="kv"><span>风险类型：</span><b>${esc(s.riskType)}</b></div>` : ''}
        ${s.text ? `<div class="section-title">你写的内容</div><div style="font-size:13.5px;color:#41505f">${esc(s.text)}</div>` : ''}
        ${s.steps && s.steps.length ? `<div class="section-title">当时的建议</div>${steps(s.steps.slice(0, 4))}` : ''}
        ${s.talk && s.talk.length ? s.talk.map(t => `<div class="theory"><div class="ts">${esc(t)}</div></div>`).join('') : ''}
      </div>`).join('') + `
      <div class="notice info"><div>这些记录只有你自己、班主任和心理老师能看到，其他同学看不到。如需帮助，可拨打 <b>12356</b>。</div></div>`;
  }

  /* ---------------- 注册 ---------------- */
  RB.views['student:questionnaire'] = renderQuestionnaire;
  RB.views['student:record'] = renderRecord;
  RB.views['student:mine'] = renderMine;

  RB.student = { submitQuestionnaire, submitRecord, loadScaleTasks };
})();
