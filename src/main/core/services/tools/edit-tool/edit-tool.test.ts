/**
 * EditTool 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { EditTool } from '@/core/services/tools/edit-tool/edit-tool';

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe('EditTool', () => {
  let tool: EditTool;
  let tmpDir: string;

  beforeEach(async () => {
    tool = new EditTool();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'edit-tool-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ==================== 属性测试 ====================

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('file_edit');
    });

    it('should have description', () => {
      expect(tool.description).toBeTruthy();
    });

    it('should have valid parameters schema', () => {
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.required).toContain('file_path');
      expect(tool.parameters.required).toContain('old_string');
      expect(tool.parameters.required).toContain('new_string');
      expect(tool.parameters.properties.file_path.type).toBe('string');
      expect(tool.parameters.properties.old_string.type).toBe('string');
      expect(tool.parameters.properties.new_string.type).toBe('string');
      expect(tool.parameters.properties.replace_all.type).toBe('boolean');
    });
  });

  // ==================== 参数校验 ====================

  describe('input validation', () => {
    it('should reject empty file_path', async () => {
      const result = await tool.execute({ file_path: '', old_string: 'a', new_string: 'b' });
      expect(result).toContain('Error');
    });

    it('should reject missing old_string', async () => {
      const result = await tool.execute({ file_path: '/tmp/test.txt', new_string: 'b' });
      expect(result).toContain('Error');
      expect(result).toContain('old_string');
    });

    it('should reject non-string old_string', async () => {
      const result = await tool.execute({ file_path: '/tmp/test.txt', old_string: 123, new_string: 'b' });
      expect(result).toContain('Error');
    });

    it('should reject missing new_string', async () => {
      const result = await tool.execute({ file_path: '/tmp/test.txt', old_string: 'a' });
      expect(result).toContain('Error');
      expect(result).toContain('new_string');
    });

    it('should reject same old_string and new_string', async () => {
      const result = await tool.execute({ file_path: '/tmp/test.txt', old_string: 'same', new_string: 'same' });
      expect(result).toContain('Error');
      expect(result).toContain('exactly the same');
    });
  });

  // ==================== 设备文件黑名单 ====================

  describe('blocked device paths', () => {
    it('should block /dev/zero', async () => {
      const result = await tool.execute({ file_path: '/dev/zero', old_string: 'a', new_string: 'b' });
      expect(result).toContain('Error');
    });

    it('should block /dev/random', async () => {
      const result = await tool.execute({ file_path: '/dev/random', old_string: 'a', new_string: 'b' });
      expect(result).toContain('Error');
    });
  });

  // ==================== 基本编辑 ====================

  describe('basic editing', () => {
    it('should replace a single occurrence', async () => {
      const filePath = path.join(tmpDir, 'edit.txt');
      await fs.writeFile(filePath, 'hello world');

      const result = await tool.execute({
        file_path: filePath,
        old_string: 'world',
        new_string: 'there',
      });

      expect(result).toContain('updated successfully');

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('hello there');
    });

    it('should replace multi-line string', async () => {
      const filePath = path.join(tmpDir, 'multi.txt');
      await fs.writeFile(filePath, 'line1\nline2\nline3');

      const result = await tool.execute({
        file_path: filePath,
        old_string: 'line1\nline2',
        new_string: 'replaced1\nreplaced2',
      });

      expect(result).toContain('updated');

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('replaced1\nreplaced2\nline3');
    });

    it('should replace with empty string (deletion)', async () => {
      const filePath = path.join(tmpDir, 'delete.txt');
      await fs.writeFile(filePath, 'keep\ndelete\nkeep2');

      const result = await tool.execute({
        file_path: filePath,
        old_string: 'delete\n',
        new_string: '',
      });

      expect(result).toContain('updated');

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('keep\nkeep2');
    });

    it('should handle replacement at beginning of file', async () => {
      const filePath = path.join(tmpDir, 'start.txt');
      await fs.writeFile(filePath, 'start\nmiddle\nend');

      const result = await tool.execute({
        file_path: filePath,
        old_string: 'start',
        new_string: 'BEGIN',
      });

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('BEGIN\nmiddle\nend');
    });

    it('should handle replacement at end of file', async () => {
      const filePath = path.join(tmpDir, 'end.txt');
      await fs.writeFile(filePath, 'start\nmiddle\nend');

      const result = await tool.execute({
        file_path: filePath,
        old_string: 'end',
        new_string: 'FINISH',
      });

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('start\nmiddle\nFINISH');
    });
  });

  // ==================== 唯一性检查 ====================

  describe('uniqueness check', () => {
    it('should reject multiple matches without replace_all', async () => {
      const filePath = path.join(tmpDir, 'dup.txt');
      await fs.writeFile(filePath, 'aaa bbb aaa');

      const result = await tool.execute({
        file_path: filePath,
        old_string: 'aaa',
        new_string: 'ccc',
      });

      expect(result).toContain('Error');
      expect(result).toContain('2 matches');
    });

    it('should replace all matches with replace_all=true', async () => {
      const filePath = path.join(tmpDir, 'replace-all.txt');
      await fs.writeFile(filePath, 'aaa bbb aaa');

      const result = await tool.execute({
        file_path: filePath,
        old_string: 'aaa',
        new_string: 'ccc',
        replace_all: true,
      });

      expect(result).toContain('All 2 occurrences');

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('ccc bbb ccc');
    });

    it('should succeed when only one match exists', async () => {
      const filePath = path.join(tmpDir, 'unique.txt');
      await fs.writeFile(filePath, 'aaa bbb ccc');

      const result = await tool.execute({
        file_path: filePath,
        old_string: 'bbb',
        new_string: 'xxx',
      });

      expect(result).toContain('updated successfully');
    });
  });

  // ==================== 字符串未找到 ====================

  describe('string not found', () => {
    it('should report when old_string is not found', async () => {
      const filePath = path.join(tmpDir, 'notfound.txt');
      await fs.writeFile(filePath, 'hello world');

      const result = await tool.execute({
        file_path: filePath,
        old_string: 'not present',
        new_string: 'replacement',
      });

      expect(result).toContain('Error');
      expect(result).toContain('not found');
    });
  });

  // ==================== 新文件创建 ====================

  describe('new file creation', () => {
    it('should create new file when old_string is empty and file does not exist', async () => {
      const filePath = path.join(tmpDir, 'new.txt');

      const result = await tool.execute({
        file_path: filePath,
        old_string: '',
        new_string: 'new file content',
      });

      expect(result).toContain('created successfully');

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('new file content');
    });

    it('should create new file in nested directory', async () => {
      const filePath = path.join(tmpDir, 'deep', 'nested', 'new.txt');

      const result = await tool.execute({
        file_path: filePath,
        old_string: '',
        new_string: 'deep content',
      });

      expect(result).toContain('created successfully');

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('deep content');
    });

    it('should reject creation when file exists and is not empty', async () => {
      const filePath = path.join(tmpDir, 'exists.txt');
      await fs.writeFile(filePath, 'existing content');

      const result = await tool.execute({
        file_path: filePath,
        old_string: '',
        new_string: 'new content',
      });

      expect(result).toContain('Error');
      expect(result).toContain('already exists');
    });

    it('should allow old_string="" when file exists but is empty', async () => {
      const filePath = path.join(tmpDir, 'empty.txt');
      await fs.writeFile(filePath, '');

      const result = await tool.execute({
        file_path: filePath,
        old_string: '',
        new_string: 'now has content',
      });

      expect(result).toContain('created successfully');

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('now has content');
    });
  });

  // ==================== 引号规范化 ====================

  describe('quote normalization', () => {
    it('should match curly single quotes', async () => {
      const filePath = path.join(tmpDir, 'curly-single.txt');
      // 文件中包含弯引号 '
      await fs.writeFile(filePath, "it\u2019s a test");

      const result = await tool.execute({
        file_path: filePath,
        old_string: "it's a test",
        new_string: "it's modified",
      });

      expect(result).toContain('updated');

      const content = await fs.readFile(filePath, 'utf-8');
      // new_string 中的直引号应被转为弯引号
      expect(content).toBe("it\u2019s modified");
    });

    it('should match curly double quotes', async () => {
      const filePath = path.join(tmpDir, 'curly-double.txt');
      // 文件中包含弯引号 "
      await fs.writeFile(filePath, '\u201Chello\u201D');

      const result = await tool.execute({
        file_path: filePath,
        old_string: '"hello"',
        new_string: '"world"',
      });

      expect(result).toContain('updated');

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('\u201Cworld\u201D');
    });

    it('should keep straight quotes when file uses straight quotes', async () => {
      const filePath = path.join(tmpDir, 'straight.txt');
      await fs.writeFile(filePath, '"hello"');

      const result = await tool.execute({
        file_path: filePath,
        old_string: '"hello"',
        new_string: '"world"',
      });

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('"world"');
    });
  });

  // ==================== 行尾保留 ====================

  describe('line ending preservation', () => {
    it('should preserve CRLF line endings', async () => {
      const filePath = path.join(tmpDir, 'crlf.txt');
      await fs.writeFile(filePath, 'line1\r\nline2\r\nline3');

      const result = await tool.execute({
        file_path: filePath,
        old_string: 'line2',
        new_string: 'replaced',
      });

      expect(result).toContain('updated');

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('line1\r\nreplaced\r\nline3');
    });

    it('should preserve LF line endings', async () => {
      const filePath = path.join(tmpDir, 'lf.txt');
      await fs.writeFile(filePath, 'line1\nline2\nline3');

      const result = await tool.execute({
        file_path: filePath,
        old_string: 'line2',
        new_string: 'replaced',
      });

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('line1\nreplaced\nline3');
      expect(content).not.toContain('\r\n');
    });
  });

  // ==================== 错误处理 ====================

  describe('error handling', () => {
    it('should report file not found for non-empty old_string', async () => {
      const result = await tool.execute({
        file_path: path.join(tmpDir, 'nonexistent.txt'),
        old_string: 'something',
        new_string: 'else',
      });

      expect(result).toContain('Error');
      expect(result).toContain('does not exist');
    });

    it('should reject directory path', async () => {
      const result = await tool.execute({
        file_path: tmpDir,
        old_string: 'a',
        new_string: 'b',
      });

      expect(result).toContain('Error');
      expect(result).toContain('directory');
    });

    it('should handle permission denied', async () => {
      if (process.platform === 'win32') return;

      const filePath = path.join(tmpDir, 'noperm.txt');
      await fs.writeFile(filePath, 'content');
      await fs.chmod(filePath, 0o444);

      const result = await tool.execute({
        file_path: filePath,
        old_string: 'content',
        new_string: 'new',
      });

      expect(result).toContain('Error');
      expect(result).toContain('Permission denied');

      await fs.chmod(filePath, 0o644);
    });
  });

  // ==================== 边界情况 ====================

  describe('edge cases', () => {
    it('should handle unicode content', async () => {
      const filePath = path.join(tmpDir, 'unicode.txt');
      await fs.writeFile(filePath, '你好\n世界');

      const result = await tool.execute({
        file_path: filePath,
        old_string: '世界',
        new_string: '🌍',
      });

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('你好\n🌍');
    });

    it('should handle empty file with empty old_string', async () => {
      const filePath = path.join(tmpDir, 'create-empty.txt');

      const result = await tool.execute({
        file_path: filePath,
        old_string: '',
        new_string: 'created',
      });

      expect(result).toContain('created');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('created');
    });

    it('should handle replace_all with no matches', async () => {
      const filePath = path.join(tmpDir, 'no-match.txt');
      await fs.writeFile(filePath, 'hello');

      const result = await tool.execute({
        file_path: filePath,
        old_string: 'not there',
        new_string: 'replacement',
        replace_all: true,
      });

      expect(result).toContain('Error');
      expect(result).toContain('not found');
    });

    it('should handle large replacement content', async () => {
      const filePath = path.join(tmpDir, 'large.txt');
      await fs.writeFile(filePath, 'old content');

      const largeNew = 'x'.repeat(10000);
      const result = await tool.execute({
        file_path: filePath,
        old_string: 'old content',
        new_string: largeNew,
      });

      expect(result).toContain('updated');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content.length).toBe(10000);
    });

    it('should handle whitespace-only old_string (not empty)', async () => {
      const filePath = path.join(tmpDir, 'whitespace.txt');
      await fs.writeFile(filePath, 'hello   world');

      const result = await tool.execute({
        file_path: filePath,
        old_string: '   ',
        new_string: ' ',
      });

      expect(result).toContain('updated');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('hello world');
    });

    it('should resolve relative path', async () => {
      const filePath = path.join(tmpDir, 'relative.txt');
      await fs.writeFile(filePath, 'original content');

      const relativePath = path.relative(process.cwd(), filePath);
      const result = await tool.execute({
        file_path: relativePath,
        old_string: 'original',
        new_string: 'modified',
      });

      expect(result).toContain('updated');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('modified content');
    });
  });
});
