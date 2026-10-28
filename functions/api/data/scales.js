/* ============================================================
 * 乡育心桥 · RuralBridge —— 量表派发与提交（Cloudflare Pages Function）
 * 路由：/api/data/scales
 *
 * 背景：
 *   项目原有的 12 题问卷是「普查」工具，用于全班筛查；
 *   但发现红色学生后，心理教师需要更深入的单量表评估
 *   （如 PHQ-9 确认抑郁严重程度），原系统帮不上。
 *   本接口补上「普查 → 个案评估」这一环。
 *
 * 接口：
 *   GET  /api/data/scales                  → 全部任务（教师端）
 *   GET  /api/data/scales?user=student1    → 该学生的任务（学生端）
 *   POST /api/data/scales  {action:'assign', user, name, scaleId, due}
 *   POST /api/data/scales  {action:'submit', id, answers, result}
 *   POST /api/data/scales  {action:'revoke', id}
 *
 * 存储：D1 表 scale_tasks（2026-10-28 建表）
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

function rid() {
  return 'st-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function parseObj(s) {
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

/* 允许派发的量表白名单（与前端 scalebank.js 保持一致）
   只收授权干净的：PHQ-9 / GAD-7 / ISI / C-SSRS */
const ALLOWED = ['PHQ-9', 'GAD-7', 'ISI', 'C-SSRS'];

/* 需要一对一施测、不可集体填写的量表 */
const ONE_ON_ONE = ['C-SSRS'];

function rowToTask(r) {
  return {
    id: r.id,
    user: r.user,
    name: r.name,
    scaleId: r.scale_id,
    assignedBy: r.assigned_by || '',
    assignedAt: r.assigned_at,
    due: r.due || '',
    status: r.status || 'pending',
    answers: r.answers ? parseObj(r.answers) : null,
    score: Number(r.score) || 0,
    level: r.level || '',
    detail: r.detail || '',
    submittedAt: r.submitted_at || 0,
    oneOnOne: ONE_ON_ONE.indexOf(r.scale_id) !== -1
  };
}

export async function onRequestGet({ request, env }) {
  const DB = env.RURALBRIDGE_DB;
  if (!DB) return json({ ok: false, error: '服务端未绑定 D1 数据库 RURALBRIDGE_DB' }, 503);

  const url = new URL(request.url);
  const user = (url.searchParams.get('user') || '').trim();

  let res;
  try {
    if (user) {
      /* 学生端：只看自己的 */
      res = await DB.prepare(
        'SELECT * FROM scale_tasks WHERE user = ? ORDER BY assigned_at DESC LIMIT 50'
      ).bind(user).all();
    } else {
      /* 教师端：全部，最多 300 条 */
      res = await DB.prepare(
        'SELECT * FROM scale_tasks ORDER BY assigned_at DESC LIMIT 300'
      ).all();
    }
  } catch (e) {
    return json({ ok: false, error: '读取失败：' + (e && e.message ? e.message : e) }, 502);
  }

  const rows = (res && res.results) || [];
  const tasks = rows.map(rowToTask);
  return json({
    ok: true,
    tasks,
    stats: {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      done: tasks.filter(t => t.status === 'done').length,
      red: tasks.filter(t => t.level === 'red').length
    },
    updatedAt: Date.now()
  });
}

