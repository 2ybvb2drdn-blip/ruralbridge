-- ============================================================
-- 乡育心桥 · RuralBridge —— D1 数据库结构
-- 表：submissions（学生真实提交记录）
-- 初始化：npx wrangler d1 execute ruralbridge-db --remote --file=schema.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS submissions (
  id          TEXT PRIMARY KEY,
  user        TEXT NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,        -- questionnaire | record
  answers     TEXT,                 -- JSON 字符串
  text        TEXT,                 -- 日常记录正文
  level       TEXT,                 -- green | yellow | red
  risk_type   TEXT,
  evidence    TEXT,                 -- JSON 数组
  steps       TEXT,                 -- JSON 数组
  talk        TEXT,                 -- JSON 数组
  rule_hits   TEXT,                 -- JSON 数组
  score       INTEGER DEFAULT 0,
  engine      TEXT,
  q_version   TEXT DEFAULT 'v1',      -- 问卷版本：v1=10 题旧版 / v2=12 题新版
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sub_created ON submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_user    ON submissions (user);
