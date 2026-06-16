-- Qtian Todo Application Schema
-- 数据库文件: workspace/app_modules/todo_app/todo.db
-- 所有业务表启用软删除（deleted_at）；任务表保留全量历史（见 007 公共任务系统）
-- 外键 ON DELETE NO ACTION：应用层负责递归软删除，避免物理级联

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================================
-- Category（递归结构，限制 4 层，由 Service 层校验）
-- ============================================================
CREATE TABLE IF NOT EXISTS todo_category (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  parent_id   INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  FOREIGN KEY (parent_id) REFERENCES todo_category(id) ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS idx_category_parent ON todo_category(parent_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_category_deleted ON todo_category(deleted_at);

-- ============================================================
-- TodoList
-- ============================================================
CREATE TABLE IF NOT EXISTS todo_list (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  FOREIGN KEY (category_id) REFERENCES todo_category(id) ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS idx_list_category ON todo_list(category_id) WHERE deleted_at IS NULL;

-- ============================================================
-- Label（全局共享；name 在未删除行内唯一）
-- ============================================================
CREATE TABLE IF NOT EXISTS todo_label (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'default',
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
-- 部分唯一索引：仅约束未软删除的行（允许同 name 在回收站中存在）
CREATE UNIQUE INDEX IF NOT EXISTS uq_label_name_active
  ON todo_label(name) WHERE deleted_at IS NULL;

-- ============================================================
-- TodoItem（递归结构，限制 4 层，由 Service 层校验）
-- ============================================================
CREATE TABLE IF NOT EXISTS todo_item (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  title                TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  task_prompt          TEXT NOT NULL DEFAULT '',
  parent_id            INTEGER,
  status               TEXT NOT NULL DEFAULT 'init',
  progress             INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  priority             TEXT NOT NULL DEFAULT 'normal',
  due_at               INTEGER,
  todo_list_id         INTEGER NOT NULL,
  agent_task_id        INTEGER,
  is_manual_progress   INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  deleted_at           INTEGER,
  CHECK (status IN ('init', 'in_progress', 'done', 'abandoned')),
  CHECK (priority IN ('urgent', 'important', 'normal', 'hint')),
  FOREIGN KEY (parent_id)    REFERENCES todo_item(id) ON DELETE NO ACTION,
  FOREIGN KEY (todo_list_id) REFERENCES todo_list(id) ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS idx_item_list   ON todo_item(todo_list_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_item_parent ON todo_item(parent_id)     WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_item_status ON todo_item(status)        WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_item_due    ON todo_item(due_at)        WHERE deleted_at IS NULL;

-- ============================================================
-- TodoItem <-> Label 多对多
-- ============================================================
CREATE TABLE IF NOT EXISTS todo_item_label (
  todo_item_id INTEGER NOT NULL,
  label_id     INTEGER NOT NULL,
  PRIMARY KEY (todo_item_id, label_id),
  FOREIGN KEY (todo_item_id) REFERENCES todo_item(id) ON DELETE NO ACTION,
  FOREIGN KEY (label_id)     REFERENCES todo_label(id) ON DELETE NO ACTION
);

-- ============================================================
-- Document（Markdown 正文存数据库；附件存文件系统）
-- ============================================================
CREATE TABLE IF NOT EXISTS todo_document (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  content          TEXT NOT NULL DEFAULT '',
  todo_category_id INTEGER,
  todo_item_id     INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  deleted_at       INTEGER,
  FOREIGN KEY (todo_category_id) REFERENCES todo_category(id) ON DELETE NO ACTION,
  FOREIGN KEY (todo_item_id)     REFERENCES todo_item(id)     ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS idx_doc_category ON todo_document(todo_category_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_item     ON todo_document(todo_item_id)     WHERE deleted_at IS NULL;
