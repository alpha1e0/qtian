import { AiAgentService } from '@/core/services/agent/ai-agent.service';
import { AiAgentMgrService } from '@/core/services/agent/ai-agent-mgr.service';
import { AiConfigService } from '@/core/services/common/ai-config.service';
import { AiHistoryService } from '@/core/services/common/ai-history.service';
import { buildBuiltInTools } from '@/core/services/tools/build-tools';
import { AskQuestion } from '@/core/services/tools';
import { createLogger } from '@/core/utils/logger';
import {
  AiAgent,
  AiChatEvent,
  AiChatHistory,
  AiLLMConfig,
} from '@/core/common/config';
import {
  ITaskExecutor,
  TaskAgentView,
  TaskCancelledError,
  TaskExecutionContext,
  TaskExecutionError,
  TaskExecutionResult,
  TaskEvent,
} from '../task.types';

const logger = createLogger('AgentTaskExecutor');

/** AgentTaskExecutor 处理的任务类型 */
const TASK_TYPE = 'agent' as const;

/**
 * 将 task.id 映射为独立的 AI 对话 agent_id
 * 与 AI 助手主历史（agent_id = agent.name）完全隔离
 */
export function buildTaskAgentId(taskId: number): string {
  return `task:agent:${taskId}`;
}

/**
 * AgentTaskExecutor 所需依赖提供者
 * 与 AI 助手 handler 保持一致的注入方式
 */
export interface AgentTaskExecutorProviders {
  askUserViaIpc?: (toolCallId: string, questions: AskQuestion[]) => Promise<Record<string, string>>;
  getTavilyApiKey?: () => string;
}

/**
 * Agent 任务执行器
 *
 * 职责：
 * 1. 加载 Agent 定义与 LLM 配置
 * 2. 创建独立对话历史（agent_id = 'task:agent:<taskId>'）
 * 3. 构建工具集（来自 Agent 定义）
 * 4. 执行 AiAgentService 对话循环
 * 5. 将 AiChatEvent 转换为 TaskEvent 推送
 * 6. 响应取消请求（调用 agentService.abort()）
 *
 * 不负责：任务状态持久化（由 TaskManager 统一处理）
 */
export class AgentTaskExecutor implements ITaskExecutor<TaskAgentView> {
  readonly type = TASK_TYPE;

  constructor(
    private readonly agentMgr: AiAgentMgrService,
    private readonly configService: AiConfigService,
    private readonly historyService: AiHistoryService,
    private readonly providers: AgentTaskExecutorProviders = {},
  ) {}

