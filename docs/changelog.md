# Changelog

## [1.0.0] 2026-06-17

**User**: todo-app Phase 3 全文搜索（jieba）一次性交付（后端 + IPC + 完整 UI）

**Summary**:

落地 todo-app **Phase 3 全文搜索**：基于 `@node-rs/jieba` 应用层预分词 + SQLite FTS5（`unicode61` tokenizer）+ BM25 排序 + snippet 高亮 + 搜索历史 + UI 跳转。设计文档 `docs/specs/100_todo-app-design.md` §10 Phase 3 标注"已实现"。

### 新增

- **依赖与基础设施**
  - `package.json`：新增 `@node-rs/jieba@^1.10.3`（应用层中文分词，napi-rs 预编译二进制）
  - `electron-builder.json5`：`asarUnpack` 增加 `**/*.node`、`**/@node-rs/**`，避免 napi 二进制在 asar 内无法加载
  - `data/todo-app.sql`：末尾追加 `todo_search_history` 表（+ `idx_search_history_time` / `uq_search_history_query` 唯一索引）+ `todo_fts` FTS5 虚拟表（`entity_type/entity_id UNINDEXED + title/body + tokenize='unicode61'`）
  - `src/main/core/database/db-manager.ts`：新增 `transaction<T>(fn)`（调用 `this.db.transaction(fn)()`）；旧 `beginTransaction()` 标 `@deprecated`（修正其 fn 为空导致事务不生效的 bug）

- **分词与类型**
  - `todo-tokenizer.ts`（新增）：`TodoTokenizer.cut(text)` 调用 `@node-rs/jieba.cut(text, true)`（HMM），过滤空 token + toLowerCase + 空格连接；异常时降级返回原始文本
  - `todo-tokenizer.test.ts`（新增）：中/英/混合/空白/大小写/标点用例
  - `types.ts`：新增 `TodoFtsEntityType`（不含 label）、`TodoSearchResult`、`TodoSearchHistory`

- **搜索 Service**（`todo-search.service.ts` 新增）
  - `syncFts(type, id, rawText|null)`：DELETE + INSERT 实现 UPSERT（FTS5 不支持 INSERT OR REPLACE）；空文本不入库
  - `syncFtsBatch(type, ids[])`：批量删除，供级联软删除调用（不带自有事务）
  - `search(query, limit=30)`：jieba 分词 → FTS5 MATCH → `bm25(todo_fts, 10.0, 1.0)` 排序（title 权重 10、body 权重 1）→ `snippet(...)` 高亮 → 二次查主表补全 title + category_path → UPSERT 历史
  - `buildFtsQuery(query)`：jieba 分词后每个 token 双引号包裹成 phrase（FTS5 操作符失效，防注入）→ 空格连接（默认 AND 语义）
  - `resolveCategoryPath(categoryId)`：递归反查 parent_id 链，返回根→父名称数组（含防环保护）
  - 搜索历史：`upsertSearchHistory`（依赖唯一索引 ON CONFLICT） / `listSearchHistory` / `deleteSearchHistory` / `clearSearchHistory`
  - 依赖关系：仅依赖 `DBManager` + `TodoTokenizer`，**不依赖其他业务 Service**（避免循环依赖）；其他 Service 通过可选构造参数注入（默认 null）
  - `todo-search.service.test.ts`（新增）：真实 `:memory:` sqlite + 真实 jieba，覆盖 syncFts/syncFtsBatch/search（bm25 排序/snippet/AND 匹配）/buildFtsQuery/resolveCategoryPath/历史/软删除集成

- **业务 Service 集成 syncFts**（事务内调用）
  - 4 个 Service 构造增加 `searchService: TodoSearchService | null = null`；写操作用 `db.transaction()` 包装
  - `todo-category.service.ts`：create/update/delete/restore 同步 FTS；delete 级联清理 category + 关联 list/item/document 的 FTS
  - `todo-list.service.ts`：可搜索字段 `name + description`；delete 级联清理 list + 子 item + 子 document 的 FTS
  - `todo-item.service.ts`：可搜索字段 `title + (description + task_prompt 合并)`；delete 级联清理子树 + 关联 document 的 FTS；updateStatus/进度变更不触发 FTS
  - `todo-document.service.ts`：可搜索字段 `name + content`
  - `todo-app.service.ts`：装配顺序调整 — 先创建 `TodoSearchService`（仅依赖 DBManager），再注入到其他 Service；新增 `getSearchService()` getter
  - `index.ts`：导出 `TodoSearchService` / `TodoTokenizer` / 新类型
  - `todo-mock-db.ts`：新增 `transaction<T>(fn): () => fn()`（不模拟事务语义，仅兼容调用）

