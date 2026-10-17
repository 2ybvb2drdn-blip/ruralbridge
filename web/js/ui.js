/* ============================================================
 * 乡育心桥 · RuralBridge — UI 基础层
 * 职责：DOM 工具、通用渲染片段、角色导航、路由分发、本地存储
 * 说明：所有视图模块向 RB.views 注册 'role:tab' 处理函数
 * ============================================================ */
(function () {
  'use strict';
  const RB = window.RB;

  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  const LV = {
    green:  { txt:'绿色 · 状态良好', short:'绿色' },
    yellow: { txt:'黄色 · 需关注',   short:'黄色' },
    red:    { txt:'红色 · 需干预',   short:'红色' }
  };

  /* ---------------- 通用片段 ---------------- */
  function metric(cls, num, lbl) {
    return `<div class="card metric ${cls}"><div class="num">${num}</div><div class="lbl">${esc(lbl)}</div></div>`;
  }
  function kv(k, v) { return `<div class="kv"><span>${esc(k)}：</span><b>${esc(v)}</b></div>`; }
  function notice(level, title, desc) {
    return `<div class="notice ${level}"><div><div class="ttl">${esc(title)}</div><div>${esc(desc)}</div></div></div>`;
  }
  function empty(txt) { return `<div class="empty">${esc(txt)}</div>`; }
  function steps(list, cls) {
    if (!list || !list.length) return '';
    return `<ol class="steps ${cls || ''}">${list.map(s =>
      `<li><div class="st">${esc(s.t)}</div><div class="sd">${esc(s.d)}</div></li>`).join('')}</ol>`;
  }
  function bulletList(arr) {
    if (!arr || !arr.length) return '';
    return `<ul class="mini-list">${arr.map(x => '<li>' + esc(x) + '</li>').join('')}</ul>`;
  }
  function pill(level) {
    return `<span class="pill ${level}">${LV[level] ? LV[level].txt : level}</span>`;
  }
  function aiBlock(title, body, cls) {
    if (!body) return '';
    return `<div class="ai-block ${cls || ''}"><div class="ab-t">${esc(title)}</div><div>${esc(body)}</div></div>`;
  }
  function loading(txt) {
    return `<div class="loading"><div class="spinner"></div>${esc(txt)}</div>`;
  }
  function ts(ms) { return ms ? new Date(ms).toLocaleString('zh-CN') : '—'; }

  /* ---------------- 本地存储（台账/档案/勾选） ---------------- */
  function lsGet(key, dflt) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : dflt;
    } catch (e) { return dflt; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 忽略配额错误 */ }
  }

  /* ---------------- 顶栏 + 导航 ---------------- */
  function renderChrome() {
    const u = RB.state.user;
    const meta = RB.ROLE_META[u.role] || {};

    $('#whoName').textContent = u.name + ' · ' + u.roleName;
    $('#whoClass').textContent = u.klass;
    const chip = $('#roleChip');
    if (chip) chip.textContent = meta.chip || u.roleName;

    const nav = RB.NAV[u.role] || [];
    $('#tabs').innerHTML = nav.map((n, i) =>
      `<button data-tab="${n.tab}"${i === 0 ? ' class="active"' : ''}>${esc(n.label)}</button>`).join('');
    $$('#tabs button').forEach(b => b.onclick = () => RB.route(b.dataset.tab));
  }

  function renderBanner(el, role) {
    if (!el) return;
    const meta = RB.ROLE_META[role];
    if (!meta) { el.innerHTML = ''; return; }
    el.className = 'role-banner' + (role === 'counselor' ? ' counselor' : '');
    el.innerHTML = `<div class="rb-icon">${role === 'counselor' ? '心' : '班'}</div>
      <div>${meta.hero}</div>`;
  }

  /* ---------------- 路由 ---------------- */
  RB.state = { user:null, tab:null, answers:{}, tags:[], data:null, loading:false };
  RB.views = {};

  RB.route = function (tab) {
    const u = RB.state.user;
    if (!u) return;
    RB.state.tab = tab;
    $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + tab));
    window.scrollTo({ top:0, behavior:'smooth' });
    const fn = RB.views[u.role + ':' + tab];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) {
        console.error('[view:' + tab + ']', e);
      }
    }
  };

  /* ---------------- 数据加载（教师/心理教师后台） ---------------- */
  RB.loadData = async function (force) {
    if (RB.state.data && !force) return RB.state.data;
    RB.state.loading = true;
    try {
      const res = await fetch('/api/data/list', { headers: { 'Accept':'application/json' } });
      const data = await res.json();
      if (!data || data.ok !== true) throw new Error((data && data.error) || ('HTTP ' + res.status));
      RB.state.data = data;
    } catch (e) {
      RB.state.data = {
        ok:false, error: e.message || String(e),
        submissions:[], students:[],
        stats:{ total:0, red:0, yellow:0, green:0, submissions:0 }
      };
    } finally {
      RB.state.loading = false;
    }
    return RB.state.data;
  };

  /* ---------------- 交接状态（心理教师接手 → 班主任可见徽标） ---------------- */
  RB.handover = {
    all() { return lsGet('rb_handover', {}); },
    isOn(user) { return !!this.all()[user]; },
    toggle(user) {
      const m = this.all();
      if (m[user]) delete m[user]; else m[user] = Date.now();
      lsSet('rb_handover', m);
      return !!m[user];
    }
  };

  RB.ui = {
    $, $$, esc, LV, metric, kv, notice, empty, steps, bulletList, pill, aiBlock, loading, ts,
    lsGet, lsSet, renderChrome, renderBanner
  };
})();
