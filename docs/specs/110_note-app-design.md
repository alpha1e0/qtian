# Note 应用设计文档

## 1. 概述

note-app 是一个与 Agent 结合的文档/笔记应用模块，提供 Markdown 文档管理、分类、标签、全文搜索等功能。

### 模块定位

- 独立模块，不直接引用 todo-app 的代码（需求文档 §67 行）
- 后端复用相同的设计模式（DBManager + FTS5 + 软删除 + 回收站），但表结构与 Service 独立
- 前端组件尤其要独立

### 分阶段路线图

| 阶段 | 范围 |
|------|------|
| Phase 1 | 后端完整（Service 层 + FTS5 + 回收站）+ 单元测试 + Sidebar 最小集成（占位页） |
| Phase 2 | 前端 UI（三栏布局 + Vditor 编辑器 + AI 任务浮动按钮原型） |
| Phase 3 | E2E 测试 + AI 任务接入 TaskManager |

---

## 2. 目录结构与工作目录

### 源码目录

```
src/main/core/services/app-modules/note-app/
  types.ts
  note-tokenizer.ts
  note-mock-db.ts
  note-db.ts
  note-search.service.ts
  note-label.service.ts
  note-category.service.ts
  note-doc.service.ts
  note-app.service.ts
  note-app-bootstrap.ts
  index.ts
  *.test.ts

src/main/core/ipc/handlers/note-app.handler.ts
src/renderer/src/components/app-modules/note-app/NoteAppPage.vue
data/note-app.sql
```

### 工作目录

```
workspace/app_modules/note_app/
  note.db        # note 应用数据库
  attach/        # 关联的图片、附件等内容
  config.jsonc   # note 应用配置文件（未来）
```

---

## 3. 数据库设计

### 3.1 ER 关系

```
note_category (递归)
    │ 1:N
    ▼
note_doc ◄──M:N──► note_label
                    (note_doc_label)
```

### 3.2 表结构

5 张业务表 + 搜索历史 + FTS5 虚拟表。所有业务表启用软删除（`deleted_at`），部分索引 `WHERE deleted_at IS NULL`。

#### note_category

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK AUTO | |
| name | TEXT NOT NULL | |
| parent_id | INTEGER | FK → note_category(id) |
| created_at | INTEGER | |
| updated_at | INTEGER | |
| deleted_at | INTEGER | 软删除 |

#### note_doc

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK AUTO | |
| title | TEXT NOT NULL | ≤150 字符 |
| summary | TEXT DEFAULT '' | ≤800 字符 |
| content | TEXT DEFAULT '' | Markdown 正文 |
| category_id | INTEGER | FK → note_category(id) |
| task_prompt | TEXT DEFAULT '' | AI 任务描述 |
| is_favorite | INTEGER DEFAULT 0 | 0/1 |
| created_at | INTEGER | |
| updated_at | INTEGER | |
| deleted_at | INTEGER | 软删除 |

#### note_label

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK AUTO | |
| name | TEXT NOT NULL | ≤30 字符，部分唯一索引 |
| type | TEXT DEFAULT 'default' | |
| created_at | INTEGER | |
| deleted_at | INTEGER | 软删除 |

#### note_doc_label（多对多）

| 列 | 类型 | 说明 |
|----|------|------|
| doc_id | INTEGER | FK → note_doc(id) |
| label_id | INTEGER | FK → note_label(id) |
| | PRIMARY KEY (doc_id, label_id) | 复合主键天然去重 |

#### note_search_history

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK AUTO | |
| query | TEXT NOT NULL | 唯一索引 |
| hit_count | INTEGER | |
| searched_at | INTEGER | |

#### note_fts（FTS5 虚拟表）

```sql
CREATE VIRTUAL TABLE note_fts USING fts5(
  entity_type UNINDEXED,
  entity_id   UNINDEXED,
  title,
  body,
  tokenize='unicode61'
);
```

### 3.3 索引策略

- `idx_note_category_parent` — parent_id 部分索引（未删除行）
- `idx_note_doc_category` — category_id 部分索引
- `idx_note_doc_favorite` — is_favorite 部分索引（仅收藏行）
- `uq_note_label_name_active` — name 部分唯一索引（仅未删除行）
- `uq_note_search_history_query` — query 唯一索引

### 3.4 软删除约定

- 软删除由 Service 层显式 `DELETE FROM note_fts` 同步
- FTS 不保留软删除数据（与 todo-app 一致）
- 回收站聚合跨 category/doc/label 三表

---

## 4. 类型定义

见 `types.ts`。关键类型：

