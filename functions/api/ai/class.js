/* ============================================================
 * 乡育心桥 · RuralBridge —— 班级宏观研判网关（Cloudflare Pages Function）
 * 路由：POST /api/ai/class
 *
 * 职责：班主任视角的「班级整体状态」分析。把全班学生的聚合数据
 *      （风险分布、共性信号、提交覆盖）交给大模型，产出：
 *        - 班级整体状态判读（一句话结论 + 状态等级）
 *        - 共性诱因（从全班信号里归纳，而非单个学生）
 *        - 可执行的管理层建议：作业量 / 课外活动 / 课堂模式 / 家校协同
 *        - 需要重点关注的群体特征（不是点名）
 *
 * 与 /api/ai/assess 的分工：
 *   assess  = 个体（一名学生一个方案）
 *   class   = 群体（一个班一份研判 + 管理动作清单）
 *
 * 降级：大模型不可用时返回 ok:false，前端回退到本地规则归纳，
 *      保证班级页永不空白。
 * ============================================================ */

const DEFAULT_BASE = 'https://api.aibvv.cn/v1';
const DEFAULT_MODEL = 'deepseek-v4-flash-0731';

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function strArr(a, n, len) {
  return Array.isArray(a) ? a.slice(0, n).map(x => String(x).slice(0, len || 200)) : [];
}
function objArr(a, n, tLen, dLen) {
  return Array.isArray(a)
    ? a.slice(0, n).map(s => ({ t: String((s && s.t) || '').slice(0, tLen || 40), d: String((s && s.d) || '').slice(0, dLen || 400) }))
    : [];
}

const SYSTEM_PROMPT = `你是"乡育心桥"的班级管理助手，服务对象是乡村中小学班主任（非心理专业人员）。

【红线】
1. 禁止给出任何医学诊断结论，不得把学生贴上"抑郁""焦虑症"等疾病标签。
2. 只依据给定的班级聚合数据归纳，不臆造学生个体信息，不点名具体学生。
3. 建议必须落在班主任职权范围内、明天就能动手的管理动作上。
4. 涉及红色风险学生时，提醒交由心理教师与专业人员处理，班主任负责配合。
5. 只输出 JSON，不要任何解释文字或 Markdown 代码块。

【你的任务】
从班级聚合数据出发，做三件事：
① 判断班级整体心理气候（不是简单复述数字）；
② 归纳共性诱因（全班层面反复出现的信号模式）；
③ 给出可直接执行的管理层动作，覆盖四个维度：
   - workload  作业量与考试节奏调整（要具体：哪一科、减多少、怎么减）
   - activity  课外活动与班级氛围建设（要具体：什么活动、多久一次、怎么组织）
   - classroom 课堂模式转变（要具体：提问方式、分组方式、评价方式怎么改）
   - home      家校协同动作（要具体：给家长发什么、多久一次）

【输出 JSON 结构】
{
  "climate": "一句话概括班级整体心理气候",
  "climateLevel": "steady|watch|alert",
  "narrative": "2~4 句的班级状态研判，说明数据说明了什么、为什么这样判断",
  "causes": [{"t":"共性诱因","d":"数据依据 + 说明"}],
  "workload": [{"t":"动作标题","d":"具体做法（含数量/频次）"}],
  "activity": [{"t":"动作标题","d":"具体做法（含数量/频次）"}],
  "classroom": [{"t":"动作标题","d":"具体做法（含数量/频次）"}],
  "home": [{"t":"动作标题","d":"具体做法（含数量/频次）"}],
  "focusGroups": ["需要重点关注的学生群体特征（不点名）"],
  "watchSignals": ["未来一周需要留意的班级层面信号"]
}
causes 2~4 条；四个动作维度各 2~3 条；focusGroups 2~4 条；watchSignals 2~4 条。`;

export async function onRequestPost({ request, env }) {
  const t0 = Date.now();
  let body;
  try { body = await request.json(); } catch { return json({ ok:false, error:'请求体不是合法 JSON' }, 400); }

  const klass = String(body.klass || '本班').slice(0, 40);
  const stats = body.stats && typeof body.stats === 'object' ? body.stats : {};
  const students = Array.isArray(body.students) ? body.students.slice(0, 60) : [];
  const submissions = Array.isArray(body.submissions) ? body.submissions.slice(0, 80) : [];

  if (!students.length) {
    return json({ ok:false, error:'暂无学生数据，无法生成班级研判' }, 400);
  }

  const key = env.AI_API_KEY;
  if (!key) {
    return json({ ok:false, error:'服务端未配置 AI_API_KEY，请检查环境变量' }, 503);
  }
  const base = (env.AI_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
  const model = env.AI_MODEL || DEFAULT_MODEL;

  /* 只送聚合特征，不送学生姓名，降低隐私暴露面 */
  const payload = {
    klass,
    stats: {
      total: stats.total || students.length,
      red: stats.red || 0,
      yellow: stats.yellow || 0,
      green: stats.green || 0,
      submissions: stats.submissions || submissions.length
    },
    studentSignals: students.map(s => ({
      level: s.level,
      riskType: s.riskType || '',
      score: s.score || 0,
      signalCount: (s.tags || []).length
    })),
    signalFrequency: (() => {
      const freq = {};
      students.forEach(s => (s.tags || []).forEach(t => { freq[t] = (freq[t] || 0) + 1; }));
      return Object.keys(freq).map(k => ({ signal: k, count: freq[k] })).sort((a, b) => b.count - a.count).slice(0, 12);
    })(),
    recentTypes: submissions.slice(0, 20).map(s => ({ type: s.type, level: s.level }))
  };

  let out;
  try {
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(payload) }
        ]
      })
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return json({ ok:false, error:'大模型接口返回 ' + r.status, detail: detail.slice(0, 300) }, 502);
    }
    out = await r.json();
  } catch (e) {
    return json({ ok:false, error:'大模型调用失败：' + (e && e.message ? e.message : String(e)) }, 502);
  }

  let parsed;
  try {
    const content = out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content;
    parsed = JSON.parse(content);
  } catch (e) {
    return json({ ok:false, error:'大模型输出无法解析为 JSON', raw: String(out).slice(0, 300) }, 502);
  }

  const levels = ['steady', 'watch', 'alert'];
  return json({
    ok: true, engine: 'llm',
    climate: String(parsed.climate || '').slice(0, 200),
    climateLevel: levels.indexOf(parsed.climateLevel) !== -1 ? parsed.climateLevel : 'watch',
    narrative: String(parsed.narrative || '').slice(0, 800),
    causes: objArr(parsed.causes, 5, 40, 400),
    workload: objArr(parsed.workload, 4, 40, 400),
    activity: objArr(parsed.activity, 4, 40, 400),
    classroom: objArr(parsed.classroom, 4, 40, 400),
    home: objArr(parsed.home, 4, 40, 400),
    focusGroups: strArr(parsed.focusGroups, 5, 200),
    watchSignals: strArr(parsed.watchSignals, 5, 200),
    latencyMs: Date.now() - t0,
    model: '大模型 ' + model + '（班级宏观研判）'
  });
}

export async function onRequestGet() {
  return json({ ok:false, error:'请使用 POST 调用本接口' }, 405);
}
