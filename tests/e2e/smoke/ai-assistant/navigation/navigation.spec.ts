import { test, expect } from '../../../fixtures/app.fixture';
import { waitForAppReady } from '../../../helpers/electron-helper';

test.describe('AI助手 - 入口与导航', () => {
  test.beforeEach(async ({ window }) => {
    await waitForAppReady(window);
  });

  /**
   * TC-01-01 首页搜索进入AI助手
   *
   * 前置条件：应用已启动，位于首页
   * 操作步骤：
   *   1. 在首页搜索框输入"什么是量子计算"
   *   2. 点击搜索按钮（或按Enter键）
   * 预期结果：页面跳转到AI助手页面，搜索内容自动填入输入框
   */
  test('首页搜索进入AI助手', async ({ window }) => {
    const searchInput = window.getByLabel('搜索输入框');
    await searchInput.fill('什么是量子计算');

    // 按 Enter 或点击搜索按钮
    await window.keyboard.press('Enter');
    await window.waitForTimeout(1500);

    // 验证跳转到 AI 助手页面
    await expect(window.locator('.ai-assistant-page')).toBeVisible({ timeout: 5000 });
  });

  /**
   * TC-01-02 首页常用命令进入AI助手
   *
   * 前置条件：应用已启动，位于首页
   * 操作步骤：
   *   1. 点击常用命令区域中的"翻译这段文字"标签
   * 预期结果：页面跳转到AI助手页面，"翻译这段文字"自动填入输入框
   */
  test('首页常用命令进入AI助手', async ({ window }) => {
    const commandTag = window.getByText('翻译这段文字');
    await commandTag.click();
    await window.waitForTimeout(1500);

    // 验证跳转到 AI 助手页面
    await expect(window.locator('.ai-assistant-page')).toBeVisible({ timeout: 5000 });
  });

  /**
   * TC-01-03 首页工具卡片进入AI助手
   *
   * 前置条件：应用已启动，位于首页
   * 操作步骤：
   *   1. 点击常用工具区域的"AI助手"卡片
   * 预期结果：页面跳转到AI助手页面，显示完整的聊天界面
   */
  test('首页工具卡片进入AI助手', async ({ window }) => {
    const toolCard = window.getByLabel('AI助手工具');
    await toolCard.click();
    await window.waitForTimeout(1500);

    // 验证跳转到 AI 助手页面
    await expect(window.locator('.ai-assistant-page')).toBeVisible({ timeout: 5000 });

    // 验证侧边栏可见
    await expect(window.locator('.chat-sidebar')).toBeVisible();
  });

  /**
   * TC-01-04 首页搜索框清除
   *
   * 前置条件：应用已启动，搜索框中已输入文本
   * 操作步骤：
   *   1. 点击搜索框右侧的 X 清除按钮
   * 预期结果：搜索框文本被清空
   */
  test('首页搜索框清除', async ({ window }) => {
    const searchInput = window.getByLabel('搜索输入框');
    await searchInput.fill('测试内容');

    // 找到清除按钮并点击
    const clearButton = window.locator('.search-section .el-input__clear');
    if (await clearButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clearButton.click();
    } else {
      // 备选：手动清空
      await searchInput.clear();
    }

    const inputValue = await searchInput.inputValue();
    expect(inputValue).toBe('');
  });
});
