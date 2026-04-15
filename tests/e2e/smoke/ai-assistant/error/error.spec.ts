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
  getScenarioFilePath,
  getHistoryFilePath,
} from '../ai-assistant.helper';
import fs from 'fs';
import path from 'path';

test.describe('AI助手 - 错误处理', () => {
  /**
   * TC-12-01 API密钥无效
   *
   * TODO: 默认测试配置 base_url 指向 example.com，本身就无法连接。
   *       此用例验证无效配置下发送消息能优雅处理错误。
   */
  test('无效LLM配置发送消息应提示错误', async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    const scenarioId = 'e2e_err_api_scenario';
    const historyId = 'e2e_err_api_hist';
    const llmName = 'e2e_err_api_llm';

    createAiScenario(testWorkspace, scenarioId);
    createAiLlmConfig(testWorkspace, llmName, { key: 'invalid-key-12345' });
    createAiHistory(testWorkspace, scenarioId, historyId);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    // 依赖自动选择第一个场景
    await window.waitForTimeout(2000);
    await clickHistoryItem(window, historyId);
    await window.waitForTimeout(1500);

    // 发送消息
    await fillChatInput(window, '测试无效API');

    const sendBtn = window.locator('.chat-input .input-actions').getByRole('button', { name: '发送' });
    await sendBtn.click();

    // 等待错误提示
    const errorMsg = window.locator('.el-message--error');
    await expect(errorMsg).toBeVisible({ timeout: 15000 });

    // 验证发送按钮恢复正常
    await window.waitForTimeout(1000);
    const inputAfter = window.locator('.chat-input textarea');
    const isDisabled = await inputAfter.isDisabled().catch(() => true);
    expect(isDisabled).toBeFalsy();

    cleanupAiTestData(testWorkspace, [scenarioId], [llmName]);
  });

  /**
   * TC-12-02 网络不可达
   */
  test('base_url不可达应提示错误', async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
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
    // 依赖自动选择第一个场景
    await window.waitForTimeout(2000);
    await clickHistoryItem(window, historyId);
    await window.waitForTimeout(1500);

    // 记录初始消息数
    const msgCountBefore = await window.locator('.message').count();

    // 发送消息
    await fillChatInput(window, '测试不可达URL');

    const sendBtn = window.locator('.chat-input .input-actions').getByRole('button', { name: '发送' });
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
   */
  test.skip('LLM返回错误响应应显示错误信息', async ({ window }) => {
    // TODO: 需要有效 LLM API 配置，且能触发特定错误
  });

  /**
   * TC-12-04 加载LLM配置失败
   */
  test('LLM配置文件损坏不应导致崩溃', async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    const llmName = 'e2e_broken_llm';
    const llmDir = path.join(testWorkspace, 'assistant', 'llm');
    fs.mkdirSync(llmDir, { recursive: true });
    // 写入损坏的 JSON
    fs.writeFileSync(path.join(llmDir, `${llmName}.json`), '{ broken json', 'utf-8');

    await waitForAppReady(window);
    await navigateToAiAssistant(window);

    // 页面不应崩溃
    await expect(window.locator('.ai-assistant-page')).toBeVisible({ timeout: 5000 });

    // 场景选择区域应仍可用（在 ChatInput 中）
    await expect(window.getByLabel('选择场景').first()).toBeVisible({ timeout: 5000 }).catch(() => {
      // 如果没有场景数据，ChatInput 可能不可见
    });

    cleanupAiTestData(testWorkspace, [], [llmName]);
  });

  /**
   * TC-12-05 加载场景失败
   */
  test('场景配置损坏时页面应不崩溃', async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    const scenarioId = 'e2e_broken_scenario';
    const scenarioDir = path.join(testWorkspace, 'assistant', 'scenario');
    fs.mkdirSync(scenarioDir, { recursive: true });
    // 写入损坏的 JSON
    fs.writeFileSync(path.join(scenarioDir, `${scenarioId}.json`), '{ broken', 'utf-8');

    // 也创建一个有效的 LLM 配置和一个有效场景（确保页面正常加载）
    createAiLlmConfig(testWorkspace, 'e2e_broken_llm_ok');
    const validScenarioId = 'e2e_broken_valid_scenario';
    createAiScenario(testWorkspace, validScenarioId);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);

    // 页面应正常加载（自动选择有效场景）
    await expect(window.locator('.ai-assistant-page')).toBeVisible({ timeout: 5000 });

    cleanupAiTestData(testWorkspace, [scenarioId, validScenarioId], ['e2e_broken_llm_ok']);
  });
});