- **IPC + Preload**
  - `src/shared/ipc-channels.ts`：新增 `TODO_SEARCH` / `TODO_LIST_SEARCH_HISTORY` / `TODO_DELETE_SEARCH_HISTORY` / `TODO_CLEAR_SEARCH_HISTORY`
  - `src/main/core/ipc/handlers/todo-app.handler.ts`：注册 4 个 handler（委托 `todoAppService.getSearchService()`）
  - `src/preload/index.ts`：`window.todoApp` 新增 `search` / `listSearchHistory` / `deleteSearchHistory` / `clearSearchHistory`

- **UI**（`TodoSearchBar.vue` 新增）
  - 顶部搜索栏：`<el-input>` + 搜索图标 + 300ms 防抖；`<el-popover>` 下拉
  - 聚焦时显示历史（含单条删除 + 清空），输入时显示结果
  - 结果行：类型图标 + 标题 + `<mark>` 高亮 snippet（v-html 渲染）+ 面包屑（category_path）
  - 键盘上下选择 + 回车确认 + Esc 关闭
  - emit `jump-to-result(result)`
  - `TodoAppPage.vue`：顶部插入 `<TodoSearchBar>` 横跨三栏，新增 `handleJumpToResult`（category/todo_list/todo_item/document 四类跳转：反查 category_id 切换 + 滚动 + 闪烁高亮）
  - `TodoListPanel.vue`：暴露 `focusTarget(listId, itemId)` + `scrollToItem(itemId)`（DOM 滚动 + 临时 flash-highlight class）
  - `TodoItemRow.vue`：根节点加 `:data-item-id`；新增 `flash-highlight` 动画样式
  - `TodoSidebar.vue`：暴露 `highlightCategory(id)`（el-tree 当前节点闪烁）

### 设计决策（已写入设计文档 §7）

- **Label 不纳入 FTS**：符合 §7.1 entity_type 集合定义
- **事务策略**：扩展 `DBManager.transaction<T>(fn)`，所有 Service 写操作 + syncFts 在事务内执行（修正现有 `beginTransaction()` 的 bug）
- **FTS5 权重**：`bm25(todo_fts, 10.0, 1.0)` 中 10.0 对应 title、1.0 对应 body（按非 UNINDEXED 列顺序）
- **FTS5 MATCH 转义**：jieba 分词后双引号包裹每个 token 成 phrase，所有 FTS5 操作符（`*`, `:`, `^`, `(`, `)`）失效
- **FTS5 不支持 INSERT OR REPLACE**：syncFts 用 DELETE + INSERT 实现 UPSERT
- **分词器抽象**：新建 `TodoTokenizer` 封装 jieba，便于单测与未来扩展
- **依赖方向**：`TodoSearchService` 仅依赖 `DBManager` + `TodoTokenizer`，不依赖其他业务 Service；category_path 在 Service 内部 SQL 反查 parent_id 链避免循环依赖

### 回归

- 现有 Service 测试不传 searchService（默认 null），调用 `?.syncFts(...)` 为 noop
- **测试策略调整**：原计划使用真实 `:memory:` sqlite + 真实 jieba，但运行时发现 vitest 全局 `vitest.setup.ts` 已 mock `better-sqlite3`，且真实 better-sqlite3 napi 编译为 Electron Node ABI（与系统 Node ABI 不兼容，无法在 vitest 加载）。改为文件级 `vi.mock('better-sqlite3', ...)` 覆盖为 `todo-mock-db`，并扩展 mock 支持：
  - `transaction<T>(fn): () => fn()`（不模拟事务语义，仅兼容链式调用）
  - FTS5 `MATCH` + `snippet(...)` + `bm25(...)` 近似实现（token 集合 AND 匹配 + `<mark>` 高亮 + rank 近似）
  - `INSERT ... ON CONFLICT(col) DO UPDATE SET` UPSERT 语义（搜索历史用）
  - `WHERE col IN (?, ?, ?)` 参数化 IN 列表（`syncFtsBatch` 级联清理用）
- FTS5 排序为近似实现，仅验证 Service 层编排逻辑（syncFts/search/history/category_path），不保证与真实 FTS5 bm25 完全一致
- 新增 todo-tokenizer（6 用例）+ todo-search.service（27 用例）单测；现有 116 用例保持全绿；todo-app 模块合计 **149 用例全绿**
- 全量 `vitest run`：875 用例中 873 绿；2 失败位于 `GlobalShortcutManager.test.ts`，与本变更无关（git stash 验证为 HEAD 既有问题）

## [1.0.0] 2026-06-17

**User**: Phase 2 恢复开发：对齐参考代码的文档编辑器 + 内嵌布局 + Category 文档 UI

**Summary**:

