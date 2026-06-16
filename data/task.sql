-- Qtian Task System Schema
-- 数据库文件: workspace/task/task.db
-- 任务系统为公共基础设施，不参与软删除（任务历史全量保留）

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================================
-- task 主表（所有任务类型的公共字段）
-- ============================================================
CREATE TABLE IF NOT EXISTS task (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  type           TEXT NOT NULL,          -- 'agent' | 'batch' | 'tool_execution'
  source         TEXT NOT NULL,          -- 'todo-app' | 'doc-app' | 'unknown'
  source_ref_id  INTEGER,                -- 来源业务实体 ID（如 todo_item_id）
  title          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  progress       INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error_message  TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  CHECK (type   IN ('agent', 'batch', 'tool_execution')),
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_task_source ON task(source, source_ref_id);
CREATE INDEX IF NOT EXISTS idx_task_status ON task(status);
CREATE INDEX IF NOT EXISTS idx_task_type   ON task(type);

-- ============================================================
-- task_agent 扩展表（Agent 任务特有字段）
-- 一对一关联 task，task 删除时级联删除
-- ============================================================
CREATE TABLE IF NOT EXISTS task_agent (
  task_id          INTEGER PRIMARY KEY,
  prompt           TEXT NOT NULL,
  agent_name       TEXT NOT NULL,
  llm_config_name  TEXT NOT NULL,
  chat_history_id  TEXT,                 -- agent_id 固定为 'task:agent:<task_id>'
  result_meta      TEXT,                 -- JSON 字符串，由 source result handler 写入
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES task(id) ON DELETE CASCADE
);

-- ============================================================
-- 未来扩展表（预留，当前不创建）
-- ============================================================
-- CREATE TABLE IF NOT EXISTS task_batch (...)      -- 批处理任务
-- CREATE TABLE IF NOT EXISTS task_tool_exec (...)   -- 工具执行任务
