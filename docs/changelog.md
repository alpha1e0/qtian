# Changelog

## [1.0.0] 2026-07-10（note-app Phase 2 前端 UI 改为两栏布局 + 内联编辑器 + AI 任务浮动按钮）

**User**: 前端实现有问题，不符合设计：搜索框、侧边栏参考 todo-app，布局和 todo-app 不一样，是左右两列，右边为编辑区域，不需要提供最右侧的 detail 栏；AI 任务通过右下角悬浮图标实现

**Summary**:

将 note-app 前端从三栏布局（sidebar + doc list + detail）重构为两栏布局（sidebar + inline editor）。左侧导航栏保留分类树（含 doc 叶子节点）/ 标签 / 收藏三 tab；右侧直接为内联文档编辑面板（标题 + 分类 + 标签 + 摘要 + Vditor 一体化），不再有中间文档列表和右侧详情面板。右下角新增浮动 AI 任务按钮，点击展开弹出框编辑 task_prompt。

### 改动

| 文件 | 变化 |
|------|------|
| `NoteAppPage.vue` | 重写：三栏 → 两栏（sidebar + editor）；新增 mergedTree computed（category + doc 叶子节点 + 虚拟"无分类"节点）；新增 loadAllDocs + buildMergedTree |
| `NoteDocEditor.vue` | 重写：从 el-drawer 抽屉改为内联面板；整合标题/分类级联/标签/摘要/时间戳元数据区 + Vditor 编辑器；保留 30s 自动保存 + Ctrl+S 手动保存 + 图片上传 |
| `NoteAiTaskButton.vue` | **新增**：右下角浮动 AI 任务按钮（gradient circle + 展开面板编辑 task_prompt） |
| `NoteDocList.vue` | **删除**（中间面板不再需要） |
| `NoteDocDetail.vue` | **删除**（右侧详情面板不再需要，元数据整合进 NoteDocEditor） |
| `110_note-app-design.md` | Phase 2 描述更新为两栏布局 + 11 个组件 |

### 设计决策

- **两栏而非三栏**：笔记应用的编辑体验是核心，中间文档列表（卡片式）增加了点击层级（选分类 → 选文档 → 看详情 → 打开编辑器），两栏直接「选文档即编辑」，更接近 Notion / Obsidian 的使用体感。
- **mergedTree 含 doc 叶子节点**：与 todo-app 一致，category 作为分支，doc 作为叶子，虚拟"无分类"节点收纳 category_id=null 的文档，保证所有文档在树中可达。
- **内联编辑器取代抽屉**：抽屉模式是"临时覆盖"的交互，而笔记编辑是长时间沉浸的，内联面板让编辑区成为主工作区。
- **浮动 AI 任务按钮**：Phase 2 仅落库 task_prompt，不接 TaskManager；浮动入口不占用编辑区空间，Phase 3 接入时只需在按钮 click 时增加 createTask 调用。

### 测试

- 全量单测回归：1156/1156 通过
- 生产构建：`electron-vite build` 成功（renderer 1756 模块转换）

---

## [1.0.0] 2026-07-10（note-app Phase 2 前端 UI 三栏布局 + Vditor 编辑器）

**User**: 继续开发 note-app 需求（Phase 2 前端 UI：三栏布局 + Vditor Markdown 编辑器 + 分类/标签/收藏三个 tab）

**Summary**:

基于 Phase 1 后端（已完成 6 个 Service + 100 个单测 + Sidebar 占位），完成 Phase 2 前端 UI 全量组件。三栏布局（搜索栏 + 左侧导航树 + 中文档列表 + 右文档详情），复用 Aurora Library 视觉基调与 todo-app 一致。Vditor Markdown 编辑器以 el-drawer 抽屉承载（覆盖 75% 宽度），支持自动保存（30s）+ Ctrl+S 手动保存 + 图片上传。包含 12 个前端组件文件，全部独立于 todo-app（无跨模块代码引用）。

### 新增文件

| 文件 | 说明 |
|------|------|
| `constants.ts` | 前端共享常量（字段长度限制、debounce 时间等） |
| `NoteAppPage.vue` | 主页面三栏布局（替换 Phase 1 占位） |
| `NoteSearchBar.vue` | 顶部搜索栏（debounce + 结果 popover + 搜索历史） |
| `NoteSidebar.vue` | 左侧面板（分类/标签/收藏三 tab + 回收站入口） |
| `NoteCategoryTree.vue` | 分类树（含右键菜单 + 新建/重命名/删除） |
| `NoteLabelCloud.vue` | 标签云 |
| `NoteDocList.vue` | 中间面板文档列表（卡片式 + 收藏 toggle） |
| `NoteDocDetail.vue` | 右侧文档详情（失焦自动保存 + 标签编辑 + 正文预览） |
| `NoteDocEditor.vue` | Vditor Markdown 编辑器抽屉 |
| `NoteContextMenu.vue` | 通用右键菜单（teleport to body + 视口翻转） |
| `NoteCreateDialog.vue` | 统一新建/重命名对话框 |
| `NoteTrashDialog.vue` | 回收站对话框（跨表聚合 + 恢复/彻底删除/清空） |

### 交互特性

