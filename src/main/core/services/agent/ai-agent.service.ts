import OpenAI from 'openai';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { createLogger } from '@/core/utils/logger';
import { AiLLMConfig, AiAgent, AiChatMessage, AiChatEvent, AiToolCall, AiSkill, AiChatHistory } from '@/core/common/config';
import { ITool, ToolRegistry } from '../tools';

const logger = createLogger('AiAgentService');

/** 格式化当前时间为 YYYY-M-D HH:mm:ss */
function getCurrentTimeString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()} ${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
}

/** 默认最大工具调用轮数 */
const DEFAULT_MAX_TOOL_ROUNDS = 10;

/**
 * AI 助手核心对话服务
 *
 * 统一使用 streaming tool-use loop:
 * - 有工具时: 流式文本 → tool_calls → 执行工具 → 继续循环
 * - 无工具时: 流式文本 → 结束 (等价于 loop 只执行一轮)
 *
 * 支持 Skill + Memory 通过 System Prompt 注入
 */
export class AiAgentService {
  private client: OpenAI | null = null;
  private llmConfig: AiLLMConfig;
  private agent: AiAgent;
  private messages: AiChatMessage[] = [];

  /** 工具注册表 */
  private toolRegistry: ToolRegistry;

  /** 最大工具调用轮数 */
  private maxToolRounds: number;

  /** 是否有可用工具 */
  private hasTools: boolean;

  /** 已加载的 Skill 列表 */
  private skills: AiSkill[];

  /** 已构建的记忆文本 (用于注入 System Prompt) */
  private memoryPrompt: string;

  /** 中止标志 — 用于停止正在进行的对话 */
  private aborted = false;

  /** 对话标题 */
  private title = '';

  /** 对话创建时间 */
  private createdAt = Date.now();

  constructor(
    llmConfig: AiLLMConfig,
    agent: AiAgent,
    options?: {
      tools?: ITool[];
      maxToolRounds?: number;
      skills?: AiSkill[];
      memoryPrompt?: string;
    }
  ) {
    this.llmConfig = llmConfig;
    this.agent = agent;
    this.toolRegistry = new ToolRegistry();
    this.maxToolRounds = options?.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    this.hasTools = (options?.tools?.length ?? 0) > 0;
    this.skills = options?.skills ?? [];
    this.memoryPrompt = options?.memoryPrompt ?? '';

    // 注册工具
    if (options?.tools) {
      this.toolRegistry.registerAll(options.tools);
    }

    this.initClient();
    this.initMessages();
  }

  /**
   * 规范化 Base URL，去除 OpenAI SDK 会自动拼接的路径后缀
   */
  private normalizeBaseUrl(url: string): string {
    // OpenAI SDK 会自动拼接 /chat/completions 等路径，需要去掉用户误填的部分
    const suffixes = ['/chat/completions', '/chat/completions/'];
    for (const suffix of suffixes) {
      if (url.endsWith(suffix)) {
        return url.slice(0, -suffix.length);
      }
    }
    return url;
  }

  /**
   * 初始化 OpenAI 客户端
   */
  private initClient(): void {
    const baseURL = this.normalizeBaseUrl(this.llmConfig.base_url);
    const clientConfig: any = {
      baseURL,
      apiKey: this.llmConfig.key || 'dummy-key',
    };

    if (this.llmConfig.proxy) {
      logger.info(`Using proxy: ${this.llmConfig.proxy}`);
      // Electron 全局 fetch 是 Chromium 实现，不支持 dispatcher，
      // 需要用 undici.fetch 替代才能让 ProxyAgent 生效
      clientConfig.fetch = undiciFetch;
      clientConfig.fetchOptions = {
        dispatcher: new ProxyAgent(this.llmConfig.proxy),
      };
    }

    this.client = new OpenAI(clientConfig);
  }

  /**
   * 初始化对话消息，组装 System Prompt
   * 组装顺序: system_prefix → memory → role → skills
   */
  private initMessages(): void {
    this.messages = [];

    const systemPrompt = this.buildSystemPrompt();
    if (systemPrompt) {
      this.messages.push({
        role: 'system',
        content: systemPrompt,
        timestamp: Date.now(),
        model: this.llmConfig.model,
        time: getCurrentTimeString(),
      });
    }
  }

  /**
   * 构建 System Prompt
   * 组装顺序: system_prefix → memory → agent.instructions → skills
   * @returns 完整的 System Prompt 文本
   */
  buildSystemPrompt(): string {
    const parts: string[] = [];

    // 1. LLM 配置中的 system_prefix
    if (this.llmConfig.system_prefix) {
      parts.push(this.llmConfig.system_prefix);
    }

    // 2. 记忆 (已由 AiMemoryService 构建好)
    if (this.memoryPrompt) {
      parts.push(this.memoryPrompt);
    }

    // 3. Agent instructions (原 role content)
    if (this.agent.instructions) {
      parts.push(this.agent.instructions);
    }

    // 4. Skills 指令注入
    if (this.skills.length > 0) {
      const skillParts = this.skills.map((skill) => {
        return `### ${skill.name} (v${skill.version})\n${skill.instructions}`;
      });
      parts.push(`## 技能\n\n${skillParts.join('\n\n---\n\n')}`);
    }

    return parts.join('\n\n');
  }

