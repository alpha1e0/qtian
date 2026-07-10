/**
 * Main process entry point for Qtian application
 *
 * 多窗口架构：主窗口（普通模式）+ 快捷窗口（独立 BrowserWindow）。
 * WindowManager 集中管理窗口生命周期与跨窗口导航中转。
 */

// 首先导入启动日志（在模块加载时立即执行）
import './startup-log';

import { app, protocol, BrowserWindow, ipcMain, dialog } from 'electron';

import { config, wpath } from './core/common/context';
import { registerAllHandlers } from './core/ipc/handlers';
import { bootstrapTaskSystem } from './core/services/task/task-bootstrap';
import { bootstrapTodoApp } from './core/services/app-modules/todo-app/todo-app-bootstrap';
import { bootstrapNoteApp } from './core/services/app-modules/note-app/note-app-bootstrap';
import { bootstrapSync } from './core/services/sync/sync-bootstrap';
import { VERSION } from './core/common/constants';
import { createLogger, LogLevel } from './core/utils/logger';
import { registerLocalResourceProtocol } from './core/utils/local-resource-protocol';
import { TrayManager } from './core/utils/TrayManager';
import { GlobalShortcutManager } from './core/utils/GlobalShortcutManager';
import { WindowManager, getNormalWindowSize } from './core/utils/WindowManager';

const logger = createLogger('background', LogLevel.INFO);

const isDevelopment = process.env.NODE_ENV !== 'production';

// 禁用 GPU shader 磁盘缓存，避免多实例场景下的缓存锁定错误
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true } },
  { scheme: 'local-resource', privileges: { bypassCSP: true } },
]);

/** 多窗口管理器（替代原全局 mainWindow 变量） */
const windowManager = new WindowManager();
const trayManager = new TrayManager();
const shortcutManager = new GlobalShortcutManager();

/**
 * Show error dialog
 */
function error(title: string, msg: string): void {
  dialog.showErrorBox(title, msg);
}

/**
 * 注册窗口控制 IPC handlers（frameless 窗口需要自定义标题栏控制）
 *
 * 多窗口架构下，所有窗口控制类 IPC 改用 `BrowserWindow.fromWebContents(event.sender)`
 * 定位调用方窗口，不再依赖全局 mainWindow 引用。
 *
 * @param wm - WindowManager 实例（用于快捷窗口控制 IPC）
 */
function registerWindowControlHandlers(wm: WindowManager) {
  ipcMain.handle('qtian:window-minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle('qtian:window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.handle('qtian:window-close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.on('qtian:window-drag', (event, { deltaX, deltaY }: { deltaX: number; deltaY: number }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      const [x, y] = win.getPosition();
      win.setPosition(x + deltaX, y + deltaY);
    }
  });

  ipcMain.handle(
    'qtian:window-resize',
    (event, { width, height, resizable }: { width: number; height: number; resizable?: boolean }) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) {
        const [x, y] = win.getPosition();
        const [oldW, oldH] = win.getSize();
        win.setBounds({
          x: x + Math.round((oldW - width) / 2),
          y: y + Math.round((oldH - height) / 2),
          width,
          height,
        });
        if (resizable !== undefined) {
          win.setResizable(resizable);
          win.setMaximizable(resizable);
        }
      }
    }
  );

  ipcMain.handle('qtian:window-is-maximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.isMaximized() ?? false;
  });

  ipcMain.handle('qtian:window-normal-size', () => {
    return getNormalWindowSize();
  });

  // 真正退出应用（跳过"隐藏到托盘"逻辑）
  ipcMain.handle('qtian:app-quit', () => {
    wm.setQuitting(true);
    app.quit();
  });

  // 显示关于对话框
  ipcMain.handle('qtian:show-about', () => {
    dialog.showMessageBoxSync({
      type: 'info',
      buttons: ['OK'],
      defaultId: 0,
      title: '关于',
      message: `Qtian AI助手 v${VERSION}`,
    });
  });

  // === 快捷窗口控制 IPC（多窗口架构新增） ===

  /**
   * 打开/显示快捷窗口（不存在则创建）。
   * open 与 show 语义等价，提供两套别名便于渲染进程语义化调用。
   */
  ipcMain.handle('qtian:quick-window-open', async () => {
    await wm.showQuickWindow();
  });
  ipcMain.handle('qtian:quick-window-show', async () => {
    await wm.showQuickWindow();
  });

  /** 隐藏快捷窗口 */
  ipcMain.handle('qtian:quick-window-hide', () => {
    wm.hideQuickWindow();
  });

  /** 切换快捷窗口可见性（Ctrl+Q 同款行为） */
  ipcMain.handle('qtian:quick-window-toggle', async () => {
    await wm.toggleQuickWindow();
  });

  /**
   * 跨窗口导航：快捷窗口 → 主进程 → 主窗口
   *
   * payload 结构：{ message?, agentId?, llmConfig?, historyId? }
   */
  ipcMain.handle('qtian:quick-to-normal-navigate', (_event, payload: unknown) => {
    wm.forwardNavigateToMain(payload);
  });
}

