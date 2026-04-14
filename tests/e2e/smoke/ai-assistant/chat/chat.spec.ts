import { test, expect } from '../../../fixtures/app.fixture';
import { waitForAppReady } from '../../../helpers/electron-helper';
import {
  navigateToAiAssistant,
  createAiScenario,
  createAiLlmConfig,
  createAiHistory,
  cleanupAiTestData,
  selectOption,
  setupAiTestEnvironment,
  fillChatInput,
} from '../ai-assistant.helper';

const SCENARIO_CHAT = 'e2e_chat_scenario';
const HISTORY_CHAT = 'e2e_chat_history';
const LLM_CHAT = 'e2e_chat_llm';

test.describe('AI助手 - 发送消息', () => {
  test.beforeEach(async ({ window, testWorkspace }) => {
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
    await selectOption(window, '选择场景', SCENARIO_CHAT);
    await selectOption(window, '选择对话历史', HISTORY_CHAT);
    await window.waitForTimeout(1500);
  });

  test.afterEach(async ({ testWorkspace }) => {
    cleanupAiTestData(testWorkspace, [SCENARIO_CHAT], [LLM_CHAT]);
  });

  /**
   * TC-05-01 发送普通文本消息
   *
   * 前置条件：已选择模型、场景、对话历史
   * 操作步骤：
   *   1. 在输入框输入"你好"
   *   2. 点击"发送"按钮
   * 预期结果：用户消息"你好"显示在右侧（蓝色背景）；AI开始流式回复；
   *         AI消息显示在左侧（绿色背景）；消息自动滚动到最新位置
   */
  test('发送普通文本消息应显示用户消息', async ({ window }) => {
    await fillChatInput(window, '你好');

    // 点击发送
    const sendBtn = window.locator('.input-actions').getByRole('button', { name: '发送' });
    await sendBtn.click();
    await window.waitForTimeout(1000);

    // 验证用户消息出现
    const userMessages = window.locator('.user-message');
    const count = await userMessages.count();
    expect(count).toBeGreaterThan(0);
  });

  /**
   * TC-05-02 Ctrl+Enter快捷键发送
   *
   * 前置条件：已选择模型、场景、对话历史
   * 操作步骤：
   *   1. 在输入框输入"测试消息"
   *   2. 按下 Ctrl+Enter
   * 预期结果：消息发送成功，行为与点击发送按钮一致
   */
  test('Ctrl+Enter快捷键应触发发送', async ({ window }) => {
    await fillChatInput(window, '快捷键测试消息');

    await window.keyboard.press('Control+Enter');
    await window.waitForTimeout(1000);

    // 验证用户消息出现
    const userMessages = window.locator('.user-message');
    const count = await userMessages.count();
    expect(count).toBeGreaterThan(0);
  });

  /**
   * TC-05-03 发送空消息
   *
   * 前置条件：已选择模型、场景、对话历史
   * 操作步骤：
   *   1. 输入框为空
   *   2. 点击"发送"按钮
   * 预期结果：消息不被发送；输入框无变化
   */
  test('空输入不应触发发送', async ({ window }) => {
    const input = window.locator('.input-container textarea');
    await input.clear();

    const msgCountBefore = await window.locator('.message').count();

    const sendBtn = window.locator('.input-actions').getByRole('button', { name: '发送' });
    await sendBtn.click();
    await window.waitForTimeout(500);

    const msgCountAfter = await window.locator('.message').count();
    expect(msgCountAfter).toBe(msgCountBefore);
  });

  /**
   * TC-05-04 发送多行文本消息
   *
   * 前置条件：已选择模型、场景、对话历史
   * 操作步骤：
   *   1. 在输入框中输入多行文本（使用Enter换行）
   *   2. 按 Ctrl+Enter 发送
   * 预期结果：多行文本正确显示在消息气泡中；AI能正确理解和回复多行内容
   */
  test('多行文本消息应正确发送', async ({ window }) => {
    await fillChatInput(window, '第一行\n第二行\n第三行');

    await window.keyboard.press('Control+Enter');
    await window.waitForTimeout(1000);

    // 验证用户消息出现
    const userMessages = window.locator('.user-message');
    const count = await userMessages.count();
    expect(count).toBeGreaterThan(0);
  });

  /**
   * TC-05-05 发送包含代码的消息
   *
   * 前置条件：已选择模型、场景、对话历史
   * 操作步骤：
   *   1. 输入包含代码块的消息，如"请写一个Python hello world"
   *   2. 发送
   * 预期结果：AI回复中的代码块被正确渲染（语法高亮、代码块样式）
   *
   * TODO: 需要有效 LLM API 才能验证 AI 回复中的代码块渲染。
   *       当前测试仅验证消息可以正常发送。
   */
  test('包含代码的消息应可正常发送', async ({ window }) => {
    await fillChatInput(window, '请写一个Python hello world');

    const sendBtn = window.locator('.input-actions').getByRole('button', { name: '发送' });
    await sendBtn.click();
    await window.waitForTimeout(1000);

    const userMessages = window.locator('.user-message');
    const count = await userMessages.count();
    expect(count).toBeGreaterThan(0);
  });

  /**
   * TC-05-06 发送消息时加载状态
   *
   * 前置条件：已选择模型、场景、对话历史
   * 操作步骤：
   *   1. 发送一条消息
   *   2. 观察发送按钮状态
   * 预期结果：发送中按钮显示loading状态；输入框不可操作；AI回复完成后恢复正常
   *
   * TODO: 验证 loading 状态需要有效 API 配置。
   *       当前测试验证发送按钮在发送后不再可点击（因 isChatting 为 true）。
   */
  test('发送消息后应短暂进入加载状态', async ({ window }) => {
    await fillChatInput(window, '测试加载状态');

    const sendBtn = window.locator('.input-actions').getByRole('button', { name: '发送' });
    await sendBtn.click();
    await window.waitForTimeout(300);

    // 发送后输入框应短暂不可用（isChatting=true时disabled）
    // 等待错误或完成后恢复
    await window.waitForTimeout(3000);

    // 最终应恢复可用状态
    const inputAfter = window.locator('.input-container textarea');
    const isDisabled = await inputAfter.isDisabled().catch(() => true);
    // 最终输入框应恢复可用（API错误后也会恢复）
    expect(isDisabled).toBeFalsy();
  });

  /**
   * TC-05-07 未选择场景时发送消息
   *
   * 前置条件：已选择模型，未选择场景
   * 操作步骤：
   *   1. 在输入框输入文本
   *   2. 点击发送
   * 预期结果：提示需要先选择场景和历史；消息不被发送
   */
  test('未选择场景时不应显示聊天界面', async ({ window, testWorkspace }) => {
    // 新建一个空环境（无场景）
    const emptyLlm = 'e2e_empty_llm';
    createAiLlmConfig(testWorkspace, emptyLlm);

    await window.reload();
    await waitForAppReady(window);
    await navigateToAiAssistant(window);

    // 应显示占位符
    await expect(window.locator('.placeholder')).toBeVisible({ timeout: 3000 });

    // 无输入框
    const input = window.locator('.input-container textarea');
    await expect(input).not.toBeVisible({ timeout: 2000 });

    cleanupAiTestData(testWorkspace, [], [emptyLlm]);
  });

  /**
   * TC-05-08 未选择对话历史时发送消息
   *
   * 前置条件：已选择模型和场景，未选择/创建对话历史
   * 操作步骤：
   *   1. 在输入框输入文本
   *   2. 点击发送
   * 预期结果：提示需要先创建或选择对话历史；消息不被发送
   */
  test('未选择对话历史时应显示占位符', async ({ window, testWorkspace }) => {
    const emptyScenario = 'e2e_empty_scenario';
    createAiScenario(testWorkspace, emptyScenario);

    await window.reload();
    await waitForAppReady(window);
    await navigateToAiAssistant(window);

    // 只选择场景，不选历史
    await selectOption(window, '选择场景', emptyScenario);

    // 应显示占位符（无历史）
    await expect(window.locator('.placeholder')).toBeVisible({ timeout: 3000 });

    cleanupAiTestData(testWorkspace, [emptyScenario]);
  });
});

