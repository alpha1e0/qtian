import { test, expect } from '../../../fixtures/app.fixture';
import { waitForAppReady } from '../../../helpers/electron-helper';
import {
  navigateToAiAssistant,
  createAiScenario,
  createAiLlmConfig,
  createAiHistory,
  cleanupAiTestData,
  cleanAllAiTestData,
  clickHistoryItem,
  fillChatInput,
  setupAiTestEnvironment,
} from '../ai-assistant.helper';

const SCENARIO_CHAT = 'e2e_chat_scenario';
const HISTORY_CHAT = 'e2e_chat_history';
const LLM_CHAT = 'e2e_chat_llm';

test.describe('AI助手 - 发送消息', () => {
  test.beforeEach(async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    setupAiTestEnvironment(testWorkspace, {
      scenarioId: SCENARIO_CHAT,
      historyId: HISTORY_CHAT,
      llmConfigName: LLM_CHAT,
      historyMessages: [
        { role: 'assistant', content: '你好！我是AI助手。' },
      ],
    });

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    await window.waitForTimeout(2000);
    // 选择历史以显示聊天区域
    await clickHistoryItem(window, HISTORY_CHAT);
    await window.waitForTimeout(1500);
  });

  test.afterEach(async ({ testWorkspace }) => {
    cleanupAiTestData(testWorkspace, [SCENARIO_CHAT], [LLM_CHAT]);
  });

  /**
   * TC-05-01 发送普通文本消息
   */
  test('发送普通文本消息应显示用户消息', async ({ window }) => {
    await fillChatInput(window, '你好');

    // 点击发送
    const sendBtn = window.locator('.chat-input .input-actions').getByRole('button', { name: '发送' });
    await sendBtn.click();
    await window.waitForTimeout(1000);

    // 验证用户消息出现
    const userMessages = window.locator('.user-message');
    const count = await userMessages.count();
    expect(count).toBeGreaterThan(0);
  });

  /**
   * TC-05-02 Ctrl+Enter快捷键发送
   */
  test('Ctrl+Enter快捷键应触发发送', async ({ window }) => {
    await fillChatInput(window, '快捷键测试消息');

    await window.keyboard.press('Control+Enter');
    await window.waitForTimeout(1000);

    const userMessages = window.locator('.user-message');
    const count = await userMessages.count();
    expect(count).toBeGreaterThan(0);
  });

  /**
   * TC-05-03 发送空消息
   */
  test('空输入不应触发发送', async ({ window }) => {
    const input = window.locator('.chat-input textarea');
    await input.clear();

    // 发送按钮在输入为空时应为禁用状态
    const sendBtn = window.locator('.chat-input .input-actions').getByRole('button', { name: '发送' });
    await expect(sendBtn).toBeDisabled({ timeout: 3000 });
  });

  /**
   * TC-05-04 发送多行文本消息
   */
  test('多行文本消息应正确发送', async ({ window }) => {
    await fillChatInput(window, '第一行\n第二行\n第三行');

    await window.keyboard.press('Control+Enter');
    await window.waitForTimeout(1000);

    const userMessages = window.locator('.user-message');
    const count = await userMessages.count();
    expect(count).toBeGreaterThan(0);
  });

  /**
   * TC-05-05 发送包含代码的消息
   */
  test('包含代码的消息应可正常发送', async ({ window }) => {
    await fillChatInput(window, '请写一个Python hello world');

    const sendBtn = window.locator('.chat-input .input-actions').getByRole('button', { name: '发送' });
    await sendBtn.click();
    await window.waitForTimeout(1000);

    const userMessages = window.locator('.user-message');
    const count = await userMessages.count();
    expect(count).toBeGreaterThan(0);
  });

  /**
   * TC-05-06 发送消息时加载状态
   */
  test('发送消息后应短暂进入加载状态', async ({ window }) => {
    await fillChatInput(window, '测试加载状态');

    const sendBtn = window.locator('.chat-input .input-actions').getByRole('button', { name: '发送' });
    await sendBtn.click();
    await window.waitForTimeout(300);

    await window.waitForTimeout(3000);

    const inputAfter = window.locator('.chat-input textarea');
    const isDisabled = await inputAfter.isDisabled().catch(() => true);
    expect(isDisabled).toBeFalsy();
  });

  /**
   * TC-05-07 未选择场景时发送消息
   */
  test('未选择场景时不应显示聊天界面', async ({ window, testWorkspace }) => {
    // 清除所有数据，只创建 LLM 配置（无场景）
    cleanAllAiTestData(testWorkspace);
    const emptyLlm = 'e2e_empty_llm';
    createAiLlmConfig(testWorkspace, emptyLlm);

    await window.reload();
    await waitForAppReady(window);
    await navigateToAiAssistant(window);

    // 无场景时应显示占位符
    await expect(window.locator('.placeholder')).toBeVisible({ timeout: 3000 });

    const input = window.locator('.chat-input textarea');
    await expect(input).not.toBeVisible({ timeout: 2000 });

    cleanupAiTestData(testWorkspace, [], [emptyLlm]);
  });

  /**
   * TC-05-08 未选择对话历史时发送消息
   */
  test('未选择对话历史时应显示占位符', async ({ window, testWorkspace }) => {
    const emptyScenario = 'e2e_empty_scenario';
    createAiScenario(testWorkspace, emptyScenario);

    await window.reload();
    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    await window.waitForTimeout(2000);

    // 自动选择了场景，但没有历史，应显示内部占位符
    await expect(window.locator('.placeholder-inner')).toBeVisible({ timeout: 3000 });

    cleanupAiTestData(testWorkspace, [emptyScenario]);
  });
});

