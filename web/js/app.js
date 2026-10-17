/* ============================================================
 * 乡育心桥 · RuralBridge — 启动与登录
 * 职责：登录校验、进入应用、首次路由、退出
 * 视图逻辑分散在 ui.js / teacher.js / counselor.js / student.js
 * ============================================================ */
(function () {
  'use strict';
  const RB = window.RB;
  const U = RB.ui;
  const { $, $$ } = U;

  function login(user, pass) {
    return RB.ACCOUNTS.find(a => a.user === user && a.pass === pass) || null;
  }

  async function enterApp() {
    $('#login').style.display = 'none';
    $('#app').style.display = 'block';

    RB.state.user = RB.state.user;
    U.renderChrome();

    const role = RB.state.user.role;
    const first = (RB.NAV[role] || [])[0];

    if (RB.isStaff(RB.state.user)) {
      await RB.loadData(true);
    } else {
      RB.state.answers = {};
      RB.state.tags = [];
    }

    if (first) RB.route(first.tab);
  }

  function doLogout() {
    RB.state.user = null;
    RB.state.data = null;
    RB.state.answers = {};
    RB.state.tags = [];
    RB.state.tab = null;

    $('#app').style.display = 'none';
    $('#login').style.display = 'flex';
    $('#qResult').innerHTML = '';
    $('#recResult').innerHTML = '';
    $('#recText').value = '';
    $('#qProg').textContent = '0 / 10';
    $('#u').value = '';
    $('#p').value = '';
    $('#loginErr').textContent = '';
  }

  document.addEventListener('DOMContentLoaded', function () {
    /* 登录 */
    $('#loginForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      const acc = login($('#u').value.trim(), $('#p').value);
      if (!acc) { $('#loginErr').textContent = '账号或密码不正确'; return; }
      $('#loginErr').textContent = '';
      RB.state.user = acc;
      await enterApp();
    });

    /* 一键填入 */
    $$('#fillBtns [data-fill]').forEach(b => b.onclick = () => {
      $('#u').value = b.dataset.fill;
      $('#p').value = '12345678';
      $('#loginErr').textContent = '';
    });

    /* 退出 */
    $('#logout').onclick = doLogout;

    /* 学生端按钮 */
    if ($('#btnSubmitQ')) $('#btnSubmitQ').onclick = () => RB.student.submitQuestionnaire();
    if ($('#btnResetQ')) $('#btnResetQ').onclick = () => {
      RB.state.answers = {};
      RB.state.tags = [];
      RB.views['student:questionnaire']();
      $('#qResult').innerHTML = '';
    };
    if ($('#btnSubmitR')) $('#btnSubmitR').onclick = () => RB.student.submitRecord();
  });
})();
