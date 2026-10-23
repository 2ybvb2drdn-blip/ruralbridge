/* ============================================================
 * 乡育心桥 · RuralBridge —— 学生数据提交接口（Cloudflare Pages Function）
 * 路由：POST /api/data/submit
 *
 * 职责：把学生真实提交的问卷作答 / 日常记录（含 AI 评估结果）落库，
 *      供班主任、心理教师后台实时读取。
 *
 * 存储：D1（SQLite，强一致）绑定 RURALBRIDGE_DB，表 submissions
 *      选用 D1 而非 KV：教师后台必须「学生刚提交就能立刻看到」，
 *      KV 的 list 有最多 60 秒缓存，会导致演示时看不到新数据。
 *
 * 请求体：
 *   {
 *     user: "student1", name: "学生1",
 *     type: "questionnaire" | "record",
 *     answers: {...}, text: "...",
 *     result: { level, riskType, evidence, steps, talk, ruleHits, score, engine }
 *   }
 * 响应：{ ok:true, id, createdAt }
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
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export async function onRequestPost({ request, env }) {
  const DB = env.RURALBRIDGE_DB;
  if (!DB) {
    return json({ ok: false, error: '服务端未绑定 D1 数据库 RURALBRIDGE_DB' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: '请求体不是合法 JSON' }, 400); }

  const user = String(body.user || '').slice(0, 40);
  const name = String(body.name || user || '学生').slice(0, 40);
  const type = body.type === 'record' ? 'record' : 'questionnaire';
  const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
  const text = String(body.text || '').slice(0, 2000);
  const result = body.result && typeof body.result === 'object' ? body.result : {};
  /* 问卷版本：跟着作答走，不能靠猜。
     改版后若用新题表去算旧作答，所有题都取不到值，分数会变 0。 */
  const qVersion = String(body.qVersion || result.qVersion || '').slice(0, 8)
    || (type === 'questionnaire' ? 'v1' : '');

  if (!user) return json({ ok: false, error: '缺少 user 字段' }, 400);
  if (type === 'questionnaire' && Object.keys(answers).length === 0) {
    return json({ ok: false, error: '问卷作答为空' }, 400);
  }
  if (type === 'record' && !text) {
    return json({ ok: false, error: '日常记录内容为空' }, 400);
  }

  const createdAt = Date.now();
  const id = rid();
  const level = ['green', 'yellow', 'red'].indexOf(result.level) !== -1 ? result.level : 'green';
  const evidence = Array.isArray(result.evidence) ? result.evidence.slice(0, 8).map(String) : [];
  const steps = Array.isArray(result.steps) ? result.steps.slice(0, 8).map(s => ({ t: String(s.t || '').slice(0, 60), d: String(s.d || '').slice(0, 400) })) : [];
  const talk = Array.isArray(result.talk) ? result.talk.slice(0, 5).map(String) : [];
  const ruleHits = Array.isArray(result.ruleHits) ? result.ruleHits.slice(0, 8) : [];

  try {
    await DB.prepare(
      `INSERT INTO submissions
        (id, user, name, type, answers, text, level, risk_type, evidence, steps, talk, rule_hits, score, engine, q_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, user, name, type,
      JSON.stringify(answers), text, level,
      String(result.riskType || '').slice(0, 80),
      JSON.stringify(evidence), JSON.stringify(steps), JSON.stringify(talk), JSON.stringify(ruleHits),
      Number(result.score) || 0,
      String(result.engine || 'local').slice(0, 20),
      qVersion,
      createdAt
    ).run();
  } catch (e) {
    return json({ ok: false, error: '写入数据库失败：' + (e && e.message ? e.message : String(e)) }, 502);
  }

  return json({ ok: true, id, createdAt });
}

export async function onRequestGet() {
  return json({ ok: false, error: '请使用 POST 调用本接口' }, 405);
}
