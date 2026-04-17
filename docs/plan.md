# 开发计划：系统托盘最小化

## 任务

实现点击窗口右上角"关闭"按钮时，应用不退出，而是最小化到系统托盘。托盘图标右键菜单包含"显示主窗口"和"退出"选项。

## 受影响的文档

- `docs/specs/001_index.md` — 新增公共模块说明（可选）
- `docs/plan.md` — 本文件

## 需求分析

### 当前状态

- `src/main/index.ts` 中 `window-all-closed` 事件直接调用 `app.quit()`
- 无系统托盘（Tray）功能
- 无窗口 close 事件拦截
- 项目无自定义图标资源（仅有 `public/favicon.ico`）

### 目标状态

1. 点击窗口"关闭"按钮 → 隐藏窗口（不退出）
2. 系统托盘显示应用图标
3. 托盘右键菜单：显示主窗口 / 退出
4. 托盘双击：显示主窗口
5. 点击"退出"才真正退出应用

## 设计方案

### 新增模块：TrayManager

**文件**: `src/main/core/utils/TrayManager.ts`

独立模块，封装托盘图标的创建、菜单管理、与主窗口的联动逻辑。

```typescript
class TrayManager {
  private tray: Tray | null;
  private mainWindow: BrowserWindow;

  create(mainWindow: BrowserWindow): void    // 创建托盘图标+菜单
  destroy(): void                             // 销毁托盘
  updateTooltip(tooltip: string): void        // 更新提示文字
}
```

**职责**：
- 创建系统托盘图标
- 构建右键上下文菜单（显示窗口、退出）
- 双击托盘图标显示主窗口
- 管理托盘生命周期

### 修改：src/main/index.ts

改动点：

1. **导入 TrayManager**，在 `app.on('ready')` 中 `createWindow()` 之后创建托盘
2. **拦截窗口 close 事件**：`mainWindow.on('close', ...)` 中 `event.preventDefault()` + `mainWindow.hide()`
3. **修改 `window-all-closed`**：移除自动 `app.quit()`，仅保留 macOS 行为
4. **引入 `isQuitting` 标志位**：在 `before-quit` 事件中设为 `true`，close 事件中检查此标志，确保真正退出时不会被拦截

### 托盘图标资源

使用 `public/favicon.ico` 作为托盘图标。如需适配不同平台（macOS 需要 .png 模板图标），可后续扩展。

### 关键流程

```
用户点击"关闭" → close 事件触发
  → isQuitting? 否 → event.preventDefault() + mainWindow.hide()
  → isQuitting? 是 → 正常关闭

托盘右键 → 弹出菜单
  → "显示主窗口" → mainWindow.show() + mainWindow.focus()
  → "退出" → app.quit() → before-quit(isQuitting=true) → 窗口正常关闭 → 退出

托盘双击 → mainWindow.show() + mainWindow.focus()
```

## 分步清单

- [ ] 步骤 1：新建 `src/main/core/utils/TrayManager.ts`，实现 TrayManager 类
- [ ] 步骤 2：新建 `src/main/core/utils/TrayManager.test.ts`，编写单元测试
- [ ] 步骤 3：修改 `src/main/index.ts`，集成 TrayManager，拦截 close 事件，添加退出标志位
- [ ] 步骤 4：运行单元测试，确认通过
- [ ] 步骤 5：手动验证（关闭按钮→托盘→右键菜单→退出）

## 当前障碍

- 无
