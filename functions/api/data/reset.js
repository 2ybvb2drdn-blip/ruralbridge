/* ============================================================
 * 乡育心桥 · RuralBridge —— 学生数据重置接口（Cloudflare Pages Function）
 * 路由：POST /api/data/reset
 *
 * 职责：清空全部学生提交数据，供测试反复演练。
 * 仅教师 / 心理教师后台调用（前端按钮带二次确认）。
 * 存储：D1（SQLite，强一致）绑定 RURALBRIDGE_DB
 *
 * 请求体（可选）：{ confirm: "RESET" }  —— 防止误触
 * 响应：{ ok:true, deleted:N }
 * ============================================================ */

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export async function onRequestPost({ request, env }) {
  const DB = env.RURALBRIDGE_DB;
  if (!DB) {
    return json({ ok: false, error: '服务端未绑定 D1 数据库 RURALBRIDGE_DB' }, 503);
  }

  let body = {};
  try { body = await request.json(); } catch { /* 允许空体 */ }
  if (body && body.confirm && body.confirm !== 'RESET') {
    return json({ ok: false, error: '确认参数不正确' }, 400);
  }

  try {
    const before = await DB.prepare('SELECT COUNT(*) AS n FROM submissions').first();
    const deleted = (before && before.n) || 0;
    await DB.prepare('DELETE FROM submissions').run();
    return json({ ok: true, deleted });
  } catch (e) {
    return json({ ok: false, error: '重置失败：' + (e && e.message ? e.message : String(e)) }, 502);
  }
}

export async function onRequestGet() {
  return json({ ok: false, error: '请使用 POST 调用本接口' }, 405);
}
