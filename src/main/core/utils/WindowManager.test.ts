import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * WindowManager 测试
 *
 * 通过 mock electron.BrowserWindow 验证：
 * - 快捷窗口 URL 含 ?window=quick
 * - 快捷窗口 options 含 alwaysOnTop / skipTaskbar / frame:false
 * - close 事件被 preventDefault 并 hide
 * - toggleQuickWindow 两个分支
 * - forwardNavigateToMain 在 mainWindow 为 null 时不抛错；非 null 时正确中转
 * - showQuickWindow 已存在则复用、不存在则创建
 */

// 记录所有被创建的 mock 窗口实例，便于按索引断言
interface MockWindowInstance {
  loadURL: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  isVisible: ReturnType<typeof vi.fn>;
  isMinimized: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  webContents: { send: ReturnType<typeof vi.fn> };
}

const createdWindows: MockWindowInstance[] = [];

function createMockWindowInstance(): MockWindowInstance {
  return {
    loadURL: vi.fn().mockResolvedValue(undefined),
    loadFile: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(),
    isVisible: vi.fn().mockReturnValue(false),
    isMinimized: vi.fn().mockReturnValue(false),
    restore: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    webContents: { send: vi.fn() },
  };
}

// 捕获 new BrowserWindow(options) 的 options
const MockBrowserWindow = vi.fn().mockImplementation(() => {
  const instance = createMockWindowInstance();
  createdWindows.push(instance);
  return instance;
});

vi.mock('electron', () => ({
  BrowserWindow: MockBrowserWindow,
  nativeImage: { createFromPath: vi.fn().mockReturnValue('mock-icon') },
  screen: {
    getPrimaryDisplay: vi.fn().mockReturnValue({ workAreaSize: { width: 1920, height: 1080 } }),
  },
}));

vi.mock('./logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 },
}));