- `NoteCategory` / `NoteDoc` / `NoteLabel` — 基础实体
- `NoteCategoryNode extends NoteCategory` — 树节点（含 children + doc_count）
- `NoteSearchResult` / `NoteSearchHistory` — 搜索相关
- `NoteTrashItem` / `NoteEmptyTrashResult` — 回收站
- `NoteAppConfig` — 配置

常量：
- `MAX_CATEGORY_DEPTH = 4`
- `MAX_DOC_TITLE_LENGTH = 150`
- `MAX_DOC_SUMMARY_LENGTH = 800`
- `MAX_LABEL_NAME_LENGTH = 30`

---

## 5. Service 层设计

### NoteDb

数据库封装（建表 + 暴露 DBManager + 关闭）。与 TodoDb 模式一致。

### NoteSearchService

- `syncFts(type, id, rawText | null)` — UPSERT FTS 索引
- `syncFtsBatch(type, ids)` — 批量删除
- `search(query, limit)` — 全文搜索
- `buildFtsQuery(query)` — 构造 FTS5 查询（前缀匹配，边打边搜）
- `resolveCategoryPath(categoryId)` — 面包屑路径
- 搜索历史 CRUD

### NoteLabelService

- 标准 CRUD + restore + purge
- `setDocLabels(docId, labelIds)` — 全量覆盖
- `getDocLabels(docId)` — 获取关联

### NoteCategoryService

- 递归 CRUD + 深度校验（限 4 层）
- `delete` 递归软删除子 category + 关联 doc
- `restore` parent 已删则提升至根
- `getTree` 构建 + doc_count 聚合
- `purge` 级联物理删除

### NoteDocService

- CRUD + restore + purge
- `list(categoryId)` / `listByLabel(labelId)` / `listFavorites()`
- `toggleFavorite(id)`
- `saveAttachment(buffer, ext)` — sha256 分桶 + 去重

### NoteAppService（装配入口）

- 持有 NoteDb + 配置 + 所有子 Service
- 回收站聚合：`listTrash()` / `purgeTrash(type, id)` / `emptyTrash()`

---

## 6. IPC 设计

通道命名：`qtian:note:<action>`，全部 `NOTE_` 前缀。

| 分组 | 通道 |
|------|------|
| Category | GET_CATEGORY_TREE / CREATE / UPDATE / DELETE / RESTORE |
| Doc | LIST_DOCS / GET_DOC / CREATE / UPDATE / DELETE / RESTORE / TOGGLE_FAVORITE / LIST_FAVORITES / LIST_DOCS_BY_LABEL / SAVE_ATTACHMENT / SAVE_ATTACHMENT_FROM_PATH |
| Label | LIST_LABELS / CREATE / UPDATE / DELETE / RESTORE |
| Search | SEARCH / LIST_SEARCH_HISTORY / DELETE_SEARCH_HISTORY / CLEAR_SEARCH_HISTORY |
| Trash | LIST_TRASH / PURGE_TRASH / EMPTY_TRASH |
| Config | GET_CONFIG |

Preload 中 `api.noteApp` 按相同分组暴露方法，通过 `contextBridge.exposeInMainWorld('noteApp', ...)` 暴露。

---

## 7. FTS 搜索设计

### 索引范围

仅索引 doc（category / label 不纳入 FTS）。

### FTS body 构造

- `title` = doc.title
- `body` = doc.summary + ' ' + doc.content

### jieba 分词

- 写入与查询使用同一 `NoteTokenizer`（基于 `@node-rs/jieba` 的 `cut(text, true)`）
- 独立于 todo-app 的 Tokenizer（独立性约束）

### buildFtsQuery

最后一个 token 走前缀匹配（`token*`），其余 phrase 精确匹配。支持"边打边搜"。

### snippet / bm25

- `bm25(note_fts, 10.0, 1.0)` — title 权重 10，body 权重 1
- `snippet()` 生成 `<mark>` 高亮上下文

---

## 8. 回收站设计

### 聚合

`NoteAppService.listTrash()` 跨 category / doc / label 三表聚合，按 `deleted_at DESC` 排序。

### purge

按 type 路由到对应 Service.purge，各 Service 内部保证幂等性。

### emptyTrash

逐条 purge，返回 `{ removed }`。

---

## 9. Sidebar 集成

### SideBar.vue

- validator 扩展为 `['ai-assistant', 'todo-app', 'note-app']`
- topItems 追加 `{ key: 'note-app', icon: Document, label: '笔记' }`
- 使用 `@element-plus/icons-vue` 的 `Document` 图标

### MainComponent.vue

- 注册 `NoteAppPage` 组件
- `handleSidebarSelect` 追加 `case 'note-app'`
- `activeMode` computed 追加 note-app 判定
- `titleBarTitle` 追加 '笔记'

