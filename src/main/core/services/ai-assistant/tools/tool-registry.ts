import { createLogger } from '@/core/utils/logger';
import { ITool } from './tool.interface';

const logger = createLogger('ToolRegistry');

/**
 * OpenAI function calling 格式的工具定义
 */
interface FunctionDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

/**
 * 工具注册表 — 管理所有可用工具的注册、查询、分发
 */
export class ToolRegistry {
  private tools: Map<string, ITool> = new Map();

  /**
   * 注册一个工具
   * @param tool - 工具实例
   * @throws 如果同名工具已存在
   */
  register(tool: ITool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool '${tool.name}' already registered`);
    }
    this.tools.set(tool.name, tool);
    logger.info(`Tool registered: ${tool.name}`);
  }

  /**
   * 批量注册工具
   * @param tools - 工具实例列表
   */
  registerAll(tools: ITool[]): void {
    for (const tool of tools) {
      if (!this.tools.has(tool.name)) {
        this.tools.set(tool.name, tool);
        logger.info(`Tool registered: ${tool.name}`);
      }
    }
  }

  /**
   * 按名称获取工具
   * @param name - 工具名称
   * @returns 工具实例，未找到则返回 undefined
   */
  get(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  /**
   * 按名称列表批量获取工具
   * @param names - 工具名称列表
   * @returns 找到的工具列表
   */
  getByNames(names: string[]): ITool[] {
    return names
      .map((name) => this.tools.get(name))
      .filter((tool): tool is ITool => tool !== undefined);
  }

  /**
   * 注销工具
   * @param name - 工具名称
   * @returns 是否成功注销
   */
  unregister(name: string): boolean {
    const deleted = this.tools.delete(name);
    if (deleted) {
      logger.info(`Tool unregistered: ${name}`);
    }
    return deleted;
  }

  /**
   * 列出所有已注册工具名称
   * @returns 工具名称列表 (排序后)
   */
  listNames(): string[] {
    return Array.from(this.tools.keys()).sort();
  }

  /**
   * 获取所有已注册工具的 OpenAI function calling 格式定义
   * @returns 工具定义列表，可直接用于 OpenAI SDK 的 tools 参数
   */
  getFunctionDefinitions(): FunctionDefinition[] {
    const definitions: FunctionDefinition[] = [];
    for (const tool of this.tools.values()) {
      definitions.push({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      });
    }
    return definitions;
  }

  /**
   * 判断是否有任何已注册工具
   */
  hasTools(): boolean {
    return this.tools.size > 0;
  }

  /**
   * 获取已注册工具数量
   */
  get size(): number {
    return this.tools.size;
  }
}
