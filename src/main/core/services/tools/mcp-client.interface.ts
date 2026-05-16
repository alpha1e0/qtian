import { McpToolDefinition } from './mcp-client';
import { McpServerConfig } from '@/core/common/config';

/**
 * MCP 客户端统一接口
 *
 * Local (stdio) 和 Remote (HTTP) 客户端共同实现此接口，
 * 使 McpManager 和 McpToolAdapter 不依赖具体传输方式。
 */
export interface IMcpClient {
  /**
   * 连接 MCP 服务器
   * @param config - 服务器配置 (McpLocalServerConfig 或 McpRemoteServerConfig)
   */
  connect(config: McpServerConfig): Promise<void>;

  /** 断开 MCP 服务器连接 */
  disconnect(): Promise<void>;

  /**
   * 调用 MCP 工具
   * @param name - 工具名称
   * @param args - 工具参数
   * @returns 工具返回的文本内容
   */
  callTool(name: string, args: Record<string, any>): Promise<string>;

  /** 获取 MCP 服务器暴露的工具列表 */
  getTools(): McpToolDefinition[];

  /** 是否已连接 */
  isConnected(): boolean;

  /** 获取服务器名称 */
  getServerName(): string;
}
