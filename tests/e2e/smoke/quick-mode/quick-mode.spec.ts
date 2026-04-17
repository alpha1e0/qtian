import { test, expect } from '../../fixtures/app.fixture';
import { waitForAppReady } from '../../helpers/electron-helper';

test.describe('快捷模式冒烟测试', () => {
  test.beforeEach(async ({ window }) => {
    await waitForAppReady(window);
  });

  test('应该默认显示快捷模式页面', async ({ window }) => {
    const container = window.locator('.quick-mode-container');
    await expect(container).toBeVisible();
  });

  test('应该显示输入框和发送按钮', async ({ window }) => {
    const input = window.getByLabel('快捷模式输入框');
    await expect(input).toBeVisible();

    const sendButton = window.getByLabel('发送');
    await expect(sendButton).toBeVisible();
  });

  test('应该显示 Agent 和模型选择器', async ({ window }) => {
    const agentSelect = window.getByLabel('快捷模式选择Agent');
    await expect(agentSelect).toBeVisible();

    const modelSelect = window.getByLabel('快捷模式选择模型');
    await expect(modelSelect).toBeVisible();
  });

  test('发送按钮初始状态应该禁用', async ({ window }) => {
    const sendButton = window.getByLabel('发送');
    await expect(sendButton).toBeDisabled();
  });

  test('输入文字后发送按钮应该启用', async ({ window }) => {
    const input = window.getByLabel('快捷模式输入框');
    await input.fill('测试问题');

    const sendButton = window.getByLabel('发送');
    await expect(sendButton).toBeEnabled();
  });

  test('应该能输入文字', async ({ window }) => {
    const input = window.getByLabel('快捷模式输入框');
    await input.fill('你好世界');
    await expect(input).toHaveValue('你好世界');
  });
});
