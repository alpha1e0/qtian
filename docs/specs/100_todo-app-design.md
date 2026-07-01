# 100 Todo 应用（todo-app） — 设计文档

> 基于需求文档 `100_todo-app-req.md` 的补充设计。包含数据模型、模块划分、Service/IPC 接口、全文搜索、文档系统、Todo 驱动 AI 任务、UI 组件等。

> **状态说明**：本文档为初版设计，已经吸收用户对 `全文搜索` 与 `Todo 驱动 AI 任务` 的细节补充。剩余待补项仅集中在附件 GC（见附录 A）。

## 1 需求分析 & 关键决策

| 决策项 | 结论 | 理由 |
| :--- | :--- | :--- |
| 数据库 | **独立 todo.db**，位于 `workspace/app_modules/todo_app/todo.db` | 需求明确指定；与 AI 助手工作目录解耦；FTS5 只影响本库 |
| FTS5 启用 | 通过 `DBManager` 暴露的 pragma/扩展加载方式启用 | better-sqlite3 自带 FTS5 支持，仅需在 init SQL 中创建虚拟表 |
| 中文分词 | **应用层 jieba 预分词**，FTS5 用空格分隔 token 存储 | better-sqlite3 内置 tokenizer 无中文支持；自建 C 扩展成本高；预分词方案最易落地 |
| 主键策略 | 整数自增主键（`id INTEGER PK`），业务字段不作为唯一键 | 与现有 DBManager 风格一致；递归结构依赖 id |
| 时间字段 | `created_at` / `updated_at` 存储 INTEGER (Unix ms) | 现有项目使用 ms 时间戳 |
| 软删除 | **启用软删除**，所有业务表新增 `deleted_at INTEGER` | 用户要求；误删可恢复；FTS 同步需在软删除时移除 |
| 递归层级 | category、todo_item 均限制 **4 层** | 需求约束，性能考虑 |
| 标签作用域 | **全局共享**，跨 category；挂在 **todo_list（待办项目）** 维度（通过 `todo_list_label` 多对多） | 与 UI 左侧"label 方式"导航一致；标签云点击后展示关联的待办项目。历史 `todo_item_label` 表保留兼容旧数据，新业务不再写入 |
| 文档存储 | 内容存数据库；图片/附件存文件系统 `attach/` | 数据库仅存元数据 + 正文，附件按 hash 分目录避免性能瓶颈 |
| 进度联动 | todo_item 新增 `is_manual_progress` 标记；为 true 时父进度自动计算跳过该子项 | 用户要求保留手动进度不被覆盖 |
| Todo 驱动任务 | todo_item 通过 `agent_task_id` 关联**通用任务实体**（`007_task-design.md` 定义的 `task` + `task_agent`）；todo-app 作为 Source 模块接入 | 任务系统已公共化（见 `007_task-design.md`），避免每个应用各自实现；任务 ≠ 对话 |
| 任务 Agent 选择 | **由用户在创建任务时选择**（agent + llm 配置） | 用户要求；提升灵活性 |
| 任务子项组装 | 启动任务时递归收集所有子 todo_item，拼装为 prompt 上下文 | 用户要求；子项作为输入而非并行子任务 |
| 任务结果回收 | 任务完成后自动生成**总结文档**，关联 todo_item；不回写 progress | 用户要求；任务结果沉淀为可读文档 |
| 任务重跑 | **允许重跑**：新建 task + 新建总结文档（不复用旧 chat_history） | 用户要求；保留每次执行的独立结果 |
| 搜索过滤 | 暂不支持 category/label 过滤 | 用户要求；保持搜索简单 |
| 搜索结果交互 | 点击结果**跳转**到对应视图并高亮 | 用户要求 |
| 搜索历史 | 启用，新增 `todo_search_history` 表 | 用户要求 |
| IPC 命名 | `qtian:todo:<action>` | 与 `qtian:ai:*` 一致风格 |
| 测试 | 单元测试覆盖每个 Service（DBManager 用内存库）；E2E 覆盖左中右主流程 | 遵循项目 Critical Rule #2 |

## 2 目录结构设计

### 2.1 工作目录 (`{workspace}/app_modules/todo_app/`)

```
todo_app/                         # todo 应用模块根目录
├── config.jsonc                  # todo 应用配置文件（默认分类、显示偏好等）
├── todo.db                       # SQLite 数据库文件（含 FTS5 虚拟表）
└── attach/                       # 文档图片/附件存储目录
    └── {hash前2位}/{hash}{ext}   # 按 hash 分桶，避免单目录文件过多
```

> **设计要点**：`attach/` 内的文件不保留原始文件名，避免重名冲突；文件名规则 = `sha256(content).slice(0,16)` + 扩展名。Markdown 中通过自定义协议 `local-resource://attach/{hash}` 引用（已有 `local-resource-protocol.ts`）。

### 2.2 源码目录结构

```
src/main/core/services/app-modules/todo-app/
├── index.ts                              # 模块导出
├── todo-app.service.ts                   # 模块入口（DB 初始化 + Service 装配）
├── todo-category.service.ts              # Category CRUD
├── todo-list.service.ts                  # TodoList CRUD
├── todo-item.service.ts                  # TodoItem CRUD（含递归校验）
├── todo-label.service.ts                 # Label CRUD
├── todo-document.service.ts              # Document CRUD + 附件落盘
├── todo-search.service.ts                # FTS5 全文搜索封装
├── todo-task.service.ts                  # 适配层：prompt 组装 + 委托 TaskManager（见 007）
├── *.test.ts                             # 与源码并列，覆盖每个 Service

src/main/core/ipc/handlers/
└── todo-app.handler.ts                       # todo 应用 IPC handlers

src/shared/
└── ipc-channels.ts                       # 扩展 TODO_* channel 常量

data/
└── todo-app.sql                              # todo 应用数据库初始化脚本

src/renderer/src/components/app-modules/todo-app/
├── TodoAppPage.vue                       # 主页面（左中右三栏）
├── TodoSidebar.vue                       # 左侧导航（category+todo_list 统一树 / label 双视图）
├── TodoListPanel.vue                     # 中间 todo list 展示（受控组件）
├── TodoItemDetail.vue                    # 右侧 todo item 摘要 + 编辑
├── TodoItemRow.vue                       # 单条 todo item 行
├── TodoCategoryTree.vue                  # category + todo_list 统一树形组件
├── TodoLabelCloud.vue                    # label 标签云
├── TodoSearchBar.vue                     # 顶部搜索框
├── TodoDocumentEditor.vue                # 文档编辑器（Markdown）
└── composables/
    ├── useTodoData.ts                    # 数据加载 composable
    └── useTodoTask.ts                    # 任务驱动 composable
```

### 2.3 配置文件 (`config.jsonc`)

```jsonc
{
  // 默认选中的 category id（null 表示根）
  "default_category_id": null,
  // 默认排序：created_at | updated_at | due_date | priority
  "default_sort": "created_at",
  // 是否在侧栏显示已完成 todo
  "show_completed": true,
  // 递归层级上限
  "max_category_depth": 4,
  "max_todo_item_depth": 4
}
```

## 3 完整类型定义

> 所有类型集中定义在 `src/main/core/services/app-modules/todo-app/types.ts`，渲染进程通过 `@shared/types` 共享。

### 3.1 Category

```typescript
/**
 * Todo 分组（递归结构，限制 4 层）
 */
interface TodoCategory {
  /** 主键 ID */
  id: number;
  /** 分组名称 */
  name: string;
  /** 父 category ID（null 表示根） */
  parent_id: number | null;
  /** 创建时间（Unix ms） */
  created_at: number;
  /** 最后修改时间（Unix ms） */
  updated_at: number;
  /** 软删除时间（null 表示未删除） */
  deleted_at: number | null;
}

/** 含子层级的 Category 树节点（业务返回结构） */
interface TodoCategoryNode extends TodoCategory {
  children: TodoCategoryNode[];
  /** 该分类下（含子分类）的 todo_list 计数 */
  list_count: number;
}
```

### 3.2 TodoList

```typescript
/**
 * Todo 待办项目容器
 *
 * > UI 术语：`todo_list` 实体在界面上展示为"待办项目"（避免与"列表视图"等通用列表概念混淆）；
 * > 数据库表名 / TS 类型 / IPC channel 等代码层标识保持 `todo_list` / `TodoList` 不变。
 */
interface TodoList {
  id: number;
  /** 名称（≤150 字符） */
  name: string;
  /** 描述（≤1500 字符） */
  description: string;
  /** 所属 category ID（null 表示未分类） */
  category_id: number | null;
  /** 标签 ID 列表（来自 todo_list_label 多对多关系） */
  label_ids: number[];
  /** 是否收藏（用户置顶常用项目；sidebar 收藏 tab 聚合此标记） */
  is_favorite: boolean;
  created_at: number;
  updated_at: number;
  /** 软删除时间（null 表示未删除） */
  deleted_at: number | null;
}
```

### 3.3 TodoItem

```typescript
/**
 * Todo 状态枚举
 */
type TodoItemStatus = 'init' | 'in_progress' | 'done' | 'abandoned';

/**
 * 重要性等级
 */
type TodoItemPriority = 'urgent' | 'important' | 'normal' | 'hint';

/**
 * Todo 待办条目（递归结构，限制 4 层）
 *
 * > UI 术语：`todo_item` 实体在界面上展示为"待办条目"（避免与通用"条目/列表条目"歧义）；
 * > 代码层标识（DB 表名 `todo_item` / TS 类型 `TodoItem` / IPC channel `*-todo-item`）不变。
 */
interface TodoItem {
  id: number;
  /** 待办内容（≤150 字符） */
  title: string;
  /** 待办描述（≤1500 字符） */
  description: string;
  /** 任务描述（驱动 AI 任务，可选；为补充上下文） */
  task_prompt: string;
  /** 父 todo_item ID（null 表示顶层） */
  parent_id: number | null;
  /** 状态 */
  status: TodoItemStatus;
  /** 进度（0-100） */
  progress: number;
  /** 重要性 */
  priority: TodoItemPriority;
  /** 截止时间（Unix ms，null 表示无） */
  due_at: number | null;
  /** 所属 todo_list ID */
  todo_list_id: number;
  /** 关联的 agent 任务 ID（null 表示未关联；每次重跑会指向最新 task） */
  agent_task_id: number | null;
  /** 是否手动设置进度；为 true 时父进度计算跳过该子项 */
  is_manual_progress: boolean;
  created_at: number;
  updated_at: number;
  /** 软删除时间（null 表示未删除） */
  deleted_at: number | null;
}
```

> **标签作用域说明**：标签功能在 `todo_list`（待办项目）维度生效，由 `todo_list_label` 多对多表承载
> （§4.2）。`todo_item`（待办条目）不再持有标签字段；历史上曾挂在 `todo_item_label` 表，
> 该表保留以便兼容旧数据，但新业务不再写入。

### 3.4 Label

```typescript
/**
 * 全局标签
 */
interface TodoLabel {
  id: number;
  /** 名称（≤30 字符） */
  name: string;
  /** 类型（保留扩展） */
  type: string;
  created_at: number;
  /** 软删除时间（null 表示未删除；name 唯一约束需结合此字段） */
  deleted_at: number | null;
}
```

### 3.5 Document

```typescript
/**
 * 关联到 todo_list 或 todo_item 的 Markdown 文档
 */
interface TodoDocument {
  id: number;
  /** 文档名称 */
  name: string;
  /** Markdown 正文 */
  content: string;
  /** 关联的 todo_list ID（与 todo_item_id 不可同时非 null） */
  todo_list_id: number | null;
  /** 关联的 todo_item ID */
  todo_item_id: number | null;
  created_at: number;
  updated_at: number;
  /** 软删除时间（null 表示未删除） */
  deleted_at: number | null;
}
```

### 3.6 任务实体（迁移至公共任务系统）