- **分类树**：递归树展示 category（含 doc_count 徽章），支持新建根/子分类、新建文档、重命名、删除
- **标签 tab**：分栏布局（上半标签云 + 下半标签关联文档列表）
- **收藏 tab**：扁平卡片列表
- **搜索**：300ms debounce + FTS5 全文搜索 + snippet 高亮 + 搜索历史
- **文档详情**：标题/摘要/AI任务描述失焦自动保存，标签多选 allow-create
- **Vditor 编辑器**：IR 模式、图片上传、字数统计、Ctrl+S 保存

### 测试

- 全量单测回归：1156/1156 通过（note-app 6 文件 100 个测试全绿）
- 生产构建：`electron-vite build` 成功（renderer 1758 模块转换）

---

## [1.0.0] 2026-07-06（TodoItemDetail 文档独立 tab + 列表化 + 行内删除）

**User**: todo-app，待办条目详情中 TodoItemDetail.vue，当前"文档"放在"基本信息"中，优化为：1. 文档放到单独 tab（名称"文档"）；2. 放弃标签云，使用列表展示；3. 文档 Item 点击进入编辑页；4. 文档 Item 右侧增加删除按钮，点击弹框确认删除。

**Summary**:

将 `TodoItemDetail` 顶部 tab 由「基本信息 / AI任务」双 tab 扩展为「基本信息 / 文档 / AI任务」三 tab，把原本嵌在"基本信息"末尾的 `.doc-cloud` 标签云收敛到独立的"文档" tab，并改为纵向 `.doc-list` 列表样式（每行 icon + 名称 + 更新时间 meta + 右侧 hover 显形的删除按钮）。删除按钮 `@click.stop` 阻止冒泡到行 click，弹 `ElMessageBox.confirm` 确认后调既有 `deleteDocument` IPC（软删除，可在回收站恢复），成功后刷新 `documents` 列表。无需新增 IPC / Service。

### 改动

- **`TodoItemDetail.vue`**：
  - 顶部 `.detail-header` 新增 `<el-radio-button value="docs">文档</el-radio-button>`；`.view-toggle :deep(.el-radio-button)` width 由 50% 改为 33.3333%（三等分）
  - 基本信息 tab 移除末尾 `.docs-section`（关联文档区），基本信息表单恢复纯净
  - 新增"文档" tab 分支（`v-else-if="view === 'docs'"`）：保留新建按钮，列表用 `.doc-list` + `.doc-row` 渲染；每行含 `Document` 图标 / 名称 / `formatDocTime(updated_at)` 次级 meta / 右侧 `Delete` 图标按钮
  - 脚本：导入 `Delete` 图标并注册；新增 `handleDeleteDoc(doc)`（弹确认框 → `window.todoApp.deleteDocument(doc.id)` → `loadDocuments` 刷新 → `ElMessage.success`）+ `formatDocTime(ts)`（与 TodoListDetail.formatTime 同款）
  - 样式：删除原 `.doc-cloud` / `.doc-chip` 块；新增 `.doc-list` / `.doc-row` / `.doc-row-icon` / `.doc-row-main` / `.doc-row-name` / `.doc-row-meta` / `.doc-row-delete`，删除按钮默认 `opacity:0`，行 hover 或键盘 focus 时显形，hover 时切红色危险色
- **`docs/specs/100_todo-app-design.md`**：§9.2 组件清单 `TodoItemDetail.vue` 行更新 tab 描述（双 tab → 三 tab；列出文档 tab 的列表样式 + 删除按钮行为）

### 设计决策

- **抽到独立 tab 而非保留在基本信息底部**：标签云挤在长表单末尾，文档作为"关联资源"的入口权重被淹没；独立 tab 让"管理文档"成为一等公民，与 AI任务 tab 平级，也避免基本信息表单过长导致文档区被滚动到不可见。
- **列表样式而非标签云**：标签云 chip 在文档数量较多时（10+ 条）排版混乱且无法承载次级 meta（更新时间）；列表纵向排列信息密度更可控，每行都能精确点击，并为右侧删除按钮预留挂载位。
- **删除按钮 hover 显形（默认 opacity:0）**：扫视列表时不被操作图标干扰；hover 行或键盘 focus 行即暴露入口，符合无障碍预期（focus-visible 同步显形）。点击删除按钮时 `@click.stop` 阻止冒泡，避免误触发 `handleOpenDoc`。
- **复用既有 `deleteDocument` IPC**：服务层早已支持软删除（写入 `deleted_at`，可在回收站恢复），无需新增 IPC / service 方法。删除后 `loadDocuments()` 重新拉一次列表保证 UI 与后端一致。
- **`formatDocTime` 与 TodoListDetail.formatTime 同款但不抽公共**：两处都是组件内私有的小工具方法，抽公共 util 的成本收益不匹配，先保留同名重复，待第三处出现再合并（避免过早抽象）。

### 测试

- 主进程代码无改动，todo-app 现有 268 个单元测试不受影响
- 纯 UI 改动（template + style），建议手动验证：① 切换三个 tab 正常；② 文档 tab 列表渲染 + 点击行打开编辑抽屉；③ 行 hover 显示删除按钮 + 点击弹确认框；④ 确认删除后列表刷新；⑤ 取消确认不触发删除

