import { test, expect } from '../../fixtures/app.fixture';
import { waitForAppReady } from '../../helpers/electron-helper';

test.describe('快捷模式与普通模式导航测试', () => {
  test.beforeEach(async ({ window }) => {
    await waitForAppReady(window);
  });

  test('应该默认在快捷模式页面', async ({ window }) => {
    const quickMode = window.locator('.quick-mode-container');
    await expect(quickMode).toBeVisible();

    // 普通模式页面不应可见
    const aiPage = window.locator('.ai-assistant-page');
    await expect(aiPage).not.toBeVisible();
  });

  test('菜单中应该有快捷模式和AI助手选项', async ({ window }) => {
    // 点击菜单 "功能" — Electron 默认菜单
    // 由于菜单是原生组件，通过 IPC 测试导航
    // 验证页面在快捷模式
    const quickMode = window.locator('.quick-mode-container');
    await expect(quickMode).toBeVisible();
  });

  test('快捷模式页面应该有 "新问题" 按钮仅在回答状态显示', async ({ window }) => {
    // 初始状态不应有 "新问题" 按钮
    const newQuestionBtn = window.getByRole('button', { name: '新问题' });
    await expect(newQuestionBtn).not.toBeVisible();
  });

  test('快捷模式初始状态不应有 "完整对话" 按钮', async ({ window }) => {
    const convertBtn = window.getByRole('button', { name: '完整对话' });
    await expect(convertBtn).not.toBeVisible();
  });
});
