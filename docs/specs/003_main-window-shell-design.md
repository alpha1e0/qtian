# 主窗口外壳设计（TitleBar + SideBar 重构）

> 类型：UI 设计文档（纯渲染层重构）
> 关联：[`002_ai-assistant-design.md`](./002_ai-assistant-design.md)、[`003_quick-mode-ui-design.md`](./003_quick-mode-ui-design.md)
> 落地版本：跟随 commit `55dd8ed`（快捷模式独立窗口架构）之后

---

## 1. 背景与目标

### 1.1 现状问题

- `MainComponent.vue` 外壳是「下拉菜单标题栏 + 内容区」的**纵向**结构。
- `TitleBar.vue` 内嵌三个 `el-dropdown`（功能 / 应用 / 帮助），视觉偏传统桌面应用风格，与项目已确立的「Aurora Library」温润纸张 + 靛蓝品牌色基调不协调。
- 快捷模式已抽离为独立 `BrowserWindow`（commit `55dd8ed`），主窗口内仍残留「切换到完整对话模式」语义混淆的入口。

### 1.2 目标

将主窗口外壳升级为类似 Obsidian 的现代布局：

- 左侧 48px 紧凑图标侧栏承载品牌图标 + 模式切换
- 标题栏仅保留动态功能名 + 标准窗口控制按钮（品牌图标已迁至 SideBar 顶部）

### 1.3 改动边界

- **纯渲染层 UI 重构**，不动主进程（`src/main`）与 preload 接口。
- 主窗口**移除**「切换到完整对话模式」按钮（主窗口本身即完整对话）。
- 侧栏「快捷模式」按钮 → 唤起独立快捷窗口（保持现有架构）。
- 原「关于 / 退出」菜单项暂时移除，后续随设置面板补回。

---

## 2. 整体布局

### 2.1 结构图

```
┌──────┬──────────────────────────────────────────┐
│ [ico]│  AI 助手                    [─][□][×]    │  TitleBar (32px)
│      ├──────────────────────────────────────────┤
│ Side │                                          │
│ Bar  │                                          │
│ 48px │   主内容区（AiAssistantPage / TodoAppPage）│
│      │                                          │
│ ┌─┐  │                                          │
│ │ │← │                                          │
│ └─┘  │                                          │
│      │                                          │
│ ┌─┐  │                                          │
│ │ │  │                                          │
│ └─┘  │                                          │
│      │                                          │
│ ┌─┐  │                                          │
│ │ │  │                                          │
│ └─┘  │                                          │
│      │                                          │
│   ⚙  │                                          │
│   ⏻  │                                          │
└──────┴──────────────────────────────────────────┘
```

### 2.2 尺寸规范

| 区域 | 宽 / 高 | 说明 |
|---|---|---|
| SideBar | 48px × 100vh | 紧凑图标列：顶部品牌图标 + 3 个动作图标，底部 2 个动作图标（设置 + 退出） |
| TitleBar | 100% × 32px | 动态功能名 + 最小化 / 最大化 / 关闭（品牌图标位于 SideBar 顶部） |
| 主内容区 | flex:1 | AiAssistantPage 或 TodoAppPage |

### 2.3 设计令牌引用

所有颜色、圆角、间距统一使用 `App.vue` 中定义的 CSS 变量：

- 背景：`var(--surface-dark-secondary)`
- 悬停背景：`var(--surface-dark-hover)`
- 主品牌色：`var(--accent)`（#6366f1）
- 品牌色软背景：`var(--accent-soft)`
- 文字（激活）：`var(--accent)`
- 文字（默认）：`var(--text-on-dark-muted)`
- 边框：`var(--border-light)`
- 圆角：`var(--radius-md)`

---

## 3. 组件设计

### 3.1 SideBar.vue（新建）

**职责**：纯展示组件，仅 `emit('select', key)`，不直接调 IPC；IPC 调用集中在 MainComponent。

#### 接口

```js
props: {
  // 当前主窗口激活模式，决定哪个按钮高亮
  // 取值：'ai-assistant' | 'todo-app'
  // 'quick-mode' / 'settings' 永不激活（瞬时动作型）
  activeMode: {
    type: String,
    required: true,
    validator: (v) => ['ai-assistant', 'todo-app'].includes(v),
  },
}
emits: ['select']  // emit('select', key)，key ∈ {'ai-assistant','quick-mode','todo-app','settings','quit'}
```

#### 按钮数据

| key | 图标 | 文案 | aria-label | 是否可激活 |
|---|---|---|---|---|
| `ai-assistant` | `ChatDotRound` | AI 助手 | 切换到 AI 助手 | ✓ |
| `quick-mode` | `ChatRound` | 快捷模式 | 唤起快捷模式窗口 | ✗（瞬时动作） |
| `todo-app` | `Memo` | 待办 | 切换到待办应用 | ✓ |
| `settings`（底部） | `Setting` | 设置 | 打开设置 | ✗（瞬时动作） |
| `quit`（底部） | `SwitchButton` | 退出 | 退出应用 | ✗（瞬时动作） |

