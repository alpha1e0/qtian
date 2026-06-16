import * as fs from 'fs';
import * as path from 'path';

import { DBManager } from '@/core/database/db-manager';
import { createLogger } from '@/core/utils/logger';
import {
  AgentTaskCreateInput,
  Task,
  TaskAgentResultMeta,
  TaskAgentView,
  TaskListFilter,
  TaskSource,
  TaskStatus,
  TASK_TERMINAL_STATUSES,
  VALID_TASK_SOURCES,
  VALID_TASK_TYPES,
} from './task.types';

const logger = createLogger('TaskDb');

/** 任务异常退出时的兜底错误信息 */
const CRASH_RECOVERY_ERROR_MESSAGE = '应用异常退出，任务中断';

/** 任务列表默认分页大小 */
const DEFAULT_LIST_LIMIT = 100;
/** 任务列表最大分页大小 */
const MAX_LIST_LIMIT = 1000;

/**
 * 任务系统数据库封装
 *
 * 职责：
 * 1. 连接 workspace/task/task.db 并按 data/task.sql 建表
 * 2. 提供 task + task_agent 的 CRUD 与 JOIN 查询
 * 3. 提供状态/进度/历史 ID/结果元数据的定点更新
 * 4. 崩溃恢复：将 running 状态的任务收敛为 failed
 *
 * 不负责：执行器分发、事件广播、source handler 回调（这些在 TaskManager 中）
 */
export class TaskDb {
  private db: DBManager;
  private readonly dbPath: string;
  private readonly sqlFile: string;

  /**
   * @param dbPath - task.db 文件路径
   * @param sqlFile - data/task.sql 路径（建表脚本）
   */
  constructor(dbPath: string, sqlFile: string) {
    this.dbPath = dbPath;
    this.sqlFile = sqlFile;
    this.db = new DBManager(dbPath);
  }

  /**
   * 初始化：按 task.sql 建表
   *
   * 注意：崩溃恢复由 TaskManager 显式调用 recoverCrashedTasks()，
   *      不在此处自动执行，便于在日志/事件层面统一记录。
   */
  initialize(): void {
    this.ensureDir(path.dirname(this.dbPath));
    this.runSqlScript(this.sqlFile);
    logger.info(`TaskDb initialized at ${this.dbPath}`);
  }

  // =========================================================================
  // 创建
  // =========================================================================

  /**
   * 创建 Agent 任务（事务性插入 task + task_agent）
   *
   * better-sqlite3 操作同步执行，两条 INSERT 之间无异步窗口；
   * 若 task_agent 插入失败，回滚已插入的 task 主记录，避免产生孤儿 task。
   *
   * @param input - Agent 任务创建入参
   * @returns 新建的 TaskAgentView（含 task.id）
   */
  insertAgentTask(input: AgentTaskCreateInput): TaskAgentView {
    this.validateCreateInput(input);

    const now = Date.now();

    // 1. 插入 task 主表（status 默认 pending, progress 默认 0）
    const taskResult = this.db.insert(
      `INSERT INTO task (type, source, source_ref_id, title, status, progress, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'agent',
        input.source,
        input.source_ref_id,
        input.title,
        'pending',
        0,
        now,
        now,
      ],
    );
    const taskId = taskResult.lastRowid;

    // 2. 插入 task_agent 扩展表；失败则回滚 task 主记录
    try {
      this.db.insert(
        `INSERT INTO task_agent (task_id, prompt, agent_name, llm_config_name, chat_history_id, result_meta, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [taskId, input.prompt, input.agent_name, input.llm_config_name, null, null, now, now],
      );
    } catch (err) {
      logger.error(`Failed to insert task_agent for task ${taskId}, rolling back task`, err);
      this.db.execute('DELETE FROM task WHERE id = ?', [taskId]);
      throw err;
    }

    logger.info(`Agent task created: id=${taskId}, source=${input.source}, title='${input.title}'`);

    // 3. 返回聚合视图
    const view = this.getAgentTask(taskId);
    if (!view) {
      // 理论上不会发生（刚插入成功）
      throw new Error(`Failed to read back agent task ${taskId} after insert`);
    }
    return view;
  }

