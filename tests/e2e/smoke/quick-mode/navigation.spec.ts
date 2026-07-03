import { test, expect } from '../../fixtures/app.fixture';
import type { Page, ElectronApplication } from '@playwright/test';
import { waitForAppReady } from '../../helpers/electron-helper';

/**
 * 快捷模式与普通模式导航测试（独立窗口架构）
 *
 * - 主窗口默认显示 AiAssistantPage（普通模式）
 * - 快捷模式在独立窗口，需通过 IPC 打开
 * - 跨窗口导航经主进程中转
 */

async function openQuickWindow(electronApp: ElectronApplication, mainPage: Page): Promise<Page> {
  const quickWindowPromise = electronApp.waitForEvent('window');
  await mainPage.evaluate(() => (window as any).electron.openQuickWindow());
  const quickWindow = await quickWindowPromise;
  await waitForAppReady(quickWindow);
  return quickWindow;
}

test.describe('快捷模式与普通模式导航测试（独立窗口）', () => {
  test.beforeEach(async ({ window }) => {
    await waitForAppReady(window);
  });

  test('应该默认在普通模式页面（AiAssistantPage）', async ({ window }) => {
    // 主窗口不应显示快捷模式
    const quickMode = window.locator('.quick-mode-container');
    await expect(quickMode).not.toBeVisible();
  });

  test('打开快捷窗口后应在快捷模式页面', async ({ electronApp, window }) => {
    const quickWindow = await openQuickWindow(electronApp, window);
    const quickMode = quickWindow.locator('.quick-mode-container');
    await expect(quickMode).toBeVisible();
  });

  test('快捷模式初始状态不应显示 "新问题" 按钮', async ({ electronApp, window }) => {
    const quickWindow = await openQuickWindow(electronApp, window);
    const newQuestionBtn = quickWindow.getByRole('button', { name: '新问题' });
    await expect(newQuestionBtn).not.toBeVisible();
  });

  test('快捷模式初始状态不应有 "完整对话" 按钮（已迁移至 TitleBar）', async ({ electronApp, window }) => {
    const quickWindow = await openQuickWindow(electronApp, window);
    // section-header 已移除，切换按钮在 QuickTitleBar 中
    const sectionHeader = quickWindow.locator('.section-header');
    await expect(sectionHeader).toHaveCount(0);
  });

  test('快捷窗口 TitleBar 应有切换/关闭按钮', async ({ electronApp, window }) => {
    const quickWindow = await openQuickWindow(electronApp, window);
    const switchBtn = quickWindow.getByLabel('切换到完整对话模式');
    await expect(switchBtn).toBeVisible();

    const closeBtn = quickWindow.getByLabel('关闭');
    await expect(closeBtn).toBeVisible();
  });
});
