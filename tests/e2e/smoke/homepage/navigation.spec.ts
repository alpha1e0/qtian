import { test, expect } from '../../fixtures/app.fixture';
import { waitForAppReady } from '../../helpers/electron-helper';

test.describe('首页导航功能测试', () => {
  test.beforeEach(async ({ window }) => {
    await waitForAppReady(window);
  });

  test('应该能够导航到 AI 助手', async ({ window }) => {
    const aiAssistantTool = window.getByLabel('AI助手工具');
    await aiAssistantTool.click();

    // 等待导航完成
    await window.waitForTimeout(1000);

    // 验证导航到了 AI 助手页面
    const scenarioSelector = window.getByLabel('选择场景');
    await expect(scenarioSelector).toBeVisible({ timeout: 5000 });
  });
});
