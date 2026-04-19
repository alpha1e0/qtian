/**
 * GlobalShortcutManager - 全局快捷键管理模块
 *
 * 管理 Electron 全局快捷键的注册和注销。
 * 当前仅注册 Ctrl+Q 用于唤起快捷模式：
 * - 窗口隐藏/最小化时：显示并聚焦窗口
 * - 窗口可见时：隐藏窗口到托盘
 */

import { BrowserWindow, globalShortcut } from 'electron';
import { createLogger, LogLevel } from './logger';

const logger = createLogger('GlobalShortcut', LogLevel.INFO);

/** Ctrl+Q 快捷键绑定 */
const QUICK_MODE_ACCELERATOR = 'CommandOrControl+Q';

export class GlobalShortcutManager {
  private mainWindow: BrowserWindow | null = null;

  /**
   * 注册全局快捷键并绑定主窗口
   *
   * @param mainWindow - 应用主窗口实例
   */
  register(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;

    const result = globalShortcut.register(QUICK_MODE_ACCELERATOR, () => {
      this.handleQuickModeShortcut();
    });

    if (result) {
      logger.info(`Global shortcut registered: ${QUICK_MODE_ACCELERATOR}`);
    } else {
      logger.error(`Failed to register global shortcut: ${QUICK_MODE_ACCELERATOR}`);
    }
  }

  /**
   * 注销所有全局快捷键
   */
  unregister(): void {
    globalShortcut.unregisterAll();
    logger.info('All global shortcuts unregistered');
  }

  /**
   * 处理 Ctrl+Q 快捷键回调
   *
   * 窗口不可见时：显示并切换到快捷模式
   * 窗口可见时：通知渲染进程切换到快捷模式（如已是快捷模式则隐藏）
   */
  private handleQuickModeShortcut(): void {
    if (!this.mainWindow) return;

    if (!this.mainWindow.isVisible() || this.mainWindow.isMinimized()) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.show();
      this.mainWindow.focus();
      // 唤起时切换到快捷模式
      this.mainWindow.webContents.send('switch-to-quick-mode');
      logger.info('Quick mode shortcut: window restored');
    } else {
      // 窗口可见：通知渲染进程处理（快捷模式则隐藏，普通模式则切换）
      this.mainWindow.webContents.send('qtian:ctrl-q-toggle');
      logger.info('Quick mode shortcut: toggle sent to renderer');
    }
  }
}
