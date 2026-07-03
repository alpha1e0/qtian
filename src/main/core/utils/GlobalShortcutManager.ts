/**
 * GlobalShortcutManager - 全局快捷键管理模块
 *
 * 管理 Electron 全局快捷键的注册和注销。
 * 当前仅注册 Ctrl+Q：切换快捷窗口的显示/隐藏（由 WindowManager 负责具体窗口操作）。
 */

import { globalShortcut } from 'electron';
import { createLogger, LogLevel } from './logger';

const logger = createLogger('GlobalShortcut', LogLevel.INFO);

/** Ctrl+Q 快捷键绑定 */
const QUICK_MODE_ACCELERATOR = 'CommandOrControl+Q';

/**
 * 快捷窗口控制能力的最小契约
 *
 * 使用结构化类型而非直接依赖 WindowManager，降低耦合并便于单测 mock。
 */
export interface QuickWindowToggle {
  toggleQuickWindow(): Promise<void>;
}

export class GlobalShortcutManager {
  private controller: QuickWindowToggle | null = null;

  /**
   * 注册全局快捷键并绑定快捷窗口控制器
   *
   * @param controller - 提供快捷窗口切换能力的对象（通常为 WindowManager）
   */
  register(controller: QuickWindowToggle): void {
    this.controller = controller;

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
   * 委托 WindowManager 切换快捷窗口可见性：
   * - 快捷窗口可见 → 隐藏
   * - 快捷窗口不可见/不存在 → 显示并聚焦
   */
  private async handleQuickModeShortcut(): Promise<void> {
    if (!this.controller) {
      logger.warn('Ctrl+Q pressed but no controller registered');
      return;
    }
    try {
      await this.controller.toggleQuickWindow();
    } catch (err) {
      logger.error('Failed to toggle quick window via shortcut', err as Error);
    }
  }
}
