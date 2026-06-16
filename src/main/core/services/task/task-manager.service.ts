import { createLogger } from '@/core/utils/logger';
import { TaskEventBroadcaster } from './task-event-broadcaster';
import { TaskDb } from './task-db';
import {
  AgentTaskCreateInput,
  ITaskExecutor,
  SourceResultHandler,
  Task,
  TaskAgentView,
  TaskCancelledError,
  TaskExecutionContext,
  TaskExecutionResult,
  TaskExecutionError,
  TaskEvent,
  TaskListFilter,
  TaskSource,
  TaskStatus,
  TaskType,
  isTaskCancelledError,
} from './task.types';

const logger = createLogger('TaskManager');

/** source handler 注册表 key：`${source}:${type}` */
type HandlerKey = string;

/** 运行态条目 */
interface RunningEntry {
  token: SimpleCancelToken;
  promise: Promise<void>;
}

/**
 * 简易取消令牌实现
 *
 * - cancel() 触发所有 onCancel 回调
 * - onCancel 在已取消状态下立即执行（覆盖"取消发生在注册之前"的边界场景）
 */
class SimpleCancelToken {
  private _cancelled = false;
  private callbacks: Array<() => void> = [];

  get cancelled(): boolean {
    return this._cancelled;
  }

  onCancel(cb: () => void): void {
    this.callbacks.push(cb);
    if (this._cancelled) cb();
  }

  cancel(): void {
    if (this._cancelled) return;
    this._cancelled = true;
    for (const cb of this.callbacks) {
      try {
        cb();
      } catch (err) {
        logger.error('Cancel callback throwed', err);
      }
    }
  }
}

/**
 * 任务管理器（公共基础设施核心）
 *
 * 职责：
 * 1. 任务 CRUD（createAgentTask / getTask / listBySource / listTasks）
 * 2. 生命周期状态机（run / cancel）
 * 3. 执行器与 source handler 的注册表
 * 4. 运行态 Map（含取消令牌）与崩溃恢复
 * 5. 通过 TaskEventBroadcaster 推送任务事件
 *
 * 设计要点：
 * - run() 为"启动即返回"：异步执行任务，通过事件广播反馈进度/结果
 * - 重复运行拒绝：仅 pending 状态可 run；终态/running 均拒绝
 * - source handler 失败不影响 task 的 completed 状态，仅在 result_meta 标记 handler_error
 */
export class TaskManager {
  private readonly db: TaskDb;
  private readonly broadcaster: TaskEventBroadcaster;
  /** type → executor */
  private readonly executors: Map<TaskType, ITaskExecutor> = new Map();
  /** `${source}:${type}` → handler */
  private readonly sourceHandlers: Map<HandlerKey, SourceResultHandler> = new Map();
  /** taskId → 运行态条目 */
  private readonly runningMap: Map<number, RunningEntry> = new Map();

  constructor(db: TaskDb, broadcaster: TaskEventBroadcaster) {
    this.db = db;
    this.broadcaster = broadcaster;
  }

  // =========================================================================
  // 初始化与崩溃恢复
  // =========================================================================

  /**
   * 初始化：建表 + 崩溃恢复
   *
   * 崩溃恢复将上次未完成的 running 任务收敛为 failed（内存执行态已丢失）。
   */
  initialize(): void {
    this.db.initialize();
    const recovered = this.db.recoverCrashedTasks();
    logger.info(`TaskManager initialized (crash recovered: ${recovered})`);
  }

  // =========================================================================
  // 执行器 / source handler 注册
  // =========================================================================

  /**
   * 注册任务执行器
   * @param executor - 执行器实例
   */
  registerExecutor(executor: ITaskExecutor): void {
    if (this.executors.has(executor.type)) {
      logger.warn(`Executor for type '${executor.type}' already registered, overwriting`);
    }
    this.executors.set(executor.type, executor);
    logger.info(`Executor registered: ${executor.type}`);
  }

  /**
   * 注册 source 结果处理器
   * @param source - 来源应用
   * @param type - 任务类型
   * @param handler - 结果处理回调
   */
  registerSourceHandler(source: TaskSource, type: TaskType, handler: SourceResultHandler): void {
    const key = this.handlerKey(source, type);
    this.sourceHandlers.set(key, handler);
    logger.info(`Source handler registered: ${key}`);
  }

  // =========================================================================
  // CRUD
  // =========================================================================

  /**
   * 创建 Agent 任务（status=pending）
   * @returns 新建任务视图
   */
  createAgentTask(input: AgentTaskCreateInput): TaskAgentView {
    return this.db.insertAgentTask(input);
  }

  /**
   * 获取任务详情
   * @param taskId - 任务 ID
   * @returns 任务视图（不存在返回 undefined）
   */
  getTask(taskId: number): TaskAgentView | undefined {
    return this.db.getAgentTask(taskId);
  }

  /**
   * 按来源列出任务
   */
  listBySource(source: TaskSource, sourceRefId?: number): TaskAgentView[] {
    return this.db.listBySource(source, sourceRefId);
  }

  /**
   * 全局任务列表（任务中心用）
   */
  listTasks(filter?: TaskListFilter): TaskAgentView[] {
    return this.db.listTasks(filter);
  }

  // =========================================================================
  // 生命周期
  // =========================================================================