  /**
   * 重置对话到初始状态
   */
  reset(): void {
    this.initMessages();
    this.aborted = false;
    logger.info('Chat session reset');
  }

  /**
   * 加载历史数据（消息、标题、创建时间）
   * @param history - 从历史文件加载的完整对话数据
   */
  loadHistory(history: AiChatHistory): void {
    this.messages = history.messages;
    this.title = history.title || '';
    this.createdAt = history.created_at || Date.now();
    logger.info(`Loaded ${history.messages.length} messages from history`);
  }

  /**
   * 获取当前消息列表
   * @returns 当前消息列表
   */
  getMessages(): AiChatMessage[] {
    return this.messages;
  }

  /**
   * 获取保存历史所需的完整数据（保留已有的 id/title/created_at）
   * @param agentId - Agent 名称
   * @param historyId - 历史 ID
   * @returns 对话历史数据
   */
  getHistoryData(agentId: string, historyId: string): AiChatHistory {
    return {
      id: historyId,
      agent_id: agentId,
      title: this.title,
      messages: this.messages,
      created_at: this.createdAt,
      updated_at: Date.now(),
    };
  }

  /**
   * 中止当前对话
   */
  abort(): void {
    this.aborted = true;
    logger.info('Chat session aborted');
  }

  /**
   * 发送消息并获取流式响应
   *
   * 统一 streaming tool-use loop:
   * - 流式收集 LLM 响应 (逐 chunk yield 文本)
   * - finish_reason === 'tool_calls' → 执行工具 → 继续循环
   * - finish_reason === 'stop' → 结束
   *
   * @param userInput - 用户输入
   * @returns AsyncGenerator 事件流
   */
  async *sendMessage(userInput: string): AsyncGenerator<AiChatEvent> {
    this.aborted = false;

    // 追加用户消息
    if (userInput.trim()) {
      this.messages.push({
        role: 'user',
        content: userInput,
        timestamp: Date.now(),
        model: this.llmConfig.model,
        time: getCurrentTimeString(),
      });
    }

    yield* this.runToolUseLoop();
  }

  /**
   * 重新生成最后一条助手回复
   * @returns AsyncGenerator 事件流
   */
  async *regenerate(): AsyncGenerator<AiChatEvent> {
    this.aborted = false;

    // 移除最后一条助手消息
    const lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
      this.messages.pop();
    }