在断电前 commit `f5de66a`（Phase 1-2 后端 + 编辑器最小可用版）基础上恢复开发，聚焦三件事：编辑器生产力功能补齐（G1-G5）、Category 级文档 UI（G6）、编辑器从 dialog 改为右侧内嵌（G7）。打包资源本地化（G8）按用户决定留待 Phase 6 处理。

### 变更

- **IPC 扩展**（`src/shared/ipc-channels.ts` / `src/main/core/ipc/handlers/todo-app.handler.ts` / `src/preload/index.ts`）
  - 新增 `TODO_SAVE_ATTACHMENT_FROM_PATH` 频道：基于文件路径的附件保存，主进程直接 `fs.readFileSync` 落盘，避免大文件经 IPC 序列化整个 buffer 的开销
  - preload 暴露 `window.todoApp.saveAttachmentFromPath(filePath)`，与原 `saveAttachment(buffer, ext)` 并存（剪贴板粘贴仍走 buffer 分支）

- **`TodoDocumentEditor.vue` 重写**（对齐 `tmp/vditor-example.vue`）
  - G1 顶部工具条：标题路径（来自 prop `titlePath`）+ 字数统计（vditor counter 回调）+ 手动保存按钮 + 返回按钮
  - G2 自动保存：`after` 回调启动 `setInterval(autoSaveDocument, 30000)`；`isLoadingDoc` / `saving` 防重入；`beforeUnmount` 清理定时器
  - G3 手动保存 Ctrl+S：mounted 注册 `keydown` 监听；metaKey 兼容 macOS；unmounted 移除
  - G4 文本替换 Ctrl+R：`el-dialog` + 正则 `new RegExp(source, 'g')`；正则无效时提示而非崩溃；`doReplace` 计数反馈
  - G5 图片样式替换：`/!\[(.*?)\]\((.*?)\)/g` → `<img src='..' height='400' alt='..'>`
  - 纯文本粘贴按钮：`navigator.clipboard.readText()` 后追加到当前内容末尾
  - 上传 handler 优化：区分 `file.path`（走 `saveAttachmentFromPath`）和剪贴板（`arrayBuffer()` + `saveAttachment`）；返回 `null` / 错误字符串符合 vditor 约定
  - props 新增 `titlePath`；emits 新增 `back`；保留 `saved`
  - 协议策略：统一 `local-resource://`（复用现有白名单），未引入 `local-resource-md://`

- **`TodoCategoryDetail.vue` 新增**（spec §3.5 / §9.1）
  - Category 维度文档列表 UI：顶部"分类名 + 新建文档"头部 + 文档列表（含 updated_at 简短时间）
  - 新建文档：先 `ElMessageBox.prompt` 收集名称 → `saveDocument({ todo_category_id })` 创建占位 → emit `open-doc({ id, categoryId, titlePath: '分类名 / 文档名' })`
  - 打开文档：直接 emit `open-doc({ id, categoryId, titlePath })`
  - props: `categoryId`、`categoryName`（由父组件从 categoryTree 解析）；emits: `open-doc`；公开 `refresh()` 供父组件调用

- **`TodoItemDetail.vue` 改造**
  - 移除内嵌 `<el-dialog>` 块、`docEditorVisible` / `editingDoc` / `TodoDocumentEditor` import
  - `handleCreateDoc` / `handleOpenDoc` 改为 emit `open-doc({ id?, itemId, titlePath: '条目标题 / 文档名' })`，由父组件路由到编辑器视图
  - 新建文档采用"先创建占位再打开"两步流程，确保编辑器拿到真实 `docId`（用于自动保存）

- **`TodoAppPage.vue` 改造**（G7：dialog → 内嵌）
  - 引入 `rightPanelView` 状态机：`'empty' | 'item-detail' | 'category-detail' | 'document-editor'`
  - 引入 `activeDoc` 状态：`{ id?, itemId?, categoryId?, titlePath }`
  - 引入 `detailKey` 计数器：文档保存后自增，通过 `:key` 强制 `TodoItemDetail` / `TodoCategoryDetail` 重新挂载以刷新文档列表
  - 动态宽度：默认右侧 320px；`document-editor` 视图通过 `.todo-item-detail-wide` 切换到 600px
  - 路由策略：选 category（无 item）→ category-detail；选 item → item-detail；子组件 emit `open-doc` → document-editor；编辑器 emit `back` → 依据 `activeDoc.itemId/categoryId` 回退
  - 新增 `selectedCategoryName` computed：递归遍历 categoryTree 解析分类名，供 `TodoCategoryDetail` 展示与 `titlePath` 拼装

### 范围说明

