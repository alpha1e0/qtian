# 002 AI 助手 — 完善设计文档

> 基于需求文档 `002_ai-assistant.md` 的补充设计，包含模块划分、接口定义、数据结构、ReAct 引擎、MCP 集成等详细方案。

## 1 需求分析 & 关键决策

| 决策项 | 结论 | 理由 |
| :--- | :--- | :--- |
| MCP 集成 | 第一版包含 | 通过 `mcp.setting.json` + stdio transport 实现外部工具扩展 |
| Agent 模式 | 完整 ReAct 引擎 | 支持 function calling + 多轮工具调用 + 上下文压缩 |
| Skill 注入 | System Prompt 预加载 | 场景声明依赖 Skill，对话创建时一次性注入 System Prompt |
| 模型适配 | OpenAI SDK (兼容协议) | OpenAI API 已是事实标准 |

## 2 目录结构设计

### 2.1 工作目录 (`{workspace}/assistant/`)

```
assistant/                        # 助手根目录
├── scenario/                     # 场景文件目录
│   ├── default.json              # 默认场景
│   ├── translator.json           # 示例：翻译场景
│   └── coder.json                # 示例：编程助手场景
├── role/                         # 角色定义目录
│   ├── default.md                # 默认角色
│   └── translator.md             # 翻译专家角色
├── llm/                          # LLM 模型配置目录
│   ├── default.json              # 默认模型配置
│   └── gpt-4o.json               # 其他模型配置
├── skill/                        # Skill 技能目录
│   ├── markdown-formatter/       # 示例 Skill
│   │   ├── SKILL.md
│   │   └── scripts/
│   └── code-review/
│       └── SKILL.md
├── tool/                         # 工具配置目录
│   └── mcp.setting.json          # MCP 服务定义
├── history/                      # 对话历史目录
│   └── {scenarioId}/             # 按场景分组
│       ├── {historyId}.json      # 单次对话历史
│       └── ...
└── memory/                       # 记忆存储目录
    └── {scenarioId}/             # 按场景分组
        └── {memoryId}.json       # 单条记忆
```

### 2.2 源码目录结构

```
src/main/core/
├── services/ai-assistant/
│   ├── index.ts                              # 模块导出
│   ├── ai-scenario.service.ts                # 场景 CRUD
│   ├── ai-role.service.ts                    # 角色 CRUD
│   ├── ai-config.service.ts                  # LLM 配置 CRUD
│   ├── ai-skill.service.ts                   # Skill 加载与解析
│   ├── ai-history.service.ts                 # 对话历史 CRUD
│   ├── ai-chat.service.ts                    # 核心对话服务 (Simple + Agent)
│   ├── ai-context.service.ts                 # 上下文管理 (Token 计数、压缩)
│   ├── ai-memory.service.ts                  # 记忆管理
│   ├── tools/                                # 工具实现目录
│   │   ├── index.ts                          # 工具注册表
│   │   ├── tool.interface.ts                 # ITool 接口定义
│   │   ├── tool-registry.ts                  # 工具注册与分发
│   │   ├── shell-tool.ts                     # Shell 执行工具
│   │   ├── tavily-search-tool.ts             # Tavily 搜索工具
│   │   ├── local-rag-tool.ts                 # 本地 RAG 工具
│   │   └── mcp/                              # MCP 集成
│   │       ├── index.ts
│   │       ├── mcp-client.ts                 # MCP 客户端 (stdio transport)
│   │       ├── mcp-tool-adapter.ts           # MCP 工具适配器 (ITool 适配)
│   │       └── mcp-manager.ts                # MCP 服务生命周期管理
│   ├── ai-scenario.service.test.ts
│   ├── ai-role.service.test.ts
│   ├── ai-config.service.test.ts
│   ├── ai-skill.service.test.ts
│   ├── ai-history.service.test.ts
│   ├── ai-chat.service.test.ts
│   ├── ai-context.service.test.ts
│   ├── ai-memory.service.test.ts
│   └── tools/
│       ├── tool-registry.test.ts
│       ├── shell-tool.test.ts
│       ├── tavily-search-tool.test.ts
│       └── mcp/
│           ├── mcp-client.test.ts
│           └── mcp-manager.test.ts
│
├── ipc/
│   ├── channels.ts                           # 新增 AI 助手 channels
│   └── handlers/
│       ├── ai-assistant.handler.ts           # AI 助手 IPC handlers
│       └── index.ts
│
└── common/
    └── config.ts                             # 新增 AI 助手相关类型定义

src/renderer/src/components/ai-assistant/
├── AiAssistantPage.vue                       # 主页面 (左右布局)
├── ChatSidebar.vue                           # 左侧栏 (场景选择 + 历史列表)
├── ChatContent.vue                           # 右侧对话区域
├── ChatMessage.vue                           # 单条消息气泡 (支持 Markdown)
├── ChatInput.vue                             # 输入区域 (多行 + 发送)
├── ToolCallView.vue                          # 工具调用展示 (折叠面板)
├── ScenarioSelector.vue                      # 场景选择下拉框
└── composables/
    └── useAiChat.ts                          # 对话逻辑 composable
```