图标采用**局部 import**（与项目主流 `TodoSearchBar.vue` / `ChatSidebar.vue` 等一致），不用全局注册。

#### 激活态规则

```js
isActive(item) { return item.key === this.activeMode; }
```

`activeMode` 只能是 `'ai-assistant'` 或 `'todo-app'`，因此 `quick-mode` / `settings` 天然不会高亮。**不**在 SideBar 内部维护 `localActive`，单一数据源由 MainComponent 计算。

#### 视觉规范

- 容器：宽 48px，`flex-direction: column; justify-content: space-between`，背景 `var(--surface-dark-secondary)`，右边界 `1px solid var(--border-light)`
- **品牌图标**（顶部首个元素）：24×24、`margin-bottom: 8px` 与首个按钮分隔，纯展示（无 hover / 无激活态），与按钮组在 `.sidebar-top` 中作为 flex 首项
- 按钮：40×40、圆角 `var(--radius-md)`、默认 `color: var(--text-on-dark-muted)`
- hover：`background: var(--surface-dark-hover); color: var(--text-on-dark-secondary)`
- **激活指示器**：`is-active` class + `::before` 伪元素（左侧 3px 竖条，`background: var(--accent)`）+ 文字 `color: var(--accent)` + 背景 `var(--accent-soft)`
- 整个 `<aside>` 设 `-webkit-app-region: no-drag`（侧栏不参与拖窗）

### 3.2 TitleBar.vue（修改）

#### 删除项

- `menus` 常量与 `<div class="titlebar-menus">` 整块模板
- `handleCommand` 方法
- `emits: ['switch-mode']` 声明
- CSS `.titlebar-menus / .menu-item / .menu-separator`
- 对 `window.electron.appQuit` / `showAbout` 的调用（接口在 preload 保留，仅不调用）

#### 新增项

```js
props: {
  title: { type: String, default: 'AI 助手' }, // 动态功能名
}
```

模板在图标后追加 `<span class="titlebar-title" :title="title">{{ title }}</span>`，**复用**现有 CSS `.titlebar-title`。

#### 保留项（不动）

- `<div class="titlebar-controls">`（最小化 / 最大化 / 关闭三按钮）
- `isMaximized` + `onMaximizeStateChanged` + IPC 监听 `window-maximize-state-changed`
- `handleMinimize / Maximize / Close`
- `-webkit-app-region: drag` + 按钮区 `no-drag`
- `.custom-titlebar` 容器样式（32px 高、背景、border-bottom）

> 品牌图标（`titlebar-icon`）已迁至 SideBar 顶部，TitleBar 不再持有 `iconUrl`。

### 3.3 MainComponent.vue（修改）

#### 模板结构（外层纵向 → 外层水平 + 内层纵向）

```
<div class="main-layout">                      ← flex-direction: row
  <SideBar :active-mode="activeMode"
           @select="handleSidebarSelect" />
  <div class="main-pane">                      ← flex-direction: column, flex: 1, min-width: 0
    <CustomTitleBar :title="titleBarTitle" />  ← 去掉 @switch-mode 绑定
    <component :is="currentComponent" ... />
  </div>
</div>
```

> **关键 CSS 坑**：`.main-pane` 必须 `min-width: 0`，否则 AiAssistantPage 内横向元素会撑爆 flex 父级把 SideBar 挤变形。

#### imports 清理

- 新增：`import SideBar from './common/SideBar.vue'`
- **删除**：`import QuickModePage from './quick-mode/QuickModePage.vue'`（已是死代码，快捷模式迁独立窗口后未再使用；同步从 `components` 注册表中删除）

#### 新增 computed

```js
activeMode() {
  return this.currentComponent === 'TodoAppPage' ? 'todo-app' : 'ai-assistant';
},
titleBarTitle() {
  return this.currentComponent === 'TodoAppPage' ? '待办' : 'AI 助手';
}
```

#### 统一入口方法

```js
// 替代原 handleSwitchMode + TitleBar 的 handleCommand，统一入口
handleSidebarSelect(key) {
  switch (key) {
    case 'ai-assistant': this.clearPending(); this.currentComponent = 'AiAssistantPage'; break;
    case 'todo-app':     this.currentComponent = 'TodoAppPage'; break;
    case 'quick-mode':   this.openQuickWindow(); break;
    case 'settings':     this.openSettings(); break;
  }
}
```

`handleKeyDown`（Ctrl+Alt+A）改为调用 `this.handleSidebarSelect('ai-assistant')`，统一入口。

#### 保留项（不动）

- `data` 字段（`currentComponent`、`pending*`）
- `initial*` computed
- `handleNavigate` / `handleQuickToNormalNavigate` / `clearPending`
- mounted / unmounted 的 `qtian:quick-to-normal-navigate` IPC 监听

---

## 4. 交互流程

### 4.1 切换到 AI 助手

1. 用户点击 SideBar 顶部第 1 个按钮
2. SideBar `emit('select', 'ai-assistant')`
3. MainComponent.handleSidebarSelect('ai-assistant') → 清空 pending*、`currentComponent = 'AiAssistantPage'`
4. `activeMode` computed 重算为 `'ai-assistant'`，SideBar 该按钮 `is-active` 高亮
5. `titleBarTitle` 重算为 `'AI 助手'`，TitleBar 标题更新