- **不做**：G8 vditor 打包资源本地化（用户决定 Phase 6 处理）；不引入 `local-resource-md://` 协议
- **不修改**：`TodoDocumentService.ts`（后端 API 满足需求）、`local-resource-protocol.ts`（已支持白名单）、数据/Service 测试
- **不引入新依赖**：复用 vditor ^3.10.7 + element-plus
- **测试约定**：UI 无新单测（遵循 CLAUDE.md §2：`src/main` 必测、UI 不强制）；新增 IPC handler 与既有 `TODO_SAVE_ATTACHMENT` 风格一致，未单测

### 回归

- 后端无逻辑改动：`vitest run src/main/core/services/app-modules/todo-app` 现有 116 用例应保持全绿

## [1.0.0] 2026-06-16

**User**: 按照 `docs/specs/100_todo-app-design.md` 开发 todo-app Phase 1（数据层 + 三栏 UI）+ Phase 2（文档系统 + Markdown 编辑器）

**Summary**:

本次开发落地 todo-app（代办应用）**Phase 1-2**，包含完整的数据层、Service 层、IPC 集成、三栏 UI 和文档编辑器。未做 Phase 3（FTS 全文搜索）、Phase 4（统一回收站 UI）、Phase 5（Todo 驱动 AI 任务）、Phase 6（增强打磨）。

### 新增模块

- **数据层**
  - `data/todo-app.sql`：6 张表（todo_category / todo_list / todo_label / todo_item / todo_item_label / todo_document），全部启用软删除（deleted_at），Label 用部分唯一索引（`WHERE deleted_at IS NULL`）；不含 FTS5 虚拟表（Phase 3）
  - `TodoDb`（`src/main/core/services/app-modules/todo-app/todo-db.ts`）：封装建表 + `getDBManager()` 供 Service 层执行跨表查询；业务查询不下沉到 TodoDb（避免类过大）

- **类型与常量**（`types.ts`）
  - TodoCategory / TodoList / TodoItem / TodoLabel / TodoDocument / TodoCategoryNode / TodoItemNode / TodoAppConfig
  - `MAX_CATEGORY_DEPTH = 4`、`MAX_TODO_ITEM_DEPTH = 4`
  - `VALID_STATUS_TRANSITIONS` 状态机映射（init → in_progress/done/abandoned；done → in_progress；abandoned → init）

- **Service 层**（5 个 Service + 模块入口 + 引导）
  - `TodoLabelService`：全局标签 CRUD（部分唯一索引保证 name 唯一性）；`setItemLabels` / `getItemLabels` 维护多对多关联；软删除后同名可重建
  - `TodoCategoryService`：递归分组 CRUD + 深度校验（第 5 层抛错）+ `getTree`（内存构建树 + `list_count` 递归聚合）+ 递归软删除级联（category → list → item → document）+ `restore`（parent 已删则提升至根）+ 环检测（不能移动到子孙下）
  - `TodoListService`：列表 CRUD + 级联软删除（list → item → document）
  - `TodoItemService`：条目 CRUD + 深度校验 + 状态机校验 + `recalcParentProgress`（父进度 = AVG 未删除且非 `is_manual_progress` 子项；`is_manual_progress=true` 时跳过；含 `Set<number> visited` 防环检测；create/update/delete 后自动触发）+ `collectSubtree`（Phase 5 任务拼装用，按 depth+created_at 排序）+ done 自动设 progress=100
  - `TodoDocumentService`：Markdown 文档 CRUD + `saveAttachment`（sha256 前 16 位命名 + 前 2 位分桶 + 去重）；category_id 和 item_id 互斥校验
  - `TodoAppService`：模块入口，装配所有子 Service + 读取 `config.todoApp` 运行时配置
  - `todo-app-bootstrap.ts`：进程级单例引导（建表 + 装配 Service + 注册 IPC），幂等；Phase 5 注入点

- **IPC / Preload / 主进程集成**
  - `src/shared/ipc-channels.ts`：新增 26 个 `TODO_*` 频道（Category / TodoList / TodoItem / Label / Document / Config），含设计文档遗漏的 `TODO_GET_TODO_ITEM`
  - `src/main/core/ipc/handlers/todo-app.handler.ts`：注册全部 TODO_* handler
  - `src/preload/index.ts`：新增 `window.todoApp.*` 命名空间（30 个方法）+ `contextBridge.exposeInMainWorld('todoApp', ...)`
  - `src/main/index.ts`：`app.on('ready')` 调整为 `await readConfig()` → `bootstrapTodoApp()`（在 `bootstrapTaskSystem()` 之后）

- **基础设施扩展**
  - `context.ts`：WPath 新增 `appModulesDir` / `appModulesTodoDir` / `appModulesTodoAttachDir` / `todoDbPath` / `getTodoAppSqlFile()`；Config 新增 `todo_app` 配置段（defaultCategoryId / defaultSort / showCompleted / maxCategoryDepth / maxTodoItemDepth）
  - `constants.ts`：MIME_MAP 扩展附件类型（pdf/txt/docx/xlsx/md/csv/zip/json 等共 18 种）
  - `local-resource-protocol.ts`：ALLOWED_EXTENSIONS 自动同步 MIME_MAP（白名单扩展）；更新警告消息

