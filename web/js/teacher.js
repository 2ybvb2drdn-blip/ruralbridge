/* ============================================================
 * 乡育心桥 · RuralBridge — 班主任工作台
 * 关注点：班上现在什么情况 · 我明天能做什么
 * 视图：dash / classai / students / collect / actions / report
 * 原则：只输出管理动作，不输出心理学机制与诊断术语
 * ============================================================ */
(function () {
  'use strict';
  const RB = window.RB;
  const U = RB.ui;
  const { $, $$, esc, LV, metric, kv, notice, empty, steps, bulletList, pill, aiBlock, loading, ts } = U;

  const TODO_KEY = 'rb_actions';

  /* ---------------- 行动台账 ---------------- */
  /* 唯一 id：原先用 'a' + Date.now()，AI 研判批量加入时同一毫秒生成多条，
     造成 id 重复 → 「完成」只改到第一条，其余行看起来「点完又回来」。 */
  let idSeq = 0;
  function uid() {
    idSeq = (idSeq + 1) % 1296;                       // 36^2，一轮内不撞
    return 'a' + Date.now().toString(36) + idSeq.toString(36).padStart(2, '0')
           + Math.random().toString(36).slice(2, 6);
  }

  function acts() {
    const list = U.lsGet(TODO_KEY, []);
    /* 修复历史脏数据：已存在的重复 id 就地重编，避免旧记录继续错乱 */
    const seen = Object.create(null);
    let dirty = false;
    list.forEach(a => {
      if (!a || typeof a !== 'object') return;
      if (!a.id || seen[a.id]) { a.id = uid(); dirty = true; }
      seen[a.id] = 1;
    });
    if (dirty) saveActs(list);
    return list;
  }
  function saveActs(a) { U.lsSet(TODO_KEY, a); }

  /* 动作来源：决定这条台账是 AI 给的、系统提醒的，还是老师手写的。
     答辩时可据此统计「AI 建议被执行了多少」。 */
  const SRC = {
    ai_class:   { txt:'AI · 班级研判', cls:'ai'   },
    ai_student: { txt:'AI · 个案研判', cls:'ai'   },
    ai_dash:    { txt:'AI · 今日建议', cls:'ai'   },
    collect:    { txt:'系统 · 数据提醒', cls:'sys' },
    manual:     { txt:'教师 · 手工录入', cls:'man' }
  };
  function srcOf(a) { return SRC[a.source] || SRC.manual; }

  function addAct(text, dim, target, due, source) {
    const a = acts();
    a.unshift({
      id: uid(),
      text: text,
      dim: dim || '作业',
      target: target || '全班',
      due: due || '',
      source: SRC[source] ? source : 'manual',
      createdAt: Date.now(),
      done: false,
      doneAt: 0
    });
    saveActs(a);
  }

  /* 切换完成状态：按 id 精确命中单条，并记录完成时间 */
  function toggleAct(id) {
    const list = acts();
    const t = list.find(x => x.id === id);
    if (!t) return false;
    t.done = !t.done;
    t.doneAt = t.done ? Date.now() : 0;
    saveActs(list);
    return true;
  }

  function actItem(a, opts) {
    const overdue = !a.done && a.due && new Date(a.due) < new Date(new Date().toDateString());
    const s = srcOf(a);
    return `<div class="act-item ${a.done ? 'done' : ''} ${overdue ? 'overdue' : ''}" data-id="${a.id}">
      <div class="act-body">
        <div class="act-t">${esc(a.text)}</div>
        <div class="act-m">
          <span class="dim-tag ${esc(a.dim)}">${esc(a.dim)}</span>
          <span class="src-tag ${s.cls}">${esc(s.txt)}</span>
          <span>对象：${esc(a.target)}</span>
          ${a.due ? `<span>截止：${esc(a.due)}${overdue ? ' · 已逾期' : ''}</span>` : ''}
          ${a.done && a.doneAt ? `<span>完成：${esc(ts(a.doneAt))}</span>` : ''}
        </div>
      </div>
      <div class="act-ops">
        ${opts && opts.checkable
          ? `<button class="btn ghost sm" data-act-done="${a.id}">${a.done ? '撤销' : '完成'}</button>`
          : ''}
      </div>
    </div>`;
  }

  /* ---------------- 班级概览 ---------------- */
  function renderDash() {
    const d = RB.state.data || { students:[], stats:{ red:0, yellow:0, green:0, submissions:0 } };
    const S = d.students || [];
    const cnt = { green:0, yellow:0, red:0 };
    S.forEach(s => { if (cnt[s.level] != null) cnt[s.level]++; });

    if (d.ok === false) {
      $('#metrics').innerHTML = '';
      $('#distBar').innerHTML = notice('warning', '数据读取失败', d.error || '未知错误');
      $('#distLegend').innerHTML = '';
      $('#classMeta').innerHTML = '';
      $('#insights').innerHTML = '';
      $('#dashTodo').innerHTML = empty('数据不可用时无法生成待办');
      return;
    }

    $('#metrics').innerHTML = [
      metric('red', cnt.red, '红色 · 需干预'),
      metric('yellow', cnt.yellow, '黄色 · 需关注'),
      metric('green', cnt.green, '绿色 · 状态良好'),
      metric('', d.stats.submissions, '累计提交次数')
    ].join('');

    const total = S.length;
    if (!total) {
      $('#distBar').innerHTML = empty('暂无数据 · 等待学生填写问卷');
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
      kv('班级', RB.state.user.klass) + kv('学校', '示范乡镇中学') +
      kv('已提交学生', total + ' 人') + kv('累计提交', d.stats.submissions + ' 条') +
      kv('数据更新', ts(d.updatedAt));

    const recent = (d.submissions || []).slice(0, 6);
    $('#recent').innerHTML = recent.length ? recent.map(s => `
      <div class="notice info"><div>
        <div class="ttl">${esc(s.name)} · ${s.type === 'questionnaire' ? '心理问卷' : '日常记录'}
          <span class="pill ${s.level}" style="margin-left:6px">${LV[s.level].txt}</span></div>
        <div>${esc(s.riskType || '—')} · ${ts(s.createdAt)}</div>
      </div></div>`).join('') : empty('暂无提交记录');

    /* 今日待办：未完成台账 + 自动建议
       注意：自动建议必须与台账去重——否则同一条任务会同时以「AI 建议」和
       「台账条目」两种身份出现，点完成后台账行消失、建议行还在，看起来像「又冒出来」。 */
    const ledger = acts();
    const open = ledger.filter(a => !a.done);
    /* 去重只看「今天仍有意义」的台账：未完成的，或今天刚完成的。
       隔天如果学生仍未提交，建议应该重新出现。 */
    const today0 = new Date(new Date().toDateString()).getTime();
    const takenText = Object.create(null);
    ledger.forEach(a => {
      const alive = !a.done || (a.doneAt && a.doneAt >= today0);
      if (alive) takenText[String(a.text || '').trim()] = 1;
    });

    const auto = [];
    if (cnt.red > 0) auto.push({ t:`红色学生 ${cnt.red} 人需今日上报`, d:'第一时间告知心理教师与分管领导，不要自行判断严重程度。', dim:'个体', target:'红色学生' });
    const missing = Math.max(0, 5 - total);
    if (missing > 0) auto.push({ t:`仍有 ${missing} 名学生未提交`, d:'课间或放学前提醒完成问卷，避免数据缺口影响研判。', dim:'个体', target:'未提交学生' });
    const autoFresh = auto.filter(a => !takenText[a.t.trim()]);

    const todoHtml = [
      autoFresh.length ? autoFresh.map(a => `<div class="act-item"><div class="act-body">
        <div class="act-t">${esc(a.t)}</div>
        <div class="act-m"><span class="dim-tag ${esc(a.dim)}">${esc(a.dim)}</span><span>AI 建议 · 未入台账</span></div>
      </div><div class="act-ops"><button class="btn ghost sm" data-quick-add="${esc(a.t)}|${esc(a.dim)}|${esc(a.target)}">加入台账</button></div></div>`).join('') : '',
      open.length ? open.slice(0, 5).map(a => actItem(a, { checkable:true })).join('') : ''
    ].filter(Boolean).join('') || empty('今日待办已清空。');

    $('#dashTodo').innerHTML = todoHtml;

    $$('#dashTodo [data-quick-add]').forEach(b => b.onclick = () => {
      const p = b.dataset.quickAdd.split('|');
      addAct(p[0], p[1], p[2], '', 'ai_dash');
      renderDash();
    });
    $$('#dashTodo [data-act-done]').forEach(b => b.onclick = () => {
      toggleAct(b.dataset.actDone);
      renderDash();
    });

    $('#insights').innerHTML = classInsights(d).map(i =>
      notice(i.level, i.title, i.desc)).join('');

    const go = $('#gotoClassAI');
    if (go) go.onclick = () => RB.route('classai');
  }

  function classInsights(d) {
    const S = d.students || [];
    if (!S.length) return [{ level:'info', title:'等待学生提交', desc:'当前尚无学生提交数据。请用 student1~student5 账号登录并完成问卷后，此处自动汇总。' }];
    const out = [];
    const risk = S.filter(s => s.level !== 'green');
    if (d.stats.red > 0) out.push({ level:'warning', title:`红色预警 ${d.stats.red} 人`, desc:'存在需干预的学生，建议今日内上报心理教师并通知监护人。' });
    if (risk.length) out.push({ level:'warning', title:`需关注学生 ${risk.length} 人`, desc:`占已提交人数的 ${Math.round(risk.length / S.length * 100)}%，建议本周内安排单独谈话。` });
    else out.push({ level:'info', title:'暂无风险学生', desc:'当前全部学生处于绿色状态，保持常规关注即可。' });
    out.push({ level:'info', title:'数据实时同步', desc:`本页数据来自学生端真实提交，共 ${d.stats.submissions} 条记录，随学生填写自动更新。` });
    return out;
  }

  /* ---------------- AI 班级研判 ---------------- */
  function renderClassAI() {
    const body = $('#classAIBody');
    body.innerHTML = `<div class="sub">基于全班学生聚合数据（不含姓名，仅送聚合特征）由大模型归纳：班级整体气候、共性诱因，以及作业量 / 课外活动 / 课堂模式 / 家校协同四个维度的可执行动作。</div>
      <div style="margin-top:12px"><button class="btn" id="btnClassAI">生成班级研判</button></div>`;
    $('#btnClassAI').onclick = runClassAI;
  }

  async function runClassAI() {
    const d = RB.state.data || {};
    const S = d.students || [];
    const body = $('#classAIBody');
    if (!S.length) {
      body.innerHTML = `<div class="sub">暂无学生数据，无法生成班级研判。</div>
        <div style="margin-top:12px"><button class="btn" id="btnClassAI">重新生成</button></div>`;
      $('#btnClassAI').onclick = runClassAI;
      return;
    }

    body.innerHTML = loading('大模型正在归纳班级整体状态（约 5~15 秒）…');
    let r = null;
    try {
      const res = await fetch('/api/ai/class', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({
          klass: RB.state.user.klass,
          stats: d.stats,
          students: S,
          submissions: (d.submissions || []).slice(0, 20)
        })
      });
      const data = await res.json();
      if (data && data.ok) r = data;
    } catch (e) { /* 降级 */ }

    if (!r) r = RB.engine.classAnalyze(d);
    if (!r) {
      body.innerHTML = `<div class="sub">研判失败：服务端与本地引擎均不可用。</div>`;
      return;
    }

    const CL = { steady:'平稳', watch:'需关注', alert:'需干预' };
    body.innerHTML = `
      <div class="result-head">
        <div><div class="lv" style="color:var(--${r.climateLevel === 'alert' ? 'red' : (r.climateLevel === 'watch' ? 'yellow' : 'green')})">
          ${esc(CL[r.climateLevel] || r.climateLevel)}</div>
          <div class="kv"><span>班级：</span><b>${esc(RB.state.user.klass)}</b></div></div>
        <div style="margin-left:auto;text-align:right">
          <div class="kv"><span>数据来源：</span><b>${S.length} 名学生</b></div>
          <div class="kv"><span>引擎：</span><b>${esc(r.model || '—')}</b></div>
        </div>
      </div>
      ${aiBlock('班级整体气候', r.climate)}
      ${r.narrative ? `<div class="section-title">数据说明了什么</div><div style="font-size:13.5px;line-height:1.75;color:#41505f">${esc(r.narrative)}</div>` : ''}
      ${r.causes && r.causes.length ? `<div class="section-title">共性诱因</div>${steps(r.causes)}` : ''}
      ${r.workload && r.workload.length ? `<div class="section-title">作业量与考试节奏</div>${steps(r.workload)}` : ''}
      ${r.activity && r.activity.length ? `<div class="section-title">课外活动与班级氛围</div>${steps(r.activity)}` : ''}
      ${r.classroom && r.classroom.length ? `<div class="section-title">课堂模式调整</div>${steps(r.classroom)}` : ''}
      ${r.home && r.home.length ? `<div class="section-title">家校协同</div>${steps(r.home)}` : ''}
      ${r.focusGroups && r.focusGroups.length ? `<div class="section-title">需要重点关注的群体</div>${bulletList(r.focusGroups)}` : ''}
      ${r.watchSignals && r.watchSignals.length ? `<div class="section-title">未来一周留意</div>${bulletList(r.watchSignals)}` : ''}
      <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" id="btnPushActs">全部动作加入台账</button>
        <button class="btn ghost" id="btnReClassAI">重新生成</button>
      </div>
      <div class="notice info" style="margin-top:14px"><div>AI 建议仅供参考，不替代专业心理判断。涉及红色风险学生时须交由心理教师与专业人员处理。</div></div>`;

    $('#btnReClassAI').onclick = runClassAI;
    $('#btnPushActs').onclick = () => {
      const dims = [['作业','workload'], ['活动','activity'], ['课堂','classroom'], ['家校','home']];
      let n = 0;
      dims.forEach(([dim, key]) => {
        (r[key] || []).forEach(x => { addAct(x.t + '：' + x.d, dim, '全班', '', 'ai_class'); n++; });
      });
      alert('已加入 ' + n + ' 条动作到行动台账。');
      RB.route('actions');
    };
  }

  /* ---------------- 学生名单（班主任视角） ---------------- */
  function renderStudents() {
    const S = ((RB.state.data && RB.state.data.students) || []).slice();
    const tbody = $('#stuBody');
    if (!S.length) {
      tbody.innerHTML = `<tr><td colspan="8">${empty('暂无学生提交数据')}</td></tr>`;
      return;
    }
    tbody.innerHTML = S.map(s => `
      <tr>
        <td>${esc(s.user)}</td>
        <td><b>${esc(s.name)}</b></td>
        <td>${pill(s.level)}</td>
        <td>${s.score}</td>
        <td>${(s.tags || []).map(t => '<span class="rule-tag">' + esc(t) + '</span>').join('') || '—'}</td>
        <td>${esc(s.last)}</td>
        <td>${RB.handover.isOn(s.user) ? '<span class="pill green">已接手</span>' : '<span class="sub" style="margin:0">—</span>'}</td>
        <td class="acts"><button class="btn ghost sm" data-plan="${esc(s.user)}">支持动作</button></td>
      </tr>`).join('');
    $$('#stuBody [data-plan]').forEach(b => b.onclick = () => openTeacherPlan(b.dataset.plan));
  }

  /* 班主任视角：生成支持动作 */
  async function openTeacherPlan(user) {
    const d = RB.state.data || {};
    const stu = (d.students || []).find(x => x.user === user);
    const sub = (d.submissions || []).find(x => x.user === user);
    RB.route('students');
    if (!stu || !sub) { alert('该学生暂无提交记录'); return; }

    const panel = $('#stuBody').closest('.view');
    let host = $('#teacherPlanHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'teacherPlanHost';
      panel.appendChild(host);
    }
    host.innerHTML = `<div class="card" style="margin-top:16px">${loading('正在按班主任视角生成支持动作…')}</div>`;

    let r = null;
    try {
      r = await RB.engine.assessAsync({
        text: sub.text || '',
        answers: sub.answers || {},
        studentName: stu.name
      }, 'teacher');
    } catch (e) { /* 降级在 assessAsync 内处理 */ }
    if (!r) { host.innerHTML = `<div class="card" style="margin-top:16px">${empty('生成失败')}</div>`; return; }

    const t = r.teacher || {};
    host.innerHTML = `
      <div class="card" style="margin-top:16px">
        <div class="result-head">
          <div><div class="lv" style="color:var(--${r.level})">${LV[r.level].txt}</div>
            <div class="kv"><span>学生：</span><b>${esc(stu.name)}（${esc(stu.user)}）</b></div></div>
          <div style="margin-left:auto;text-align:right">
            <div class="kv"><span>风险类型：</span><b>${esc(r.riskType || '—')}</b></div>
            <div class="kv"><span>引擎：</span><b>${esc(r.model || '—')}</b></div>
          </div>
        </div>
        ${t.studentSummary ? aiBlock('该生当前状态', t.studentSummary) : ''}
        ${r.evidence && r.evidence.length ? `<div class="section-title">判定依据</div><ul class="ev">${r.evidence.map(e => '<li>' + esc(e) + '</li>').join('')}</ul>` : ''}
        ${t.immediate && t.immediate.length ? `<div class="section-title">本周内可做的事</div>${steps(t.immediate)}` : ''}
        ${t.classroomAdjust && t.classroomAdjust.length ? `<div class="section-title">课堂与班级层面调整</div>${steps(t.classroomAdjust)}` : ''}
        ${t.homeContact ? `<div class="section-title">家校沟通要点</div><div class="ai-block">${esc(t.homeContact)}</div>` : ''}
        ${t.watchFor && t.watchFor.length ? `<div class="section-title">需要留意的观察指标</div>${bulletList(t.watchFor)}` : ''}
        ${t.talk && t.talk.length ? `<div class="section-title">可直接使用的话术</div>${t.talk.map(x => `<div class="theory"><div class="ts">${esc(x)}</div></div>`).join('')}` : ''}
        <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn" id="btnToActs">把动作加入台账</button>
          <button class="btn ghost" id="btnClosePlan">收起</button>
        </div>
        <div class="notice info" style="margin-top:14px"><div>本页为班主任视角：只给可执行的管理动作，不含心理教师的专业研判内容。</div></div>
      </div>`;

    $('#btnClosePlan').onclick = () => host.innerHTML = '';
    $('#btnToActs').onclick = () => {
      let n = 0;
      (t.immediate || []).forEach(x => { addAct(x.t + '：' + x.d, '个体', stu.name, '', 'ai_student'); n++; });
      (t.classroomAdjust || []).forEach(x => { addAct(x.t + '：' + x.d, '课堂', '全班', '', 'ai_student'); n++; });
      alert('已加入 ' + n + ' 条动作到行动台账。');
      RB.route('actions');
    };
  }

  /* ---------------- 数据收集 ---------------- */
  function renderCollect() {
    const d = RB.state.data || {};
    const S = d.students || [];
    const subs = d.submissions || [];
    const all = RB.ACCOUNTS.filter(a => a.role === 'student');
    const submitted = {};
    S.forEach(s => { submitted[s.user] = true; });

    const missing = all.filter(a => !submitted[a.user]);
    $('#collectMetrics').innerHTML = [
      metric('', all.length, '应提交人数'),
      metric('green', all.length - missing.length, '已提交'),
      metric('yellow', missing.length, '未提交'),
      metric('', subs.length, '累计提交条数')
    ].join('');

    $('#collectMissing').innerHTML = missing.length ? missing.map(a =>
      `<div class="act-item"><div class="act-body">
        <div class="act-t">${esc(a.name)}（${esc(a.user)}）</div>
        <div class="act-m"><span>尚未提交任何问卷或记录</span></div>
      </div><div class="act-ops"><button class="btn ghost sm" data-remind="${esc(a.name)}">加入待办</button></div></div>`
    ).join('') : empty('全部学生均已提交，数据完整');

    $$('#collectMissing [data-remind]').forEach(b => b.onclick = () => {
      addAct('提醒 ' + b.dataset.remind + ' 完成问卷提交', '个体', b.dataset.remind, '', 'collect');
      alert('已加入行动台账');
    });

    /* 数据质量：单次提交 / 同一学生重复相同答案 */
    const q = [];
    S.forEach(s => { if (s.count === 1) q.push({ n:s.name, t:'仅提交 1 次', d:'样本量偏少，建议再收集一次以确认趋势。' }); });
    const byUser = {};
    subs.forEach(s => {
      const k = s.user;
      if (!byUser[k]) byUser[k] = [];
      byUser[k].push(s);
    });
    Object.keys(byUser).forEach(k => {
      const list = byUser[k];
      if (list.length >= 2) {
        const a = JSON.stringify(list[0].answers || {});
        const b = JSON.stringify(list[1].answers || {});
        if (a === b && a !== '{}') q.push({ n:list[0].name, t:'连续两次答案完全一致', d:'疑似敷衍作答，建议当面确认。' });
      }
    });
    $('#collectQuality').innerHTML = q.length ? q.map(x =>
      `<div class="act-item"><div class="act-body">
        <div class="act-t">${esc(x.n)} · ${esc(x.t)}</div>
        <div class="act-m"><span>${esc(x.d)}</span></div>
      </div></div>`).join('') : empty('未发现明显的数据质量问题');

    $('#collectDetail').innerHTML = subs.length ? `
      <table class="tb"><thead><tr>
        <th>时间</th><th>姓名</th><th>类型</th><th>风险等级</th><th>风险类型</th>
      </tr></thead><tbody>${subs.slice(0, 40).map(s => `
        <tr><td>${ts(s.createdAt)}</td><td><b>${esc(s.name)}</b></td>
        <td>${s.type === 'questionnaire' ? '心理问卷' : '日常记录'}</td>
        <td>${pill(s.level)}</td><td>${esc(s.riskType || '—')}</td></tr>`).join('')}
      </tbody></table>` : empty('暂无提交明细');
  }

  /* ---------------- 行动台账 ---------------- */
  function renderActions() {
    const a = acts();
    const today = new Date(new Date().toDateString());
    const todo = a.filter(x => !x.done && (!x.due || new Date(x.due) >= today));
    const overdue = a.filter(x => !x.done && x.due && new Date(x.due) < today);
    const done = a.filter(x => x.done);

    $('#actTodoCnt').textContent = todo.length + ' 条待执行';
    $('#actOverCnt').textContent = overdue.length + ' 条已逾期';
    $('#actDoneCnt').textContent = done.length + ' 条已完成';

    const bind = () => {
      $$('#view-actions [data-act-done]').forEach(b => b.onclick = () => {
        toggleAct(b.dataset.actDone);
        renderActions();
      });
    };

    $('#actTodo').innerHTML = todo.length ? todo.map(x => actItem(x, { checkable:true })).join('') : empty('暂无待执行');
    $('#actOverdue').innerHTML = overdue.length ? overdue.map(x => actItem(x, { checkable:true })).join('') : empty('没有逾期动作');
    /* 三栏均固定高度可滚动，已完成不再截断为 10 条 */
    $('#actDone').innerHTML = done.length ? done.map(x => actItem(x, { checkable:true })).join('') : empty('暂无已完成');
    bind();

    /* 按来源统计执行率：这是「AI 建议是否真的被执行」的真实数据源 */
    const groups = {};
    a.forEach(x => {
      const k = x.source || 'manual';
      if (!groups[k]) groups[k] = { total:0, done:0 };
      groups[k].total++;
      if (x.done) groups[k].done++;
    });
    const order = ['ai_class', 'ai_student', 'ai_dash', 'collect', 'manual'];
    const rows = order.filter(k => groups[k]).map(k => {
      const g = groups[k], s = SRC[k];
      const rate = g.total ? Math.round(g.done / g.total * 100) : 0;
      return `<tr>
        <td><span class="src-tag ${s.cls}">${esc(s.txt)}</span></td>
        <td>${g.total}</td>
        <td>${g.done}</td>
        <td><b>${rate}%</b></td>
        <td><div class="rate-bar"><i style="width:${rate}%"></i></div></td>
      </tr>`;
    });
    $('#actSourceStat').innerHTML = rows.length ? `
      <table class="tb"><thead><tr>
        <th>来源</th><th>总数</th><th>已完成</th><th>执行率</th><th></th>
      </tr></thead><tbody>${rows.join('')}</tbody></table>`
      : empty('暂无动作记录，执行率统计将在录入后生成');

    /* 手工录入：入口在标题右侧，弹窗填写，不占页面空间 */
    bindActModal();
  }

  /* ---------------- 手工录入弹窗 ---------------- */
  function openActModal() {
    const m = $('#actModal');
    if (!m) return;
    m.classList.add('open');
    document.body.style.overflow = 'hidden';
    const t = $('#actText');
    if (t) setTimeout(() => t.focus(), 30);
  }

  function closeActModal() {
    const m = $('#actModal');
    if (!m) return;
    m.classList.remove('open');
    document.body.style.overflow = '';
  }

  let actModalBound = false;
  function bindActModal() {
    const open = $('#btnOpenAct');
    if (open && !open.dataset.bound) {
      open.dataset.bound = '1';
      open.onclick = openActModal;
    }
    if (actModalBound) return;
    actModalBound = true;

    const mask = $('#actModal');
    if (!mask) return;
    const close = $('#actModalClose');
    const cancel = $('#actModalCancel');
    if (close) close.onclick = closeActModal;
    if (cancel) cancel.onclick = closeActModal;
    /* 点遮罩关闭，点弹窗本体不关 */
    mask.onclick = e => { if (e.target === mask) closeActModal(); };
    /* Esc 关闭 */
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && mask.classList.contains('open')) closeActModal();
    });

    const submit = $('#btnAddAct');
    if (submit) {
      submit.onclick = () => {
        const text = $('#actText').value.trim();
        if (!text) { alert('请填写动作内容'); $('#actText').focus(); return; }
        addAct(text, $('#actDim').value, $('#actStu').value.trim() || '全班', $('#actDue').value, 'manual');
        $('#actText').value = ''; $('#actStu').value = ''; $('#actDue').value = '';
        closeActModal();
        renderActions();
      };
    }
  }

  /* ---------------- 班级报告 ---------------- */
  function renderReport() {
    const d = RB.state.data || { students:[], stats:{ red:0, yellow:0, green:0, submissions:0 } };
    const S = d.students || [];
    const risk = S.filter(s => s.level !== 'green').sort((a, b) => b.score - a.score);
    const a = acts();

    $('#classReport').innerHTML = `
      <div class="grid g3">
        ${metric('red', d.stats.red, '红色 · 需干预')}
        ${metric('yellow', d.stats.yellow, '黄色 · 需关注')}
        ${metric('', d.stats.submissions, '累计提交次数')}
      </div>
      <div class="section-title">班级结论</div>
      ${classInsights(d).map(i => notice(i.level, i.title, i.desc)).join('')}
      <div class="section-title">重点学生清单（红色 + 黄色）</div>
      <div class="card" style="padding:6px 0;overflow-x:auto">
        <table class="tb"><thead><tr><th>账号</th><th>姓名</th><th>风险</th><th>风险分</th><th>主要信号</th><th>心理教师</th><th></th></tr></thead>
        <tbody>${risk.length ? risk.map(s => `
          <tr><td>${esc(s.user)}</td><td><b>${esc(s.name)}</b></td>
          <td>${pill(s.level)}</td><td>${s.score}</td>
          <td>${(s.tags || []).map(t => '<span class="rule-tag">' + esc(t) + '</span>').join('') || '—'}</td>
          <td>${RB.handover.isOn(s.user) ? '<span class="pill green">已接手</span>' : '—'}</td>
          <td class="acts"><button class="btn ghost sm" data-plan="${esc(s.user)}">支持动作</button></td></tr>`).join('')
          : '<tr><td colspan="7">' + empty('暂无重点学生') + '</td></tr>'}
        </tbody></table>
      </div>
      <div class="section-title">行动台账执行情况</div>
      <div class="grid g3">
        ${metric('', a.filter(x => !x.done).length, '待执行')}
        ${metric('', a.filter(x => x.done).length, '已完成')}
        ${metric('', a.length, '累计记录')}
      </div>
      <div class="section-title">导出</div>
      <div><button class="btn ghost sm" id="expPdf">导出班级晴雨表（PDF）</button>
           <button class="btn ghost sm" id="expXls" style="margin-left:8px">导出月度统计（Excel）</button></div>
      <div class="sub" style="margin-top:8px">演示环境：导出使用浏览器打印 / CSV 能力模拟，线上版本由后端生成正式文件。</div>
      <div class="section-title" style="color:#c62828">测试工具</div>
      <div class="card" style="border-color:#f0d0d0">
        <div class="sub" style="margin-top:0">清空全部学生提交数据（问卷 + 日常记录），用于反复测试。此操作不可恢复。</div>
        <div style="margin-top:12px"><button class="btn" id="btnReset" style="background:#c62828">重置学生数据</button></div>
      </div>`;

    $$('#classReport [data-plan]').forEach(b => b.onclick = () => openTeacherPlan(b.dataset.plan));
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
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ confirm:'RESET' })
      });
      const data = await res.json();
      if (!data || data.ok !== true) throw new Error((data && data.error) || ('HTTP ' + res.status));
      await RB.loadData(true);
      RB.route('dash');
      alert('已清空 ' + (data.deleted || 0) + ' 条学生数据。');
    } catch (e) {
      alert('重置失败：' + (e.message || e));
    } finally {
      btn.disabled = false; btn.textContent = '重置学生数据';
    }
  }

  function exportCSV() {
    const S = (RB.state.data && RB.state.data.students) || [];
    const rows = [['账号','姓名','风险等级','风险分','主要信号','最近更新']];
    S.forEach(s => rows.push([s.user, s.name, LV[s.level].txt, s.score, (s.tags || []).join(' / '), s.last]));
    const csv = '\ufeff' + rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
    const el = document.createElement('a');
    el.href = url;
    el.download = '乡育心桥_班级月度统计_' + new Date().toISOString().slice(0, 10) + '.csv';
    el.click();
    URL.revokeObjectURL(url);
  }

  /* ---------------- 注册 ---------------- */
  RB.views['teacher:dash'] = renderDash;
  RB.views['teacher:classai'] = renderClassAI;
  RB.views['teacher:students'] = renderStudents;
  RB.views['teacher:collect'] = renderCollect;
  RB.views['teacher:actions'] = renderActions;
  RB.views['teacher:report'] = renderReport;
})();