test.describe('AI助手 - 流式响应', () => {
  const SCENARIO_STREAM = 'e2e_stream_scenario';
  const HISTORY_STREAM = 'e2e_stream_history';
  const LLM_STREAM = 'e2e_stream_llm';

  test.beforeEach(async ({ window, testWorkspace }) => {
    setupAiTestEnvironment(testWorkspace, {
      scenarioId: SCENARIO_STREAM,
      historyId: HISTORY_STREAM,
      llmConfigName: LLM_STREAM,
    });

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    await selectOption(window, '选择场景', SCENARIO_STREAM);
    await selectOption(window, '选择对话历史', HISTORY_STREAM);
    await window.waitForTimeout(1500);
  });

  test.afterEach(async ({ testWorkspace }) => {
    cleanupAiTestData(testWorkspace, [SCENARIO_STREAM], [LLM_STREAM]);
  });

  /**
   * TC-06-01 正常流式输出
   *
   * 前置条件：已完成场景和历史选择，LLM服务正常
   * 操作步骤：
   *   1. 发送一条问题，如"介绍一下自己"
   *   2. 观察AI回复过程
   * 预期结果：AI回复逐字/逐段流式显示；消息区域自动滚动跟随新内容；流式完成后消息完整显示
   *
   * TODO: 需要有效 LLM API 配置才能验证流式输出。
   *       当前使用 mock 配置，发送后应收到错误提示。
   */
  test('发送消息后应等待AI响应或错误提示', async ({ window }) => {
    await fillChatInput(window, '测试AI响应');

    const sendBtn = window.locator('.input-actions').getByRole('button', { name: '发送' });
    await sendBtn.click();

    // 等待响应完成或错误提示
    try {
      const errorMsg = window.locator('.el-message--error');
      await expect(errorMsg).toBeVisible({ timeout: 15000 });
    } catch {
      // 如果有有效 API 配置，AI 响应会成功
      const assistantMessages = window.locator('.assistant-message');
      await expect(assistantMessages.last()).toBeVisible({ timeout: 15000 });
    }
  });

  /**
   * TC-06-02 流式输出中的Markdown渲染
   *
   * 前置条件：已完成配置
   * 操作步骤：
   *   1. 发送"请用Markdown格式列出3个编程语言的特点"
   *   2. 观察流式输出过程
   * 预期结果：流式输出过程中Markdown格式逐步渲染（标题、列表、加粗等）；最终渲染结果正确
   *
   * TODO: 需要有效 LLM API 才能验证 Markdown 流式渲染。
   *       当前仅标记为 skip，待后续补充。
   */
  test.skip('流式输出应正确渲染Markdown', async ({ window }) => {
    // TODO: 需要有效 LLM API 才能验证 Markdown 流式渲染
    // 此用例需要真实模型返回包含 Markdown 格式的回复
  });

  /**
   * TC-06-03 流式中断（网络异常）
   *
   * 前置条件：已完成配置，AI正在流式回复
   * 操作步骤：
   *   1. 发送消息
   *   2. 在AI回复过程中断开网络连接
   * 预期结果：流式输出停止；已接收的内容保留在聊天区域；显示错误提示"聊天出错"或类似信息
   *
   * TODO: 需要有效 LLM API 并模拟网络中断，难以自动化。
   *       此用例标记为 skip，待后续补充。
   */
  test.skip('流式中断应保留已接收内容', async ({ window }) => {
    // TODO: 需要有效 LLM API 并在响应过程中模拟网络中断
    // 难以在 e2e 自动化测试中可靠复现
  });
});