- **UI 组件**（`src/renderer/src/components/app-modules/todo-app/`，Element Plus 实现）
  - `TodoAppPage.vue`：三栏布局（左 240px / 中 flex:1 / 右 320px），管理全局状态
  - `TodoSidebar.vue`：分类树 / 标签云视图切换
  - `TodoCategoryTree.vue`：el-tree 递归渲染，支持新建子分类 / 重命名 / 删除（移至回收站）
  - `TodoLabelCloud.vue`：el-tag 标签云
  - `TodoListPanel.vue`：列表选择 + items 树渲染 + 新建列表/条目
  - `TodoItemRow.vue`：el-checkbox（done 切换）+ 缩进层级（depth*20px）+ 优先级颜色标记 + 递归子项展开
  - `TodoItemDetail.vue`：el-form 编辑（title/description/task_prompt/status/priority/due_at/is_manual_progress/progress/label_ids）+ 关联文档列表
  - `TodoDocumentEditor.vue`：vditor Markdown 编辑器（IR 模式）+ 附件上传（图片自动落盘 attach/ 目录并插入 local-resource:// URL）

- **路由集成**
  - `TitleBar.vue`：新增"应用"菜单 → "代办应用"
  - `MainComponent.vue`：`handleSwitchMode` 新增 `'todo-app'` 分支

### 测试

- 新增 116 个单元测试，全部通过：
  - `todo-db.test.ts`（8）：建表幂等、getDBManager 可用、SQL 文件不存在时抛错
  - `todo-label.service.test.ts`（16）：CRUD、name 唯一性、软删除后同名重建、setItemLabels 全量覆盖、关联清理
  - `todo-category.service.test.ts`（22）：递归深度（第 5 层拒绝）、getTree 多层树 + list_count 聚合、软删除级联、restore parent 已删提升至根、环检测
  - `todo-list.service.test.ts`（12）：CRUD、按 categoryId/null 过滤、级联软删除 item
  - `todo-item.service.test.ts`（38）：状态机全部合法/非法转换、进度联动（普通/手动/混合/多级）、递归深度、collectSubtree 排序、软删除递归子项 + 父进度重算
  - `todo-document.service.test.ts`（20）：saveAttachment hash 去重/分桶/实际写文件、category_id+item_id 互斥
- 测试 DB 策略：文件级 `vi.mock('better-sqlite3')` + 通用内存 SQL 执行器（`todo-mock-db.ts`），支持 6 表 INSERT/SELECT/UPDATE/DELETE + WHERE/JOIN/IN/COUNT/GROUP BY/ORDER BY
- 全量回归：840 用例通过（2 个 GlobalShortcutManager 失败为 pre-existing，与本次改动无关）

### 范围说明

- **未做**：Phase 3（FTS5 全文搜索 + todo_search_history）、Phase 4（统一回收站 UI）、Phase 5（Todo 驱动 AI 任务：createTaskFromItem / 总结文档 / source result handler）、Phase 6（增强打磨：vditor 打包资源本地化、拖拽排序、快捷键等）
- **已知限制**：vditor CDN 指向 `node_modules/visor/dist`，打包时需将 dist 复制到 resources 并更新 cdn 路径；软删除"删除"按钮当前直接软删除（无回收站 UI，Phase 4 补充）
- **设计决策**：配置复用 `qtian.json` 的 `todo_app` 段；附件协议复用 `local-resource://`；TodoDb 暴露 `getDBManager()` 业务查询在 Service 层；`bootstrapTodoApp()` 与 task 系统一致（独立引导 + 隔离失败）

## [1.0.0] 2026-06-16

**User**: 按照 `docs/specs/007_task-design.md` 进行开发，完成任务管理功能

**Summary**:

本次开发落地任务系统 **Phase 1：核心框架**（设计文档 §14），为后续扩展 APP（todo-app 等）提供统一的 Agent 任务调度基础设施。

### 新增模块

- **数据层**
  - `data/task.sql`：task 主表 + task_agent 扩展表 + 索引（type/status/source），独立 `task.db`
  - `TaskDb`（`src/main/core/services/task/task-db.ts`）：封装 task/task_agent 的 CRUD、JOIN 查询、定点字段更新（status/progress/chat_history_id/result_meta）、崩溃恢复（running→failed，COALESCE 保留已有错误信息）；插入采用"主表+扩展表"两步并在扩展表失败时回滚主记录

