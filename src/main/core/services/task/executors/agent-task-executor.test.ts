/**
 * AgentTaskExecutor 单元测试
 *
 * 通过 mock AiAgentService / AiAgentMgrService / AiConfigService / AiHistoryService，
 * 验证事件翻译、取消响应、错误传播与历史持久化逻辑。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/core/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// mock buildBuiltInTools，避免真实工具构造
vi.mock('@/core/services/tools/build-tools', () => ({
  buildBuiltInTools: vi.fn(() => [{ name: 'mock_tool' }]),
}));

// mock AiAgentService —— 关键：替换 sendMessage 生成器与 abort
vi.mock('@/core/services/agent/ai-agent.service', () => {
  return {
    AiAgentService: vi.fn().mockImplementation(() => ({
      abort: vi.fn(),
      getMessages: vi.fn(() => [{ role: 'assistant', content: 'done', timestamp: 0 }]),
      sendMessage: vi.fn(async function* () {
        yield { type: 'text_delta', content: 'hello' };
        yield { type: 'done', messages: [{ role: 'assistant', content: 'final', timestamp: 1 }] };
      }),
    })),
  };
});

import { AgentTaskExecutor, buildTaskAgentId } from './agent-task-executor';
import { AiAgent, AiChatEvent, AiLLMConfig } from '@/core/common/config';
import {
  TaskCancelledError,
  TaskExecutionContext,
  TaskExecutionError,
} from '../task.types';

/** 构造一个 fake cancelToken */
function createCancelToken() {
  const callbacks: Array<() => void> = [];
  return {
    cancelled: false,
    onCancel: (cb: () => void) => callbacks.push(cb),
    trigger() {
      this.cancelled = true;
      callbacks.forEach((cb) => cb());
    },
  };
}

/** 构造 fake context，收集 emit 的事件 */
function createContext(taskId: number): { context: TaskExecutionContext; events: any[]; cancelToken: any } {
  const events: any[] = [];
  const cancelToken = createCancelToken();
  const context: TaskExecutionContext = {
    taskId,
    emit: (e) => events.push(e),
    cancelToken,
  };
  return { context, events, cancelToken };
}

/** mock agentMgr */
function createAgentMgr(agent: AiAgent) {
  return {
    getAgent: vi.fn(async () => agent),
  } as any;
}

/** mock configService */
function createConfigService(config: AiLLMConfig) {
  return {
    getConfig: vi.fn(async () => config),
  } as any;
}

/** mock historyService */
function createHistoryService() {
  return {
    createHistory: vi.fn(async () => undefined),
    saveHistory: vi.fn(async () => undefined),
    historyExists: vi.fn(async () => false),
    getHistory: vi.fn(async () => undefined),
  } as any;
}

const baseAgent: AiAgent = {
  name: 'coder',
  description: '测试',
  tools: ['shell_execute'],
  instructions: '你是助手',
};

const baseConfig: AiLLMConfig = {
  base_url: 'http://x',
  model: 'm',
  key: 'k',
  temperature: 0.7,
  max_tokens: 100,
};

function buildView(overrides: any = {}) {
  return {
    id: 5,
    type: 'agent' as const,
    source: 'todo-app' as const,
    source_ref_id: 1,
    title: '任务标题',
    status: 'running' as const,
    progress: 0,
    error_message: null,
    created_at: 1000,
    updated_at: 1000,
    prompt: '请总结',
    agent_name: 'coder',
    llm_config_name: 'default',
    chat_history_id: null,
    result_meta: null,
    ...overrides,
  };
}