## [1.0.0] 2026-07-03（文档抽屉点击外部关闭）

**User**: todo-app，`TodoDocumentEditor.vue` 的 el-drawer 点击空白，自动消失。

**Summary**:

将文档编辑抽屉由 `modal: false` 改为默认 modal（启用遮罩层），依赖 el-drawer 默认的 `close-on-click-modal: true` 行为，点击抽屉外的遮罩区域即可关闭抽屉。同步给遮罩叠加 `backdrop-filter: blur(2px)` 与 indigo 染色，与 Aurora 深色主题氛围一致。

### 改动

- **`TodoDocumentEditor.vue`**：
  - 移除 `:modal="false"` 声明（恢复默认 modal 行为）
  - 顶部设计意图注释由"non-modal 保留底层可交互性"更新为"启用 modal 遮罩，点击外部可关闭"
  - 全局 unscoped 样式新增 `.el-overlay:has(.todo-doc-drawer)` 规则：`background-color: rgba(30,27,50,0.42)` + `backdrop-filter: blur(2px)`，强化"浮层"层级感

### 设计决策

- 之前的 `modal: false` 是为了"跨条目复制资料时保留底层 detail 的可交互性"，但实际使用中点击空白区域无响应反而让用户对"如何关闭抽屉"产生困惑。改为 modal 后，遮罩既承担"点击外部关闭"的可见语义，又用模糊效果强化 z-index 层级关系，更符合抽屉类组件的通用心智模型。
- `:has()` 选择器在现代 Chromium（Electron 内核）下原生支持，零运行时成本，且仅作用于本应用挂载的 `.todo-doc-drawer`，不会污染其他 el-drawer。

### 测试

- todo-app 单元测试 268 个全部通过（CSS/模板级调整，无逻辑变更）

## [1.0.0] 2026-07-02（"无分类"待办项目 + sidebar tree-header 优化）

**User**: todo-app 支持"无分类"待办项目（`category_id=NULL`，sidebar 分类树顶部显示"无分类"虚拟节点）；同时优化 `TodoCategoryTree` tree-header：去掉"分类"文本、操作图标居中、新增"创建待办项目 / 全部展开 / 全部折叠"按钮。

**Summary**:

约定 `todo_list.category_id IS NULL` 为"无分类"（外键允许 NULL，无需在 `todo_category` 表插入系统行）。sidebar 分类树顶部由前端 `TodoAppPage.mergedTree` computed 拼接一个虚拟节点 `{ id:0, name:'无分类', children:[未分类 todo_list...] }`，IPC 边界做 id 转换（`id=0` ↔ `null`）。同步优化 tree-header：去掉"分类"文本，4 个图标按钮（新建根分类 / 新建待办项目 / 全部展开 / 全部折叠）居中排列；"新建待办项目"在未选中分类时默认在"无分类"下创建。

### 改动

- **`data/todo-app.sql`**：`todo_list.category_id` 字段注释更新为 `NULL = 无分类`
- **`src/main/core/services/app-modules/todo-app/todo-list.service.ts`**：保持 `list(null)` 查 `WHERE category_id IS NULL`；`create` 默认 `category_id=null`（service 层无任何"哨兵"逻辑）
- **`src/renderer/src/components/app-modules/todo-app/TodoAppPage.vue`**：
  - `mergedTree` computed 在真实 category 树之前拼接虚拟"无分类"节点（`id:0`，children 为 `category_id == null` 的 todo_list）
  - `handleCreateListUnderCategory` 将 `categoryId===0` 转为 `null` 传给 `createTodoList` IPC
  - `currentNodeKey` / `handleSelectCategory` / 删除 handler 使用 `!= null` 判断（允许 id=0 通过）
- **`src/renderer/src/components/app-modules/todo-app/TodoCategoryTree.vue`**：
  - tree-header 去掉"分类"文本，4 个图标按钮居中（`FolderAdd` / `DocumentAdd` / `Expand` / `Fold`）
  - 新增 `handleCreateListFromHeader`（未选中分类时默认在虚拟"无分类"节点下创建）
  - 新增 `expandAll` / `collapseAll` / `setAllExpanded` 方法，遍历 `tree.store.root`
  - 虚拟节点（`data.id === 0`）：`Files` 图标、空右键菜单、`.is-uncategorized` 弱化样式
- **`src/renderer/src/components/app-modules/todo-app/TodoCategoryDetail.vue`**：
  - `loadDetail` 对 `categoryId===0` 直接构造静态详情（不查 backend），`listTodoLists(null)` 拉未分类列表计数
  - `isUncategorized` computed + 名称输入框 `:disabled` + 提示文案
- **`src/main/core/services/app-modules/todo-app/todo-category.service.test.ts`** / **`todo-list.service.test.ts`**：保持原断言不变（无哨兵相关用例）

### 设计决策

