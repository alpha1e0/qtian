# Changelog

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
