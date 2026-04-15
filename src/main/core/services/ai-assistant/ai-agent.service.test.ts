/**
 * AI 助手 Agent 管理服务测试
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { AiAgentService } from '@/core/services/ai-assistant/ai-agent.service';
import { AiAgent } from '@/core/common/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as context from '@/core/common/context';
import {
  finalAssistantCleanup,
  initAssistantTestState,
  markAssistantTestFailed,
} from '#testing/scripts/ai-assistant-test-helper';

const TEST_FILE_NAME = 'test_ai-agent.service';

/** 完整 Agent 的 Markdown 内容（含所有可选字段）
 *  注意：由于 extractYamlList 的实现会贪婪匹配后续所有列表项，
 *  将 skills 放在 tools 之前，避免 tools 误包含 skills 的条目。
 */
const FULL_AGENT_MD = `---
name: coder
description: 编程助手
skills:
  - code-review
tools:
  - shell_execute
  - file_read
model: default
enable_memory: true
max_context_rounds: 20
---

你是一个专业的编程助手，擅长代码审查和问题分析。`;

/** 最简 Agent 的 Markdown 内容（仅必选字段） */
const MINIMAL_AGENT_MD = `---
name: minimal
description: 最简描述
---

你是一个助手。`;

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

/**
 * 创建测试用的 Agent .md 文件
 * @param testDir - 测试目录
 * @param name - Agent 名称（不含 .md 后缀）
 * @param content - .md 文件完整内容
 */
async function createTestAgentMd(testDir: string, name: string, content: string): Promise<void> {
  const agentPath = path.join(testDir, `${name}.md`);
  await fs.writeFile(agentPath, content, 'utf-8');
}