- **核心服务**
  - `task.types.ts`：Task / TaskType / TaskSource / TaskStatus / TaskAgent / TaskAgentView / ITaskExecutor / TaskExecutionContext / TaskCancelToken / TaskExecutionResult / TaskEvent / SourceResultHandler / AgentTaskCreateInput 等类型；`TaskExecutionError`、`TaskCancelledError` 异常类；`TASK_TERMINAL_STATUSES` 等校验常量
  - `TaskEventBroadcaster`：按 WebContents 维护订阅（全部任务或指定 taskId），自动清理已销毁 WebContents，send 异常隔离；`broadcast` 按订阅过滤减少 IPC 流量，`broadcastToAll` 兜底
  - `AgentTaskExecutor`：复用 `AiAgentService`，`agent_id='task:agent:<taskId>'` 与 AI 助手主历史隔离；AiChatEvent→TaskEvent 翻译（context_compress 降级为 log）；取消令牌驱动 `agentService.abort()`；历史持久化失败不阻断完成
  - `TaskManager`：CRUD + 状态机（pending→running→completed/failed/cancelled）+ 执行器注册表 + source handler 注册表 + 运行态 Map（含取消令牌）+ 崩溃恢复 + 事件广播；重复运行拒绝（仅 pending 可 run）；source handler 失败仅记入 `result_meta.handler_error` 不影响 completed

- **IPC / 启动**
  - `src/shared/ipc-channels.ts`：新增 `TASK_*` 频道（create-agent-task/run/cancel/get/list-by-source/list/subscribe/unsubscribe/event）
  - `src/main/core/ipc/handlers/task.handler.ts`：任务 IPC handlers，subscribe/unsubscribe 绑定 `event.sender`
  - `task-bootstrap.ts`：进程级单例引导（建表 + 崩溃恢复 + 注册 AgentTaskExecutor + 注册 IPC），幂等
  - `src/preload/index.ts`：新增 `window.task.*` API 与 `window.task`，`onEvent` 返回取消订阅函数便于组件卸载清理
  - `src/main/index.ts`：app ready 阶段 `bootstrapTaskSystem()`

- **WPath 扩展**：`src/main/core/common/context.ts` 新增 `taskDir`、`taskDbPath`、`getTaskSqlFile()`

### 重构

- 提取 `src/main/core/services/tools/build-tools.ts`（`buildBuiltInTools`）公共化内置工具构建逻辑，注入 `askUserViaIpc` / `getTavilyApiKey` 提供者；`ai-assistant.handler.ts` 改为委托调用，消除重复并支持任务执行器复用

### 测试

- 新增 93 个单元测试，全部通过：
  - `task-db.test.ts`（42）：建表、CRUD、JOIN、状态/进度/历史/元数据更新、崩溃恢复、COALESCE 语义、分页 clamp、字段校验
  - `task-event-broadcaster.test.ts`（15）：订阅/广播/过滤、多 taskId 去重、销毁清理、send 异常隔离、broadcastToAll
  - `agent-task-executor.test.ts`（14）：事件翻译、取消（注册前/迭代中）、错误传播、历史保存失败容错
  - `task-manager.service.test.ts`（22）：状态机流转、重复运行拒绝、取消（running/pending/终态）、source handler 成功合并/失败容错、崩溃恢复、运行态计数
- 全量回归：agent + tools 499 用例无回归；task 模块文件级 `vi.mock('better-sqlite3')` 未影响既有 doc 测试

### 范围说明

- **未做**：Phase 2（todo-app 接入：`createTaskFromItem` / 总结文档 / todo-app IPC）依赖尚未存在的 todo-app 代码模块；Phase 3（全局任务中心 UI、任务队列）；渲染进程 UI 组件（设计文档 §11 已声明不在本期）
- **已知限制**：任务上下文的 `ask_human` 工具暂未接入（需任务级独立 IPC 双向通信），`buildBuiltInTools` 会告警跳过；web_search 已通过 `getTavilyApiKey` 接入
- **测试 DB 策略**：task 测试采用文件级 `vi.mock('better-sqlite3')` + 针对 task schema 的轻量内存 SQL 执行器，不污染既有全局 doc 专用 mock

## [1.0.0] 2026-06-14

**User**: 根据 `docs/specs/006-tool-search.md` 给 agent 开发联网搜索工具，使用 Tavily API

**Summary**:

- 新增 `WebSearchTool` 内置工具（`src/main/core/services/tools/web-search-tool/web-search-tool.ts`），通过 Tavily Search API 实现 AI Agent 联网搜索
- 工具名 `web_search`，必填参数 `query`；可选参数 `max_results`(1-10,默认5)、`search_depth`(basic/advanced)、`include_domains[]`、`exclude_domains[]`、`include_answer`(默认true)
- 输出 Markdown 格式：answer 摘要 + `## Sources` 超链接列表 + 结果计数
- 通过构造函数注入 `apiKeyProvider: () => string` 回调读取最新 API key，工具本身不依赖配置模块，便于单元测试和动态刷新
- 使用 `undici.fetch` + `AbortController` 实现 30s 超时；单条 content 截断 500 字符防 token 爆炸
- 错误处理覆盖：参数校验、API key 缺失、HTTP 4xx/5xx、超时、网络异常、JSON 解析失败
- 新增 WebSearchTool 单元测试（40 个用例，全部通过）
- 扩展 `ConfigData` 接口与 `Config` 类：顶层新增 `tavily_api_key` 字段，`initConfig` 读取
- 新增设计文档章节：`docs/specs/006-tool-search.md` §4.3-§4.9
- 修改 `src/main/core/services/tools/index.ts` 导出 `WebSearchTool`
- 修改 `src/main/core/ipc/handlers/ai-assistant.handler.ts` `buildTools()` 添加 `web_search` case，通过 `() => config.tavilyApiKey` 注入 API key

## [1.0.0] 2026-05-21

**User**: 增加 ask human tool，实现模型向人询问、确认信息，参考 claude-code-source-code 的 AskUserQuestionTool 实现

**Summary**:

- 新增 `AskHumanTool` 内置工具（`src/main/core/services/tools/ask-tool/ask-tool.ts`），支持 AI Agent 向用户提出多选题并等待回答
- 支持 1-4 个问题，每题 2-4 个选项，支持单选和多选模式
- 通过构造函数注入回调函数设计，工具本身不依赖 Electron API，便于单元测试
- 新增双向 IPC 通信机制：`AI_ASK_QUESTION`（Main→Renderer 发送问题）、`AI_ANSWER_QUESTION`（Renderer→Main 返回回答）
- 安全措施：参数校验（数量限制、header 唯一性、选项唯一性）、5 分钟超时保护、sender 有效性检查
- 新增 AskHumanTool 单元测试（28 个用例，全部通过）
- 新增设计文档 `docs/specs/006-tool-ask-design.md`
- 修改 `index.ts` 导出 AskHumanTool，修改 `ai-assistant.handler.ts` 的 `buildTools()` 注册 `ask_human`
- 修改 `ipc-channels.ts` 新增 `AI_ASK_QUESTION` 和 `AI_ANSWER_QUESTION` 频道
- 修改 `preload/index.ts` 新增 `onAskQuestion` 事件监听和 `answerQuestion` invoke

## [1.0.0] 2026-05-20

**User**: 增加 grep tool，实现文件内容查找，参考 claude-code-source-code 的 GrepTool 实现

**Summary**:

- 新增 `GrepTool` 内置工具（`src/main/core/services/tools/grep-tool/grep-tool.ts`），支持 AI Agent 在文件内容中搜索正则表达式
- 三种输出模式：`files_with_matches`（文件列表）、`content`（匹配行+行号+上下文）、`count`（匹配计数）
- 支持正则匹配、大小写忽略（-i）、上下文行（-B/-A/-C）、glob 文件过滤、结果分页（head_limit）
- 安全措施：VCS 目录排除（.git/.svn）、二进制文件跳过、行长度截断
- 基于 Node.js 原生文件读取实现（无外部依赖）
- 新增 GrepTool 单元测试（35 个用例，全部通过）
- 新增设计文档 `docs/specs/006-tool-grep-design.md`
- 修改 `index.ts` 导出 GrepTool，修改 `ai-assistant.handler.ts` 的 `buildTools()` 注册 `grep`

## [1.0.0] 2026-05-20

**User**: 增加 glob tool，实现文件查找，参考 claude-code-source-code 的 GlobTool 实现

**Summary**:

- 新增 `GlobTool` 内置工具（`src/main/core/services/tools/glob-tool/glob-tool.ts`），支持 AI Agent 按 glob 模式快速查找文件
- glob 模式匹配：支持 `**`（递归目录）、`*`（单层通配）、`?`（单字符）
- 搜索目录验证、绝对路径 pattern 处理（提取 base directory）
- 结果按修改时间排序（最新优先）、截断限制（默认 100 条）
- 路径相对化输出（省 token），基于 Node.js `fs.readdir` 实现（无外部依赖）
- 新增 GlobTool 单元测试（25 个用例，全部通过）
- 新增设计文档 `docs/specs/006-tool-glob-design.md`
- 修改 `index.ts` 导出 GlobTool，修改 `ai-assistant.handler.ts` 的 `buildTools()` 注册 `glob`

## [1.0.0] 2026-05-20

**User**: 增加 edit tool，实现文件编辑，参考 claude-code-source-code 的 FileEditTool 实现

