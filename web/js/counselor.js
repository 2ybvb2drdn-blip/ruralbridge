/* ============================================================
 * 乡育心桥 · RuralBridge — 心理教师工作台
 * 关注点：这个孩子内心在发生什么 · 我该怎么陪他走出来
 * 视图：queue / plan / cases / climate / referral / toolbox
 * 原则：专业研判 + 辅导技术 + 风险与转介；不输出班级管理动作
 * ============================================================ */
(function () {
  'use strict';
  const RB = window.RB;
  const U = RB.ui;
  const { $, $$, esc, LV, metric, kv, notice, empty, steps, bulletList, pill, aiBlock, loading, ts } = U;

  const CASE_KEY = 'rb_cases';
  const CRISIS_KEY = 'rb_crisis';

  function cases() { return U.lsGet(CASE_KEY, {}); }
  function saveCases(c) { U.lsSet(CASE_KEY, c); }

  /* ---------------- 预警队列 ---------------- */
  function renderQueue() {
    U.renderBanner($('#queueBanner'), 'counselor');
    const d = RB.state.data || {};
    const S = (d.students || []).slice();
    const cnt = { green:0, yellow:0, red:0 };
    S.forEach(s => { if (cnt[s.level] != null) cnt[s.level]++; });

    $('#queueMetrics').innerHTML = [
      metric('red', cnt.red, '红色 · 24 小时内接触'),
      metric('yellow', cnt.yellow, '黄色 · 本周内完成'),
      metric('green', cnt.green, '绿色 · 常规关注'),
      metric('', Object.keys(cases()).length, '已建档案')
    ].join('');

    const order = { red:0, yellow:1, green:2 };
    const list = S.slice().sort((a, b) => (order[a.level] - order[b.level]) || (b.score - a.score));

    $('#queueBody').innerHTML = list.length ? list.map((s, i) => {
      const pr = s.level === 'red' ? 'p1' : (s.level === 'yellow' ? 'p2' : 'p3');
      const c = cases()[s.user];
      return `<tr>
        <td><span class="prio ${pr}">${i + 1}</span></td>
        <td><b>${esc(s.name)}</b><div class="sub" style="margin:0">${esc(s.user)}</div></td>
        <td>${pill(s.level)}</td>
        <td>${esc(s.riskType || '—')}</td>
        <td>${s.score}</td>
        <td>${esc(s.last)}</td>
        <td>${c ? `<span class="pill green">已建档案 · ${c.sessions || 0} 次</span>` : (RB.handover.isOn(s.user) ? '<span class="pill yellow">已接手</span>' : '未接手')}</td>
        <td class="acts">
          <button class="btn ghost sm" data-assess="${esc(s.user)}">专业研判</button>
          <button class="btn ghost sm" data-take="${esc(s.user)}">${RB.handover.isOn(s.user) ? '取消接手' : '接手'}</button>
        </td>
      </tr>`;
    }).join('') : `<tr><td colspan="8">${empty('暂无学生提交数据')}</td></tr>`;

    $$('#queueBody [data-take]').forEach(b => b.onclick = () => {
      RB.handover.toggle(b.dataset.take);
      renderQueue();
    });
    $$('#queueBody [data-assess]').forEach(b => b.onclick = () => openCounsel(b.dataset.assess));
  }

  /* ---------------- 个案专业研判 ---------------- */
  function renderPlan() {
    const d = RB.state.data || {};
    const S = (d.students || []).slice();
    if (!S.length) {
      $('#planBody').innerHTML = empty('暂无学生数据');
      return;
    }
    $('#planBody').innerHTML = `
      <div class="sub">从下列学生中选择一人，生成专业研判（个案概念化 / 心理机制 / 辅导技术 / 会谈计划 / 风险研判与转介）。</div>
      <div class="grid g3 scroll-box" style="margin-top:12px">
        ${S.map(s => `<button class="btn ghost" data-pick="${esc(s.user)}" style="justify-content:flex-start">
          ${esc(s.name)} · ${LV[s.level].short}</button>`).join('')}
      </div>`;
    $$('#planBody [data-pick]').forEach(b => b.onclick = () => openCounsel(b.dataset.pick));
  }

  async function openCounsel(user) {
    const d = RB.state.data || {};
    const stu = (d.students || []).find(x => x.user === user);
    const sub = (d.submissions || []).find(x => x.user === user);
    RB.route('plan');
    if (!stu || !sub) {
      $('#planBody').innerHTML = empty('该学生暂无提交记录');
      return;
    }
    $('#planBody').innerHTML = loading('大模型正在生成专业研判（约 8~20 秒）…');

    let r = null;
    try {
      r = await RB.engine.assessAsync({
        text: sub.text || '',
        answers: sub.answers || {},
        studentName: stu.name
      }, 'counselor');
    } catch (e) { /* 已降级 */ }
    if (!r) { $('#planBody').innerHTML = empty('研判失败'); return; }

    const c = r.counseling || {};
    $('#planBody').innerHTML = `
      <div class="result-head">
        <div><div class="lv" style="color:var(--${r.level})">${LV[r.level].txt}</div>
          <div class="kv"><span>学生：</span><b>${esc(stu.name)}（${esc(stu.user)}）</b></div></div>
        <div style="margin-left:auto;text-align:right">
          <div class="kv"><span>风险类型：</span><b>${esc(r.riskType || '—')}</b></div>
          <div class="kv"><span>引擎：</span><b>${esc(r.model || '—')}</b></div>
        </div>
      </div>
      ${r.evidence && r.evidence.length ? `<div class="section-title">判定依据</div><ul class="ev">${r.evidence.map(e => '<li>' + esc(e) + '</li>').join('')}</ul>` : ''}
      ${c.conceptualization ? aiBlock('个案概念化', c.conceptualization, 'counselor') : ''}
      ${c.mechanism ? aiBlock('心理机制', c.mechanism, 'counselor') : ''}
      ${c.techniques && c.techniques.length ? `<div class="section-title">辅导技术</div>${steps(c.techniques)}` : ''}
      ${c.sessionPlan && c.sessionPlan.length ? `<div class="section-title">会谈计划</div>${steps(c.sessionPlan)}` : ''}
      ${c.riskJudgement ? aiBlock('风险研判', c.riskJudgement, 'counselor') : ''}
      ${c.referral ? aiBlock('转介判断', c.referral, 'counselor') : ''}
      ${c.cautions && c.cautions.length ? `<div class="section-title">伦理与注意事项</div>${bulletList(c.cautions)}` : ''}
      ${r.talk && r.talk.length ? `<div class="section-title">首次会谈可用提问</div>${r.talk.map(x => `<div class="theory"><div class="ts">${esc(x)}</div></div>`).join('')}` : ''}
      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" id="btnOpenCase">建立 / 更新辅导档案</button>
        <button class="btn ghost" id="btnToReferral">转介与危机</button>
      </div>
      <div class="notice info" style="margin-top:14px"><div>本页为心理教师视角：输出专业研判与辅导方案，不含班主任的班级管理动作。AI 结论仅供参考，须由专业人员面谈确认。</div></div>`;

    $('#btnOpenCase').onclick = () => {
      const all = cases();
      const cur = all[user] || { user, name: stu.name, level: r.level, sessions: 0, status:'跟进中', openedAt: Date.now() };
      cur.level = r.level;
      cur.riskType = r.riskType || cur.riskType || '';
      cur.sessions = (cur.sessions || 0) + 1;
      cur.updatedAt = Date.now();
      cur.nextFollow = cur.nextFollow || '';
      all[user] = cur;
      saveCases(all);
      RB.handover.toggle(user);
      alert('档案已更新（会谈次数 ' + cur.sessions + '）。班主任端将显示「心理教师已接手」。');
      RB.route('cases');
    };
    $('#btnToReferral').onclick = () => RB.route('referral');
  }

  /* ---------------- 辅导档案 ---------------- */
  function renderCases() {
    const all = cases();
    const keys = Object.keys(all);
    if (!keys.length) {
      $('#caseGrid').innerHTML = empty('暂无档案。请在「个案研判」中生成研判后建立档案。');
      return;
    }
    $('#caseGrid').innerHTML = keys.map(k => {
      const c = all[k];
      return `<div class="case-card">
        <div class="cc-head">
          <span class="cc-name">${esc(c.name)}</span>
          ${pill(c.level)}
          <span class="pill ${c.status === '已结案' ? 'green' : 'yellow'}" style="margin-left:auto">${esc(c.status || '跟进中')}</span>
        </div>
        <div class="cc-row"><span>账号</span><b>${esc(c.user)}</b></div>
        <div class="cc-row"><span>风险类型</span><b>${esc(c.riskType || '—')}</b></div>
        <div class="cc-row"><span>会谈次数</span><b>${c.sessions || 0}</b></div>
        <div class="cc-row"><span>建档时间</span><b>${ts(c.openedAt)}</b></div>
        <div class="cc-row"><span>最近更新</span><b>${ts(c.updatedAt)}</b></div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn ghost sm" data-add-session="${esc(k)}">记一次会谈</button>
          <button class="btn ghost sm" data-close-case="${esc(k)}">${c.status === '已结案' ? '重新开启' : '结案'}</button>
        </div>
      </div>`;
    }).join('');

    $$('#caseGrid [data-add-session]').forEach(b => b.onclick = () => {
      const all2 = cases();
      const c = all2[b.dataset.addSession];
      c.sessions = (c.sessions || 0) + 1;
      c.updatedAt = Date.now();
      saveCases(all2);
      renderCases();
    });
    $$('#caseGrid [data-close-case]').forEach(b => b.onclick = () => {
      const all2 = cases();
      const c = all2[b.dataset.closeCase];
      c.status = c.status === '已结案' ? '跟进中' : '已结案';
      c.updatedAt = Date.now();
      saveCases(all2);
      renderCases();
    });
  }

  /* ---------------- 心理态势（群体画像） ---------------- */
  function renderClimate() {
    const d = RB.state.data || {};
    const S = d.students || [];
    $('#climateBody').innerHTML = `
      <div class="sub">基于全校学生聚合数据生成群体心理特征画像与发展性课程建议。此处不输出作业量、课堂模式等班主任职权内的管理动作。</div>
      <div class="grid g3" style="margin-top:14px">
        ${metric('red', d.stats ? d.stats.red : 0, '红色个案')}
        ${metric('yellow', d.stats ? d.stats.yellow : 0, '黄色个案')}
        ${metric('', S.length, '覆盖学生数')}
      </div>
      <div style="margin-top:14px"><button class="btn" id="btnClimate">生成心理态势画像</button></div>`;
    $('#btnClimate').onclick = runClimate;
  }

  async function runClimate() {
    const d = RB.state.data || {};
    const S = d.students || [];
    const body = $('#climateBody');
    if (!S.length) {
      body.innerHTML = `<div class="sub">暂无学生数据，无法生成态势画像。</div>
        <div style="margin-top:12px"><button class="btn" id="btnClimate">重新生成</button></div>`;
      $('#btnClimate').onclick = runClimate;
      return;
    }
    body.innerHTML = loading('正在归纳群体心理特征…');

    let r = null;
    try {
      const res = await fetch('/api/ai/class', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({
          klass: '全校',
          stats: d.stats,
          students: S,
          submissions: (d.submissions || []).slice(0, 20)
        })
      });
      const data = await res.json();
      if (data && data.ok) r = data;
    } catch (e) { /* 降级 */ }
    if (!r) r = RB.engine.classAnalyze(d);
    if (!r) { body.innerHTML = empty('画像生成失败'); return; }

    const CL = { steady:'平稳', watch:'需关注', alert:'需干预' };
    body.innerHTML = `
      <div class="result-head">
        <div><div class="lv" style="color:var(--${r.climateLevel === 'alert' ? 'red' : (r.climateLevel === 'watch' ? 'yellow' : 'green')})">
          ${esc(CL[r.climateLevel] || r.climateLevel)}</div>
          <div class="kv"><span>覆盖：</span><b>${S.length} 名学生</b></div></div>
        <div style="margin-left:auto;text-align:right"><div class="kv"><span>引擎：</span><b>${esc(r.model || '—')}</b></div></div>
      </div>
      ${aiBlock('群体心理气候', r.climate, 'counselor')}
      ${r.narrative ? `<div class="section-title">数据说明了什么</div><div style="font-size:13.5px;line-height:1.75;color:#41505f">${esc(r.narrative)}</div>` : ''}
      ${r.causes && r.causes.length ? `<div class="section-title">群体共性特征</div>${steps(r.causes)}` : ''}
      ${r.focusGroups && r.focusGroups.length ? `<div class="section-title">需要重点关注的群体</div>${bulletList(r.focusGroups)}` : ''}
      ${r.watchSignals && r.watchSignals.length ? `<div class="section-title">未来一周留意</div>${bulletList(r.watchSignals)}` : ''}
      <div class="notice info" style="margin-top:14px"><div>态势画像是群体层面的发展性参考，不替代个体评估。个体风险须走「个案研判」流程。</div></div>
      <div style="margin-top:14px"><button class="btn ghost" id="btnReClimate">重新生成</button></div>`;
    $('#btnReClimate').onclick = runClimate;
  }

  /* ---------------- 转介与危机 ---------------- */
  const CRISIS_STEPS = [
    { id:'c1', t:'确认风险等级与紧迫性', d:'核实自伤/自杀意念的频率、强度、计划性与可及手段，判断是否属急性风险。' },
    { id:'c2', t:'告知保密例外', d:'向学生说明：涉及自伤/自杀风险时须通知监护人与学校。' },
    { id:'c3', t:'落实不独处陪伴', d:'安排教师或可靠同伴全程陪伴，移除可及的危险物品。' },
    { id:'c4', t:'通知监护人并取得配合', d:'客观陈述观察到的信号，说明学校已启动的支持措施，约定家长到校沟通。' },
    { id:'c5', t:'上报分管领导与学校危机小组', d:'形成书面记录，明确责任人与后续时间节点。' },
    { id:'c6', t:'转介专业机构', d:'联系县级未成年人心理健康辅导中心或专科门诊，预约评估时间。' },
    { id:'c7', t:'建立随访计划', d:'转介后每周一次随访，持续不少于 4 周，记录变化。' }
  ];

  function renderReferral() {
    const d = RB.state.data || {};
    const S = (d.students || []).slice();
    const done = U.lsGet(CRISIS_KEY, {});

    $('#crisisList').innerHTML = `<ul class="check-list">${CRISIS_STEPS.map(s => `
      <li class="${done[s.id] ? 'done' : ''}">
        <input type="checkbox" data-ck="${s.id}" ${done[s.id] ? 'checked' : ''}>
        <div><div class="ck-t">${esc(s.t)}</div><div class="ck-d">${esc(s.d)}</div></div>
      </li>`).join('')}</ul>`;

    $$('#crisisList [data-ck]').forEach(cb => cb.onchange = () => {
      const m = U.lsGet(CRISIS_KEY, {});
      if (cb.checked) m[cb.dataset.ck] = Date.now(); else delete m[cb.dataset.ck];
      U.lsSet(CRISIS_KEY, m);
      renderReferral();
    });

    const sel = $('#refStu');
    sel.innerHTML = S.length
      ? S.map(s => `<option value="${esc(s.user)}">${esc(s.name)} · ${LV[s.level].short}</option>`).join('')
      : '<option value="">暂无学生</option>';
    if (!$('#refDate').value) $('#refDate').value = new Date().toISOString().slice(0, 10);

    $('#btnRefGen').onclick = genReferral;
    $('#btnRefPrint').onclick = exportReferralPDF;
  }

  /* 转介单数据模型：网页版与 PDF 版共用，避免两处字段写岔 */
  function refModel() {
    const d = RB.state.data || {};
    const user = $('#refStu').value;
    const stu = (d.students || []).find(x => x.user === user);
    if (!stu) return null;

    const sub = (d.submissions || []).find(x => x.user === user) || {};
    const org = ($('#refOrg').value || '').trim() || '县级未成年人心理健康辅导中心';
    const date = $('#refDate').value || new Date().toISOString().slice(0, 10);
    const lvTxt = (LV[stu.level] || { txt: '—' }).txt;
    const riskType = stu.riskType || sub.riskType || '—';

    const evidence = (sub.evidence || []).slice();
    if (!evidence.length) evidence.push('依据学生问卷与日常记录聚合结果。');
    (sub.ruleHits || []).filter(h => h.hard).forEach(h => {
      evidence.push('规则引擎硬命中高危规则：' + h.ruleId + ' ' + h.type);
    });

    return {
      date: date,
      org: org,
      klass: RB.state.user.klass,
      stu: { name: stu.name, uid: stu.user, levelTxt: lvTxt, riskType: riskType,
             score: stu.score, last: stu.last || '—' },
      /* 四列表格：第二对为 null 时表示整行跨列 */
      rows: [
        ['学生姓名', stu.name, '账号', stu.user],
        ['所属班级', RB.state.user.klass, '风险等级', lvTxt],
        ['风险类型', riskType, null, null],
        ['风险分', String(stu.score) + ' / 100', '最近提交', stu.last || '—'],
        ['转介机构', org, null, null]
      ],
      evidence: evidence,
      measures: ['已告知保密例外，学生知情。', '已安排专人陪伴，避免独处。', '已通知监护人并取得配合。'],
      suggestion: '建议由 ' + org + ' 进行专业心理评估，评估结论请反馈学校心理教师，' +
        '以便衔接后续在校支持与随访安排。'
    };
  }

  function genReferral() {
    const m = refModel();
    if (!m) { alert('请先选择学生'); return; }
    const stu = m.stu;

    $('#refBody').innerHTML = `
      <div class="ref-sheet">
        <h2>学生心理转介单</h2>
        <div class="ref-sub">乡育心桥 · RuralBridge 生成 · ${esc(m.date)}</div>
        <table>
          <tr><th>学生姓名</th><td>${esc(stu.name)}</td><th>账号</th><td>${esc(stu.uid)}</td></tr>
          <tr><th>所属班级</th><td>${esc(m.klass)}</td><th>风险等级</th><td>${esc(stu.levelTxt)}</td></tr>
          <tr><th>风险类型</th><td colspan="3">${esc(stu.riskType)}</td></tr>
          <tr><th>风险分</th><td>${esc(stu.score)} / 100</td><th>最近提交</th><td>${esc(stu.last)}</td></tr>
          <tr><th>转介机构</th><td colspan="3">${esc(m.org)}</td></tr>
        </table>
        <div style="font-weight:700;margin-top:16px">一、转介依据</div>
        <ul class="mini-list">
          ${m.evidence.map(e => '<li>' + esc(e) + '</li>').join('')}
        </ul>
        <div style="font-weight:700;margin-top:14px">二、已采取的校内措施</div>
        <ul class="mini-list">
          ${m.measures.map(e => '<li>' + esc(e) + '</li>').join('')}
        </ul>
        <div style="font-weight:700;margin-top:14px">三、转介建议</div>
        <div>${esc(m.suggestion)}</div>
        <div class="sign">
          <span>学校心理教师签字：____________</span>
          <span>监护人签字：____________</span>
          <span>日期：${esc(m.date)}</span>
        </div>
      </div>
      <div class="notice info no-print" style="margin-top:14px"><div>点击上方「下载 PDF」可直接保存文件，也可用系统打印输出纸质件。转介单含学生敏感信息，仅限校内与转介机构使用。</div></div>`;
  }

  /* 转介单 PDF：直接下载，不走打印窗口 */
  async function exportReferralPDF() {
    const m = refModel();
    if (!m) { alert('请先选择学生'); return; }
    const btn = $('#btnRefPrint');
    const old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '正在生成…'; }
    try {
      const r = await RB.pdfReport.exportReferralPDF(m);
      RB.pdfReport.downloadPDF(r);
      if (r.missing && r.missing.length) {
        alert('PDF 已导出，但有 ' + r.missing.length + ' 个字符不在内置字体中，已用「?」代替：' +
          r.missing.slice(0, 8).join(' ') + (r.missing.length > 8 ? ' …' : ''));
      }
    } catch (e) {
      alert('PDF 导出失败：' + (e && e.message ? e.message : e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old; }
    }
  }

  /* ---------------- 专业工具箱 ---------------- */
  const TECH_CARDS = [
    { t:'安全计划干预（Safety Planning）', d:'与学生协作列出：预警信号 → 自我安抚方式 → 可求助的人与场所 → 紧急联系方式。纸质版双方各留一份，危机时可立即调用。' },
    { t:'认知重构（CBT 三栏记录）', d:'记录「事件—想法—情绪」三栏，引导识别自动化负性思维，检验支持与反对证据，替换为更平衡的解释。每周回看一次。' },
    { t:'情绪 ABC 训练', d:'回溯诱发事件（A）与内在信念（B），识别不合理信念，配合呼吸放松降低生理唤醒，再协商替代行为（C）。' },
    { t:'依恋取向支持（留守儿童）', d:'建立稳定、可预期的替代性支持关系：固定时间、固定教师、固定回应方式，以可预测性降低不安全感。' },
    { t:'心理韧性双线干预', d:'外部补足支持网络（教师关注 + 同伴结对 + 定期家访），内部设置可达成的小目标并即时肯定，提升自我效能。' },
    { t:'焦点解决短期治疗（SFBT）', d:'用「奇迹提问」「例外提问」寻找已有资源与成功经验，聚焦小步改变，适合动机不足或时间有限的个案。' }
  ];

  /* ---------------- 知识库：分类筛选状态 ---------------- */
  let kbCat = '';
  let kbAiResult = null;     // AI 兜底结果，仅在本地未命中时展示

  function theoryCard(t) {
    const cat = t.cat || '未分类';
    return `<div class="theory">
      <div class="th-head">
        <span class="tn">${esc(t.name)}</span>
        <span class="kb-cat-tag">${esc(cat)}</span>
        ${t.author ? `<span class="ta">${esc(t.author)}</span>` : ''}
      </div>
      <div class="ts">${esc(t.summary)}</div>
      <div class="tap">应用：${esc(t.apply)}</div>
    </div>`;
  }

  /* AI 补充卡片：必须显眼标注未经审核 */
  function aiCard(r) {
    if (!r) return '';
    if (r.found === false) {
      return `<div class="kb-ai-card kb-ai-no">
        <div class="kb-ai-tag">AI 判断 · 非公认概念</div>
        <div class="kb-ai-name">${esc(r.name || r.query || '')}</div>
        <div class="kb-ai-sum">${esc(r.summary || '')}</div>
        ${(r.cautions || []).length ? `<div class="kb-ai-cau">注意：${esc(r.cautions.join('；'))}</div>` : ''}
      </div>`;
    }
    const conf = r.confidence === 'high' ? '可信度较高' :
      (r.confidence === 'low' ? '可信度低，请核实' : '可信度中等');
    /* 模型没按结构化字段返回时（上游会无视 response_format 输出散文），
       内容仍可用但要明确告知，避免被当成已审核条目 */
    const tag = r.degraded
      ? 'AI 补充 · 自由作答未结构化 · 未经专业审核'
      : 'AI 补充 · 未经专业审核 · ' + esc(conf);
    return `<div class="kb-ai-card${r.degraded ? ' kb-ai-soft' : ''}">
      <div class="kb-ai-tag">${esc(tag)}</div>
      <div class="kb-ai-name">${esc(r.name || '')}
        ${r.category ? `<span class="kb-cat-tag">${esc(r.category)}</span>` : ''}
        ${r.author ? `<span class="ta">${esc(r.author)}</span>` : ''}</div>
      <div class="kb-ai-sum">${esc(r.summary || '')}</div>
      ${r.apply ? `<div class="kb-ai-app">应用：${esc(r.apply)}</div>` : ''}
      ${(r.cautions || []).length ? `<div class="kb-ai-cau">注意：${esc(r.cautions.join('；'))}</div>` : ''}
      <div class="kb-ai-disc">${esc(r.disclaimer || '')}</div>
    </div>`;
  }

  function renderToolbox() {
    const q = $('#ragQ');
    const out = $('#ragOut');
    const KB = RB.kb;

    /* 条数与分类 */
    const total = (RB.THEORIES || []).length;
    if ($('#kbCount')) $('#kbCount').textContent = `收录 ${total} 条`;

    const cats = KB.categories();
    if ($('#kbCats')) {
      $('#kbCats').innerHTML =
        `<button class="kb-chip ${kbCat === '' ? 'on' : ''}" data-kb-cat="">全部 <b>${total}</b></button>` +
        cats.map(c => `<button class="kb-chip ${kbCat === c.cat ? 'on' : ''}" data-kb-cat="${esc(c.cat)}">${esc(c.cat)} <b>${c.n}</b></button>`).join('');
    }

    if ($('#kbSug')) {
      $('#kbSug').innerHTML = '<span class="kb-sug-l">试试：</span>' +
        KB.SUGGEST.map(s => `<button class="kb-sug-b" data-kb-sug="${esc(s)}">${esc(s)}</button>`).join('');
    }

    const idle = () => {
      out.innerHTML = `<div class="kb-idle">
        <div>输入关键词后自动检索，也可点击上方推荐词。</div>
        <div class="kb-idle-tip">本地库覆盖疗法、发展规律、情绪机制、心理效应、常见议题、危机处置与特定群体。
        未收录的概念可点「AI 补充」，AI 结果会明确标注未经审核。</div>
      </div>`;
    };

    let lastQuery = '';

    const run = (opts) => {
      const o = opts || {};
      const kw = (q.value || '').trim();
      lastQuery = kw;
      kbAiResult = o.keepAi ? kbAiResult : null;

      if (!kw) { idle(); return; }

      const r = KB.search(kw, { cat: kbCat, limit: 30 });
      const hits = r.hits;

      if (!hits.length) {
        out.innerHTML = `<div class="kb-none">
          <div>本地库未收录「${esc(kw)}」${kbCat ? '（当前分类：' + esc(kbCat) + '）' : ''}。</div>
          <div class="kb-none-tip">可以换个说法，或点「AI 补充」让大模型解释。</div>
        </div>` + aiCard(kbAiResult);
        return;
      }

      const terms = r.terms.filter(t => t !== kw.toLowerCase()).slice(0, 8);
      const head = `<div class="kb-hit-bar">命中 <b>${hits.length}</b> 条` +
        (terms.length ? `<span class="kb-terms">（已扩展同义词：${esc(terms.join('、'))}）</span>` : '') +
        `</div>`;

      out.innerHTML = head + hits.map(h => theoryCard(h.t)).join('') + aiCard(kbAiResult);
    };

    /* AI 补充 */
    const aiBtn = $('#kbAiBtn');
    const doAi = async () => {
      const kw = (q.value || '').trim();
      if (!kw) { alert('请先输入要查询的概念'); return; }

      /* 注意：这里原先有一段「本地已收录就静默 return」的优化，
         结果导致点击毫无反应——理论库 91 条 + 同义词扩展后，
         用户输入几乎总能本地命中，按钮等于永久失效。
         用户主动点这个按钮就是要 AI 的补充视角，本地有没有都不该拦。 */
      const old = aiBtn ? aiBtn.textContent : '';
      if (aiBtn) { aiBtn.disabled = true; aiBtn.textContent = '查询中…'; }
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 75000);
        const res = await fetch('/api/ai/kb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctrl.signal,
          body: JSON.stringify({ query: kw, localHits: [] })
        });
        clearTimeout(timer);
        const data = await res.json();
        if (!data || data.ok !== true) throw new Error((data && data.error) || ('HTTP ' + res.status));
        kbAiResult = data;
      } catch (e) {
        kbAiResult = {
          found: false,
          name: kw,
          summary: 'AI 补充失败：' + (e && e.message ? e.message : e) +
            '。可稍后重试，或换用更通用的关键词在本地库检索。',
          cautions: []
        };
      } finally {
        if (aiBtn) { aiBtn.disabled = false; aiBtn.textContent = old; }
      }
      run({ keepAi: true });
    };

    q.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); run(); } };
    q.oninput = () => { if ((q.value || '').trim().length >= 1) run(); };
    if (aiBtn) aiBtn.onclick = doAi;

    $$('#kbCats [data-kb-cat]').forEach(b => b.onclick = () => {
      kbCat = b.dataset.kbCat;
      renderToolbox();
      if (lastQuery || (q.value || '').trim()) run({ keepAi: true });
    });
    $$('#kbSug [data-kb-sug]').forEach(b => b.onclick = () => {
      q.value = b.dataset.kbSug;
      kbAiResult = null;
      run();
    });

    idle();

    /* 量表速查：折叠卡片，点击展开 */
    const sl = $('#scaleList');
    if (sl) {
      const rules = (RB.SCALE_RULES || []).map(r =>
        `<li><b>${esc(r.t)}</b>：${esc(r.d)}</li>`).join('');
      const items = (RB.SCALES || []).map(s => `
        <div class="scale-item" data-scale="${esc(s.id)}">
          <div class="scale-head">
            <span class="scale-name">${esc(s.name)}</span>
            <span class="scale-full">${esc(s.full)}</span>
            <span class="scale-meta">${esc(String(s.items))} 题 · ${esc(s.time)}</span>
            <span class="scale-arrow">▾</span>
          </div>
          <div class="scale-body">
            <div class="scale-row"><b>提出者</b><span>${esc(s.author)}</span></div>
            <div class="scale-row"><b>适用</b><span>${esc(s.target)}</span></div>
            <div class="scale-row"><b>计分</b><span>${esc(s.score)}</span></div>
            <div class="scale-bands">
              ${(s.bands || []).map(b => `<span class="scale-band ${esc(b.c)}">
                <b>${esc(b.r)}</b> ${esc(b.t)}</span>`).join('')}
            </div>
            <div class="scale-row"><b>要点</b><span>${esc(s.note)}</span></div>
            ${s.warn ? `<div class="scale-warn">⚠ ${esc(s.warn)}</div>` : ''}
          </div>
        </div>`).join('');

      sl.innerHTML = `<div class="scale-rules">
          <div class="scale-rules-t">施测通用原则（比具体量表更常被违反）</div>
          <ul class="mini-list">${rules}</ul>
        </div>` + items;

      $$('#scaleList .scale-head').forEach(h => h.onclick = () => {
        h.parentNode.classList.toggle('open');
      });
    }

    $('#techCards').innerHTML = TECH_CARDS.map(c =>
      `<div class="tech-card"><div class="tc-t">${esc(c.t)}</div><div class="tc-d">${esc(c.d)}</div></div>`).join('');
  }

  /* ---------------- 注册 ---------------- */
  RB.views['counselor:queue'] = renderQueue;
  RB.views['counselor:plan'] = renderPlan;
  RB.views['counselor:cases'] = renderCases;
  RB.views['counselor:climate'] = renderClimate;
  RB.views['counselor:referral'] = renderReferral;
  RB.views['counselor:toolbox'] = renderToolbox;
})();
