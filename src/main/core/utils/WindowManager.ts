/**
 * WindowManager - 多窗口生命周期与跨窗口消息中转管理
 *
 * 集中管理主窗口与快捷窗口的创建、显示、隐藏、销毁，避免在 index.ts 中
 * 引入全局变量。所有跨窗口导航（如快捷模式 → 普通模式）经此中转，确保
 * 窗口引用集中可追踪。
 *
 * 设计要点：
 * - 主窗口：frameless，close 拦截为 hide（到托盘）；quit 时销毁
 * - 快捷窗口：frameless + alwaysOnTop + skipTaskbar，close 永远拦截为 hide 以保留对话状态
 * - URL 参数 `?window=quick` 让 App.vue 路由到 QuickModeWindow（单一 HTML 入口）
 */

import { BrowserWindow, nativeImage, screen } from 'electron';
import * as path from 'path';
import { createLogger, LogLevel } from './logger';

const logger = createLogger('WindowManager', LogLevel.INFO);

/** 窗口类型标识，用于内部 Map 索引 */
export const WINDOW_TYPE = {
  MAIN: 'main',
  QUICK: 'quick',
} as const;

/**
 * 快捷窗口尺寸常量（与 QuickModePage 的 QUICK_MODE_SIZES 解耦，主进程侧独立维护）
 *
 * 净高度未变：移除原 CustomTitleBar 32px、新增 QuickTitleBar 32px，二者抵消。
 */
export const QUICK_WINDOW_SIZES = {
  /** 初始状态：仅输入框 */
  initial: { width: 1000, height: 215 },
  /** 回答状态：用户问题 + AI 回答 */
  answering: { width: 1000, height: 850 },
} as const;

/** URL 参数值，用于 App.vue 识别快捷窗口 */
export const QUICK_WINDOW_QUERY_VALUE = 'quick';

/** 跨窗口导航 IPC 通道：快捷窗口 → 主进程 → 主窗口 */
export const QUICK_TO_NORMAL_NAVIGATE_CHANNEL = 'qtian:quick-to-normal-navigate';

/**
 * 窗口展开态变化通知通道：主进程 → 渲染层（TitleBar 图标依赖）
 *
 * 历史遗留命名：payload 为「展开态」布尔值（macOS=全屏，Win/Linux=最大化），
 * 渲染层 TitleBar.vue 一直监听此通道，保持通道名兼容。
 */
export const WINDOW_EXPAND_STATE_CHANNEL = 'window-maximize-state-changed';

/** 触发展开态推送的窗口事件（覆盖两个平台的全部展开态入口） */
const EXPAND_STATE_EVENTS = ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const;

const isDevelopment = process.env.NODE_ENV !== 'production';

/** 标志位：区分"隐藏到托盘"和"真正退出"，由外部 setQuitting 控制 */
let isQuitting = false;

/**
 * 根据屏幕工作区计算普通模式窗口大小（不超过屏幕可用区域）
 *
 * 主窗口创建与 `qtian:window-normal-size` IPC 复用此逻辑。
 */
export function getNormalWindowSize(): { width: number; height: number } {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.min(1600, screenW - 40),
    height: Math.min(900, screenH - 40),
  };
}

/**
 * 构造主窗口与快捷窗口共享的 webPreferences
 */
function buildWebPreferences(): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, '../preload/index.js'),
    nodeIntegration: process.env.ELECTRON_NODE_INTEGRATION === 'true',
    contextIsolation: process.env.ELECTRON_NODE_INTEGRATION !== 'true',
  };
}

/**
 * 判断窗口是否处于「展开态」
 *
 * 跨平台语义统一（spec 003 §6）：
 * - macOS：全屏（同原生绿键行为，切换到新桌面空间）
 * - Windows/Linux：最大化（铺满工作区）
 *
 * @param win - 目标窗口
 * @returns 是否处于展开态；已销毁窗口返回 false
 */
export function isWindowExpanded(win: BrowserWindow): boolean {
  if (win.isDestroyed()) return false;
  return process.platform === 'darwin' ? win.isFullScreen() : win.isMaximized();
}

