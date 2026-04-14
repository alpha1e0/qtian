/**
 * TypeScript types file for Qtian application
 *
 * This file contains configuration types and common types.
 * Database models are defined in src/main/core/models/
 */

// ============================================================================
// API Response Models
// ============================================================================

/**
 * Standard API response
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  err_code?: string;
  err_msg?: string;
}

/**
 * Common API response with ID
 */
export interface ApiIdResponse extends ApiResponse {
  id?: number;
}

// ============================================================================
// IPC Types
// ============================================================================

/**
 * IPC request/response types
 */
export interface IPCRequest {
  channel: string;
  data?: any;
}

export interface IPCResponse<T = any> {
  success: boolean;
  data?: T;
  err_code?: string;
  err_msg?: string;
}

// ============================================================================
// AI Assistant Models
// ============================================================================

/**
 * AI 助手场景定义
 */
export interface AiScenario {
  /** 场景唯一标识 */
  id: string;
  /** 场景显示名称 */
  name: string;
  /** 场景描述 */
  description?: string;
  /** 是否启用 Agent 模式 */
  is_agent: boolean;
  /** 引用的角色 ID，对应 role/{role_id}.md */
  role_id: string;
  /** 引用的 LLM 配置名，对应 llm/{llm_config}.json */
  llm_config: string;
  /** 引用的 Skill 名称列表 */
  skills: string[];
  /** 引用的工具名称列表 */
  tools: string[];
  /** 是否启用记忆 */
  enable_memory?: boolean;
  /** 最大上下文轮数 */
  max_context_rounds?: number;
}

/**
 * AI 助手 LLM 模型配置
 */
export interface AiLLMConfig {
  /** API 基础地址 */
  base_url: string;
  /** 模型标识 */
  model: string;
  /** API Key */
  key: string;
  /** 温度参数 */
  temperature: number;
  /** 最大输出 Token 数 */
  max_tokens: number;
  /** HTTP 代理地址 */
  proxy?: string;
  /** System Prompt 附加前缀 */
  system_prefix?: string;
}

/**
 * AI 助手对话消息
 */
export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** 助手消息中的工具调用列表 (Agent 模式用) */
  tool_calls?: AiToolCall[];
  /** 工具结果消息对应的调用 ID */
  tool_call_id?: string;
  /** 消息时间戳 */
  timestamp: number;
  /** 生成该消息的模型标识 */
  model?: string;
  /** 消息生成时间，格式 YYYY-M-D HH:mm:ss */
  time?: string;
}

/**
 * AI 助手工具调用定义 (OpenAI function calling 格式)
 */
export interface AiToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * AI 助手对话历史
 */
export interface AiChatHistory {
  /** 历史记录 ID */
  id: string;
  /** 关联的场景 ID */
  scenario_id: string;
  /** 对话标题 */
  title: string;
  /** 消息列表 */
  messages: AiChatMessage[];
  /** 创建时间 */
  created_at: number;
  /** 最后更新时间 */
  updated_at: number;
}

/**
 * AI 助手角色定义 (Markdown 文件解析后)
 */
export interface AiRole {
  /** 角色文件名 (不含 .md 后缀) */
  name: string;
  /** 完整的 Markdown 内容 */
  content: string;
}

/**
 * AI 助手 Skill 元数据 (从 SKILL.md 的 YAML front-matter 解析)
 */
export interface AiSkillMeta {
  /** Skill 名称 */
  name: string;
  /** Skill 描述 */
  description: string;
  /** 版本号 */
  version: string;
}

/**
 * AI 助手 Skill 完整数据
 */
export interface AiSkill extends AiSkillMeta {
  /** 目录名 */
  dir_name: string;
  /** SKILL.md 的 Instructions 部分内容 */
  instructions: string;
  /** 是否存在 scripts/ 目录 */
  has_scripts: boolean;
  /** 是否存在 templates/ 目录 */
  has_templates: boolean;
}

/**
 * AI 助手记忆条目
 */
export interface AiMemory {
  /** 记忆 ID */
  id: string;
  /** 关联的场景 ID (空表示全局记忆) */
  scenario_id?: string;
  /** 记忆内容 */
  content: string;
  /** 标签 */
  tags: string[];
  /** 创建时间 */
  created_at: number;
}

/**
 * AI 助手对话事件 (用于 IPC 推送)
 */
export type AiChatEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_start'; toolCallId: string; name: string; arguments: string }
  | { type: 'tool_result'; toolCallId: string; result: string; isError?: boolean }
  | { type: 'thinking'; content: string }
  | { type: 'context_compress'; originalTokens: number; compressedTokens: number }
  | { type: 'done'; messages: AiChatMessage[] }
  | { type: 'error'; message: string };

// ============================================================================
// MCP Integration Models
// ============================================================================

/**
 * MCP 服务器配置
 */
export interface McpServerConfig {
  /** 服务器唯一标识 */
  name: string;
  /** 启动命令 */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 是否启用 (默认 true) */
  enabled?: boolean;
}

/**
 * MCP 全局配置 (存储在 assistant/tool/mcp.setting.json)
 */
export interface McpSetting {
  servers: McpServerConfig[];
}
