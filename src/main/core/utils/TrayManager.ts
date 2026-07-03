/**
 * TrayManager - 系统托盘管理模块
 *
 * 负责创建和管理系统托盘图标、右键菜单，以及与主窗口的显示/隐藏联动。
 * 点击窗口关闭按钮时隐藏到托盘，通过托盘菜单或双击托盘图标恢复窗口。
 */

import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import * as path from 'path';
import { createLogger, LogLevel } from './logger';

const logger = createLogger('TrayManager', LogLevel.INFO);

/** 托盘图标文件名 */
const TRAY_ICON_FILENAME = 'tray.png';

/** TrayManager create 方法的可选回调 */
export interface TrayManagerOptions {
  /**
   * 点击"显示快捷模式"菜单项时的回调（通常为 windowManager.showQuickWindow）。
   * 未提供时菜单项仍展示但点击无操作。
   */
  onShowQuickMode?: () => void;
}

/**
 * 系统托盘管理器
 *
 * 封装 Electron Tray 的创建、菜单构建和窗口联动逻辑。
 * 通过 close 事件拦截实现"关闭到托盘"行为。
 */
export class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private options: TrayManagerOptions = {};

  /**
   * 创建系统托盘并绑定主窗口
   *
   * @param mainWindow - 应用主窗口实例
   * @param options - 可选回调（如"显示快捷模式"）
   */
  create(mainWindow: BrowserWindow, options?: TrayManagerOptions): void {
    this.mainWindow = mainWindow;
    this.options = options ?? {};
    const iconPath = this.resolveIconPath();
    const icon = nativeImage.createFromPath(iconPath);

    this.tray = new Tray(icon);
    this.tray.setToolTip('Qtian AI 助手');
    this.tray.setContextMenu(this.buildContextMenu());

    this.tray.on('double-click', () => {
      this.showMainWindow();
    });

    logger.info('System tray created');
  }

  /**
   * 销毁托盘实例，释放资源
   */
  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
      logger.info('System tray destroyed');
    }
  }

  /**
   * 更新托盘提示文字
   *
   * @param tooltip - 新的提示文字
   */
  updateTooltip(tooltip: string): void {
    if (this.tray) {
      this.tray.setToolTip(tooltip);
    }
  }

  /**
   * 显示并聚焦主窗口
   */
  showMainWindow(): void {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  /**
   * 解析托盘图标路径
   *
   * 开发环境：编译输出在 dist-electron/main/，回退两级到项目根目录的 public/
   * 生产环境：图标在 resources 目录下
   */
  private resolveIconPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, TRAY_ICON_FILENAME);
    }
    // __dirname = dist-electron/main/，需回退两级到项目根目录
    return path.join(__dirname, '../../public', TRAY_ICON_FILENAME);
  }

  /**
   * 构建托盘右键菜单
   *
   * 菜单项：显示主窗口 / 显示快捷模式 / 退出
   */
  private buildContextMenu(): Menu {
    return Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => {
          this.showMainWindow();
        },
      },
      {
        label: '显示快捷模式',
        click: () => {
          // 委托给外部回调（通常为 WindowManager.showQuickWindow）
          this.options.onShowQuickMode?.();
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          app.quit();
        },
      },
    ]);
  }
}
