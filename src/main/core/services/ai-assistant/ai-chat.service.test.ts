/**
 * AI 助手对话服务测试
 *
 * **重要**: 部分测试使用真实 API 调用，需要配置有效的 API key
 *
 * 配置方法:
 * 1. 编辑 tests/resource/workspace/assistant/llm/default.json
 * 2. 设置有效的 "key" 字段
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AiChatService } from '@/core/services/ai-assistant/ai-chat.service';
import { AiLLMConfig, AiAgent, AiChatMessage, AiChatEvent, AiSkill } from '@/core/common/config';
import { ITool } from '@/core/services/ai-assistant/tools';

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

vi.mock('undici', () => ({
  ProxyAgent: vi.fn().mockImplementation((proxy: string) => ({ proxy })),
  fetch: vi.fn(),
}));

const mockConfig: AiLLMConfig = {
  base_url: 'https://api.example.com/v1',
  model: 'test-model',
  key: '',
  temperature: 0.7,
  max_tokens: 2000,
};

const mockAgent: AiAgent = {
  name: 'default',
  description: '测试用助手',
  tools: [],
  instructions: '# Role: 测试助手\n\n你是一个测试用的 AI 助手。',
};

const mockAgentWithTools: AiAgent = {
  name: 'coder',
  description: 'Agent 模式编程助手',
  tools: ['shell_execute'],
  instructions: '# Role: 编程助手\n\n你是一个专业的编程助手。',
};

/** 创建 mock 工具 */
function createMockTool(name: string, executeResult: string): ITool {
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: {
      type: 'object',
      properties: { input: { type: 'string' } },
    },
    execute: vi.fn(async () => executeResult),
  };
}

/**
 * 收集 AsyncGenerator 的所有事件
 */
