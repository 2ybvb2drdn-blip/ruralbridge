# 线上后端说明（Serverless 函数）

> 演示站为纯静态页面，**不依赖本目录**即可完整运行。
> 本目录说明线上环境如何把 AI 能力接上，同时保证 API Key 不暴露在前端。

## 为什么需要后端

前端若直接调用大模型 API，Key 会明文出现在浏览器里，任何人打开开发者工具都能拿到并盗用。
因此线上环境的铁律是：**所有大模型调用经服务端转发**。

```
浏览器 ──POST /api/ai/assess──▶ Serverless 函数 ──▶ 大模型 API
                                    │
                              Key 存于环境变量
```

## 目录规划

```
server/
├── api/
│   ├── ai-assess.js      心理评估（规则引擎 + 大模型 + RAG）
│   ├── record.js         日常记录入库
│   └── export.js         报表导出
├── lib/
│   ├── rules.js          规则引擎（与前端同源，服务端复算一遍做校验）
│   └── rag.js            向量检索
└── README.md
```

## 环境变量

复制根目录 `.env.example` 为 `.env`，在部署平台（Cloudflare Pages / Vercel）的项目设置里配置同名环境变量：

| 变量 | 说明 | 是否保密 |
|---|---|---|
| `AI_API_BASE` | 大模型 API 地址 | 否 |
| `AI_API_KEY` | 大模型 API 密钥 | **是** |
| `AI_MODEL` | 模型名称 | 否 |

> 平台环境变量不会被前端代码读取，仅函数运行时可见。

## Cloudflare Pages Functions 示例

```js
// server/api/ai-assess.js
export async function onRequestPost({ request, env }) {
  const body = await request.json();

  // 1) 规则引擎硬筛查（与前端同源，服务端复算，防止前端被篡改绕过）
  const hits = ruleScan(body.text || '');
  const hard = hits.find(h => h.hard);

  // 2) 高危直接返回，不调用大模型
  if (hard) {
    return Response.json({ level: 'red', riskType: hard.type, hardTriggered: true, ruleHits: hits });
  }

  // 3) 语义推理（Key 仅存在于 env，不出服务端）
  const r = await fetch(env.AI_API_BASE + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.AI_API_KEY },
    body: JSON.stringify({
      model: env.AI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(body) }
      ],
      response_format: { type: 'json_object' }
    })
  });
  const out = await r.json();

  // 4) RAG 检索 + 方案生成（略）
  return Response.json(JSON.parse(out.choices[0].message.content));
}
```

## 提示词要点（SYSTEM_PROMPT）

- 角色设定：乡村学校心理教师辅助工具；
- **红线约束**：禁止下医学诊断结论；不得替代专业干预；涉及自伤/自杀必须建议转介；
- 输出格式：强制 JSON Schema（level / riskType / evidence / steps / theoryRefs），便于前端渲染；
- 语言要求：面向非专业教师，使用口语化、可执行的表述。

## 降级策略

| 情况 | 处理 |
|---|---|
| 大模型 API 超时 | 返回规则引擎结果 + 提示"语义分析暂不可用" |
| 大模型额度耗尽 | 切换到备用 API（配置第二组环境变量） |
| 向量库不可用 | 退化为关键词检索，方案仍可生成 |

> 演示站已内置上述降级逻辑的等效实现：即使完全无网络，规则引擎与理论库也能给出结构化结果。