- **null vs 哨兵行**：先前曾尝试在 `todo_category` 表插入 `id=0` 哨兵行承载"无分类"，但 SQLite `INTEGER PRIMARY KEY AUTOINCREMENT` 会将显式 `id=0` 当作自增触发（实际存储为下一个自增值），导致外键约束失败。改用 `category_id=NULL` 方案：外键约束对 NULL 引用不校验存在性，规避该兼容性问题
- **前端虚拟节点 vs 后端特殊行**：虚拟节点零迁移成本（无 schema 变更、无数据迁移），缺点是后端 `getTree()` 不返回该节点——通过 `TodoAppPage.mergedTree` computed 在前端补齐，IPC 边界做 id 转换即可
- **id=0 作为前端标识**：真实 category 由 AUTOINCREMENT 生成，从 1 开始，故 id=0 不会与真实节点冲突，是安全的虚拟节点标识

### 测试

- todo-app 单元测试 268 个全部通过（`npx vitest run src/main/core/services/app-modules/todo-app/`）
- 2 个 GlobalShortcutManager 失败用例与本次改动无关（Ctrl+Q 窗口隐藏/显示断言，属历史问题）

## [1.0.0] 2026-07-02（关联文档抽屉化 + 标签云展示）

**User**: todo-app 待办条目的"关联文档"优化：1. el-drawer 抽屉框（从右往左展开，占整个 app 页面 2/3）；2. detail 中"关联文档"由列表改为标签云；3. 使用 vditor 三方组件（含文本编辑、图片粘贴）；4. 图片展示走伪协议

**Summary**:

将原右栏 600px 固定宽的 `TodoDocumentEditor` 改造为 `el-drawer` 抽屉模式，从右往左展开覆盖 app 页面 2/3 宽度（`size: 66.6667%`，`direction: rtl`），并保留底层三栏的可交互性（`modal: false`）便于跨条目复制资料。同时把 `TodoItemDetail` / `TodoListDetail` 的"关联文档"由纵向 `.doc-item` 列表改为 flex-wrap chip 布局（`.doc-cloud` / `.doc-chip`），沿用 `TodoLabelCloud` 视觉语言（pill 圆角 + accent-soft 描边 + hover 抬升），提升单位面积信息密度与扫视效率。

### 改动

- **`TodoDocumentEditor.vue`（抽屉化重构）**
  - 外层由 `<div class="todo-doc-editor">` 改为 `<el-drawer>`（`v-model:visible`、`size: 66.6667%`、`direction: rtl`、`modal: false`、`append-to-body`、`:with-header="false"` 自绘工具条）
  - 新增 `visible` prop（v-model）+ `update:visible` emit；移除原 `back` emit（关闭按钮在自绘工具条内）
  - vditor 初始化推迟到 `@opened` 事件，避免在隐藏容器上初始化（尺寸为 0）导致排版错乱
  - 抽屉关闭时销毁 vditor + 停止自动保存（保留组件实例，再次打开时复用）
  - 新增 `destroyEditor()` 公共方法，统一销毁逻辑；`handleKeyDown` 仅在 `visible` 时响应 Ctrl+S / Ctrl+R
  - 抽屉打开期间切换 docId 时重新加载并初始化编辑器（搜索跳转 + 详情 chip 切换文档场景）
  - 全局 unscoped 样式 `.todo-doc-drawer .el-drawer__body { padding: 0 }` 让编辑器贴边铺满
- **`TodoAppPage.vue`（抽屉挂载 + 状态机瘦身）**
  - 新增 `docDrawerVisible` state，挂载 `<TodoDocumentEditor>` 在 `.todo-app-page` 根级（脱离三栏布局约束）
  - 移除 `rightPanelView === 'document-editor'` 分支与 `handleEditorBack` 方法
  - `openDoc()` / `handleJumpToResult(document)` 改为置 `docDrawerVisible = true`
  - 注：`.todo-item-detail-wide`（flex 0 0 600px）保留供 `TaskPanel` 使用
- **`TodoItemDetail.vue` / `TodoListDetail.vue`（文档标签云）**
  - 模板：`v-for doc-item` 列表 → `.doc-cloud` flex-wrap + `.doc-chip` 入口
  - chip 含 `role="button"` / `tabindex="0"` / `aria-label` / `@keyup.enter` 键盘可达性
  - `TodoListDetail` 的 chip 内嵌 `.doc-chip-meta`（更新时间徽标）保留次级信息
  - CSS：删除 `.doc-item` / `.doc-name` / `.doc-updated`，新增 `.doc-cloud` / `.doc-chip` / `.doc-chip-name` / `.doc-chip-meta`，沿用 TodoLabelCloud 视觉（accent-soft pill + hover 抬升 + 描边增强）

### 设计决策

