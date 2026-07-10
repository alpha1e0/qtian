-- Qtian Note Application Schema
-- 数据库文件: workspace/app_modules/note_app/note.db
-- 所有业务表启用软删除（deleted_at）；外键 ON DELETE NO ACTION，应用层负责递归软删除
-- 设计文档：docs/specs/110_note-app-design.md §3

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================================
-- Category（递归结构，限制 4 层，由 Service 层校验）
-- ============================================================
CREATE TABLE IF NOT EXISTS note_category (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  parent_id   INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  FOREIGN KEY (parent_id) REFERENCES note_category(id) ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS idx_note_category_parent
  ON note_category(parent_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_note_category_deleted ON note_category(deleted_at);

-- ============================================================
-- Doc（Markdown 文档）
-- ------------------------------------------------------------
-- title ≤150 字符、summary ≤800 字符（应用层校验）
-- task_prompt：驱动 AI 任务来写文档（Phase 1 仅落库，Phase 3 接入 TaskManager）
-- content：Markdown 正文（存数据库，附件存文件系统）
-- ============================================================
CREATE TABLE IF NOT EXISTS note_doc (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  content      TEXT NOT NULL DEFAULT '',
  category_id  INTEGER,  -- NULL = 无分类（FK 允许 NULL，前端用虚拟节点展示）
  task_prompt  TEXT NOT NULL DEFAULT '',
  is_favorite  INTEGER NOT NULL DEFAULT 0,  -- 0=未收藏 1=已收藏；用户快捷置顶常用文档
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  FOREIGN KEY (category_id) REFERENCES note_category(id) ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS idx_note_doc_category
  ON note_doc(category_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_note_doc_favorite
  ON note_doc(is_favorite) WHERE deleted_at IS NULL AND is_favorite = 1;

-- ============================================================
-- Label（全局共享；name 在未删除行内唯一）
-- ============================================================
CREATE TABLE IF NOT EXISTS note_label (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'default',
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
-- 部分唯一索引：仅约束未软删除的行（允许同 name 在回收站中存在）
CREATE UNIQUE INDEX IF NOT EXISTS uq_note_label_name_active
  ON note_label(name) WHERE deleted_at IS NULL;

-- ============================================================
-- Doc <-> Label 多对多（标签作用实际承载表）
-- ------------------------------------------------------------
-- 设计要点：
-- - 标签云与「文档」直接关联；UI 在 DocDetail 维护多对多。
-- - label 软删除 / purge 时由 Service 层级联清理本表，避免悬挂引用。
-- - 复合主键 (doc_id, label_id) 天然去重。
-- ============================================================
CREATE TABLE IF NOT EXISTS note_doc_label (
  doc_id   INTEGER NOT NULL,
  label_id INTEGER NOT NULL,
  PRIMARY KEY (doc_id, label_id),
  FOREIGN KEY (doc_id)   REFERENCES note_doc(id)   ON DELETE NO ACTION,
  FOREIGN KEY (label_id) REFERENCES note_label(id) ON DELETE NO ACTION
);

-- ============================================================
-- 搜索历史
-- ------------------------------------------------------------
-- 每次 search() 调用 UPSERT 一条记录（依赖 uq_note_search_history_query 唯一索引）。
-- ============================================================
CREATE TABLE IF NOT EXISTS note_search_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  query        TEXT NOT NULL,
  hit_count    INTEGER NOT NULL DEFAULT 0,
  searched_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_note_search_history_time ON note_search_history(searched_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_note_search_history_query ON note_search_history(query);

-- ============================================================
-- 全文检索虚拟表
-- ------------------------------------------------------------
-- 设计要点：
-- - 仅索引 doc（label/category 不纳入 FTS）
-- - entity_type / entity_id 标记 UNINDEXED：不参与 MATCH，仅用于回查主表
-- - title / body 为 jieba 预分词后空格分隔的 token 串（应用层切词）
-- - tokenizer='unicode61'：仅按空白/标点切分已分好的 token；不负责中文分词
-- - 不含 deleted_at：软删除时由 Service 层显式 DELETE FROM note_fts，故 FTS 不保留历史
-- - FTS body 构造：title=doc.title，body=doc.summary + ' ' + doc.content
-- ============================================================
CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5(
  entity_type UNINDEXED,
  entity_id   UNINDEXED,
  title,
  body,
  tokenize='unicode61'
);
