import type { ElectronApplication, Page } from '@playwright/test';

/**
 * 等待应用加载完成
 */
export async function waitForAppReady(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000); // 等待Vue应用初始化
}

/**
 * 获取应用版本
 */
export async function getAppVersion(electronApp: ElectronApplication): Promise<string> {
  return await electronApp.evaluate(async ({ app }) => {
    return app.getVersion();
  });
}

/**
 * 捕获控制台日志
 */
export function setupConsoleLogging(page: Page) {
  const logs: string[] = [];

  page.on('console', msg => {
    logs.push(msg.text());
  });

  return logs;
}

/**
 * 等待Vue组件挂载
 */
export async function waitForComponent(page: Page, selector: string) {
  await page.waitForSelector(selector, { timeout: 5000 });
}
