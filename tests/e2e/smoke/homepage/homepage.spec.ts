import { test, expect } from '../../fixtures/app.fixture';
import { waitForAppReady } from '../../helpers/electron-helper';

test.describe('首页功能冒烟测试', () => {
  test.beforeEach(async ({ window }) => {
    await waitForAppReady(window);
  });

  test('应该显示首页', async ({ window }) => {
    // 使用 locator 验证首页容器
    const homeContainer = window.locator('.homepage-container');
    await expect(homeContainer).toBeVisible();
  });

  test('搜索输入框应该可用', async ({ window }) => {
    // 使用 locator 验证搜索功能
    const searchInput = window.getByLabel('搜索输入框');
    await expect(searchInput).toBeVisible();

    // 测试输入功能
    await searchInput.fill('测试搜索');
    await expect(searchInput).toHaveValue('测试搜索');
  });

  test('搜索按钮应该可点击', async ({ window }) => {
    const searchButton = window.getByLabel('搜索');
    await expect(searchButton).toBeVisible();

    // 点击搜索按钮
    await searchButton.click();
  });

  test('工具卡片应该显示', async ({ window }) => {
    // 验证工具卡片
    const aiAssistantTool = window.getByLabel('AI助手工具');

    await expect(aiAssistantTool).toBeVisible();
  });

  test('常用命令应该显示', async ({ window }) => {
    // 验证常用命令区域
    const commandsSection = window.locator('.commands-section');
    await expect(commandsSection).toBeVisible();

    // 检查命令标签是否存在
    const commandTags = window.locator('.command-tag');
    const count = await commandTags.count();
    expect(count).toBeGreaterThan(0);
  });
});
