/**
 * McpToolAdapter 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import { McpToolAdapter } from '@/core/services/tools/mcp-tool-adapter';
import { McpClient, McpToolDefinition } from '@/core/services/tools/mcp-client';

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe('McpToolAdapter', () => {
  /** 创建 mock McpClient */
  function createMockClient(): McpClient {
    return {
      callTool: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
    } as unknown as McpClient;
  }

  const SAMPLE_TOOL: McpToolDefinition = {
    name: 'read_file',
    description: 'Read contents of a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
      },
      required: ['path'],
    },
  };

  describe('命名规范', () => {
    it('使用 mcp__{serverName}__{toolName} 格式命名', () => {
      const client = createMockClient();
      const adapter = new McpToolAdapter(client, 'filesystem', SAMPLE_TOOL);

      expect(adapter.name).toBe('mcp__filesystem__read_file');
    });

    it('server 名称包含特殊字符时仍能正确拼接', () => {
      const client = createMockClient();
      const adapter = new McpToolAdapter(client, 'my-server_v2', SAMPLE_TOOL);

      expect(adapter.name).toBe('mcp__my-server_v2__read_file');
    });
  });

  describe('ITool 接口实现', () => {
    it('暴露正确的 description', () => {
      const client = createMockClient();
      const adapter = new McpToolAdapter(client, 'filesystem', SAMPLE_TOOL);

      expect(adapter.description).toBe('Read contents of a file');
    });

    it('暴露正确的 parameters (JSON Schema)', () => {
      const client = createMockClient();
      const adapter = new McpToolAdapter(client, 'filesystem', SAMPLE_TOOL);

      expect(adapter.parameters).toEqual(SAMPLE_TOOL.inputSchema);
    });

    it('inputSchema 为空时使用默认 schema', () => {
      const client = createMockClient();
      const emptySchemaTool: McpToolDefinition = {
        name: 'no_schema',
        description: 'No input schema tool',
        inputSchema: {} as any,
      };
      const adapter = new McpToolAdapter(client, 'test', emptySchemaTool);

      expect(adapter.parameters).toEqual({ type: 'object', properties: {} });
    });
  });

  describe('execute', () => {
    it('委托调用 client.callTool 并返回文本结果', async () => {
      const client = createMockClient();
      (client.callTool as any).mockResolvedValue('file contents here');
      const adapter = new McpToolAdapter(client, 'filesystem', SAMPLE_TOOL);

      const result = await adapter.execute({ path: '/tmp/test.txt' });

      expect(client.callTool).toHaveBeenCalledWith('read_file', { path: '/tmp/test.txt' });
      expect(result).toBe('file contents here');
    });

    it('MCP 工具执行失败时返回错误信息', async () => {
      const client = createMockClient();
      (client.callTool as any).mockRejectedValue(new Error('Connection refused'));
      const adapter = new McpToolAdapter(client, 'filesystem', SAMPLE_TOOL);

      const result = await adapter.execute({ path: '/tmp/test.txt' });

      expect(result).toContain('Error: MCP tool failed');
      expect(result).toContain('Connection refused');
    });
  });
});
