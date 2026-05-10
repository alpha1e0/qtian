/**
 * 工具接口定义
 * 所有内置工具和 MCP 适配工具统一实现此接口
 */

/**
 * 工具执行结果
 */
export interface ToolResult {
  /** 是否执行成功 */
  success: boolean;
  /** 执行结果文本 */
  content: string;
}

/**
 * 工具接口 — 所有内置工具和 MCP 适配工具的统一抽象
 */
export interface ITool {
  /** 工具名称 (全局唯一，内置工具用前缀如 `shell__execute`) */
  name: string;
  /** 工具描述 (供 LLM 理解用途) */
  description: string;
  /** 参数 JSON Schema (OpenAI function calling 格式) */
  parameters: Record<string, any>;
  /**
   * 执行工具
   * @param args 工具参数 (已解析的 JSON 对象)
   * @returns 执行结果文本
   */
  execute(args: Record<string, any>): Promise<string>;
}