- **non-modal**：`modal: false` 保留对底层 detail 的可交互性，便于跨条目复制资料（与 qmin 全屏 md-editor 不同，qtian 的 todo-app 是三栏结构，用户编辑文档时通常需要参考右侧详情/左侧导航）
- **抽屉 vs 右栏 600px**：抽屉覆盖 app 2/3 宽度（约 800-1000px），比原 600px 固定宽更宽裕，vditor 工具条不再拥挤
- **vditor 初始化时机**：el-drawer 默认惰性渲染 body，且开合有过渡动画，`mounted` 时容器尺寸为 0 会导致 vditor 排版错乱，故推迟到 `@opened`
- **vditor 资源加载（参考 qmin）**：移除 `cdn` 选项，让 vditor 走默认在线 CDN（jsdelivr）。原 `cdn: 'node_modules/vditor/dist'` 因 vditor 内部以 `${cdn}/dist/<sub>` 拼接资源 URL 而产生双重 `dist`，404 致使 i18n/math/icons 加载失败，编辑器白板。改静态 `import Vditor from 'vditor'` + 静态 `import 'vditor/dist/index.css'`，与 `qmin/VditorPanel.vue` 完全一致；离线场景作为后续可选增强（vite-plugin-static-copy 把 vditor/dist 复制到 public/）
- **防御性构造/销毁**：`initEditor` 前置校验 `editorRef.isConnected`（避免空 ref 构造导致后续 destroy 抛 "Cannot read properties of undefined"）；`destroyEditor` 校验 `vditor.element.isConnected` 再 destroy（兜底 element 被外层 innerHTML 清空的情况）
- **图片伪协议**：沿用既有 `local-resource://`（`saveAttachment` / `saveAttachmentFromPath` 返回值），未引入 qmin 的 `local-resource-md://` 相对路径变体（qtian 暂无 md 文件迁移需求）
- **标签云语义**：在文档场景下解读为"flex-wrap chip 入口集合"（与 TodoLabelCloud 一致），而非按内容长度加权——文档数量通常远少于标签词频，加权会让大小不一致反而难读

### 测试

- 现有 todo-app 单元测试 276 个全部通过（未触及 main 侧服务层）
- 2 个 GlobalShortcutManager 失败用例与本次改动无关（Ctrl+Q 窗口隐藏/显示断言，属历史问题）

## [1.0.0] 2026-07-01（快捷输入框）

**User**: todo-app 中间面板最下方增加固定快捷输入框，路径前缀（蓝色，每级 2 字符）+ 输入框，Enter 创建待办条目；结尾 `#4 #3 #2 #1` 控制优先级 urgent/important/normal/hint

**Summary**:

中间面板（`TodoListPanel.vue`）底部新增**固定不滚动**的快捷输入框，让用户无需打开新建对话框即可快速录入条目。左侧蓝色路径前缀标识新条目落地层级（选中条目时为其子项，每级标题取前 2 字符；未选中时为 `/` 根级）；输入结尾可附 `#1`～`#4` 控制符指定优先级，控制符连同前后空白从 title 中剔除。解析逻辑集中在 main 侧纯函数，单一 IPC 封装"解析+落库"，renderer 走同一通道保证只有一处真源。

### 新增

- **解析纯函数**（`todo-quick-input.ts`，可测）
  - `parseQuickItemInput(raw): { title, priority }`：正则 `/\s*#([1-4])\s*$/` 匹配结尾控制符
  - 映射 `#4→urgent` / `#3→important` / `#2→normal` / `#1→hint`；无控制符默认 `normal`
  - 控制符及前后空白剔除；title 为空抛错
- **IPC**：
  - `ipc-channels.ts`：`TODO_CREATE_ITEM_QUICK`
  - `todo-app.handler.ts`：handler 调 `parseQuickItemInput` + `itemService.create` 返回新条目
  - `preload/index.ts`：`createTodoItemQuick(raw, listId, parentId)`
- **UI**（`TodoListPanel.vue`）：
  - 根已是 flex 列；在 `.list-panel-scroll` 之后新增 `.quick-input-bar`（`flex-shrink:0` 钉在底部，不随滚动消失）
  - 左侧 `.quick-input-path` 蓝色路径前缀；computed `quickInputPathPrefix`（每级 `title.slice(0,2)`）/ `quickInputPathFull`（tooltip 完整路径）
  - `findItemPath(nodes, id)` DFS 求选中条目祖先链
  - `handleQuickCreate`：Enter 触发 → `createTodoItemQuick(raw, listId, selectedItemId)` → `loadItemTree` → 选中新建条目 → 清空输入框
  - 仅 `listId` 存在时显示

### 测试

- `todo-quick-input.test.ts`：19 个用例（#1-#4 映射、空白剔除、无控制符默认、#0/#5/孤立# 不识别、仅结尾匹配、多控制符取末位、空 title 抛错、null 安全）
- 全部 268 个 todo-app 单测通过（249 → 268），`electron-vite build` 三端编译无类型错误

### 文档

- `docs/specs/100_todo-app-design.md`：IPC 通道清单 + TodoListPanel 组件表同步更新

## [1.0.0] 2026-07-01

**User**: todo-app 增加"待办项目"收藏功能：中间面板工具栏增加 star 收藏按钮；sidebar 增加"收藏"tab 以列表形式展示所有收藏项目

**Summary**:

为 todo-app 待办项目（todo_list）新增收藏能力，让用户快捷置顶常用项目。中间面板工具栏的 star 按钮切换当前项目收藏态（实心=已收藏 / 空心=未收藏，暖金色强调以区别于筛选的 indigo accent）；侧边栏新增第三个 tab"收藏"，以扁平列表展示所有 `is_favorite=1` 的项目，列表项样式与标签云 tab 关联项目卡片完全一致，点击跳转、右键菜单（导出/重命名/删除）均复用现有交互。

### 新增