## 3 完整类型定义

### 3.1 场景 (`AiScenario`)

```typescript
/**
 * AI 助手场景定义
 */
interface AiScenario {
  /** 场景唯一标识 */
  id: string;
  /** 场景显示名称 */
  name: string;
  /** 场景描述 */
  description?: string;
  /** 是否启用 Agent 模式（启用后走 ReAct 循环） */
  is_agent: boolean;
  /** 引用的角色 ID，对应 role/{role_id}.md */
  role_id: string;
  /** 引用的 LLM 配置名，对应 llm/{llm_config}.json */
  llm_config: string;
  /** 引用的 Skill 名称列表，对应 skill/{name}/SKILL.md */
  skills: string[];
  /** 引用的工具名称列表，内置工具名 或 MCP 工具名 */
  tools: string[];
  /** 是否记忆跨对话 */
  enable_memory?: boolean;
  /** 最大上下文轮数 (超出后触发压缩) */
  max_context_rounds?: number;
}
```

### 3.2 角色 (`AiRole`)

```typescript
/**
 * AI 助手角色定义
 * markdown 文件，完整内容注入 System Prompt
 */
interface AiRole {
  /** 角色文件名 (不含 .md 后缀) */
  name: string;
  /** 完整的 Markdown 内容 */
  content: string;
}
```

### 3.3 LLM 配置 (`AiLLMConfig`)

```typescript
/**
 * AI 助手 LLM 模型配置
 */
interface AiLLMConfig {
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
  /** System Prompt 附加前缀（在角色 Prompt 之前注入） */
  system_prefix?: string;
}
```

### 3.4 Skill (`AiSkillMeta`)

```typescript
/**
 * Skill 元数据 (从 SKILL.md 的 YAML front-matter 解析)
 */
interface AiSkillMeta {
  /** Skill 名称 */
  name: string;
  /** Skill 描述 (供 LLM 理解用途) */
  description: string;
  /** 版本号 */
  version: string;
}

/**
 * Skill 完整数据 (加载后的结构)
 */
interface AiSkill extends AiSkillMeta {
  /** 目录名 */
  dir_name: string;
  /** SKILL.md 的 Instructions 部分内容 */
  instructions: string;
  /** 是否存在 scripts/ 目录 */
  has_scripts: boolean;
  /** 是否存在 templates/ 目录 */
  has_templates: boolean;
}
```

### 3.5 对话消息 (`AiChatMessage`)

```typescript
/**
 * 工具调用定义 (遵循 OpenAI function calling 格式)
 */
interface AiToolCall {
  /** 工具调用 ID */
  id: string;
  /** 工具名称 */
  function: {
    name: string;
    arguments: string;  // JSON 字符串
  };
}

/**
 * 对话消息
 */
interface AiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** 助手消息中的工具调用列表 */
  tool_calls?: AiToolCall[];
  /** 工具结果消息对应的调用 ID */
  tool_call_id?: string;
  /** 消息时间戳 */
  timestamp: number;
  /** 生成该消息的模型标识 (来自 llm_configs.model) */
  model?: string;
  /** 消息生成时间，格式 YYYY-M-D HH:mm:ss */
  time?: string;
}
```

