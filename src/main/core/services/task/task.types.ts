/**
 * 任务系统（task）类型定义
 *
 * 设计文档：docs/specs/007_task-design.md §3
 *
 * 所有任务相关类型集中定义在此文件，供主进程服务、IPC handler、
 * 渲染进程（通过 preload 桥接的类型推断）共享。
 */

// ============================================================================
// 枚举类型
// ============================================================================

/**
 * 任务类型枚举
 * - agent: 由 AI Agent 执行的对话型任务
 * - batch: 批处理任务（预留）
 * - tool_execution: 特殊工具执行任务（预留）
 */
export type TaskType = 'agent' | 'batch' | 'tool_execution';

/**
 * 任务来源（哪个应用创建）
 * 用于结果回调分发与历史查询过滤
 */
export type TaskSource = 'todo-app' | 'doc-app' | 'unknown';

/**
 * 任务状态
 *
 * 状态机：
 *   pending -> running -> completed
 *                      \-> failed
 *                      \-> cancelled
 *
 * 说明：
 * - pending: 已创建未启动（理论上 create 后立即 run，此状态短暂存在）
 * - running: 执行中
 * - completed: 成功完成
 * - failed: 执行失败（error_message 填充）
 * - cancelled: 用户主动取消
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** 任务状态终态集合（不可再流转） */
export const TASK_TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'completed',
  'failed',
  'cancelled',
]);

/** 合法的任务类型集合（用于校验） */
export const VALID_TASK_TYPES: ReadonlySet<TaskType> = new Set<TaskType>([
  'agent',
  'batch',
  'tool_execution',
]);

/** 合法的任务来源集合（用于校验） */
export const VALID_TASK_SOURCES: ReadonlySet<TaskSource> = new Set<TaskSource>([
  'todo-app',
  'doc-app',
  'unknown',
]);

// ============================================================================
// 基础实体
// ============================================================================

/**
 * 任务基础实体（对应 task 主表）
 *
 * 设计原则：
 * - 仅承载所有任务类型共有的字段
 * - 类型特有字段（如 agent_name/prompt）放在扩展表（如 task_agent）
 * - source + source_ref_id 定位"谁创建的、关联哪个业务实体"
 */
export interface Task {
  /** 主键 ID */
  id: number;
  /** 任务类型 */
  type: TaskType;
  /** 来源应用 */
  source: TaskSource;
  /**
   * 来源业务实体 ID（如 todo_item_id）
   * null 表示无关联业务实体（如全局任务）
   */
  source_ref_id: number | null;
  /** 任务标题（用于列表展示） */
  title: string;
  /** 任务状态 */
  status: TaskStatus;
  /** 进度（0-100） */
  progress: number;
  /** 错误信息（status=failed 时填充） */
  error_message: string | null;
  /** 创建时间（Unix ms） */
  created_at: number;
  /** 最后修改时间（Unix ms） */
  updated_at: number;
}

/**
 * Agent 任务特有字段（对应 task_agent 扩展表，通过 task_id 关联 Task）
 *
 * 一个 Agent 任务 = 一段 prompt + 一组 Agent/LLM 配置 + 一个独立对话历史
 */
export interface TaskAgent {
  /** 关联的 task.id（主键） */
  task_id: number;
  /**
   * 任务输入 prompt（由 source 模块组装后传入）
   * 例如 todo-app 会拼装 todo_item.title/description/task_prompt + 子 todo 文本
   */
  prompt: string;
  /** Agent 名称（创建任务时选择） */
  agent_name: string;
  /** LLM 配置名（创建任务时选择） */
  llm_config_name: string;
  /**
   * 对话历史 ID（关联 AiChatHistory，pending 时为 null）
   * agent_id 固定为 'task:agent:<task_id>'，与 AI 助手主历史隔离
   */
  chat_history_id: string | null;
  /**
   * 结果元数据（JSON 字符串，由 source result handler 写入）
   * 格式由 source 模块自定义，例如 todo-app 写入 { "summary_doc_id": 123 }
   */
  result_meta: string | null;
}

// ============================================================================
// 聚合视图（业务返回结构）
// ============================================================================

/**
 * Agent 任务结果元数据（result_meta 的解析结构）
 * 通用字段留空，具体含义由 source 模块定义
 */
export interface TaskAgentResultMeta {
  /** todo-app 写入：总结文档 ID */
  summary_doc_id?: number;
  /** source result handler 执行失败时记录的错误（不影响 task completed 状态） */
  handler_error?: string;
  /** 其他 source 的自定义字段 */
  [key: string]: unknown;
}

/**
 * Agent 任务完整视图（Task + TaskAgent 聚合，用于 IPC 返回）
 */
export interface TaskAgentView extends Task {
  prompt: string;
  agent_name: string;
  llm_config_name: string;
  chat_history_id: string | null;
  /** 已解析的结果元数据（DB 中存储为 JSON 字符串） */
  result_meta: TaskAgentResultMeta | null;
}

/**
 * 通用任务视图（联合类型，按 type 区分）
 * 当前仅 agent 类型有扩展视图，未来扩展 batch/tool_execution 时追加分支
 */
export type TaskView = TaskAgentView;

// ============================================================================
// 执行器接口
// ============================================================================

/**
 * 任务执行结果（传递给 source result handler）
 */
export interface TaskExecutionResult {
  /** 结果元数据（会被写入 task_agent.result_meta 等） */
  meta?: Record<string, unknown>;
  /** 原始输出（如对话全文，供 handler 进一步处理） */
  rawOutput?: unknown;
}