- **数据模型**：`todo_list` 表新增 `is_favorite INTEGER NOT NULL DEFAULT 0` 字段（0=未收藏 1=已收藏）
  - `data/todo-app.sql`：CREATE TABLE 同步加列（新库直接建好）
  - `todo-db.ts`：`initialize()` 新增 `runMigrations()` + 通用 `ensureColumn(table, column, definition)` 幂等迁移（`PRAGMA table_info` 检查 + `ALTER TABLE ADD COLUMN`），为已有库补齐新字段
- **类型**：`types.ts` 的 `TodoList` 接口新增 `is_favorite: boolean`
- **Service**（`todo-list.service.ts`）：
  - `toggleFavorite(id): TodoList | undefined` — 事务内翻转收藏态（更新 `updated_at`），不存在的 id 安全返回 undefined
  - `listFavorites(): TodoList[]` — 返回所有 `is_favorite=1` 且未软删除的项目
  - 所有 SELECT / `mapRow` / `TodoListRow` 同步纳入 `is_favorite`（0/1 ↔ false/true）
- **IPC**：
  - `ipc-channels.ts`：`TODO_TOGGLE_FAVORITE` / `TODO_LIST_FAVORITES`
  - `todo-app.handler.ts`：注册两个 handler
  - `preload/index.ts`：`toggleFavoriteTodoList(id)` / `listFavoriteTodoLists()`
- **UI**：
  - `TodoListPanel.vue`：工具栏增加 star 按钮（`Star`/`StarFilled` 动态），props 加 `isFavorite`，emit `toggle-favorite`；金色 `.favorite-btn.is-favorite` 高亮
  - `TodoAppPage.vue`：computed `currentListIsFavorite`；`handleToggleFavorite` 调 IPC + 刷新 allTodoLists + 刷新 sidebar 收藏列表；重命名/删除/详情更新后同步刷新收藏列表
  - `TodoSidebar.vue`：view-toggle 三等分增加"收藏"按钮；`favorite` tab 渲染扁平收藏列表（复用 `.label-list-item` 卡片样式）；`loadFavoriteLists` / `refreshFavoriteLists`；view watcher 切到收藏时懒加载

### 测试

- `todo-list.service.test.ts`：新增 9 个用例（`is_favorite` 字段默认值与回读、`toggleFavorite` 双向翻转 + 不存在 id 安全、`listFavorites` 仅收藏 / 排除已删除 / 排除未收藏 / 取消后移除）
- 全部 249 个 todo-app 单测通过（25 → 34），`electron-vite build` 三端编译无类型错误

### 文档

- `docs/specs/100_todo-app-design.md`：更新 TodoList 类型、SQL schema、Service 职责表、IPC 通道清单、UI 组件表

## [Unreleased] 2026-06-18

**User**: todo-app Phase 5 Todo 驱动 AI 任务（适配层 Service + IPC + 3 个新 UI 组件 + TodoItemDetail 集成 + 测试 + 文档）

**Summary**:

落地 todo-app **Phase 5 Todo 驱动 AI 任务**：基于公共任务系统（007 Phase 1 已交付的 `TaskManager` + `AgentTaskExecutor`）引入"由 todo_item 驱动 AI Agent 任务"的能力 —— 用户在 todo_item 详情页选择 Agent + LLM 配置后一键发起任务，任务完成后由 todo-app 注册的 source result handler 自动生成 markdown 总结文档关联到 todo_item；支持重跑（新建 task + 新对话历史 + 新总结，旧 task 保留为历史）。设计文档 `docs/specs/100_todo-app-design.md` §10 Phase 5 标注"已实现"。

### 新增

- **类型与 Service 扩展**
  - `types.ts`：新增 `CreateTaskFromItemOptions`（agentName / llmConfigName / extraPrompt?）
  - `todo-item.service.ts`：新增专用方法 `updateAgentTaskId(id, taskId)`（不污染 `update()` 公共 patch，仅 TodoTaskService 内部调用）

- **TodoTaskService 适配层**（`todo-task.service.ts` 新增，~250 行）
  - `createTaskFromItem(itemId, options)`：item 校验 → collectSubtree → buildPrompt（§8.3 模板，4 段落 + 子任务按 depth 缩进）→ category_path 解析 → TaskManager.createAgentTask → updateAgentTaskId → TaskManager.run（异步 fire-and-forget）
  - `rerun(itemId, options)`：语义等价 createTaskFromItem（新建 task + 覆盖 agent_task_id，旧 task 历史保留）
  - `listTasksByItem(itemId)`：委托 `taskManager.listBySource('todo-app', itemId)`
  - `handleAgentTaskResult`（private，注册为 `'todo-app:agent'` source handler）：消费 `result.rawOutput` 对话 messages → generateSummary 生成 markdown → 创建 todo_document 关联到 source_ref_id → 返回 `{ summary_doc_id }`；catch 后返回 `{ handler_error }`（TaskManager 已保证 completed 状态不受影响）
  - `generateSummary`（private）：复用任务自身的 `agent_name + llm_config_name`（Q-PHASE5-1），实例化 `AiAgentService`（无工具 / 无 skill / 无 memory，单轮）→ 消费 `sendMessage` 流（不保存事件）→ 取 `getMessages()` 最后一条 assistant content 作为总结