  /**
   * 启动任务执行（异步，立即返回）
   *
   * @param taskId - 任务 ID
   * @returns 启动后的任务视图（status=running）
   * @throws 任务不存在 / 非 pending 状态 / 无对应执行器
   */
  run(taskId: number): TaskAgentView {
    const view = this.db.getAgentTask(taskId);
    if (!view) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (view.status !== 'pending') {
      throw new Error(`Task ${taskId} cannot run: current status is '${view.status}', only 'pending' allowed`);
    }

    const executor = this.executors.get(view.type);
    if (!executor) {
      throw new Error(`No executor registered for task type '${view.type}'`);
    }

    // 状态流转：pending → running
    this.db.updateStatus(taskId, 'running');
    this.broadcast({ taskId, type: 'status_changed', status: 'running' });
    logger.info(`Task ${taskId} running (type=${view.type}, source=${view.source})`);

    // 构造执行上下文
    const token = new SimpleCancelToken();
    const context: TaskExecutionContext = {
      taskId,
      cancelToken: token,
      emit: (event) => this.handleExecutorEvent(event),
    };

    // 启动异步执行（fire-and-forget），错误在 executeTask 内统一处理
    const promise = this.executeTask(view, context, executor);
    this.runningMap.set(taskId, { token, promise });

    return this.db.getAgentTask(taskId)!;
  }

  /**
   * 取消任务
   *
   * - running：触发取消令牌，执行器抛出 TaskCancelledError → 状态转 cancelled
   * - pending：直接置为 cancelled（尚未启动）
   * - 终态：拒绝（幂等性由调用方判断）
   *
   * @param taskId - 任务 ID
   * @returns 是否成功发起取消
   */
  cancel(taskId: number): boolean {
    const entry = this.runningMap.get(taskId);
    if (entry) {
      entry.token.cancel();
      logger.info(`Task ${taskId} cancel requested (running)`);
      return true;
    }

    // pending 状态直接置为 cancelled
    const row = this.db.getTaskRow(taskId);
    if (!row) {
      throw new Error(`Task ${taskId} not found`);
    }
    if (row.status === 'pending') {
      this.db.updateStatus(taskId, 'cancelled');
      this.broadcast({ taskId, type: 'status_changed', status: 'cancelled' });
      this.broadcast({ taskId, type: 'done' });
      logger.info(`Task ${taskId} cancelled (pending)`);
      return true;
    }

    // 终态：不可取消
    logger.warn(`Task ${taskId} cannot cancel: status is '${row.status}'`);
    return false;
  }

  /**
   * 等待任务执行完成（主要用于测试/同步场景）
   */
  async waitForTask(taskId: number): Promise<void> {
    const entry = this.runningMap.get(taskId);
    if (entry) {
      await entry.promise;
    }
  }

  /** 当前运行中的任务数量 */
  getRunningCount(): number {
    return this.runningMap.size;
  }

  // =========================================================================
  // 内部：执行与收尾
  // =========================================================================

  /**
   * 执行任务并处理终态（成功/取消/失败）
   */
  private async executeTask(
    view: TaskAgentView,
    context: TaskExecutionContext,
    executor: ITaskExecutor,
  ): Promise<void> {
    const { taskId } = context;
    try {
      const result = await executor.execute(view, context);
      await this.handleSuccess(view, result);
    } catch (err) {
      if (isTaskCancelledError(err)) {
        this.handleCancelled(taskId);
      } else {
        this.handleFailed(taskId, err);
      }
    } finally {
      this.runningMap.delete(taskId);
    }
  }

  /**
   * 成功收尾：调用 source handler → 持久化结果 → 置 completed
   *
   * source handler 失败不影响 completed 状态，仅在 result_meta 标记 handler_error。
   */
  private async handleSuccess(view: TaskAgentView, result: TaskExecutionResult): Promise<void> {
    const { id: taskId } = view;
    const meta: Record<string, unknown> = { ...(result.meta ?? {}) };

    // 1. 调用 source handler（失败不阻断）
    const handler = this.sourceHandlers.get(this.handlerKey(view.source, view.type));
    if (handler) {
      try {
        const handlerMeta = await handler(view as Task, result);
        if (handlerMeta) {
          Object.assign(meta, handlerMeta);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        meta.handler_error = msg;
        logger.error(`Source handler failed for task ${taskId}: ${msg}`, err);
      }
    }

    // 2. 持久化 chat_history_id 与 result_meta
    if (typeof meta.chat_history_id === 'string') {
      this.db.updateChatHistoryId(taskId, meta.chat_history_id);
    }
    this.db.updateResultMeta(taskId, meta);

    // 3. 终态：completed
    this.db.updateProgress(taskId, 100);
    this.db.updateStatus(taskId, 'completed');
    this.broadcast({ taskId, type: 'status_changed', status: 'completed' });
    this.broadcast({ taskId, type: 'done' });
    logger.info(`Task ${taskId} completed`);
  }

  /** 取消收尾 */
  private handleCancelled(taskId: number): void {
    this.db.updateStatus(taskId, 'cancelled');
    this.broadcast({ taskId, type: 'status_changed', status: 'cancelled' });
    this.broadcast({ taskId, type: 'done' });
    logger.info(`Task ${taskId} cancelled`);
  }

  /** 失败收尾 */
  private handleFailed(taskId: number, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.db.updateStatus(taskId, 'failed', msg);
    this.broadcast({ taskId, type: 'error', message: msg });
    this.broadcast({ taskId, type: 'status_changed', status: 'failed' });
    logger.error(`Task ${taskId} failed: ${msg}`, err);
  }

  /**
   * 处理 executor 推送的事件
   * - progress 事件：同步进度到 DB
   * - 其余事件：直接广播
   */
  private handleExecutorEvent(event: TaskEvent): void {
    if (event.type === 'progress') {
      this.db.updateProgress(event.taskId, event.progress);
    }
    this.broadcast(event);
  }

  /** 广播事件 */
  private broadcast(event: TaskEvent): void {
    this.broadcaster.broadcast(event);
  }

  /** source handler key */
  private handlerKey(source: TaskSource, type: TaskType): HandlerKey {
    return `${source}:${type}`;
  }
}