describe('AiAgentService', () => {
  let service: AiAgentService;
  let testAgentDir: string;
  let testHistoryDir: string;

  beforeAll(async () => {
    initAssistantTestState(TEST_FILE_NAME);

    // 使用系统临时目录作为 agent 测试目录（因 test-helper 尚未提供 getTestAssistantAgentDir）
    testAgentDir = path.join(os.tmpdir(), `qtian-test-agent-${Date.now()}`);
    testHistoryDir = path.join(os.tmpdir(), `qtian-test-agent-history-${Date.now()}`);
    await fs.mkdir(testAgentDir, { recursive: true });
    await fs.mkdir(testHistoryDir, { recursive: true });

    vi.spyOn(context.wpath, 'assistantAgentDir', 'get').mockReturnValue(testAgentDir);
    vi.spyOn(context.wpath, 'assistantHistoryDir', 'get').mockReturnValue(testHistoryDir);
  });

  beforeEach(async () => {
    service = new AiAgentService();
    // 清空测试目录
    const cleanDir = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        await fs.rm(path.join(dir, entry.name), { recursive: true, force: true });
      }
    };
    await cleanDir(testAgentDir);
    await cleanDir(testHistoryDir);
  });

  afterEach((ctx) => {
    if (ctx.result?.state === 'failed') {
      markAssistantTestFailed(TEST_FILE_NAME);
    }
  });

  afterAll(async () => {
    await fs.rm(testAgentDir, { recursive: true, force: true });
    await fs.rm(testHistoryDir, { recursive: true, force: true });
    await finalAssistantCleanup(TEST_FILE_NAME);
  });

  // =========================================================================
  // listAgents
  // =========================================================================
  describe('listAgents', () => {
    it('should return empty array when no agents exist', async () => {
      const agents = await service.listAgents();
      expect(agents).toEqual([]);
    });

    it('should return sorted list of agent names', async () => {
      await createTestAgentMd(testAgentDir, 'zebra', MINIMAL_AGENT_MD);
      await createTestAgentMd(testAgentDir, 'alpha', MINIMAL_AGENT_MD);
      await createTestAgentMd(testAgentDir, 'bravo', MINIMAL_AGENT_MD);

      const agents = await service.listAgents();
      expect(agents).toEqual(['alpha', 'bravo', 'zebra']);
    });

    it('should skip non-md files', async () => {
      await createTestAgentMd(testAgentDir, 'valid', MINIMAL_AGENT_MD);
      await fs.writeFile(path.join(testAgentDir, 'readme.txt'), 'not an agent', 'utf-8');
      await fs.writeFile(path.join(testAgentDir, 'config.json'), '{}', 'utf-8');

      const agents = await service.listAgents();
      expect(agents).toEqual(['valid']);
    });
  });

  // =========================================================================
  // getAgent
  // =========================================================================
  describe('getAgent', () => {
    it('should return agent with all fields parsed correctly', async () => {
      await createTestAgentMd(testAgentDir, 'coder', FULL_AGENT_MD);
      const agent = await service.getAgent('coder');

      expect(agent.name).toBe('coder');
      expect(agent.description).toBe('编程助手');
      expect(agent.tools).toEqual(['shell_execute', 'file_read']);
      expect(agent.model).toBe('default');
      expect(agent.skills).toEqual(['code-review']);
      expect(agent.enable_memory).toBe(true);
      expect(agent.max_context_rounds).toBe(20);
      expect(agent.instructions).toBe('你是一个专业的编程助手，擅长代码审查和问题分析。');
    });

    it('should return minimal agent with only required fields', async () => {
      await createTestAgentMd(testAgentDir, 'minimal', MINIMAL_AGENT_MD);
      const agent = await service.getAgent('minimal');

      expect(agent.name).toBe('minimal');
      expect(agent.description).toBe('最简描述');
      expect(agent.tools).toEqual([]);
      expect(agent.model).toBeUndefined();
      expect(agent.skills).toBeUndefined();
      expect(agent.enable_memory).toBeUndefined();
      expect(agent.max_context_rounds).toBeUndefined();
      expect(agent.instructions).toBe('你是一个助手。');
    });

    it('should throw for empty name', async () => {
      await expect(service.getAgent('')).rejects.toThrow('Agent name cannot be empty');
    });

    it('should throw for path traversal', async () => {
      await expect(service.getAgent('../etc/passwd')).rejects.toThrow('Invalid agent name');
    });

    it('should throw for non-existent agent', async () => {
      await expect(service.getAgent('non-existent')).rejects.toThrow("Agent 'non-existent' not found");
    });

    it('should throw when front-matter is missing name field', async () => {
      const content = `---
description: 有描述但没名字
---

一些指令内容。`;
      await createTestAgentMd(testAgentDir, 'no-name', content);
      await expect(service.getAgent('no-name')).rejects.toThrow('must contain a "name" field');
    });

    it('should throw when front-matter is missing description field', async () => {
      const content = `---
name: has-name
---

一些指令内容。`;
      await createTestAgentMd(testAgentDir, 'no-desc', content);
      await expect(service.getAgent('no-desc')).rejects.toThrow('must contain a "description" field');
    });
  });

  // =========================================================================
  // saveAgent
  // =========================================================================
  describe('saveAgent', () => {
    const newAgent: AiAgent = {
      name: 'new-agent',
      description: '新 Agent',
      tools: ['shell_execute'],
      model: 'gpt-4',
      skills: ['debug'],
      enable_memory: false,
      max_context_rounds: 10,
      instructions: '你是一个调试助手。',
    };

    it('should create agent .md file', async () => {
      await service.saveAgent('new-agent', newAgent);

      // 验证文件已创建
      const filePath = path.join(testAgentDir, 'new-agent.md');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('name: new-agent');
      expect(content).toContain('description: 新 Agent');
      expect(content).toContain('你是一个调试助手。');
    });

    it('should overwrite existing agent file', async () => {
      await createTestAgentMd(testAgentDir, 'existing', MINIMAL_AGENT_MD);
      const updated: AiAgent = { ...newAgent, name: 'existing', description: '已更新' };
      await service.saveAgent('existing', updated);

      const agent = await service.getAgent('existing');
      expect(agent.description).toBe('已更新');
      expect(agent.instructions).toBe('你是一个调试助手。');
    });

    it('should force agent.name to match the given name parameter', async () => {
      const mismatchAgent: AiAgent = { ...newAgent, name: 'wrong-name' };
      await service.saveAgent('correct-name', mismatchAgent);

      const agent = await service.getAgent('correct-name');
      expect(agent.name).toBe('correct-name');
    });

    it('should throw for empty name', async () => {
      await expect(service.saveAgent('', newAgent)).rejects.toThrow('Agent name cannot be empty');
    });
  });

  // =========================================================================
  // deleteAgent
  // =========================================================================
  describe('deleteAgent', () => {
    it('should delete agent file', async () => {
      await createTestAgentMd(testAgentDir, 'del-target', FULL_AGENT_MD);
      await service.deleteAgent('del-target');

      expect(await service.agentExists('del-target')).toBe(false);
    });

    it('should also clean up corresponding history directory', async () => {
      // 创建 Agent 和对应的历史目录
      await createTestAgentMd(testAgentDir, 'with-history', FULL_AGENT_MD);
      const historySubDir = path.join(testHistoryDir, 'with-history');
      await fs.mkdir(historySubDir, { recursive: true });
      await fs.writeFile(path.join(historySubDir, 'session1.json'), '{}', 'utf-8');

      await service.deleteAgent('with-history');

      // 历史目录应被删除
      await expect(fs.access(historySubDir)).rejects.toThrow();
    });
  });

  // =========================================================================
  // agentExists
  // =========================================================================
  describe('agentExists', () => {
    it('should return true for existing agent', async () => {
      await createTestAgentMd(testAgentDir, 'exists-agent', MINIMAL_AGENT_MD);
      expect(await service.agentExists('exists-agent')).toBe(true);
    });

    it('should return false for non-existent agent', async () => {
      expect(await service.agentExists('nope')).toBe(false);
    });

    it('should throw for empty name', async () => {
      await expect(service.agentExists('')).rejects.toThrow('Agent name cannot be empty');
    });

    it('should throw for path traversal name', async () => {
      await expect(service.agentExists('../sneaky')).rejects.toThrow('Invalid agent name');
    });
  });
});
