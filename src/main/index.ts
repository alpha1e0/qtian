/**
 * Main process entry point for Qtian application
 */

// 首先导入启动日志（在模块加载时立即执行）
import './startup-log';

import { app, protocol, BrowserWindow, Menu, dialog } from 'electron';
import * as path from 'path';

import { config, wpath } from './core/common/context';
import { registerAllHandlers } from './core/ipc/handlers';
import { VERSION } from './core/common/constants';
import { createLogger, LogLevel } from './core/utils/logger';
import { registerLocalResourceProtocol } from './core/utils/local-resource-protocol';

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

/**
 * Create the browser window
 */
async function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: process.env.ELECTRON_NODE_INTEGRATION === 'true',
      contextIsolation: process.env.ELECTRON_NODE_INTEGRATION !== 'true',
    },
  });

  // Electron-vite dev server URL
  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    if (!process.env.IS_TEST) mainWindow.webContents.openDevTools();
  } else {
    // Load the index.html when not in development
    const indexPath = path.join(__dirname, '../renderer/index.html');
    mainWindow.loadFile(indexPath);
  }
}

/**
 * Show message dialog
 */
function showMsg(title: string, msg: string): void {
  dialog.showMessageBoxSync({
    type: 'info',
    buttons: ['OK'],
    defaultId: 0,
    title: title,
    message: msg,
  });
}

/**
 * Show error dialog
 */
function error(title: string, msg: string): void {
  dialog.showErrorBox(title, msg);
}

/**
 * Create application menu
 */
function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '功能',
      submenu: [
        {
          label: '首页',
          click: () => {
            mainWindow?.webContents.send('switch-to-homepage');
          },
        },
        {
          label: 'AI助手',
          click: () => {
            mainWindow?.webContents.send('switch-to-aiassistant');
          },
        },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () => {
            showMsg('关于', `Qtian v${VERSION}`);
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
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

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
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

  if (isDevelopment && !process.env.IS_TEST) {
    logger.info('Development mode - Vue Devtools available');
  }

  readConfig();
  createWindow();
  createMenu();
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
