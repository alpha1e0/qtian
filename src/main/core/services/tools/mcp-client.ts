import { spawn, ChildProcess } from 'child_process';
import { createLogger } from '@/core/utils/logger';
import { McpLocalServerConfig } from '@/core/common/config';
import { IMcpClient } from './mcp-client.interface';

const logger = createLogger('McpClient');

/**
 * MCP 工具定义 (从 MCP 服务器返回)
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

/**
 * MCP Client — 与单个 MCP 服务器通信 (stdio transport)
 *
 * 通过 child_process 启动 MCP 服务器进程，经 stdin/stdout 交换 JSON-RPC 2.0 消息。
 * 不使用外部 SDK，自行实现轻量 JSON-RPC 2.0 通信。
 */
export class McpClient implements IMcpClient {
  private process: ChildProcess | null = null;
  private serverName: string = '';
  private tools: McpToolDefinition[] = [];
  private connected = false;
  private requestId = 0;
  private pendingRequests: Map<
    number,
    { resolve: (value: any) => void; reject: (reason: any) => void }
  > = new Map();
  private responseBuffer = '';

  /**
   * 连接 MCP 服务器 (stdio transport)
   * @param config - 本地服务器配置
   */
  async connect(config: McpLocalServerConfig): Promise<void> {
    this.serverName = config.name;

    try {
      this.process = spawn(config.command, config.args || [], {
        env: { ...process.env, ...config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.setupStdio();

      // 等待进程启动并发送 initialize
      await this.sleep(200);

      // 发送 initialize 请求
      const result = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'qtian', version: '1.0.0' },
      });

      logger.info(`MCP server '${config.name}' initialized: ${JSON.stringify(result?.capabilities || {})}`);

      // 发送 initialized 通知
      this.sendNotification('notifications/initialized', {});

      this.connected = true;

      // 请求工具列表
      const toolsResult = await this.sendRequest('tools/list', {});
      if (toolsResult?.tools) {
        this.tools = toolsResult.tools.map((t: any) => ({
          name: t.name,
          description: t.description || '',
          inputSchema: t.inputSchema || { type: 'object', properties: {} },
        }));
        logger.info(`MCP server '${config.name}' provides ${this.tools.length} tools`);
      }
    } catch (err) {
      this.connected = false;
      logger.error(`Failed to connect MCP server '${config.name}'`, err);
      throw err;
    }
  }

  /**
   * 断开 MCP 服务器连接
   */
  async disconnect(): Promise<void> {
    if (!this.process) {
      return;
    }

    this.connected = false;

    try {
      this.sendNotification('notifications/cancelled', { reason: 'client_disconnect' });
    } catch {
      // ignore
    }

    // 终止进程
    this.process.kill();
    this.process = null;
    this.tools = [];
    logger.info(`MCP server '${this.serverName}' disconnected`);
  }

  /**
   * 调用 MCP 工具
   * @param name - 工具名称
   * @param args - 工具参数
   * @returns 工具返回的文本内容
   */
  async callTool(name: string, args: Record<string, any>): Promise<string> {
    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    });

    // 提取文本内容
    if (result?.content) {
      return result.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
    }

    return JSON.stringify(result);
  }

  /**
   * 获取 MCP 服务器暴露的工具列表
   */
  getTools(): McpToolDefinition[] {
    return this.tools;
  }

  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 获取服务器名称
   */
  getServerName(): string {
    return this.serverName;
  }

  /**
   * 设置进程 stdout/stderr 处理
   */
  private setupStdio(): void {
    if (!this.process?.stdout || !this.process?.stderr) return;

    this.process.stdout.setEncoding('utf-8');
    this.process.stderr.setEncoding('utf-8');

    this.process.stdout.on('data', (data: string) => {
      this.handleData(data);
    });

    this.process.stderr.on('data', (data: string) => {
      logger.warn(`[MCP stderr ${this.serverName}] ${data.trim()}`);
    });

    this.process.on('close', (code) => {
      logger.info(`MCP server '${this.serverName}' exited with code ${code}`);
      this.connected = false;
      // 拒绝所有 pending requests
      for (const [id, { reject }] of this.pendingRequests) {
        reject(new Error(`MCP server '${this.serverName}' closed (code: ${code})`));
      }
      this.pendingRequests.clear();
    });

    this.process.on('error', (err) => {
      logger.error(`MCP server '${this.serverName}' error`, err);
      this.connected = false;
    });
  }

  /**
   * 处理 stdin 数据，解析 JSON-RPC 消息
   */
  private handleData(data: string): void {
    this.responseBuffer += data;

    // 按行分割处理 (JSON-RPC over stdio 每行一条消息)
    const lines = this.responseBuffer.split('\n');
    // 最后一个元素可能不完整，保留到 buffer
    this.responseBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed);
        this.handleMessage(message);
      } catch {
        logger.debug(`[MCP ${this.serverName}] Non-JSON output: ${trimmed}`);
      }
    }
  }

  /**
   * 处理 JSON-RPC 消息
   */
  private handleMessage(message: any): void {
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(message.error.message || 'MCP request failed'));
      } else {
        resolve(message.result);
      }
    }
  }

  /**
   * 发送 JSON-RPC 请求 (等待响应)
   */
  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin) {
        reject(new Error('Process not connected'));
        return;
      }

      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });

      const message = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.process.stdin.write(JSON.stringify(message) + '\n');

      // 超时保护 (30s)
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request '${method}' timed out`));
        }
      }, 30000);
    });
  }

  /**
   * 发送 JSON-RPC 通知 (不等待响应)
   */
  private sendNotification(method: string, params: any): void {
    if (!this.process || !this.process.stdin) return;

    const message = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.process.stdin.write(JSON.stringify(message) + '\n');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
