/**
 * AI 助手 LLM 配置服务测试
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { AiConfigService } from '@/core/services/ai-assistant/ai-config.service';
import { AiLLMConfig } from '@/core/common/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as context from '@/core/common/context';
import {
  getTestAssistantLlmDir,
  setupTestAssistantEnvironment,
  finalAssistantCleanup,
  initAssistantTestState,
  markAssistantTestFailed,
  createTestAssistantLlmConfig,
} from '#testing/scripts/ai-assistant-test-helper';

const TEST_FILE_NAME = 'test_ai-config.service';

const mockConfig: AiLLMConfig = {
  base_url: 'https://api.test.com/v1',
  model: 'test-model',
  key: 'test-key',
  temperature: 0.7,
  max_tokens: 2000,
};

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe('AiConfigService', () => {
  let service: AiConfigService;
  let testLlmDir: string;

  beforeAll(async () => {
    initAssistantTestState(TEST_FILE_NAME);
    testLlmDir = getTestAssistantLlmDir(TEST_FILE_NAME);
    await setupTestAssistantEnvironment(testLlmDir);
    vi.spyOn(context.wpath, 'assistantLlmDir', 'get').mockReturnValue(testLlmDir);
  });

  beforeEach(async () => {
    service = new AiConfigService();
    await fs.mkdir(testLlmDir, { recursive: true });
    const entries = await fs.readdir(testLlmDir, { withFileTypes: true });
    for (const entry of entries) {
      await fs.rm(path.join(testLlmDir, entry.name), { recursive: true, force: true });
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

  describe('listConfigs', () => {
    it('should return empty array when no configs exist', async () => {
      const configs = await service.listConfigs();
      expect(configs).toEqual([]);
    });

    it('should return sorted config names', async () => {
      await createTestAssistantLlmConfig(testLlmDir, 'gpt-4o', mockConfig);
      await createTestAssistantLlmConfig(testLlmDir, 'claude', mockConfig);
      const configs = await service.listConfigs();
      expect(configs).toEqual(['claude', 'gpt-4o']);
    });
  });

  describe('getConfig', () => {
    it('should return config data', async () => {
      await createTestAssistantLlmConfig(testLlmDir, 'test', mockConfig);
      const config = await service.getConfig('test');
      expect(config).toEqual(mockConfig);
    });

    it('should throw for empty name', async () => {
      await expect(service.getConfig('')).rejects.toThrow('Config name cannot be empty');
    });

    it('should throw for non-existent config', async () => {
      await expect(service.getConfig('non-existent')).rejects.toThrow("Config 'non-existent' not found");
    });
  });

  describe('saveConfig', () => {
    it('should save config and read back', async () => {
      await service.saveConfig('new-config', mockConfig);
      const config = await service.getConfig('new-config');
      expect(config.model).toBe('test-model');
    });
  });

  describe('deleteConfig', () => {
    it('should delete config file', async () => {
      await createTestAssistantLlmConfig(testLlmDir, 'del', mockConfig);
      await service.deleteConfig('del');
      expect(await service.configExists('del')).toBe(false);
    });
  });

  describe('configExists', () => {
    it('should return true for existing config', async () => {
      await createTestAssistantLlmConfig(testLlmDir, 'exists', mockConfig);
      expect(await service.configExists('exists')).toBe(true);
    });

    it('should return false for non-existent config', async () => {
      expect(await service.configExists('nope')).toBe(false);
    });
  });
});