  // =========================================================================
  // 查询
  // =========================================================================

  /**
   * 获取 Agent 任务详情（task JOIN task_agent）
   * @param taskId - 任务 ID
   * @returns 聚合视图，不存在返回 undefined
   */
  getAgentTask(taskId: number): TaskAgentView | undefined {
    const row = this.db.get<TaskAgentRow>(
      `SELECT t.id, t.type, t.source, t.source_ref_id, t.title, t.status, t.progress,
              t.error_message, t.created_at, t.updated_at,
              ta.prompt, ta.agent_name, ta.llm_config_name, ta.chat_history_id, ta.result_meta
       FROM task t
       INNER JOIN task_agent ta ON t.id = ta.task_id
       WHERE t.id = ?`,
      [taskId],
    );
    return row ? this.mapAgentRowToView(row) : undefined;
  }

  /**
   * 获取 task 主表行（仅公共字段，用于判断 type/status）
   */
  getTaskRow(taskId: number): Task | undefined {
    const row = this.db.get<TaskRow>(
      `SELECT id, type, source, source_ref_id, title, status, progress, error_message, created_at, updated_at
       FROM task WHERE id = ?`,
      [taskId],
    );
    return row;
  }

  /**
   * 列出某来源（可指定来源业务实体）的任务
   */
  listBySource(source: TaskSource, sourceRefId?: number): TaskAgentView[] {
    this.validateSource(source);

    let sql = `SELECT t.id, t.type, t.source, t.source_ref_id, t.title, t.status, t.progress,
                      t.error_message, t.created_at, t.updated_at,
                      ta.prompt, ta.agent_name, ta.llm_config_name, ta.chat_history_id, ta.result_meta
               FROM task t
               INNER JOIN task_agent ta ON t.id = ta.task_id
               WHERE t.source = ?`;
    const params: Array<string | number> = [source];

    if (sourceRefId !== undefined) {
      sql += ' AND t.source_ref_id = ?';
      params.push(sourceRefId);
    }
    sql += ' ORDER BY t.created_at DESC';

    const rows = this.db.query<TaskAgentRow>(sql, params);
    return rows.map((r) => this.mapAgentRowToView(r));
  }

