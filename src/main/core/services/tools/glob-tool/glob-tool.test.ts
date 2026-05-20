/**
 * GlobTool 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { GlobTool } from '@/core/services/tools/glob-tool/glob-tool';

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe('GlobTool', () => {
  let tool: GlobTool;
  let tmpDir: string;

  beforeEach(async () => {
    tool = new GlobTool();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'glob-tool-test-'));

    // 创建测试文件结构
    await fs.mkdir(path.join(tmpDir, 'src', 'main'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'src', 'renderer'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true });

    await fs.writeFile(path.join(tmpDir, 'src', 'main', 'app.ts'), '// app');
    await fs.writeFile(path.join(tmpDir, 'src', 'main', 'config.ts'), '// config');
    await fs.writeFile(path.join(tmpDir, 'src', 'renderer', 'App.vue'), '<template/>');
    await fs.writeFile(path.join(tmpDir, 'src', 'renderer', 'Home.vue'), '<template/>');
    await fs.writeFile(path.join(tmpDir, 'package.json'), '{}');
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# test');
    await fs.writeFile(path.join(tmpDir, 'docs', 'guide.md'), '# guide');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ==================== 属性测试 ====================

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('glob');
    });

    it('should have description', () => {
      expect(tool.description).toBeTruthy();
    });

    it('should have valid parameters schema', () => {
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.required).toContain('pattern');
      expect(tool.parameters.properties.pattern.type).toBe('string');
      expect(tool.parameters.properties.path.type).toBe('string');
    });
  });

  // ==================== 参数校验 ====================

  describe('input validation', () => {
    it('should reject empty pattern', async () => {
      const result = await tool.execute({ pattern: '' });
      expect(result).toContain('Error');
      expect(result).toContain('required');
    });

    it('should reject missing pattern', async () => {
      const result = await tool.execute({});
      expect(result).toContain('Error');
    });

    it('should reject non-string pattern', async () => {
      const result = await tool.execute({ pattern: 123 });
      expect(result).toContain('Error');
    });

    it('should reject non-string path', async () => {
      const result = await tool.execute({ pattern: '*.ts', path: 123 });
      expect(result).toContain('Error');
    });
  });

  // ==================== 基本搜索 ====================

  describe('basic glob search', () => {
    it('should find files by extension', async () => {
      const result = await tool.execute({ pattern: '**/*.ts', path: tmpDir });

      expect(result).toContain('app.ts');
      expect(result).toContain('config.ts');
      expect(result).not.toContain('App.vue');
    });

    it('should find .vue files', async () => {
      const result = await tool.execute({ pattern: '**/*.vue', path: tmpDir });

      expect(result).toContain('App.vue');
      expect(result).toContain('Home.vue');
      expect(result).not.toContain('app.ts');
    });

    it('should find files in specific directory', async () => {
      const result = await tool.execute({ pattern: 'main/*.ts', path: path.join(tmpDir, 'src') });

      expect(result).toContain('app.ts');
      expect(result).toContain('config.ts');
      expect(result).not.toContain('App.vue');
    });

    it('should find root-level files', async () => {
      const result = await tool.execute({ pattern: '*.json', path: tmpDir });

      expect(result).toContain('package.json');
      expect(result).not.toContain('app.ts');
    });

    it('should find .md files recursively', async () => {
      const result = await tool.execute({ pattern: '**/*.md', path: tmpDir });

      expect(result).toContain('README.md');
      expect(result).toContain('guide.md');
    });
  });

  // ==================== 通配符模式 ====================

  describe('wildcard patterns', () => {
    it('should match * in filename', async () => {
      const result = await tool.execute({ pattern: '**/app.*', path: tmpDir });

      expect(result).toContain('app.ts');
      expect(result).not.toContain('config.ts');
    });

    it('should match ? single character', async () => {
      const result = await tool.execute({ pattern: 'src/main/app.?s', path: tmpDir });

      expect(result).toContain('app.ts');
    });

    it('should match ** for deep recursion', async () => {
      const result = await tool.execute({ pattern: '**/*', path: tmpDir });

      expect(result).toContain('app.ts');
      expect(result).toContain('App.vue');
      expect(result).toContain('package.json');
    });
  });

  // ==================== 搜索目录验证 ====================

  describe('directory validation', () => {
    it('should report non-existent directory', async () => {
      const result = await tool.execute({
        pattern: '**/*.ts',
        path: path.join(tmpDir, 'nonexistent'),
      });

      expect(result).toContain('Error');
      expect(result).toContain('does not exist');
    });

    it('should reject file path as search directory', async () => {
      const filePath = path.join(tmpDir, 'package.json');
      const result = await tool.execute({ pattern: '**/*.ts', path: filePath });

      expect(result).toContain('Error');
      expect(result).toContain('not a directory');
    });
  });

  // ==================== 无匹配 ====================

  describe('no matches', () => {
    it('should return "No files found" when nothing matches', async () => {
      const result = await tool.execute({ pattern: '**/*.xyz', path: tmpDir });

      expect(result).toBe('No files found');
    });

    it('should handle narrow pattern with no matches', async () => {
      const result = await tool.execute({ pattern: 'nonexistent.file', path: tmpDir });

      expect(result).toBe('No files found');
    });
  });

  // ==================== 截断 ====================

  describe('result truncation', () => {
    it('should truncate at 100 results', async () => {
      // 创建 110 个文件
      const subDir = path.join(tmpDir, 'many');
      await fs.mkdir(subDir);
      for (let i = 0; i < 110; i++) {
        await fs.writeFile(path.join(subDir, `file-${String(i).padStart(3, '0')}.txt`), 'x');
      }

      const result = await tool.execute({ pattern: '**/*.txt', path: subDir });

      expect(result).toContain('truncated');
      // 应包含 .txt 文件
      expect(result).toContain('.txt');
    });
  });

  // ==================== 绝对路径 pattern ====================

  describe('absolute path in pattern', () => {
    it('should handle absolute path in pattern', async () => {
      const absPattern = path.join(tmpDir, '**', '*.ts');
      const result = await tool.execute({ pattern: absPattern });

      expect(result).toContain('app.ts');
      expect(result).toContain('config.ts');
    });
  });

  // ==================== 路径相对化 ====================

  describe('path relativization', () => {
    it('should return relative paths when under cwd', async () => {
      // 使用 cwd 下的路径
      const cwd = process.cwd();
      const result = await tool.execute({ pattern: '*.json', path: cwd });

      // 结果不应以绝对路径开头（除非不在 cwd 下）
      if (result !== 'No files found') {
        const lines = result.split('\n').filter(l => !l.startsWith('(') && !l.startsWith('['));
        for (const line of lines) {
          if (line) {
            expect(path.isAbsolute(line)).toBe(false);
          }
        }
      }
    });
  });

  // ==================== 边界情况 ====================

  describe('edge cases', () => {
    it('should handle path with spaces', async () => {
      const dir = path.join(tmpDir, 'path with spaces');
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, 'test.txt'), 'content');

      const result = await tool.execute({ pattern: '*.txt', path: dir });
      expect(result).toContain('test.txt');
    });

    it('should handle nested directory structure', async () => {
      const deepDir = path.join(tmpDir, 'a', 'b', 'c');
      await fs.mkdir(deepDir, { recursive: true });
      await fs.writeFile(path.join(deepDir, 'deep.txt'), 'content');

      const result = await tool.execute({ pattern: '**/*.txt', path: tmpDir });
      expect(result).toContain('deep.txt');
    });

    it('should handle pattern with no glob characters', async () => {
      const result = await tool.execute({ pattern: 'package.json', path: tmpDir });
      expect(result).toContain('package.json');
    });
  });
});