/**
 * 切换窗口「展开态」（最大化按钮的跨平台实现）
 *
 * - macOS：setFullScreen 进/出全屏。旧实现统一走 maximize()，在小屏 Mac 上
 *   普通尺寸与最大化仅差约 40px，用户感知为「点击无反应」，且不符合
 *   「最大化到新空间」的平台预期，故改为全屏。
 * - Windows/Linux：最大化 / 还原（保持 Windows 惯例）。
 *
 * @param win - 目标窗口；已销毁时静默返回
 */
export function toggleWindowExpandState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (process.platform === 'darwin') {
    win.setFullScreen(!win.isFullScreen());
  } else if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
}

/** 生产模式下快捷窗口加载的 HTML 文件路径 */
const QUICK_WINDOW_PROD_FILE = path.join(__dirname, '../renderer/index.html');

/**
 * 构造开发模式下快捷窗口的 URL（带 ?window=quick 参数）
 *
 * 仅在 `ELECTRON_RENDERER_URL` 存在时调用；否则 `new URL('')` 会抛
 * `Invalid URL`，进而让 `qtian:quick-window-open` IPC 整体 reject，
 * 快捷窗口无法创建 → 前端表现为空白页面。
 */
function buildQuickWindowDevUrl(): string {
  const devBase = process.env.ELECTRON_RENDERER_URL;
  if (!devBase) {
    throw new Error('ELECTRON_RENDERER_URL is not set; cannot build dev URL for quick window');
  }
  // 用 URL API 避免末尾斜杠/已有 query 造成的拼接问题
  const devUrlObj = new URL(devBase);
  devUrlObj.searchParams.set('window', QUICK_WINDOW_QUERY_VALUE);
  return devUrlObj.toString();
}

export class WindowManager {
  private windows: Map<string, BrowserWindow | null> = new Map([
    [WINDOW_TYPE.MAIN, null],
    [WINDOW_TYPE.QUICK, null],
  ]);

  /**
   * 标记应用即将退出；后续 close 事件不再拦截为 hide。
   * 必须在 app 'before-quit' 事件中调用。
   *
   * @param value - 是否正在退出
   */
  setQuitting(value: boolean): void {
    isQuitting = value;
  }

  /**
   * 创建主窗口（frameless，由自定义 TitleBar 控制）。
   * 关闭事件由 isQuitting 控制是否隐藏到托盘。
   *
   * @returns 主窗口实例
   */
  async createMainWindow(): Promise<BrowserWindow> {
    const normalSize = getNormalWindowSize();
    const mainWindow = new BrowserWindow({
      width: normalSize.width,
      height: normalSize.height,
      frame: false,
      icon: nativeImage.createFromPath(path.join(__dirname, '../../public/icon.png')),
      webPreferences: buildWebPreferences(),
    });

    if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
      await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      const indexPath = path.join(__dirname, '../renderer/index.html');
      mainWindow.loadFile(indexPath);
    }

    // 拦截关闭事件：非真正退出时隐藏到托盘
    mainWindow.on('close', (event) => {
      if (!isQuitting) {
        event.preventDefault();
        mainWindow.hide();
        logger.info('Main window hidden to system tray');
      }
    });