  /**
   * 全局任务列表（任务中心用），支持类型/来源/状态筛选与分页
   */
  listTasks(filter?: TaskListFilter): TaskAgentView[] {
    let sql = `SELECT t.id, t.type, t.source, t.source_ref_id, t.title, t.status, t.progress,
                      t.error_message, t.created_at, t.updated_at,
                      ta.prompt, ta.agent_name, ta.llm_config_name, ta.chat_history_id, ta.result_meta
               FROM task t
               INNER JOIN task_agent ta ON t.id = ta.task_id`;
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filter?.type) {
      this.validateType(filter.type);
      conditions.push('t.type = ?');
      params.push(filter.type);
    }
    if (filter?.source) {
      this.validateSource(filter.source);
      conditions.push('t.source = ?');
      params.push(filter.source);
    }
    if (filter?.status) {
      conditions.push('t.status = ?');
      params.push(filter.status);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY t.created_at DESC';

    const limit = Math.min(Math.max(filter?.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
    const offset = Math.max(filter?.offset ?? 0, 0);
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.query<TaskAgentRow>(sql, params);
    return rows.map((r) => this.mapAgentRowToView(r));
  }

  // =========================================================================
  // 更新（定点字段，避免全字段覆盖的并发风险）
  // =========================================================================

  /**
   * 更新任务状态（同步更新 updated_at）
   * @param taskId - 任务 ID
   * @param status - 新状态
   * @param errorMessage - 错误信息（仅 failed 时有意义，其他状态置 null）
   */
  updateStatus(taskId: number, status: TaskStatus, errorMessage?: string | null): void {
    const now = Date.now();
    // 非 failed 状态清空 error_message，避免残留
    const msg = status === 'failed' ? (errorMessage ?? null) : null;
    const changes = this.db.execute(
      `UPDATE task SET status = ?, error_message = ?, updated_at = ? WHERE id = ?`,
      [status, msg, now, taskId],
    );
    if (changes === 0) {
      logger.warn(`updateStatus: task ${taskId} not found`);
    }
  }

  /**
   * 更新进度（带范围校验）
   */
  updateProgress(taskId: number, progress: number): void {
    const clamped = Math.min(Math.max(Math.trunc(progress), 0), 100);
    const now = Date.now();
    const changes = this.db.execute(
      `UPDATE task SET progress = ?, updated_at = ? WHERE id = ?`,
      [clamped, now, taskId],
    );
    if (changes === 0) {
      logger.warn(`updateProgress: task ${taskId} not found`);
    }
  }

  /**
   * 更新 Agent 任务的对话历史 ID（任务开始执行时写入）
   */
  updateChatHistoryId(taskId: number, chatHistoryId: string): void {
    const now = Date.now();
    const changes = this.db.execute(
      `UPDATE task_agent SET chat_history_id = ?, updated_at = ? WHERE task_id = ?`,
      [chatHistoryId, now, taskId],
    );
    if (changes === 0) {
      logger.warn(`updateChatHistoryId: task_agent ${taskId} not found`);
    }
  }

  /**
   * 更新 Agent 任务的结果元数据（合并写入 task_agent.result_meta）
   *
   * @param taskId - 任务 ID
   * @param metaPatch - 要合并的元数据片段；传 null 表示清空
   */
  updateResultMeta(taskId: number, metaPatch: Record<string, unknown> | null): void {
    const existing = this.db.get<{ result_meta: string | null }>(
      'SELECT result_meta FROM task_agent WHERE task_id = ?',
      [taskId],
    );

    let newMeta: Record<string, unknown> | null;
    if (metaPatch === null) {
      newMeta = null;
    } else if (existing?.result_meta) {
      const parsed = this.safeParseMeta(existing.result_meta);
      newMeta = { ...parsed, ...metaPatch };
    } else {
      newMeta = { ...metaPatch };
    }

    const now = Date.now();
    const metaStr = newMeta === null ? null : JSON.stringify(newMeta);
    const changes = this.db.execute(
      `UPDATE task_agent SET result_meta = ?, updated_at = ? WHERE task_id = ?`,
      [metaStr, now, taskId],
    );
    if (changes === 0) {
      logger.warn(`updateResultMeta: task_agent ${taskId} not found`);
    }
  }

  // =========================================================================
  // 崩溃恢复
  // =========================================================================

  /**
   * 崩溃恢复：将所有 running 状态的任务标记为 failed
   *
   * 内存执行态在进程退出时已丢失，无法恢复 Agent 对话上下文，
   * 因此统一收敛为 failed。返回受影响的任务数量。
   */
  recoverCrashedTasks(): number {
    const now = Date.now();
    const changes = this.db.execute(
      `UPDATE task
       SET status = 'failed',
           error_message = COALESCE(error_message, ?),
           updated_at = ?
       WHERE status = 'running'`,
      [CRASH_RECOVERY_ERROR_MESSAGE, now],
    );
    if (changes > 0) {
      logger.info(`Crash recovery: ${changes} running task(s) marked as failed`);
    }
    return changes;
  }

  // =========================================================================
  // 删除（管理/清理用，当前 IPC 未暴露）
  // =========================================================================

  /**
   * 删除任务（task_agent 因外键级联一并删除）
   * @returns 是否删除成功
   */
  deleteTask(taskId: number): boolean {
    const changes = this.db.execute('DELETE FROM task WHERE id = ?', [taskId]);
    return changes > 0;
  }

  // =========================================================================
  // 生命周期
  // =========================================================================

  /** 关闭数据库连接 */
  close(): void {
    this.db.close();
    logger.info('TaskDb closed');
  }

  // =========================================================================
  // 内部工具
  // =========================================================================

  /** 是否为终态（外部判断便捷入口） */
  isTerminalStatus(status: TaskStatus): boolean {
    return TASK_TERMINAL_STATUSES.has(status);
  }

  /** 确保 DB 文件所在目录存在 */
  private ensureDir(dir: string): void {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (err) {
      logger.error(`Failed to ensure task dir ${dir}`, err);
      throw err;
    }
  }

  /** 执行 SQL 建表脚本（按 ';' 拆分语句） */
  private runSqlScript(sqlFile: string): void {
    let script: string;
    try {
      script = fs.readFileSync(sqlFile, 'utf-8');
    } catch (err) {
      throw new Error(`Cannot read task SQL file '${sqlFile}': ${err}`);
    }

    // PRAGMA 与 CREATE 均为幂等（IF NOT EXISTS），重复执行安全
    const statements = script.split(';');
    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (trimmed.length > 0) {
        this.db.execute(trimmed);
      }
    }
  }

  /** 将 task + task_agent JOIN 行映射为 TaskAgentView */
  private mapAgentRowToView(row: TaskAgentRow): TaskAgentView {
    return {
      id: row.id,
      type: row.type,
      source: row.source,
      source_ref_id: row.source_ref_id,
      title: row.title,
      status: row.status,
      progress: row.progress,
      error_message: row.error_message,
      created_at: row.created_at,
      updated_at: row.updated_at,
      prompt: row.prompt,
      agent_name: row.agent_name,
      llm_config_name: row.llm_config_name,
      chat_history_id: row.chat_history_id,
      result_meta: this.safeParseMeta(row.result_meta),
    };
  }

  /** 安全解析 result_meta JSON 字符串 */
  private safeParseMeta(raw: string | null): TaskAgentResultMeta | null {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TaskAgentResultMeta;
    } catch (err) {
      logger.warn(`Failed to parse result_meta, treating as null: ${raw}`, err);
      return null;
    }
  }

