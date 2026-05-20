/**
 * WriteTool 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { WriteTool } from '@/core/services/tools/write-tool/write-tool';

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe('WriteTool', () => {
  let tool: WriteTool;
  let tmpDir: string;

  beforeEach(async () => {
    tool = new WriteTool();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'write-tool-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ==================== 属性测试 ====================

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('file_write');
    });

    it('should have description', () => {
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('should have valid parameters schema', () => {
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.required).toContain('file_path');
      expect(tool.parameters.required).toContain('content');
      expect(tool.parameters.properties.file_path.type).toBe('string');
      expect(tool.parameters.properties.content.type).toBe('string');
    });
  });

  // ==================== 参数校验 ====================

  describe('input validation', () => {
    it('should reject empty file_path', async () => {
      const result = await tool.execute({ file_path: '', content: 'test' });
      expect(result).toContain('Error');
      expect(result).toContain('required');
    });

    it('should reject missing file_path', async () => {
      const result = await tool.execute({ content: 'test' });
      expect(result).toContain('Error');
      expect(result).toContain('required');
    });

    it('should reject non-string file_path', async () => {
      const result = await tool.execute({ file_path: 123, content: 'test' });
      expect(result).toContain('Error');
    });

    it('should reject missing content', async () => {
      const result = await tool.execute({ file_path: '/some/path' });
      expect(result).toContain('Error');
      expect(result).toContain('required');
    });

    it('should reject null content', async () => {
      const result = await tool.execute({ file_path: '/some/path', content: null });
      expect(result).toContain('Error');
    });

    it('should reject non-string content', async () => {
      const result = await tool.execute({ file_path: '/some/path', content: 42 });
      expect(result).toContain('Error');
      expect(result).toContain('must be a string');
    });
  });

  // ==================== 设备文件黑名单 ====================

  describe('blocked device paths', () => {
    it('should block /dev/zero', async () => {
      const result = await tool.execute({ file_path: '/dev/zero', content: 'test' });
      expect(result).toContain('Error');
      expect(result).toContain('device');
    });

    it('should block /dev/random', async () => {
      const result = await tool.execute({ file_path: '/dev/random', content: 'test' });
      expect(result).toContain('Error');
    });

    it('should block /dev/stdout', async () => {
      const result = await tool.execute({ file_path: '/dev/stdout', content: 'test' });
      expect(result).toContain('Error');
    });

    it('should block /proc/self/fd/1', async () => {
      const result = await tool.execute({ file_path: '/proc/self/fd/1', content: 'test' });
      expect(result).toContain('Error');
    });
  });

  // ==================== 内容大小限制 ====================

  describe('content size limit', () => {
    it('should reject content exceeding 1MB', async () => {
      const largeContent = 'x'.repeat(1024 * 1024 + 1); // 1MB + 1 byte
      const result = await tool.execute({ file_path: path.join(tmpDir, 'large.txt'), content: largeContent });
      expect(result).toContain('Error');
      expect(result).toContain('exceeds maximum');
    });
  });

  // ==================== 创建新文件 ====================

  describe('create new file', () => {
    it('should create a new file', async () => {
      const filePath = path.join(tmpDir, 'new-file.txt');
      const result = await tool.execute({ file_path: filePath, content: 'hello world' });

      expect(result).toContain('created successfully');
      expect(result).toContain('1 lines');

      const written = await fs.readFile(filePath, 'utf-8');
      expect(written).toBe('hello world');
    });

    it('should create file with multiple lines', async () => {
      const filePath = path.join(tmpDir, 'multi.txt');
      const content = 'line1\nline2\nline3';
      const result = await tool.execute({ file_path: filePath, content });

      expect(result).toContain('3 lines');

      const written = await fs.readFile(filePath, 'utf-8');
      expect(written).toBe('line1\nline2\nline3');
    });

    it('should create file with empty content', async () => {
      const filePath = path.join(tmpDir, 'empty.txt');
      const result = await tool.execute({ file_path: filePath, content: '' });

      expect(result).toContain('created successfully');
      expect(result).toContain('0 lines');

      const written = await fs.readFile(filePath, 'utf-8');
      expect(written).toBe('');
    });

    it('should create parent directories automatically', async () => {
      const filePath = path.join(tmpDir, 'sub', 'dir', 'deep', 'file.txt');
      const result = await tool.execute({ file_path: filePath, content: 'deep file' });

      expect(result).toContain('created successfully');

      const written = await fs.readFile(filePath, 'utf-8');
      expect(written).toBe('deep file');
    });

    it('should create file with path containing spaces', async () => {
      const filePath = path.join(tmpDir, 'path with spaces', 'file.txt');
      const result = await tool.execute({ file_path: filePath, content: 'spaced' });

      expect(result).toContain('created successfully');
    });
  });

  // ==================== 覆盖已有文件 ====================

  describe('update existing file', () => {
    it('should overwrite existing file', async () => {
      const filePath = path.join(tmpDir, 'existing.txt');
      await fs.writeFile(filePath, 'old content');

      const result = await tool.execute({ file_path: filePath, content: 'new content' });

      expect(result).toContain('updated successfully');

      const written = await fs.readFile(filePath, 'utf-8');
      expect(written).toBe('new content');
    });

    it('should report update for existing file', async () => {
      const filePath = path.join(tmpDir, 'update.txt');
      await fs.writeFile(filePath, 'initial');

      const result = await tool.execute({ file_path: filePath, content: 'replaced' });

      expect(result).toContain('updated');
      expect(result).not.toContain('created');
    });
  });

  // ==================== 行尾处理 ====================

  describe('line ending normalization', () => {
    it('should convert CRLF to LF', async () => {
      const filePath = path.join(tmpDir, 'crlf.txt');
      await tool.execute({ file_path: filePath, content: 'line1\r\nline2\r\nline3' });

      const written = await fs.readFile(filePath, 'utf-8');
      expect(written).toBe('line1\nline2\nline3');
      expect(written).not.toContain('\r\n');
    });

    it('should preserve LF content unchanged', async () => {
      const filePath = path.join(tmpDir, 'lf.txt');
      await tool.execute({ file_path: filePath, content: 'line1\nline2\nline3' });

      const written = await fs.readFile(filePath, 'utf-8');
      expect(written).toBe('line1\nline2\nline3');
    });

    it('should handle mixed line endings', async () => {
      const filePath = path.join(tmpDir, 'mixed.txt');
      await tool.execute({ file_path: filePath, content: 'line1\r\nline2\nline3\r\n' });

      const written = await fs.readFile(filePath, 'utf-8');
      expect(written).toBe('line1\nline2\nline3\n');
    });
  });

  // ==================== 行数计算 ====================

  describe('line counting', () => {
    it('should count single line (no trailing newline)', async () => {
      const filePath = path.join(tmpDir, 'one.txt');
      const result = await tool.execute({ file_path: filePath, content: 'single line' });
      expect(result).toContain('1 lines');
    });

    it('should count lines with trailing newline', async () => {
      const filePath = path.join(tmpDir, 'trailing.txt');
      const result = await tool.execute({ file_path: filePath, content: 'line1\nline2\n' });
      // 'line1\nline2\n' → trailing newline is a terminator, so 2 lines
      expect(result).toContain('2 lines');
    });

    it('should count empty content as 0 lines', async () => {
      const filePath = path.join(tmpDir, 'zero.txt');
      const result = await tool.execute({ file_path: filePath, content: '' });
      expect(result).toContain('0 lines');
    });
  });

  // ==================== 目录检查 ====================

  describe('directory check', () => {
    it('should reject writing to a directory path', async () => {
      const result = await tool.execute({ file_path: tmpDir, content: 'test' });
      expect(result).toContain('Error');
      expect(result).toContain('directory');
    });
  });

  // ==================== 错误处理 ====================

  describe('error handling', () => {
    it('should handle permission denied', async () => {
      // 跳过 Windows (权限模型不同)
      if (process.platform === 'win32') return;

      const filePath = path.join(tmpDir, 'readonly-dir', 'file.txt');
      await fs.mkdir(path.join(tmpDir, 'readonly-dir'));
      await fs.chmod(path.join(tmpDir, 'readonly-dir'), 0o444);

      const result = await tool.execute({ file_path: filePath, content: 'test' });
      expect(result).toContain('Error');

      // 恢复权限以便 cleanup 删除
      await fs.chmod(path.join(tmpDir, 'readonly-dir'), 0o755);
    });

    it('should handle relative path by resolving to absolute', async () => {
      const filePath = path.join(tmpDir, 'relative.txt');
      const relativePath = path.relative(process.cwd(), filePath);
      const result = await tool.execute({ file_path: relativePath, content: 'relative content' });

      expect(result).toContain('successfully');

      const written = await fs.readFile(filePath, 'utf-8');
      expect(written).toBe('relative content');
    });
  });

  // ==================== 输出格式 ====================

  describe('output format', () => {
    it('should include file path in create result', async () => {
      const filePath = path.join(tmpDir, 'output-create.txt');
      const result = await tool.execute({ file_path: filePath, content: 'test' });

      expect(result).toContain(filePath);
      expect(result).toContain('created successfully');
    });

    it('should include file path in update result', async () => {
      const filePath = path.join(tmpDir, 'output-update.txt');
      await fs.writeFile(filePath, 'old');
      const result = await tool.execute({ file_path: filePath, content: 'new' });

      expect(result).toContain(filePath);
      expect(result).toContain('updated successfully');
    });

    it('should include size information', async () => {
      const filePath = path.join(tmpDir, 'size.txt');
      const result = await tool.execute({ file_path: filePath, content: 'hello' });

      // 内容应该有大小信息
      expect(result).toMatch(/\dB/); // e.g., "5B"
    });
  });

  // ==================== 边界情况 ====================

  describe('edge cases', () => {
    it('should handle content with only newlines', async () => {
      const filePath = path.join(tmpDir, 'newlines.txt');
      const result = await tool.execute({ file_path: filePath, content: '\n\n\n' });

      expect(result).toContain('successfully');

      const written = await fs.readFile(filePath, 'utf-8');
      expect(written).toBe('\n\n\n');
    });

    it('should handle content with unicode', async () => {
      const filePath = path.join(tmpDir, 'unicode.txt');
      const content = '你好世界\nこんにちは\n🌍';
      const result = await tool.execute({ file_path: filePath, content });

      expect(result).toContain('successfully');

      const written = await fs.readFile(filePath, 'utf-8');
      expect(written).toBe(content);
    });

    it('should handle content at exact 1MB boundary', async () => {
      const filePath = path.join(tmpDir, 'exact-1mb.txt');
      // 恰好 1MB 内容
      const content = 'x'.repeat(1024 * 1024);
      const result = await tool.execute({ file_path: filePath, content });

      expect(result).toContain('successfully');
    });
  });
});
