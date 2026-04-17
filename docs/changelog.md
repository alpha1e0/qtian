# Changelog

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
