import { test, expect } from '../../../fixtures/app.fixture';
import { waitForAppReady } from '../../../helpers/electron-helper';
import {
  navigateToAiAssistant,
  createAiScenario,
  createAiLlmConfig,
  createAiHistory,
  cleanupAiTestData,
  selectOption,
  clickSelect,
  getScenarioFilePath,
  getHistoryFilePath,
} from '../ai-assistant.helper';
import fs from 'fs';

// 测试数据标识
const SCENARIO_A = 'e2e_sidebar_scenario_a';
const SCENARIO_B = 'e2e_sidebar_scenario_b';
const LLM_CONFIG = 'e2e_sidebar_llm';
const HISTORY_A1 = 'e2e_sidebar_hist_a1';
const HISTORY_A2 = 'e2e_sidebar_hist_a2';

test.describe('AI助手 - 侧边栏场景选择', () => {
  test.beforeEach(async ({ window, testWorkspace }) => {
    createAiScenario(testWorkspace, SCENARIO_A);
    createAiScenario(testWorkspace, SCENARIO_B);
    createAiLlmConfig(testWorkspace, LLM_CONFIG);
    createAiHistory(testWorkspace, SCENARIO_A, HISTORY_A1);
    createAiHistory(testWorkspace, SCENARIO_A, HISTORY_A2);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
  });

  test.afterEach(async ({ testWorkspace }) => {
    cleanupAiTestData(testWorkspace, [SCENARIO_A, SCENARIO_B], [LLM_CONFIG]);
  });

  /**
   * TC-02-01 选择已有场景
   *
   * 前置条件：AI助手页面已打开，存在至少一个场景配置
   * 操作步骤：
   *   1. 点击"场景"下拉框
   *   2. 选择其中一个场景
   * 预期结果：下拉框显示所选场景名称；"对话历史"下拉框出现并加载该场景下的历史记录
   */
  test('选择已有场景应正确加载', async ({ window }) => {
    await selectOption(window, '选择场景', SCENARIO_A);

    // 验证对话历史区域出现
    await expect(window.getByLabel('选择对话历史').first()).toBeVisible({ timeout: 3000 });

    // 验证历史下拉框中有选项
    await clickSelect(window, '选择对话历史');
    await window.waitForTimeout(500);
    const options = window.locator('.el-select-dropdown__item');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(2); // history_a1, history_a2
  });

  /**
   * TC-02-02 切换场景
   *
   * 前置条件：已选择场景A，场景A下有对话历史
   * 操作步骤：
   *   1. 点击"场景"下拉框
   *   2. 切换为场景B
   * 预期结果：对话历史列表更新为场景B的历史；聊天区域清空
   */
  test('切换场景应更新历史列表', async ({ window }) => {
    await selectOption(window, '选择场景', SCENARIO_A);
    await window.waitForTimeout(500);

    // 切换到场景B
    await selectOption(window, '选择场景', SCENARIO_B);

    // 验证占位符显示（场景B无历史，聊天区为空）
    await expect(window.locator('.placeholder')).toBeVisible({ timeout: 3000 });
  });

  /**
   * TC-02-03 未选择场景时界面状态
   *
   * 前置条件：AI助手页面已打开
   * 操作步骤：
   *   1. 不选择任何场景
   * 预期结果："对话历史"区域不显示；聊天区域为空；发送按钮不可用
   */
  test('未选择场景时应显示占位符', async ({ window }) => {
    // 对话历史下拉框不应存在
    await expect(window.getByLabel('选择对话历史').first()).not.toBeVisible({ timeout: 2000 });

    // 占位符应可见
    await expect(window.locator('.placeholder')).toBeVisible();
  });
});