    // 展开态变化时主动推送渲染层：TitleBar 图标依赖此事件，
    // 旧实现从未发送，图标只能靠点击后回查，存在状态竞态
    const sendExpandState = (): void => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(WINDOW_EXPAND_STATE_CHANNEL, isWindowExpanded(mainWindow));
      }
    };
    for (const eventName of EXPAND_STATE_EVENTS) {
      mainWindow.on(eventName, sendExpandState);
    }

    this.windows.set(WINDOW_TYPE.MAIN, mainWindow);
    logger.info('Main window created');
    return mainWindow;
  }

  /**
   * 创建快捷窗口（frameless + 始终置顶 + 不在任务栏显示 + 可调整大小）。
   * URL 带 ?window=quick 让 App.vue 路由到 QuickModeWindow。
   * 关闭事件被 preventDefault，仅 hide 以保留对话状态。
   *
   * @returns 快捷窗口实例
   */
  async createQuickWindow(): Promise<BrowserWindow> {
    const initialSize = QUICK_WINDOW_SIZES.initial;
    const quickWindow = new BrowserWindow({
      width: initialSize.width,
      height: initialSize.height,
      // 最小尺寸：保证输入框和基本按钮可用
      minWidth: 480,
      minHeight: 150,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      icon: nativeImage.createFromPath(path.join(__dirname, '../../public/icon.png')),
      webPreferences: buildWebPreferences(),
    });

    if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
      // dev 模式：从 vite dev server 加载，附加 ?window=quick
      await quickWindow.loadURL(buildQuickWindowDevUrl());
    } else {
      // 生产模式：loadFile 加载本地 HTML，用 query 让 App.vue 路由到快捷窗口
      await quickWindow.loadFile(QUICK_WINDOW_PROD_FILE, {
        query: { window: QUICK_WINDOW_QUERY_VALUE },
      });
    }

    // 快捷窗口关闭始终拦截为 hide，保留对话状态
    quickWindow.on('close', (event) => {
      event.preventDefault();
      quickWindow.hide();
      logger.info('Quick window hidden (close intercepted)');
    });

    this.windows.set(WINDOW_TYPE.QUICK, quickWindow);
    logger.info('Quick window created');
    return quickWindow;
  }

  /**
   * 显示快捷窗口：不存在则创建；存在则 show + focus。
   *
   * @returns 快捷窗口实例
   */
  async showQuickWindow(): Promise<BrowserWindow> {
    const existing = this.getQuickWindow();
    if (existing) {
      existing.show();
      existing.focus();
      logger.info('Quick window shown (reused)');
      return existing;
    }
    return this.createQuickWindow();
  }

  /**
   * 隐藏快捷窗口（若存在且未销毁）。
   */
  hideQuickWindow(): void {
    const quickWindow = this.getQuickWindow();
    if (quickWindow) {
      quickWindow.hide();
      logger.info('Quick window hidden');
    }
  }

  /**
   * 切换快捷窗口可见性：
   * - 可见 → 隐藏
   * - 不可见/不存在 → 显示
   */
  async toggleQuickWindow(): Promise<void> {
    const quickWindow = this.getQuickWindow();
    if (quickWindow && quickWindow.isVisible()) {
      this.hideQuickWindow();
      logger.info('Quick window toggled off');
    } else {
      await this.showQuickWindow();
      logger.info('Quick window toggled on');
    }
  }

  /**
   * 获取主窗口实例（可能为 null 或已销毁）。
   */
  getMainWindow(): BrowserWindow | null {
    const win = this.windows.get(WINDOW_TYPE.MAIN) ?? null;
    if (win && win.isDestroyed()) return null;
    return win;
  }

  /**
   * 获取快捷窗口实例（可能为 null 或已销毁）。
   */
  getQuickWindow(): BrowserWindow | null {
    const win = this.windows.get(WINDOW_TYPE.QUICK) ?? null;
    if (win && win.isDestroyed()) return null;
    return win;
  }

  /**
   * 跨窗口导航：将 payload 转发到主窗口的 AiAssistantPage，并隐藏快捷窗口。
   * 主窗口不存在时不抛错（仅记日志），保证健壮性。
   *
   * @param payload - 导航载荷（message / agentId / llmConfig / historyId）
   */
  forwardNavigateToMain(payload: unknown): void {
    const mainWindow = this.getMainWindow();
    if (!mainWindow) {
      logger.warn('forwardNavigateToMain: main window unavailable, payload dropped', payload);
      return;
    }
    mainWindow.webContents.send(QUICK_TO_NORMAL_NAVIGATE_CHANNEL, payload);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    logger.info('Navigate payload forwarded to main window');

    this.hideQuickWindow();
  }

  /**
   * 销毁所有窗口（app 'before-quit' 时调用）。
   * 设置 isQuitting 以避免 close 事件被拦截为 hide。
   */
  destroyAll(): void {
    isQuitting = true;
    for (const [type, win] of this.windows.entries()) {
      if (win && !win.isDestroyed()) {
        win.destroy();
        logger.info(`Window destroyed: ${type}`);
      }
      this.windows.set(type, null);
    }
  }
}
