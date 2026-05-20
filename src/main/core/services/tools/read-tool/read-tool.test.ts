/**
 * ReadTool 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ReadTool } from '@/core/services/tools/read-tool/read-tool';

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe('ReadTool', () => {
  let tool: ReadTool;
  let tmpDir: string;

  beforeEach(async () => {
    tool = new ReadTool();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-tool-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ==================== 属性测试 ====================

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('file_read');
    });

    it('should have description', () => {
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('should have valid parameters schema', () => {
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.required).toContain('file_path');
      expect(tool.parameters.properties.file_path.type).toBe('string');
      expect(tool.parameters.properties.offset.type).toBe('number');
      expect(tool.parameters.properties.limit.type).toBe('number');
    });
  });

  // ==================== 参数校验 ====================

  describe('input validation', () => {
    it('should reject empty file_path', async () => {
      const result = await tool.execute({ file_path: '' });
      expect(result).toContain('Error');
      expect(result).toContain('required');
    });

    it('should reject missing file_path', async () => {
      const result = await tool.execute({});
      expect(result).toContain('Error');
      expect(result).toContain('required');
    });

    it('should reject non-string file_path', async () => {
      const result = await tool.execute({ file_path: 123 });
      expect(result).toContain('Error');
      expect(result).toContain('required');
    });
  });

  // ==================== 设备文件黑名单 ====================

  describe('blocked device paths', () => {
    it('should block /dev/zero', async () => {
      const result = await tool.execute({ file_path: '/dev/zero' });
      expect(result).toContain('Error');
      expect(result).toContain('block');
    });

    it('should block /dev/random', async () => {
      const result = await tool.execute({ file_path: '/dev/random' });
      expect(result).toContain('Error');
    });

    it('should block /dev/urandom', async () => {
      const result = await tool.execute({ file_path: '/dev/urandom' });
      expect(result).toContain('Error');
    });

    it('should block /dev/stdin', async () => {
      const result = await tool.execute({ file_path: '/dev/stdin' });
      expect(result).toContain('Error');
    });

    it('should block /dev/fd/0', async () => {
      const result = await tool.execute({ file_path: '/dev/fd/0' });
      expect(result).toContain('Error');
    });

    it('should block /proc/self/fd/0', async () => {
      const result = await tool.execute({ file_path: '/proc/self/fd/0' });
      expect(result).toContain('Error');
    });
  });

  // ==================== 二进制文件拒绝 ====================

  describe('binary file rejection', () => {
    it('should reject .exe files', async () => {
      const result = await tool.execute({ file_path: 'test.exe' });
      expect(result).toContain('Error');
      expect(result).toContain('binary');
    });

    it('should reject .zip files', async () => {
      const result = await tool.execute({ file_path: 'archive.zip' });
      expect(result).toContain('Error');
      expect(result).toContain('binary');
    });

    it('should reject .dll files', async () => {
      const result = await tool.execute({ file_path: 'lib.dll' });
      expect(result).toContain('Error');
      expect(result).toContain('binary');
    });

    it('should reject .mp4 files', async () => {
      const result = await tool.execute({ file_path: 'video.mp4' });
      expect(result).toContain('Error');
      expect(result).toContain('binary');
    });
  });

  // ==================== 文本文件读取 ====================

  describe('text file reading', () => {
    it('should read a small text file with line numbers', async () => {
      const filePath = path.join(tmpDir, 'test.txt');
      await fs.writeFile(filePath, 'line1\nline2\nline3');

      const result = await tool.execute({ file_path: filePath });

      expect(result).toContain('1→line1');
      expect(result).toContain('2→line2');
      expect(result).toContain('3→line3');
      expect(result).toContain('[File:');
      expect(result).toContain('Lines: 1-3/3');
    });

    it('should read file with offset', async () => {
      const filePath = path.join(tmpDir, 'offset.txt');
      await fs.writeFile(filePath, 'line1\nline2\nline3\nline4\nline5');

      const result = await tool.execute({ file_path: filePath, offset: 3 });

      expect(result).toContain('3→line3');
      expect(result).toContain('4→line4');
      expect(result).toContain('5→line5');
      expect(result).not.toContain('1→line1');
      expect(result).not.toContain('2→line2');
      expect(result).toContain('Lines: 3-5/5');
    });

    it('should read file with limit', async () => {
      const filePath = path.join(tmpDir, 'limit.txt');
      await fs.writeFile(filePath, 'line1\nline2\nline3\nline4\nline5');

      const result = await tool.execute({ file_path: filePath, limit: 2 });

      expect(result).toContain('1→line1');
      expect(result).toContain('2→line2');
      expect(result).not.toContain('3→line3');
      expect(result).toContain('Lines: 1-2/5');
    });

    it('should read file with offset and limit', async () => {
      const filePath = path.join(tmpDir, 'range.txt');
      await fs.writeFile(filePath, 'line1\nline2\nline3\nline4\nline5');

      const result = await tool.execute({ file_path: filePath, offset: 2, limit: 2 });

      expect(result).toContain('2→line2');
      expect(result).toContain('3→line3');
      expect(result).not.toContain('1→line1');
      expect(result).not.toContain('4→line4');
      expect(result).toContain('Lines: 2-3/5');
    });

    it('should handle offset beyond file length', async () => {
      const filePath = path.join(tmpDir, 'short.txt');
      await fs.writeFile(filePath, 'line1\nline2');

      const result = await tool.execute({ file_path: filePath, offset: 100 });

      // 超出文件长度的 offset 应返回空内容，但包含元信息
      expect(result).toContain('[File:');
      expect(result).toContain('0 read');
    });

    it('should handle empty file', async () => {
      const filePath = path.join(tmpDir, 'empty.txt');
      await fs.writeFile(filePath, '');

      const result = await tool.execute({ file_path: filePath });

      expect(result).toContain('[File:');
      expect(result).toContain('0 read');
    });

    it('should handle file with single line (no trailing newline)', async () => {
      const filePath = path.join(tmpDir, 'single.txt');
      await fs.writeFile(filePath, 'single line');

      const result = await tool.execute({ file_path: filePath });

      expect(result).toContain('1→single line');
    });

    it('should handle file with CRLF line endings', async () => {
      const filePath = path.join(tmpDir, 'crlf.txt');
      await fs.writeFile(filePath, 'line1\r\nline2\r\nline3');

      const result = await tool.execute({ file_path: filePath });

      expect(result).toContain('1→line1');
      expect(result).toContain('2→line2');
      expect(result).toContain('3→line3');
    });

    it('should handle relative path by resolving to absolute', async () => {
      const filePath = path.join(tmpDir, 'relative.txt');
      await fs.writeFile(filePath, 'content');

      // 使用相对路径 (相对于 cwd)
      const relativePath = path.relative(process.cwd(), filePath);
      const result = await tool.execute({ file_path: relativePath });

      expect(result).toContain('1→content');
    });
  });

  // ==================== 大文件限制 ====================

  describe('file size limits', () => {
    it('should reject files larger than MAX_FILE_SIZE_BYTES when no limit specified', async () => {
      const filePath = path.join(tmpDir, 'large.txt');
      // 创建超过 256KB 的文件
      const largeContent = 'x'.repeat(300 * 1024);
      await fs.writeFile(filePath, largeContent);

      const result = await tool.execute({ file_path: filePath });

      expect(result).toContain('Error');
      expect(result).toContain('exceeds maximum');
    });

    it('should allow reading large files with limit parameter', async () => {
      const filePath = path.join(tmpDir, 'large-with-limit.txt');
      const lines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`);
      await fs.writeFile(filePath, lines.join('\n'));

      const result = await tool.execute({ file_path: filePath, limit: 5 });

      expect(result).toContain('1→line1');
      expect(result).toContain('5→line5');
      expect(result).not.toContain('6→line6');
    });
  });

  // ==================== 图片文件读取 ====================

  describe('image file reading', () => {
    it('should read PNG image and return base64 description', async () => {
      const filePath = path.join(tmpDir, 'test.png');
      // 创建一个最小的有效 PNG 文件 (1x1 透明像素)
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==',
        'base64',
      );
      await fs.writeFile(filePath, pngBuffer);

      const result = await tool.execute({ file_path: filePath });

      expect(result).toContain('[Image:');
      expect(result).toContain('image/png');
      expect(result).toContain('Size:');
      // base64 数据应在 header 之后出现
      expect(result).toContain('iVBOR');
    });

    it('should read JPG image', async () => {
      const filePath = path.join(tmpDir, 'test.jpg');
      // 最小 JPEG 文件 (1x1 白色像素)
      const jpgBuffer = Buffer.from(
        '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////2wBDAf//////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AqAA=', // cspell:disable-line
        'base64',
      );
      await fs.writeFile(filePath, jpgBuffer);

      const result = await tool.execute({ file_path: filePath });

      expect(result).toContain('[Image:');
      expect(result).toContain('image/jpeg');
    });

    it('should handle empty image file', async () => {
      const filePath = path.join(tmpDir, 'empty.png');
      await fs.writeFile(filePath, Buffer.alloc(0));

      const result = await tool.execute({ file_path: filePath });

      expect(result).toContain('Error');
      expect(result).toContain('empty');
    });
  });

  // ==================== 错误处理 ====================

  describe('error handling', () => {
    it('should handle file not found', async () => {
      const result = await tool.execute({ file_path: path.join(tmpDir, 'nonexistent.txt') });

      expect(result).toContain('Error');
      expect(result).toContain('does not exist');
    });

    it('should handle directory path', async () => {
      const result = await tool.execute({ file_path: tmpDir });

      expect(result).toContain('Error');
      expect(result).toContain('directory');
    });

    it('should handle permission denied', async () => {
      // 跳过 Windows (权限模型不同)
      if (process.platform === 'win32') return;

      const filePath = path.join(tmpDir, 'no-perm.txt');
      await fs.writeFile(filePath, 'secret');
      await fs.chmod(filePath, 0o000);

      const result = await tool.execute({ file_path: filePath });

      expect(result).toContain('Error');
      expect(result).toContain('Permission denied');

      // 恢复权限以便 cleanup 删除
      await fs.chmod(filePath, 0o644);
    });

    it('should handle paths with spaces', async () => {
      const filePath = path.join(tmpDir, 'file with spaces.txt');
      await fs.writeFile(filePath, 'content');

      const result = await tool.execute({ file_path: filePath });

      expect(result).toContain('1→content');
    });
  });

  // ==================== offset 参数边界 ====================

  describe('offset edge cases', () => {
    it('should treat offset=0 as offset=1', async () => {
      const filePath = path.join(tmpDir, 'zero-offset.txt');
      await fs.writeFile(filePath, 'first\nsecond');

      const result = await tool.execute({ file_path: filePath, offset: 0 });

      expect(result).toContain('1→first');
    });

    it('should handle negative offset as offset=1', async () => {
      const filePath = path.join(tmpDir, 'neg-offset.txt');
      await fs.writeFile(filePath, 'first\nsecond');

      const result = await tool.execute({ file_path: filePath, offset: -5 });

      expect(result).toContain('1→first');
    });
  });
});