describe('WindowManager', () => {
  let WindowManager: typeof import('./WindowManager').WindowManager;
  let windowManager: import('./WindowManager').WindowManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    createdWindows.length = 0;
    // 模拟开发环境（loadURL 分支）
    process.env.NODE_ENV = 'development';
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173/';
    process.env.ELECTRON_NODE_INTEGRATION = 'false';

    const mod = await import('./WindowManager');
    WindowManager = mod.WindowManager;
    windowManager = new WindowManager();
    // 重置模块级 isQuitting 标志（destroyAll 等测试可能将其置为 true）
    windowManager.setQuitting(false);
  });

  afterEach(() => {
    delete process.env.ELECTRON_RENDERER_URL;
  });

  describe('createQuickWindow', () => {
    it('should include ?window=quick in dev URL', async () => {
      await windowManager.createQuickWindow();

      const instance = createdWindows[0];
      expect(instance.loadURL).toHaveBeenCalledTimes(1);
      const url = instance.loadURL.mock.calls[0][0] as string;
      expect(url).toContain('?window=quick');
      expect(url).toContain('window=quick');
    });

    it('should pass alwaysOnTop, skipTaskbar, frame:false in options', async () => {
      await windowManager.createQuickWindow();

      const options = MockBrowserWindow.mock.calls[0][0];
      expect(options.alwaysOnTop).toBe(true);
      expect(options.skipTaskbar).toBe(true);
      expect(options.frame).toBe(false);
      expect(options.resizable).toBe(true);
    });

    it('should intercept close event with preventDefault and hide', async () => {
      await windowManager.createQuickWindow();

      const instance = createdWindows[0];
      const closeHandler = instance.on.mock.calls.find(
        (call: any[]) => call[0] === 'close'
      )?.[1] as ((event: { preventDefault: () => void }) => void) | undefined;

      expect(closeHandler).toBeDefined();
      const mockEvent = { preventDefault: vi.fn() };
      closeHandler!(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(instance.hide).toHaveBeenCalled();
    });

    it('should store created window and return via getQuickWindow', async () => {
      const created = await windowManager.createQuickWindow();
      expect(windowManager.getQuickWindow()).toBe(created);
    });
  });

  describe('showQuickWindow', () => {
    it('should create quick window when not exists', async () => {
      expect(windowManager.getQuickWindow()).toBeNull();
      const win = await windowManager.showQuickWindow();
      expect(win).toBeDefined();
      expect(MockBrowserWindow).toHaveBeenCalledTimes(1);
      expect(windowManager.getQuickWindow()).toBe(win);
    });

    it('should reuse existing quick window and call show + focus', async () => {
      await windowManager.showQuickWindow();
      const first = createdWindows[0];
      await windowManager.showQuickWindow();

      // 仅创建一次
      expect(MockBrowserWindow).toHaveBeenCalledTimes(1);
      expect(first.show).toHaveBeenCalled();
      expect(first.focus).toHaveBeenCalled();
    });
  });

  describe('hideQuickWindow', () => {
    it('should call hide on quick window when exists', async () => {
      await windowManager.createQuickWindow();
      const instance = createdWindows[0];

      windowManager.hideQuickWindow();
      expect(instance.hide).toHaveBeenCalled();
    });

    it('should not throw when quick window is null', () => {
      expect(() => windowManager.hideQuickWindow()).not.toThrow();
    });
  });

  describe('toggleQuickWindow', () => {
    it('should create/show quick window when not visible', async () => {
      await windowManager.toggleQuickWindow();
      expect(MockBrowserWindow).toHaveBeenCalledTimes(1);
      expect(windowManager.getQuickWindow()).toBeDefined();
    });

    it('should hide quick window when visible', async () => {
      await windowManager.createQuickWindow();
      const instance = createdWindows[0];
      instance.isVisible.mockReturnValue(true);

      await windowManager.toggleQuickWindow();

      expect(instance.hide).toHaveBeenCalled();
      // 不应再次创建
      expect(MockBrowserWindow).toHaveBeenCalledTimes(1);
    });
  });

  describe('forwardNavigateToMain', () => {
    it('should not throw when main window is null', () => {
      expect(() => windowManager.forwardNavigateToMain({ message: 'hi' })).not.toThrow();
    });

    it('should send payload, show+focus main window, and hide quick window', async () => {
      await windowManager.createMainWindow();
      await windowManager.createQuickWindow();
      const mainWindow = createdWindows[0];
      const quickInstance = createdWindows[1];

      const payload = { message: 'hello', agentId: 'a1' };
      windowManager.forwardNavigateToMain(payload);

      expect(mainWindow.webContents.send).toHaveBeenCalledWith(
        'qtian:quick-to-normal-navigate',
        payload
      );
      expect(mainWindow.show).toHaveBeenCalled();
      expect(mainWindow.focus).toHaveBeenCalled();
      // 快捷窗口应被隐藏
      expect(quickInstance.hide).toHaveBeenCalled();
    });

    it('should restore main window if minimized', async () => {
      await windowManager.createMainWindow();
      const mainWindow = createdWindows[0];
      mainWindow.isMinimized.mockReturnValue(true);

      windowManager.forwardNavigateToMain({});

      expect(mainWindow.restore).toHaveBeenCalled();
      expect(mainWindow.show).toHaveBeenCalled();
    });
  });

  describe('destroyAll', () => {
    it('should destroy all existing windows', async () => {
      await windowManager.createMainWindow();
      await windowManager.createQuickWindow();

      windowManager.destroyAll();

      expect(createdWindows[0].destroy).toHaveBeenCalled();
      expect(createdWindows[1].destroy).toHaveBeenCalled();
      // Map 被清空
      expect(windowManager.getMainWindow()).toBeNull();
      expect(windowManager.getQuickWindow()).toBeNull();
    });

    it('should not throw when no windows exist', () => {
      expect(() => windowManager.destroyAll()).not.toThrow();
    });
  });

  describe('createMainWindow', () => {
    it('should configure frame:false and store window', async () => {
      const win = await windowManager.createMainWindow();
      const options = MockBrowserWindow.mock.calls[0][0];
      expect(options.frame).toBe(false);
      expect(windowManager.getMainWindow()).toBe(win);
    });

    it('should intercept close as hide when not quitting', async () => {
      await windowManager.createMainWindow();
      const instance = createdWindows[0];
      const closeHandler = instance.on.mock.calls.find(
        (call: any[]) => call[0] === 'close'
      )?.[1] as ((event: { preventDefault: () => void }) => void) | undefined;

      const mockEvent = { preventDefault: vi.fn() };
      closeHandler!(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(instance.hide).toHaveBeenCalled();
    });
  });
});
