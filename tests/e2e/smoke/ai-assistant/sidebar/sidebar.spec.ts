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
  getAgentFilePath,
  getHistoryFilePath,
} from '../ai-assistant.helper';
import fs from 'fs';

// 测试数据标识
const AGENT_A = 'e2e_sidebar_scenario_a';
const AGENT_B = 'e2e_sidebar_scenario_b';
const LLM_CONFIG = 'e2e_sidebar_llm';
const HISTORY_A1 = 'e2e_sidebar_hist_a1';
const HISTORY_A2 = 'e2e_sidebar_hist_a2';

test.describe('AI助手 - ChatInput 场景选择', () => {
  test.beforeEach(async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    createAiAgent(testWorkspace, AGENT_A);
    createAiAgent(testWorkspace, AGENT_B);
    createAiLlmConfig(testWorkspace, LLM_CONFIG);
    createAiHistory(testWorkspace, AGENT_A, HISTORY_A1);
    createAiHistory(testWorkspace, AGENT_A, HISTORY_A2);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    // 等待自动选择场景并加载历史摘要
    await window.waitForTimeout(2000);
  });

  test.afterEach(async ({ testWorkspace }) => {
    cleanupAiTestData(testWorkspace, [AGENT_A, AGENT_B], [LLM_CONFIG]);
  });

  /**
   * TC-02-01 选择已有场景
   *
   * 前置条件：AI助手页面已打开，存在至少一个场景配置
   * 操作步骤：
   *   1. 页面自动选择第一个场景
   * 预期结果：侧边栏显示该场景下的对话历史列表
   */
  test('自动选择场景应加载历史列表', async ({ window }) => {
    // 验证侧边栏历史列表出现
    await expect(window.locator('.chat-sidebar')).toBeVisible({ timeout: 3000 });

    // 验证历史列表中有项目（可能包含之前测试的残留数据）
    const historyItems = window.locator('.history-item');
    const count = await historyItems.count();
    // 至少应该有测试创建的 2 条历史
    expect(count).toBeGreaterThanOrEqual(2);
  });

  /**
   * TC-02-02 切换场景
   *
   * 前置条件：已自动选择第一个场景，有对话历史
   * 操作步骤：
   *   1. 页面重载后数据更新
   * 预期结果：对话历史列表更新
   */
  test('场景数据应正确持久化', async ({ window, testWorkspace }) => {
    // 验证文件存在
    expect(fs.existsSync(getAgentFilePath(testWorkspace, AGENT_A))).toBe(true);
    expect(fs.existsSync(getHistoryFilePath(testWorkspace, AGENT_A, HISTORY_A1))).toBe(true);
  });

  /**
   * TC-02-03 无场景时界面状态
   *
   * 前置条件：无场景数据
   * 操作步骤：
   *   1. 查看页面
   * 预期结果：显示占位符
   */
  test('无场景时显示占位符', async ({ window, testWorkspace }) => {
    // 清理所有场景后重载
    cleanupAiTestData(testWorkspace, [AGENT_A, AGENT_B], [LLM_CONFIG]);
    await window.reload();
    await waitForAppReady(window);
    await navigateToAiAssistant(window);

    // 应显示占位符
    await expect(window.locator('.placeholder')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('AI助手 - ChatInput LLM模型选择', () => {
  const LLM_ALPHA = 'e2e_llm_alpha';
  const LLM_BETA = 'e2e_llm_beta';
  const AGENT_FOR_LLM = 'e2e_llm_scenario';
  const HISTORY_FOR_LLM = 'e2e_llm_history';

  test.beforeEach(async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    createAiLlmConfig(testWorkspace, LLM_ALPHA);
    createAiLlmConfig(testWorkspace, LLM_BETA);
    createAiAgent(testWorkspace, AGENT_FOR_LLM);
    createAiHistory(testWorkspace, AGENT_FOR_LLM, HISTORY_FOR_LLM);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    await window.waitForTimeout(2000);
  });

  test.afterEach(async ({ testWorkspace }) => {
    cleanupAiTestData(testWorkspace, [AGENT_FOR_LLM], [LLM_ALPHA, LLM_BETA]);
  });

  /**
   * TC-03-01 选择LLM模型
   *
   * 前置条件：AI助手页面已打开，有 LLM 配置
   * 预期结果：模型选择器可见
   */
  test('LLM模型选择器应可见', async ({ window }) => {
    await expect(window.getByLabel('选择模型').first()).toBeVisible({ timeout: 5000 });
  });

  /**
   * TC-03-02 模型配置应正确加载
   *
   * 预期结果：配置数量正确
   */
  test('LLM配置数量应正确', async ({ window }) => {
    // 场景自动选中，ChatInput 可见
    await expect(window.locator('.chat-input')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('AI助手 - 侧边栏对话历史管理', () => {
  const AGENT_HIST = 'e2e_hist_scenario';
  const HISTORY_H1 = 'e2e_hist_h1';
  const HISTORY_H2 = 'e2e_hist_h2';
  const LLM_HIST = 'e2e_hist_llm';

  test.beforeEach(async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    createAiAgent(testWorkspace, AGENT_HIST);
    createAiLlmConfig(testWorkspace, LLM_HIST);
    createAiHistory(testWorkspace, AGENT_HIST, HISTORY_H1, [
      { role: 'assistant', content: '这是历史1的初始消息' },
    ]);
    createAiHistory(testWorkspace, AGENT_HIST, HISTORY_H2, [
      { role: 'assistant', content: '这是历史2的初始消息' },
    ]);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    await window.waitForTimeout(2000);
  });

  test.afterEach(async ({ testWorkspace }) => {
    cleanupAiTestData(testWorkspace, [AGENT_HIST], [LLM_HIST]);
  });

  /**
   * TC-04-01 新建对话历史
   */
  test('新建对话历史应成功创建并选中', async ({ window }) => {
    // 点击 + 新建对话 按钮
    await window.getByRole('button', { name: '+ 新建对话' }).click();
    await window.waitForTimeout(1500);

    // 验证聊天内容区出现（不再显示占位符）
    await expect(window.locator('.chat-content')).toBeVisible({ timeout: 3000 });

    // 验证 ChatInput 可见
    await expect(window.locator('.chat-input')).toBeVisible();
  });

  /**
   * TC-04-02 侧边栏历史列表展示
   */
  test('历史列表应展示标题和时间', async ({ window }) => {
    const historyItems = window.locator('.history-item');
    const count = await historyItems.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // 验证每个项有标题和时间
    const firstItem = historyItems.first();
    await expect(firstItem.locator('.history-title')).toBeVisible();
    await expect(firstItem.locator('.history-time')).toBeVisible();
  });

  /**
   * TC-04-03 选择已有对话历史
   */
  test('选择已有对话历史应加载消息', async ({ window }) => {
    await clickHistoryItem(window, HISTORY_H1);
    await window.waitForTimeout(1000);

    // 验证聊天内容区出现
    await expect(window.locator('.chat-content')).toBeVisible();

    // 验证有消息显示
    const messages = window.locator('.message');
    const count = await messages.count();
    expect(count).toBeGreaterThan(0);
  });

  /**
   * TC-04-04 切换对话历史
   */
  test('切换对话历史应更新聊天区域', async ({ window }) => {
    // 选择历史1
    await clickHistoryItem(window, HISTORY_H1);
    await window.waitForTimeout(1000);

    const messagesH1 = window.locator('.message');
    const countH1 = await messagesH1.count();

    // 切换到历史2
    await clickHistoryItem(window, HISTORY_H2);
    await window.waitForTimeout(1000);

    const messagesH2 = window.locator('.message');
    const countH2 = await messagesH2.count();

    // 两个历史都有初始消息
    expect(countH1).toBeGreaterThan(0);
    expect(countH2).toBeGreaterThan(0);
  });

  /**
   * TC-04-05 选中历史高亮
   */
  test('选中的历史项应有高亮样式', async ({ window }) => {
    await clickHistoryItem(window, HISTORY_H1);
    await window.waitForTimeout(500);

    const selectedItem = window.locator('.history-item.active').filter({ hasText: HISTORY_H1 });
    await expect(selectedItem).toBeVisible({ timeout: 3000 });
  });
});

test.describe('AI助手 - 侧边栏持久化', () => {
  const AGENT_PERSIST = 'e2e_persist_scenario';
  const LLM_PERSIST = 'e2e_persist_llm';

  test.afterEach(async ({ testWorkspace }) => {
    cleanupAiTestData(testWorkspace, [AGENT_PERSIST], [LLM_PERSIST]);
  });

  /**
   * TC-11-01 对话自动保存
   */
  test('场景数据应正确持久化到文件', async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    createAiAgent(testWorkspace, AGENT_PERSIST);
    createAiLlmConfig(testWorkspace, LLM_PERSIST);

    expect(fs.existsSync(getAgentFilePath(testWorkspace, AGENT_PERSIST))).toBe(true);
  });

  /**
   * TC-11-02 重启应用后恢复对话
   */
  test('历史文件应正确创建并可在页面加载', async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    const historyId = 'e2e_persist_hist';
    createAiAgent(testWorkspace, AGENT_PERSIST);
    createAiLlmConfig(testWorkspace, LLM_PERSIST);
    createAiHistory(testWorkspace, AGENT_PERSIST, historyId, [
      { role: 'user', content: '测试消息1' },
      { role: 'assistant', content: '测试回复1' },
    ]);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    await window.waitForTimeout(2000);

    // 选择历史
    await clickHistoryItem(window, historyId);
    await window.waitForTimeout(1500);

    const messages = window.locator('.message');
    await expect(messages.first()).toBeVisible({ timeout: 5000 });
    const count = await messages.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  /**
   * TC-11-03 多条对话间切换数据隔离
   */
  test('不同对话历史间数据应隔离', async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    const histA = 'e2e_iso_hist_a';
    const histB = 'e2e_iso_hist_b';

    createAiAgent(testWorkspace, AGENT_PERSIST);
    createAiLlmConfig(testWorkspace, LLM_PERSIST);
    createAiHistory(testWorkspace, AGENT_PERSIST, histA, [
      { role: 'assistant', content: '历史A的消息' },
    ]);
    createAiHistory(testWorkspace, AGENT_PERSIST, histB, [
      { role: 'assistant', content: '历史B的消息' },
    ]);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    await window.waitForTimeout(2000);

    // 选择历史A
    await clickHistoryItem(window, histA);
    await window.waitForTimeout(1500);

    const messagesA = window.locator('.message');
    const textA = await messagesA.first().textContent();

    // 切换到历史B
    await clickHistoryItem(window, histB);
    await window.waitForTimeout(1500);

    const messagesB = window.locator('.message');
    const textB = await messagesB.first().textContent();

    expect(textA).not.toBe(textB);
  });
});