> **重要变更**：原 `TodoAgentTask` 已抽象为**公共任务系统**，详见 `007_task-design.md`。
>
> todo-app 不再定义独立的任务表/类型，改为：
> - 复用 `007` 定义的 `task`（主表）+ `task_agent`（Agent 扩展表）
> - todo_app 作为 **Source 模块**接入：`source='todo-app'`，`source_ref_id=todo_item_id`
> - 任务生命周期（创建/运行/取消/查询）由 `TaskManager` 统一管理
> - todo-app 仅负责：prompt 组装（§8.3）、结果回收（生成总结文档，§8.4）

**字段映射**（原 `TodoAgentTask` → 通用任务系统）：

| 原 TodoAgentTask 字段 | 迁移后位置 | 说明 |
| :--- | :--- | :--- |
| `id` | `task.id` | 公共主表 |
| `todo_item_id` | `task.source_ref_id`（`source='todo-app'`） | 来源业务实体 |
| `prompt` | `task_agent.prompt` | Agent 扩展表 |
| `status` | `task.status` | 公共主表（状态机一致） |
| `agent_name` | `task_agent.agent_name` | Agent 扩展表 |
| `llm_config_name` | `task_agent.llm_config_name` | Agent 扩展表 |
| `chat_history_id` | `task_agent.chat_history_id` | agent_id 固定为 `task:agent:<task_id>` |
| `summary_doc_id` | `task_agent.result_meta`（JSON: `{ summary_doc_id }`） | 由 todo-app 的 source result handler 写入 |
| `error_message` | `task.error_message` | 公共主表 |
| `created_at` / `updated_at` | `task.created_at` / `task.updated_at` | 公共主表 |

完整类型定义（`Task`、`TaskAgent`、`TaskAgentView`、`ITaskExecutor` 等）见 `007_task-design.md` §3。

### 3.7 搜索结果

```typescript
/**
 * 全文搜索命中结果（统一返回结构）
 */
interface TodoSearchResult {
  /** 命中类型 */
  type: 'category' | 'todo_list' | 'todo_item' | 'document';
  /** 命中实体 ID */
  id: number;
  /** 命中实体标题/名称 */
  title: string;
  /** FTS snippet（高亮上下文，已包含 <mark> 标签） */
  snippet: string;
  /** 所属 category 路径（用于 UI 展示面包屑） */
  category_path: string[];
  /** 相关度分数（BM25） */
  rank: number;
}

/**
 * 搜索历史条目（用于 UI 搜索下拉/搜索历史列表）
 */
interface TodoSearchHistory {
  id: number;
  /** 用户原始输入（未做分词处理） */
  query: string;
  /** 该 query 命中结果数（用于 UI 展示） */
  hit_count: number;
  /** 最后一次搜索时间（Unix ms） */
  searched_at: number;
}

/**
 * 【已废弃】任务总结文档元信息
 *
 * 迁移至公共任务系统后，总结文档的关联关系由以下组合提供：
 * - task_agent.result_meta.summary_doc_id → todo_document.id
 * - todo_document.todo_item_id → todo_item.id
 * - task_agent.chat_history_id → 回溯原始对话
 *
 * 无需独立类型，直接查询 task + task_agent + todo_document 即可。
 */
```

## 4 数据库设计 (`data/todo.sql`)

### 4.1 软删除与外键策略

- **所有业务表新增 `deleted_at INTEGER` 字段**（null = 未删除；Unix ms = 删除时间）。
- 外键 `ON DELETE` 全部改为 `ON DELETE NO ACTION`（应用层负责递归软删除，避免物理级联）。
- 查询统一加 `WHERE deleted_at IS NULL` 过滤；建议在 Service 层封装 `notDeletedClause`。
- `todo_label.name` 的唯一性改为**部分唯一索引**：仅约束未删除行。

### 4.2 表结构

```sql
-- Qtian Todo Application Schema
-- 数据库文件: workspace/app_modules/todo_app/todo.db
-- 所有业务表启用软删除（deleted_at），任务表保留全量历史

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================================
-- Category（递归结构，限制 4 层）
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
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  category_id  INTEGER,
  is_favorite  INTEGER NOT NULL DEFAULT 0,  -- 0=未收藏 1=已收藏
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
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
-- TodoItem（递归结构，限制 4 层）
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

-- TodoList <-> Label 多对多（当前生效作用域，标签功能挂"待办项目"维度）
CREATE TABLE IF NOT EXISTS todo_list_label (
  todo_list_id INTEGER NOT NULL,
  label_id     INTEGER NOT NULL,
  PRIMARY KEY (todo_list_id, label_id),
  FOREIGN KEY (todo_list_id) REFERENCES todo_list(id) ON DELETE NO ACTION,
  FOREIGN KEY (label_id)     REFERENCES todo_label(id) ON DELETE NO ACTION
);

-- TodoItem <-> Label 多对多（历史作用域，保留表结构兼容旧数据；新业务不再写入）
CREATE TABLE IF NOT EXISTS todo_item_label (
  todo_item_id INTEGER NOT NULL,
  label_id     INTEGER NOT NULL,
  PRIMARY KEY (todo_item_id, label_id),
  FOREIGN KEY (todo_item_id) REFERENCES todo_item(id) ON DELETE NO ACTION,
  FOREIGN KEY (label_id)     REFERENCES todo_label(id) ON DELETE NO ACTION
);

-- ============================================================
-- Document（Markdown）
-- ============================================================
CREATE TABLE IF NOT EXISTS todo_document (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  content          TEXT NOT NULL DEFAULT '',
  todo_list_id     INTEGER,
  todo_item_id     INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  deleted_at       INTEGER,
  FOREIGN KEY (todo_list_id) REFERENCES todo_list(id) ON DELETE NO ACTION,
  FOREIGN KEY (todo_item_id) REFERENCES todo_item(id) ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS idx_doc_list ON todo_document(todo_list_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_item ON todo_document(todo_item_id) WHERE deleted_at IS NULL;

-- ============================================================
-- 任务实体（已迁移至公共任务系统）
-- ============================================================
-- 原 todo_agent_task 表已废弃。
-- 任务数据现存储在独立的 workspace/task/task.db：
--   - task 主表（公共字段：id/type/source/source_ref_id/status/progress/...）
--   - task_agent 扩展表（prompt/agent_name/llm_config_name/chat_history_id/result_meta）
--
-- todo-app 与任务的关联：
--   task.source='todo-app' AND task.source_ref_id=todo_item.id
--
-- todo_item.agent_task_id 字段保留（指向最新的 task.id），便于详情页快速定位当前任务。
--
-- 完整表结构见 007_task-design.md §4.2

-- ============================================================
-- 搜索历史
-- ============================================================
CREATE TABLE IF NOT EXISTS todo_search_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  query        TEXT NOT NULL,
  hit_count    INTEGER NOT NULL DEFAULT 0,
  searched_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_history_time ON todo_search_history(searched_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_search_history_query ON todo_search_history(query);
-- 同 query 多次搜索：UPSERT 更新 searched_at + hit_count

-- ============================================================
-- FTS5 全文搜索（jieba 预分词，应用层显式同步）
-- ============================================================
-- 设计要点：
--   * tokenizer = 'unicode61' 仅按空白拆分（已由 Node 层 jieba 预分词，token 之间用空格分隔）
--   * 不使用触发器：SQLite 触发器无法调用 Node.js jieba，FTS 同步在 Service 层事务内显式完成
--   * title / body 存储分词后的文本（空格分隔的 token），snippet 高亮基于该文本
CREATE VIRTUAL TABLE IF NOT EXISTS todo_fts USING fts5(
  entity_type UNINDEXED,
  entity_id   UNINDEXED,
  title,
  body,
  tokenize = 'unicode61'
);
```

### 4.3 FTS 同步责任（应用层）

由于 SQLite 触发器无法调用 Node.js 的 jieba，**FTS 同步由 Service 层显式完成**。每个 create/update/delete 操作在同一个事务内：

| 操作 | FTS 同步动作 |
| :--- | :--- |
| create（category/list/item/doc） | `INSERT INTO todo_fts` 写入 jieba 分词后的 title/body |
| update（修改了 name/title/content 等可搜索字段） | `DELETE FROM todo_fts WHERE entity_type=? AND entity_id=?` → 重新 `INSERT` |
| soft delete | `DELETE FROM todo_fts WHERE entity_type=? AND entity_id=?`（FTS 表不保留软删除） |
| restore（恢复软删除） | 重新 `INSERT INTO todo_fts` |

封装在 `TodoSearchService.syncFts(type, id, rawText)` 方法中，供各 Service 调用。

## 5 核心接口设计

### 5.1 Service 列表

| Service | 职责 |
| :--- | :--- |
| `TodoAppService` | 模块入口：DB 初始化、Service 单例装配、生命周期管理 |
| `TodoCategoryService` | Category CRUD + 树构建 + 递归层级校验 |
| `TodoListService` | TodoList CRUD + 标签多对多维护（`todo_list_label`） + 收藏（`toggleFavorite` / `listFavorites`） |
| `TodoItemService` | TodoItem CRUD + 递归层级校验 + 状态机校验 |
| `TodoLabelService` | Label CRUD（name 唯一） + `todo_list_label` 多对多维护（兼容历史 `todo_item_label`） |
| `TodoDocumentService` | Document CRUD + 附件落盘（hash 命名） |
| `TodoSearchService` | FTS5 查询封装 + snippet 拼接 |
| `TodoTaskService` | **适配层**：prompt 组装 + 委托 `TaskManager` + 总结文档生成；不再管理任务生命周期（见 `007_task-design.md`） |

### 5.2 关键 Service 接口

```typescript
/**
 * Category Service — 递归层级限制在 service 层校验，所有写入同步 FTS
 */
class TodoCategoryService {
  create(data: { name: string; parent_id: number | null }): TodoCategory;
  update(id: number, patch: Partial<Pick<TodoCategory, 'name' | 'parent_id'>>): TodoCategory;
  /**
   * 软删除：递归软删除子 category + 关联 todo_list + todo_item + document
   * 同步移除 FTS 索引
   */
  delete(id: number): void;
  /** 恢复软删除（若 parent 也在回收站，则提升至根） */
  restore(id: number): void;
  /** 列出回收站中的 category */
  listTrash(): TodoCategory[];
  getById(id: number): TodoCategory | undefined;
  /** 获取全部未删除 category，构建树（含 list_count 聚合） */
  getTree(): TodoCategoryNode[];
  /** 获取指定 category 下的直接子 category */
  getChildren(parentId: number | null): TodoCategory[];
  /**
   * 校验移动/插入是否超过最大深度
   * @throws Error("超出最大递归层级")
   */
  validateDepth(id: number | null, maxDepth: number): void;
}
```

```typescript
/**
 * TodoItem Service — 状态机校验、进度联动、软删除、子项收集（供任务拼装 prompt）
 */
class TodoItemService {
  create(data: Omit<TodoItem, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>): TodoItem;
  update(id: number, patch: Partial<TodoItem>): TodoItem;
  /**
   * 软删除：递归软删除子 todo_item + 关联文档；同步移除 FTS
   */
  delete(id: number): void;
  /** 恢复软删除 */
  restore(id: number): void;
  getById(id: number): TodoItem | undefined;
  /** 获取 todo_list 下所有未删除 todo item，按 parent_id 组装成树 */
  getTreeByList(listId: number): TodoItemNode[];
  /**
   * 状态机转换校验
   * 合法转换：
   *   init       -> in_progress | done | abandoned
   *   in_progress -> done | abandoned | init（回退）
   *   done        -> in_progress（重新打开）
   *   abandoned   -> init（恢复）
   * @throws Error("非法状态转换")
   */
  validateStatusTransition(from: TodoItemStatus, to: TodoItemStatus): void;
  /**
   * 进度联动：todo_item 完成时反向更新 parent 进度
   * 计算规则：parent.progress = 所有未删除、非 is_manual_progress 子项的 progress 平均值
   * 若 parent 自身 is_manual_progress=true，则跳过（不自动覆盖）
   */
  recalcParentProgress(itemId: number): void;
  /**
   * 递归收集 todo_item 的所有子项（含孙子），扁平化为数组
   * 用于 TodoTaskService 组装 prompt
   * @returns 按 (depth, created_at) 升序排列的子项
   */
  collectSubtree(itemId: number): Array<TodoItem & { depth: number }>;
}
```