/**
 * 任务执行上下文（由 TaskManager 注入）
 *
 * Executor 通过 context：
 * - 推送任务事件（进度/日志/流式片段）
 * - 响应取消请求
 */
export interface TaskExecutionContext {
  /** 推送任务事件（进度/日志/流式片段） */
  emit(event: TaskEvent): void;
  /** 取消信号（被触发后应立即停止执行） */
  cancelToken: TaskCancelToken;
  /** 当前 task.id（便于日志） */
  readonly taskId: number;
}

/**
 * 任务取消信号
 *
 * 约定：
 * - cancelled=true 表示任务已被请求取消，executor 应尽快停止
 * - onCancel 注册的回调会在取消被触发时执行一次
 */
export interface TaskCancelToken {
  readonly cancelled: boolean;
  onCancel(cb: () => void): void;
}

/**
 * 任务执行器接口
 *
 * 每种 TaskType 对应一个 ITaskExecutor 实现，注册到 TaskManager。
 * Executor 负责：
 * - 实际执行任务（调用底层引擎，如 AiAgentService）
 * - 通过 context 回调推送事件、进度
 * - 响应取消请求
 *
 * 注意：Executor 不负责状态持久化（由 TaskManager 统一处理），
 *      只负责"执行 + 推事件 + 响应取消"。
 */
export interface ITaskExecutor<TView = unknown> {
  /** 该 executor 处理的任务类型 */
  readonly type: TaskType;

  /**
   * 执行任务
   *
   * @param taskView 任务完整视图（含类型特有字段）
   * @param context 执行上下文（事件回调 + 取消信号）
   * @returns 任务结果（供 source result handler 使用）
   *
   * 约定：
   * - 正常完成：resolve(result)
   * - 执行出错：reject(TaskExecutionError)
   * - 用户取消：reject(TaskCancelledError)
   * - Executor 必须在 context.cancelToken 被触发后尽快停止
   */
  execute(taskView: TView, context: TaskExecutionContext): Promise<TaskExecutionResult>;
}

// ============================================================================
// 任务事件
// ============================================================================

/**
 * 任务事件（统一 IPC 推送）
 *
 * - 通用事件：status_changed / progress / log / done / error
 * - Agent 透传事件：text_delta / tool_start / tool_result / thinking
 *   （由 AgentTaskExecutor 从 AiChatEvent 转换而来）
 */
export type TaskEvent =
  | { taskId: number; type: 'status_changed'; status: TaskStatus }
  | { taskId: number; type: 'progress'; progress: number }
  | { taskId: number; type: 'log'; message: string; level?: 'info' | 'warn' | 'error' }
  | { taskId: number; type: 'text_delta'; content: string }
  | { taskId: number; type: 'tool_start'; toolCallId: string; name: string; arguments: string }
  | { taskId: number; type: 'tool_result'; toolCallId: string; result: string; isError?: boolean }
  | { taskId: number; type: 'thinking'; content: string }
  | { taskId: number; type: 'done' }
  | { taskId: number; type: 'error'; message: string };

// ============================================================================
// Source 结果处理器
// ============================================================================

/**
 * 来源模块注册的结果处理器
 *
 * 任务完成后，TaskManager 按 `${source}:${type}` 查找 handler 并回调。
 * Source 模块在此实现业务侧结果回收，例如：
 * - todo-app: 读取对话 → LLM 生成总结 → 写入 todo_document → 回填 result_meta
 *
 * handler 失败不影响 task 的 completed 状态（task 已成功执行），
 * 但会将失败原因记入日志，并在 task_agent.result_meta 标记 { handler_error: ... }。
 *
 * 返回值会被合并写入对应扩展表的 result 字段。
 */
export type SourceResultHandler = (
  task: Task,
  executionResult: TaskExecutionResult,
) => Promise<Record<string, unknown> | void>;

// ============================================================================
// 创建入参
// ============================================================================

/**
 * Agent 任务创建入参（IPC: qtian:task:create-agent-task）
 */
export interface AgentTaskCreateInput {
  source: TaskSource;
  source_ref_id: number | null;
  title: string;
  prompt: string;
  agent_name: string;
  llm_config_name: string;
}

/**
 * 任务列表过滤条件（IPC: qtian:task:list）
 */
export interface TaskListFilter {
  type?: TaskType;
  source?: TaskSource;
  status?: TaskStatus;
  limit?: number;
  offset?: number;
}

// ============================================================================
// 异常类
// ============================================================================

/**
 * 任务执行错误（executor 执行过程中发生的业务/系统错误）
 *
 * Executor 应使用此异常 reject，TaskManager 会将 task 标记为 failed
 * 并填充 error_message。
 */
export class TaskExecutionError extends Error {
  /** 原始错误（可选，便于上游诊断） */
  readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'TaskExecutionError';
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, TaskExecutionError.prototype);
  }
}

/**
 * 任务取消异常（用户主动取消时 executor 抛出）
 *
 * TaskManager 据此将 task 标记为 cancelled（而非 failed）。
 */
export class TaskCancelledError extends Error {
  constructor(message: string = 'Task cancelled by user') {
    super(message);
    this.name = 'TaskCancelledError';
    Object.setPrototypeOf(this, TaskCancelledError.prototype);
  }
}

/**
 * 判断错误对象是否为任务取消异常
 */
export function isTaskCancelledError(err: unknown): err is TaskCancelledError {
  return err instanceof TaskCancelledError;
}