### 4.2 切换到待办

1. 用户点击 SideBar 第 3 个按钮
2. SideBar `emit('select', 'todo-app')`
3. MainComponent `currentComponent = 'TodoAppPage'`
4. 激活态转移到第 3 个按钮，标题变为「待办」

### 4.3 唤起快捷模式

1. 用户点击 SideBar 第 2 个按钮（永不持续激活）
2. SideBar `emit('select', 'quick-mode')`
3. MainComponent 调用 `window.electron.openQuickWindow()`
4. 独立快捷窗口弹出，主窗口内容**不变**、SideBar 激活态**不变**

### 4.4 打开设置

1. 用户点击 SideBar 底部设置按钮（永不持续激活）
2. SideBar `emit('select', 'settings')`
3. MainComponent `openSettings()`（当前占位：`console.info('设置面板尚未实现')`，后续随设置面板实现补全）
4. 无激活态变化

### 4.5 退出应用

1. 用户点击 SideBar 底部「退出」按钮（永不持续激活）
2. SideBar `emit('select', 'quit')`
3. MainComponent 调用 `window.electron.appQuit()`
4. 主进程经 `qtian:app-quit` IPC 退出应用

### 4.6 Ctrl+Alt+A 快捷键回切

1. 用户在待办模式下按 `Ctrl+Alt+A`
2. MainComponent.handleKeyDown → 调用 `this.handleSidebarSelect('ai-assistant')`
3. 走 4.1 同样的路径

### 4.7 跨窗口导航（快捷窗口 → 主窗口）

1. 快捷窗口「切换到完整对话模式」→ 经主进程中转 → 主窗口收到 `qtian:quick-to-normal-navigate` 事件
2. MainComponent.handleQuickToNormalNavigate 设置 pending* + `currentComponent = 'AiAssistantPage'`
3. 渲染层响应：SideBar 第 1 个按钮激活、TitleBar 标题更新

---

## 5. 可访问性

每个 SideBar 按钮必须同时携带：

- `:aria-label`：屏幕阅读器朗读
- `:title`：鼠标悬停 tooltip

示例：

```html
<button :aria-label="item.aria" :title="item.aria" ...>
```

TitleBar 现有的「最小化 / 最大化 / 关闭」按钮已具备 `aria-label` + `title`，保持不动。

---

## 6. 最大化按钮的平台化行为（2026-08 修订）

### 6.1 问题

frameless 主窗口的自定义「最大化」按钮在 macOS 上不符合平台预期：

- macOS 用户预期最大化 = 原生绿键行为，即**进入全屏并切换到新的桌面空间**；
- 旧实现统一走 `win.maximize()`（铺满工作区），在小屏 Mac 上普通尺寸（`workArea - 40px`）
  与最大化尺寸仅差约 40px，视觉上几乎无变化，用户感知为「点了没反应」；
- 主进程从不发送 `window-maximize-state-changed`，TitleBar 图标状态只能靠点击后回查，
  存在竞态（如窗口被 macOS 窗口还原置为 maximized 时，首次点击实际执行的是还原）。

### 6.2 方案

「最大化」按钮语义按平台区分，统一抽象为**展开态（expanded）**切换：

| 平台 | 点击「最大化」 | 展开态判定 |
|---|---|---|
| macOS | `setFullScreen` 进入/退出全屏（同原生绿键，切换到新空间） | `isFullScreen()` |
| Windows / Linux | `maximize()` / `unmaximize()`（铺满/还原工作区） | `isMaximized()` |

实现要点：

1. `WindowManager.ts` 新增 `toggleWindowExpandState(win)`（平台分支）与
   `isWindowExpanded(win)`（展开态判定），供 IPC 层复用并保证可单测；
2. 主进程在窗口 `maximize / unmaximize / enter-full-screen / leave-full-screen`
   事件时主动推送 `window-maximize-state-changed`（payload 为展开态布尔值），
   TitleBar 图标不再依赖点击后回查；
3. preload 新增 `isFullScreen()`；TitleBar 初始化与点击回查均以
   `isMaximized() || isFullScreen()` 作为展开态。

## 7. 已知限制与后续工作

| 项 | 说明 | 优先级 |
|---|---|---|
| 主窗口 `minWidth: 720` | `WindowManager.ts` 主进程小改动，避免缩放过小撑破布局 | P1 |
| e2e 冒烟补强 | `tests/e2e/smoke/main-window-shell.spec.ts`，aria-label 切换断言 | P1 |
| 设置面板实现 | 当前 `openSettings` 仅占位，后续随面板补全 | P1 |
| 「关于」补回 | 随设置面板复用既有 `window.electron.showAbout()`（退出已迁至 SideBar 底部） | P1 |
| SideBar 折叠态 | 当前为固定 48px，未来可支持折叠 | P2 |
| SideBar 单元测试 | 本次纯渲染层改动按 CLAUDE.md 不强制，后续可补 Vue Test Utils | P2 |
