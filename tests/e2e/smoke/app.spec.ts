import { test, expect } from '../fixtures/app.fixture';
import { waitForAppReady, getAppVersion } from '../helpers/electron-helper';

test.describe('应用启动冒烟测试', () => {
  test('应该成功启动应用', async ({ electronApp, window }) => {
    // 验证应用是否启动
    expect(electronApp).toBeTruthy();
    expect(window).toBeTruthy();

    // 验证窗口标题
    const title = await window.title();
    expect(title).toContain('Qtian');
  });

  test('应该正确加载渲染进程', async ({ electronApp, window }) => {
    await waitForAppReady(window);

    // 检查Vue应用是否挂载 - 使用 locator 方式
    const appElement = window.locator('#app');
    await expect(appElement).toBeVisible();
  });

  test('应该获取正确的应用版本', async ({ electronApp }) => {
    const version = await getAppVersion(electronApp);
    expect(version).toMatch(/\d+\.\d+\.\d+/); // 语义化版本格式
  });

  test('不应该有控制台错误', async ({ window }) => {
    const errors: string[] = [];

    window.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await waitForAppReady(window);
    await window.waitForTimeout(2000);

    expect(errors).toHaveLength(0);
  });
});