  /** 校验 Agent 任务创建入参 */
  private validateCreateInput(input: AgentTaskCreateInput): void {
    if (!input.title || input.title.trim().length === 0) {
      throw new Error('Task title cannot be empty');
    }
    if (!input.prompt || input.prompt.trim().length === 0) {
      throw new Error('Task prompt cannot be empty');
    }
    if (!input.agent_name || input.agent_name.trim().length === 0) {
      throw new Error('Agent name cannot be empty');
    }
    if (!input.llm_config_name || input.llm_config_name.trim().length === 0) {
      throw new Error('LLM config name cannot be empty');
    }
    this.validateSource(input.source);
  }

  private validateSource(source: string): asserts source is TaskSource {
    if (!VALID_TASK_SOURCES.has(source as TaskSource)) {
      throw new Error(`Invalid task source: ${source}`);
    }
  }

  private validateType(type: string): asserts type is Task['type'] {
    if (!VALID_TASK_TYPES.has(type as Task['type'])) {
      throw new Error(`Invalid task type: ${type}`);
    }
  }
}

// ============================================================================
// DB 行类型（snake_case，对应数据库列）
// ============================================================================

interface TaskRow {
  id: number;
  type: Task['type'];
  source: TaskSource;
  source_ref_id: number | null;
  title: string;
  status: TaskStatus;
  progress: number;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

interface TaskAgentRow extends TaskRow {
  prompt: string;
  agent_name: string;
  llm_config_name: string;
  chat_history_id: string | null;
  result_meta: string | null;
}
