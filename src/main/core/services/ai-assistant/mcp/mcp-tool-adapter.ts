import { ITool } from '../tools/tool.interface';
import { McpClient, McpToolDefinition } from './mcp-client';
import { createLogger } from '@/core/utils/logger';

const logger = createLogger('McpToolAdapter');

/**
 * MCP 工具适配器 — 将 MCP 服务器暴露的工具适配为 ITool 接口
 *
 * 命名规范: mcp__{serverName}__{toolName} 防止与内置工具冲突
 */
export class McpToolAdapter implements ITool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, any>;

  private client: McpClient;
  private mcpToolName: string;

  /**
   * @param client - MCP 客户端实例
   * @param serverName - MCP 服务器名称
   * @param toolDef - MCP 工具定义
   */
  constructor(client: McpClient, serverName: string, toolDef: McpToolDefinition) {
    this.client = client;
    this.mcpToolName = toolDef.name;

    // 使用前缀防止命名冲突
    this.name = `mcp__${serverName}__${toolDef.name}`;
    this.description = toolDef.description;
    this.parameters = this.convertInputSchema(toolDef.inputSchema);
  }

  /**
   * 执行 MCP 工具
   * @param args - 工具参数
   * @returns 工具返回的文本内容
   */
  async execute(args: Record<string, any>): Promise<string> {
    try {
      return await this.client.callTool(this.mcpToolName, args);
    } catch (err) {
      const errMsg = (err as Error).message;
      logger.error(`MCP tool '${this.name}' execution failed: ${errMsg}`);
      return `Error: MCP tool failed: ${errMsg}`;
    }
  }

  /**
   * 将 MCP inputSchema 转换为 OpenAI function calling 格式
   * MCP 使用 JSON Schema，OpenAI 的 parameters 也是 JSON Schema，通常直接兼容
   */
  private convertInputSchema(schema: Record<string, any>): Record<string, any> {
    if (!schema || !schema.type) {
      return { type: 'object', properties: {} };
    }
    return schema;
  }
}