```typescript
/**
 * Document Service — 附件落盘使用 hash；任务自动生成的总结文档走专用方法
 */
class TodoDocumentService {
  create(data: { name: string; content: string; todo_list_id?: number; todo_item_id?: number }): TodoDocument;
  update(id: number, patch: Partial<TodoDocument>): TodoDocument;
  /** 软删除；同步移除 FTS */
  delete(id: number): void;
  restore(id: number): void;
  getById(id: number): TodoDocument | undefined;
  listByList(listId: number): TodoDocument[];
  listByItem(itemId: number): TodoDocument[];

  /**
   * 任务完成后自动生成总结文档
   * - name = `${todo_item.title} - 任务总结 ${YYYY-MM-DD HH:mm}`
   * - content 由 TodoTaskService 传入（已 LLM 总结完成）
   * - todo_item_id 关联
   * @returns 新建的 TodoDocument
   */
  createSummaryForTask(
    itemId: number,
    taskId: number,
    summaryMarkdown: string
  ): TodoDocument;

  /**
   * 保存附件到 attach/ 目录，返回引用路径
   * @param buffer 文件二进制
   * @returns local-resource://attach/{hash} 或绝对路径
   */
  saveAttachment(buffer: Buffer, ext: string): string;

  // 附件 GC 暂不实现，后续考虑
}
```

```typescript
/**
 * 搜索 Service — jieba 预分词 + FTS5 查询 + 搜索历史
 */
class TodoSearchService {
  /**
   * 同步 FTS：在 Service 层 create/update/delete 时调用
   * @param type 实体类型
   * @param id 实体 ID
   * @param rawText 待分词的原文（如 category.name / item.title+description+task_prompt）
   *                传 null 表示移除该实体的 FTS 索引
   */
  syncFts(
    type: 'category' | 'todo_list' | 'todo_item' | 'document',
    id: number,
    rawText: { title: string; body: string } | null
  ): void;

  /**
   * 全文搜索
   * @param query 用户原始输入（应用层 jieba 分词 + 拼装为 FTS5 query）
   * @param limit 返回结果上限，默认 30
   * @returns 按 BM25 排序的结果列表；同时 UPSERT 一条搜索历史
   */
  search(query: string, limit?: number): TodoSearchResult[];

  /**
   * jieba 分词后拼装 FTS5 query：token 之间用 AND（空格分隔）
   * 例如 "vue 组件设计" -> 'vue 组件 设计'（FTS5 默认 AND 语义）
   */
  private buildFtsQuery(query: string): string;

  /** 列出搜索历史（按 searched_at 降序） */
  listSearchHistory(limit?: number): TodoSearchHistory[];
  /** 删除单条搜索历史 */
  deleteSearchHistory(id: number): void;
  /** 清空搜索历史 */
  clearSearchHistory(): void;
}
```

```typescript
/**
 * Todo 驱动 AI 任务 Service（适配层）
 *
 * 迁移至公共任务系统后的职责收敛（见 007_task-design.md）：
 * - 本 Service 不再管理任务生命周期（创建/运行/取消/状态 由 TaskManager 负责）
 * - 仅负责 todo-app 侧的业务逻辑：
 *   1. 从 todo_item 组装 prompt（§8.3）
 *   2. 委托 TaskManager 创建并运行 Agent 任务
 *   3. 注册 source result handler，生成总结文档（§8.4）
 *   4. 提供 todo-app 特有的查询封装
 *
 * 依赖：TaskManager（构造注入）。
 */
class TodoTaskService {
  constructor(private taskManager: TaskManager) {
    // 注册 todo-app 的 Agent 任务完成回调
    this.taskManager.registerSourceResultHandler(
      'todo-app',
      'agent',
      this.handleAgentTaskResult.bind(this)
    );
  }

  /**
   * 从 todo_item 创建 Agent 任务并立即运行（首次执行或重跑均走此方法）
   *
   * 步骤：
   * 1. 读取 todo_item（未删除）；若 task_prompt 与子 todo 均为空，抛出业务错误
   * 2. TodoItemService.collectSubtree 收集所有子 todo_item
   * 3. 组装完整 prompt（见 §8.3）
   * 4. 委托 TaskManager.createAgentTask（source='todo-app', source_ref_id=itemId）
   * 5. TaskManager.runTask(taskId) 立即运行
   * 6. 更新 todo_item.agent_task_id 指向新任务（覆盖旧值，旧 task 历史仍保留）
   *
   * @returns 创建的 TaskAgentView
   */
  createTaskFromItem(
    itemId: number,
    options: {
      agentName: string;
      llmConfigName: string;
      /** 额外附加在 prompt 末尾的输入（如用户运行时补充），可选 */
      extraPrompt?: string;
    }
  ): TaskAgentView;

  /**
   * 重跑任务：等价于 createTaskFromItem（新建 task，旧 task 作为历史保留）
   */
  rerun(itemId: number, options: { agentName: string; llmConfigName: string; extraPrompt?: string }): TaskAgentView;

  /** 列出某 todo_item 的所有任务（封装 TaskManager.listBySource） */
  listByItem(itemId: number): TaskView[];

  /**
   * Agent 任务完成回调（由 TaskManager 在任务 completed 后调用）
   *
   * 1. 从 executionResult.rawOutput 读取对话 messages
   * 2. 调用 LLM 生成总结（单轮对话，prompt 见 §8.4）
   * 3. TodoDocumentService.createSummaryForTask 写入总结文档
   * 4. 更新 todo_item.agent_task_id 指向本任务
   * 5. return { summary_doc_id: doc.id }（写入 task_agent.result_meta）
   * 6. 不修改 todo_item.progress（用户要求）
   *
   * 注意：handler 抛错不影响 task 的 completed 状态（见 007 §3.5）
   */
  private handleAgentTaskResult(
    task: Task,
    result: TaskExecutionResult
  ): Promise<Record<string, unknown>>;

  // 取消 / 查询 / 事件订阅等通用操作直接走 TaskManager（qtian:task:* IPC），
  // 不在此 Service 重复封装。
}
```

### 5.3 与公共任务系统 / AI 助手模块的集成点

| 集成点 | 说明 |
| :--- | :--- |
| `TaskManager`（007） | `TodoTaskService.createTaskFromItem` 委托其创建并运行 Agent 任务；todo-app 注册 source result handler 接收完成回调 |
| `AgentTaskExecutor`（007） | 实际执行 Agent 对话，内部调用 `AiAgentService` |
| `AiAgentService` | 复用现有 streaming tool-use loop 引擎；任务执行 + 总结生成（单轮调用）均通过该 Service |
| `AiHistoryService` | 任务执行时创建独立 history（`agent_id = 'task:agent:<taskId>'`）；命名规范见 §8.5 |
| `qtian:task:event` 推送 | 任务事件通过 007 统一通道推送，前端按 `taskId` 过滤渲染（取代原 `qtian:ai:chat-event` 过滤） |
| `AiAgentMgrService` | UI 在创建任务前调用 `listAgents()` 渲染 Agent 选择下拉 |
| `AiConfigService` | UI 在创建任务前调用 `listConfigs()` 渲染 LLM 配置下拉 |
| `ToolRegistry` | 任务中可用工具集由 Agent 定义决定，与 todo 模块无关 |

## 6 IPC Channel 设计

### 6.1 Channel 命名规范

`qtian:todo:<action>`（与 `qtian:ai:*` 一致风格）

### 6.2 Channel 列表

```typescript
// ===== Category =====
'qtian:todo:get-category-tree'      // → TodoCategoryNode[]
'qtian:todo:create-category'        // (data) → TodoCategory
'qtian:todo:update-category'        // (id, patch) → TodoCategory
'qtian:todo:delete-category'        // (id) → void  软删除（递归子分类）
'qtian:todo:restore-category'       // (id) → TodoCategory  恢复

// ===== TodoList =====
'qtian:todo:list-todo-lists'        // (categoryId?) → TodoList[]
'qtian:todo:get-todo-list'          // (id) → TodoList
'qtian:todo:create-todo-list'       // (data) → TodoList
'qtian:todo:update-todo-list'       // (id, patch) → TodoList
'qtian:todo:delete-todo-list'       // (id) → void  软删除（级联 todo_item/document）
'qtian:todo:restore-todo-list'      // (id) → TodoList
'qtian:todo:toggle-favorite'        // (id) → TodoList | undefined  切换收藏态（幂等翻转）
'qtian:todo:list-favorites'         // () → TodoList[]  sidebar 收藏 tab 数据源（is_favorite=1 且未删除）

// ===== TodoItem =====
'qtian:todo:get-todo-item-tree'     // (listId) → TodoItemNode[]
'qtian:todo:create-todo-item'       // (data) → TodoItem
'qtian:todo:update-todo-item'       // (id, patch) → TodoItem  含 is_manual_progress
'qtian:todo:delete-todo-item'       // (id) → void  软删除（递归子 todo/document）
'qtian:todo:restore-todo-item'      // (id) → TodoItem
'qtian:todo:update-todo-item-status'// (id, status) → TodoItem  含状态机校验
'qtian:todo:create-item-quick'      // (raw, listId, parentId) → TodoItem  快捷创建：解析结尾 #N 控制符（#4=urgent/#3=important/#2=normal/#1=hint）+ 落库

// ===== Label =====
'qtian:todo:list-labels'            // → TodoLabel[]
'qtian:todo:create-label'           // (data) → TodoLabel  name 在未删除行内唯一
'qtian:todo:update-label'           // (id, patch) → TodoLabel
'qtian:todo:delete-label'           // (id) → void  软删除
'qtian:todo:list-todo-lists-by-label' // (labelId) → TodoList[]  标签云视图：关联此标签的待办项目

// ===== Document =====
'qtian:todo:list-docs-by-list'      // (listId) → TodoDocument[]
'qtian:todo:list-docs-by-item'      // (itemId) → TodoDocument[]
'qtian:todo:get-document'           // (id) → TodoDocument
'qtian:todo:save-document'          // (data) → TodoDocument
'qtian:todo:delete-document'        // (id) → void  软删除
'qtian:todo:restore-document'       // (id) → TodoDocument  恢复（Phase 4 补全）
'qtian:todo:save-attachment'        // (buffer, ext) → string  local-resource URL

// ===== 回收站（统一入口，跨表） =====
'qtian:todo:list-trash'             // () → TodoTrashItem[]  跨 5 张表聚合
'qtian:todo:purge-trash'            // (type, id) → void  物理删除（不可恢复）
'qtian:todo:empty-trash'            // () → { removed: number }  清空回收站
'qtian:todo:restore-label'          // (id) → TodoLabel  恢复（Phase 4 补全，回收站 UI 必需）

// ===== 全文搜索 =====
'qtian:todo:search'                 // (query, limit?) → TodoSearchResult[]  内部 UPSERT 搜索历史
'qtian:todo:list-search-history'    // (limit?) → TodoSearchHistory[]
'qtian:todo:delete-search-history'  // (id) → void
'qtian:todo:clear-search-history'   // () → void

// ===== Todo 驱动任务（业务封装，底层委托 qtian:task:*） =====
'qtian:todo:list-runnable-agents'      // () → Array<{ name, alias, description }>  可在任务中使用的 Agent
'qtian:todo:list-runnable-llms'        // () → string[]  可在任务中使用的 LLM 配置名
'qtian:todo:create-task-from-item'     // (itemId, { agentName, llmConfigName, extraPrompt? }) → TaskAgentView  内部组装 prompt + 运行
'qtian:todo:rerun-task'                // (itemId, { agentName, llmConfigName, extraPrompt? }) → TaskAgentView  重跑（等价 create-task-from-item）
'qtian:todo:list-tasks-by-item'        // (itemId) → TaskView[]  封装 qtian:task:list-by-source

// 以下通用操作直接走 qtian:task:*（见 007_task-design.md §7），不再在 todo-app 重复：
//   qtian:task:cancel        取消任务
//   qtian:task:get           查询任务详情
//   qtian:task:event         订阅任务事件（流式输出 / 进度 / 状态变更）

// ===== 配置 =====
'qtian:todo:get-config'             // → TodoAppConfig
'qtian:todo:save-config'            // (config) → void
```