### 3.6 对话历史 (`AiChatHistory`)

```typescript
/**
 * AI 助手对话历史
 */
interface AiChatHistory {
  /** 历史记录 ID (UUID) */
  id: string;
  /** 关联的场景 ID */
  scenario_id: string;
  /** 对话标题 (自动生成或用户指定) */
  title: string;
  /** 消息列表 */
  messages: AiChatMessage[];
  /** 创建时间 (Unix timestamp ms) */
  created_at: number;
  /** 最后更新时间 */
  updated_at: number;
}
```

### 3.7 记忆 (`AiMemory`)

```typescript
/**
 * AI 助手记忆条目
 */
interface AiMemory {
  /** 记忆 ID (UUID) */
  id: string;
  /** 关联的场景 ID (空表示全局记忆) */
  scenario_id?: string;
  /** 记忆内容 */
  content: string;
  /** 标签 (用于检索) */
  tags: string[];
  /** 创建时间 */
  created_at: number;
}
```

### 3.8 MCP 配置 (`McpServerConfig`)

```typescript
/**
 * MCP 服务器配置 (写入 mcp.setting.json)
 */
interface McpSetting {
  /** MCP 服务器列表 */
  servers: McpServerConfig[];
}

interface McpServerConfig {
  /** 服务器名称 (唯一标识) */
  name: string;
  /** 启动命令 */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 是否启用 */
  enabled?: boolean;
}
```

## 4 核心接口设计

### 4.1 工具接口 (`ITool`)

```typescript
/**
 * 工具接口 — 所有内置工具和 MCP 适配工具统一实现
 */
interface ITool {
  /** 工具名称 (全局唯一，内置工具用前缀如 `shell__execute`) */
  name: string;
  /** 工具描述 (供 LLM 理解) */
  description: string;
  /** 参数 JSON Schema */
  parameters: Record<string, any>;
  /**
   * 执行工具
   * @param args 工具参数 (已解析的 JSON 对象)
   * @returns 执行结果文本
   */
  execute(args: Record<string, any>): Promise<string>;
}
```

### 4.2 工具注册表 (`ToolRegistry`)

```typescript
/**
 * 工具注册表 — 管理所有可用工具的注册、查询、分发
 */
class ToolRegistry {
  private tools: Map<string, ITool>;

  /** 注册一个工具 */
  register(tool: ITool): void;

  /** 批量注册工具 */
  registerAll(tools: ITool[]): void;

  /** 按名称获取工具 */
  get(name: string): ITool | undefined;

  /** 获取所有已注册工具的 OpenAI function 定义 */
  getFunctionDefinitions(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, any>;
    };
  }>;

  /** 按名称列表获取工具 */
  getByNames(names: string[]): ITool[];

  /** 注销工具 */
  unregister(name: string): boolean;

  /** 列出所有已注册工具名称 */
  listNames(): string[];
}
```

### 4.3 模型适配器 (`ILLMAdapter`)

```typescript
/**
 * LLM 适配器接口 — 封装 OpenAI SDK 的流式调用
 */
interface ILLMAdapter {
  /**
   * 流式对话 (含 function calling 支持)
   * @param messages 对话消息列表
   * @param tools 可用工具定义列表 (用于 function calling)
   * @returns 流式响应迭代器
   */
  stream(
    messages: AiChatMessage[],
    tools?: Array<{ type: 'function'; function: any }>
  ): AsyncIterable<LLMStreamChunk>;
}

/**
 * 流式响应块
 */
interface LLMStreamChunk {
  /** 文本内容 (增量) */
  content?: string;
  /** 工具调用 (增量) */
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
  /** 是否结束 */
  finish_reason?: 'stop' | 'tool_calls' | 'length';
}
```

### 4.4 上下文管理器 (`AiContextService`)

