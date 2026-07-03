import { test, expect } from '../../fixtures/app.fixture';
import { waitForAppReady } from '../../helpers/electron-helper';
import type { Page, ElectronApplication } from '@playwright/test';

/**
 * 快捷模式冒烟测试（独立窗口架构）
 *
 * 主窗口默认显示 AiAssistantPage；快捷模式运行在独立 BrowserWindow 中，
 * 测试前需通过 IPC 打开快捷窗口，再在快捷窗口 Page 上断言。
 */

/**
 * 辅助：通过主窗口触发打开快捷窗口，返回快捷窗口 Page
 */
async function openQuickWindow(electronApp: ElectronApplication, mainPage: Page): Promise<Page> {
  const quickWindowPromise = electronApp.waitForEvent('window');
  await mainPage.evaluate(() => (window as any).electron.openQuickWindow());
  const quickWindow = await quickWindowPromise;
  await waitForAppReady(quickWindow);
  return quickWindow;
}

test.describe('快捷模式冒烟测试（独立窗口）', () => {
  test.beforeEach(async ({ window }) => {
    await waitForAppReady(window);
  });

  test('主窗口默认应显示 AiAssistantPage（非快捷模式）', async ({ window }) => {
    const quickContainer = window.locator('.quick-mode-container');
    await expect(quickContainer).not.toBeVisible();
  });

  test('打开快捷窗口后应显示快捷模式页面', async ({ electronApp, window }) => {
    const quickWindow = await openQuickWindow(electronApp, window);
    const container = quickWindow.locator('.quick-mode-container');
    await expect(container).toBeVisible();
  });

  test('快捷窗口应显示 QuickTitleBar', async ({ electronApp, window }) => {
    const quickWindow = await openQuickWindow(electronApp, window);
    const titlebar = quickWindow.locator('.quick-titlebar');
    await expect(titlebar).toBeVisible();
  });

  test('快捷窗口应显示输入框和发送按钮', async ({ electronApp, window }) => {
    const quickWindow = await openQuickWindow(electronApp, window);
    const input = quickWindow.getByLabel('快捷模式输入框');
    await expect(input).toBeVisible();

    const sendButton = quickWindow.getByLabel('发送');
    await expect(sendButton).toBeVisible();
  });

  test('快捷窗口应显示 Agent 和模型选择器', async ({ electronApp, window }) => {
    const quickWindow = await openQuickWindow(electronApp, window);
    const agentSelect = quickWindow.getByLabel('快捷模式选择Agent');
    await expect(agentSelect).toBeVisible();

    const modelSelect = quickWindow.getByLabel('快捷模式选择模型');
    await expect(modelSelect).toBeVisible();
  });

  test('快捷窗口发送按钮初始状态应该禁用', async ({ electronApp, window }) => {
    const quickWindow = await openQuickWindow(electronApp, window);
    const sendButton = quickWindow.getByLabel('发送');
    await expect(sendButton).toBeDisabled();
  });

  test('快捷窗口输入文字后发送按钮应该启用', async ({ electronApp, window }) => {
    const quickWindow = await openQuickWindow(electronApp, window);
    const input = quickWindow.getByLabel('快捷模式输入框');
    await input.fill('测试问题');

    const sendButton = quickWindow.getByLabel('发送');
    await expect(sendButton).toBeEnabled();
  });

  test('快捷窗口应该能输入文字', async ({ electronApp, window }) => {
    const quickWindow = await openQuickWindow(electronApp, window);
    const input = quickWindow.getByLabel('快捷模式输入框');
    await input.fill('你好世界');
    await expect(input).toHaveValue('你好世界');
  });
});
