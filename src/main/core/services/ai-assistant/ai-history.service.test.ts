/**
 * AI 助手对话历史服务测试
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { AiHistoryService } from '@/core/services/ai-assistant/ai-history.service';
import { AiChatHistory } from '@/core/common/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as context from '@/core/common/context';
import {
  getTestAssistantHistoryDir,
  setupTestAssistantEnvironment,
  finalAssistantCleanup,
  initAssistantTestState,
  markAssistantTestFailed,
  createTestAssistantHistory,
} from '#testing/scripts/ai-assistant-test-helper';

const TEST_FILE_NAME = 'test_ai-history.service';

const mockHistory: AiChatHistory = {
  id: 'test-history',
  scenario_id: 'test-scenario',
  title: '测试对话',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.', timestamp: Date.now(), model: 'gpt-4', time: '2025-1-1 12:0:0' },
    { role: 'user', content: 'Hello', timestamp: Date.now(), model: 'gpt-4', time: '2025-1-1 12:0:1' },
  ],
  created_at: Date.now(),
  updated_at: Date.now(),
};

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe('AiHistoryService', () => {
  let service: AiHistoryService;
  let testHistoryDir: string;

  beforeAll(async () => {
    initAssistantTestState(TEST_FILE_NAME);
    testHistoryDir = getTestAssistantHistoryDir(TEST_FILE_NAME);
    await setupTestAssistantEnvironment(testHistoryDir);
    vi.spyOn(context.wpath, 'assistantHistoryDir', 'get').mockReturnValue(testHistoryDir);
  });

  beforeEach(async () => {
    service = new AiHistoryService();
    await fs.mkdir(testHistoryDir, { recursive: true });
    const entries = await fs.readdir(testHistoryDir, { withFileTypes: true });
    for (const entry of entries) {
      await fs.rm(path.join(testHistoryDir, entry.name), { recursive: true, force: true });
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

  describe('listHistories', () => {
    it('should return empty array when no histories exist', async () => {
      const histories = await service.listHistories('test-scenario');
      expect(histories).toEqual([]);
    });

    it('should return sorted history IDs', async () => {
      await createTestAssistantHistory(testHistoryDir, 'test-scenario', 'chat_2', mockHistory);
      await createTestAssistantHistory(testHistoryDir, 'test-scenario', 'chat_1', mockHistory);
      const histories = await service.listHistories('test-scenario');
      expect(histories).toEqual(['chat_1', 'chat_2']);
    });
  });

  describe('getHistory', () => {
    it('should return history data', async () => {
      await createTestAssistantHistory(testHistoryDir, 'test-scenario', 'chat_1', mockHistory);
      const history = await service.getHistory('test-scenario', 'chat_1');
      expect(history.title).toBe('测试对话');
      expect(history.messages).toHaveLength(2);
    });

    it('should throw for empty history ID', async () => {
      await expect(service.getHistory('test', '')).rejects.toThrow('History ID cannot be empty');
    });

    it('should throw for non-existent history', async () => {
      await expect(service.getHistory('test', 'nope')).rejects.toThrow("History 'nope' not found");
    });
  });

  describe('createHistory', () => {
    it('should create history and verify', async () => {
      await service.createHistory('test-scenario', 'new-chat', mockHistory);
      const history = await service.getHistory('test-scenario', 'new-chat');
      expect(history.title).toBe('测试对话');
    });

    it('should throw when history already exists', async () => {
      await createTestAssistantHistory(testHistoryDir, 'test-scenario', 'dup', mockHistory);
      await expect(service.createHistory('test-scenario', 'dup', mockHistory)).rejects.toThrow("History 'dup' already exists");
    });
  });

  describe('saveHistory', () => {
    it('should overwrite existing history', async () => {
      await createTestAssistantHistory(testHistoryDir, 'test-scenario', 'save-test', mockHistory);
      const updated = { ...mockHistory, title: '已更新' };
      await service.saveHistory('test-scenario', 'save-test', updated);

      const history = await service.getHistory('test-scenario', 'save-test');
      expect(history.title).toBe('已更新');
    });
  });

  describe('deleteHistory', () => {
    it('should delete history file', async () => {
      await createTestAssistantHistory(testHistoryDir, 'test-scenario', 'del', mockHistory);
      await service.deleteHistory('test-scenario', 'del');
      expect(await service.historyExists('test-scenario', 'del')).toBe(false);
    });
  });

  describe('historyExists', () => {
    it('should return true for existing history', async () => {
      await createTestAssistantHistory(testHistoryDir, 'test-scenario', 'exists', mockHistory);
      expect(await service.historyExists('test-scenario', 'exists')).toBe(true);
    });

    it('should return false for non-existent history', async () => {
      expect(await service.historyExists('test', 'nope')).toBe(false);
    });
  });
});
