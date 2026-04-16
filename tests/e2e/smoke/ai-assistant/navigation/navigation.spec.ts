import { test, expect } from '../../../fixtures/app.fixture';
import { waitForAppReady } from '../../../helpers/electron-helper';
import {
  navigateToAiAssistant,
  clickHistoryItem,
  createAiAgent,
  createAiLlmConfig,
  createAiHistory,
  cleanupAiTestData,
  cleanAllAiTestData,
} from '../ai-assistant.helper';

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
   *   2. 按 Ctrl+Enter 发送
   * 预期结果：页面跳转到AI助手页面
   */
  test('首页搜索进入AI助手', async ({ window }) => {
    const searchInput = window.getByLabel('对话输入框');
    await searchInput.fill('什么是量子计算');

    // 首页使用 Ctrl+Enter 发送消息跳转到 AI 助手
    await window.keyboard.press('Control+Enter');
    await window.waitForTimeout(2000);

    // 验证跳转到 AI 助手页面
    await expect(window.locator('.ai-assistant-page')).toBeVisible({ timeout: 5000 });
  });

  /**
   * TC-01-02 首页快捷键进入AI助手
   *
   * 前置条件：应用已启动，位于首页
   * 操作步骤：
   *   1. 按 Ctrl+Alt+A
   * 预期结果：页面跳转到AI助手页面，显示完整的聊天界面
   */
  test('首页快捷键进入AI助手', async ({ window }) => {
    await window.keyboard.press('Control+Alt+a');
    await window.waitForTimeout(2000);

    // 验证跳转到 AI 助手页面
    await expect(window.locator('.ai-assistant-page')).toBeVisible({ timeout: 5000 });
  });

  /**
   * TC-01-03 AI助手页面基本布局
   *
   * 前置条件：应用已启动，有可用场景
   * 操作步骤：
   *   1. 进入AI助手页面
   * 预期结果：显示侧边栏和主区域
   */
  test('AI助手页面应显示基本布局', async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    const agentId = 'e2e_nav_scenario';
    const llmName = 'e2e_nav_llm';
    createAiAgent(testWorkspace, agentId);
    createAiLlmConfig(testWorkspace, llmName);

    await window.reload();
    await waitForAppReady(window);
    await navigateToAiAssistant(window);

    // 验证跳转到 AI 助手页面
    await expect(window.locator('.ai-assistant-page')).toBeVisible({ timeout: 5000 });

    // 验证侧边栏可见
    await expect(window.locator('.chat-sidebar')).toBeVisible({ timeout: 5000 });

    cleanupAiTestData(testWorkspace, [agentId], [llmName]);
  });

  /**
   * TC-01-04 首页搜索框清除
   *
   * 前置条件：应用已启动，搜索框中已输入文本
   * 操作步骤：
   *   1. 清空输入框文本
   * 预期结果：搜索框文本被清空
   */
  test('首页搜索框清除', async ({ window }) => {
    const searchInput = window.getByLabel('对话输入框');
    await searchInput.fill('测试内容');

    // 手动清空
    await searchInput.clear();

    const inputValue = await searchInput.inputValue();
    expect(inputValue).toBe('');
  });

  /**
   * TC-01-05 首页场景和模型选择器可见
   *
   * 前置条件：应用已启动，有可用场景和模型配置
   * 操作步骤：
   *   1. 查看首页输入区域
   * 预期结果：场景选择器和模型选择器均可见
   */
  test('首页应显示场景和模型选择器', async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    const agentId = 'e2e_homepage_selector_scenario';
    const llmName = 'e2e_homepage_selector_llm';
    createAiAgent(testWorkspace, agentId);
    createAiLlmConfig(testWorkspace, llmName);

    await window.reload();
    await waitForAppReady(window);

    // 验证场景选择器可见
    const agentSelector = window.getByLabel('首页选择Agent');
    await expect(agentSelector).toBeVisible({ timeout: 5000 });

    // 验证模型选择器可见
    const llmSelector = window.getByLabel('首页选择模型');
    await expect(llmSelector).toBeVisible({ timeout: 5000 });

    cleanupAiTestData(testWorkspace, [agentId], [llmName]);
  });
});
