/**
 * AI 助手场景服务测试
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { AiScenarioService } from '@/core/services/ai-assistant/ai-scenario.service';
import { AiScenario } from '@/core/common/config';
import * as fs from 'fs/promises';
import * as context from '@/core/common/context';
import {
  getTestAssistantScenarioDir,
  setupTestAssistantEnvironment,
  finalAssistantCleanup,
  initAssistantTestState,
  markAssistantTestFailed,
  createTestAssistantScenario,
} from '#testing/scripts/ai-assistant-test-helper';

const TEST_FILE_NAME = 'test_ai-scenario.service';

const mockScenario: AiScenario = {
  id: 'test-scenario',
  name: '测试场景',
  description: '测试用场景',
  is_agent: false,
  role_id: 'default',
  llm_config: 'default',
  skills: [],
  tools: [],
};

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe('AiScenarioService', () => {
  let service: AiScenarioService;
  let testScenarioDir: string;

  beforeAll(async () => {
    initAssistantTestState(TEST_FILE_NAME);
    testScenarioDir = getTestAssistantScenarioDir(TEST_FILE_NAME);
    await setupTestAssistantEnvironment(testScenarioDir);
    vi.spyOn(context.wpath, 'assistantScenarioDir', 'get').mockReturnValue(testScenarioDir);
  });

  beforeEach(async () => {
    service = new AiScenarioService();
    await fs.mkdir(testScenarioDir, { recursive: true });
    // 清空测试目录
    const entries = await fs.readdir(testScenarioDir, { withFileTypes: true });
    for (const entry of entries) {
      await fs.rm(path.join(testScenarioDir, entry.name), { recursive: true, force: true });
    }
  });

  afterEach((ctx) => {
    if (ctx.result?.state === 'failed') {
      markAssistantTestFailed(TEST_FILE_NAME);
    }
  });

  afterAll(async () => {
    await finalAssistantCleanup(TEST_FILE_NAME);
  });

  describe('listScenarios', () => {
    it('should return empty array when no scenarios exist', async () => {
      const scenarios = await service.listScenarios();
      expect(scenarios).toEqual([]);
    });

    it('should return sorted list of scenario IDs', async () => {
      await createTestAssistantScenario(testScenarioDir, 'zebra', mockScenario);
      await createTestAssistantScenario(testScenarioDir, 'alpha', mockScenario);
      await createTestAssistantScenario(testScenarioDir, 'bravo', mockScenario);

      const scenarios = await service.listScenarios();
      expect(scenarios).toEqual(['alpha', 'bravo', 'zebra']);
    });

    it('should skip non-json files', async () => {
      await createTestAssistantScenario(testScenarioDir, 'valid', mockScenario);
      await fs.writeFile(path.join(testScenarioDir, 'readme.txt'), 'not a scenario', 'utf-8');

      const scenarios = await service.listScenarios();
      expect(scenarios).toEqual(['valid']);
    });
  });

  describe('getScenario', () => {
    it('should return scenario data', async () => {
      await createTestAssistantScenario(testScenarioDir, 'test', mockScenario);
      const scenario = await service.getScenario('test');
      expect(scenario).toEqual(mockScenario);
    });

    it('should throw for empty ID', async () => {
      await expect(service.getScenario('')).rejects.toThrow('Scenario ID cannot be empty');
    });

    it('should throw for path traversal', async () => {
      await expect(service.getScenario('../etc/passwd')).rejects.toThrow('Invalid scenario ID');
    });

    it('should throw for non-existent scenario', async () => {
      await expect(service.getScenario('non-existent')).rejects.toThrow("Scenario 'non-existent' not found");
    });
  });

  describe('createScenario', () => {
    it('should create scenario file', async () => {
      await service.createScenario('new', mockScenario);
      const scenario = await service.getScenario('new');
      expect(scenario.id).toBe('test-scenario');
    });

    it('should throw when scenario already exists', async () => {
      await createTestAssistantScenario(testScenarioDir, 'dup', mockScenario);
      await expect(service.createScenario('dup', mockScenario)).rejects.toThrow("Scenario 'dup' already exists");
    });

    it('should throw for empty ID', async () => {
      await expect(service.createScenario('', mockScenario)).rejects.toThrow('Scenario ID cannot be empty');
    });
  });

  describe('updateScenario', () => {
    it('should update existing scenario', async () => {
      await createTestAssistantScenario(testScenarioDir, 'update-test', mockScenario);
      const updated: AiScenario = { ...mockScenario, name: '已更新' };
      await service.updateScenario('update-test', updated);

      const scenario = await service.getScenario('update-test');
      expect(scenario.name).toBe('已更新');
    });
  });

  describe('deleteScenario', () => {
    it('should delete scenario file', async () => {
      await createTestAssistantScenario(testScenarioDir, 'del', mockScenario);
      await service.deleteScenario('del');
      await expect(service.scenarioExists('del')).resolves.toBe(false);
    });
  });

  describe('scenarioExists', () => {
    it('should return true for existing scenario', async () => {
      await createTestAssistantScenario(testScenarioDir, 'exists', mockScenario);
      expect(await service.scenarioExists('exists')).toBe(true);
    });

    it('should return false for non-existent scenario', async () => {
      expect(await service.scenarioExists('nope')).toBe(false);
    });
  });
});

// 引入 path 以在 beforeEach 中使用
import * as path from 'path';
