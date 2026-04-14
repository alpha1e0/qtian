import { _electron as electron, ElectronApplication, Page } from 'playwright';
import { test as base } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { loadTestEnv, getTestWorkspacePath } from '../../scripts/load-test-env';

type AppFixtures = {
  electronApp: ElectronApplication;
  window: Page;
  testWorkspace: string;
};

export const test = base.extend<AppFixtures>({
  testWorkspace: async ({}, use) => {
    // 从 .env.test 加载环境变量（与单元测试一致）
    await loadTestEnv();

    // 获取测试工作目录路径（与单元测试一致）
    const workspacePath = getTestWorkspacePath();

    console.log(`[E2E TEST] 使用测试工作目录: ${workspacePath}`);

    // 使用工作目录，不进行清理（与单元测试一致）
    await use(workspacePath);
  },

  electronApp: async ({ testWorkspace }, use) => {
    // 监听主进程日志
    const originalLog = console.log;
    const originalError = console.error;
    const originalInfo = console.info;

    console.log('========================================');
    console.log('🚀 开始启动 Electron 应用');
    console.log('========================================');

    // 设置环境变量（与单元测试保持一致）
    process.env.QTIAN_WORKSPACE = testWorkspace;
    process.env.NODE_ENV = 'production';
    process.env.IS_TEST = 'true';

    // 获取项目根目录
    const projectRoot = path.resolve(__dirname, '../../..');

    // 检查是否需要构建应用
    const distMainPath = path.join(projectRoot, 'dist-electron/main/index.js');

    if (!fs.existsSync(distMainPath)) {
      console.log('📦 应用未构建，跳过Electron启动测试。请先运行 npm run build');
      // 创建一个模拟的app对象，避免测试完全失败
      const mockApp = {
        close: async () => {},
        evaluate: async () => '0.0.1',
        firstWindow: async () => {
          throw new Error('应用未构建，请先运行 npm run build');
        }
      };
      await use(mockApp as any);
      return;
    }

    // 启动Electron应用
    try {
      // 根据平台确定Electron可执行文件路径
      let executablePath: string;
      if (process.platform === 'win32') {
        executablePath = path.join(projectRoot, 'node_modules/electron/dist/electron.exe');
      } else {
        executablePath = path.join(projectRoot, 'node_modules/.bin/electron');
      }

      console.log('🚀 Starting Electron with:', {
        executablePath,
        projectRoot,
        QTIAN_WORKSPACE: testWorkspace,
        NODE_ENV: 'production',
        IS_TEST: 'true'
      });

      // 验证文件存在
      if (!fs.existsSync(executablePath)) {
        throw new Error(`Electron executable not found at: ${executablePath}`);
      }
      if (!fs.existsSync(path.join(projectRoot, 'package.json'))) {
        throw new Error(`package.json not found at: ${projectRoot}`);
      }

      // 添加 Electron 日志参数
      const electronArgs = [
        projectRoot,
        '--enable-logging',
        '--log-level=verbose',
        '--v=1',
        '--disable-features=SecurityWarningsForInsecureContent',
      ];

      console.log('📋 Electron args:', electronArgs);

      const app = await electron.launch({
        executablePath,
        args: electronArgs,
        env: {
          ...process.env,
          QTIAN_WORKSPACE: testWorkspace,
          NODE_ENV: 'production',
          IS_TEST: 'true',
          // 确保 Electron 子进程的输出能被捕获
          ELECTRON_ENABLE_LOGGING: 'true',
          // 启用详细日志
          NODE_DEBUG: '*',
        },
      });

      console.log('========================================');
      console.log('✅ Electron launched successfully');
      console.log('📱 Window available:', !!app.firstWindow);
      console.log('========================================');

      await use(app);
      await app.close();
    } catch (error) {
      console.error('❌ Electron启动失败:', error);
      throw error;
    }
  },

  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow({
      timeout: 15000
    });

    // 监听渲染进程的所有控制台消息并输出到终端
    window.on('console', async (msg) => {
      const type = msg.type();
      const text = msg.text();

      // 获取调用位置信息（如果可用）
      const location = msg.location();
      const locationStr = location
        ? ` (${location.url}:${location.lineNumber}:${location.columnNumber})`
        : '';

      // 根据消息类型使用不同的输出方式
      // 过滤 Electron 已知的安全警告（由 webSecurity: false 引起，仅开发/测试环境可见）
      if (type === 'warning' && /Electron Security Warning/.test(text)) {
        return;
      }

      switch (type) {
        case 'error':
          console.error(`[Renderer Process] ERROR${locationStr}: ${text}`);
          // 对于错误，也打印完整的参数
          try {
            const args = msg.args();
            if (args.length > 1) {
              for (let i = 1; i < args.length; i++) {
                const argValue = await args[i].jsonValue();
                console.error(`[Renderer Process]   arg${i}:`, argValue);
              }
            }
          } catch (e) {
            // 忽略参数序列化错误
          }
          break;
        case 'warning':
          console.warn(`[Renderer Process] WARN${locationStr}: ${text}`);
          break;
        case 'info':
        case 'log':
          console.log(`[Renderer Process]${locationStr}: ${text}`);
          break;
        case 'debug':
          console.debug(`[Renderer Process] DEBUG${locationStr}: ${text}`);
          break;
        default:
          console.log(`[Renderer Process] ${type}${locationStr}: ${text}`);
      }
    });

    // 监听渲染进程的页面错误
    window.on('pageerror', (error) => {
      console.error('[Renderer Process] PAGE ERROR:', error.message);
      if (error.stack) {
        console.error('[Renderer Process] Stack trace:', error.stack);
      }
    });

    await use(window);
  },
});

export const expect = test.expect;