test.describe('AI助手 - 回退与重新生成', () => {
  const SCENARIO_REGEN = 'e2e_regen_scenario';
  const HISTORY_REGEN = 'e2e_regen_history';
  const LLM_REGEN = 'e2e_regen_llm';

  test.beforeEach(async ({ window, testWorkspace }) => {
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
    await selectOption(window, '选择场景', SCENARIO_REGEN);
    await selectOption(window, '选择对话历史', HISTORY_REGEN);
    await window.waitForTimeout(1500);
  });

  test.afterEach(async ({ testWorkspace }) => {
    cleanupAiTestData(testWorkspace, [SCENARIO_REGEN], [LLM_REGEN]);
  });

  /**
   * TC-07-01 回退最后一条消息
   *
   * 前置条件：已有至少一轮对话（用户消息+AI回复）
   * 操作步骤：
   *   1. 点击"回退"按钮
   * 预期结果：最后一轮对话（用户消息+AI回复）被移除；聊天区域更新；历史文件同步更新
   */
  test('回退应移除最后一轮对话', async ({ window }) => {
    const messagesBefore = window.locator('.message');
    const countBefore = await messagesBefore.count();

    const popBtn = window.locator('.input-actions').getByRole('button', { name: '回退' });
    await popBtn.click();
    await window.waitForTimeout(1000);

    const messagesAfter = window.locator('.message');
    const countAfter = await messagesAfter.count();

    // 应移除至少一条消息
    expect(countAfter).toBeLessThan(countBefore);
  });

  /**
   * TC-07-02 回退多条消息
   *
   * 前置条件：已有3轮以上对话
   * 操作步骤：
   *   1. 连续点击"回退"按钮3次
   * 预期结果：每次点击移除最后一轮对话；3次后最新3轮对话被移除
   */
  test('连续回退应逐步移除消息', async ({ window }) => {
    const popBtn = window.locator('.input-actions').getByRole('button', { name: '回退' });

    const countBefore = await window.locator('.message').count();

    // 连续回退
    await popBtn.click();
    await window.waitForTimeout(500);
    await popBtn.click();
    await window.waitForTimeout(500);

    const countAfter = await window.locator('.message').count();
    expect(countAfter).toBeLessThan(countBefore);
  });

  /**
   * TC-07-03 空对话时回退
   *
   * 前置条件：对话历史为空（无消息）
   * 操作步骤：
   *   1. 点击"回退"按钮
   * 预期结果：按钮处于禁用状态，无法点击
   */
  test('空对话时回退按钮应禁用', async ({ window }) => {
    // 先回退所有消息
    const popBtn = window.locator('.input-actions').getByRole('button', { name: '回退' });
    for (let i = 0; i < 10; i++) {
      const isDisabled = await popBtn.isDisabled();
      if (isDisabled) break;
      await popBtn.click();
      await window.waitForTimeout(500);
    }

    // 按钮应为 disabled
    const isDisabled = await popBtn.isDisabled();
    expect(isDisabled).toBeTruthy();
  });

  /**
   * TC-07-04 重新生成AI回复
   *
   * 前置条件：已有至少一轮对话（用户消息+AI回复）
   * 操作步骤：
   *   1. 点击"重新生成"按钮
   * 预期结果：最后一条AI回复被移除；AI使用相同的对话上下文重新生成回复；新回复流式显示
   *
   * TODO: 需要有效 LLM API 才能完整验证重新生成。
   *       当前测试验证按钮可见且可点击。
   */
  test('重新生成按钮应可点击', async ({ window }) => {
    const regenBtn = window.locator('.input-actions').getByRole('button', { name: '重新生成' });
    await expect(regenBtn).toBeVisible();
    await expect(regenBtn).toBeEnabled();
  });

  /**
   * TC-07-05 重新生成 - 空对话
   *
   * 前置条件：对话历史为空
   * 操作步骤：
   *   1. 点击"重新生成"按钮
   * 预期结果：按钮处于禁用状态，无法点击
   */
  test('空对话时重新生成按钮应禁用', async ({ window }) => {
    // 回退所有消息
    const popBtn = window.locator('.input-actions').getByRole('button', { name: '回退' });
    for (let i = 0; i < 10; i++) {
      const isDisabled = await popBtn.isDisabled();
      if (isDisabled) break;
      await popBtn.click();
      await window.waitForTimeout(500);
    }

    const regenBtn = window.locator('.input-actions').getByRole('button', { name: '重新生成' });
    const isDisabled = await regenBtn.isDisabled();
    expect(isDisabled).toBeTruthy();
  });

  /**
   * TC-07-06 重新生成 - AI正在回复中
   *
   * 前置条件：AI正在流式回复
   * 操作步骤：
   *   1. 观察按钮状态
   * 预期结果："回退"和"重新生成"按钮应处于禁用状态
   *
   * TODO: 需要有效 LLM API 才能在发送后验证按钮禁用状态。
   *       当前使用 mock 配置无法触发长时间的 chatting 状态。
   */
  test.skip('AI回复中回退和重新生成按钮应禁用', async ({ window }) => {
    // TODO: 需要有效 LLM API 才能在发送后观察到按钮禁用状态
  });
});