```typescript
/**
 * 上下文管理器 — 负责 Token 计数、上下文压缩
 */
class AiContextService {
  /**
   * 估算消息列表的 Token 数量
   * 使用字符级近似计算 (中文 ~1.5 token/字, 英文 ~0.75 token/word)
   */
  estimateTokens(messages: AiChatMessage[]): number;

  /**
   * 检查是否需要压缩
   * @param messages 当前消息列表
   * @param maxTokens 最大允许 Token 数
   * @param reserveTokens 预留 Token 数 (给模型输出)
   */
  shouldCompress(messages: AiChatMessage[], maxTokens: number, reserveTokens: number): boolean;

  /**
   * 压缩上下文
   * 策略：保留 system messages + 最近 N 轮对话，中间部分通过 LLM 生成摘要
   * @param messages 当前消息列表
   * @param targetTokens 目标 Token 数
   * @param adapter LLM 适配器 (用于生成摘要)
   * @returns 压缩后的消息列表
   */
  compress(
    messages: AiChatMessage[],
    targetTokens: number,
    adapter: ILLMAdapter
  ): Promise<AiChatMessage[]>;
}
```

### 4.5 MCP 客户端 (`McpClient`)

```typescript
/**
 * MCP 客户端 — 与单个 MCP 服务器通信 (stdio transport)
 */
class McpClient {
  private process: ChildProcess | null;
  private tools: ITool[];

  /** 连接 MCP 服务器 */
  connect(config: McpServerConfig): Promise<void>;

  /** 断开连接 */
  disconnect(): Promise<void>;

  /** 获取该服务器暴露的所有工具 */
  getTools(): ITool[];

  /** 是否已连接 */
  isConnected(): boolean;
}

/**
 * MCP 管理器 — 管理所有 MCP 服务器的生命周期
 */
class McpManager {
  private clients: Map<string, McpClient>;

  /** 从配置文件加载并连接所有 MCP 服务器 */
  loadFromConfig(configPath: string): Promise<void>;

  /** 获取所有 MCP 服务器提供的工具 */
  getAllTools(): ITool[];

  /** 断开所有服务器 */
  disconnectAll(): Promise<void>;

  /** 获取服务器连接状态 */
  getStatuses(): Record<string, { connected: boolean; toolCount: number }>;
}
```

## 5 核心服务设计

### 5.1 场景服务 (`AiScenarioService`)

与 `RoleplayScenarioService` 模式一致，文件级 CRUD。

```typescript
class AiScenarioService {
  async listScenarios(): Promise<AiScenario[]>;
  async getScenario(id: string): Promise<AiScenario>;
  async createScenario(id: string, data: AiScenario): Promise<void>;
  async updateScenario(id: string, data: AiScenario): Promise<void>;
  async deleteScenario(id: string): Promise<void>;
  async scenarioExists(id: string): Promise<boolean>;
}
```

### 5.2 角色/配置/Skill/历史服务

均沿用相同 CRUD 模式。

```typescript
// 角色
class AiRoleService {
  async listRoles(): Promise<string[]>;
  async getRole(name: string): Promise<AiRole>;
  async saveRole(name: string, content: string): Promise<void>;
  async deleteRole(name: string): Promise<void>;
}

// LLM 配置
class AiConfigService {
  async listConfigs(): Promise<string[]>;
  async getConfig(name: string): Promise<AiLLMConfig>;
  async saveConfig(name: string, data: AiLLMConfig): Promise<void>;
  async deleteConfig(name: string): Promise<void>;
  async getDefaultConfig(): Promise<AiLLMConfig>;
}

// Skill
class AiSkillService {
  async listSkills(): Promise<AiSkillMeta[]>;
  async getSkill(dirName: string): Promise<AiSkill>;
  async skillExists(dirName: string): Promise<boolean>;
}

// 历史
class AiHistoryService {
  async listHistories(scenarioId: string): Promise<AiChatHistory[]>;
  async getHistory(scenarioId: string, historyId: string): Promise<AiChatHistory>;
  async createHistory(data: AiChatHistory): Promise<void>;
  async saveHistory(scenarioId: string, historyId: string, data: AiChatHistory): Promise<void>;
  async deleteHistory(scenarioId: string, historyId: string): Promise<void>;
}

// 记忆
class AiMemoryService {
  async listMemories(scenarioId?: string): Promise<AiMemory[]>;
  async addMemory(data: AiMemory): Promise<void>;
  async deleteMemory(id: string): Promise<void>;
  /** 构建记忆文本段，用于注入 System Prompt */
  buildMemoryPrompt(scenarioId?: string): Promise<string>;
}
```

