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

  /* ---------------- 问卷 ---------------- */
  function renderQuestionnaire() {
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

  RB.student = { submitQuestionnaire, submitRecord };
})();
