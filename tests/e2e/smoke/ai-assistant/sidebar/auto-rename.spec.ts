import { test, expect } from '../../../fixtures/app.fixture';
import { waitForAppReady } from '../../../helpers/electron-helper';
import {
  navigateToAiAssistant,
  createAiAgent,
  createAiLlmConfig,
  createAiHistory,
  cleanupAiTestData,
  cleanAllAiTestData,
  getHistoryFilePath,
  getAgentFilePath,
  getLlmConfigFilePath,
} from '../ai-assistant.helper';
import fs from 'fs';
import path from 'path';

const AGENT_RENAME = 'e2e_rename_scenario';
const LLM_RENAME = 'e2e_rename_llm';
const HISTORY_RENAME = 'e2e_rename_history';

/**
 * e2e 测试：对话自动重命名
 *
 * 验证流程：
 * 1. 创建标题为"新对话"的历史 + Agent + LLM 配置
 * 2. 通过 IPC 初始化对话并发送消息（模拟 chat-complete 后自动保存）
 * 3. 检查文件系统中历史文件的 title 是否被重命名为首条用户消息
 */
test.describe('AI助手 - 对话自动重命名', () => {
  test.beforeEach(async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    createAiAgent(testWorkspace, AGENT_RENAME);
    createAiLlmConfig(testWorkspace, LLM_RENAME);
    // 创建标题为"新对话"的空历史
    createAiHistory(testWorkspace, AGENT_RENAME, HISTORY_RENAME, [], '新对话');

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    await window.waitForTimeout(2000);
  });

  test.afterEach(async ({ testWorkspace }) => {
    cleanupAiTestData(testWorkspace, [AGENT_RENAME], [LLM_RENAME]);
  });

  /**
   * TC-RENAME-01: 新建对话后首次回答完成，标题应自动重命名
   *
   * 通过 IPC 直接调用 initChat + chatMessage 模拟对话流程，
   * 然后检查文件系统中历史文件的 title 是否更新。
   */
  test('首次回答完成后标题应自动更新为用户消息内容', async ({ window, testWorkspace }) => {
    const historyFile = getHistoryFilePath(testWorkspace, AGENT_RENAME, HISTORY_RENAME);

    // 验证初始状态：标题为"新对话"
    const initialData = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    expect(initialData.title).toBe('新对话');

    // 通过 IPC 初始化对话
    const initResult = await window.evaluate(async (params) => {
      try {
        const result = await window.aiAssistant.initChat(
          params.agentId,
          params.historyId,
          params.llmConfig
        );
        return { success: true, result };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }, { agentId: AGENT_RENAME, historyId: HISTORY_RENAME, llmConfig: LLM_RENAME });

    expect(initResult.success).toBe(true);

    // 发送消息（LLM API 会失败，但会触发 chat-error，后端仍会自动保存）
    const chatResult = await window.evaluate(async (params) => {
      try {
        const result = await window.aiAssistant.chatMessage(
          params.agentId,
          params.historyId,
          params.message
        );
        return { success: true, result };
      } catch (err) {
        // chat-message 可能因无效 API 而失败，但后端仍会自动保存
        return { success: false, error: err.message };
      }
    }, { agentId: AGENT_RENAME, historyId: HISTORY_RENAME, message: '这是一个测试问题用来验证重命名功能' });

    // 等待后端自动保存完成
    await window.waitForTimeout(3000);

    // 验证历史文件中的 title 已被更新
    const updatedData = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    expect(updatedData.title).not.toBe('新对话');
    expect(updatedData.title).toContain('这是一个测试问题');
  });

  /**
   * TC-RENAME-02: 超过10个字符的标题应截断并加"..."
   */
  test('超过10个字符的标题应截断并加省略号', async ({ window, testWorkspace }) => {
    const historyFile = getHistoryFilePath(testWorkspace, AGENT_RENAME, HISTORY_RENAME);

    // 通过 IPC 初始化对话
    await window.evaluate(async (params) => {
      return await window.aiAssistant.initChat(
        params.agentId,
        params.historyId,
        params.llmConfig
      );
    }, { agentId: AGENT_RENAME, historyId: HISTORY_RENAME, llmConfig: LLM_RENAME });

    // 发送超过10个字符的消息
    await window.evaluate(async (params) => {
      try {
        return await window.aiAssistant.chatMessage(
          params.agentId,
          params.historyId,
          params.message
        );
      } catch {
        return { error: 'expected' };
      }
    }, { agentId: AGENT_RENAME, historyId: HISTORY_RENAME, message: '这是一条超过十个字符的测试消息用于验证截断功能' });

    // 等待后端自动保存完成
    await window.waitForTimeout(3000);

    // 验证标题截断
    const updatedData = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    expect(updatedData.title).not.toBe('新对话');
    expect(updatedData.title.length).toBeLessThanOrEqual(13); // 10 chars + "..."
    expect(updatedData.title).toContain('...');
  });

  /**
   * TC-RENAME-03: 标题非"新对话"时不应被重命名
   */
  test('非默认标题的对话不应被重命名', async ({ window, testWorkspace }) => {
    const customHistoryId = 'e2e_custom_title_hist';
    const customTitle = '自定义标题';

    // 创建自定义标题的历史
    createAiHistory(testWorkspace, AGENT_RENAME, customHistoryId, [
      { role: 'user', content: '已有消息' },
      { role: 'assistant', content: '已有回复' },
    ], customTitle);

    const historyFile = getHistoryFilePath(testWorkspace, AGENT_RENAME, customHistoryId);

    // 初始化并发送消息
    await window.evaluate(async (params) => {
      await window.aiAssistant.initChat(params.agentId, params.historyId, params.llmConfig);
    }, { agentId: AGENT_RENAME, historyId: customHistoryId, llmConfig: LLM_RENAME });

    await window.evaluate(async (params) => {
      try {
        return await window.aiAssistant.chatMessage(params.agentId, params.historyId, params.message);
      } catch {
        return { error: 'expected' };
      }
    }, { agentId: AGENT_RENAME, historyId: customHistoryId, message: '新消息' });

    await window.waitForTimeout(3000);

    // 验证标题未被修改
    const updatedData = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    expect(updatedData.title).toBe(customTitle);

    // 清理
    const histDir = path.dirname(historyFile);
    if (fs.existsSync(historyFile)) {
      fs.unlinkSync(historyFile);
    }
  });
});