describe('AgentTaskExecutor', () => {
  let executor: AgentTaskExecutor;
  let agentMgr: any;
  let configService: any;
  let historyService: any;

  beforeEach(() => {
    agentMgr = createAgentMgr(baseAgent);
    configService = createConfigService(baseConfig);
    historyService = createHistoryService();
    executor = new AgentTaskExecutor(agentMgr, configService, historyService, {
      getTavilyApiKey: () => 'key',
    });
    vi.clearAllMocks();
  });

  describe('type', () => {
    it('应为 agent 类型', () => {
      expect(executor.type).toBe('agent');
    });
  });

  describe('buildTaskAgentId', () => {
    it('应生成 task:agent:<id> 格式的 agent_id', () => {
      expect(buildTaskAgentId(42)).toBe('task:agent:42');
    });
  });

  describe('execute - 正常流程', () => {
    it('应加载 agent/config，创建历史，并翻译事件', async () => {
      const { context, events } = createContext(5);

      const result = await executor.execute(buildView(), context);

      expect(agentMgr.getAgent).toHaveBeenCalledWith('coder');
      expect(configService.getConfig).toHaveBeenCalledWith('default');
      expect(historyService.createHistory).toHaveBeenCalledTimes(1);
      // createHistory 的 agent_id 应为 task:agent:5
      const createArgs = historyService.createHistory.mock.calls[0];
      expect(createArgs[0]).toBe('task:agent:5');

      // 事件翻译：text_delta → text_delta, done → done
      const types = events.map((e) => e.type);
      expect(types).toContain('text_delta');
      expect(types).toContain('done');
      expect(events.find((e) => e.type === 'text_delta').content).toBe('hello');

      // 结果包含 chat_history_id
      expect(result.meta).toHaveProperty('chat_history_id');
      expect(result.rawOutput).toBeDefined();
    });

    it('完成后应保存对话历史', async () => {
      const { context } = createContext(5);
      await executor.execute(buildView(), context);
      expect(historyService.saveHistory).toHaveBeenCalledTimes(1);
    });

    it('历史保存失败不应影响任务完成', async () => {
      historyService.saveHistory.mockRejectedValueOnce(new Error('disk full'));
      const { context } = createContext(5);
      // 不应抛错
      const result = await executor.execute(buildView(), context);
      expect(result.meta).toHaveProperty('chat_history_id');
    });

    it('context_compress 应翻译为 log 事件', async () => {
      // 临时覆盖 sendMessage
      const { AiAgentService } = await import('@/core/services/agent/ai-agent.service');
      (AiAgentService as any).mockImplementationOnce(() => ({
        abort: vi.fn(),
        getMessages: vi.fn(() => []),
        sendMessage: async function* () {
          yield { type: 'context_compress', originalTokens: 1000, compressedTokens: 500 };
          yield { type: 'done', messages: [] };
        },
      }));
      const { context, events } = createContext(5);
      await executor.execute(buildView(), context);
      const log = events.find((e) => e.type === 'log');
      expect(log).toBeDefined();
      expect(log.message).toContain('1000');
      expect(log.level).toBe('info');
    });

    it('error 事件应翻译为 error TaskEvent（但不终止）', async () => {
      const { AiAgentService } = await import('@/core/services/agent/ai-agent.service');
      (AiAgentService as any).mockImplementationOnce(() => ({
        abort: vi.fn(),
        getMessages: vi.fn(() => []),
        sendMessage: async function* () {
          yield { type: 'error', message: 'LLM 内部错误' };
          yield { type: 'done', messages: [] };
        },
      }));
      const { context, events } = createContext(5);
      await executor.execute(buildView(), context);
      const err = events.find((e) => e.type === 'error');
      expect(err).toBeDefined();
      expect(err.message).toBe('LLM 内部错误');
    });
  });

  describe('execute - 错误传播', () => {
    it('agent 不存在时应抛出 TaskExecutionError', async () => {
      agentMgr.getAgent.mockRejectedValueOnce(new Error("Agent 'x' not found"));
      const { context } = createContext(5);
      await expect(executor.execute(buildView({ agent_name: 'x' }), context)).rejects.toThrow(TaskExecutionError);
    });

    it('LLM 配置不存在时应抛出 TaskExecutionError', async () => {
      configService.getConfig.mockRejectedValueOnce(new Error("Config 'y' not found"));
      const { context } = createContext(5);
      await expect(executor.execute(buildView({ llm_config_name: 'y' }), context)).rejects.toThrow(TaskExecutionError);
    });

    it('创建历史失败时应抛出 TaskExecutionError', async () => {
      historyService.createHistory.mockRejectedValueOnce(new Error('history exists'));
      const { context } = createContext(5);
      await expect(executor.execute(buildView(), context)).rejects.toThrow(TaskExecutionError);
    });

    it('sendMessage 抛出普通错误时应抛出 TaskExecutionError', async () => {
      const { AiAgentService } = await import('@/core/services/agent/ai-agent.service');
      (AiAgentService as any).mockImplementationOnce(() => ({
        abort: vi.fn(),
        getMessages: vi.fn(() => []),
        sendMessage: async function* () {
          yield { type: 'text_delta', content: 'x' };
          throw new Error('network failure');
        },
      }));
      const { context } = createContext(5);
      await expect(executor.execute(buildView(), context)).rejects.toThrow(TaskExecutionError);
      expect(() => {
        throw new TaskExecutionError('x');
      }).toBeDefined();
    });

    it('sendMessage 抛出 abort 类错误时应抛出 TaskCancelledError', async () => {
      const { AiAgentService } = await import('@/core/services/agent/ai-agent.service');
      (AiAgentService as any).mockImplementationOnce(() => ({
        abort: vi.fn(),
        getMessages: vi.fn(() => []),
        sendMessage: async function* () {
          throw new Error('Request aborted');
        },
      }));
      const { context } = createContext(5);
      await expect(executor.execute(buildView(), context)).rejects.toThrow(TaskCancelledError);
    });
  });

  describe('execute - 取消', () => {
    it('取消令牌触发后应抛出 TaskCancelledError 且不保存历史', async () => {
      const { AiAgentService } = await import('@/core/services/agent/ai-agent.service');
      (AiAgentService as any).mockImplementationOnce(() => ({
        abort: vi.fn(),
        getMessages: vi.fn(() => []),
        // 迭代会持续到 done，但我们在迭代开始前就 trigger 取消
        sendMessage: async function* () {
          yield { type: 'text_delta', content: 'partial' };
          yield { type: 'done', messages: [] };
        },
      }));

      const { context, cancelToken } = createContext(5);
      // 在执行前预触发取消（模拟取消发生在循环开始时）
      cancelToken.trigger();

      await expect(executor.execute(buildView(), context)).rejects.toThrow(TaskCancelledError);
      // 取消后不应保存对话历史
      expect(historyService.saveHistory).not.toHaveBeenCalled();
    });

    it('取消在迭代过程中发生时，应中断循环并抛出 TaskCancelledError', async () => {
      const { AiAgentService } = await import('@/core/services/agent/ai-agent.service');
      (AiAgentService as any).mockImplementationOnce(() => ({
        abort: vi.fn(),
        getMessages: vi.fn(() => []),
        sendMessage: async function* () {
          yield { type: 'text_delta', content: 'a' };
          yield { type: 'text_delta', content: 'b' };
          yield { type: 'done', messages: [] };
        },
      }));

      const { context, events, cancelToken } = createContext(5);
      // 用一个 wrapper 在收到第一个事件后触发取消
      const origEmit = context.emit;
      let firstSeen = false;
      context.emit = (e: any) => {
        origEmit(e);
        if (!firstSeen) {
          firstSeen = true;
          cancelToken.trigger();
        }
      };

      await expect(executor.execute(buildView(), context)).rejects.toThrow(TaskCancelledError);
      // 第一个事件应被 emit
      expect(events.length).toBeGreaterThanOrEqual(1);
    });
  });
});
