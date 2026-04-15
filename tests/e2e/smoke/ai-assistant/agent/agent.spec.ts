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
} from '../ai-assistant.helper';

const SCENARIO_AGENT = 'e2e_agent_scenario';
const HISTORY_AGENT = 'e2e_agent_history';
const LLM_AGENT = 'e2e_agent_llm';

test.describe('AI助手 - Agent模式', () => {
  test.afterEach(async ({ testWorkspace }) => {
    cleanupAiTestData(testWorkspace, [SCENARIO_AGENT], [LLM_AGENT]);
  });

  /**
   * TC-08-01 Agent模式 - 工具调用流程
   *
   * TODO: 需要有效 LLM API 且场景配置了工具才能完整测试 Agent 工具调用流程。
   *       当前测试验证 Agent 场景能正常创建和加载。
   */
  test('Agent场景应可正常创建和加载', async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    createAiScenario(testWorkspace, SCENARIO_AGENT, {
      is_agent: true,
      tools: ['shell_execute'],
    });
    createAiLlmConfig(testWorkspace, LLM_AGENT);
    createAiHistory(testWorkspace, SCENARIO_AGENT, HISTORY_AGENT);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    // 依赖自动选择第一个场景
    await window.waitForTimeout(2000);
    await clickHistoryItem(window, HISTORY_AGENT);
    await window.waitForTimeout(1500);

    // 验证聊天界面正常加载
    await expect(window.locator('.chat-content')).toBeVisible();
  });

  /**
   * TC-08-02 Agent模式 - 工具调用面板展开/折叠
   *
   * TODO: 需要有效 LLM API 触发工具调用后才能测试面板交互。
   *       当前测试创建包含工具调用消息的历史，验证面板渲染。
   */
  test('包含工具调用消息的历史应可正常加载', async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    createAiScenario(testWorkspace, SCENARIO_AGENT, {
      is_agent: true,
      tools: ['shell_execute'],
    });
    createAiLlmConfig(testWorkspace, LLM_AGENT);
    createAiHistory(testWorkspace, SCENARIO_AGENT, HISTORY_AGENT, [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'shell_execute', arguments: '{"command":"ls"}' },
          },
        ],
      },
      {
        role: 'tool',
        content: 'file1.txt\nfile2.txt',
        tool_call_id: 'call_1',
      },
      {
        role: 'assistant',
        content: '当前目录下有2个文件：file1.txt 和 file2.txt。',
      },
    ]);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    // 依赖自动选择第一个场景
    await window.waitForTimeout(2000);
    await clickHistoryItem(window, HISTORY_AGENT);
    await window.waitForTimeout(1500);

    // 验证有消息加载（至少 assistant 的文本回复）
    const messages = window.locator('.message');
    const count = await messages.count();
    expect(count).toBeGreaterThan(0);
  });

  /**
   * TC-08-03 Agent模式 - 工具执行错误
   *
   * TODO: 需要有效 LLM API 且工具执行出错后才能验证错误状态。
   *       当前测试验证包含错误工具调用的历史能加载。
   */
  test('包含工具错误的历史应可加载', async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    createAiScenario(testWorkspace, SCENARIO_AGENT, {
      is_agent: true,
      tools: ['shell_execute'],
    });
    createAiLlmConfig(testWorkspace, LLM_AGENT);
    createAiHistory(testWorkspace, SCENARIO_AGENT, HISTORY_AGENT, [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_err',
            type: 'function',
            function: { name: 'shell_execute', arguments: '{"command":"invalid_command_xyz"}' },
          },
        ],
      },
      {
        role: 'tool',
        content: 'Error: command not found: invalid_command_xyz',
        tool_call_id: 'call_err',
      },
      {
        role: 'assistant',
        content: '执行失败了，该命令不存在。',
      },
    ]);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    // 依赖自动选择第一个场景
    await window.waitForTimeout(2000);
    await clickHistoryItem(window, HISTORY_AGENT);
    await window.waitForTimeout(1500);

    // 页面不应崩溃
    await expect(window.locator('.chat-content')).toBeVisible();
  });

  /**
   * TC-08-04 Agent模式 - 停止执行
   *
   * TODO: 需要有效 LLM API 且 Agent 正在执行工具链时才能测试停止功能。
   *       当前验证停止按钮在非执行状态下不显示。
   */
  test('非执行状态下停止按钮不应显示', async ({ window, testWorkspace }) => {
    cleanAllAiTestData(testWorkspace);
    createAiScenario(testWorkspace, SCENARIO_AGENT, {
      is_agent: true,
      tools: ['shell_execute'],
    });
    createAiLlmConfig(testWorkspace, LLM_AGENT);
    createAiHistory(testWorkspace, SCENARIO_AGENT, HISTORY_AGENT);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    // 依赖自动选择第一个场景
    await window.waitForTimeout(2000);
    await clickHistoryItem(window, HISTORY_AGENT);
    await window.waitForTimeout(1500);

    // 非执行状态下应显示"发送"按钮而非"停止"按钮
    const stopBtn = window.locator('.chat-input .input-actions').getByRole('button', { name: '停止' });
    await expect(stopBtn).not.toBeVisible();

    const sendBtn = window.locator('.chat-input .input-actions').getByRole('button', { name: '发送' });
    await expect(sendBtn).toBeVisible();
  });

  /**
   * TC-08-05 Agent模式 - 多轮工具调用
   */
  test.skip('多轮工具调用应正确执行', async ({ window }) => {
    // TODO: 需要有效 LLM API 且 Agent 配置了工具才能测试多轮工具调用
  });

  /**
   * TC-08-06 Agent模式 - 最大工具轮次限制
   */
  test.skip('工具调用达到最大轮次应自动停止', async ({ window }) => {
    // TODO: 需要有效 LLM API 且需要构造导致工具循环的场景
  });
});
