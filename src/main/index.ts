/**
 * Main process entry point for Qtian application
 */

// 首先导入启动日志（在模块加载时立即执行）
import './startup-log';

import { app, protocol, BrowserWindow, ipcMain, dialog, nativeImage, screen } from 'electron';
import * as path from 'path';

import { config, wpath } from './core/common/context';
import { registerAllHandlers } from './core/ipc/handlers';
import { VERSION } from './core/common/constants';
import { createLogger, LogLevel } from './core/utils/logger';
import { registerLocalResourceProtocol } from './core/utils/local-resource-protocol';
import { TrayManager } from './core/utils/TrayManager';
import { GlobalShortcutManager } from './core/utils/GlobalShortcutManager';

const logger = createLogger('background', LogLevel.INFO);

const isDevelopment = process.env.NODE_ENV !== 'production';

// 禁用 GPU shader 磁盘缓存，避免多实例场景下的缓存锁定错误
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true } },
  { scheme: 'local-resource', privileges: { bypassCSP: true } },
]);

let mainWindow: BrowserWindow | null = null;
const trayManager = new TrayManager();
const shortcutManager = new GlobalShortcutManager();

/** 标志位：区分"关闭到托盘"和"真正退出" */
let isQuitting = false;

/**
 * Create the browser window
 */
/** 根据屏幕工作区计算普通模式窗口大小（不超过屏幕可用区域） */
function getNormalWindowSize(): { width: number; height: number } {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.min(1600, screenW - 40),
    height: Math.min(900, screenH - 40),
  };
}

async function createWindow() {
  const normalSize = getNormalWindowSize();
  // Create the browser window (frameless，由自定义标题栏控制窗口)
  mainWindow = new BrowserWindow({
    width: normalSize.width,
    height: normalSize.height,
    frame: false,
    icon: nativeImage.createFromPath(path.join(__dirname, '../../public/icon.png')),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: process.env.ELECTRON_NODE_INTEGRATION === 'true',
      contextIsolation: process.env.ELECTRON_NODE_INTEGRATION !== 'true',
    },
  });

  // Electron-vite dev server URL
  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    // DevTools disabled by default, use Ctrl+Shift+I to open manually
    if (!process.env.IS_TEST) mainWindow.webContents.openDevTools();
  } else {
    // Load the index.html when not in development
    const indexPath = path.join(__dirname, '../renderer/index.html');
    mainWindow.loadFile(indexPath);
  }

  // 拦截关闭事件：非真正退出时隐藏到托盘
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
      logger.info('Window hidden to system tray');
    }
  });
}

/**
 * Show error dialog
 */
function error(title: string, msg: string): void {
  dialog.showErrorBox(title, msg);
}

/**
 * 注册窗口控制 IPC handlers（frameless 窗口需要自定义标题栏控制）
 */
function registerWindowControlHandlers() {
  ipcMain.handle('qtian:window-minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('qtian:window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.handle('qtian:window-close', () => {
    mainWindow?.close();
  });

  ipcMain.on('qtian:window-drag', (_event, { deltaX, deltaY }: { deltaX: number; deltaY: number }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const [x, y] = mainWindow.getPosition();
      mainWindow.setPosition(x + deltaX, y + deltaY);
    }
  });

  ipcMain.handle('qtian:window-resize', (_event, { width, height, resizable }: { width: number; height: number; resizable?: boolean }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const [x, y] = mainWindow.getPosition();
      const [oldW, oldH] = mainWindow.getSize();
      mainWindow.setBounds({
        x: x + Math.round((oldW - width) / 2),
        y: y + Math.round((oldH - height) / 2),
        width,
        height,
      });
      if (resizable !== undefined) {
        mainWindow.setResizable(resizable);
        mainWindow.setMaximizable(resizable);
      }
    }
  });

  ipcMain.handle('qtian:window-is-maximized', () => {
    return mainWindow?.isMaximized() ?? false;
  });

  ipcMain.handle('qtian:window-normal-size', () => {
    return getNormalWindowSize();
  });

  // 真正退出应用（跳过"隐藏到托盘"逻辑）
  ipcMain.handle('qtian:app-quit', () => {
    isQuitting = true;
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
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 标记真正退出，避免 close 事件拦截；同时注销全局快捷键
app.on('before-quit', () => {
  isQuitting = true;
  shortcutManager.unregister();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('ready', async () => {
  logger.info(`Qtian v${VERSION} starting...`);

  registerLocalResourceProtocol(protocol);
  registerAllHandlers();
  registerWindowControlHandlers();

  if (isDevelopment && !process.env.IS_TEST) {
    logger.info('Development mode - Vue Devtools available');
  }

  readConfig();
  await createWindow();

  // 创建系统托盘（需要 mainWindow 已创建）
  if (mainWindow) {
    trayManager.create(mainWindow);
    shortcutManager.register(mainWindow);
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