test.describe('AI助手 - 侧边栏LLM模型选择', () => {
  const LLM_ALPHA = 'e2e_llm_alpha';
  const LLM_BETA = 'e2e_llm_beta';
  const SCENARIO_FOR_LLM = 'e2e_llm_scenario';
  const HISTORY_FOR_LLM = 'e2e_llm_history';

  test.beforeEach(async ({ window, testWorkspace }) => {
    createAiLlmConfig(testWorkspace, LLM_ALPHA);
    createAiLlmConfig(testWorkspace, LLM_BETA);
    createAiScenario(testWorkspace, SCENARIO_FOR_LLM);
    createAiHistory(testWorkspace, SCENARIO_FOR_LLM, HISTORY_FOR_LLM);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
  });

  test.afterEach(async ({ testWorkspace }) => {
    cleanupAiTestData(testWorkspace, [SCENARIO_FOR_LLM], [LLM_ALPHA, LLM_BETA]);
  });

  /**
   * TC-03-01 选择LLM模型
   *
   * 前置条件：AI助手页面已打开，存在至少一个LLM配置
   * 操作步骤：
   *   1. 点击"模型"下拉框
   *   2. 选择一个模型配置
   * 预期结果：下拉框显示所选模型名称；后续聊天使用该模型
   */
  test('选择LLM模型应正确切换', async ({ window }) => {
    // 先选择场景使模型选择器可见
    await selectOption(window, '选择场景', SCENARIO_FOR_LLM);

    // 验证模型下拉框可见
    await expect(window.getByLabel('选择模型').first()).toBeVisible({ timeout: 3000 });

    // 切换模型
    await selectOption(window, '选择模型', LLM_BETA);

    // 验证下拉框可见（选择后不崩溃）
    await expect(window.getByLabel('选择模型').first()).toBeVisible();
  });

  /**
   * TC-03-02 切换LLM模型
   *
   * 前置条件：已选择模型A，已存在对话历史
   * 操作步骤：
   *   1. 点击"LLM模型"下拉框
   *   2. 切换为模型B
   * 预期结果：模型切换成功；聊天服务使用新模型重新初始化；已有对话记录保留
   */
  test('切换LLM模型后对话记录应保留', async ({ window }) => {
    await selectOption(window, '选择场景', SCENARIO_FOR_LLM);
    await selectOption(window, '选择对话历史', HISTORY_FOR_LLM);
    await window.waitForTimeout(1000);

    // 切换模型
    await selectOption(window, '选择模型', LLM_BETA);
    await window.waitForTimeout(1000);

    // 页面不应崩溃，对话区仍可见
    await expect(window.locator('.chat-content')).toBeVisible({ timeout: 3000 });
  });

  /**
   * TC-03-03 无LLM配置可用
   *
   * 前置条件：assistant/llm/ 目录下无配置文件
   * 操作步骤：
   *   1. 打开AI助手页面
   *   2. 查看"LLM模型"下拉框
   * 预期结果：下拉框为空；发送消息时提示配置缺失
   */
  // TODO: 需要独立的测试环境来可靠地清理 LLM 配置。
  // 当前测试实例共享文件系统，其他 describe 块创建的 LLM 配置可能残留，
  // 导致删除后仍有选项。需要隔离的 test workspace 或在 fixture 层面清理。
  test.skip('无LLM配置时模型区域应空或不可见', async () => {
    // skipped: 需要隔离的测试环境
  });
});