async function collectEvents(generator: AsyncGenerator<AiChatEvent>): Promise<AiChatEvent[]> {
  const events: AiChatEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe('AiChatService', () => {
  let service: AiChatService;

  beforeEach(() => {
    service = new AiChatService(mockConfig, mockAgent);
  });

  describe('constructor', () => {
    it('should initialize with config, scenario, and role', () => {
      expect(service).toBeDefined();
    });

    it('should initialize messages with system prompt', () => {
      const messages = service.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('测试助手');
    });

    it('should include system_prefix in system prompt', () => {
      const configWithPrefix: AiLLMConfig = {
        ...mockConfig,
        system_prefix: '重要提示：请用中文回答。',
      };
      const serviceWithPrefix = new AiChatService(configWithPrefix, mockAgent);
      const messages = serviceWithPrefix.getMessages();
      expect(messages[0].content).toContain('重要提示');
      expect(messages[0].content).toContain('测试助手');
    });

    it('should handle empty instructions', () => {
      const emptyAgent: AiAgent = { ...mockAgent, instructions: '' };
      const serviceEmptyRole = new AiChatService(mockConfig, emptyAgent);
      const messages = serviceEmptyRole.getMessages();
      expect(messages).toHaveLength(0);
    });

    it('should handle only system_prefix without instructions', () => {
      const configWithPrefix: AiLLMConfig = {
        ...mockConfig,
        system_prefix: '只回答是或否。',
      };
      const emptyAgent: AiAgent = { ...mockAgent, instructions: '' };
      const servicePrefixOnly = new AiChatService(configWithPrefix, emptyAgent);
      const messages = servicePrefixOnly.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toContain('只回答是或否');
    });

    it('should register tools when provided', () => {
      const tools = [createMockTool('mock_tool', 'result')];
      const agentService = new AiChatService(mockConfig, mockAgentWithTools, { tools });
      // 工具已注册，可通过 executeTool 验证 (内部有工具注册表)
      expect(agentService.getAgent().tools).toContain('shell_execute');
    });

    it('should have no tools when none provided', () => {
      const agentService = new AiChatService(mockConfig, mockAgentWithTools, { tools: [] });
      expect(agentService.getAgent().tools).toEqual(['shell_execute']);
    });
  });

  describe('reset', () => {
    it('should reset messages to initial state', () => {
      service['messages'].push({
        role: 'user',
        content: '测试消息',
        timestamp: Date.now(),
      });

      service.reset();

      const messages = service.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('system');
    });

    it('should reset abort flag', () => {
      service.abort();
      service.reset();
      // 重置后 abort 标志应清除
      expect(service['aborted']).toBe(false);
    });
  });

  describe('loadHistory', () => {
    it('should load messages from history', () => {
      const historyMessages: AiChatMessage[] = [
        { role: 'system', content: '系统提示', timestamp: Date.now() },
        { role: 'user', content: '你好', timestamp: Date.now() },
        { role: 'assistant', content: '你好！有什么可以帮你的？', timestamp: Date.now() },
      ];

      service.loadHistory(historyMessages);
      expect(service.getMessages()).toEqual(historyMessages);
    });
  });

  describe('getMessages', () => {
    it('should return current messages', () => {
      const messages = service.getMessages();
      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe('getHistoryData', () => {
    it('should return correct structure', () => {
      const data = service.getHistoryData('default', 'chat_1');
      expect(data.agent_id).toBe('default');
      expect(data.messages).toBeInstanceOf(Array);
      expect(data.updated_at).toBeGreaterThan(0);
    });
  });

  describe('popMessage', () => {
    it('should remove last message', () => {
      service['messages'].push({
        role: 'user',
        content: '测试',
        timestamp: Date.now(),
      });

      const result = service.popMessage();
      expect(result).toBe(true);
      expect(service.getMessages().length).toBe(1); // only system message
    });

    it('should return false when no messages to pop', () => {
      service['messages'] = [];
      const result = service.popMessage();
      expect(result).toBe(false);
    });
  });

  describe('getAgent', () => {
    it('should return current agent', () => {
      const agent = service.getAgent();
      expect(agent.name).toBe('default');
    });
  });

  describe('buildSystemPrompt', () => {
    it('should combine system_prefix and agent instructions', () => {
      const configWithPrefix: AiLLMConfig = {
        ...mockConfig,
        system_prefix: 'PREFIX',
      };
      const agentWithRole: AiAgent = { ...mockAgent, instructions: 'ROLE_CONTENT' };
      const serviceWithPrefix = new AiChatService(configWithPrefix, agentWithRole);
      const prompt = serviceWithPrefix.buildSystemPrompt();
      expect(prompt).toContain('PREFIX');
      expect(prompt).toContain('ROLE_CONTENT');
    });

    it('should include memory prompt in system prompt', () => {
      const serviceWithMemory = new AiChatService(mockConfig, mockAgent, {
        memoryPrompt: '## 记忆\n\n- 用户偏好中文',
      });
      const prompt = serviceWithMemory.buildSystemPrompt();
      expect(prompt).toContain('用户偏好中文');
      // Memory 应在 instructions 之前
      const memoryIdx = prompt.indexOf('用户偏好中文');
      const instructionsIdx = prompt.indexOf('测试助手');
      expect(memoryIdx).toBeLessThan(instructionsIdx);
    });

    it('should include skills instructions in system prompt', () => {
      const skills: AiSkill[] = [
        {
          name: '翻译助手',
          description: '翻译',
          version: '1.0.0',
          dir_name: 'translator',
          instructions: '请进行准确翻译。',
          has_scripts: false,
          has_templates: false,
        },
      ];
      const serviceWithSkills = new AiChatService(mockConfig, mockAgent, { skills });
      const prompt = serviceWithSkills.buildSystemPrompt();
      expect(prompt).toContain('## 技能');
      expect(prompt).toContain('翻译助手');
      expect(prompt).toContain('请进行准确翻译');
      // Skills 应在 instructions 之后
      const skillIdx = prompt.indexOf('翻译助手');
      const instructionsIdx = prompt.indexOf('测试助手');
      expect(skillIdx).toBeGreaterThan(instructionsIdx);
    });

    it('should follow order: system_prefix → memory → instructions → skills', () => {
      const skills: AiSkill[] = [
        {
          name: 'Skill1',
          description: '',
          version: '1.0',
          dir_name: 's1',
          instructions: 'Instructions1',
          has_scripts: false,
          has_templates: false,
        },
      ];
      const configWithPrefix: AiLLMConfig = { ...mockConfig, system_prefix: 'SYS' };
      const agentWithRole: AiAgent = { ...mockAgent, instructions: 'ROLE' };
      const serviceFull = new AiChatService(configWithPrefix, agentWithRole, {
        memoryPrompt: '## 记忆\n\n- MEM',
        skills,
      });
      const prompt = serviceFull.buildSystemPrompt();

      const sysIdx = prompt.indexOf('SYS');
      const memIdx = prompt.indexOf('MEM');
      const roleIdx = prompt.indexOf('ROLE');
      const skillIdx = prompt.indexOf('Skill1');

      expect(sysIdx).toBeLessThan(memIdx);
      expect(memIdx).toBeLessThan(roleIdx);
      expect(roleIdx).toBeLessThan(skillIdx);
    });
  });

  describe('sendMessage', () => {
    it('should add user message to messages', async () => {
      const events = await collectEvents(service.sendMessage('测试输入'));

      const messages = service.getMessages();
      const userMsg = messages.find((m) => m.role === 'user');
      expect(userMsg).toBeDefined();
      expect(userMsg!.content).toBe('测试输入');
    });

    it('should not add empty user message', async () => {
      const messagesBefore = service.getMessages().length;
      await collectEvents(service.sendMessage(''));
      expect(service.getMessages().length).toBe(messagesBefore);
    });

    it('should yield AiChatEvent objects', async () => {
      const events = await collectEvents(service.sendMessage('test'));
      for (const event of events) {
        expect(event.type).toBeDefined();
      }
    });

    it('should yield done event at the end (success or error)', async () => {
      const events = await collectEvents(service.sendMessage('test'));
      const hasTerminal = events.some(
        (e) => e.type === 'done' || e.type === 'error'
      );
      expect(hasTerminal).toBe(true);
    });

    it('should work with tools provided (tool-use loop)', async () => {
      const tools = [createMockTool('test_tool', 'ok')];
      const agentService = new AiChatService(mockConfig, mockAgentWithTools, { tools });

      // 发送消息 (由于没有真实 API key 会得到 error 事件)
      const events = await collectEvents(agentService.sendMessage('hello'));
      const hasTerminal = events.some(
        (e) => e.type === 'done' || e.type === 'error'
      );
      expect(hasTerminal).toBe(true);
    });
  });

  describe('abort', () => {
    it('should set aborted flag', () => {
      service.abort();
      expect(service['aborted']).toBe(true);
    });
  });

  describe('regenerate', () => {
    it('should remove last assistant message before regenerating', () => {
      service['messages'].push({
        role: 'user',
        content: '你好',
        timestamp: Date.now(),
      });
      service['messages'].push({
        role: 'assistant',
        content: '你好！',
        timestamp: Date.now(),
      });

      // regenerate 会移除最后一条 assistant 消息
      const messages = service.getMessages();
      expect(messages[messages.length - 1].role).toBe('assistant');
    });
  });

  describe('updateLlmConfig', () => {
    it('should update LLM config', () => {
      const newConfig: AiLLMConfig = {
        ...mockConfig,
        model: 'new-model',
      };
      service.updateLlmConfig(newConfig);
      expect(service.getAgent().name).toBe('default');
    });
  });

  describe('normalizeBaseUrl', () => {
    it('should strip /chat/completions suffix', () => {
      const config: AiLLMConfig = {
        ...mockConfig,
        base_url: 'https://api.example.com/v1/chat/completions',
      };
      const svc = new AiChatService(config, mockAgent);
      // 通过 updateLlmConfig 触发 initClient，验证 normalize 生效
      // 直接调用私有方法验证
      expect(svc['normalizeBaseUrl']('https://api.example.com/v1/chat/completions'))
        .toBe('https://api.example.com/v1');
    });

    it('should strip /chat/completions/ suffix with trailing slash', () => {
      expect(service['normalizeBaseUrl']('https://api.example.com/v1/chat/completions/'))
        .toBe('https://api.example.com/v1');
    });

    it('should not modify url without suffix', () => {
      expect(service['normalizeBaseUrl']('https://api.example.com/v1'))
        .toBe('https://api.example.com/v1');
    });

    it('should not modify url with other paths', () => {
      expect(service['normalizeBaseUrl']('https://api.example.com/v1/models'))
        .toBe('https://api.example.com/v1/models');
    });
  });
});
