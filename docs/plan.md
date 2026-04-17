# 开发计划：快捷模式（Quick Mode）

## 任务

在现有 Homepage 基础上改造实现快捷模式，用户打开应用默认进入快捷模式。

## 受影响的文档

- `docs/plan.md` — 本文件
- `docs/changelog.md` — 变更日志

## 需求分析

### 参考文档
- `docs/specs/003_quick-mode.md` — 快捷模式需求定义

### 核心需求
1. **初始状态**：仅包含输入框（textarea + Agent 选择 + 模型选择 + 发送按钮），无侧边栏、无菜单
2. **回答状态**：用户问题只读展示 + 分隔线 + AI 回答（Markdown） + "完整对话"按钮
3. **`Ctrl+Q` 全局快捷键**：后台/托盘时唤起窗口；前台时切换为快捷模式
4. **对话不保存**：快捷模式对话为临时性的，不持久化到 history 文件
5. **可转换为普通模式**：点击"完整对话"按钮，将当前消息转为普通模式对话

### 后端接口
快捷模式与普通模式后端接口完全一致，不需要后端改动。快捷模式使用临时 historyId（如 `__quick__`），不调用 `createHistory`/`saveHistory`。

## 设计方案

### 1. 文件变更总览

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/renderer/src/components/homepage/` | **重命名目录** → `quick-mode/` | |
| `src/renderer/src/components/quick-mode/QuickModePage.vue` | **新建**（替代 Homepage.vue） | 快捷模式页面 |
| `src/renderer/src/components/MainComponent.vue` | **修改** | 默认组件改为 QuickModePage，处理 Ctrl+Q |
| `src/main/index.ts` | **修改** | 注册全局快捷键 Ctrl+Q |
| `src/main/core/utils/GlobalShortcutManager.ts` | **新建** | 全局快捷键管理模块 |
| `src/main/core/utils/GlobalShortcutManager.test.ts` | **新建** | 单元测试 |

### 2. QuickModePage.vue 设计

**两种页面状态**：

```
状态机：initial ←→ answering

initial:     [Textarea + Agent/模型选择 + 发送按钮]
                 ↓ 用户点击发送
answering:   [用户问题（只读）]
             [─────────分隔线─────────]
             [AI 回答（Markdown 渲染）]
             [                    完整对话 →]
                 ↓ 点击"完整对话"
             转换为普通模式
```

**核心逻辑**：
- `initial` 状态：居中布局，仅显示输入区域，类似现有 Homepage
- `answering` 状态：上方只读展示用户问题，分隔线后展示 AI 回答流式输出
- 发送消息时调用 `initChat` + `chatMessage`，监听 `chat-chunk`/`chat-complete`/`chat-error` 事件
- "完整对话"按钮：创建真实 history，将当前消息写入，导航到 AiAssistantPage
- 从其他页面切回时重置为 `initial` 状态

**Props 传递**（从 MainComponent）：
- `initialMessage`：从普通模式返回时无初始消息
- 无需 `initialAgentId`/`initialLlmConfig`，快捷模式自行管理

### 3. MainComponent.vue 修改

```diff
- import Homepage from './homepage/Homepage.vue';
+ import QuickModePage from './quick-mode/QuickModePage.vue';

  components: {
-   Homepage,
+   QuickModePage,
    AiAssistantPage,
  },

  data() {
    return {
-     currentComponent: 'Homepage',
+     currentComponent: 'QuickModePage',
    };
  },
```

- 新增 `switchToQuickMode()` 方法
- 新增 IPC 监听 `switch-to-quick-mode`（主进程全局快捷键触发）
- 快捷键 `Ctrl+Alt+H` → `Ctrl+Q`（或保留，视需求）
- `handleNavigate` 新增 `quick-mode` 目标

### 4. 全局快捷键 Ctrl+Q

**GlobalShortcutManager.ts**：
```typescript
class GlobalShortcutManager {
  register(mainWindow: BrowserWindow): void  // 注册 Ctrl+Q
  unregister(): void                          // 注销快捷键
}
```

**行为**：
- 窗口隐藏/最小化 → `mainWindow.show()` + `mainWindow.focus()`
- 窗口可见 → 发送 IPC `switch-to-quick-mode` 到渲染进程

**生命周期**：
- `app.on('ready')` 中创建
- `app.on('will-quit')` 中注销

### 5. 转换为普通模式流程

```
QuickModePage                          AiAssistantPage
  │                                        │
  ├─ 用户点击"完整对话"                     │
  ├─ createHistory(agentId, historyId)  ──→│ 创建持久化历史
  ├─ saveHistory(agentId, historyId,    ──→│ 写入消息
  │   { messages: [...] })                 │
  ├─ emit('navigate', 'ai-assistant',      │
  │   { agentId, historyId }) ─────────────→│ 接收导航
  └─ 重置为 initial 状态                    │
```

## 分步清单

- [ ] 步骤 1：新建 `GlobalShortcutManager.ts` + 单元测试
- [ ] 步骤 2：修改 `src/main/index.ts`，注册全局快捷键 Ctrl+Q
- [ ] 步骤 3：重命名 `homepage/` → `quick-mode/`，新建 `QuickModePage.vue`
- [ ] 步骤 4：修改 `MainComponent.vue`，集成 QuickModePage
- [ ] 步骤 5：运行单元测试，手动验证
- [ ] 步骤 6：更新 `docs/changelog.md`

## 当前障碍

- 无