    yield* this.sendMessage('');
  }

  /**
   * 回退最后一条消息
   * @returns 是否成功回退
   */
  popMessage(): boolean {
    if (this.messages.length > 0) {
      this.messages.pop();
      logger.info('Last message popped');
      return true;
    }
    return false;
  }

  /**
   * 获取 Agent 信息
   * @returns 当前 Agent
   */
  getAgent(): AiAgent {
    return this.agent;
  }

  /**
   * 更新 LLM 配置
   * @param llmConfig - 新的 LLM 配置
   */
  updateLlmConfig(llmConfig: AiLLMConfig): void {
    this.llmConfig = llmConfig;
    this.initClient();
    logger.info('LLM config updated');
  }

  // =========================================================================
  // Streaming Tool-Use Loop
  // =========================================================================

  /**
   * 统一的 streaming tool-use loop:
   * 1. 调用 LLM (有工具时带 tools definitions)
   * 2. 逐 chunk yield 文本，同时收集工具调用
   * 3. finish_reason === 'stop' → 追加消息 → done
   * 4. finish_reason === 'tool_calls' → 追加助手消息 → 逐个执行工具 → yield tool_start/tool_result → 继续循环
   */
  private async *runToolUseLoop(): AsyncGenerator<AiChatEvent> {
    try {
      if (!this.client) {
        throw new Error('OpenAI client not initialized');
      }

      const toolsDef = this.hasTools ? this.toolRegistry.getFunctionDefinitions() : undefined;

      for (let round = 0; round < this.maxToolRounds; round++) {
        if (this.aborted) break;

        logger.info(`Chat round ${round + 1}/${this.maxToolRounds}`);

        // 调用 LLM
        const stream = await this.client.chat.completions.create({
          model: this.llmConfig.model,
          messages: this.buildApiMessages(),
          ...(toolsDef ? { tools: toolsDef } : {}),
          stream: true,
          temperature: this.llmConfig.temperature,
          max_tokens: this.llmConfig.max_tokens,
        });

        // 流式消费响应：逐 chunk yield 文本，收集工具调用
        let textContent = '';
        const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();
        let finishReason: string | null = null;

        for await (const chunk of stream) {
          if (this.aborted) break;

          const choice = chunk.choices[0];
          if (!choice) continue;

          const delta = choice.delta;

          // 逐 chunk yield 文本，确保前端实时收到流式输出
          if (delta?.content) {
            textContent += delta.content;
            yield { type: 'text_delta', content: delta.content };
          }

          // 收集工具调用 delta
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCallsMap.has(idx)) {
                toolCallsMap.set(idx, { id: tc.id || '', name: '', arguments: '' });
              }
              const entry = toolCallsMap.get(idx)!;
              if (tc.id) entry.id = tc.id;
              if (tc.function?.name) entry.name += tc.function.name;
              if (tc.function?.arguments) entry.arguments += tc.function.arguments;
            }
          }

          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
        }

        const toolCalls = Array.from(toolCallsMap.values()).filter((tc) => tc.name);

        if (this.aborted) break;

        // 纯文本响应 (finish_reason === 'stop')
        if (finishReason === 'stop' || finishReason === 'length') {
          if (textContent.trim()) {
            this.messages.push({
              role: 'assistant',
              content: textContent.trim(),
              timestamp: Date.now(),
              model: this.llmConfig.model,
              time: getCurrentTimeString(),
            });
          }

          if (finishReason === 'length') {
            yield { type: 'error', message: 'Response was truncated due to max_tokens limit' };
          }

          break;
        }

        // 工具调用 (finish_reason === 'tool_calls')
        if (finishReason === 'tool_calls' && toolCalls.length > 0) {
          // 追加助手消息 (含 tool_calls) 到消息列表
          const assistantMessage: AiChatMessage = {
            role: 'assistant',
            content: textContent || '',
            tool_calls: toolCalls,
            timestamp: Date.now(),
            model: this.llmConfig.model,
            time: getCurrentTimeString(),
          };
          this.messages.push(assistantMessage);

          // 逐个执行工具
          for (const toolCall of toolCalls) {
            if (this.aborted) break;

            const { name, arguments: argsStr } = toolCall.function;

            // 通知 UI: 工具开始执行
            yield {
              type: 'tool_start',
              toolCallId: toolCall.id,
              name,
              arguments: argsStr,
            };

            // 执行工具
            const toolResult = await this.executeTool(name, argsStr);

            // 通知 UI: 工具执行结果
            yield {
              type: 'tool_result',
              toolCallId: toolCall.id,
              result: toolResult,
              isError: toolResult.startsWith('Error:'),
            };

            // 追加工具结果到消息列表
            this.messages.push({
              role: 'tool',
              content: toolResult,
              tool_call_id: toolCall.id,
              timestamp: Date.now(),
              model: this.llmConfig.model,
              time: getCurrentTimeString(),
            });
          }

          // 继续下一轮
          continue;
        }

        // 未知 finish_reason，结束循环
        logger.warn(`Unexpected finish_reason: ${finishReason}`);
        break;
      }

      // 检查是否因超过最大轮数退出
      if (!this.aborted) {
        const lastMsg = this.messages[this.messages.length - 1];
        if (lastMsg?.tool_calls) {
          yield { type: 'error', message: `Reached maximum tool rounds (${this.maxToolRounds})` };
        }
      }

      yield { type: 'done', messages: this.messages };
      logger.info('Chat completed');
    } catch (err: any) {
      const status = err?.status || err?.statusCode;
      // 404 通常意味着 base_url 配置错误（如误填了 /chat/completions 后缀）
      if (status === 404) {
        const hint = '模型 Base URL 配置错误，请检查（不应包含 /chat/completions 等路径后缀）';
        logger.error(`Chat failed: ${hint}`, err);
        yield { type: 'error', message: hint };
      } else {
        logger.error('Chat failed', err);
        yield { type: 'error', message: (err as Error).message };
      }
    }
  }

  /**
   * 执行指定工具
   * @param name - 工具名称
   * @param argsStr - 工具参数 JSON 字符串
   * @returns 工具执行结果文本
   */
  private async executeTool(name: string, argsStr: string): Promise<string> {
    const tool = this.toolRegistry.get(name);
    if (!tool) {
      return `Error: Tool '${name}' not found`;
    }

    try {
      const args = JSON.parse(argsStr || '{}');
      return await tool.execute(args);
    } catch (err) {
      const errMsg = (err as Error).message;
      logger.error(`Tool '${name}' execution failed: ${errMsg}`);
      return `Error: Tool execution failed: ${errMsg}`;
    }
  }

  // =========================================================================
  // 公共工具方法
  // =========================================================================

  /**
   * 构建发送给 LLM 的消息格式 (过滤 timestamp 等非标准字段)
   */
  private buildApiMessages(): Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string }> {
    return this.messages.map((msg) => {
      const apiMsg: any = { role: msg.role, content: msg.content };
      if (msg.tool_calls) {
        apiMsg.tool_calls = msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: tc.function,
        }));
      }
      if (msg.tool_call_id) {
        apiMsg.tool_call_id = msg.tool_call_id;
      }
      return apiMsg;
    });
  }
}
