import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron 模块 - 工厂函数内部定义所有 mock，避免 hoisting 问题
vi.mock('electron', () => {
  const mockTrayInstance = {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
  };

  return {
    Tray: vi.fn().mockReturnValue(mockTrayInstance),
    nativeImage: {
      createFromPath: vi.fn().mockReturnValue('mock-icon'),
    },
    Menu: {
      buildFromTemplate: vi.fn().mockReturnValue('mock-menu'),
    },
    app: {
      isPackaged: false,
      quit: vi.fn(),
    },
    BrowserWindow: {},
    // 暴露 mock 实例供测试访问
    __mockTrayInstance: mockTrayInstance,
  };
});

// Mock logger
vi.mock('./logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
  }),
  LogLevel: { INFO: 'info', ERROR: 'error' },
}));

describe('TrayManager', () => {
  let trayManager: import('./TrayManager').TrayManager;
  let mockMainWindow: { show: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn>; isMinimized: ReturnType<typeof vi.fn>; restore: ReturnType<typeof vi.fn> };

  // 从 mock 中获取共享的 tray 实例
  let mockTrayInstance: {
    setToolTip: ReturnType<typeof vi.fn>;
    setContextMenu: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const electron = await import('electron');
    mockTrayInstance = (electron as any).__mockTrayInstance;

    const { TrayManager } = await import('./TrayManager');
    trayManager = new TrayManager();
    mockMainWindow = {
      show: vi.fn(),
      focus: vi.fn(),
      isMinimized: vi.fn().mockReturnValue(false),
      restore: vi.fn(),
    };
  });

  describe('create', () => {
    it('should create tray with icon, tooltip and context menu', async () => {
      const { Tray, Menu } = await import('electron');

      trayManager.create(mockMainWindow as any);

      expect(Tray).toHaveBeenCalledWith('mock-icon');
      expect(mockTrayInstance.setToolTip).toHaveBeenCalledWith('Qtian AI 助手');
      expect(mockTrayInstance.setContextMenu).toHaveBeenCalledWith('mock-menu');
      expect(Menu.buildFromTemplate).toHaveBeenCalled();
    });

    it('should register double-click handler', () => {
      trayManager.create(mockMainWindow as any);

      expect(mockTrayInstance.on).toHaveBeenCalledWith('double-click', expect.any(Function));
    });
  });

  describe('showMainWindow', () => {
    it('should show and focus the main window', () => {
      trayManager.create(mockMainWindow as any);

      trayManager.showMainWindow();

      expect(mockMainWindow.show).toHaveBeenCalled();
      expect(mockMainWindow.focus).toHaveBeenCalled();
    });

    it('should restore window first if minimized', () => {
      mockMainWindow.isMinimized.mockReturnValue(true);
      trayManager.create(mockMainWindow as any);

      trayManager.showMainWindow();

      expect(mockMainWindow.restore).toHaveBeenCalled();
      expect(mockMainWindow.show).toHaveBeenCalled();
      expect(mockMainWindow.focus).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should destroy the tray instance', () => {
      trayManager.create(mockMainWindow as any);
      trayManager.destroy();

      expect(mockTrayInstance.destroy).toHaveBeenCalled();
    });

    it('should be safe to call destroy when tray is null', () => {
      expect(() => trayManager.destroy()).not.toThrow();
    });
  });

  describe('updateTooltip', () => {
    it('should update the tray tooltip', () => {
      trayManager.create(mockMainWindow as any);
      trayManager.updateTooltip('新提示');

      expect(mockTrayInstance.setToolTip).toHaveBeenCalledWith('新提示');
    });

    it('should do nothing if tray is not created', () => {
      expect(() => trayManager.updateTooltip('test')).not.toThrow();
    });
  });

  describe('context menu actions', () => {
    it('should build menu with "显示主窗口", "显示快捷模式" and "退出" items', async () => {
      const { Menu } = await import('electron');

      trayManager.create(mockMainWindow as any);

      const menuTemplate = (Menu.buildFromTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(menuTemplate).toHaveLength(4);
      expect(menuTemplate[0].label).toBe('显示主窗口');
      expect(menuTemplate[1].label).toBe('显示快捷模式');
      expect(menuTemplate[2].type).toBe('separator');
      expect(menuTemplate[3].label).toBe('退出');
    });

    it('"显示主窗口" click should show main window', async () => {
      const { Menu } = await import('electron');

      trayManager.create(mockMainWindow as any);

      const menuTemplate = (Menu.buildFromTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      menuTemplate[0].click();

      expect(mockMainWindow.show).toHaveBeenCalled();
      expect(mockMainWindow.focus).toHaveBeenCalled();
    });

    it('"显示快捷模式" click should invoke onShowQuickMode callback', async () => {
      const { Menu } = await import('electron');
      const onShowQuickMode = vi.fn();

      trayManager.create(mockMainWindow as any, { onShowQuickMode });

      const menuTemplate = (Menu.buildFromTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      menuTemplate[1].click();

      expect(onShowQuickMode).toHaveBeenCalledTimes(1);
    });

    it('"显示快捷模式" click should be safe when no callback provided', async () => {
      const { Menu } = await import('electron');

      trayManager.create(mockMainWindow as any);

      const menuTemplate = (Menu.buildFromTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(() => menuTemplate[1].click()).not.toThrow();
    });

    it('"退出" click should call app.quit', async () => {
      const { Menu, app } = await import('electron');

      trayManager.create(mockMainWindow as any);

      const menuTemplate = (Menu.buildFromTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      menuTemplate[3].click();

      expect(app.quit).toHaveBeenCalled();
    });
  });

  describe('double-click handler', () => {
    it('should show main window on double-click', () => {
      trayManager.create(mockMainWindow as any);

      const doubleClickHandler = mockTrayInstance.on.mock.calls.find(
        (call: any[]) => call[0] === 'double-click'
      )?.[1];

      expect(doubleClickHandler).toBeDefined();
      doubleClickHandler!();

      expect(mockMainWindow.show).toHaveBeenCalled();
      expect(mockMainWindow.focus).toHaveBeenCalled();
    });
  });
});
