import { createLogger } from '@/core/utils/logger';
import { ITool } from './tool.interface';
import { McpConfigService } from './mcp-config.service';
import { McpClient } from './mcp-client';
import { McpToolAdapter } from './mcp-tool-adapter';

const logger = createLogger('McpManager');

/**
 * MCP Manager — 管理所有 MCP 服务器的生命周期
 *
 * 职责：
 * - 读取 mcp.setting.json 配置
 * - 连接所有已启用的 MCP 服务器
 * - 将 MCP 工具适配为 ITool 接口供 ToolRegistry 使用
 * - 应用退出时断开所有连接
 */
export class McpManager {
  private configService: McpConfigService;
  private clients: Map<string, McpClient> = new Map();

  constructor() {
    this.configService = new McpConfigService();
  }

  /**
   * 从配置文件加载并连接所有已启用的 MCP 服务器
   */
  async loadFromConfig(): Promise<void> {
    // 先断开已有连接
    await this.disconnectAll();

    const config = await this.configService.getConfig();
    const enabledServers = config.servers.filter((s) => s.enabled !== false);

    if (enabledServers.length === 0) {
      logger.info('No enabled MCP servers found');
      return;
    }

    for (const serverConfig of enabledServers) {
      try {
        const client = new McpClient();
        await client.connect(serverConfig);
        this.clients.set(serverConfig.name, client);
        logger.info(`MCP server '${serverConfig.name}' connected`);
      } catch (err) {
        logger.error(`Failed to connect MCP server '${serverConfig.name}':`, err);
      }
    }

    logger.info(`MCP loaded: ${this.clients.size}/${enabledServers.length} servers connected`);
  }

  /**
   * 获取所有 MCP 服务器的工具 (适配为 ITool)
   * @returns ITool 数组
   */
  getAllTools(): ITool[] {
    const tools: ITool[] = [];

    for (const [serverName, client] of this.clients) {
      if (!client.isConnected()) continue;

      const mcpTools = client.getTools();
      for (const toolDef of mcpTools) {
        tools.push(new McpToolAdapter(client, serverName, toolDef));
      }
    }

    logger.debug(`MCP provides ${tools.length} tools total`);
    return tools;
  }

  /**
   * 断开所有 MCP 服务器连接
   */
  async disconnectAll(): Promise<void> {
    const disconnectPromises: Promise<void>[] = [];

    for (const [name, client] of this.clients) {
      disconnectPromises.push(client.disconnect());
    }

    await Promise.allSettled(disconnectPromises);
    this.clients.clear();
    logger.info('All MCP servers disconnected');
  }

  /**
   * 重新加载配置并重新连接
   */
  async reload(): Promise<void> {
    logger.info('MCP reloading...');
    await this.loadFromConfig();
  }

  /**
   * 获取所有 MCP 服务器状态
   */
  getStatuses(): Record<string, { connected: boolean; toolCount: number }> {
    const statuses: Record<string, { connected: boolean; toolCount: number }> = {};

    for (const [name, client] of this.clients) {
      statuses[name] = {
        connected: client.isConnected(),
        toolCount: client.getTools().length,
      };
    }

    return statuses;
  }

  /**
   * 获取配置服务实例 (供外部 CRUD 配置)
   */
  getConfigService(): McpConfigService {
    return this.configService;
  }

  /**
   * 判断是否有任何已连接的 MCP 服务器
   */
  hasConnections(): boolean {
    for (const client of this.clients.values()) {
      if (client.isConnected()) return true;
    }
    return false;
  }
}