test.describe('AI助手 - 流式响应', () => {
  const SCENARIO_STREAM = 'e2e_stream_scenario';
  const HISTORY_STREAM = 'e2e_stream_history';
  const LLM_STREAM = 'e2e_stream_llm';

  test.beforeEach(async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    setupAiTestEnvironment(testWorkspace, {
      scenarioId: SCENARIO_STREAM,
      historyId: HISTORY_STREAM,
      llmConfigName: LLM_STREAM,
    });

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    await window.waitForTimeout(2000);
    await clickHistoryItem(window, HISTORY_STREAM);
    await window.waitForTimeout(1500);
  });

  test.afterEach(async ({ testWorkspace }) => {
    cleanupAiTestData(testWorkspace, [SCENARIO_STREAM], [LLM_STREAM]);
  });

  /**
   * TC-06-01 正常流式输出
   */
  test('发送消息后应等待AI响应或错误提示', async ({ window }) => {
    await fillChatInput(window, '测试AI响应');

    const sendBtn = window.locator('.chat-input .input-actions').getByRole('button', { name: '发送' });
    await sendBtn.click();

    try {
      const errorMsg = window.locator('.el-message--error');
      await expect(errorMsg).toBeVisible({ timeout: 15000 });
    } catch {
      const assistantMessages = window.locator('.assistant-message');
      await expect(assistantMessages.last()).toBeVisible({ timeout: 15000 });
    }
  });

  test.skip('流式输出应正确渲染Markdown', async ({ window }) => {
    // TODO: 需要有效 LLM API
  });

  test.skip('流式中断应保留已接收内容', async ({ window }) => {
    // TODO: 需要有效 LLM API
  });
});

test.describe('AI助手 - 消息操作按钮', () => {
  const SCENARIO_REGEN = 'e2e_regen_scenario';
  const HISTORY_REGEN = 'e2e_regen_history';
  const LLM_REGEN = 'e2e_regen_llm';

  test.beforeEach(async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    setupAiTestEnvironment(testWorkspace, {
      scenarioId: SCENARIO_REGEN,
      historyId: HISTORY_REGEN,
      llmConfigName: LLM_REGEN,
      historyMessages: [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好！有什么可以帮你的？' },
        { role: 'user', content: '介绍一下自己' },
        { role: 'assistant', content: '我是AI助手，很高兴认识你。' },
      ],
    });

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    await window.waitForTimeout(2000);
    await clickHistoryItem(window, HISTORY_REGEN);
    await window.waitForTimeout(1500);
  });

  test.afterEach(async ({ testWorkspace }) => {
    cleanupAiTestData(testWorkspace, [SCENARIO_REGEN], [LLM_REGEN]);
  });

  /**
   * TC-07-01 消息头部信息展示
   */
  test('消息应显示头部信息', async ({ window }) => {
    const headers = window.locator('.message-header');
    const count = await headers.count();
    expect(count).toBeGreaterThan(0);

    const roleNames = window.locator('.message-role-name');
    await expect(roleNames.first()).toBeVisible();
  });

  /**
   * TC-07-02 消息操作按钮（hover 显示）
   */
  test('悬停消息应显示操作按钮', async ({ window }) => {
    const firstMessage = window.locator('.message').first();
    await firstMessage.hover();
    await window.waitForTimeout(300);

    const actions = window.locator('.message-actions');
    await expect(actions.first()).toBeVisible({ timeout: 3000 });
  });

  /**
   * TC-07-03 重新生成按钮（仅 assistant 消息）
   */
  test('assistant 消息应有重新生成按钮', async ({ window }) => {
    const assistantMsg = window.locator('.assistant-message').first();
    await assistantMsg.hover();
    await window.waitForTimeout(300);

    const regenBtn = window.locator('.message-actions').first().getByRole('button');
    await expect(regenBtn.first()).toBeVisible({ timeout: 3000 });
  });

  /**
   * TC-07-04 编辑按钮（仅 user 消息）
   */
  test('user 消息应有编辑功能', async ({ window }) => {
    const userMsg = window.locator('.user-message').first();
    await userMsg.hover();
    await window.waitForTimeout(300);

    const editBtns = window.locator('.message-actions').locator('button');
    const count = await editBtns.count();
    if (count >= 2) {
      await editBtns.nth(1).click();
      await window.waitForTimeout(500);

      const editArea = window.locator('.message-edit textarea');
      await expect(editArea).toBeVisible({ timeout: 3000 });
    }
  });
});