export async function onRequestPost({ request, env }) {
  const DB = env.RURALBRIDGE_DB;
  if (!DB) return json({ ok: false, error: '服务端未绑定 D1 数据库 RURALBRIDGE_DB' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: '请求体不是合法 JSON' }, 400); }

  const action = String(body.action || '').trim();

  /* ---------------- 派发 ---------------- */
  if (action === 'assign') {
    const user = String(body.user || '').trim().slice(0, 40);
    const name = String(body.name || user || '学生').slice(0, 40);
    const scaleId = String(body.scaleId || '').trim();
    const due = String(body.due || '').slice(0, 20);
    const assignedBy = String(body.assignedBy || '').slice(0, 40);

    if (!user) return json({ ok: false, error: '缺少 user' }, 400);
    if (ALLOWED.indexOf(scaleId) === -1) {
      return json({ ok: false, error: '不支持的量表：' + scaleId + '（可用：' + ALLOWED.join(' / ') + '）' }, 400);
    }

    /* 同一学生同一量表若已有未完成的，直接返回那条，不重复派发 */
    try {
      const exist = await DB.prepare(
        "SELECT * FROM scale_tasks WHERE user = ? AND scale_id = ? AND status = 'pending' LIMIT 1"
      ).bind(user, scaleId).all();
      const hit = (exist && exist.results && exist.results[0]);
      if (hit) {
        return json({ ok: true, id: hit.id, existed: true, task: rowToTask(hit) });
      }
    } catch (e) { /* 查询失败不阻断派发 */ }

    const now = Date.now();
    const id = rid();
    try {
      await DB.prepare(
        `INSERT INTO scale_tasks
          (id, user, name, scale_id, assigned_by, assigned_at, due, status, answers, score, level, detail, submitted_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, 0, '', '', 0, ?)`
      ).bind(id, user, name, scaleId, assignedBy, now, due, now).run();
    } catch (e) {
      return json({ ok: false, error: '写入失败：' + (e && e.message ? e.message : e) }, 502);
    }

    return json({ ok: true, id, existed: false, task: rowToTask({
      id, user, name, scale_id: scaleId, assigned_by: assignedBy,
      assigned_at: now, due, status: 'pending', answers: null,
      score: 0, level: '', detail: '', submitted_at: 0
    }) });
  }

  /* ---------------- 提交 ---------------- */
  if (action === 'submit') {
    const id = String(body.id || '').trim();
    const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
    const result = body.result && typeof body.result === 'object' ? body.result : {};

    if (!id) return json({ ok: false, error: '缺少 id' }, 400);
    if (!Object.keys(answers).length) return json({ ok: false, error: '作答为空' }, 400);

    let task;
    try {
      const r = await DB.prepare('SELECT * FROM scale_tasks WHERE id = ? LIMIT 1').bind(id).all();
      task = (r && r.results && r.results[0]) || null;
    } catch (e) {
      return json({ ok: false, error: '查询任务失败：' + (e && e.message ? e.message : e) }, 502);
    }
    if (!task) return json({ ok: false, error: '任务不存在' }, 404);
    if (task.status === 'done') return json({ ok: false, error: '该量表已提交，无需重复提交' }, 409);

    const level = ['green', 'yellow', 'red'].indexOf(result.level) !== -1 ? result.level : 'green';
    const now = Date.now();
    try {
      await DB.prepare(
        `UPDATE scale_tasks
           SET status = 'done', answers = ?, score = ?, level = ?, detail = ?, submitted_at = ?
         WHERE id = ?`
      ).bind(
        JSON.stringify(answers),
        Number(result.score) || 0,
        level,
        String(result.detail || '').slice(0, 200),
        now, id
      ).run();
    } catch (e) {
      return json({ ok: false, error: '写入失败：' + (e && e.message ? e.message : e) }, 502);
    }

    return json({ ok: true, id, level, submittedAt: now });
  }

  /* ---------------- 撤回 ---------------- */
  if (action === 'revoke') {
    const id = String(body.id || '').trim();
    if (!id) return json({ ok: false, error: '缺少 id' }, 400);
    try {
      await DB.prepare("DELETE FROM scale_tasks WHERE id = ? AND status = 'pending'").bind(id).run();
    } catch (e) {
      return json({ ok: false, error: '撤回失败：' + (e && e.message ? e.message : e) }, 502);
    }
    return json({ ok: true, id });
  }

  return json({ ok: false, error: '未知 action：' + action + '（支持 assign / submit / revoke）' }, 400);
}
