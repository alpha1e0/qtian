/**
 * GrepTool 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { GrepTool } from '@/core/services/tools/grep-tool/grep-tool';

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe('GrepTool', () => {
  let tool: GrepTool;
  let tmpDir: string;

  beforeEach(async () => {
    tool = new GrepTool();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grep-tool-test-'));

    // 创建测试文件结构
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'src', 'app.ts'),
      'import { createApp } from "vue"\nconst app = createApp()\napp.mount("#app")\n',
    );
    await fs.writeFile(
      path.join(tmpDir, 'src', 'config.ts'),
      'export const API_URL = "https://api.example.com"\nexport const TIMEOUT = 30000\n',
    );
    await fs.writeFile(
      path.join(tmpDir, 'src', 'utils.ts'),
      'export function formatDate(date: Date): string {\n  return date.toISOString()\n}\n',
    );
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      '{"name": "test", "version": "1.0.0"}',
    );
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      '# Test Project\nThis is a test project.\n',
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ==================== 属性测试 ====================

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('grep');
    });

    it('should have description', () => {
      expect(tool.description).toBeTruthy();
    });

    it('should have valid parameters schema', () => {
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.required).toContain('pattern');
      expect(tool.parameters.properties.pattern.type).toBe('string');
      expect(tool.parameters.properties.output_mode.enum).toBeDefined();
    });
  });

  // ==================== 参数校验 ====================

  describe('input validation', () => {
    it('should reject empty pattern', async () => {
      const result = await tool.execute({ pattern: '' });
      expect(result).toContain('Error');
    });

    it('should reject missing pattern', async () => {
      const result = await tool.execute({});
      expect(result).toContain('Error');
    });

    it('should reject invalid regex', async () => {
      const result = await tool.execute({ pattern: '[invalid', path: tmpDir });
      expect(result).toContain('Error');
      expect(result).toContain('Invalid regex');
    });

    it('should reject non-existent path', async () => {
      const result = await tool.execute({
        pattern: 'test',
        path: path.join(tmpDir, 'nonexistent'),
      });
      expect(result).toContain('Error');
      expect(result).toContain('does not exist');
    });

    it('should reject invalid output_mode', async () => {
      const result = await tool.execute({ pattern: 'test', output_mode: 'invalid' });
      expect(result).toContain('Error');
      expect(result).toContain('Invalid output_mode');
    });
  });

  // ==================== files_with_matches 模式 ====================

  describe('files_with_matches mode', () => {
    it('should find files containing pattern', async () => {
      const result = await tool.execute({
        pattern: 'createApp',
        path: tmpDir,
      });

      expect(result).toContain('app.ts');
      expect(result).not.toContain('config.ts');
    });

    it('should find files across multiple files', async () => {
      const result = await tool.execute({
        pattern: 'export',
        path: tmpDir,
      });

      expect(result).toContain('config.ts');
      expect(result).toContain('utils.ts');
    });

    it('should return "No matches found" when nothing matches', async () => {
      const result = await tool.execute({
        pattern: 'xyz_not_found_anywhere',
        path: tmpDir,
      });

      expect(result).toBe('No matches found');
    });

    it('should search single file', async () => {
      const filePath = path.join(tmpDir, 'src', 'app.ts');
      const result = await tool.execute({
        pattern: 'createApp',
        path: filePath,
      });

      expect(result).toContain('app.ts');
    });
  });

  // ==================== content 模式 ====================

  describe('content mode', () => {
    it('should return matching lines with line numbers', async () => {
      const result = await tool.execute({
        pattern: 'createApp',
        path: tmpDir,
        output_mode: 'content',
      });

      expect(result).toContain('app.ts:');
      expect(result).toContain('createApp');
    });

    it('should include file path and line number', async () => {
      const result = await tool.execute({
        pattern: 'API_URL',
        path: tmpDir,
        output_mode: 'content',
      });

      // 格式: path:lineNumber:content
      expect(result).toMatch(/config\.ts:\d+/);
      expect(result).toContain('API_URL');
    });

    it('should support context lines (-C)', async () => {
      const result = await tool.execute({
        pattern: 'TIMEOUT',
        path: path.join(tmpDir, 'src', 'config.ts'),
        output_mode: 'content',
        '-C': 1,
      });

      // 应包含上下文行 (用 - 和 + 标记)
      expect(result).toContain('-');
      expect(result).toContain('TIMEOUT');
    });

    it('should support context lines before (-B)', async () => {
      const result = await tool.execute({
        pattern: 'TIMEOUT',
        path: path.join(tmpDir, 'src', 'config.ts'),
        output_mode: 'content',
        '-B': 1,
      });

      expect(result).toContain('API_URL');
      expect(result).toContain('TIMEOUT');
    });

    it('should support context lines after (-A)', async () => {
      const result = await tool.execute({
        pattern: 'API_URL',
        path: path.join(tmpDir, 'src', 'config.ts'),
        output_mode: 'content',
        '-A': 1,
      });

      expect(result).toContain('API_URL');
      expect(result).toContain('TIMEOUT');
    });

    it('should return "No matches found" for no matches in content mode', async () => {
      const result = await tool.execute({
        pattern: 'xyz_not_found',
        path: tmpDir,
        output_mode: 'content',
      });

      expect(result).toBe('No matches found');
    });
  });

  // ==================== count 模式 ====================

  describe('count mode', () => {
    it('should return match count per file', async () => {
      const result = await tool.execute({
        pattern: 'export',
        path: tmpDir,
        output_mode: 'count',
      });

      expect(result).toMatch(/config\.ts: \d+ match/);
      expect(result).toMatch(/utils\.ts: \d+ match/);
    });

    it('should show correct plural', async () => {
      const result = await tool.execute({
        pattern: 'export',
        path: path.join(tmpDir, 'src', 'config.ts'),
        output_mode: 'count',
      });

      // config.ts has 2 exports
      expect(result).toMatch(/2 matches/);
    });

    it('should return "No matches found" for no matches in count mode', async () => {
      const result = await tool.execute({
        pattern: 'xyz_not_found',
        path: tmpDir,
        output_mode: 'count',
      });

      expect(result).toBe('No matches found');
    });
  });

  // ==================== 大小写忽略 ====================

  describe('case insensitive search', () => {
    it('should find matches case insensitively', async () => {
      const result = await tool.execute({
        pattern: 'createapp',
        path: tmpDir,
        '-i': true,
      });

      expect(result).toContain('app.ts');
    });

    it('should not find matches without -i flag', async () => {
      const result = await tool.execute({
        pattern: 'CREATEAPP',
        path: tmpDir,
      });

      expect(result).toBe('No matches found');
    });
  });

  // ==================== glob 过滤 ====================

  describe('glob filtering', () => {
    it('should filter files by glob pattern', async () => {
      const result = await tool.execute({
        pattern: 'test',
        path: tmpDir,
        glob: '*.json',
      });

      expect(result).toContain('package.json');
      expect(result).not.toContain('README');
    });

    it('should filter by extension glob', async () => {
      const result = await tool.execute({
        pattern: 'export',
        path: tmpDir,
        glob: '*.ts',
      });

      expect(result).toContain('config.ts');
      expect(result).toContain('utils.ts');
      expect(result).not.toContain('package.json');
    });
  });

  // ==================== head_limit ====================

  describe('head_limit', () => {
    it('should truncate results when head_limit is reached', async () => {
      // 创建多个包含 "match" 的文件
      const subDir = path.join(tmpDir, 'many');
      await fs.mkdir(subDir);
      for (let i = 0; i < 10; i++) {
        await fs.writeFile(path.join(subDir, `file-${i}.txt`), 'match line\n');
      }

      const result = await tool.execute({
        pattern: 'match',
        path: subDir,
        head_limit: 3,
      });

      expect(result).toContain('truncated');
    });

    it('should return all results when head_limit is 0', async () => {
      const result = await tool.execute({
        pattern: 'export',
        path: tmpDir,
        head_limit: 0,
      });

      expect(result).not.toContain('truncated');
    });
  });

  // ==================== 正则表达式 ====================

  describe('regex patterns', () => {
    it('should support regex or patterns', async () => {
      const result = await tool.execute({
        pattern: 'createApp|formatDate',
        path: tmpDir,
      });

      expect(result).toContain('app.ts');
      expect(result).toContain('utils.ts');
    });

    it('should support regex anchors', async () => {
      const result = await tool.execute({
        pattern: '^export',
        path: tmpDir,
        output_mode: 'content',
      });

      expect(result).toMatch(/config\.ts/);
      expect(result).toMatch(/utils\.ts/);
    });

    it('should support regex character classes', async () => {
      const result = await tool.execute({
        pattern: 'const\\s+\\w+',
        path: tmpDir,
        output_mode: 'content',
      });

      expect(result).toContain('app.ts');
    });
  });

  // ==================== VCS 排除 ====================

  describe('VCS directory exclusion', () => {
    it('should skip .git directory', async () => {
      const gitDir = path.join(tmpDir, '.git');
      await fs.mkdir(gitDir);
      await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');

      const result = await tool.execute({
        pattern: 'refs/heads',
        path: tmpDir,
      });

      expect(result).toBe('No matches found');
    });
  });

  // ==================== 边界情况 ====================

  describe('edge cases', () => {
    it('should handle empty files', async () => {
      await fs.writeFile(path.join(tmpDir, 'empty.txt'), '');

      const result = await tool.execute({
        pattern: 'anything',
        path: path.join(tmpDir, 'empty.txt'),
      });

      expect(result).toBe('No matches found');
    });

    it('should handle path with spaces', async () => {
      const dir = path.join(tmpDir, 'path with spaces');
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, 'test.txt'), 'hello world');

      const result = await tool.execute({
        pattern: 'hello',
        path: dir,
      });

      expect(result).toContain('test.txt');
    });

    it('should search in nested directories', async () => {
      const deepDir = path.join(tmpDir, 'a', 'b', 'c');
      await fs.mkdir(deepDir, { recursive: true });
      await fs.writeFile(path.join(deepDir, 'deep.txt'), 'deep match content');

      const result = await tool.execute({
        pattern: 'deep match',
        path: tmpDir,
      });

      expect(result).toContain('deep.txt');
    });

    it('should handle unicode content', async () => {
      await fs.writeFile(path.join(tmpDir, 'unicode.txt'), '你好世界\n');

      const result = await tool.execute({
        pattern: '你好',
        path: tmpDir,
      });

      expect(result).toContain('unicode.txt');
    });
  });
});
