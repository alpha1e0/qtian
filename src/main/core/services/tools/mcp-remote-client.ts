import { fetch } from 'undici';
import { createLogger } from '@/core/utils/logger';
import { McpRemoteServerConfig } from '@/core/common/config';
import { IMcpClient } from './mcp-client.interface';
import { McpToolDefinition } from './mcp-client';

const logger = createLogger('McpRemoteClient');

/** HTTP 请求超时 (ms) */
const REQUEST_TIMEOUT_MS = 30000;

/**
 * MCP Remote Client — 通过 Streamable HTTP transport 连接远程 MCP 服务器
 *
 * 协议流程:
 *  1. POST /mcp — initialize → 获取 session ID (Mcp-Session-Id 响应头)
 *  2. POST /mcp — tools/list → 获取工具列表
 *  3. POST /mcp — tools/call → 调用工具
 *  4. DELETE /mcp — 断开 session
 *
 * 响应可能是 JSON 或 SSE (text/event-stream)，这里处理两种格式。
 */
export class McpRemoteClient implements IMcpClient {
  private serverName = '';
  private serverUrl = '';
  private sessionId: string | null = null;
  private customHeaders: Record<string, string> = {};
  private tools: McpToolDefinition[] = [];
  private connected = false;
  private requestId = 0;

  /**
   * 连接远程 MCP 服务器
   * @param config - 远程服务器配置
   */
  async connect(config: McpRemoteServerConfig): Promise<void> {
    this.serverName = config.name;
    this.serverUrl = config.url;
    this.customHeaders = config.headers || {};

    try {
      // 1. initialize
      const initResult = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'qtian', version: '1.0.0' },
      });

      logger.info(
        `Remote MCP '${config.name}' initialized: ${JSON.stringify(initResult?.capabilities || {})}`
      );

      // 2. initialized 通知
      await this.sendNotification('notifications/initialized', {});

      this.connected = true;

      // 3. 请求工具列表
      const toolsResult = await this.sendRequest('tools/list', {});
      if (toolsResult?.tools) {
        this.tools = toolsResult.tools.map((t: any) => ({
          name: t.name,
          description: t.description || '',
          inputSchema: t.inputSchema || { type: 'object', properties: {} },
        }));
        logger.info(`Remote MCP '${config.name}' provides ${this.tools.length} tools`);
      }
    } catch (err) {
      this.connected = false;
      logger.error(`Failed to connect remote MCP '${config.name}'`, err);
      throw err;
    }
  }

  /**
   * 断开远程 MCP 服务器连接
   */
  async disconnect(): Promise<void> {
    if (!this.sessionId) {
      this.connected = false;
      this.tools = [];
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      await fetch(this.serverUrl, {
        method: 'DELETE',
        headers: {
          ...this.customHeaders,
          ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);
    } catch {
      // disconnect 时忽略网络错误
    }

    this.sessionId = null;
    this.connected = false;
    this.tools = [];
    logger.info(`Remote MCP '${this.serverName}' disconnected`);
  }

  /**
   * 调用远程 MCP 工具
   * @param name - 工具名称
   * @param args - 工具参数
   * @returns 工具返回的文本内容
   */
  async callTool(name: string, args: Record<string, any>): Promise<string> {
    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    });

    if (result?.content) {
      return result.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
    }

    return JSON.stringify(result);
  }

  /** 获取工具列表 */
  getTools(): McpToolDefinition[] {
    return this.tools;
  }

  /** 是否已连接 */
  isConnected(): boolean {
    return this.connected;
  }

  /** 获取服务器名称 */
  getServerName(): string {
    return this.serverName;
  }

  /**
   * 发送 JSON-RPC 请求并等待响应
   * @param method - RPC 方法名
   * @param params - 参数
   * @returns 响应 result 字段
   */
  private async sendRequest(method: string, params: any): Promise<any> {
    const id = ++this.requestId;
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(this.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...this.customHeaders,
          ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
        },
        body,
        signal: controller.signal,
      });

      // 从响应头获取 session ID
      const responseSessionId = response.headers.get('mcp-session-id');
      if (responseSessionId) {
        this.sessionId = responseSessionId;
      }

      if (!response.ok) {
        throw new Error(
          `Remote MCP request '${method}' failed: HTTP ${response.status} ${response.statusText}`
        );
      }

      const result = await this.parseResponse(response);
      return result;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`Remote MCP request '${method}' timed out`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 发送 JSON-RPC 通知 (不期望响应)
   * @param method - RPC 方法名
   * @param params - 参数
   */
  private async sendNotification(method: string, params: any): Promise<void> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      await fetch(this.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.customHeaders,
          ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 解析 HTTP 响应 (JSON 或 SSE)
   * @param response - fetch Response
   * @returns JSON-RPC result 字段
   */
  private async parseResponse(response: any): Promise<any> {
    const contentType = response.headers.get('content-type') || '';

    // SSE 响应
    if (contentType.includes('text/event-stream')) {
      return await this.parseSSEResponse(response);
    }

    // 普通 JSON 响应
    const json = await response.json();

    if (json.error) {
      throw new Error(json.error.message || 'Remote MCP request failed');
    }

    return json.result;
  }

  /**
   * 解析 SSE 响应，提取第一个包含 JSON-RPC 响应的事件
   * @param response - fetch Response (text/event-stream)
   * @returns JSON-RPC result 字段
   */
  private async parseSSEResponse(response: any): Promise<any> {
    const text = await response.text();
    const lines = text.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;

      const data = line.slice(6).trim();
      if (!data) continue;

      try {
        const json = JSON.parse(data);
        if (json.error) {
          throw new Error(json.error.message || 'Remote MCP request failed');
        }
        if (json.result !== undefined) {
          return json.result;
        }
      } catch (err) {
        // 如果是我们抛出的 MCP 错误，继续抛出
        if (err instanceof Error && err.message.includes('Remote MCP')) {
          throw err;
        }
        // 否则忽略无法解析的行
      }
    }

    throw new Error('Remote MCP SSE response did not contain a valid result');
  }
}
