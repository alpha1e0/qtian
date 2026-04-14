import { test, expect } from '../../../fixtures/app.fixture';
import { waitForAppReady } from '../../../helpers/electron-helper';
import {
  navigateToAiAssistant,
  createAiScenario,
  createAiLlmConfig,
  createAiHistory,
  cleanupAiTestData,
  selectOption,
} from '../ai-assistant.helper';

const SCENARIO_AGENT = 'e2e_agent_scenario';
const HISTORY_AGENT = 'e2e_agent_history';
const LLM_AGENT = 'e2e_agent_llm';

test.describe('AI助手 - Agent模式', () => {
  /**
   * TC-08-01 Agent模式 - 工具调用流程
   *
   * 前置条件：已选择Agent模式的场景（is_agent=true），场景配置了工具
   * 操作步骤：
   *   1. 发送需要工具调用的指令，如"查看当前目录下的文件"
   *   2. 观察AI回复过程
   * 预期结果：AI决定调用工具（如shell_execute）；聊天区域显示可折叠的工具调用面板，
   *         包含工具名称、参数（JSON格式）；工具执行后显示结果；AI基于结果继续回复
   *
   * TODO: 需要有效 LLM API 且场景配置了工具才能完整测试 Agent 工具调用流程。
   *       当前测试验证 Agent 场景能正常创建和加载。
   */
  test('Agent场景应可正常创建和加载', async ({ window, testWorkspace }) => {
    createAiScenario(testWorkspace, SCENARIO_AGENT, {
      is_agent: true,
      tools: ['shell_execute'],
    });
    createAiLlmConfig(testWorkspace, LLM_AGENT);
    createAiHistory(testWorkspace, SCENARIO_AGENT, HISTORY_AGENT);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    await selectOption(window, '选择场景', SCENARIO_AGENT);
    await selectOption(window, '选择对话历史', HISTORY_AGENT);
    await window.waitForTimeout(1500);

    // 验证聊天界面正常加载
    await expect(window.locator('.chat-content')).toBeVisible();

    cleanupAiTestData(testWorkspace, [SCENARIO_AGENT], [LLM_AGENT]);
  });

  /**
   * TC-08-02 Agent模式 - 工具调用面板展开/折叠
   *
   * 前置条件：Agent模式下已有工具调用记录
   * 操作步骤：
   *   1. 点击工具调用面板的折叠区域
   *   2. 再次点击
   * 预期结果：第一次点击展开，显示详细的工具参数和执行结果；
   *         第二次点击折叠，只显示工具名称摘要
   *
   * TODO: 需要有效 LLM API 触发工具调用后才能测试面板交互。
   *       当前测试创建包含工具调用消息的历史，验证面板渲染。
   */
  test('包含工具调用消息的历史应可正常加载', async ({ window, testWorkspace }) => {
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
    await selectOption(window, '选择场景', SCENARIO_AGENT);
    await selectOption(window, '选择对话历史', HISTORY_AGENT);
    await window.waitForTimeout(1500);

    // 验证有消息加载（至少 assistant 的文本回复）
    const messages = window.locator('.message');
    const count = await messages.count();
    expect(count).toBeGreaterThan(0);

    cleanupAiTestData(testWorkspace, [SCENARIO_AGENT], [LLM_AGENT]);
  });

  /**
   * TC-08-03 Agent模式 - 工具执行错误
   *
   * 前置条件：Agent模式下，AI调用了执行会失败的工具
   * 操作步骤：
   *   1. 发送指令触发一个会失败的工具调用（如执行不存在的命令）
   * 预期结果：工具调用面板显示错误状态（红色高亮）；错误信息显示在结果区域；
   *         AI收到错误信息后继续处理
   *
   * TODO: 需要有效 LLM API 且工具执行出错后才能验证错误状态。
   *       当前测试验证包含错误工具调用的历史能加载。
   */
  test('包含工具错误的历史应可加载', async ({ window, testWorkspace }) => {
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
    await selectOption(window, '选择场景', SCENARIO_AGENT);
    await selectOption(window, '选择对话历史', HISTORY_AGENT);
    await window.waitForTimeout(1500);

    // 页面不应崩溃
    await expect(window.locator('.chat-content')).toBeVisible();

    cleanupAiTestData(testWorkspace, [SCENARIO_AGENT], [LLM_AGENT]);
  });

  /**
   * TC-08-04 Agent模式 - 停止执行
   *
   * 前置条件：Agent模式正在执行工具调用链
   * 操作步骤：
   *   1. 在AI执行工具期间点击"停止"按钮
   * 预期结果：工具执行被中止；已完成的工具调用结果保留在聊天区域；AI停止后续操作
   *
   * TODO: 需要有效 LLM API 且 Agent 正在执行工具链时才能测试停止功能。
   *       当前验证停止按钮在非执行状态下不显示。
   */
  test('非执行状态下停止按钮不应显示', async ({ window, testWorkspace }) => {
    createAiScenario(testWorkspace, SCENARIO_AGENT, {
      is_agent: true,
      tools: ['shell_execute'],
    });
    createAiLlmConfig(testWorkspace, LLM_AGENT);
    createAiHistory(testWorkspace, SCENARIO_AGENT, HISTORY_AGENT);

    await waitForAppReady(window);
    await navigateToAiAssistant(window);
    await selectOption(window, '选择场景', SCENARIO_AGENT);
    await selectOption(window, '选择对话历史', HISTORY_AGENT);
    await window.waitForTimeout(1500);

    // 非执行状态下应显示"发送"按钮而非"停止"按钮
    const stopBtn = window.locator('.input-actions').getByRole('button', { name: '停止' });
    await expect(stopBtn).not.toBeVisible();

    const sendBtn = window.locator('.input-actions').getByRole('button', { name: '发送' });
    await expect(sendBtn).toBeVisible();

    cleanupAiTestData(testWorkspace, [SCENARIO_AGENT], [LLM_AGENT]);
  });

  /**
   * TC-08-05 Agent模式 - 多轮工具调用
   *
   * 前置条件：Agent模式，场景配置了工具
   * 操作步骤：
   *   1. 发送复杂指令，如"查看package.json的内容，然后告诉我项目用了哪些依赖"
   *   2. 观察AI行为
   * 预期结果：AI可能进行多轮工具调用（读取文件→分析内容）；每轮调用都有对应的面板；
   *         最终给出综合回复
   *
   * TODO: 需要有效 LLM API 才能测试多轮工具调用。
   *       此用例标记为 skip，待后续补充。
   */
  test.skip('多轮工具调用应正确执行', async ({ window }) => {
    // TODO: 需要有效 LLM API 且 Agent 配置了工具才能测试多轮工具调用
    // 此用例需要真实模型进行推理和工具决策
  });

  /**
   * TC-08-06 Agent模式 - 最大工具轮次限制
   *
   * 前置条件：Agent模式
   * 操作步骤：
   *   1. 构造一个可能导致无限循环的场景（如让AI反复调用工具）
   * 预期结果：工具调用达到最大轮次（10轮）后自动停止；显示警告提示
   *
   * TODO: 需要有效 LLM API 且需要构造导致工具循环的场景。
   *       难以自动化，此用例标记为 skip。
   */
  test.skip('工具调用达到最大轮次应自动停止', async ({ window }) => {
    // TODO: 需要有效 LLM API 且需要构造导致工具循环的场景
    // 难以自动化，需要后续手动测试或设计特殊场景
  });
});