  /**
   * 执行 Agent 任务
   *
   * @param taskView - Agent 任务视图（含 prompt/agent_name/llm_config_name）
   * @param context - 执行上下文
   * @returns 任务结果（含 chat_history_id 与完整消息列表）
   */
  async execute(taskView: TaskAgentView, context: TaskExecutionContext): Promise<TaskExecutionResult> {
    const { taskId, emit, cancelToken } = context;

    // 1. 加载 Agent 定义与 LLM 配置
    let agent: AiAgent;
    let llmConfig: AiLLMConfig;
    try {
      agent = await this.agentMgr.getAgent(taskView.agent_name);
    } catch (err) {
      throw new TaskExecutionError(`Agent '${taskView.agent_name}' not found: ${this.errMsg(err)}`, { cause: err });
    }
    try {
      llmConfig = await this.configService.getConfig(taskView.llm_config_name);
    } catch (err) {
      throw new TaskExecutionError(`LLM config '${taskView.llm_config_name}' not found: ${this.errMsg(err)}`, { cause: err });
    }

    // 2. 创建独立对话历史
    const taskAgentId = buildTaskAgentId(taskId);
    const historyId = `task-${taskId}-${Date.now()}`;
    const initialHistory: AiChatHistory = {
      id: historyId,
      agent_id: taskAgentId,
      title: taskView.title,
      messages: [],
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    try {
      await this.historyService.createHistory(taskAgentId, historyId, initialHistory);
    } catch (err) {
      throw new TaskExecutionError(`Failed to create chat history: ${this.errMsg(err)}`, { cause: err });
    }

    // 3. 构建工具集
    const tools = buildBuiltInTools(agent.tools ?? [], {
      askUserViaIpc: this.providers.askUserViaIpc,
      getTavilyApiKey: this.providers.getTavilyApiKey,
    });

    // 4. 创建 AiAgentService
    const agentService = new AiAgentService(llmConfig, agent, {
      tools,
      skills: [],
      memoryPrompt: '',
    });

    // 5. 注册取消回调（用于中止进行中的 LLM 流；取消状态统一从 cancelToken.cancelled 读取，
    //    以覆盖"取消发生在注册之前"的边界场景）
    cancelToken.onCancel(() => {
      agentService.abort();
      logger.info(`Task ${taskId} abort requested`);
    });

    // 6. 执行对话循环
    let finalMessages: AiChatHistory['messages'] | undefined;
    try {
      for await (const chatEvent of agentService.sendMessage(taskView.prompt)) {
        // 取消响应：sendMessage 内部会停止生成并结束迭代
        if (cancelToken.cancelled) {
          break;
        }
        const taskEvent = this.translateChatEvent(taskId, chatEvent);
        if (taskEvent) {
          // 'done' 事件携带最终消息
          if (taskEvent.type === 'done') {
            finalMessages = (chatEvent as Extract<AiChatEvent, { type: 'done' }>).messages;
          }
          emit(taskEvent);
        }
      }
    } catch (err) {
      // sendMessage 抛错视为执行失败
      if (cancelToken.cancelled || isAbortError(err)) {
        throw new TaskCancelledError(`Task ${taskId} cancelled during chat`);
      }
      throw new TaskExecutionError(`Agent chat failed: ${this.errMsg(err)}`, { cause: err });
    }

    // 7. 显式取消（迭代结束后检测）
    if (cancelToken.cancelled) {
      throw new TaskCancelledError(`Task ${taskId} cancelled`);
    }

    // 8. 取最终消息（done 事件已携带；兼容兜底从 agentService 读取）
    const messages = finalMessages ?? agentService.getMessages();

    // 9. 持久化对话历史
    const historyData: AiChatHistory = {
      id: historyId,
      agent_id: taskAgentId,
      title: taskView.title,
      messages,
      created_at: initialHistory.created_at,
      updated_at: Date.now(),
    };
    try {
      await this.historyService.saveHistory(taskAgentId, historyId, historyData);
    } catch (err) {
      // 历史保存失败不影响任务完成，仅告警
      logger.error(`Task ${taskId}: failed to save chat history ${historyId}`, err);
    }

    logger.info(`Task ${taskId} agent execution completed, historyId=${historyId}, messages=${messages.length}`);

    return {
      meta: {
        chat_history_id: historyId,
        message_count: messages.length,
      },
      rawOutput: messages,
    };
  }

  /**
   * 将 AiChatEvent 转换为 TaskEvent
   * @returns TaskEvent；context_compress 等无对应事件返回 null（记录日志）
   */
  private translateChatEvent(taskId: number, chatEvent: AiChatEvent): TaskEvent | null {
    switch (chatEvent.type) {
      case 'text_delta':
        return { taskId, type: 'text_delta', content: chatEvent.content };
      case 'tool_start':
        return { taskId, type: 'tool_start', toolCallId: chatEvent.toolCallId, name: chatEvent.name, arguments: chatEvent.arguments };
      case 'tool_result':
        return { taskId, type: 'tool_result', toolCallId: chatEvent.toolCallId, result: chatEvent.result, isError: chatEvent.isError };
      case 'thinking':
        return { taskId, type: 'thinking', content: chatEvent.content };
      case 'done':
        return { taskId, type: 'done' };
      case 'error':
        return { taskId, type: 'error', message: chatEvent.message };
      case 'context_compress':
        // 任务事件暂无 context_compress 对应类型，记录为 log
        return { taskId, type: 'log', message: `上下文压缩: ${chatEvent.originalTokens} → ${chatEvent.compressedTokens} tokens`, level: 'info' };
      default:
        return null;
    }
  }

  /** 提取错误的 message 字符串 */
  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}

/** 判断是否为 abort/取消类错误 */
function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('abort') || msg.includes('cancel');
}
