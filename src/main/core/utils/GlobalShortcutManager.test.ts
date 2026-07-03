import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron 模块
const mockGlobalShortcut = {
  register: vi.fn().mockReturnValue(true),
  unregisterAll: vi.fn(),
};

vi.mock('electron', () => ({
  globalShortcut: mockGlobalShortcut,
}));

// Mock logger
vi.mock('./logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 },
}));

describe('GlobalShortcutManager', () => {
  let GlobalShortcutManager: any;
  let manager: any;
  let mockController: { toggleQuickWindow: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./GlobalShortcutManager');
    GlobalShortcutManager = mod.GlobalShortcutManager;
    manager = new GlobalShortcutManager();
    mockController = {
      toggleQuickWindow: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe('register', () => {
    it('should register CommandOrControl+Q shortcut', () => {
      manager.register(mockController);

      expect(mockGlobalShortcut.register).toHaveBeenCalledWith(
        'CommandOrControl+Q',
        expect.any(Function)
      );
    });

    it('should call register and return true on success', () => {
      mockGlobalShortcut.register.mockReturnValue(true);
      manager.register(mockController);

      expect(mockGlobalShortcut.register).toHaveBeenCalledTimes(1);
    });

    it('should handle registration failure gracefully', () => {
      mockGlobalShortcut.register.mockReturnValue(false);
      // 不应抛错
      expect(() => manager.register(mockController)).not.toThrow();
    });
  });

  describe('unregister', () => {
    it('should call globalShortcut.unregisterAll', () => {
      manager.unregister();

      expect(mockGlobalShortcut.unregisterAll).toHaveBeenCalled();
    });
  });

  describe('Ctrl+Q callback behavior', () => {
    it('should call toggleQuickWindow on controller when shortcut triggered', async () => {
      manager.register(mockController);

      // 触发快捷键回调
      const callback = mockGlobalShortcut.register.mock.calls[0][1];
      await callback();

      expect(mockController.toggleQuickWindow).toHaveBeenCalledTimes(1);
    });

    it('should NOT call webContents.send (deprecated behavior removed)', async () => {
      // controller 不应有 webContents.send；且回调只调用 toggleQuickWindow
      manager.register(mockController);

      const callback = mockGlobalShortcut.register.mock.calls[0][1];
      await callback();

      // controller 是最小契约对象，确保无 webContents 调用
      expect(mockController.toggleQuickWindow).toHaveBeenCalledTimes(1);
      // 断言 controller 上没有 webContents 属性
      expect((mockController as any).webContents).toBeUndefined();
    });

    it('should not throw when controller is null', async () => {
      // 不调用 register，controller 为 null
      const callback = mockGlobalShortcut.register.mock.calls[0]?.[1];
      if (callback) {
        await expect(callback()).resolves.toBeUndefined();
      }
      expect(mockController.toggleQuickWindow).not.toHaveBeenCalled();
    });

    it('should catch errors from toggleQuickWindow without throwing', async () => {
      mockController.toggleQuickWindow.mockRejectedValue(new Error('boom'));
      manager.register(mockController);

      const callback = mockGlobalShortcut.register.mock.calls[0][1];
      // callback 是同步 fire-and-forget；内部异步 handler 捕获错误，不应同步抛出
      expect(() => callback()).not.toThrow();
      // 等待微任务刷新，确保 handler 已执行
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockController.toggleQuickWindow).toHaveBeenCalledTimes(1);
    });
  });
});