### 6.3 渲染进程桥接（preload）

参照 002 设计 §9，在 `window.todoApp.*` 暴露对应方法。任务事件监听改用 007 的 `qtian:task:event` 通道（`window.task.onEvent`），前端按 `event.taskId === task.id` 过滤匹配。

## 7 全文搜索设计

### 7.1 总体方案

- **存储**：单张 `todo_fts` 虚拟表，`entity_type` 区分实体来源。
- **分词**：**应用层 jieba 预分词**，写入 FTS 的 title/body 为空格分隔的 token 字符串；FTS5 tokenizer 设为 `unicode61`（仅按空白切分已分好的 token）。
- **同步**：**Service 层显式同步**（不用触发器，因 SQLite 无法调用 Node jieba）。封装在 `TodoSearchService.syncFts()`，各 Service 在事务内调用。
- **查询**：`TodoSearchService.search()` 将用户输入 jieba 分词后拼装为 FTS5 query，使用 `bm25()` 排序、`snippet()` 高亮。
- **过滤**：不支持 category/label 过滤；自动排除软删除实体（FTS 同步时已移除）。
- **历史**：每次 `search()` 调用 UPSERT 一条 `todo_search_history` 记录。
- **结果交互**：点击结果跳转到对应视图（category/todo_list/todo_item），UI 通过事件高亮目标实体。

### 7.2 jieba 集成方案

#### 7.2.1 依赖选型

##### 候选分词库对比

| 候选 | 评估 |
| :--- | :--- |
| **`nodejieba`** | 原生 C++ addon，性能高；需要 electron-rebuild，跨平台预编译二进制完整；社区活跃 |
| `@node-rs/jieba` | Rust 实现 + napi-rs，预编译二进制丰富，无需 rebuild；推荐替代 nodejieba |
| 纯 JS 实现（如 `jieba-js`） | 性能差，不推荐 |

##### 备选方案对比：应用层分词 vs SQL 层分词

> `wangfenjin/simple` 是 SQLite FTS5 的 C++ tokenizer 扩展，支持中文+拼音搜索，分词在 SQL 层完成，可通过 `db.loadExtension()` 加载。与现有 "`@node-rs/jieba` + FTS5 `unicode61`" 方案的核心差异在于**分词发生的位置**。

| 维度 | `@node-rs/jieba` + `unicode61`（应用层分词，当前方案） | `wangfenjin/simple`（SQL 层分词） |
| :--- | :--- | :--- |
| 分词位置 | Node 应用层预分词，FTS5 仅按空白切分 | SQLite 内置 tokenizer（C++ 扩展），SQL 层直接分词 |
| 拼音搜索 | 不支持 | 支持（含多音字） |
| FTS 同步 | 必须在 Service 层事务内显式 `syncFts()`，易遗漏 | 可用触发器自动同步（分词在 SQL 层完成） |
| 跨平台打包 | `@node-rs/jieba` 提供 Win/Linux/macOS 预编译二进制，electron-vite 友好 | 需手动编译 `.dll`/`.so`/`.dylib` 并随包分发；better-sqlite3 需 `db.loadExtension()`（默认禁用）；asar unpack 额外配置 |
| Node/Electron 集成 | 标准 npm 依赖 | 无官方 npm 包，社区案例集中在 Flutter/Go/Rust |
| 维护活跃度 | napi-rs 团队维护，活跃 | 个人项目，更新频率低 |
| 性能 | 写入有 Node↔C++ 跨层开销；读取一致 | 写入略快（SQL 层一次完成）；读取一致 |
| 分词质量 | `@node-rs/jieba` 基于 cppjieba，质量好 | 提供 `simple`（字符级）+ `jieba`（词级）两种 tokenizer，质量相当 |

##### 决策：保持 `@node-rs/jieba` 方案

理由：

1. **打包风险**：本项目用 `electron-vite + electron-builder`，引入 `simple` 需要为 3 个平台编译并管理原生二进制 + 配置 `loadExtension` + asar unpack，复杂度显著上升；`@node-rs/jieba` 是成熟方案。todo.db 是独立小库（§4），数据量不会大，写入性能差异可忽略。
2. **维护风险**：`simple` 是个人维护的 C++ 扩展，Node/Electron 集成案例稀少；后续 Node/SQLite 升级时可能踩坑。
3. **FTS 同步负担可工程化解决**："显式 `syncFts()`" 确实易遗漏，但可在 Service 基类或装饰器层强制统一处理，并不致命。

##### 拼音搜索的折中方案（保留现有架构）

若后续需要拼音搜索能力，不必切换到 `simple`：
- 在 `TodoSearchService.syncFts()` 中对 rawText 同时生成拼音（如 `pinyin-pro` 纯 JS 包），拼到 body 末尾再交给 jieba 分词。
- 查询时同样把 query 转拼音一起 MATCH。
- 成本：纯 JS 依赖，无原生扩展打包负担。

##### 何时重新评估切换到 `simple`

仅当出现以下强需求时再考虑：
- 必须支持原生拼音搜索（输 "gongzuo" 命中 "工作"）且折中方案效果不达标。
- 数据量增长到十万级以上、写入性能成为瓶颈（todo 场景不太可能）。

> **最终结论**：采用 `@node-rs/jieba`（应用层预分词 + FTS5 `unicode61` tokenizer），免 rebuild、Windows/Linux/macOS 均有预编译，与 electron-vite 兼容良好。

#### 7.2.2 分词策略

- 写入时分词：`TodoSearchService.tokenize(text)` → `@node-rs/jieba.cut(text, /* HMM */ true)` → `tokens.filter(Boolean).join(' ')`
- 多字段合并：例如 `todo_item` 的 body = `description + '\n' + task_prompt`，先合并再分词，让所有 token 进入同一倒排索引。
- 大小写归一化：分词后统一 `toLowerCase()`（FTS5 `unicode61` 默认也会处理，但应用层做一次更可控）。

#### 7.2.3 同步流程（应用层）

每个 Service 的 create/update/softDelete/restore 操作，在**同一事务内**调用：

```typescript
// 伪代码示例：TodoItemService.create
const tx = db.transaction(() => {
  const item = this.insert(...);
  this.todoSearch.syncFts('todo_item', item.id, {
    title: item.title,
    body: `${item.description}\n${item.task_prompt}`
  });
  // 关联标签也写入 body？暂不写，避免冗余
});
tx();
```

> **注意**：`better-sqlite3` 的 transaction 与同步逻辑必须在同一调用栈完成，避免 FTS 与主表不一致。

### 7.3 查询 SQL 样例

```sql
SELECT
  entity_type,
  entity_id,
  -- title 字段（FTS 索引第 3 列，0-based）
  snippet(todo_fts, 2, '<mark>', '</mark>', '...', 12) AS title_snippet,
  -- body 字段（第 3 列）
  snippet(todo_fts, 3, '<mark>', '</mark>', '...', 24) AS body_snippet,
  bm25(todo_fts, 10.0, 1.0) AS rank   -- title 权重 10，body 权重 1
FROM todo_fts
WHERE todo_fts MATCH ?    -- 应用层 jieba 分词后空格分隔的 query
ORDER BY rank
LIMIT ?;
```

应用层根据返回的 `(entity_type, entity_id)` 二次查询主表补全 title（snippet 已截断）+ category_path（递归查询 parent_id 链）。

### 7.4 搜索历史交互

- 用户在搜索框输入并按回车 → 调用 `qtian:todo:search` → 后端 UPSERT `todo_search_history`
- 用户聚焦搜索框时下拉显示：最近 10 条搜索历史 + 全部历史入口
- 点击历史项 → 直接复用该 query 触发搜索
- 历史列表支持单条删除 / 一键清空

### 7.5 结果跳转交互

| 命中类型 | 跳转目标 | 高亮方式 |
| :--- | :--- | :--- |
| `category` | TodoAppPage 左侧栏选中该 category，中间展示其下 todo_list | 闪烁高亮 1.5s |
| `todo_list` | 左侧栏选中其所属 category，中间展示该待办项目 | 待办项目标题闪烁 |
| `todo_item` | 左侧栏选中其所属 category + list，中间滚动到该 item 并展开 | item 行闪烁、自动展开 |
| `document` | 打开文档编辑器（弹出或切换右侧详情为编辑模式） | 文档名闪烁 |

跳转通过 IPC 推送的 `navigate` 事件 + 路由参数实现，统一在 `TodoAppPage.vue` 处理。

### 7.6 实施决策记录（Phase 3 落地说明）

#### 分词器抽象：`TodoTokenizer`

新建 `src/main/core/services/app-modules/todo-app/todo-tokenizer.ts` 封装 jieba：
- `cut(text): string`：调用 `@node-rs/jieba.cut(text, true)`（HMM 模式），过滤空 token + `toLowerCase()` + 空格连接；分词失败时降级返回原始文本（不阻塞主流程）
- 单独抽类的理由：可直接单元测试分词结果，无需启动 SQLite/FTS；未来切换实现（如追加拼音、改用 `simple` 扩展）只改此处

#### 依赖方向：避免循环依赖

`TodoSearchService` 仅依赖 `DBManager` + `TodoTokenizer`，**不依赖其他业务 Service**：
- 其他 Service（category/list/item/document）通过**可选构造参数** `searchService: TodoSearchService | null = null` 注入；调用时 `?.syncFts(...)`，不传时为 noop
- 现有 Service 测试无需修改（不传 searchService 时为 undefined）
- `category_path` 解析在 `TodoSearchService` 内部 SQL 反查 `parent_id` 链（`resolveCategoryPath`），避免与 `TodoCategoryService` 循环依赖

#### 事务策略：`DBManager.transaction<T>(fn)`

扩展 `DBManager.transaction<T>(fn: () => T): T`，调用 `this.db.transaction(fn)()`（better-sqlite3 的 `db.transaction(fn)` 返回**新函数**，调用时进入事务）：
- 所有 Service 写操作 + `syncFts` 在**同一事务内**执行，保证 FTS 与主表一致
- 原 `beginTransaction()` 标 `@deprecated`：其实现 `this.db.transaction(() => {})` 的 fn 为空，返回的事务闭包不会包裹任何写操作（bug）
- `todo-mock-db.ts` 新增 `transaction<T>(fn): () => fn()`（不模拟事务语义，仅兼容调用）

#### `syncFtsBatch` 用于级联软删除

`TodoSearchService.syncFtsBatch(type, ids[])` 批量删除 FTS 索引，**不带自有事务**：
- 用途：category/list/item 软删除时，级联清理子树 + 关联实体的 FTS
- 调用方在外层 `db.transaction()` 内调用，保证与主表软删除原子性
- 删除前先收集关联实体 id（删除后无法再查）：如 category delete 收集 list/item/document id；list delete 收集 item/document id；item delete 收集子树 + document id

#### FTS5 关键技术点

- **bm25 权重**：`bm25(todo_fts, 10.0, 1.0)` 中 10.0 对应 title 列、1.0 对应 body 列（按非 UNINDEXED 列顺序）；bm25 越小越相关，`ORDER BY rank` 升序
- **MATCH 转义**：jieba 分词后用双引号包裹每个 token 成 phrase（`buildFtsQuery`），所有 FTS5 操作符（`*`, `:`, `^`, `(`, `)`）失效；token 内字面双引号用 `""` 转义
- **不支持 INSERT OR REPLACE**：`syncFts` 用 DELETE + INSERT 实现 UPSERT
- **空文本不入库**：`syncFts` 在 title + body 全空时跳过 INSERT（避免空 token 干扰 MATCH）
- **search 历史策略**：非空 trimmed 输入（含纯标点）记录历史（hit_count=0）；空串不记录（不算有效搜索动作）

#### 打包注意事项

- `@node-rs/jieba` 的 napi 二进制必须 `asarUnpack`（`electron-builder.json5` 增加 `**/*.node`、`**/@node-rs/**`），否则在 asar 内无法加载 `.node` 文件
- jieba 词典预热：建议在 `TodoAppBootstrap` 中首次 `cut('预热', true)` 触发词典加载（~100ms），避免首次搜索延迟

#### 测试策略

