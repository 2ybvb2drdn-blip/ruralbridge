/* ============================================================
 * 乡育心桥 · RuralBridge —— 学生数据读取接口（Cloudflare Pages Function）
 * 路由：GET /api/data/list
 *
 * 职责：供班主任、心理教师后台读取学生真实提交记录，
 *      按学生聚合出个体状态与班级概览。
 * 存储：D1（SQLite，强一致）绑定 RURALBRIDGE_DB
 *
 * 响应：
 *   {
 *     ok: true,
 *     submissions: [ { ...单条提交... } ],   // 按时间倒序，最多 200 条
 *     students: [ { user, name, level, score, riskType,
 *                   last, count, tags } ],  // 按学生聚合（取最近一次）
 *     stats: { total, red, yellow, green, submissions },
 *     updatedAt
 *   }
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

function parseArr(s) {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

const LEVEL_RANK = { green: 0, yellow: 1, red: 2 };

export async function onRequestGet({ env }) {
  const DB = env.RURALBRIDGE_DB;
  if (!DB) {
    return json({ ok: false, error: '服务端未绑定 D1 数据库 RURALBRIDGE_DB' }, 503);
  }

  let rows;
  try {
    const res = await DB.prepare(
      `SELECT * FROM submissions ORDER BY created_at DESC LIMIT 200`
    ).all();
    rows = (res && res.results) || [];
  } catch (e) {
    return json({ ok: false, error: '读取数据库失败：' + (e && e.message ? e.message : String(e)) }, 502);
  }

  const submissions = rows.map(r => ({
    id: r.id,
    user: r.user,
    name: r.name,
    type: r.type,
    answers: (() => { try { return JSON.parse(r.answers || '{}'); } catch { return {}; } })(),
    text: r.text || '',
    level: r.level,
    riskType: r.risk_type || '',
    evidence: parseArr(r.evidence),
    steps: parseArr(r.steps),
    talk: parseArr(r.talk),
    ruleHits: parseArr(r.rule_hits),
    score: r.score || 0,
    engine: r.engine || 'local',
    qVersion: r.q_version || '',
    createdAt: r.created_at
  }));

  // 按学生聚合（submissions 已按时间倒序，首次出现即最近一次）
  const byUser = {};
  const order = [];
  submissions.forEach(s => {
    const u = s.user || s.name || 'unknown';
    if (!byUser[u]) {
      byUser[u] = {
        user: u,
        name: s.name || u,
        count: 0,
        level: s.level || 'green',
        score: s.score || 0,
        riskType: s.riskType || '',
        tags: [],
        createdAt: s.createdAt
      };
      order.push(u);
    }
    const st = byUser[u];
    st.count++;
    const sig = s.riskType || '';
    if (sig && st.tags.indexOf(sig) === -1 && st.tags.length < 5) st.tags.push(sig);
  });

  const students = order.map(u => {
    const st = byUser[u];
    const d = new Date(st.createdAt || 0);
    const pad = n => String(n).padStart(2, '0');
    st.last = st.createdAt ? (pad(d.getMonth() + 1) + '-' + pad(d.getDate())) : '—';
    return st;
  }).sort((a, b) => (LEVEL_RANK[b.level] - LEVEL_RANK[a.level]) || (b.score - a.score));

  const stats = {
    total: students.length,
    red: students.filter(s => s.level === 'red').length,
    yellow: students.filter(s => s.level === 'yellow').length,
    green: students.filter(s => s.level === 'green').length,
    submissions: submissions.length
  };

  return json({ ok: true, submissions, students, stats, updatedAt: Date.now() });
}

export async function onRequestPost() {
  return json({ ok: false, error: '请使用 GET 调用本接口' }, 405);
}