### 5.3 核心对话服务 (`AiChatService`) — 重点设计

这是整个模块的核心，负责 Simple Runner 和 ReAct Agent 两种模式。

```typescript
/**
 * AI 助手核心对话服务
 */
class AiChatService {
  private llmAdapter: ILLMAdapter;
  private toolRegistry: ToolRegistry;
  private contextService: AiContextService;
  private messages: AiChatMessage[];
  private scenario: AiScenario;
  private isAgent: boolean;
  private abortController: AbortController | null;
  /** ReAct 最大循环次数，防止死循环 */
  private maxToolRounds: number;

  constructor(
    llmConfig: AiLLMConfig,
    scenario: AiScenario,
    roleContent: string,
    skillInstructions: string[],
    memoryPrompt: string,
    tools: ITool[]
  );

  /**
   * 初始化对话上下文
   * 组装顺序：llm.system_prefix → memory → role → skills → tools description
   */
  private buildSystemPrompt(): string;

  /**
   * 发送消息 (对外统一入口)
   * 根据 scenario.is_agent 自动选择 Simple Runner 或 ReAct Agent
   */
  async *sendMessage(userInput: string): AsyncGenerator<AiChatEvent>;

  /**
   * Simple Runner 模式：直接对话，不调用工具
   */
  private async *runSimple(userInput: string): AsyncGenerator<AiChatEvent>;

  /**
   * ReAct Agent 模式：支持多轮工具调用的循环
   *
   * 核心流程：
   * 1. 组装当前 messages + tools 定义
   * 2. 调用 LLM 流式请求
   * 3. 根据 finish_reason 分发：
   *    - 'stop': 输出最终文本，结束循环
   *    - 'tool_calls': 执行工具 → 收集结果 → 追加到 messages → 回到步骤 1
   *    - 'length': 触发上下文压缩 → 回到步骤 1
   * 4. 循环次数超过 maxToolRounds 时强制终止
   */
  private async *runAgent(userInput: string): AsyncGenerator<AiChatEvent>;

  /**
   * 执行单个工具调用
   * @returns 工具执行结果文本
   */
  private async executeToolCall(toolCall: AiToolCall): Promise<string>;

  /** 中止当前对话 */
  abort(): void;

  /** 加载历史消息 */
  loadHistory(messages: AiChatMessage[]): void;

  /** 获取当前消息列表 */
  getMessages(): AiChatMessage[];

  /** 获取历史保存数据 */
  getHistoryData(scenarioId: string): Omit<AiChatHistory, 'id' | 'title' | 'created_at' | 'updated_at'>;
}
```

### 5.4 对话事件定义 (`AiChatEvent`)

```typescript
/**
 * 对话过程中的事件流
 * 用于 IPC 从主进程推送到渲染进程
 */
type AiChatEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_start'; toolCallId: string; name: string; arguments: string }
  | { type: 'tool_result'; toolCallId: string; result: string; isError?: boolean }
  | { type: 'thinking'; content: string }
  | { type: 'context_compress'; originalTokens: number; compressedTokens: number }
  | { type: 'done'; messages: AiChatMessage[] }
  | { type: 'error'; message: string };
```

## 6 ReAct 引擎详细流程

```
用户输入 "帮我查看当前目录的文件结构"
    │
    ▼
┌─────────────────────────────────────┐
│ 1. 构建 System Prompt               │
│    system_prefix + memory + role    │
│    + skills + tools description     │
├─────────────────────────────────────┤
│ 2. 追加 user message                │
│    messages.push({role:'user', ...})│
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 3. 调用 LLM (stream)                │
│    带 tools function definitions    │
└──────────────┬──────────────────────┘
               │
        ┌──────┴──────┐
        │ finish_reason│
        ├──────┬──────┤
        │stop  │tools │length
        ▼      ▼      ▼
     ┌─────┐ ┌───────────────────┐ ┌──────────────┐
     │输出 │ │ 4. 逐个执行工具   │ │ 5. 上下文压缩 │
     │完成 │ │ emit tool_start   │ │ 压缩中间消息  │
     │emit │ │ await tool.exec() │ │ 回到步骤 3   │
     │done │ │ emit tool_result  │ │              │
     └─────┘ │ append results    │ └──────────────┘
             │ → 回到步骤 3       │
             │ (最多 N 轮)       │
             └───────────────────┘
```

