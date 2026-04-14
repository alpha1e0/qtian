/**
 * ShellTool 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShellTool } from '@/core/services/ai-assistant/tools/shell-tool';

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe('ShellTool', () => {
  let tool: ShellTool;

  beforeEach(() => {
    tool = new ShellTool();
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('shell_execute');
    });

    it('should have description', () => {
      expect(tool.description).toBeTruthy();
    });

    it('should have valid parameters schema', () => {
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.required).toContain('command');
      expect(tool.parameters.properties.command.type).toBe('string');
      expect(tool.parameters.properties.timeout.type).toBe('number');
      expect(tool.parameters.properties.cwd.type).toBe('string');
    });
  });

  describe('execute', () => {
    it('should execute basic command and return output', async () => {
      const result = await tool.execute({ command: 'echo hello' });
      expect(result).toContain('hello');
    });

    it('should execute command with multiple outputs', async () => {
      const result = await tool.execute({ command: 'echo line1 && echo line2' });
      expect(result).toContain('line1');
      expect(result).toContain('line2');
    });

    it('should reject empty command', async () => {
      const result = await tool.execute({ command: '' });
      expect(result).toContain('Error');
    });

    it('should reject missing command', async () => {
      const result = await tool.execute({});
      expect(result).toContain('Error');
    });

    it('should reject non-string command', async () => {
      const result = await tool.execute({ command: 123 });
      expect(result).toContain('Error');
    });
  });

  describe('dangerous command interception', () => {
    it('should block rm -rf /', async () => {
      const result = await tool.execute({ command: 'rm -rf /' });
      expect(result).toContain('Dangerous');
    });

    it('should block rm -fr /', async () => {
      const result = await tool.execute({ command: 'rm -fr /' });
      expect(result).toContain('Dangerous');
    });

    it('should block format command', async () => {
      const result = await tool.execute({ command: 'format C:' });
      expect(result).toContain('Dangerous');
    });

    it('should block mkfs command', async () => {
      const result = await tool.execute({ command: 'mkfs.ext4 /dev/sda1' });
      expect(result).toContain('Dangerous');
    });

    it('should block dd to device', async () => {
      const result = await tool.execute({ command: 'dd if=/dev/zero of=/dev/sda' });
      expect(result).toContain('Dangerous');
    });

    it('should block shutdown command', async () => {
      const result = await tool.execute({ command: 'shutdown -h now' });
      expect(result).toContain('Dangerous');
    });

    it('should allow safe commands', async () => {
      const result = await tool.execute({ command: 'echo safe' });
      expect(result).toContain('safe');
      expect(result).not.toContain('Dangerous');
    });
  });

  describe('working directory restriction', () => {
    it('should reject commands outside allowed cwd', async () => {
      const restrictedTool = new ShellTool({ allowedCwd: '/safe/dir' });
      const result = await restrictedTool.execute({ command: 'echo test', cwd: '/other/dir' });
      expect(result).toContain('Error');
      expect(result).toContain('outside the allowed scope');
    });

    it('should allow commands within allowed cwd', async () => {
      // 使用 path.resolve 确保 allowedCwd 和 cwd 在同一平台上解析一致
      const baseDir = process.cwd();
      const restrictedTool = new ShellTool({ allowedCwd: baseDir });
      const result = await restrictedTool.execute({ command: 'echo test', cwd: baseDir });
      expect(result).not.toContain('outside the allowed scope');
    });

    it('should work without cwd restriction when allowedCwd is null', async () => {
      const result = await tool.execute({ command: 'echo test' });
      expect(result).toContain('test');
    });
  });

  describe('timeout', () => {
    it('should timeout for long-running commands', async () => {
      // Windows 下使用 ping 模拟超时
      const isWin = process.platform === 'win32';
      const cmd = isWin
        ? 'ping -n 10 127.0.0.1'
        : 'sleep 10';
      const result = await tool.execute({ command: cmd, timeout: 500 });
      expect(result).toContain('timed out');
    }, 10000);
  });

  describe('constructor options', () => {
    it('should accept custom timeout', () => {
      const customTool = new ShellTool({ timeoutMs: 5000 });
      // Verify the tool is created successfully
      expect(customTool.name).toBe('shell_execute');
    });

    it('should accept null allowedCwd', () => {
      const toolNoRestriction = new ShellTool({ allowedCwd: null });
      expect(toolNoRestriction.name).toBe('shell_execute');
    });
  });
});