- `TodoSearchService` / `TodoTokenizer` 测试**不 mock better-sqlite3**，用真实 `:memory:` 库 + 真实 jieba（vitest 模块级 mock 互不影响）
- 其他 Service 测试保持现状（`todo-mock-db`），仅新增 `transaction(fn)` 兼容

## 8 Todo 驱动 AI 任务设计

### 8.1 总体原则

> **任务系统已公共化**：任务实体、生命周期管理、执行引擎由 `007_task-design.md` 的 `TaskManager` + `AgentTaskExecutor` 统一提供。本节仅描述 **todo-app 特有**的业务逻辑（prompt 组装、总结文档生成）。通用机制（创建/运行/取消/事件/状态机）见 `007`。

todo-app 侧的原则：

1. 任务由 **todo_item** 驱动，**一个 todo_item 一次只对应一个"当前任务"**（`todo_item.agent_task_id` 指向最新 task.id）。
2. 子 todo_item **不并行执行**：所有子 todo_item 文本拼装进 prompt，作为任务上下文输入。
3. 任务可重跑：**新建 task + 新 chat_history + 新总结文档**，旧 task 作为历史保留可查看（重跑机制见 007 §5）。
4. 任务**不回写 todo_item.progress / status**（用户要求）。
5. 任务结束后由 todo-app 注册的 **source result handler** 自动生成一篇总结文档关联到 todo_item（见 007 §3.5）。

### 8.2 端到端流程

```
用户在 todo_item 详情页点击「运行任务」
  │
  ▼
弹出对话框：选择 Agent + LLM 配置（可填额外 prompt）
  │
  ▼
TodoTaskService.createTaskFromItem(itemId, { agentName, llmConfigName, extraPrompt })
  │
  ├─ 1. 读取 todo_item（校验：未删除、task_prompt 非空 或 有子 todo）
  ├─ 2. TodoItemService.collectSubtree(itemId) 收集所有子 todo
  ├─ 3. 组装完整 prompt（见 §8.3）
  ├─ 4. 委托 TaskManager.createAgentTask({
  │        source: 'todo-app', source_ref_id: itemId,
  │        title, prompt, agent_name, llm_config_name
  │      }) → 创建 task + task_agent 记录
  ├─ 5. TaskManager.runTask(taskId)
  │      ├─ AgentTaskExecutor 接管（见 007 §6）
  │      ├─ 创建 AiChatHistory（agent_id = 'task:agent:<taskId>'）
  │      ├─ 实例化 AiAgentService + sendMessage(prompt)
  │      └─ AiChatEvent → TaskEvent 透传 → qtian:task:event（前端按 taskId 过滤渲染）
  ├─ 6. todo_item.agent_task_id = task.id（覆盖旧指向，旧 task 历史保留）
  │
  └─ 任务结束（TaskManager 自动驱动状态流转）
       │
       ├─ completed → TaskManager 查找 source result handler（todo-app:agent）
       │              └─ TodoTaskService.handleAgentTaskResult(task, result)
       │                    ├─ 从 result.rawOutput 读取对话 messages
       │                    ├─ 调用 LLM 生成总结（§8.4）
       │                    ├─ TodoDocumentService.createSummaryForTask(...)
       │                    └─ return { summary_doc_id } → 写入 task_agent.result_meta
       │
       ├─ failed    → task.status = failed, error_message 回填（007 统一处理）
       └─ cancelled → task.status = cancelled（007 统一处理）
```

### 8.3 Prompt 组装规则

```
[任务上下文]
你正在为以下 todo 任务执行，请基于信息完成任务。

[当前 todo]
标题：{todo_item.title}
描述：{todo_item.description}      ← 给人看的备注/背景
任务说明：{todo_item.task_prompt}  ← 给 agent 的额外指令
所属分类：{category_path}
所属待办项目：{todo_list.name}

[子任务列表]
（按 depth + created_at 排序）
- {child1.title}：{child1.description}
- {child2.title}：{child2.description}
  - {grandchild1.title}：{grandchild1.description}
...

[运行时补充]
{options.extraPrompt ?? ''}

请基于以上信息完成任务，最终给出可执行的方案或结论。
```

> **description vs task_prompt 的边界**（用户确认）：
> - `description` 给**人**看：背景、备注、解释等内容，UI 详情区直接展示
> - `task_prompt` 给 **agent** 看：用户为 AI 增加的额外指令、约束、参考资料指引
> - 二者均拼入 prompt，但 UI 上分开编辑（避免误改）

### 8.4 总结文档生成 Prompt

任务完成后，对完整对话调用 LLM 生成总结，独立调用、非流式：

```
[指令]
请对以下任务执行对话进行总结，输出 Markdown 文档：
1. 任务目标（来自 todo_item 标题）
2. 执行过程要点（关键决策、调用工具及结果）
3. 最终结论 / 输出物
4. 后续建议（可选）

[对话内容]
{对话全文（user + assistant + tool_calls 精简）}

[输出要求]
- 使用 Markdown 语法
- 不超过 800 字
- 不要重复原文细节，做归纳
```

### 8.5 对话历史归属（与 AI 助手隔离）

任务对话历史采用 `007_task-design.md` §6.4 的方案：
- `agent_id = 'task:agent:<task_id>'`（历史文件位于 `workspace/assistant/history/task:agent:<id>/`）
- AI 助手侧栏按 `agent_id` 列表历史，`task:agent:*` 自然不出现
- **无需修改 `AiChatHistory` 结构**（替代早期考虑的 `meta` 字段方案，解决了原 §12 T-1）

`task_agent.chat_history_id` 存储该对话历史 ID，用于回溯原始对话。

### 8.6 重跑机制

- UI 在 todo_item 详情页同时提供「运行任务」和「重跑」按钮：
  - 首次执行（todo_item.agent_task_id == null）→ 显示「运行任务」
  - 已有任务（agent_task_id != null）→ 显示「重跑」+「查看历史任务」
- 重跑 = `TodoTaskService.rerun(itemId, options)` → 内部调用 `createTaskFromItem`，新 task 自动覆盖 `todo_item.agent_task_id` 指向。
- 旧 task 不删除，可通过 `list-tasks-by-item` 查看历史，每个历史 task 都有对应的总结文档。

### 8.7 任务面板 UI

任务运行期间，右侧详情区切换为"任务面板"：

```
┌────────────────────────────────────┐
│ ▶ 任务运行中... [取消]              │
│   Agent: coder | 模型: gpt-4o       │
├────────────────────────────────────┤
│ (流式对话区域，复用 ChatMessage 组件)│
│ ...                                 │
├────────────────────────────────────┤
│ 任务完成后：                        │
│ ✅ 已生成总结文档 [查看]            │
│ 📜 历史任务 (3) [展开]              │
└────────────────────────────────────┘
```

### 8.8 与公共任务系统 / AI 助手的边界

| 维度 | 复用 | 新增 |
| :--- | :--- | :--- |
| 任务引擎 | `TaskManager` + `AgentTaskExecutor`（007） | — |
| 对话执行 | `AiAgentService`（streaming tool-use loop，由 AgentTaskExecutor 调用） | — |
| 对话存储 | `AiChatHistory` 文件（agent_id 隔离） | — |
| 任务存储 | `task` + `task_agent` 表（007，`workspace/task/task.db`） | — |
| 事件推送 | `qtian:task:event`（007 统一通道） | — |
| 总结生成 | `AiAgentService` 单轮调用 LLM | todo-app 的 source result handler（生成 `todo_document`） |
| UI | 复用 ChatMessage 渲染 Agent 流（订阅 `qtian:task:event`） | Agent/LLM 选择、运行/重跑按钮、历史任务列表 |

## 9 UI 组件设计

**如何路由到todo-app**: 在菜单（src\renderer\src\components\common\TitleBar.vue）增加一个新的一级菜单“应用”，其中增加“代办应用”，点击后路由到todo-app