### 关键设计点

1. **流式输出**: LLM 响应实时推送 `text_delta` 事件给渲染进程，工具调用信息通过 `tool_start` / `tool_result` 事件推送。

2. **工具执行安全**:
   - Shell 工具默认限制在工作目录内执行
   - 单次命令执行超时 30s
   - 危险命令 (`rm -rf /`, `format`, `del /f /s`) 前置拦截

3. **死循环防护**: `maxToolRounds` 默认 10 次，超过后强制输出当前结果并提示用户。

4. **上下文压缩触发条件**: 当 `estimateTokens(messages) > model_max_tokens * 0.75` 时触发，压缩策略为保留 system + 最近 4 轮 + 中间摘要。

## 7 MCP 集成设计

### 7.1 通信协议

采用 **stdio transport**：MCP 服务器作为子进程启动，通过 stdin/stdout 交换 JSON-RPC 2.0 消息。

### 7.2 生命周期

```
应用启动
  │
  ▼
读取 tool/mcp.setting.json
  │
  ▼
对每个 enabled 的 server:
  ├─ spawn 子进程 (command + args + env)
  ├─ 发送 initialize 请求
  ├─ 接收 capabilities + 工具列表
  ├─ 将工具包装为 McpToolAdapter (实现 ITool)
  └─ 注册到 ToolRegistry
  │
  ▼
工具可用，随场景配置加载
  │
  ▼
应用退出
  │
  ▼
对所有 McpClient 发送 disconnect → kill 子进程
```

### 7.3 MCP 工具适配器

```typescript
/**
 * MCP 工具适配器 — 将 MCP 服务器暴露的工具适配为 ITool
 */
class McpToolAdapter implements ITool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  private client: McpClient;
  private mcpToolName: string;

  constructor(client: McpClient, toolDefinition: any);

  async execute(args: Record<string, any>): Promise<string> {
    // 通过 JSON-RPC 2.0 调用 MCP 服务器的 tools/call
    const response = await this.client.callTool(this.mcpToolName, args);
    return response.content;
  }
}
```

## 8 IPC Channel 设计

### 8.1 Channel 命名规范

遵循项目现有规范：`qtian:ai:{action}`

### 8.2 Channel 列表

```typescript
// ===== LLM 配置管理 =====
'qtian:ai:list-llm-configs'        // → string[]
'qtian:ai:get-llm-config'          // (name) → AiLLMConfig
'qtian:ai:save-llm-config'         // (name, data) → void
'qtian:ai:delete-llm-config'       // (name) → void

// ===== Skill 管理 =====
'qtian:ai:list-skills'             // → AiSkillMeta[]
'qtian:ai:get-skill'               // (dirName) → AiSkill

// ===== 对话历史管理 =====
'qtian:ai:list-histories'          // (scenarioId) → AiChatHistory[]
'qtian:ai:get-history'             // (scenarioId, historyId) → AiChatHistory
'qtian:ai:create-history'          // (data) → void
'qtian:ai:save-history'            // (scenarioId, historyId, data) → void
'qtian:ai:delete-history'          // (scenarioId, historyId) → void

// ===== 对话会话 =====
'qtian:ai:init-chat'               // (scenarioId, historyId?, configName?) → void
'qtian:ai:chat-message'            // (scenarioId, historyId, message) → void (通过事件推送)
'qtian:ai:stop-chat'               // (scenarioId, historyId) → void
'qtian:ai:regenerate'              // (scenarioId, historyId) → void
'qtian:ai:pop-message'             // (scenarioId, historyId) → void
'qtian:ai:get-messages'            // (scenarioId, historyId) → AiChatMessage[]

// ===== 记忆管理 =====
'qtian:ai:list-memories'           // (scenarioId?) → AiMemory[]
'qtian:ai:add-memory'              // (data) → void
'qtian:ai:delete-memory'           // (id) → void

// ===== MCP 管理 =====
'qtian:ai:mcp-get-statuses'        // → Record<string, { connected: boolean; toolCount: number }>
'qtian:ai:mcp-save-config'         // (config) → void
'qtian:ai:mcp-reload'              // → void (重新加载所有 MCP 服务器)

// ===== 对话事件 (Main → Renderer 单向推送) =====
'qtian:ai:chat-event'              // (scenarioId, historyId, event: AiChatEvent)
```

