# Changelog

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