### 9.1 整体布局（左中右三栏）

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [🔍 搜索框]                                                   [+ 新建]   │
├──────────────────┬───────────────────────────────────┬───────────────────┤
│ 左侧导航 (240px) │ 中间 待办项目                    │ 右侧摘要 (320px)   │
│                  │                                   │                   │
│ 视图切换：        │ ┌──────────────────────────────┐ │ ┌───────────────┐ │
│ ○ 分类            │ │ 📋 <当前 list 名>  [新建条目]   │ │ │ 📝 Todo 详情   │ │
│ ○ 标签           │ ├──────────────────────────────┤ │ │               │ │
│                  │ │ ☐ 父 todo                    │ │ │ 标题：xxx     │ │
│ 📁 工作           │ │   ☐ 子 todo 1                │ │ │ 状态：进行中   │ │
│  ├ 📁 项目A       │ │   ☐ 子 todo 2                │ │ │ 进度：50%      │ │
│  │  ├ 📄 需求整理  │ │ ☐ 普通待办条目                 │ │ │ 标签：[前端]   │ │
│  │  └ 📄 开发计划  │ │ ☑ 已完成待办条目 (划线)         │ │ │ （仅项目级）   │ │
│  └ 📁 项目B       │ │                              │ │ │ [▶ 运行任务]   │ │
│ 📁 个人           │ └──────────────────────────────┘ │ │ [📄 关联文档]   │ │
│  📃 学习计划       │                                   │ └───────────────┘ │
│                  │                                   │                   │
│ 标签云：           │                                   │ 文档编辑器（嵌）   │
│ [#前端] [#后端]    │                                   │                   │
└──────────────────┴───────────────────────────────────┴───────────────────┘
```

> 注：左栏的统一树中 `📁` 为 category（目录语义，可展开），`📄` 为 todo_list（文件语义，叶子）；点击 category 文字切到右侧 `category-detail`（分类元信息 + 改名），点击 todo_list 文字切到右侧 `list-detail`（项目详情 + 文档列表，**标签在此处编辑**），中间面板同时展示该 list 的 item 树；点击中间面板顶部的 list 名同样切到右侧 `list-detail`（item 树保留）。右侧详情区在三种选中态下都展示「总结信息 + 元素信息（可编辑）」结构，与 `TodoItemDetail` 的失焦自动保存体验一致。
>
> **标签归属**：标签挂在"待办项目"（todo_list）维度（§4.2 `todo_list_label`），而非"待办条目"（todo_item）。右侧 mockup 中 `标签：[前端]` 仅在 list-detail 视图出现；item-detail 视图不含标签字段。

### 9.2 组件清单

| 组件 | 职责 | 主要 props/事件 |
| :--- | :--- | :--- |
| `TodoAppPage.vue` | 三栏布局容器，持有 categoryTree + allTodoLists，computed 合并 mergedTree，管理选中 category/label/list/item | — |
| `TodoSidebar.vue` | 左侧导航，category+todo_list 统一树 / label 云+标签关联项目列表 / 收藏项目扁平列表 三视图切换 | `view: 'category'\|'label'\|'favorite'` |
| `TodoCategoryTree.vue` | 基于 el-tree 渲染 category（目录）+ todo_list（叶子）混合树 | props: `selectedNodeKey`, `labels`；emit `select({type,id})`, `create`, `rename`, `delete`, `create-list`, `rename-list`, `delete-list` |
| `TodoCreateDialog.vue` | 统一新建 / 重命名对话框：根分类 / 子分类 / 待办项目（含标签）/ 待办条目（含优先级 + 截止时间）/ 重命名分类 / 重命名待办项目。替换原 4 处新建 + 2 处重命名的 `ElMessageBox.prompt`，沿用 Aurora 浅色基调与 TodoItemDetail / TodoListDetail 表单样式 | props: `visible`(v-model), `mode`, `parentName`, `initialName`, `allLabels`；emit `update:visible`, `confirm(payload)` |
| `TodoLabelCloud.vue` | 标签云（仅渲染云本身，选中态由 selectedId 高亮） | emit `select-label` |
| `TodoSearchBar.vue` | 顶部搜索框 + 历史下拉 + 结果跳转 | emit `search`, `jump-to-result`, `use-history` |
| `TodoListPanel.vue` | 中间面板（受控）：list 名标题 + todo items 树；tree-toolbar 右侧图标按钮组（新建/筛选/收藏）；底部固定快捷输入框（路径前缀 + 输入框，Enter 创建，结尾 `#N` 控制优先级） | props: `listId`, `listName`, `isFavorite`；emit `select-item`, `select-list`, `toggle-status`, `delete-item`, `toggle-favorite` |
| `TodoItemRow.vue` | 单行 todo item，支持复选框、缩进、手动进度切换、行内删除（移至回收站） | emit `toggle-status`, `select`, `create-child`, `delete` |
| `TodoItemDetail.vue` | 右侧详情面板，分「基本信息 / AI任务」两个 tab（与 sidebar 同款 radio-button toggle）。基本信息含：标题/状态/优先级/截止时间/描述/进度/手动进度/关联文档；AI任务含 task_prompt + Agent/LLM/额外 prompt 内联表单 + 运行/重跑/查看面板 | props: `itemId`；emit `updated`, `open-doc`, `run-task({agentName,llmConfigName,extraPrompt})`, `view-task` |
| `TodoCategoryDetail.vue` | 右侧分类详情面板：总结信息（创建/修改时间 + 直接子项目数）+ 名称可编辑（失焦自动保存） | props: `categoryId`；emit `updated` |
| `TodoListDetail.vue` | 右侧待办项目详情面板：总结信息（创建/修改时间）+ 名称/描述/标签可编辑（失焦自动保存）+ 项目文档列表 | props: `listId`；emit `updated`, `open-doc` |
| `TodoDocumentEditor.vue` | Markdown 编辑器（建议 milkdown / vditor） | props: `docId` |
| `TaskPanel.vue` | 任务面板（嵌入详情区，展示对话流 + 历史 + 总结链接） | props: `taskId` |
| `TaskHistoryList.vue` | 历史 task 列表，可切换查看每次执行结果 | props: `itemId` |
| `TrashDialog.vue` | 回收站统一入口，跨表列出软删除项，支持恢复/彻底删除 | — |

### 9.3 侧边栏统一树（category + todo_list）

**设计动机**：原方案左栏只有 category 树，选中 category 后中间面板顶部用 `el-select` 切换 list，导致两层选择心智负担大、category 是否含 list 不可见、下拉占用纵向空间。重构为「目录 + 文件」语义的统一树。

**关键决策**：

1. **数据集中（D1）**：`TodoAppPage` 持有 `allTodoLists: []`（一次性拉全部 todo_list），通过 `mergedTree` computed 按递归方式把 todo_list 叶子挂到对应 category 的 `children` 数组（子分类在前，直属 todo_list 在后）。todo_list 节点字段：`{ __type: 'list', nodeKey: 'list_<id>', id, name, category_id }`；category 节点字段：`{ __type: 'category', nodeKey: 'cat_<id>', id, name, children }`。
2. **复合 nodeKey（D2）**：category 与 todo_list 都用自增整数 id，必定冲突。用字符串前缀 `cat_${id}` / `list_${id}` 作为 el-tree `node-key` 与 `current-node-key`，避免 id 碰撞。
3. **空分类占位（D3）**：el-tree 对无 children 的节点默认不渲染展开三角。category 节点即使为空也应保持「目录」视觉语义，因此在 `#default` slot 内为空 category 渲染一个透明占位 span（`.cat-leaf-arrow`，18×18px），与三角图标同尺寸保持缩进对齐。不用 `:has()` 是为了兼容性与可控性。
4. **category ＋下拉（D4）**：原 category hover 的 ＋ 按钮只能新建子分类；现改为 `el-dropdown`，两项：「新建子分类」「新建待办项目」。todo_list 叶子节点 hover 只显示 ✎/🗑（不含 ＋）。根级 tree-header 的 ＋ 保留为「新建根分类」。
5. **点击行为（D5）**：`expand-on-click-node=false` 不变（点文字不触发展开，点三角才展开）。点击 category 文字 → emit `select({type:'category'})` → 父组件切到右侧 `category-detail`（展示分类元信息 + 改名入口）；点击 todo_list 文字 → emit `select({type:'list'})` → 父组件切到右侧 `list-detail`（中间面板同时加载该 list 的 item 树）。点击中间面板顶部的 list 名 → emit `select-list` → 同样切到 `list-detail`（item 树保留）。
6. **TodoListPanel 受控化（D6）**：删除原 `panel-header`（el-select + 新建项目按钮）与 `todoLists`/`currentListId` 本地状态。props 改为 `listId` / `listName` / `labelId`，watch `listId` 触发 `loadItemTree`。顶部仅保留 `tree-toolbar`：左侧 list 名标题（prop 传入，点击触发 `select-list`），右侧为图标按钮组（不含文字）：「新建待办条目」（Plus，title 提示）、「筛选」（Filter，title 提示，筛选激活时 accent 强调）。原"项目文档"按钮已移除，文档入口收敛到右侧 `TodoListDetail`。父组件 `TodoAppPage` 负责从 `allTodoLists` 解析 list 名。
7. **selectedItemId 联动（D7）**：`handleSelectCategory` 与 `handleSelectList` 均在切换时清空 `selectedItemId`，避免上一个 list 的 item 高亮残留。
8. **右侧详情统一化（D8）**：右侧详情区对三种选中态提供一致的「总结信息 + 元素信息」结构：`category-detail`（创建/修改时间 + 直接子项目数，仅名称可编辑）/ `list-detail`（创建/修改时间 + 名称/描述可编辑 + 项目文档列表）/ `item-detail`（沿用 TodoItemDetail 完整表单 + 文档 + AI 任务）。三类详情共用失焦自动保存 + 顶部状态条反馈模式。中间面板视图（item 树 / 标签条目列表）由 `selectedListId` / `selectedLabelId` 单独驱动，与 `rightPanelView` 状态机解耦，保证右侧切换详情时中间面板上下文不丢。

### 9.4 交互细节

- **递归层级提示**：创建 category / todo_item 时，若已达 4 层上限，禁用"新建子项"按钮并提示。
- **状态切换**：todo item 行内复选框点击触发 `update-todo-item-status`，校验失败时弹窗提示原因。
- **编辑自动激活**：在 `TodoItemDetail` 编辑标题、描述（失焦保存）或拖动进度滑块（`@change` 保存）时，若当前 `status === 'init'`，保存前先将状态自动推进为 `in_progress`（调用 `updateTodoItemStatus`），再继续原保存流程；状态条目视觉同步更新，避免"初始"态被无声长期保留。
- **进度联动**：子 todo 完成时自动重算父进度；若父被标记 `is_manual_progress`（详情页有开关），跳过自动覆盖；同样，子项被标记 `is_manual_progress` 时不参与父进度平均计算。
- **任务执行**：在 todo_item 详情「AI任务」tab 内联填写 Agent / LLM 配置 / 额外 prompt → 点击「运行任务」直接发起，右侧切换为 `TaskPanel` 流式展示对话；任务结束后自动生成总结文档（在面板底部展示链接）。（原 `TaskRunDialog` 弹窗已移除，表单内联到 AI任务 tab）
- **任务重跑**：「AI任务」tab 根据 `agent_task_id` 是否为 null 切换按钮（agent_task_id 为空显示「运行任务」，非空显示「查看任务面板」+「重跑」）；重跑后历史任务可通过 `TaskHistoryList` 查看。
- **软删除体验**：所有"删除"按钮文案为"移至回收站"；回收站入口在左下角，支持单条恢复/彻底删除/清空。
- **条目行内删除**：`TodoItemRow` hover 时显示删除图标按钮，点击后由 `TodoAppPage` 弹确认框（文案"移至回收站"），确认后调用 `deleteTodoItem` IPC（递归软删除子条目 + 关联文档），并在删除当前选中条目时回退右侧详情到所属 list-detail。
- **搜索体验**：聚焦搜索框显示最近搜索；点击结果跳转到对应视图并高亮。
- **条目筛选**：tree-toolbar 右侧「筛选」图标按钮点击后弹出对话框，含优先级 el-select（`multiple`，选项：紧急 urgent / 重要 important / 普通 normal / 提示 hint）与状态 el-select（`multiple`，选项：初始 init / 进行中 in_progress / 已完成 done / 已放弃 abandoned）。每个维度默认空数组 = "所有"（不限制）；勾选多个值时取并集（节点 priority/status 命中任一所选值即视为匹配）。点击「确定」应用筛选，「取消」放弃草稿，「重置」清空草稿为空数组（即"所有"）。两个 select 均启用 `collapse-tags` + `collapse-tags-tooltip`，避免 tag 撑爆对话框。筛选以 `filteredItemTree` computed 在前端对 `itemTree` 递归过滤：节点自身匹配或任一后代匹配则保留，匹配后子树按过滤后的结构渲染；任一维度数组非空即视为筛选激活，筛选按钮显示 accent 强调并以 title="筛选（已启用）" 提示。筛选为前端本地过滤，不调用新 IPC，`listId` 切换不清空筛选状态（便于跨项目比对同类条目）。
- **标签 tab 分栏视图**：标签 tab 默认仅显示标签云（无标题文案）；点击某个标签后，tab 内垂直分栏为上下两段——上段为标签云（自然高度，上限为侧栏可视区一半，超出时内部滚动；不足则剩余空间全部让给下段），下段列出该标签关联的待办项目卡片（来自 `listTodoListsByLabel(labelId)`，无章节标题，溢出时仅下段内部滚动）。卡片左键点击 → 切换到该 list（中间面板加载 item 树，右侧切到 list-detail）；卡片右键弹出与分类 tab 中 todo_list 节点一致的菜单（导出待办项目 / 重命名待办项目 / 删除待办项目），命令路由经 sidebar emit 到父组件复用既有 handler。中间面板不再承担"标签关联项目"展示（移除 TodoListPanel 的 `labelId` prop 与对应分支）。
- **新建 / 重命名对话框统一化**：4 种新建 + 2 种重命名入口（根分类 / 子分类 / 待办项目 / 待办条目 / 重命名分类 / 重命名待办项目）共享同一个模态对话框组件 `TodoCreateDialog.vue`，替换原 `ElMessageBox.prompt` 单行输入弹框。对话框按 `mode` 渲染不同字段集合：
    - `root-category` / `child-category`：仅名称；`child-category` 模式标题区显示副标题"在 \<parentName\> 下新建"。
    - `list`：名称 + 标签（多选 + `allow-create`，沿用 `TodoListDetail` 的标签解析模式；创建时一并打标签，省去创建后到 `TodoListDetail` 二次编辑）。新建待办项目落地为两步：先 `createTodoList`，再 `updateTodoList({ label_ids })`（与 `TodoListDetail.handleLabelChange` 一致）。标签 id 解析（字符串新标签名 → 真实 id）抽到共享 utils `src/renderer/src/utils/todo-labels.ts` 的 `resolveLabelIds()`，避免与 `TodoListDetail` 重复。
    - `item`：名称 + 优先级（radio，默认 `normal`，沿用 `TodoItemDetail` 的 `.priority-group` / `.prio-*` 配色）+ 截止时间（`el-date-picker type="datetime"`，`value-format="x"`，可选）。创建时直接携带 `priority` + `due_at` 落库（`TodoItemService.create` 已原生支持），省去创建后到 `TodoItemDetail` 调整。
    - `rename-category` / `rename-list`：仅名称字段，标题图标切换为 `Edit`，主按钮文案为"保存"。打开时通过 `initialName` prop 预填当前名称并全选（`ref.input.select()`），用户可在原名基础上直接覆盖或局部修改；调用方（`TodoCategoryTree.handleRename`）把被重命名节点作为 `parentData` 传入，`dialogInitialName` computed 据此取原名称预填，`onCreateDialogConfirm` 按 mode 分流 emit `rename({ id, name })` / `rename-list({ id, name })`。
    - 对话框组件本身不调 IPC：用户点"创建 / 保存"且名称非空时 emit `confirm(payload)`，由调用方（`TodoCategoryTree` / `TodoListPanel`）按 mode 分流到对应 IPC。打开对话框时（`watch visible` 由 false → true）重置表单到默认值（重命名 mode 额外预填 `initialName`），避免上次输入残留。
    - 视觉上延续 todo-app Aurora 浅色基调（白底 + indigo 细描边 + 柔和投影），复用 `TodoItemDetail` / `TodoListDetail` 的 `:deep(.el-input__wrapper)` / `.priority-group` / `el-select` 浅色样式（`rgba(99,102,241,0.04)` 晕染），让对话框与详情面板观感一致。

## 10 实现分期建议

### Phase 1: 数据层与基础 UI（可独立验收）
- `WPath` 扩展 `appModulesDir` / `appModulesTodoDir` / `appModulesTodoAttachDir`
- `data/todo.sql` 编写（含软删除字段、外键、CHECK 约束）
- DBManager 接入 todo.db，启用 foreign_keys + WAL
- 类型定义（`types.ts`）
- Service 层：Category / TodoList / TodoItem / Label（含软删除 + 递归深度校验 + 状态机）+ 单元测试
- IPC handler + preload 桥接
- 基础三栏 UI（无搜索、无任务）

### Phase 2: 文档系统
- `TodoDocumentService` + 附件落盘（hash + local-resource 协议）
- Markdown 编辑器集成
- 文档关联 todo_list / todo_item 的 UI

### Phase 3: 全文搜索（jieba）— ✅ 已实现（2026-06-17）
- 引入 `@node-rs/jieba`
- `TodoSearchService.syncFts()` + 各 Service 集成（事务内调用）
- `TodoSearchService.search()` + bm25 排序 + snippet 高亮
- `todo_search_history` UPSERT
- `TodoSearchBar.vue`（含历史下拉）+ 结果跳转 + 高亮

> 实施说明（详见 §7.6）：
> - 新增 `TodoTokenizer` 封装 jieba 分词（便于单测）
> - `TodoSearchService` 仅依赖 `DBManager` + `TodoTokenizer`，不依赖其他业务 Service；通过可选构造参数注入到各 Service（默认 null，现有测试 noop）
> - `DBManager.transaction<T>(fn)` 包装 better-sqlite3 事务；所有写操作 + `syncFts` 在同一事务内
> - `syncFtsBatch(type, ids[])` 用于级联软删除时的批量 FTS 清理（不带自有事务）
> - category_path 在 Service 内部 SQL 反查 parent_id 链，避免与 Category Service 循环依赖
> - 测试策略：原计划 `TodoSearchService` / `TodoTokenizer` 不 mock better-sqlite3 用真实 `:memory:` + 真实 jieba，**实际运行时发现**：(a) vitest 全局 `vitest.setup.ts` 已 mock `better-sqlite3`；(b) 真实 better-sqlite3 napi 编译为 Electron Node ABI（与系统 Node ABI 不兼容，无法在 vitest 加载）。最终改为文件级 `vi.mock('better-sqlite3', ...)` 覆盖为 `todo-mock-db`，并扩展 mock 支持 `transaction` / FTS5 MATCH+snippet+bm25 近似 / ON CONFLICT UPSERT / 参数化 IN 列表。FTS5 排序为近似实现，仅验证 Service 编排逻辑。`TodoTokenizer` 单测独立，真实使用 jieba（不涉及 sqlite）

### Phase 4: 回收站 — ✅ 已实现（2026-06-18）
- `list-trash` / `purge-trash` / `empty-trash` 统一 IPC
- `TrashDialog.vue` 跨表展示
- 各 Service 的 restore 方法
- 软删除恢复时 FTS 重建

> 实施说明：
> - 5 个 Service 各新增 `listTrash()` + `purge(id)`；purge 级联策略与软删除一致（依赖关系逆序物理删除，避免孤儿数据）
> - purge 幂等性：所有 purge 方法开头校验 `deleted_at IS NOT NULL`，未删除实体为 no-op（不抛错）
> - FTS 与 purge 解耦：软删除时已 `syncFts(type, id, null)` 清理，purge 时 FTS 已无数据
> - 聚合层 `TodoAppService.listTrash/purgeTrash/emptyTrash` 内置（不引入独立 Service）；`emptyTrash` 逐条 purge 不引入跨 Service 大事务
> - `TodoCategoryService` / `TodoItemService` 新增 `collectSubtreeIdsAll`（不带 `deleted_at IS NULL` 过滤），与现有 `collectSubtreeIds` 并存
> - 补全设计遗漏：新增 `TODO_RESTORE_DOCUMENT` / `TODO_RESTORE_LABEL` 频道（回收站 UI 恢复 document/label 必需）
> - UI：`TodoSidebar` 底部 [回收站] 入口（§9.4，flex column + margin-top:auto）；`TrashDialog.vue` 二次确认 + 类型图标 + 时间格式化（不引入 dayjs）
> - 测试：5 个 Service 新增 listTrash + purge 用例共 34 个，覆盖级联物理删除、幂等性、listTrash 排序/可见性

### Phase 5: Todo 驱动 AI 任务（依赖 007 任务系统） — ✅ 已实现（2026-06-18）
- 前置：完成 007 任务系统 Phase 1（`TaskManager` + `AgentTaskExecutor`）
- `TodoTaskService.createTaskFromItem`（适配层）+ 子 todo 收集 + prompt 组装（§8.3）
- 注册 todo-app source result handler（生成总结文档，§8.4）
- `qtian:todo:create-task-from-item` / `list-tasks-by-item` IPC
- 任务面板订阅 `qtian:task:event` 渲染 Agent 流
- `TaskRunDialog.vue` + `TaskPanel.vue` + `TaskHistoryList.vue`
- 重跑支持

> 重构（2026-06-26）：`TaskRunDialog.vue` 弹窗已删除，Agent / LLM 配置 / 额外 prompt 表单内联进 `TodoItemDetail.vue` 新增的「AI任务」tab；`TodoItemDetail.vue` 同时新增「基本信息 / AI任务」双 tab（复用 sidebar 的 radio-button toggle），「基本信息」tab 收纳标题/状态/优先级/截止时间/描述/进度/手动进度/关联文档（描述输入框高度调整为 9 行），「AI任务」tab 收纳 task_prompt + 任务运行配置；`TodoAppPage.vue` 移除 `taskDialogVisible` / `taskDialogMode` / `openRunDialog`，`run-task` 事件改为直接携带 `{ agentName, llmConfigName, extraPrompt }` 负载交给 `handleTaskConfirm`。

> 实施说明：
> - 新增 `todo-task.service.ts`（~250 行）：`createTaskFromItem` / `rerun` / `listTasksByItem` + private `buildPrompt`（§8.3）+ `handleAgentTaskResult`（source result handler，§8.4）+ `generateSummary`（复用任务自身 agent_name + llm_config_name，调用 `AiAgentService.sendMessage` 单轮取最后一条 assistant content）
> - `TodoItemService` 新增专用方法 `updateAgentTaskId(id, taskId)`（不污染 `update()` 公共 patch 接口；仅 TodoTaskService 内部调用）
> - `TodoAppService` 构造函数新增**可选**第 4 参数 `taskManager?`：注入后实例化 TodoTaskService（构造函数末尾自动注册 `'todo-app'` source handler）；未注入时 `taskService=null`，向后兼容现有 183 个 todo-app 测试
> - bootstrap 降级：`todo-app-bootstrap.ts` 调用 `getTaskManager()`，若抛错（task 系统未引导）则 todo-app 仍可启动，仅任务功能禁用（日志告警）；与现有 `bootstrapTaskSystem() → bootstrapTodoApp()` 顺序对齐
> - prompt 严格按 §8.3 模板：4 个段落 `[任务上下文]` / `[当前 todo]` / `[子任务列表]` / `[运行时补充]`，子任务按 `(depth, created_at)` 升序、缩进按 depth 递增（depth=1 → `- `，depth=2 → `  - `）
> - category_path 解析：item.todo_list_id → list.category_id → 沿 parent_id 回溯到根，路径用 `' / '` 连接；含环检测防御
> - handler 失败容错：catch 后返回 `{ handler_error: msg }`，TaskManager 会合并写入 `result_meta`，task 已记录的 completed 状态不受影响（与 `task-manager.service.ts:302-333` 一致）
> - 总结生成器 LLM 配置：**复用任务自身的 agent_name + llm_config_name**（Q-PHASE5-1），与 §12 T-2 "若不支持需新增 summarize() 接口"对应 —— 直接复用 `AiAgentService.sendMessage` 单轮（消费流但不保存事件，仅取 `getMessages()` 最后一条 assistant content）
> - IPC：新增 `TODO_CREATE_TASK_FROM_ITEM` / `TODO_LIST_TASKS_BY_ITEM`；handler 仅在 `getTaskService() !== null` 时注册（与 bootstrap 降级策略一致）
> - UI（3 个新组件 + 2 个修改）：
>   - `TaskRunDialog.vue`：480px `el-dialog`，表单含 Agent / LLM 配置 / 额外 prompt，默认值取 `window.electron.getConfig().aiAssistant.defaultAgent / defaultLlmConfig`
>   - `TaskPanel.vue`：独立右侧视图（`rightPanelView` 状态机新增 `'task-panel'` 分支，与 document-editor 平级）；订阅 `qtian:task:event`，按 taskId 过滤累积 text_delta（直接 `<pre>` 渲染，不引入 ChatMessage.vue）+ tool_start/tool_result 配对展示；终态显示总结文档链接（`result_meta.summary_doc_id`）+ 可展开 TaskHistoryList
>   - `TaskHistoryList.vue`：列表每个 todo_item 的全部历史任务，按 `created_at DESC`，currentTaskId 高亮
>   - `TodoItemDetail.vue`：新增 "AI 任务" 区段（agent_task_id 为空时显示 [运行任务]，否则显示 [查看任务面板] + [重跑]）
>   - `TodoAppPage.vue`：集成 TaskPanel + TaskRunDialog，新增 `taskDialogVisible` / `taskDialogMode` / `taskPanelTaskId` 状态；`handleTaskConfirm` 调用 `createTaskFromItem` 并切换到 task-panel 视图
> - 测试（新增 16 用例，todo-app suite 由 183 → 199）：
>   - `todo-task.service.test.ts`（12 用例）：buildPrompt 段落 / 子任务缩进 / extraPrompt / category_path 解析 / createTaskFromItem 校验 / rerun 覆盖 / listTasksByItem 委托 / handleAgentTaskResult 成功 + 失败容错
>   - `todo-item.service.test.ts` 新增 `updateAgentTaskId` 4 用例：写入新值 / 覆盖 / 不存在 id 不抛错 / 已软删除不更新
>   - mock 策略：`better-sqlite3` 复用 `createTodoMemDbFactory`；`AiAgentService` mock `sendMessage` 单轮返回固定总结；`AiAgentMgrService` / `AiConfigService` mock；TaskManager 构造 fake（参考 `task-manager.service.test.ts:206-225` createFakeExecutor 模式）

### Phase 6: 增强与打磨
- 拖拽排序、批量操作
- 附件 GC（用户暂不要求，预留接口）
- E2E 冒烟测试覆盖主流程 + 任务流

### 重构：侧边栏统一树（category + todo_list） — ✅ 已实现（2026-06-24）

**动机**：原方案左栏只有 category 树，选中 category 后中间面板顶部用 `el-select` 切换 list，导致两层选择心智负担大、category 是否含 list 不可见、下拉占用纵向空间。

**核心改动**（详见 §9.3）：
- `TodoAppPage.vue` 持有 `allTodoLists`，`mergedTree` computed 把 todo_list 叶子挂到对应 category；`currentNodeKey` 返回 `cat_<id>` / `list_<id>` 复合 key
- `TodoCategoryTree.vue` 升级为混合树：复合 nodeKey、空分类占位箭头、category ＋下拉（新建子分类 / 新建待办项目）、list 节点 ✎/🗑
- `TodoSidebar.vue` 透传 `tree-select` / `create-list` / `rename-list` / `delete-list` 事件
- `TodoListPanel.vue` 改为纯受控组件：删除 panel-header el-select 与本地 todoLists/currentListId，props 改为 `listId` / `listName` / `labelId`
- 选中行为：点 category 文字 → 右侧 `category-detail`（分类元信息 + 改名）；点 list 文字 → 右侧 `list-detail`（中间面板同时显示 item 树）；点中间面板顶部 list 名 → 右侧 `list-detail`（item 树保留）；切换时清空 selectedItemId 防残留高亮。原 list 视图下的"项目文档"按钮已移除，文档入口收敛到 `TodoListDetail` 内。

> 复用：`listTodoLists()` / `createTodoList` / `updateTodoList` / `deleteTodoList` IPC 与 `el-dropdown` 组件均无需新依赖。
> 主进程服务层无改动，所有 vitest 用例（199 个）保持不变。

### 重构：标签归属从 todo_item 迁移到 todo_list — ✅ 已实现（2026-06-26）

**动机**：原设计将标签挂在"待办条目"（todo_item）上，与 UI 左侧"标签云"点击后展示同维度对象（待办项目 todo_list）的语义不一致；多个条目共享同一标签需要重复打标，使用成本高。标签本质是"项目分类"维度，应挂在 todo_list。

**核心改动**：
- **DB schema（§4.2）**：新增 `todo_list_label` 表（todo_list_id × label_id 多对多）；保留 `todo_item_label` 表兼容旧数据，但新业务不再写入
- **类型（§3.2 / §3.3）**：`TodoList.label_ids: number[]` 新增；`TodoItem.label_ids` 字段移除
- **Service**：
  - `TodoListService` 构造增加 `labelService` 依赖；`create/update` 支持 `label_ids`；新增 `listByLabel(labelId)`；`delete/purge` 清理 `todo_list_label`
  - `TodoItemService` 构造去除 `labelService` 依赖；`create/update` 不再接受 `label_ids`；移除 `listByLabel`
  - `TodoLabelService` 新增 `setListLabels` / `getListLabels`；`delete/purge` 同时清理 `todo_list_label` + 历史 `todo_item_label`
  - `TodoListExchangeService.serialize/deserialize`：bundle 内 `labels` 提升至 list 维度（`TodoListExportBundle.labels`）
- **IPC（§6）**：`qtian:todo:list-todo-items-by-label` → `qtian:todo:list-todo-lists-by-label`（返回 `TodoList[]`）；preload `listTodoItemsByLabel` → `listTodoListsByLabel`
- **前端**：
  - `TodoItemDetail.vue` 移除标签 el-form-item / allLabels / handleLabelChange / resolveLabelIds
  - `TodoListDetail.vue` 新增标签 el-form-item（multiple + allow-create）+ labelIds 字段 + 失焦保存管线
  - `TodoListPanel.vue` 标签视图模式改为展示"标签关联的待办项目"卡片列表（原为 item 行）
  - `TodoAppPage.vue` `handleListUpdated` 触发 labels 重载；`handleSelectLabel` 切右侧到 empty 视图（list 在中间面板展开）

> 单元测试 240 用例全通过（label/item/list/exchange suite 同步更新）；历史 `todo_item_label` 表保留以便兼容旧数据，可在后续版本清理时再决定迁移策略。

## 11 已解决问题回溯（v2 决策日志）

> 本节为用户补充细节后定稿的关键决策记录，便于后续追溯。

| 编号 | 问题 | 决策 | 落地位置 |
| :--- | :--- | :--- | :--- |
| Q-FTS-1 | 中文分词策略 | 应用层 jieba 预分词（推荐 `@node-rs/jieba`） + FTS5 `unicode61` tokenizer | §7.2 |
| Q-FTS-2 | 是否按 category/label 过滤 | 不支持 | §7.1 |
| Q-FTS-3 | 结果交互 | 点击跳转到对应视图并高亮 | §7.5 |
| Q-FTS-4 | 是否需要搜索历史 | 需要，新增 `todo_search_history` 表 + UPSERT | §4.2 / §7.4 |
| Q-TASK-1 | Agent 是否可选 | 用户在创建任务时选择 Agent + LLM 配置 | §8.2 / §5.2 |
| Q-TASK-2 | 任务结果回收方式 | 自动生成总结文档关联 todo_item | §8.2 步骤 done / §5.2 |
| Q-TASK-3 | 子 todo 是否并行 | 不并行，所有子 todo 文本拼装进 prompt | §8.1 / §8.3 |
| Q-TASK-4 | 是否回写 progress | 不回写 | §8.1 / §5.2 |
| Q-TASK-5 | 是否支持重跑 | 支持，新建 task + 新 chat_history + 新总结文档 | §8.6 |
| Q-MISC-1 | 手动进度标记 | 新增 `is_manual_progress` 字段；联动时跳过 | §3.3 / §4.2 / §5.2 |
| Q-MISC-2 | description vs task_prompt | description 给人看；task_prompt 给 agent 看 | §8.3 |
| Q-MISC-3 | 文档版本历史 | 暂不做 | — |
| Q-MISC-4 | 附件 GC 时机 | 暂不实现，预留接口 | §5.2 / §10 Phase 6 |
| Q-MISC-5 | 软删除回收站 | 启用，所有业务表加 `deleted_at`；新增统一回收站 IPC | §4.1 / §6.2 |
| Q-PHASE4-1 | purge 级联策略 | 与软删除级联范围一致（方案 A），避免孤儿数据；复用 collectSubtreeIds 模式 | §10 Phase 4 |
| Q-PHASE4-2 | 跨表聚合层位置 | TodoAppService 内置（非独立 Service），已是装配入口且聚合逻辑薄 | §10 Phase 4 |
| Q-PHASE4-3 | TodoTrashItem 字段 | 扩展版（含 parent_id / category_id / todo_list_id 可选），便于 UI 辅助展示 | §10 Phase 4 |
| Q-PHASE4-4 | FTS 与 purge 关系 | purge 不操作 FTS（软删除时已清理） | §10 Phase 4 |
| Q-PHASE4-5 | emptyTrash 事务策略 | 逐条 purge，各 Service 内部事务保护一致性，避免长事务锁 | §10 Phase 4 |
| Q-PHASE4-6 | restore IPC 补全 | 新增 restore-document / restore-label（回收站 UI 完整恢复能力，原设计遗漏） | §6.2 / §10 Phase 4 |
| Q-PHASE5-1 | 总结生成 LLM 配置 | 复用任务自身的 agent_name + llm_config_name（避免新增配置项 / 不污染 task 表）；调用 AiAgentService.sendMessage 单轮取 getMessages() 最后一条 assistant content | §8.4 / §10 Phase 5 |
| Q-PHASE5-2 | TaskPanel 位置 | 独立右侧视图（rightPanelView 状态机新增 'task-panel' 分支），与 document-editor 平级；视觉清晰，避免详情页臃肿；任务结束后可一键返回详情 | §8.7 / §10 Phase 5 |
| Q-PHASE5-3 | agent_task_id 更新方式 | TodoItemService 新增专用方法 updateAgentTaskId(id, taskId)（不污染 update() 公共 patch，避免业务侧误改）；仅 TodoTaskService 内部调用 | §10 Phase 5 |
| Q-PHASE5-4 | TodoAppService 向后兼容 | 新增可选第 4 参数 taskManager?（未传时 taskService=null），现有 149+ 个测试不传 taskManager 全绿 | §10 Phase 5 |
| Q-PHASE5-5 | bootstrap 降级 | getTaskManager() 抛错时 todo-app 仍可启动，仅任务功能禁用（日志告警）；IPC handler 仅在 getTaskService() !== null 时注册 | §10 Phase 5 |
| Q-PHASE5-6 | 流式渲染策略 | TaskPanel 内部累积 text_delta/tool_start/tool_result（不复用 ChatMessage.vue），避免 markdown 渲染依赖；最终对话全文留在 chat_history 文件中可查 | §8.7 / §10 Phase 5 |
| Q-MISC-6 | `todo_list` UI 显示术语 | 界面文案统一称"待办项目"（原"列表"与通用列表概念歧义）；仅影响 UI 文案、prompt 模板标签、搜索结果类型标签；DB 表名 `todo_list` / TS 类型 `TodoList` / IPC channel `*-todo-list` 等代码层标识不变 | §3.2 / §7.5 / §8.3 / §9.1 |
| Q-MISC-7 | `todo_item` UI 显示术语 | 界面文案统一称"待办条目"（原"条目"在搜索/回收站/标签上下文中存在歧义）；仅影响 UI 文案、搜索结果类型标签、回收站类型标签；DB 表名 `todo_item` / TS 类型 `TodoItem` / IPC channel `*-todo-item` 等代码层标识不变 | §3.3 / §7.5 / §9.1 |
| Q-MISC-8 | 4 种"新建"+ 2 种"重命名"入口的弹框形式 | 统一升级为可复用模态对话框 `TodoCreateDialog.vue`（替换 `ElMessageBox.prompt`）。理由：(1) `ElMessageBox.prompt` 仅单行输入，"新建待办项目"无法在创建时打标签、"新建待办条目"无法设定优先级/截止时间，均需事后到详情面板二次编辑；(2) "重命名分类 / 待办项目"原也只用简陋的 `ElMessageBox.prompt`，与新建入口视觉割裂；(3) `ElMessageBox.prompt` 样式固定，无法与 todo-app Aurora 浅色基调及表单视觉语言（输入框晕染、优先级配色）统一。统一 dialog 按 `mode` 渲染字段集合（含 `rename-category` / `rename-list`），沿用 TodoItemDetail / TodoListDetail 表单样式；重命名 mode 通过 `initialName` prop 预填并全选原名；标签解析逻辑抽到 `src/renderer/src/utils/todo-labels.ts` 共享，避免与 TodoListDetail 重复 | §9.2 / §9.4 |

## 12 仍需协商的待办（依赖现有 AI 助手模块）

| 编号 | 待办 | 依赖方 | 备注 |
| :--- | :--- | :--- | :--- |
| T-1 | ~~AiChatHistory 是否可扩展 `meta` 字段~~ **已解决** | — | 采用 007 §6.4 方案：`agent_id = 'task:agent:<taskId>'` 隔离，无需 meta 字段 |
| T-2 | ~~AiAgentService 是否支持非流式独立调用（用于生成总结）~~ **已解决** | — | 见 §8.4 / Q-PHASE5-1：复用 `AiAgentService.sendMessage` 单轮（消费流但不保存事件），取 `getMessages()` 最后一条 assistant content 即可，无需新增 `summarize()` 接口 |

---

## 附录 A: 与现有架构的集成点

| 现有模块 | todo 应用接入方式 |
| :--- | :--- |
| `DBManager` | 实例化第二个 DBManager（todo.db）；构造后 `db.pragma('foreign_keys = ON')` |
| `WPath` | 新增 `appModulesDir` / `appModulesTodoDir` / `appModulesTodoAttachDir` |
| `Config` | `qtian.json` 新增 `todo_app` 配置段（默认 category、排序、显示偏好） |
| `IPC_CHANNELS` | 扩展 `TODO_*` 常量 |
| `registerAllHandlers` | 注册 `registerTodoHandlers` |
| `TaskManager`（007） | `TodoTaskService.createTaskFromItem` 委托其创建/运行 Agent 任务；注入到 todo-app 作为 Source 模块 |
| `AgentTaskExecutor`（007） | 内部复用 `AiAgentService` 执行对话；任务结束触发 todo-app 的 result handler 生成总结 |
| `AiHistoryService` | 任务对话独立 chat_history，`agent_id = 'task:agent:<taskId>'` 隔离（见 §8.5） |
| `local-resource-protocol` | 复用，新增 `attach://` 前缀解析到 `appModulesTodoAttachDir` |

## 附录 B: 测试策略

| 层级 | 工具 | 覆盖范围 |
| :--- | :--- | :--- |
| 单元测试 | Vitest | 每个 Service 的 CRUD、软删除/恢复、状态机校验、递归深度校验、`is_manual_progress` 联动、FTS 同步与查询拼接、子 todo 收集 |
| 测试数据库 | better-sqlite3 内存库 (`:memory:`) | 每个用例独立 DB；测试 `@node-rs/jieba` 分词结果稳定性 |
| E2E 冒烟 | Playwright | 三栏布局渲染、新建 category / todo、勾选完成、搜索跳转、回收站恢复 |
| E2E 任务流 | Playwright | 创建任务（选 Agent/LLM） → 等待对话完成 → 校验总结文档生成、历史任务列表 |
