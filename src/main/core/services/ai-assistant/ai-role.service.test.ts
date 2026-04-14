/**
 * AI 助手角色服务测试
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { AiRoleService } from '@/core/services/ai-assistant/ai-role.service';
import * as fs from 'fs/promises';
import * as context from '@/core/common/context';
import {
  getTestAssistantRoleDir,
  setupTestAssistantEnvironment,
  finalAssistantCleanup,
  initAssistantTestState,
  markAssistantTestFailed,
  createTestAssistantRole,
} from '#testing/scripts/ai-assistant-test-helper';

const TEST_FILE_NAME = 'test_ai-role.service';
const MOCK_CONTENT = '# Role: 翻译专家\n\n你是一个精通多国语言的翻译官。';

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe('AiRoleService', () => {
  let service: AiRoleService;
  let testRoleDir: string;

  beforeAll(async () => {
    initAssistantTestState(TEST_FILE_NAME);
    testRoleDir = getTestAssistantRoleDir(TEST_FILE_NAME);
    await setupTestAssistantEnvironment(testRoleDir);
    vi.spyOn(context.wpath, 'assistantRoleDir', 'get').mockReturnValue(testRoleDir);
  });

  beforeEach(async () => {
    service = new AiRoleService();
    await fs.mkdir(testRoleDir, { recursive: true });
    const entries = await fs.readdir(testRoleDir, { withFileTypes: true });
    for (const entry of entries) {
      await fs.rm(require('path').join(testRoleDir, entry.name), { recursive: true, force: true });
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

  describe('listRoles', () => {
    it('should return empty array when no roles exist', async () => {
      const roles = await service.listRoles();
      expect(roles).toEqual([]);
    });

    it('should return sorted role names', async () => {
      await createTestAssistantRole(testRoleDir, 'translator', MOCK_CONTENT);
      await createTestAssistantRole(testRoleDir, 'coder', MOCK_CONTENT);
      const roles = await service.listRoles();
      expect(roles).toEqual(['coder', 'translator']);
    });
  });

  describe('getRole', () => {
    it('should return role with name and content', async () => {
      await createTestAssistantRole(testRoleDir, 'test', MOCK_CONTENT);
      const role = await service.getRole('test');
      expect(role.name).toBe('test');
      expect(role.content).toBe(MOCK_CONTENT);
    });

    it('should throw for empty name', async () => {
      await expect(service.getRole('')).rejects.toThrow('Role name cannot be empty');
    });

    it('should throw for non-existent role', async () => {
      await expect(service.getRole('non-existent')).rejects.toThrow("Role 'non-existent' not found");
    });
  });

  describe('saveRole', () => {
    it('should save role content', async () => {
      await service.saveRole('new-role', MOCK_CONTENT);
      const role = await service.getRole('new-role');
      expect(role.content).toBe(MOCK_CONTENT);
    });
  });

  describe('deleteRole', () => {
    it('should delete role file', async () => {
      await createTestAssistantRole(testRoleDir, 'del', MOCK_CONTENT);
      await service.deleteRole('del');
      expect(await service.roleExists('del')).toBe(false);
    });
  });

  describe('roleExists', () => {
    it('should return true for existing role', async () => {
      await createTestAssistantRole(testRoleDir, 'exists', MOCK_CONTENT);
      expect(await service.roleExists('exists')).toBe(true);
    });

    it('should return false for non-existent role', async () => {
      expect(await service.roleExists('nope')).toBe(false);
    });
  });
});
