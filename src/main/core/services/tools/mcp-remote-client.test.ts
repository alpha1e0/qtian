/**
 * McpRemoteClient 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock undici.fetch — 使用间接引用避免 hoisting 问题
const mockFetchRef = { current: vi.fn() };
vi.mock('undici', () => ({
  fetch: (...args: any[]) => mockFetchRef.current(...args),
}));

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

import { McpRemoteClient } from '@/core/services/tools/mcp-remote-client';

/** 构建 JSON-RPC 成功响应 */
function jsonResponse(result: any, sessionId?: string) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: async () => ({ jsonrpc: '2.0', id: 1, result }),
  };
}

/** 构建 SSE 响应 */
function sseResponse(data: any, sessionId?: string) {
  const headers: Record<string, string> = {
    'content-type': 'text/event-stream',
  };
  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }
  const sseBody = `data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: data })}\n\n`;
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    text: async () => sseBody,
  };
}

/** 构建 HTTP 错误响应 */
function errorResponse(status: number, statusText: string) {
  return {
    ok: false,
    status,
    statusText,
    headers: {
      get: () => null,
    },
  };
}

const REMOTE_CONFIG = {
  type: 'remote' as const,
  name: 'remote-api',
  url: 'https://example.com/mcp',
  enabled: true,
};

const REMOTE_CONFIG_WITH_HEADERS = {
  type: 'remote' as const,
  name: 'remote-auth',
  url: 'https://example.com/mcp',
  headers: { Authorization: 'Bearer token123' },
  enabled: true,
};

describe('McpRemoteClient', () => {
  let client: McpRemoteClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    mockFetchRef.current = mockFetch;
    client = new McpRemoteClient();
  });

  describe('connect', () => {
    it('成功连接并获取工具列表', async () => {
      // initialize → tools/list
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse(
            { capabilities: { tools: {} } },
            'session-abc-123'
          )
        )
        .mockResolvedValueOnce({
          // initialized notification — 无响应体关心
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: () => null },
        })
        .mockResolvedValueOnce(
          jsonResponse({
            tools: [
              {
                name: 'search',
                description: 'Search the web',
                inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
              },
            ],
          })
        );

      await client.connect(REMOTE_CONFIG);

      expect(client.isConnected()).toBe(true);
      expect(client.getServerName()).toBe('remote-api');
      expect(client.getTools()).toHaveLength(1);
      expect(client.getTools()[0].name).toBe('search');
    });

    it('连接失败时设置 connected 为 false 并抛出错误', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(500, 'Internal Server Error'));

      await expect(client.connect(REMOTE_CONFIG)).rejects.toThrow('HTTP 500');
      expect(client.isConnected()).toBe(false);
    });

    it('从响应头获取并存储 session ID', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ capabilities: {} }, 'my-session-id'))
        .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null } })
        .mockResolvedValueOnce(jsonResponse({ tools: [] }));

      await client.connect(REMOTE_CONFIG);

      // 检查后续请求携带 session ID (通过 callTool 间接触发)
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ content: [{ type: 'text', text: 'ok' }] })
      );

      await client.callTool('test_tool', {});

      // 最后一次 fetch 调用应包含 Mcp-Session-Id 头
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const headers = lastCall[1].headers;
      expect(headers['Mcp-Session-Id']).toBe('my-session-id');
    });

    it('注入自定义 headers', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ capabilities: {} }))
        .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null } })
        .mockResolvedValueOnce(jsonResponse({ tools: [] }));

      await client.connect(REMOTE_CONFIG_WITH_HEADERS);

      // 验证 initialize 请求包含 Authorization header
      const initCall = mockFetch.mock.calls[0];
      expect(initCall[1].headers['Authorization']).toBe('Bearer token123');
    });
  });

  describe('callTool', () => {
    beforeEach(async () => {
      // 预连接
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ capabilities: {} }, 'session-1'))
        .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null } })
        .mockResolvedValueOnce(jsonResponse({ tools: [] }));

      await client.connect(REMOTE_CONFIG);
      mockFetch.mockClear();
    });

    it('返回文本内容', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'text', text: 'World' },
          ],
        })
      );

      const result = await client.callTool('greet', { name: 'test' });
      expect(result).toBe('Hello\nWorld');
    });

    it('发送正确的 JSON-RPC body', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ content: [{ type: 'text', text: 'ok' }] })
      );

      await client.callTool('search', { query: 'test' });

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.method).toBe('tools/call');
      expect(body.params).toEqual({ name: 'search', arguments: { query: 'test' } });
      expect(body.jsonrpc).toBe('2.0');
    });

    it('响应无 content 时返回 JSON 字符串', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'done' }));

      const result = await client.callTool('ping', {});
      expect(result).toBe(JSON.stringify({ status: 'done' }));
    });

    it('处理 SSE 响应', async () => {
      mockFetch.mockResolvedValueOnce(
        sseResponse({
          content: [{ type: 'text', text: 'sse result' }],
        })
      );

      const result = await client.callTool('stream_tool', {});
      expect(result).toBe('sse result');
    });
  });

  describe('disconnect', () => {
    it('发送 DELETE 请求终止 session', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ capabilities: {} }, 'session-to-delete'))
        .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null } })
        .mockResolvedValueOnce(jsonResponse({ tools: [] }));

      await client.connect(REMOTE_CONFIG);
      mockFetch.mockClear();

      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null } });

      await client.disconnect();

      const deleteCall = mockFetch.mock.calls[0];
      expect(deleteCall[1].method).toBe('DELETE');
      expect(deleteCall[1].headers['Mcp-Session-Id']).toBe('session-to-delete');
      expect(client.isConnected()).toBe(false);
    });

    it('无 session 时不发送请求', async () => {
      await client.disconnect();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(client.isConnected()).toBe(false);
    });

    it('DELETE 请求失败时不抛出错误', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ capabilities: {} }, 'session-x'))
        .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null } })
        .mockResolvedValueOnce(jsonResponse({ tools: [] }));

      await client.connect(REMOTE_CONFIG);
      mockFetch.mockClear();

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.disconnect()).resolves.not.toThrow();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('timeout', () => {
    it('请求超时时抛出错误', async () => {
      // 模拟 AbortError — fetch 因 AbortController 超时
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(client.connect(REMOTE_CONFIG)).rejects.toThrow('timed out');
    });
  });

  describe('JSON-RPC error', () => {
    it('服务端返回 JSON-RPC error 时抛出错误', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'application/json' },
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32600, message: 'Invalid Request' },
        }),
      });

      await expect(client.connect(REMOTE_CONFIG)).rejects.toThrow('Invalid Request');
    });
  });
});
