## About

快捷模式用于*一次性*、*临时性*的对话

快捷模式和普通模式，后端接口完全一致，仅交互不同

## UI交互

通过 `ctrl+q` 快捷键唤起**独立快捷窗口**：

- 快捷窗口不存在或已隐藏 → 创建/显示并聚焦快捷窗口（始终置顶）
- 快捷窗口当前可见 → 隐藏快捷窗口

快捷模式页面分为两种状态：

1. **初始状态**，仅包含输入框，布局如下:

```xml
<ChatInput>
	<FullScreenIconButton onhover="切换到完整对话模式" (top-right)>
	</FullScreenIconButton>
	<TextArea>
	<TextArea>
	<Row>
		<ItemLeft>
			<OperationList (flex-start)>
				<Select>
					场景选择下拉列表
				</Select>
				<Select>
					模型选择下拉列表
				</Select>
			</OperationList>
		</ItemLeft>
		<ItemRight>
			<IconButton>
				提交
			</IconButton>
		</ItemRight>
	</Row>
</ChatInput>
```

2. **回答后状态**，布局如下：

```xml
<FullScreenIconButton onhover="切换到完整对话模式" (top-right)>
</FullScreenIconButton>
<LineSpliter/>
<Card>
	[用户输入的问题]
</Card>
<BubbldBody (block)>
    markdown展示（使用markdown-it库）
</BubbldBody>
<IconButtonRow (bottom-right)>
	<RefreshIconButton (bottom-right) onhover="重新生成" onclick="重新生成">
	</RefreshIconButton>
	<PlusIconButton (bottom-right) onhover="创建新对话" onclick="创建新对话">
	</PlusIconButton>
</IconButtonRow>
```

## 独立窗口架构

快捷模式与普通模式分别运行在**独立的 `BrowserWindow`** 中，二者共存、状态隔离，避免在单窗口内切换导致的窗口尺寸重置和状态纠缠问题。

### 启动行为

- 启动应用 → **仅创建主窗口**，默认显示普通模式（AiAssistantPage）
- 快捷窗口为**按需创建**：通过 Ctrl+Q 或主窗口菜单"功能→快捷模式"首次唤起时创建，之后复用

### 快捷窗口属性

| 属性 | 值 | 说明 |
| :--- | :--- | :--- |
| `frame` | `false` | 无系统边框，由自定义 QuickTitleBar 控制 |
| `alwaysOnTop` | `true` | 始终置顶，符合"临时唤起"语义 |
| `skipTaskbar` | `true` | 不在任务栏显示图标 |
| `resizable` | `true` | 允许用户调整大小 |

### 快捷窗口 TitleBar 布局

合并原 `QuickModePage` 中的 `section-header`，使用独立 `QuickTitleBar.vue`：

```xml
<QuickTitleBar (32px, -webkit-app-region: drag)>
	<Icon>                  <!-- 应用图标 -->
	<AgentName>             <!-- currentAgentName，由 QuickModePage 上报 -->
	<Buttons (no-drag)>
		<FullScreenButton>  <!-- 切换到完整对话模式 -->
		<CloseButton>       <!-- 关闭（主进程拦截为 hide） -->
	</Buttons>
</QuickTitleBar>
```

### 跨窗口导航流程

快捷窗口"切换到完整对话模式"时，渲染进程不能直接操作主窗口，需经主进程中转：

```text
QuickModePage (快捷窗口)
   │ $emit('navigate', 'ai-assistant', payload)
   ▼
QuickModeWindow
   │ window.electron.navigateToNormalMode(payload)
   ▼ ipcRenderer.invoke('qtian:quick-to-normal-navigate', payload)
[Main Process] WindowManager.forwardNavigateToMain(payload)
   │ mainWindow.webContents.send('qtian:quick-to-normal-navigate', payload)
   │ mainWindow.show() + mainWindow.focus()
   │ quickWindow.hide()
   ▼
MainComponent (主窗口) 监听 'qtian:quick-to-normal-navigate'
   │ 设置 pendingMessage/pendingAgentId/...
   │ currentComponent = 'AiAssistantPage'
   ▼
AiAssistantPage 接收并加载对话
```

### URL 路由

单一 HTML 入口 + URL 参数区分窗口类型（无需修改 electron-vite 构建配置）：

- 主窗口：`http://localhost:5173/`（dev）或 `index.html`（prod）
- 快捷窗口：`http://localhost:5173/?window=quick`（dev）或 `index.html?window=quick`（prod）

`App.vue` 在 `mounted` 时读取 `new URLSearchParams(window.location.search).get('window')`，结果为 `'quick'` 时挂载 `QuickModeWindow`，否则挂载 `MainComponent`。`QuickModeWindow` 异步加载以降低主窗口首屏开销。

### 关闭语义

| 操作 | 行为 |
| :--- | :--- |
| 快捷窗口关闭按钮 | `close` 事件被 `preventDefault`，仅 `hide()`，保留对话状态 |
| 主窗口关闭按钮 | `close` 事件被 `preventDefault`，`hide()` 到系统托盘 |
| 托盘"退出" / `qtian:app-quit` | 设置 `isQuitting=true`，`app.quit()` 销毁所有窗口 |
