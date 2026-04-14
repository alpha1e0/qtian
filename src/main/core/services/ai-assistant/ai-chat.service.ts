import OpenAI from 'openai';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { createLogger } from '@/core/utils/logger';
import { AiLLMConfig, AiScenario, AiChatMessage, AiChatEvent, AiToolCall, AiSkill } from '@/core/common/config';
import { ITool, ToolRegistry } from './tools';

const logger = createLogger('AiChatService');

/** 格式化当前时间为 YYYY-M-D HH:mm:ss */
function getCurrentTimeString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()} ${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
}

/** Agent 模式默认最大工具调用轮数 */
const DEFAULT_MAX_TOOL_ROUNDS = 10;

/**
 * AI 助手核心对话服务
 *
 * Phase 1: Simple Runner 模式 — 直接流式对话，不调用工具
 * Phase 2: ReAct Agent 模式 — 扩展 function calling 多轮循环
 * Phase 3: Skill + Memory — System Prompt 注入技能和记忆
 */
export class AiChatService {
  private client: OpenAI | null = null;
  private llmConfig: AiLLMConfig;
  private scenario: AiScenario;
  private roleContent: string;
  private messages: AiChatMessage[] = [];

  /** 工具注册表 (Agent 模式) */
  private toolRegistry: ToolRegistry;

  /** Agent 模式最大工具调用轮数 */
  private maxToolRounds: number;

  /** 是否为 Agent 模式 */
  private isAgent: boolean;

  /** 已加载的 Skill 列表 */
  private skills: AiSkill[];

  /** 已构建的记忆文本 (用于注入 System Prompt) */
  private memoryPrompt: string;

  /** 中止标志 — 用于停止正在进行的对话 */
  private aborted = false;