**Summary**:

- 新增 `EditTool` 内置工具（`src/main/core/services/tools/edit-tool/edit-tool.ts`），支持 AI Agent 通过字符串替换增量编辑文件
- 精确字符串替换：old_string → new_string，支持单次替换和 replace_all 全局替换
- 引号规范化：弯引号（curly quote）↔ 直引号（straight quote）兼容匹配与风格保持
- 唯一性检查：多匹配时要求 replace_all=true 或提供更多上下文
- 新文件创建：old_string="" 时创建新文件（含自动创建父目录）
- 保留原始行尾：保持文件原有 CRLF/LF 风格（与 WriteTool 强制 LF 不同）
- 安全措施：设备文件黑名单、相同字符串检查、路径规范化
- 新增 EditTool 单元测试（37 个用例，全部通过）
- 新增设计文档 `docs/specs/006-tool-edit-design.md`
- 修改 `index.ts` 导出 EditTool，修改 `ai-assistant.handler.ts` 的 `buildTools()` 注册 `file_edit`

## [1.0.0] 2026-05-20

**User**: 增加 write tool，实现文件写入，参考 claude-code-source-code 的 FileWriteTool 实现

**Summary**:

- 新增 `WriteTool` 内置工具（`src/main/core/services/tools/write-tool/write-tool.ts`），支持 AI Agent 创建或覆盖本地文件
- 创建新文件或覆盖已有文件，自动创建父目录（recursive mkdir）
- 强制 LF 行尾，不继承旧文件 CRLF（防止跨平台脚本损坏）
- 安全措施：设备文件黑名单、内容大小限制（1MB）、路径规范化
- 错误处理：权限拒绝、只读文件系统、磁盘空间不足等友好提示
- 新增 WriteTool 单元测试（36 个用例，全部通过）
- 新增设计文档 `docs/specs/006-tool-write-design.md`
- 修改 `index.ts` 导出 WriteTool，修改 `ai-assistant.handler.ts` 的 `buildTools()` 注册 `file_write`

## [1.0.0] 2026-05-20

**User**: 增加 read tool，实现文件读取，参考 claude-code-source-code 的 FileReadTool 实现

**Summary**:

- 新增 `ReadTool` 内置工具（`src/main/core/services/tools/read-tool/read-tool.ts`），支持 AI Agent 读取本地文件
- 文本文件读取：支持 offset/limit 分段读取，带行号格式化（cat -n 格式），256KB 大小限制
- 图片文件读取：支持 PNG/JPG/JPEG/GIF/WEBP，返回 base64 编码
- 安全措施：设备文件黑名单（/dev/zero 等）、二进制文件拒绝、路径规范化
- 错误处理：文件不存在、权限拒绝、目录路径、大小超限等友好提示
- 新增 ReadTool 单元测试（36 个用例，全部通过）
- 新增设计文档 `docs/specs/006-tool-read-design.md`
- 修改 `index.ts` 导出 ReadTool，修改 `ai-assistant.handler.ts` 的 `buildTools()` 注册 `file_read`

## [0.0.1] 2026-04-17

### 新增：快捷模式（Quick Mode）

- 新增 `QuickModePage.vue` 替代原 Homepage，应用默认进入快捷模式
- 快捷模式支持两种状态：初始（输入框）和回答（只读问题 + AI 回答 + "完整对话"按钮）
- 快捷模式对话不持久化，使用临时 historyId
- 点击"完整对话"按钮可将当前对话转换为普通模式并导航到 AI 助手页面
- 新增 `GlobalShortcutManager` 模块，注册 Ctrl+Q 全局快捷键
- Ctrl+Q：窗口隐藏时唤起窗口；窗口可见时切换到快捷模式
- 修改 `MainComponent.vue`，默认组件为 QuickModePage，新增 `switch-to-quick-mode` IPC 处理
- 修改 `AiAssistantPage.vue`，支持从快捷模式转换时直接选中已有历史
- 应用菜单"首页"改为"快捷模式"
- 新增 GlobalShortcutManager 单元测试（8 个用例，全部通过）

## [0.0.1] 2026-04-17

### 新增：系统托盘最小化功能

- 新增 `TrayManager` 模块（`src/main/core/utils/TrayManager.ts`），封装系统托盘创建、右键菜单、双击恢复窗口等逻辑
- 点击窗口右上角"关闭"按钮时，窗口隐藏到系统托盘而非退出应用
- 托盘图标右键菜单包含"显示主窗口"和"退出"两个选项
- 双击托盘图标可恢复显示主窗口
- 新增 `isQuitting` 标志位，区分"关闭到托盘"和"真正退出"两种行为
- 新增 TrayManager 单元测试（12 个用例，全部通过）