### 8.3 对话流 IPC 交互时序

```
Renderer                          Main Process
  │                                    │
  ├─ init-chat(scenarioId, histId) ──→ │ 初始化 ChatService
  │                                    │ 组装 System Prompt
  │                                    │ 加载 tools, skills, memory
  │←──────── success ─────────────────┤
  │                                    │
  ├─ chat-message(..., "你好") ──────→ │
  │                                    │ stream LLM response...
  │← chat-event: text_delta ──────────┤
  │← chat-event: text_delta ──────────┤
  │← chat-event: done ────────────────┤
  │                                    │ auto-save history
  │                                    │
  ├─ chat-message(..., "查看目录") ──→ │ (Agent 模式)
  │                                    │ LLM 决定调用 shell__execute
  │← chat-event: thinking ────────────┤
  │← chat-event: tool_start ──────────┤  name: "shell__execute"
  │                                    │ 执行中...
  │← chat-event: tool_result ─────────┤  result: "dir listing..."
  │                                    │ 再次调用 LLM
  │← chat-event: text_delta ──────────┤
  │← chat-event: done ────────────────┤
  │                                    │
  ├─ stop-chat(...) ─────────────────→ │ abort current stream
```

## 9 Preload 桥接 API

```typescript
// 在 preload/index.ts 中新增
const aiAssistant = {
  // 场景
  listScenarios: () => ipcRenderer.invoke('qtian:ai:list-scenarios'),
  getScenario: (id) => ipcRenderer.invoke('qtian:ai:get-scenario', id),
  createScenario: (id, data) => ipcRenderer.invoke('qtian:ai:create-scenario', id, data),
  updateScenario: (id, data) => ipcRenderer.invoke('qtian:ai:update-scenario', id, data),
  deleteScenario: (id) => ipcRenderer.invoke('qtian:ai:delete-scenario', id),

  // 角色
  listRoles: () => ipcRenderer.invoke('qtian:ai:list-roles'),
  getRole: (name) => ipcRenderer.invoke('qtian:ai:get-role', name),
  saveRole: (name, content) => ipcRenderer.invoke('qtian:ai:save-role', name, content),
  deleteRole: (name) => ipcRenderer.invoke('qtian:ai:delete-role', name),

  // LLM 配置
  listLlmConfigs: () => ipcRenderer.invoke('qtian:ai:list-llm-configs'),
  getLlmConfig: (name) => ipcRenderer.invoke('qtian:ai:get-llm-config', name),
  saveLlmConfig: (name, data) => ipcRenderer.invoke('qtian:ai:save-llm-config', name, data),
  deleteLlmConfig: (name) => ipcRenderer.invoke('qtian:ai:delete-llm-config', name),

  // Skill
  listSkills: () => ipcRenderer.invoke('qtian:ai:list-skills'),
  getSkill: (dirName) => ipcRenderer.invoke('qtian:ai:get-skill', dirName),

  // 对话历史
  listHistories: (scenarioId) => ipcRenderer.invoke('qtian:ai:list-histories', scenarioId),
  getHistory: (scenarioId, historyId) => ipcRenderer.invoke('qtian:ai:get-history', scenarioId, historyId),
  createHistory: (data) => ipcRenderer.invoke('qtian:ai:create-history', data),
  saveHistory: (scenarioId, historyId, data) => ipcRenderer.invoke('qtian:ai:save-history', scenarioId, historyId, data),
  deleteHistory: (scenarioId, historyId) => ipcRenderer.invoke('qtian:ai:delete-history', scenarioId, historyId),

  // 对话会话
  initChat: (scenarioId, historyId?, configName?) => ipcRenderer.invoke('qtian:ai:init-chat', scenarioId, historyId, configName),
  chatMessage: (scenarioId, historyId, message) => ipcRenderer.invoke('qtian:ai:chat-message', scenarioId, historyId, message),
  stopChat: (scenarioId, historyId) => ipcRenderer.invoke('qtian:ai:stop-chat', scenarioId, historyId),
  regenerate: (scenarioId, historyId) => ipcRenderer.invoke('qtian:ai:regenerate', scenarioId, historyId),
  popMessage: (scenarioId, historyId) => ipcRenderer.invoke('qtian:ai:pop-message', scenarioId, historyId),
  getMessages: (scenarioId, historyId) => ipcRenderer.invoke('qtian:ai:get-messages', scenarioId, historyId),

  // 记忆
  listMemories: (scenarioId?) => ipcRenderer.invoke('qtian:ai:list-memories', scenarioId),
  addMemory: (data) => ipcRenderer.invoke('qtian:ai:add-memory', data),
  deleteMemory: (id) => ipcRenderer.invoke('qtian:ai:delete-memory', id),

  // MCP
  getMcpStatuses: () => ipcRenderer.invoke('qtian:ai:mcp-get-statuses'),
  saveMcpConfig: (config) => ipcRenderer.invoke('qtian:ai:mcp-save-config', config),
  reloadMcp: () => ipcRenderer.invoke('qtian:ai:mcp-reload'),

  // 对话事件监听
  onChatEvent: (callback) => { ... },
  offChatEvent: () => { ... },
};
```