  constructor(
    llmConfig: AiLLMConfig,
    scenario: AiScenario,
    roleContent: string,
    options?: {
      tools?: ITool[];
      maxToolRounds?: number;
      skills?: AiSkill[];
      memoryPrompt?: string;
    }
  ) {
    this.llmConfig = llmConfig;
    this.scenario = scenario;
    this.roleContent = roleContent;
    this.toolRegistry = new ToolRegistry();
    this.maxToolRounds = options?.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    this.isAgent = scenario.is_agent && (options?.tools?.length ?? 0) > 0;
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
   * 初始化 OpenAI 客户端
   */
  private initClient(): void {
    const clientConfig: any = {
      baseURL: this.llmConfig.base_url,
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
   * 组装顺序: system_prefix → memory → role → skills
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

    // 3. 角色内容
    if (this.roleContent) {
      parts.push(this.roleContent);
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
   * 加载历史消息
   * @param messages - 从历史文件加载的消息列表
   */
  loadHistory(messages: AiChatMessage[]): void {
    this.messages = messages;
    logger.info(`Loaded ${messages.length} messages from history`);
  }

  /**
   * 获取当前消息列表
   * @returns 当前消息列表
   */
  getMessages(): AiChatMessage[] {
    return this.messages;
  }

  /**
   * 获取保存历史所需的数据
   * @param scenarioId - 场景 ID
   * @param historyId - 历史 ID
   * @returns 对话历史数据 (不含 id/title/created_at)
   */
  getHistoryData(scenarioId: string, historyId: string): Omit<AiChatHistory, 'id' | 'title' | 'created_at'> {
    return {
      scenario_id: scenarioId,
      messages: this.messages,
      updated_at: Date.now(),
    };
  }

  /**
   * 判断是否为 Agent 模式
   */
  getIsAgent(): boolean {
    return this.isAgent;
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
   * - Simple Runner 模式: 返回 text 片段流
   * - Agent 模式: 返回 AiChatEvent 事件流 (含 tool_start / tool_result / text_delta)
   *
   * @param userInput - 用户输入
   * @returns AsyncGenerator 事件/文本流
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

    if (this.isAgent) {
      yield* this.runAgentLoop();
    } else {
      yield* this.runSimpleRunner();
    }
  }

  /**
   * 重新生成最后一条助手回复
   * @returns AsyncGenerator 事件/文本流
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
   * 获取场景信息
   * @returns 当前场景
   */
  getScenario(): AiScenario {
    return this.scenario;
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
  // Simple Runner 模式 (Phase 1)
  // =========================================================================

  /**
   * Simple Runner: 直接流式对话，无工具调用
   */
  private async *runSimpleRunner(): AsyncGenerator<AiChatEvent> {
    try {
      if (!this.client) {
        throw new Error('OpenAI client not initialized');
      }

      const stream = await this.client.chat.completions.create({
        model: this.llmConfig.model,
        messages: this.buildApiMessages(),
        stream: true,
        temperature: this.llmConfig.temperature,
        max_tokens: this.llmConfig.max_tokens,
      });

      let fullResponse = '';

      for await (const chunk of stream) {
        if (this.aborted) break;

        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullResponse += content;
          yield { type: 'text_delta', content };
        }
      }

      // 追加助手回复到消息列表
      if (fullResponse.trim()) {
        this.messages.push({
          role: 'assistant',
          content: fullResponse.trim(),
          timestamp: Date.now(),
          model: this.llmConfig.model,
          time: getCurrentTimeString(),
        });
      }

      yield { type: 'done', messages: this.messages };
      logger.info('Simple runner completed');
    } catch (err) {
      logger.error('Simple runner failed', err);
      yield { type: 'error', message: (err as Error).message };
    }
  }

  // =========================================================================
  // ReAct Agent 模式 (Phase 2)
  // =========================================================================

  /**
   * ReAct Agent 循环:
   * 1. 调用 LLM (带 tools definitions)
   * 2. 流式收集 response 和 tool_calls
   * 3. finish_reason === 'stop' → 输出 text_delta → done
   * 4. finish_reason === 'tool_calls' → yield tool_start → 逐个执行工具 → yield tool_result → 继续循环
   */
  private async *runAgentLoop(): AsyncGenerator<AiChatEvent> {
    try {
      if (!this.client) {
        throw new Error('OpenAI client not initialized');
      }

      const toolsDef = this.toolRegistry.getFunctionDefinitions();

      for (let round = 0; round < this.maxToolRounds; round++) {
        if (this.aborted) break;

        logger.info(`Agent round ${round + 1}/${this.maxToolRounds}`);

        // 调用 LLM
        const stream = await this.client.chat.completions.create({
          model: this.llmConfig.model,
          messages: this.buildApiMessages(),
          tools: toolsDef,
          stream: true,
          temperature: this.llmConfig.temperature,
          max_tokens: this.llmConfig.max_tokens,
        });

        // 流式收集响应
        const { textContent, toolCalls, finishReason } = await this.collectStreamResponse(stream);

        if (this.aborted) break;

        // 处理纯文本响应 (finish_reason === 'stop')
        if (finishReason === 'stop' || finishReason === 'length') {
          if (textContent.trim()) {
            // 流式输出文本
            yield { type: 'text_delta', content: textContent };

            // 追加到消息列表
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

          break; // 结束 Agent 循环
        }

        // 处理工具调用 (finish_reason === 'tool_calls')
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

          // 继续下一轮 Agent 循环
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
          yield { type: 'error', message: `Agent reached maximum tool rounds (${this.maxToolRounds})` };
        }
      }

      yield { type: 'done', messages: this.messages };
      logger.info('Agent loop completed');
    } catch (err) {
      logger.error('Agent loop failed', err);
      yield { type: 'error', message: (err as Error).message };
    }
  }

  /**
   * 流式收集 LLM 响应，提取文本内容和工具调用
   * @param stream - OpenAI 流式响应
   * @returns 收集到的文本内容、工具调用、结束原因
   */
  private async collectStreamResponse(
    stream: AsyncIterable<any>
  ): Promise<{ textContent: string; toolCalls: AiToolCall[]; finishReason: string | null }> {
    let textContent = '';
    const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let finishReason: string | null = null;

    for await (const chunk of stream) {
      if (this.aborted) break;

      const choice = chunk.choices[0];
      if (!choice) continue;

      // 收集文本 delta
      const delta = choice.delta;
      if (delta?.content) {
        textContent += delta.content;
      }

      // 收集工具调用 delta
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCalls.has(idx)) {
            toolCalls.set(idx, { id: tc.id || '', name: '', arguments: '' });
          }
          const entry = toolCalls.get(idx)!;
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name += tc.function.name;
          if (tc.function?.arguments) entry.arguments += tc.function.arguments;
        }
      }

      // 记录 finish_reason
      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
    }

    return {
      textContent,
      toolCalls: Array.from(toolCalls.values()).filter((tc) => tc.name),
      finishReason,
    };
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
