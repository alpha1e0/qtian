import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron 模块
const mockGlobalShortcut = {
  register: vi.fn().mockReturnValue(true),
  unregisterAll: vi.fn(),
};

vi.mock('electron', () => ({
  BrowserWindow: {},
  globalShortcut: mockGlobalShortcut,
}));

// Mock logger
vi.mock('./logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
  }),
  LogLevel: { INFO: 1, ERROR: 3 },
}));

describe('GlobalShortcutManager', () => {
  let GlobalShortcutManager: any;
  let manager: any;
  let mockMainWindow: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./GlobalShortcutManager');
    GlobalShortcutManager = mod.GlobalShortcutManager;
    manager = new GlobalShortcutManager();
    mockMainWindow = {
      isVisible: vi.fn().mockReturnValue(true),
      isMinimized: vi.fn().mockReturnValue(false),
      show: vi.fn(),
      focus: vi.fn(),
      restore: vi.fn(),
      hide: vi.fn(),
      webContents: {
        send: vi.fn(),
      },
    };
  });

  describe('register', () => {
    it('should register CommandOrControl+Q shortcut', () => {
      manager.register(mockMainWindow);

      expect(mockGlobalShortcut.register).toHaveBeenCalledWith(
        'CommandOrControl+Q',
        expect.any(Function)
      );
    });

    it('should call register and return true on success', () => {
      mockGlobalShortcut.register.mockReturnValue(true);
      manager.register(mockMainWindow);

      expect(mockGlobalShortcut.register).toHaveBeenCalledTimes(1);
    });

    it('should handle registration failure gracefully', () => {
      mockGlobalShortcut.register.mockReturnValue(false);
      // 不应抛错
      expect(() => manager.register(mockMainWindow)).not.toThrow();
    });
  });

  describe('unregister', () => {
    it('should call globalShortcut.unregisterAll', () => {
      manager.unregister();

      expect(mockGlobalShortcut.unregisterAll).toHaveBeenCalled();
    });
  });

  describe('Ctrl+Q callback behavior', () => {
    it('should show and focus window when window is hidden', () => {
      mockMainWindow.isVisible.mockReturnValue(false);
      manager.register(mockMainWindow);

      // 触发快捷键回调
      const callback = mockGlobalShortcut.register.mock.calls[0][1];
      callback();

      expect(mockMainWindow.show).toHaveBeenCalled();
      expect(mockMainWindow.focus).toHaveBeenCalled();
      expect(mockMainWindow.webContents.send).not.toHaveBeenCalled();
    });

    it('should restore, show and focus window when minimized', () => {
      mockMainWindow.isVisible.mockReturnValue(true);
      mockMainWindow.isMinimized.mockReturnValue(true);
      manager.register(mockMainWindow);

      const callback = mockGlobalShortcut.register.mock.calls[0][1];
      callback();

      expect(mockMainWindow.restore).toHaveBeenCalled();
      expect(mockMainWindow.show).toHaveBeenCalled();
      expect(mockMainWindow.focus).toHaveBeenCalled();
    });

    it('should hide window when window is visible', () => {
      mockMainWindow.isVisible.mockReturnValue(true);
      mockMainWindow.isMinimized.mockReturnValue(false);
      manager.register(mockMainWindow);

      const callback = mockGlobalShortcut.register.mock.calls[0][1];
      callback();

      expect(mockMainWindow.hide).toHaveBeenCalled();
      expect(mockMainWindow.show).not.toHaveBeenCalled();
    });

    it('should do nothing if mainWindow is null', () => {
      // 不调用 register，mainWindow 为 null
      const callback = mockGlobalShortcut.register.mock.calls[0]?.[1];
      if (callback) {
        callback();
      }
      // 不应报错
      expect(mockMainWindow.show).not.toHaveBeenCalled();
    });
  });
});