## 10 UI 组件设计补充

### 10.1 Agent 模式下的消息展示

Agent 模式的 AI 回复可能包含多轮工具调用，UI 需要支持：

```
┌──────────────────────────────────────┐
│ 🤖 AI 助手                           │
│                                      │
│  让我帮你查看一下当前目录结构...       │
│                                      │
│  ┌─ 🔧 shell__execute ──────────┐   │
│  │ 命令: ls -la                  │   │
│  │ ┌─ 执行结果 (可折叠) ───────┐ │   │
│  │ │ drwxr-xr-x  5 user ...    │ │   │
│  │ │ -rw-r--r--  1 user ...    │ │   │
│  │ └───────────────────────────┘ │   │
│  └──────────────────────────────┘   │
│                                      │
│  当前目录包含以下文件和文件夹：        │
│  - `src/` - 源代码目录               │
│  - `package.json` - 项目配置          │
│  - `README.md` - 项目说明             │
└──────────────────────────────────────┘
```

### 10.2 停止按钮

Agent 模式下工具调用可能耗时较长，输入区域发送按钮旁边需要一个"停止"按钮，调用 `stop-chat` 中止当前执行。

## 11 全局配置扩展

在 `qtian.json` 中新增 `ai_assistant` 配置段：

```json
{
  "ai_assistant": {
    "default_scenario": "default",
    "default_llm_config": "default",
    "max_tool_rounds": 10,
    "context_compress_threshold": 0.75,
    "tool_timeout_ms": 30000
  }
}
```

## 12 实现分期建议

### Phase 1: 基础框架 (Simple Runner)
- 数据目录初始化 (`WPath` 扩展)
- 全局配置扩展
- 类型定义 (`config.ts`)
- 基础 CRUD 服务 (Scenario, Role, Config, History)
- `AiChatService` Simple Runner 模式
- IPC Handler + Preload 桥接
- 基础 UI (页面布局、对话、历史)
- 单元测试

### Phase 2: 工具链 & Agent
- `ITool` 接口 + `ToolRegistry`
- 内置工具 (Shell 执行)
- `AiChatService` ReAct Agent 模式
- 工具调用事件推送
- UI 工具调用展示 (`ToolCallView.vue`)
- 停止按钮

### Phase 3: Skill & Memory
- `AiSkillService` (SKILL.md 解析 + 注入)
- `AiMemoryService`
- 上下文管理 (`AiContextService`)
- Skill 管理 UI

### Phase 4: MCP 集成
- `McpClient` (stdio transport)
- `McpManager` (生命周期管理)
- `McpToolAdapter`
- MCP 配置管理 UI
- 更多内置工具 (Tavily 搜索, Local RAG)