- **TodoAppService 装配**（`todo-app.service.ts` 修改）
  - 构造函数新增**可选**第 4 参数 `taskManager?: TaskManager`：注入后实例化 TodoTaskService（构造函数末尾自动注册 source handler）
  - 未注入时 `taskService=null`，向后兼容现有 149 个 todo-app 测试（Q-PHASE5-4）
  - 新增字段 `private taskService: TodoTaskService | null`、`getTaskService()` 访问入口

- **Bootstrap 注入**（`todo-app-bootstrap.ts` 修改）
  - 调用 `getTaskManager()`，若抛错（task 系统未引导）则降级（todo-app 其他功能不受影响，仅日志告警）
  - 与现有 `bootstrapTaskSystem() → bootstrapTodoApp()` 顺序对齐（Q-PHASE5-5）

- **IPC + Preload**
  - `src/shared/ipc-channels.ts`：新增 `TODO_CREATE_TASK_FROM_ITEM` / `TODO_LIST_TASKS_BY_ITEM` 频道
  - `src/main/core/ipc/handlers/todo-app.handler.ts`：注册 2 个 handler，**仅在 `getTaskService() !== null` 时注册**（与 bootstrap 降级策略一致）
  - `src/preload/index.ts`：`window.todoApp` 新增 `createTaskFromItem` / `listTasksByItem`

- **UI**（3 个新组件 + 2 个修改）
  - `TaskRunDialog.vue`（~150 行）：480px `el-dialog`，表单含 Agent / LLM 配置 / 额外 prompt；默认值取 `window.electron.getConfig().aiAssistant.defaultAgent / defaultLlmConfig`；标题随 mode 切换「运行任务」/「重跑任务」
  - `TaskPanel.vue`（~250 行）：独立右侧视图（`rightPanelView` 状态机新增 `'task-panel'` 分支，与 document-editor 平级）；订阅 `qtian:task:event`，按 taskId 过滤累积 text_delta（`<pre>` 直接渲染，Q-PHASE5-6 不复用 ChatMessage.vue）+ tool_start/tool_result 配对区块；终态显示总结文档链接（`result_meta.summary_doc_id`）+ handler_error 提示；可展开 TaskHistoryList；顶部 [返回] + [取消]（仅 running）
  - `TaskHistoryList.vue`（~80 行）：某 todo_item 全部历史任务，按 `created_at DESC`，currentTaskId 高亮；行内 [查看总结] 直接打开 summary doc
  - `TodoItemDetail.vue`：新增 "AI 任务" 区段 —— agent_task_id 为空时显示 [运行任务]；非空时显示 [查看任务面板] + [重跑]；formData 新增 `agent_task_id` 字段
  - `TodoAppPage.vue`：集成 TaskPanel + TaskRunDialog；`rightPanelView` 状态机新增 `'task-panel'` 分支；新增 `taskDialogVisible` / `taskDialogMode` / `taskPanelTaskId` 状态；`handleTaskConfirm` 调用 `createTaskFromItem` 并切换到 task-panel 视图（含 `detailKey` 强制刷新）

- **测试**（新增 16 用例，todo-app suite 由 183 → 199）
  - `todo-task.service.test.ts`（12 用例）：
    - buildPrompt：含 `[任务上下文]` / `[当前 todo]` / `[子任务列表]`（depth=1 无缩进，depth=2 两个空格）/ `[运行时补充]` 段落
    - createTaskFromItem：item 不存在抛错 / 正常流程（createAgentTask + run + agent_task_id 更新）/ category_path 解析（多层 category 父链回溯）
    - rerun：覆盖 agent_task_id，旧 task 历史保留
    - listTasksByItem：委托 `listBySource('todo-app', itemId)`
    - handleAgentTaskResult：LLM 成功创建 todo_document / source_ref_id 为 null 返回 handler_error / LLM 抛错返回 handler_error（不抛出）
  - `todo-item.service.test.ts` 新增 `updateAgentTaskId` 4 用例：写入新值 / 覆盖 / 不存在 id 不抛错 / 已软删除不更新
  - mock 策略：`better-sqlite3` 复用 `createTodoMemDbFactory`；`AiAgentService` mock `sendMessage` 单轮；`AiAgentMgrService` / `AiConfigService` mock；TaskManager 构造 fake（参考 `task-manager.service.test.ts` createFakeExecutor 模式）

- **文档**
  - `docs/specs/100_todo-app-design.md`：§10 Phase 5 标注 "✅ 已实现（2026-06-18）" + 详细实施说明；§11 表格新增 Q-PHASE5-1 ~ Q-PHASE5-6 决策记录（总结生成 LLM 配置 / TaskPanel 位置 / agent_task_id 更新方式 / TodoAppService 向后兼容 / bootstrap 降级 / 流式渲染策略）；§12 T-2 标注"已解决"

## [Unreleased] 2026-06-18

**User**: todo-app Phase 4 回收站跨表聚合（Service + 聚合层 + IPC + UI + 测试 + 文档）

**Summary**:

