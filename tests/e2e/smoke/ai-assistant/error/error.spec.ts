import { test, expect } from '../../../fixtures/app.fixture';
import { waitForAppReady } from '../../../helpers/electron-helper';
import {
  navigateToAiAssistant,
  createAiScenario,
  createAiLlmConfig,
  createAiHistory,
  cleanupAiTestData,
  selectOption,
  fillChatInput,
  getScenarioFilePath,
  getHistoryFilePath,
} from '../ai-assistant.helper';
import fs from 'fs';
import path from 'path';

test.describe('AI助手 - 错误处理', () => {
  /**
   * TC-12-01 API密钥无效
   *
   * 前置条件：LLM配置中的API Key为无效值
   * 操作步骤：
   *   1. 选择该LLM配置
   *   2. 发送消息
   * 预期结果：聊天区域显示错误提示（如认证失败）；不出现应用崩溃
   *
   * TODO: 默认测试配置 base_url 指向 example.com，本身就无法连接。
   *       此用例验证无效配置下发送消息能优雅处理错误。
   */
  test('无效LLM配置发送消息应提示错误', async ({ window, testWorkspace }) => {
    const scenarioId = 'e2e_err_api_scenario';
    const historyId = 'e2e_err_api_hist';
    const llmName = 'e2e_err_api_llm';

    createAiScenario(testWorkspace, scenarioId);
    createAiLlmConfig(testWorkspace, llmName, { key: 'invalid-key-12345' });
    createAiHistory(testWorkspace, scenarioId, historyId);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    await selectOption(window, '选择场景', scenarioId);
    await selectOption(window, '选择对话历史', historyId);
    await window.waitForTimeout(1500);

    // 发送消息
    await fillChatInput(window, '测试无效API');

    const sendBtn = window.locator('.input-actions').getByRole('button', { name: '发送' });
    await sendBtn.click();

    // 等待错误提示
    const errorMsg = window.locator('.el-message--error');
    await expect(errorMsg).toBeVisible({ timeout: 15000 });

    // 验证发送按钮恢复正常
    await window.waitForTimeout(1000);
    const inputAfter = window.locator('.input-container textarea');
    const isDisabled = await inputAfter.isDisabled().catch(() => true);
    expect(isDisabled).toBeFalsy();

    cleanupAiTestData(testWorkspace, [scenarioId], [llmName]);
  });

  /**
   * TC-12-02 网络不可达
   *
   * 前置条件：LLM服务地址不可达（如错误的base_url）
   * 操作步骤：
   *   1. 选择该LLM配置
   *   2. 发送消息
   * 预期结果：显示网络连接错误信息；提示"发送消息失败"；已有对话数据不受影响
   */
  test('base_url不可达应提示错误', async ({ window, testWorkspace }) => {
    const scenarioId = 'e2e_err_url_scenario';
    const historyId = 'e2e_err_url_hist';
    const llmName = 'e2e_err_url_llm';

    createAiScenario(testWorkspace, scenarioId);
    createAiLlmConfig(testWorkspace, llmName, {
      base_url: 'https://invalid-host-that-does-not-exist.example.com/v1',
    });
    createAiHistory(testWorkspace, scenarioId, historyId, [
      { role: 'assistant', content: '之前的消息应保留' },
    ]);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    await selectOption(window, '选择场景', scenarioId);
    await selectOption(window, '选择对话历史', historyId);
    await window.waitForTimeout(1500);

    // 记录初始消息数
    const msgCountBefore = await window.locator('.message').count();

    // 发送消息
    await fillChatInput(window, '测试不可达URL');

    const sendBtn = window.locator('.input-actions').getByRole('button', { name: '发送' });
    await sendBtn.click();

    // 等待错误提示
    const errorMsg = window.locator('.el-message--error');
    await expect(errorMsg).toBeVisible({ timeout: 15000 });

    // 验证已有消息数据未丢失
    const msgCountAfter = await window.locator('.message').count();
    expect(msgCountAfter).toBeGreaterThanOrEqual(msgCountBefore);

    cleanupAiTestData(testWorkspace, [scenarioId], [llmName]);
  });

  /**
   * TC-12-03 LLM返回错误响应
   *
   * 前置条件：LLM服务正常但模型返回错误
   * 操作步骤：
   *   1. 发送超长上下文触发token限制错误
   * 预期结果：错误信息显示在聊天区域；提示具体错误原因（如context length exceeded）
   *
   * TODO: 需要有效但会返回错误的 LLM API 配置才能测试。
   *       当前测试使用不可达 URL，行为类似 TC-12-02。
   *       此用例标记为 skip，待后续补充。
   */
  test.skip('LLM返回错误响应应显示错误信息', async ({ window }) => {
    // TODO: 需要有效 LLM API 配置，且能触发特定错误（如 token 限制）
    // 此用例需要特殊配置的 API 端点才能自动化测试
  });

  /**
   * TC-12-04 加载LLM配置失败
   *
   * 前置条件：LLM配置文件损坏或格式错误
   * 操作步骤：
   *   1. 打开AI助手页面
   * 预期结果：LLM模型下拉框加载失败时，提示"加载LLM配置失败"；不影响其他功能使用
   */
  test('LLM配置文件损坏不应导致崩溃', async ({ window, testWorkspace }) => {
    const llmName = 'e2e_broken_llm';
    const llmDir = path.join(testWorkspace, 'assistant', 'llm');
    fs.mkdirSync(llmDir, { recursive: true });
    // 写入损坏的 JSON
    fs.writeFileSync(path.join(llmDir, `${llmName}.json`), '{ broken json', 'utf-8');

    await waitForAppReady(window);
    await navigateToAiAssistant(window);

    // 页面不应崩溃
    await expect(window.locator('.ai-assistant-page')).toBeVisible({ timeout: 5000 });

    // 场景选择区域应仍可用
    await expect(window.getByLabel('选择场景').first()).toBeVisible();

    cleanupAiTestData(testWorkspace, [], [llmName]);
  });

  /**
   * TC-12-05 加载场景失败
   *
   * 前置条件：场景配置文件损坏
   * 操作步骤：
   *   1. 打开AI助手页面
   *   2. 查看场景下拉框
   * 预期结果：提示"加载场景失败"；其他功能正常
   */
  test('场景配置损坏时选择场景应不崩溃', async ({ window, testWorkspace }) => {
    const scenarioId = 'e2e_broken_scenario';
    const scenarioDir = path.join(testWorkspace, 'assistant', 'scenario');
    fs.mkdirSync(scenarioDir, { recursive: true });
    // 写入损坏的 JSON
    fs.writeFileSync(path.join(scenarioDir, `${scenarioId}.json`), '{ broken', 'utf-8');

    // 也创建一个有效的 LLM 配置
    createAiLlmConfig(testWorkspace, 'e2e_broken_llm_ok');

    await waitForAppReady(window);
    await navigateToAiAssistant(window);

    // 尝试选择损坏的场景
    try {
      await selectOption(window, '选择场景', scenarioId);
    } catch {
      // 选择可能失败，但不应崩溃
    }

    // 页面应仍然正常
    await expect(window.locator('.ai-assistant-page')).toBeVisible({ timeout: 5000 });

    cleanupAiTestData(testWorkspace, [scenarioId], ['e2e_broken_llm_ok']);
  });
});
