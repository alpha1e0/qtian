import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '@/core/utils/logger';
import { wpath } from '@/core/common/context';
import { McpSetting, McpServerConfig } from '@/core/common/config';

const logger = createLogger('McpConfigService');

/** MCP 配置文件名 */
const MCP_CONFIG_FILE = 'mcp.setting.json';

/**
 * MCP 配置管理服务
 *
 * 管理 MCP 服务器配置的读写，配置文件位于 assistant/tool/mcp.setting.json
 */
export class McpConfigService {
  private configPath: string;

  constructor() {
    this.configPath = path.join(wpath.assistantToolDir, MCP_CONFIG_FILE);
  }

  /**
   * 读取 MCP 配置
   * @returns MCP 配置，文件不存在时返回默认空配置
   */
  async getConfig(): Promise<McpSetting> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      const setting: McpSetting = JSON.parse(content);
      // 兼容性：确保 servers 字段存在
      if (!Array.isArray(setting.servers)) {
        setting.servers = [];
      }
      return setting;
    } catch {
      logger.info('MCP config not found, returning default');
      return { servers: [] };
    }
  }

  /**
   * 保存 MCP 配置 (全量覆盖)
   * @param setting - 完整的 MCP 配置
   */
  async saveConfig(setting: McpSetting): Promise<void> {
    await fs.mkdir(wpath.assistantToolDir, { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(setting, null, 2), 'utf-8');
    logger.info(`MCP config saved (${setting.servers.length} servers)`);
  }

  /**
   * 获取所有服务器配置
   */
  async listServers(): Promise<McpServerConfig[]> {
    const config = await this.getConfig();
    return config.servers;
  }

  /**
   * 获取指定服务器配置
   * @param name - 服务器名称
   */
  async getServer(name: string): Promise<McpServerConfig | undefined> {
    const config = await this.getConfig();
    return config.servers.find((s) => s.name === name);
  }

  /**
   * 添加或更新服务器配置
   * @param server - 服务器配置
   */
  async saveServer(server: McpServerConfig): Promise<void> {
    const config = await this.getConfig();
    const idx = config.servers.findIndex((s) => s.name === server.name);
    if (idx >= 0) {
      config.servers[idx] = server;
      logger.info(`MCP server updated: ${server.name}`);
    } else {
      config.servers.push(server);
      logger.info(`MCP server added: ${server.name}`);
    }
    await this.saveConfig(config);
  }

  /**
   * 删除服务器配置
   * @param name - 服务器名称
   * @returns 是否成功删除
   */
  async deleteServer(name: string): Promise<boolean> {
    const config = await this.getConfig();
    const idx = config.servers.findIndex((s) => s.name === name);
    if (idx < 0) {
      return false;
    }
    config.servers.splice(idx, 1);
    await this.saveConfig(config);
    logger.info(`MCP server deleted: ${name}`);
    return true;
  }

  /**
   * 获取配置文件路径
   */
  getConfigPath(): string {
    return this.configPath;
  }
}
