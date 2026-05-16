/**
 * bash-tool-path 单元测试
 */

import * as path from 'path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveBashPath, resetBashPathCache } from './bash-tool-path';

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe('bash-tool-path', () => {
  beforeEach(() => {
    resetBashPathCache();
  });

  describe('resolveBashPath', () => {
    it('should resolve bash.exe from project bin-vendor directory', async () => {
      // 项目中 bin-vendor/PortableGit/bin/bash.exe 应该存在
      const bashPath = await resolveBashPath();
      expect(bashPath).toContain('bash.exe');
      expect(bashPath).toContain('PortableGit');
    });

    it('should cache the result', async () => {
      const first = await resolveBashPath();
      const second = await resolveBashPath();
      expect(first).toBe(second);
    });

    it('should return an absolute path', async () => {
      const bashPath = await resolveBashPath();
      expect(path.isAbsolute(bashPath)).toBe(true);
    });
  });

  describe('resetBashPathCache', () => {
    it('should clear cached path', async () => {
      await resolveBashPath();
      resetBashPathCache();
      // 再次解析应该走完整路径而非直接返回缓存
      const bashPath = await resolveBashPath();
      expect(bashPath).toContain('bash.exe');
    });
  });
});