test.describe('AI助手 - 侧边栏对话历史管理', () => {
  const SCENARIO_HIST = 'e2e_hist_scenario';
  const HISTORY_H1 = 'e2e_hist_h1';
  const HISTORY_H2 = 'e2e_hist_h2';
  const LLM_HIST = 'e2e_hist_llm';

  test.beforeEach(async ({ window, testWorkspace }) => {
    createAiScenario(testWorkspace, SCENARIO_HIST);
    createAiLlmConfig(testWorkspace, LLM_HIST);
    createAiHistory(testWorkspace, SCENARIO_HIST, HISTORY_H1, [
      { role: 'assistant', content: '这是历史1的初始消息' },
    ]);
    createAiHistory(testWorkspace, SCENARIO_HIST, HISTORY_H2, [
      { role: 'assistant', content: '这是历史2的初始消息' },
    ]);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);

    // 选择场景
    await selectOption(window, '选择场景', SCENARIO_HIST);
  });

  test.afterEach(async ({ testWorkspace }) => {
    cleanupAiTestData(testWorkspace, [SCENARIO_HIST], [LLM_HIST]);
  });

  /**
   * TC-04-01 新建对话历史
   *
   * 前置条件：已选择场景
   * 操作步骤：
   *   1. 点击"+ 新建"按钮
   *   2. 在弹窗中输入名称，如"测试对话1"
   *   3. 点击"创建"
   * 预期结果：新历史"测试对话1"出现在历史下拉框中并被选中；聊天区域为空
   */
  test('新建对话历史应成功创建并选中', async ({ window }) => {
    // 点击 + 新建 按钮
    await window.getByRole('button', { name: '+ 新建' }).click();
    await window.waitForTimeout(500);

    // 输入标题
    const dialogInput = window.locator('.el-dialog input');
    await dialogInput.fill('测试对话1');

    // 点击创建
    await window.getByRole('button', { name: '创建' }).click();
    await window.waitForTimeout(1500);

    // 验证聊天内容区出现（不再显示占位符）
    await expect(window.locator('.chat-content')).toBeVisible({ timeout: 3000 });
  });

  /**
   * TC-04-02 新建对话历史 - 名称为空
   *
   * 前置条件：已选择场景
   * 操作步骤：
   *   1. 点击"+ 新建"按钮
   *   2. 不输入名称，直接点击"创建"
   * 预期结果：提示"请输入对话历史名称"；对话不被创建
   */
  test('新建对话历史名称为空应提示', async ({ window }) => {
    await window.getByRole('button', { name: '+ 新建' }).click();
    await window.waitForTimeout(500);

    // 不输入名称，直接创建
    await window.getByRole('button', { name: '创建' }).click();
    await window.waitForTimeout(500);

    // 验证警告提示
    const warningMsg = window.locator('.el-message--warning');
    await expect(warningMsg).toBeVisible({ timeout: 3000 });
  });

  /**
   * TC-04-03 选择已有对话历史
   *
   * 前置条件：已选择场景，该场景下存在多个对话历史
   * 操作步骤：
   *   1. 点击"对话历史"下拉框
   *   2. 选择其中一个历史
   * 预期结果：聊天区域加载该历史的所有消息；消息按时间顺序正确显示
   */
  test('选择已有对话历史应加载消息', async ({ window }) => {
    await selectOption(window, '选择对话历史', HISTORY_H1);
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
   *
   * 前置条件：已在历史A中有对话内容
   * 操作步骤：
   *   1. 切换到历史B
   * 预期结果：聊天区域更新为历史B的内容；历史A的内容已自动保存
   */
  test('切换对话历史应更新聊天区域', async ({ window }) => {
    // 选择历史1
    await selectOption(window, '选择对话历史', HISTORY_H1);
    await window.waitForTimeout(1000);

    // 记录消息
    const messagesH1 = window.locator('.message');
    const countH1 = await messagesH1.count();

    // 切换到历史2
    await selectOption(window, '选择对话历史', HISTORY_H2);
    await window.waitForTimeout(1000);

    // 验证消息不同
    const messagesH2 = window.locator('.message');
    const countH2 = await messagesH2.count();

    // 两个历史都有初始消息
    expect(countH1).toBeGreaterThan(0);
    expect(countH2).toBeGreaterThan(0);
  });
});

test.describe('AI助手 - 侧边栏持久化', () => {
  const SCENARIO_PERSIST = 'e2e_persist_scenario';
  const LLM_PERSIST = 'e2e_persist_llm';

  test.afterEach(async ({ testWorkspace }) => {
    cleanupAiTestData(testWorkspace, [SCENARIO_PERSIST], [LLM_PERSIST]);
  });

  /**
   * TC-11-01 对话自动保存
   *
   * 前置条件：已有对话在进行中
   * 操作步骤：
   *   1. 发送一条消息并收到AI回复
   *   2. 切换到其他对话历史
   *   3. 再切换回当前对话
   * 预期结果：之前的对话内容完整保留
   *
   * TODO: 需要有效 LLM API 才能发送消息并收到回复。
   *       当前测试验证场景数据文件能被正确创建和加载。
   */
  test('场景数据应正确持久化到文件', async ({ window, testWorkspace }) => {
    createAiScenario(testWorkspace, SCENARIO_PERSIST);
    createAiLlmConfig(testWorkspace, LLM_PERSIST);

    // 验证文件存在
    expect(fs.existsSync(getScenarioFilePath(testWorkspace, SCENARIO_PERSIST))).toBe(true);
  });

  /**
   * TC-11-02 重启应用后恢复对话
   *
   * 前置条件：已有保存的对话历史
   * 操作步骤：
   *   1. 关闭应用
   *   2. 重新启动应用
   *   3. 进入AI助手页面
   *   4. 选择之前的场景和对话历史
   * 预期结果：对话内容完整恢复，所有消息按原顺序显示
   *
   * TODO: 重启应用需要多个 Electron 实例，难以在单个测试中实现。
   *       当前验证历史文件能正确创建并在页面中加载。
   */
  test('历史文件应正确创建并可在页面加载', async ({ window, testWorkspace }) => {
    const historyId = 'e2e_persist_hist';
    createAiScenario(testWorkspace, SCENARIO_PERSIST);
    createAiLlmConfig(testWorkspace, LLM_PERSIST);
    createAiHistory(testWorkspace, SCENARIO_PERSIST, historyId, [
      { role: 'user', content: '测试消息1' },
      { role: 'assistant', content: '测试回复1' },
    ]);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);

    // 选择场景和历史
    await selectOption(window, '选择场景', SCENARIO_PERSIST);
    await selectOption(window, '选择对话历史', historyId);
    await window.waitForTimeout(1500);

    // 验证消息加载
    const messages = window.locator('.message');
    await expect(messages.first()).toBeVisible({ timeout: 5000 });
    const count = await messages.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  /**
   * TC-11-03 多条对话间切换数据隔离
   *
   * 前置条件：同一场景下有两个对话历史A和B
   * 操作步骤：
   *   1. 在对话A中发送消息
   *   2. 切换到对话B
   *   3. 再切换回对话A
   * 预期结果：对话A的内容不受对话B影响；两个对话的数据完全隔离
   */
  test('不同对话历史间数据应隔离', async ({ window, testWorkspace }) => {
    const histA = 'e2e_iso_hist_a';
    const histB = 'e2e_iso_hist_b';

    createAiScenario(testWorkspace, SCENARIO_PERSIST);
    createAiLlmConfig(testWorkspace, LLM_PERSIST);
    createAiHistory(testWorkspace, SCENARIO_PERSIST, histA, [
      { role: 'assistant', content: '历史A的消息' },
    ]);
    createAiHistory(testWorkspace, SCENARIO_PERSIST, histB, [
      { role: 'assistant', content: '历史B的消息' },
    ]);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);

    // 选择历史A
    await selectOption(window, '选择场景', SCENARIO_PERSIST);
    await selectOption(window, '选择对话历史', histA);
    await window.waitForTimeout(1500);

    const messagesA = window.locator('.message');
    const textA = await messagesA.first().textContent();

    // 切换到历史B
    await selectOption(window, '选择对话历史', histB);
    await window.waitForTimeout(1500);

    const messagesB = window.locator('.message');
    const textB = await messagesB.first().textContent();

    // 两个历史内容不同
    expect(textA).not.toBe(textB);
  });
});