落地 todo-app **Phase 4 回收站**：基于 `deleted_at` 跨 5 张业务表（category / todo_list / todo_item / document / label）聚合，提供统一的 `list-trash` / `purge-trash` / `empty-trash` IPC、`TrashDialog.vue` 跨表展示 UI、单条恢复 / 单条彻底删除 / 清空回收站三种操作；补全 `TODO_RESTORE_DOCUMENT` / `TODO_RESTORE_LABEL` 频道（原设计遗漏）。设计文档 `docs/specs/100_todo-app-design.md` §10 Phase 4 标注"已实现"。

### 新增

- **类型与聚合层**
  - `types.ts`：新增 `TodoTrashEntityType`（比 `TodoFtsEntityType` 多 `'label'`）、`TodoTrashItem`（含可选 `parent_id` / `category_id` / `todo_list_id`）、`TodoEmptyTrashResult`
  - `todo-app.service.ts`：新增聚合层 3 个方法 —— `listTrash()` 跨 5 表聚合按 `deleted_at DESC` 排序、`purgeTrash(type, id)` 按 type 路由到对应 Service.purge、`emptyTrash()` 逐条 purge 不引入跨 Service 大事务

- **业务 Service 集成**（5 个 Service 各新增 listTrash + purge）
  - `todo-category.service.ts`：`purge(id)` 依赖关系逆序物理删除 item_label → document → item → list → category；新增私有方法 `collectSubtreeIdsAll`（不过滤 `deleted_at`，用于 purge 收集已软删除子节点），与现有 `collectSubtreeIds` 并存
  - `todo-list.service.ts`：`purge(id)` 级联清理 item_label → document → item → list
  - `todo-item.service.ts`：`purge(id)` 递归物理删除子树 + 关联 document + item_label；新增 `collectSubtreeIdsAll`；`listTrash()` 返回 `label_ids: []`（软删除时已清关联）
  - `todo-document.service.ts`：`purge(id)` 无级联仅删自身
  - `todo-label.service.ts`：`purge(id)` 防御性清理 `todo_item_label` + 自身
  - **purge 幂等性**：所有 purge 方法开头校验 `deleted_at IS NOT NULL`，未删除实体 no-op（不抛错），防止误 purge 活跃数据
  - **FTS 与 purge 解耦**：软删除时已 `syncFts(type, id, null)` 清理，物理删除时 FTS 已无数据，purge 不操作 FTS

- **IPC + Preload**
  - `src/shared/ipc-channels.ts`：新增 `TODO_LIST_TRASH` / `TODO_PURGE_TRASH` / `TODO_EMPTY_TRASH` + `TODO_RESTORE_DOCUMENT` / `TODO_RESTORE_LABEL`（补全原设计遗漏）
  - `src/main/core/ipc/handlers/todo-app.handler.ts`：注册 5 个 handler，引入 `TodoTrashEntityType` 类型
  - `src/preload/index.ts`：`window.todoApp` 新增 `listTrash` / `purgeTrash` / `emptyTrash` / `restoreDocument` / `restoreLabel`

- **UI**（`TrashDialog.vue` 新增 + sidebar 入口）
  - `TrashDialog.vue`：720px `el-dialog`；按 `deleted_at DESC` 列出每行 `[类型图标] [名称 + 类型 el-tag] [删除时间] [恢复] [彻底删除]`；空状态 `el-empty`；底部 `[清空回收站]`（红色 plain，仅 items.length > 0 时显示）+ `[关闭]`
  - 类型图标：category→Folder / todo_list→Files / todo_item→Document / document→Memo / label→Collection
  - 类型标签：分类 / 列表 / 待办 / 文档 / 标签；类型 el-tag type 区分色（success / primary / warning / info / danger）
  - 二次确认：彻底删除 + 清空回收站均用 `ElMessageBox.confirm(..., { type: 'warning' })`
  - 时间格式化：直接用 `Date` + 模板字符串（避免引入 dayjs）
  - `TodoSidebar.vue`：底部新增 [回收站] 按钮（Delete 图标），`.todo-sidebar-inner` 改为 flex column + min-height:100%，footer 用 `margin-top: auto` 推到底部（设计文档 §9.3）
  - `TodoAppPage.vue`：集成 TrashDialog，新增 `handleTrashRestored` / `handleTrashChanged` 回调，按 type 刷新 categoryTree / labels

- **测试**（新增 34 用例，todo-app suite 由 149 → 183）
  - 5 个 Service 各新增 `describe('listTrash')` + `describe('purge')`：
    - listTrash：返回字段正确性、恢复后消失、未删除不出现、`deleted_at DESC` 排序
    - purge：已软删除实体的物理删除（直接查表 `db.getDBManager().get(...)` 验证行消失）、级联子项物理删除、未删除实体 purge 为 no-op、不存在的 id 为 no-op
    - 关键级联覆盖：category purge 同时清理 category 维度 + item 维度的 document；label purge 防御性清理残留关联

- **文档**
  - `docs/specs/100_todo-app-design.md`：§10 Phase 4 标注"✅ 已实现（2026-06-18）"+ 实施说明；§6.2 补充 `TODO_RESTORE_DOCUMENT` / `TODO_RESTORE_LABEL` 频道定义；§11 表格新增 Q-PHASE4-1 ~ Q-PHASE4-6 决策记录（purge 级联策略 / 聚合层位置 / TodoTrashItem 字段 / FTS 与 purge 关系 / emptyTrash 事务策略 / restore IPC 补全）

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
