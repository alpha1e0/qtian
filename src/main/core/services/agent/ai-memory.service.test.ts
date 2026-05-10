/**
 * AiMemoryService 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import { AiMemoryService } from '@/core/services/agent/ai-memory.service';
import {
  getTestAssistantMemoryDir,
  createTestAssistantMemory,
  setupTestAssistantEnvironment,
  finalAssistantCleanup,
  initAssistantTestState,
  markAssistantTestFailed,
} from '#testing/scripts/ai-assistant-test-helper';
import { AiMemory } from '@/core/common/config';

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-' + Math.random().toString(36).slice(2, 8)),
}));

const TEST_FILE = 'test_ai-memory.service';

const GLOBAL_MEMORIES: Partial<AiMemory>[] = [
  { id: 'global-mem-1', content: '用户偏好中文交流', tags: ['preference'], agent_id: undefined },
  { id: 'global-mem-2', content: '用户是程序员', tags: ['user-info'], agent_id: undefined },
];

const SCENARIO_MEMORIES: Partial<AiMemory>[] = [
  { id: 'scenario-mem-1', content: '项目使用 TypeScript', tags: ['tech'], agent_id: 'default' },
  { id: 'scenario-mem-2', content: '遵循 Vue 3 Composition API', tags: ['tech', 'convention'], agent_id: 'default' },
];

describe('AiMemoryService', () => {
  let service: AiMemoryService;
  let memoryDir: string;

  beforeEach(async () => {
    memoryDir = getTestAssistantMemoryDir(TEST_FILE);
    // 每个测试前清理目录，确保隔离
    await fs.rm(memoryDir, { recursive: true, force: true });
    await setupTestAssistantEnvironment(memoryDir);
    service = new AiMemoryService();
    // 覆盖内部路径为测试路径
    (service as any).memoryDir = memoryDir;
    initAssistantTestState(TEST_FILE);
  });

  afterEach(async () => {
    await finalAssistantCleanup(TEST_FILE);
  });

  describe('listMemories', () => {
    it('should list memories for a specific scenario (scenario + global)', async () => {
      await createTestAssistantMemory(memoryDir, '_global.jsonl', GLOBAL_MEMORIES);
      await createTestAssistantMemory(memoryDir, 'default.jsonl', SCENARIO_MEMORIES);

      const memories = await service.listMemories('default');
      expect(memories.length).toBe(4); // 2 scenario + 2 global
    });

    it('should only return global memories for non-existent scenario', async () => {
      await createTestAssistantMemory(memoryDir, '_global.jsonl', GLOBAL_MEMORIES);

      const memories = await service.listMemories('nonexistent');
      expect(memories.length).toBe(2);
    });

    it('should return all memories when no scenario specified', async () => {
      await createTestAssistantMemory(memoryDir, '_global.jsonl', GLOBAL_MEMORIES);
      await createTestAssistantMemory(memoryDir, 'default.jsonl', SCENARIO_MEMORIES);
      await createTestAssistantMemory(memoryDir, 'coder.jsonl', [
        { content: '喜欢 Rust', tags: ['preference'], agent_id: 'coder' },
      ]);

      const memories = await service.listMemories();
      expect(memories.length).toBe(5); // 2 + 2 + 1
    });

    it('should return empty when no memory files exist', async () => {
      const memories = await service.listMemories();
      expect(memories).toEqual([]);
    });

    it('should sort by created_at descending', async () => {
      await createTestAssistantMemory(memoryDir, '_global.jsonl', [
        { content: 'old memory', tags: [], agent_id: undefined, created_at: 1000 },
        { content: 'new memory', tags: [], agent_id: undefined, created_at: 2000 },
      ]);

      const memories = await service.listMemories();
      expect(memories[0].content).toBe('new memory');
      expect(memories[1].content).toBe('old memory');
    });
  });

  describe('addMemory', () => {
    it('should add a global memory', async () => {
      const memory = await service.addMemory({ content: '新记忆', tags: ['test'] });
      expect(memory.content).toBe('新记忆');
      expect(memory.tags).toEqual(['test']);
      expect(memory.agent_id).toBeUndefined();
      expect(memory.id).toBeTruthy();
      expect(memory.created_at).toBeGreaterThan(0);
    });

    it('should add a scenario-scoped memory', async () => {
      const memory = await service.addMemory({
        content: '场景记忆',
        tags: [],
        agent_id: 'default',
      });
      expect(memory.agent_id).toBe('default');
    });

    it('should persist memory to JSONL file', async () => {
      await service.addMemory({ content: '持久化测试' });

      const memories = await service.listMemories();
      expect(memories.length).toBe(1);
      expect(memories[0].content).toBe('持久化测试');
    });
  });

  describe('deleteMemory', () => {
    it('should delete an existing memory', async () => {
      await createTestAssistantMemory(memoryDir, '_global.jsonl', GLOBAL_MEMORIES);

      const deleted = await service.deleteMemory(GLOBAL_MEMORIES[0].id);
      expect(deleted).toBe(true);

      const memories = await service.listMemories();
      expect(memories.length).toBe(1);
    });

    it('should return false for non-existent memory', async () => {
      const deleted = await service.deleteMemory('non-existent-id');
      expect(deleted).toBe(false);
    });

    it('should search in scenario file when agentId specified', async () => {
      await createTestAssistantMemory(memoryDir, 'default.jsonl', SCENARIO_MEMORIES);
      await createTestAssistantMemory(memoryDir, '_global.jsonl', GLOBAL_MEMORIES);

      const deleted = await service.deleteMemory(SCENARIO_MEMORIES[0].id, 'default');
      expect(deleted).toBe(true);

      // Scenario file should have 1 remaining
      const scenarioMemories = await service.listMemories('default');
      const scenarioOnly = scenarioMemories.filter((m) => m.agent_id === 'default');
      expect(scenarioOnly.length).toBe(1);
    });
  });

  describe('buildMemoryPrompt', () => {
    it('should return formatted prompt with memories', async () => {
      await createTestAssistantMemory(memoryDir, '_global.jsonl', GLOBAL_MEMORIES);

      const prompt = await service.buildMemoryPrompt();
      expect(prompt).toContain('## 记忆');
      expect(prompt).toContain('用户偏好中文交流');
      expect(prompt).toContain('用户是程序员');
    });

    it('should include tags in prompt', async () => {
      await createTestAssistantMemory(memoryDir, '_global.jsonl', [
        { content: 'tagged memory', tags: ['tag1', 'tag2'], agent_id: undefined },
      ]);

      const prompt = await service.buildMemoryPrompt();
      expect(prompt).toContain('[tag1, tag2]');
    });

    it('should return empty string when no memories', async () => {
      const prompt = await service.buildMemoryPrompt();
      expect(prompt).toBe('');
    });

    it('should filter by scenario when specified', async () => {
      await createTestAssistantMemory(memoryDir, '_global.jsonl', GLOBAL_MEMORIES);
      await createTestAssistantMemory(memoryDir, 'coder.jsonl', [
        { content: 'Coder specific', tags: [], agent_id: 'coder' },
      ]);

      const prompt = await service.buildMemoryPrompt('coder');
      expect(prompt).toContain('Coder specific');
      expect(prompt).toContain('用户偏好中文交流'); // global also included
    });
  });
});