### NoteAppPage.vue（Phase 1 占位）

仅展示"笔记应用（Phase 1 后端就绪，UI 待 Phase 2）"，确保侧栏图标可点击切换。

---

## 10. AI 任务原型

Phase 1 仅落库 `task_prompt` 字段（`note_doc.task_prompt`），不接 TaskManager。

Phase 3 接入路径：
- `NoteAppService` 构造函数追加可选 `taskManager` 参数
- 创建 `NoteTaskService`，注册 `'note-app'` source handler
- UI 浮动按钮 → createTaskFromDoc → TaskManager 执行

---

## 11. 配置设计

### qtian.json

```json
{
  "note_app": {
    "default_category_id": null,
    "default_sort": "updated_at",
    "max_category_depth": 4
  }
}
```

### Config 类

```typescript
config.noteApp = {
  defaultCategoryId: number | null,
  defaultSort: string,        // 'updated_at'
  maxCategoryDepth: number,   // 4
};
```

---

## 12. 测试策略

### 单元测试覆盖

| 测试文件 | 关键场景 |
|---------|----------|
| note-tokenizer.test.ts | 中文分词 / 英文 toLowerCase / 空串 / 纯标点过滤 |
| note-db.test.ts | initialize 建表 / 重复幂等 / SQL 不存在抛错 |
| note-search.service.test.ts | syncFts 写入 / null 仅删 / search 命中 type='doc' / title 命中 rank < body / snippet / category_path / buildFtsQuery / 搜索历史 |
| note-label.service.test.ts | create / name 重复 / name 超长 / update / delete 清理 doc_label / setDocLabels OR IGNORE / getDocLabels / purge |
| note-category.service.test.ts | create 根/子 / name 空 / 深度校验 / update 成环 / 递归软删除 / restore 提升至根 / getTree doc_count / purge |
| note-doc.service.test.ts | create 默认值 / label_ids / title 超长 / summary 超长 / update label_ids 全量覆盖 / toggleFavorite / list / listByLabel / saveAttachment |

### 测试基础设施

- `note-mock-db.ts` — 内存 SQL 执行器（从 todo-mock-db.ts 复制 + 表名替换 + note_doc_label 复合主键适配）
- 所有测试通过 `vi.mock('better-sqlite3', ...)` 注入 mock

---

## 13. 分阶段路线图

### Phase 1（已完成）

- 后端完整：SQL + types + 6 个 Service + bootstrap + IPC handler
- 单元测试：6 个 `.test.ts` 文件（100 个测试全部通过）
- Sidebar 集成：Document 图标 + NoteAppPage 占位
- Preload：`window.noteApp.*` API

### Phase 2（已完成）

- 前端 UI：**两栏布局**（搜索栏 + 左侧导航 + 右编辑区）
  - 左栏：分类树（含 doc 叶子节点）/ 标签 / 收藏（NoteSidebar，3 tab 切换）
  - 右栏：内联文档编辑面板（NoteDocEditor，标题 + 元数据 + Vditor 一体化）
  - 右下角浮动 AI 任务按钮（NoteAiTaskButton，编辑 task_prompt）
- 合并树：category 分支节点 + doc 叶子节点（参考 todo-app 模式），含虚拟"无分类"节点
- Vditor Markdown 编辑器（内联面板，30s 自动保存 + Ctrl+S 手动保存 + 图片上传）
- 切换文档自动保存：`NoteDocEditor` 以 `:key="doc-{id}"` 挂载，切换文档即销毁重建。
  组件内用 `lastSavedContent` 追踪脏状态，`beforeUnmount`（及 docId 变更）时若内容
  有变化则在销毁编辑器前静默写库（不弹 toast），无变化不写库（避免无谓更新
  updated_at 影响默认排序）。
- 文档元数据编辑（标题 / 分类级联选择 / 标签多选 / 摘要），失焦自动保存
- 分类/标签/收藏三个 tab
- 文档右键菜单（NoteContextMenu，teleport to body + 视口翻转）
- 统一新建/重命名对话框（NoteCreateDialog，支持 root/child-category / doc / label / rename 7 种 mode）
- 回收站对话框（NoteTrashDialog，跨 category/doc/label 三表聚合 + 恢复/彻底删除/清空）
- 全文搜索栏（NoteSearchBar，300ms debounce + FTS5 snippet 高亮 + 搜索历史）
- 11 个前端组件，全部独立于 todo-app

### Phase 3

- E2E 测试（Playwright）
- AI 任务接入 TaskManager（createTaskFromDoc）
- 文档自动生成（基于 task_prompt 驱动 Agent 写文档）