/**
 * Read configuration file
 */
async function readConfig(): Promise<void> {
  // Use unified config path from wpath: {workspace}/qtian.json
  const configPath = wpath.configPath;

  try {
    await config.initConfig(configPath);
    logger.info('Config loaded successfully');
  } catch (err) {
    logger.error('Failed to load qtian.json', err);
    error('错误', '读取qtian.json配置文件失败，将使用默认配置加载！😂');
  }
}

// Quit when all windows are closed (macOS 标准行为保留)
// 多窗口下：快捷窗口 close 被拦截为 hide，主窗口 close 被拦截为 hide，
// 正常使用不会触发；仅在真正退出（destroyAll）后所有窗口销毁时触发。
app.on('window-all-closed', () => {
  if (BrowserWindow.getAllWindows().length === 0 && process.platform !== 'darwin') {
    app.quit();
  }
});

// 标记真正退出，销毁所有窗口；同时注销全局快捷键
app.on('before-quit', () => {
  windowManager.destroyAll();
  shortcutManager.unregister();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    windowManager.createMainWindow();
  }
});

app.on('ready', async () => {
  logger.info(`Qtian v${VERSION} starting...`);

  registerLocalResourceProtocol(protocol);
  registerAllHandlers();
  registerWindowControlHandlers(windowManager);

  // 先读取配置（todo-app 等模块依赖 config.todoApp）
  await readConfig();

  // 引导任务系统（建表 + 崩溃恢复 + 注册执行器 + IPC handlers）
  try {
    bootstrapTaskSystem();
  } catch (err) {
    logger.error('Failed to bootstrap task system', err);
  }

  // 引导 todo-app 模块（建表 + 装配 Service + 注册 IPC handlers）
  try {
    bootstrapTodoApp();
  } catch (err) {
    logger.error('Failed to bootstrap todo app', err);
  }

  // 引导 note-app 模块（建表 + 装配 Service + 注册 IPC handlers）
  try {
    bootstrapNoteApp();
  } catch (err) {
    logger.error('Failed to bootstrap note app', err);
  }

  // 引导数据同步模块（WebDAV，依赖 todo/note 的 DBManager）
  // 失败不阻断启动（同步功能可在下次启动时再次装配）
  try {
    bootstrapSync();
  } catch (err) {
    logger.error('Failed to bootstrap sync service', err);
  }

  if (isDevelopment && !process.env.IS_TEST) {
    logger.info('Development mode - Vue Devtools available');
  }

  await windowManager.createMainWindow();

  // 创建系统托盘 + 注册全局快捷键（需要 mainWindow 已创建）
  const mainWindow = windowManager.getMainWindow();
  if (mainWindow) {
    trayManager.create(mainWindow, {
      onShowQuickMode: () => windowManager.showQuickWindow(),
    });
    shortcutManager.register(windowManager);
  }
});

if (isDevelopment) {
  if (process.platform === 'win32') {
    process.on('message', (data: string) => {
      if (data === 'graceful-exit') {
        app.quit();
      }
    });
  } else {
    process.on('SIGTERM', () => {
      app.quit();
    });
  }
}
