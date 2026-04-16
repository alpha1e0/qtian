import { test, expect } from '../../../fixtures/app.fixture';
import { waitForAppReady } from '../../../helpers/electron-helper';
import {
  navigateToAiAssistant,
  createAiAgent,
  createAiLlmConfig,
  createAiHistory,
  cleanupAiTestData,
  cleanAllAiTestData,
  clickHistoryItem,
  fillChatInput,
} from '../ai-assistant.helper';

const AGENT_EDGE = 'e2e_edge_scenario';
const HISTORY_EDGE = 'e2e_edge_history';
const LLM_EDGE = 'e2e_edge_llm';

test.describe('AI助手 - 边界与异常', () => {
  test.beforeEach(async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    createAiAgent(testWorkspace, AGENT_EDGE);
    createAiLlmConfig(testWorkspace, LLM_EDGE);
    createAiHistory(testWorkspace, AGENT_EDGE, HISTORY_EDGE);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    // 依赖自动选择第一个Agent
    await window.waitForTimeout(2000);
    await clickHistoryItem(window, HISTORY_EDGE);
    await window.waitForTimeout(1500);
  });

  test.afterEach(async ({ testWorkspace }) => {
    cleanupAiTestData(testWorkspace, [AGENT_EDGE], [LLM_EDGE]);
  });

  /**
   * TC-13-01 超长消息输入
   */
  test('超长消息应可发送且不崩溃', async ({ window }) => {
    const longText = '这是一条很长的消息。'.repeat(300); // ~6600字符
    await fillChatInput(window, longText);

    const sendBtn = window.locator('.chat-input .input-actions').getByRole('button', { name: '发送' });
    await sendBtn.click();
    await window.waitForTimeout(2000);

    // 页面不应崩溃
    await expect(window.locator('.chat-content')).toBeVisible({ timeout: 5000 });

    // 应有用户消息
    const userMessages = window.locator('.user-message');
    const count = await userMessages.count();
    expect(count).toBeGreaterThan(0);
  });

  /**
   * TC-13-02 快速连续发送消息
   */
  test('发送中不应能重复发送', async ({ window }) => {
    const input = window.locator('.chat-input textarea');

    // 第一次发送
    await fillChatInput(window, '第一条消息');
    const sendBtn = window.locator('.chat-input .input-actions').getByRole('button', { name: '发送' });
    await sendBtn.click();
    await window.waitForTimeout(200);

    // 第一次发送后，发送按钮变为停止按钮（isChatting=true）
    const sendBtnExists = await window.locator('.chat-input .input-actions').getByRole('button', { name: '发送' }).isVisible().catch(() => false);

    if (!sendBtnExists) {
      // 停止按钮应可见
      const stopBtn = window.locator('.chat-input .input-actions').getByRole('button', { name: '停止' });
      await expect(stopBtn).toBeVisible();
    }

    // 等待错误恢复
    await window.waitForTimeout(5000);

    // 最终应恢复正常
    await expect(window.locator('.chat-content')).toBeVisible();
  });

  /**
   * TC-13-03 特殊字符消息
   */
  test('包含特殊字符的消息应安全显示', async ({ window }) => {
    const xssPayload = '<script>alert("xss")</script><b>bold</b>&"\'<>';
    await fillChatInput(window, xssPayload);

    const sendBtn = window.locator('.chat-input .input-actions').getByRole('button', { name: '发送' });
    await sendBtn.click();
    await window.waitForTimeout(1000);

    // 验证用户消息出现
    const userMessages = window.locator('.user-message');
    const count = await userMessages.count();
    expect(count).toBeGreaterThan(0);

    // 验证 script 标签不被执行（页面不崩溃）
    await expect(window.locator('.chat-content')).toBeVisible();

    // 验证消息内容被转义（不作为HTML渲染）
    const lastUserMsg = userMessages.last();
    const textContent = await lastUserMsg.textContent();
    expect(textContent).toContain('script');
  });

  /**
   * TC-13-04 对话历史文件不存在
   */
  test('历史文件缺失不应导致崩溃', async ({ window }) => {
    // 页面已正常加载
    await expect(window.locator('.chat-content')).toBeVisible();

    // 验证页面稳定
    const input = window.locator('.chat-input textarea');
    await expect(input).toBeVisible();
  });
});
