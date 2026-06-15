# 007 任务系统（task） — 设计文档

> **状态**：初版设计，待评审。
>
> **背景**：原 `100_todo-app-design.md` 中的 `TodoAgentTask` 是 todo_item 驱动的 Agent 任务。后续 doc-app 等扩展应用也会有 Agent 任务需求，甚至出现批处理、特殊工具执行等非 Agent 任务。为避免每个应用各自实现一套任务管理逻辑，将"任务"抽象为**公共基础设施**，由统一的 **TaskManager** 管理生命周期，Agent 任务只是其中一种 **TaskType**。

## 1 需求分析 & 关键决策

| 决策项 | 结论 | 理由 |
| :--- | :--- | :--- |
| 抽象层次 | **Task** 为基础实体，`type` 区分种类（agent/batch/tool_execution…） | 不同任务公共属性稳定（状态/进度/来源），差异在执行逻辑与输入输出 |
| 执行模型 | **ITaskExecutor** 接口 + 按 type 注册到 TaskManager | 新增任务类型只需新增 Executor，不改 Manager；开闭原则 |
| 结果回收 | **Source Result Handler**（策略模式）：由"来源模块"注册完成回调 | 总结文档、进度回写等是业务逻辑，不应耦合到通用框架 |
| 数据库 | **独立 `workspace/task/task.db`**；`task` 主表 + 类型扩展表 | 任务系统是公共基础设施，不归属任何 app_module；主表+扩展表符合项目规范（显式字段、可约束） |
| 表结构 | **基础表 `task`（公共字段）+ `task_agent`（Agent 扩展字段）** | 避免 JSON 字段（项目现有 DBManager 风格均为显式列）；扩展表随类型演进 |
| 历史隔离 | Agent 任务对话 `agent_id = 'task:agent:<taskId>'` | 完全隔离任务对话与 AI 助手主历史，无需改动 `AiChatHistory` 结构 |
| 运行态管理 | TaskManager 内存维护 `Map<taskId, RunningTask>`；DB 持久化状态 | 取消/进度查询走内存；崩溃恢复靠 DB 扫描 |
| 崩溃恢复 | 启动时扫描 `status='running'` 的任务，标记为 `failed` | 内存执行态不可恢复，必须收敛状态 |
| IPC 命名 | 通用 `qtian:task:*` + 应用层业务封装（如 `qtian:todo:create-task-from-item`） | 通用操作（查询/取消）走 task 通道；业务组装（prompt 拼装）保留在应用通道 |
| 事件推送 | 统一 `qtian:task:event` 通道，payload 携带 `taskId` | 前端按 `taskId` 过滤；Agent 事件透传 `AiChatEvent` |
| 任务并发 | 同一 task 同一时刻只允许一个运行实例 | 避免重复执行、资源竞争 |
| 不做的事 | 任务编排/依赖图、定时调度、分布式执行 | 当前无需求；保持简单，后续按需扩展 |

## 2 总体架构

### 2.1 架构分层

```
┌─────────────────────────────────────────────────────────────┐
│                      渲染进程 (Renderer)                      │
│   各应用 UI（todo-app / doc-app / …）   通用任务面板          │
│         │                                  │                 │
│         ▼                                  ▼                 │
│   qtian:todo:create-task-from-item   qtian:task:*            │
└─────────┬──────────────────────────────────┬────────────────┘
          │ IPC                              │
┌─────────▼──────────────────────────────────▼────────────────┐
│                       主进程 (Main)                          │
│  ┌──────────────────┐        ┌───────────────────────────┐  │
│  │  todo-app 等模块  │        │      TaskManager           │  │
│  │  (Source 模块)    │        │  - create / run / cancel   │  │
│  │                   │        │  - 状态/进度查询            │  │
│  │  注册:            │ ─────► │  - 执行器注册表            │  │
│  │  · prompt 组装    │        │  - source result handler   │  │
│  │  · result handler │        │  - 运行态实例 Map           │  │
│  └──────────────────┘        └───────────┬───────────────┘  │
│                                          │ 按类型分发         │
│                        ┌─────────────────┼────────────────┐ │
│                        ▼                 ▼                ▼ │
│               AgentTaskExecutor   (未来 Batch…)  (未来 Tool…)│
│                        │                                    │
│                        ▼                                    │
│               AiAgentService / AiHistoryService             │
│               (复用现有 streaming tool-use loop)              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心概念

| 概念 | 说明 |
| :--- | :--- |
| **Task** | 任务基础实体，承载公共字段（id/type/source/status/progress…） |
| **TaskType** | 任务类型枚举：`'agent'` / `'batch'` / `'tool_execution'` / … |
| **TaskSource** | 任务来源（哪个应用创建）：`'todo-app'` / `'doc-app'` / `'unknown'` |
| **ITaskExecutor** | 任务执行器接口，每种 type 一个实现；负责实际执行与取消 |
| **TaskManager** | 任务管理器（单例）；负责任务 CRUD、生命周期、执行器/handler 注册 |
| **SourceResultHandler** | 来源模块注册的"任务完成回调"；负责业务侧结果回收（如生成总结文档） |
| **TaskEvent** | 任务事件（进度/日志/Agent 流式片段）；通过统一 IPC 通道推送前端 |

## 3 完整类型定义

> 所有类型集中定义在 `src/main/core/services/task/task.types.ts`，渲染进程通过 `@shared/types` 共享。

### 3.1 Task（基础实体）

```typescript
/**
 * 任务类型枚举
 * - agent: 由 AI Agent 执行的对话型任务
 * - batch: 批处理任务（预留）
 * - tool_execution: 特殊工具执行任务（预留）
 */
type TaskType = 'agent' | 'batch' | 'tool_execution';

/**
 * 任务来源（哪个应用创建）
 * 用于结果回调分发与历史查询过滤
 */
type TaskSource = 'todo-app' | 'doc-app' | 'unknown';

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
type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * 任务基础实体（对应 task 主表）
 *
 * 设计原则：
 * - 仅承载所有任务类型共有的字段
 * - 类型特有字段（如 agent_name/prompt）放在扩展表（如 task_agent）
 * - source + source_ref_id 定位"谁创建的、关联哪个业务实体"
 */
interface Task {
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
```

### 3.2 TaskAgent（Agent 任务扩展）

```typescript
/**
 * Agent 任务特有字段（对应 task_agent 扩展表，通过 task_id 关联 Task）
 *
 * 一个 Agent 任务 = 一段 prompt + 一组 Agent/LLM 配置 + 一个独立对话历史
 */
interface TaskAgent {
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
```

### 3.3 聚合视图（业务返回结构）

```typescript
/**
 * Agent 任务完整视图（Task + TaskAgent 聚合，用于 IPC 返回）
 */
interface TaskAgentView extends Task {
  prompt: string;
  agent_name: string;
  llm_config_name: string;
  chat_history_id: string | null;
  result_meta: TaskAgentResultMeta | null;
}

/**
 * Agent 任务结果元数据（result_meta 的解析结构）
 * 通用字段留空，具体含义由 source 模块定义
 */
interface TaskAgentResultMeta {
  /** todo-app 写入：总结文档 ID */
  summary_doc_id?: number;
  /** 其他 source 的自定义字段 */
  [key: string]: unknown;
}
```

### 3.4 ITaskExecutor（执行器接口）

```typescript
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
interface ITaskExecutor<TView = unknown> {
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
   * - 用户取消：reject(CancelledError)
   * - Executor 必须在 context.cancelToken 被触发后尽快停止
   */
  execute(taskView: TView, context: TaskExecutionContext): Promise<TaskExecutionResult>;
}

/**
 * 任务执行上下文（由 TaskManager 注入）
 */
interface TaskExecutionContext {
  /** 推送任务事件（进度/日志/流式片段） */
  emit(event: TaskEvent): void;
  /** 取消信号（被触发后应立即停止执行） */
  cancelToken: { readonly cancelled: boolean; onCancel(cb: () => void): void };
  /** 当前 task.id（便于日志） */
  readonly taskId: number;
}

/**
 * 任务执行结果（传递给 source result handler）
 */
interface TaskExecutionResult {
  /** 结果元数据（会被写入 task_agent.result_meta 等） */
  meta?: Record<string, unknown>;
  /** 原始输出（如对话全文，供 handler 进一步处理） */
  rawOutput?: unknown;
}

/**
 * 任务事件（统一 IPC 推送）
 *
 * - 通用事件：status_changed / progress / log / done / error
 * - Agent 透传事件：text_delta / tool_start / tool_result / thinking
 *   （由 AgentTaskExecutor 从 AiChatEvent 转换而来）
 */
type TaskEvent =
  | { taskId: number; type: 'status_changed'; status: TaskStatus }
  | { taskId: number; type: 'progress'; progress: number }
  | { taskId: number; type: 'log'; message: string; level?: 'info' | 'warn' | 'error' }
  | { taskId: number; type: 'text_delta'; content: string }
  | { taskId: number; type: 'tool_start'; toolCallId: string; name: string; arguments: string }
  | { taskId: number; type: 'tool_result'; toolCallId: string; result: string; isError?: boolean }
  | { taskId: number; type: 'thinking'; content: string }
  | { taskId: number; type: 'done' }
  | { taskId: number; type: 'error'; message: string };
```

### 3.5 SourceResultHandler（结果处理器）

```typescript
/**
 * 来源模块注册的结果处理器
 *
 * 任务完成后，TaskManager 按 `${source}:${type}` 查找 handler 并回调。
 * Source 模块在此实现业务侧结果回收，例如：
 * - todo-app: 读取对话 → LLM 生成总结 → 写入 todo_document → 回填 result_meta
 *
 * handler 失败不影响 task 的 completed 状态（task 已成功执行），
 * 但会将失败原因记入日志，并在 task_agent.result_meta 标记 { handler_error: ... }。
 */
type SourceResultHandler = (
  task: Task,
  executionResult: TaskExecutionResult
) => Promise<Record<string, unknown> | void>;
// 返回值会被合并写入对应扩展表的 result 字段
```

## 4 数据库设计

### 4.1 数据库归属

**独立数据库**：`workspace/task/task.db`

理由：
- 任务系统是公共基础设施，服务所有应用模块，不归属任何单一 app_module
- 与 todo.db / 未来的 doc.db 解耦，避免跨库 JOIN 与数据迁移
- FTS 等特性不影响任务库（任务库不需要全文搜索）

`WPath` 新增：
- `taskDir` = `{workspace}/task/`
- `taskDbPath` = `{workspace}/task/task.db`

### 4.2 表结构 (`data/task.sql`)

```sql
-- Qtian Task System Schema
-- 数据库文件: workspace/task/task.db
-- 任务系统为公共基础设施，不参与软删除（任务历史全量保留）

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================================
-- task 主表（所有任务类型的公共字段）
-- ============================================================
CREATE TABLE IF NOT EXISTS task (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  type           TEXT NOT NULL,          -- 'agent' | 'batch' | 'tool_execution'
  source         TEXT NOT NULL,          -- 'todo-app' | 'doc-app' | 'unknown'
  source_ref_id  INTEGER,                -- 来源业务实体 ID（如 todo_item_id）
  title          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  progress       INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error_message  TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  CHECK (type   IN ('agent', 'batch', 'tool_execution')),
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_task_source ON task(source, source_ref_id);
CREATE INDEX IF NOT EXISTS idx_task_status ON task(status);
CREATE INDEX IF NOT EXISTS idx_task_type   ON task(type);

-- ============================================================
-- task_agent 扩展表（Agent 任务特有字段）
-- 一对一关联 task，task 删除时级联删除
-- ============================================================
CREATE TABLE IF NOT EXISTS task_agent (
  task_id          INTEGER PRIMARY KEY,
  prompt           TEXT NOT NULL,
  agent_name       TEXT NOT NULL,
  llm_config_name  TEXT NOT NULL,
  chat_history_id  TEXT,                 -- agent_id 固定为 'task:agent:<task_id>'
  result_meta      TEXT,                 -- JSON 字符串，由 source result handler 写入
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES task(id) ON DELETE CASCADE
);

-- ============================================================
-- 未来扩展表（预留，当前不创建）
-- ============================================================
-- CREATE TABLE IF NOT EXISTS task_batch (...)      -- 批处理任务
-- CREATE TABLE IF NOT EXISTS task_tool_exec (...)   -- 工具执行任务
```

### 4.3 崩溃恢复策略

应用启动时，`TaskManager.initialize()` 执行：

```sql
-- 将所有 running 状态的任务标记为 failed（内存执行态已丢失）
UPDATE task
SET status = 'failed',
    error_message = COALESCE(error_message, '应用异常退出，任务中断'),
    updated_at = ?
WHERE status = 'running';
```

不尝试恢复执行（Agent 对话上下文已丢失，恢复无意义）。

### 4.4 查询模式

| 场景 | SQL |
| :--- | :--- |
| 查某来源的所有任务 | `SELECT * FROM task WHERE source=? AND source_ref_id=? ORDER BY created_at DESC` |
| Agent 任务详情 | `task JOIN task_agent ON task.id=task_agent.task_id` |
| 全局任务列表（任务中心） | `SELECT * FROM task ORDER BY created_at DESC LIMIT ? OFFSET ?` |

## 5 TaskManager 设计

### 5.1 核心接口

```typescript
/**
 * 任务管理器（单例，应用启动时初始化）
 *
 * 职责：
 * 1. 任务 CRUD（持久化到 task.db）
 * 2. 任务生命周期驱动（run / cancel / 状态流转）
 * 3. 执行器注册表（按 TaskType 分发）
 * 4. Source result handler 注册表
 * 5. 运行态任务实例管理（内存 Map + 取消信号）
 * 6. 崩溃恢复（启动时收敛 running → failed）
 * 7. 事件推送（通过 IPC 广播 TaskEvent）
 */
class TaskManager {
  /**
   * 初始化：连接 task.db、建表、执行崩溃恢复
   * 必须在 registerAllHandlers 之前调用
   */
  initialize(): void;

  // ===== 执行器 / handler 注册 =====

  /** 注册任务执行器（按 type） */
  registerExecutor(executor: ITaskExecutor): void;

  /**
   * 注册 source result handler
   * @param source 来源应用
   * @param type 任务类型（不同类型可有不同 handler）
   */
  registerSourceResultHandler(source: TaskSource, type: TaskType, handler: SourceResultHandler): void;

  // ===== 任务创建 =====

  /**
   * 创建 Agent 任务（便捷方法，内部走通用 createTask）
   * @returns 新建的 TaskAgentView（含 task.id）
   */
  createAgentTask(input: {
    source: TaskSource;
    source_ref_id: number | null;
    title: string;
    prompt: string;
    agent_name: string;
    llm_config_name: string;
  }): TaskAgentView;

  /**
   * 通用任务创建（供未来扩展类型使用）
   * @param type 任务类型
   * @param input 基础字段 + 类型特有 payload
   */
  createTask(type: TaskType, input: TaskCreateInput): TaskView;

  // ===== 生命周期 =====

  /**
   * 运行任务（异步，不阻塞调用方）
   * - 校验 executor 是否已注册
   * - 校验任务是否已在运行（拒绝重复运行）
   * - 写入 status=running，注入执行上下文，调用 executor.execute
   * - 完成后：写 status=completed → 查找 source result handler → 回调
   * @throws Error("任务正在运行") / Error("未注册 executor")
   */
  runTask(taskId: number): void;

  /** 取消任务（调用 executor 的取消逻辑 + status=cancelled） */
  cancelTask(taskId: number): void;

  // ===== 查询 =====

  /** 获取任务详情（自动 JOIN 对应扩展表） */
  getTask(taskId: number): TaskView | undefined;
  /** 列出某来源的任务 */
  listBySource(source: TaskSource, sourceRefId?: number): TaskView[];
  /** 全局任务列表（任务中心用） */
  listTasks(filter?: { type?: TaskType; status?: TaskStatus; limit?: number; offset?: number }): TaskView[];

  // ===== 内部回调（供 executor 使用） =====

  /** 更新进度（由 executor 通过 context.emit 触发，Manager 统一持久化） */
  private updateProgress(taskId: number, progress: number): void;
  /** 广播事件到渲染进程 */
  private broadcastEvent(event: TaskEvent): void;
}
```

### 5.2 运行态管理

```typescript
/**
 * 内存中的运行态任务记录
 */
interface RunningTask {
  taskId: number;
  executor: ITaskExecutor;
  cancelCallbacks: Array<() => void>;   // executor 注册的取消回调
  startedAt: number;
  promise: Promise<void>;               // 执行 Promise（用于 await）
}
```

`TaskManager` 内部维护 `Map<number, RunningTask>`：
- `runTask` 时加入 Map
- 完成/失败/取消时移除
- `cancelTask` 触发所有 `cancelCallbacks`

### 5.3 执行流程（以 Agent 任务为例）

```
TaskManager.runTask(taskId)
  │
  ├─ 1. 校验：executor 已注册？任务未在运行？
  ├─ 2. 读取 task + task_agent → 组装 TaskAgentView
  ├─ 3. UPDATE task SET status='running'
  ├─ 4. 广播 { type:'status_changed', status:'running' }
  ├─ 5. 构造 TaskExecutionContext（emit / cancelToken）
  ├─ 6. 加入 runningTasks Map
  ├─ 7. executor.execute(taskView, context)   ← AgentTaskExecutor
  │       │
  │       ├─ 创建 AiChatHistory（agent_id='task:agent:<taskId>'）
  │       ├─ 实例化 AiAgentService(llmConfig, agent, options)
  │       ├─ loadHistory / initChat
  │       ├─ for await (event of sendMessage(prompt)):
  │       │     context.emit(translateEvent(event))   ← 透传 AiChatEvent
  │       │     监听 cancelToken.cancelled → agentService.abort()
  │       └─ return { meta:{ chat_history_id }, rawOutput: messages }
  │
  ├─ 8a. resolve（成功）:
  │       ├─ UPDATE task SET status='completed'
  │       ├─ 查找 source result handler（source + type）
  │       ├─ 若存在：handler(task, result) → 合并写入 task_agent.result_meta
  │       ├─ 若不存在或失败：记录日志，不影响 completed 状态
  │       └─ 广播 { type:'done' }
  │
  ├─ 8b. reject（失败）:
  │       ├─ UPDATE task SET status='failed', error_message=...
  │       └─ 广播 { type:'error', message }
  │
  └─ 8c. cancel（取消）:
          ├─ UPDATE task SET status='cancelled'
          └─ 广播 { type:'status_changed', status:'cancelled' }

  finally: 从 runningTasks Map 移除
```

### 5.4 生命周期时序

```
应用启动
  └─ TaskManager.initialize()
       ├─ 连接 task.db
       ├─ 执行 data/task.sql 建表
       └─ 崩溃恢复（running → failed）

app-module 初始化（如 TodoAppService 构造）
  └─ taskManager.registerSourceResultHandler('todo-app', 'agent', handler)

Executor 注册（在 registerExecutors 阶段）
  └─ taskManager.registerExecutor(new AgentTaskExecutor(...))

IPC 就绪 → 前端可调用 qtian:task:*
```

## 6 AgentTaskExecutor 详细设计

### 6.1 职责

`AgentTaskExecutor` 是 `type='agent'` 的执行器实现，复用现有 `AiAgentService`：

| 职责 | 实现方式 |
| :--- | :--- |
| 获取 Agent 定义 | `AiAgentMgrService.getAgent(agent_name)` |
| 获取 LLM 配置 | `AiConfigService.getConfig(llm_config_name)` |
| 创建对话历史 | `AiHistoryService.createHistory('task:agent:<taskId>', historyId, ...)` |
| 执行对话 | `new AiAgentService(...)` → `sendMessage(prompt)` |
| 事件透传 | `AiChatEvent` → `TaskEvent` 映射 |
| 响应取消 | `cancelToken` → `agentService.abort()` |
| 结果输出 | 对话 messages 作为 `rawOutput` 传给 source handler |

### 6.2 接口

```typescript
/**
 * Agent 任务执行器
 *
 * 不持有状态：每次 execute 都创建新的 AiAgentService 实例。
 * 依赖通过构造函数注入（AiAgentMgrService / AiConfigService / AiHistoryService）。
 */
class AgentTaskExecutor implements ITaskExecutor<TaskAgentView> {
  readonly type: TaskType = 'agent';

  constructor(
    private agentMgr: AiAgentMgrService,
    private configService: AiConfigService,
    private historyService: AiHistoryService
  ) {}

  async execute(
    taskView: TaskAgentView,
    context: TaskExecutionContext
  ): Promise<TaskExecutionResult> {
    // 1. 解析 Agent / LLM 配置
    // 2. 生成 historyId（如 `task-${taskView.id}-${Date.now()}`）
    // 3. 创建 AiChatHistory（agent_id = `task:agent:<taskView.id>`）
    // 4. 实例化 AiAgentService
    // 5. 注册取消回调：cancelToken.onCancel(() => agentService.abort())
    // 6. for await (chatEvent of agentService.sendMessage(taskView.prompt)):
    //      context.emit(this.translate(chatEvent, taskView.id))
    // 7. done → 返回 { meta:{ chat_history_id }, rawOutput: agentService.getMessages() }
    //    error → 抛出 TaskExecutionError
    //    cancelled → 抛出 CancelledError
  }

  /** AiChatEvent → TaskEvent 映射 */
  private translate(event: AiChatEvent, taskId: number): TaskEvent { /* ... */ }
}
```

### 6.3 AiChatEvent → TaskEvent 映射表

| AiChatEvent | TaskEvent | 说明 |
| :--- | :--- | :--- |
| `{ type:'text_delta', content }` | `{ type:'text_delta', content }` | 流式文本 |
| `{ type:'tool_start', toolCallId, name, arguments }` | `{ type:'tool_start', ... }` | 工具开始 |
| `{ type:'tool_result', toolCallId, result, isError }` | `{ type:'tool_result', ... }` | 工具结果 |
| `{ type:'thinking', content }` | `{ type:'thinking', content }` | 思考过程 |
| `{ type:'done', messages }` | （触发完成流程） | Manager 写 completed |
| `{ type:'error', message }` | `{ type:'error', message }` | 执行错误 |

### 6.4 对话历史命名

```
agent_id  = 'task:agent:<task_id>'
history_id = 'task-<task_id>-<创建时间戳>'
title      = task.title（创建时设置）
```

历史文件路径：`workspace/assistant/history/task:agent:<task_id>/task-<task_id>-<ts>.json`

> AI 助手侧栏按 `agent_id` 列表历史，`task:agent:*` 自然不出现，无需改动 `AiChatHistory` 结构（替代 100 文档 §8.5 的 meta 方案）。

## 7 IPC Channel 设计

### 7.1 命名规范

- 通用任务：`qtian:task:<action>`
- 应用层封装：`qtian:<app>:<task-action>`（如 `qtian:todo:create-task-from-item`）

### 7.2 通用任务 Channel

```typescript
// ===== 任务生命周期 =====
'qtian:task:create-agent-task'   // (input) → TaskAgentView
'qtian:task:run'                 // (taskId) → void  异步触发，不等待完成
'qtian:task:cancel'              // (taskId) → void

// ===== 查询 =====
'qtian:task:get'                 // (taskId) → TaskView | undefined
'qtian:task:list-by-source'      // (source, sourceRefId?) → TaskView[]
'qtian:task:list'                // (filter?) → TaskView[]  任务中心用

// ===== 事件订阅 =====
'qtian:task:event'               // 推送通道（main → renderer），payload = TaskEvent
'qtian:task:subscribe'           // (taskId?) → void  订阅全部或指定任务事件
'qtian:task:unsubscribe'         // (taskId?) → void
```

### 7.3 渲染进程桥接（preload）

```typescript
// window.task.* 暴露通用任务接口
interface TaskApi {
  createAgentTask(input: AgentTaskCreateInput): Promise<TaskAgentView>;
  run(taskId: number): Promise<void>;
  cancel(taskId: number): Promise<void>;
  get(taskId: number): Promise<TaskView | undefined>;
  listBySource(source: string, sourceRefId?: number): Promise<TaskView[]>;
  list(filter?: TaskListFilter): Promise<TaskView[]>;
  onEvent(taskId: number | null, cb: (event: TaskEvent) => void): () => void; // 返回取消订阅函数
}
```

前端按 `event.taskId === targetTaskId` 过滤渲染，复用现有 ChatMessage 组件展示 Agent 流式输出。

## 8 目录结构设计

### 8.1 源码目录

```
src/main/core/services/task/
├── index.ts                          # 模块导出
├── task-manager.service.ts           # TaskManager（单例）
├── task.types.ts                     # Task / TaskType / ITaskExecutor 等类型
├── task-db.ts                        # task.db 的 DBManager 封装
├── executors/
│   ├── index.ts
│   ├── agent-task-executor.ts        # AgentTaskExecutor
│   └── agent-task-executor.test.ts
├── task-manager.service.test.ts
└── task-event-broadcaster.ts         # IPC 事件广播封装

src/main/core/ipc/handlers/
└── task.handler.ts                   # 通用任务 IPC handlers

src/shared/
└── ipc-channels.ts                   # 扩展 TASK_* channel 常量

data/
└── task.sql                          # 任务数据库初始化脚本
```

### 8.2 工作目录

```
workspace/
├── task/
│   └── task.db                       # 任务系统数据库（独立）
├── assistant/
│   └── history/
│       └── task:agent:<id>/          # Agent 任务对话历史（按 agent_id 隔离）
├── app_modules/
│   └── todo_app/                     # 各应用模块工作目录不变
└── ...
```

### 8.3 WPath 扩展

```typescript
class WPath {
  // 新增
  readonly taskDir: string;        // {workspace}/task/
  readonly taskDbPath: string;     // {workspace}/task/task.db
}
```

## 9 与现有模块的集成

### 9.1 与 AI 助手模块

| 集成点 | 说明 |
| :--- | :--- |
| `AiAgentService` | `AgentTaskExecutor` 内部实例化；复用 streaming tool-use loop |
| `AiAgentMgrService` | 获取 Agent 定义（`getAgent(agent_name)`） |
| `AiConfigService` | 获取 LLM 配置（`getConfig(llm_config_name)`） |
| `AiHistoryService` | 创建独立对话历史；`agent_id='task:agent:<taskId>'` 隔离 |
| `AI_CHAT_EVENT` | 不直接使用；AgentTaskExecutor 将 AiChatEvent 转为 TaskEvent 后走 `qtian:task:event` |
| `ToolRegistry` | 工具集由 Agent 定义决定，任务系统不干预 |

### 9.2 app-module 接入方式（以 todo-app 为例）

todo-app 作为 Source 模块接入任务系统，只需做两件事：

```typescript
// src/main/core/services/app-modules/todo-app/todo-app.service.ts
class TodoAppService {
  constructor(private taskManager: TaskManager) {
    // 1. 注册 Agent 任务完成回调（生成总结文档）
    this.taskManager.registerSourceResultHandler(
      'todo-app',
      'agent',
      this.handleAgentTaskResult.bind(this)
    );
  }

  /**
   * Agent 任务完成回调：
   * 读取对话 → 调用 LLM 生成总结 → 写入 todo_document → 返回 result_meta
   */
  private async handleAgentTaskResult(
    task: Task,
    result: TaskExecutionResult
  ): Promise<Record<string, unknown>> {
    // 1. 从 result.rawOutput 取对话 messages
    // 2. 调用 AiAgentService 生成总结（单轮对话，非流式）
    // 3. TodoDocumentService.createSummaryForTask(...)
    // 4. todo_item.agent_task_id = task.id（更新指向）
    // 5. return { summary_doc_id: doc.id }
  }

  /**
   * 从 todo_item 创建 Agent 任务（应用层封装，组装 prompt 后委托 TaskManager）
   */
  createTaskFromItem(itemId: number, options: {
    agentName: string;
    llmConfigName: string;
    extraPrompt?: string;
  }): TaskAgentView {
    // 1. TodoItemService.collectSubtree 收集子 todo
    // 2. 组装 prompt（见 100 文档 §8.3，todo-app 特有）
    // 3. return this.taskManager.createAgentTask({
    //      source: 'todo-app',
    //      source_ref_id: itemId,
    //      title: `${todo_item.title}`,
    //      prompt,
    //      agent_name: options.agentName,
    //      llm_config_name: options.llmConfigName
    //    });
    // 4. this.taskManager.runTask(task.id)  // 立即运行
  }
}
```

对应 IPC（todo-app 侧保留业务封装）：

```typescript
// todo-app 保留的 task 相关 IPC（业务封装）
'qtian:todo:create-task-from-item'  // (itemId, options) → TaskAgentView  内部组装 prompt + run
'qtian:todo:list-tasks-by-item'     // (itemId) → TaskView[]  封装 task:list-by-source

// 通用操作直接走 qtian:task:*（取消/查询/事件订阅）
```

### 9.3 初始化顺序

```typescript
// src/main/index.ts（主进程入口，伪代码）
function bootstrap() {
  const wpath = new WPath();

  // 1. AI 助手模块（已有）
  const aiConfigService = new AiConfigService(wpath);
  const agentMgr = new AiAgentMgrService(wpath);
  const historyService = new AiHistoryService(wpath);
  // ...

  // 2. 任务系统（新增）
  const taskManager = new TaskManager(wpath, /* eventBroadcaster */);
  taskManager.initialize();  // 建表 + 崩溃恢复
  taskManager.registerExecutor(
    new AgentTaskExecutor(agentMgr, aiConfigService, historyService)
  );

  // 3. app-modules（注入 taskManager）
  const todoAppService = new TodoAppService(wpath, taskManager);
  // todoAppService 构造时注册 source result handler

  // 4. IPC handlers
  registerAllHandlers(taskManager, todoAppService);
}
```

## 10 扩展示例（未来任务类型）

任务系统的核心价值在于扩展性。新增任务类型的步骤：

### 10.1 新增批处理任务（BatchTask）

```typescript
// 1. 扩展 TaskType
type TaskType = 'agent' | 'batch' | 'tool_execution';

// 2. 新增扩展表
// CREATE TABLE task_batch (task_id INTEGER PK, items_json TEXT, ...);

// 3. 新增 Executor
class BatchTaskExecutor implements ITaskExecutor<BatchTaskView> {
  readonly type = 'batch';
  async execute(task, context): Promise<TaskExecutionResult> {
    // 串行/并行处理 items，通过 context.emit 推进度
  }
}

// 4. 注册
taskManager.registerExecutor(new BatchTaskExecutor(...));
```

无需改动 TaskManager 核心逻辑。

### 10.2 新增工具执行任务（ToolExecutionTask）

类似地，封装"只执行一个特定工具、不经过 Agent 对话循环"的任务类型，用于定时清理、批量导入等场景。

### 10.3 新增 Source（doc-app）

doc-app 只需注册自己的 result handler：

```typescript
class DocAppService {
  constructor(taskManager: TaskManager) {
    taskManager.registerSourceResultHandler('doc-app', 'agent', this.handleResult.bind(this));
  }
}
```

## 11 UI 设计要点

> 通用任务面板 UI 的详细设计不在本文档范围，此处仅给出要点。

| 场景 | 实现 |
| :--- | :--- |
| 应用内任务面板（如 todo-app 详情区） | 应用组件订阅 `qtian:task:event`，按 `taskId` 过滤，复用 ChatMessage 渲染 Agent 流 |
| 全局任务中心（跨应用） | 独立页面，列出所有 task（`qtian:task:list`），支持筛选 type/source/status |
| 任务状态展示 | status badge + progress bar；running 时显示取消按钮 |
| 任务历史查看 | 点击 completed/failed 任务 → 加载对应 chat_history（通过 `task:agent:<id>`） |

## 12 测试策略

| 层级 | 工具 | 覆盖范围 |
| :--- | :--- | :--- |
| 单元测试 | Vitest | TaskManager CRUD、状态机、执行器分发、source handler 回调、崩溃恢复、重复运行拒绝 |
| 执行器测试 | Vitest | AgentTaskExecutor（mock AiAgentService/HistoryService）：事件映射、取消响应、异常传播 |
| 测试数据库 | better-sqlite3 `:memory:` | 每个用例独立 DB |
| 集成测试 | Vitest | todo-app createTaskFromItem → TaskManager → AgentTaskExecutor（mock）→ source handler → 总结文档 |
| E2E | Playwright | 创建任务 → 流式输出 → 完成 → 总结文档生成（todo-app 侧） |

关键用例清单：
- 创建 Agent 任务后 task + task_agent 各写入一条
- `runTask` 触发 executor，状态 pending → running → completed
- `cancelTask` 触发 abort，状态 → cancelled
- executor 抛错 → 状态 failed + error_message 回填
- 同一 task 重复 runTask 抛出"任务正在运行"
- source handler 抛错不影响 completed 状态，result_meta 记录 handler_error
- 崩溃恢复：预置 status=running 的任务，initialize 后变为 failed
- agent_id 隔离：任务对话不出现在 AI 助手 `listHistories(其他agent_id)` 中

## 13 待确认问题

| 编号 | 问题 | 依赖方 | 备注 |
| :--- | :--- | :--- | :--- |
| T-1 | `AiAgentService` 是否支持"非流式单轮调用"用于生成总结？ | AI 助手模块 | 若不支持，source handler 可用 `sendMessage` 单轮对话替代，或新增 `summarize()` 接口 |
| T-2 | 任务系统的全局任务中心 UI 是否在本期实现？ | 产品 | 本文档仅定义 IPC 与数据模型；UI 可后置 |
| T-3 | 是否需要任务优先级/队列（多任务并发时排队）？ | 产品 | 当前并发执行；若需排队，TaskManager 增加队列调度 |

## 14 实现分期建议

### Phase 1: 核心框架
- `data/task.sql` 编写
- `task.types.ts` 类型定义
- `TaskDb`（DBManager 封装）+ 单元测试
- `TaskManager` 核心逻辑（CRUD + 生命周期 + 崩溃恢复）+ 单元测试
- `AgentTaskExecutor` + 单元测试（mock AI 服务）
- 通用 IPC `qtian:task:*` + preload 桥接
- 事件广播 `qtian:task:event`

### Phase 2: todo-app 接入
- todo-app 注册 source result handler（总结文档生成）
- `TodoAppService.createTaskFromItem`（prompt 组装 + 委托 TaskManager）
- todo-app IPC 调整（`create-task-from-item` / `list-tasks-by-item`）
- todo-app 任务面板 UI 接入 `qtian:task:event` 订阅
- 集成测试

### Phase 3: 增强与打磨
- 全局任务中心 UI（跨应用任务列表）
- 任务并发队列（若 T-3 确认需要）
- E2E 冒烟测试覆盖任务流

---

## 附录 A: 与 100_todo-app-design.md 的关系

本文档从 `100_todo-app-design.md` §3.6（TodoAgentTask）、§4.2（todo_agent_task 表）、§5.2（TodoTaskService）、§8（Todo 驱动 AI 任务）中**抽取通用部分**形成公共任务系统。

迁移后：
- **100 文档保留**：todo-app 特有的 prompt 组装规则（§8.3）、总结文档生成逻辑（§8.4）、`TodoAppService.createTaskFromItem` 业务封装
- **100 文档引用本文档**：任务实体定义、任务表结构、任务执行/取消/查询机制
- `TodoTaskService` 职责收敛为"todo-app 侧的任务适配层"（prompt 组装 + source handler 注册），不再直接管理任务生命周期

## 附录 B: 设计取舍记录

| 备选方案 | 未采用原因 |
| :--- | :--- |
| 单表 + JSON config 字段 | 项目现有 DBManager 风格均为显式列；JSON 缺少 DB 约束、不利于查询与迁移 |
| 任务表放入 todo.db | 其他应用无法复用；耦合单一模块；未来迁移成本高 |
| 用 AiChatHistory.meta 过滤任务对话 | 需改动 AiChatHistory 结构；不如 `agent_id` 前缀隔离干净 |
| TaskManager 直接生成总结文档 | 总结生成是业务逻辑（todo-app 生成 todo_document，doc-app 可能不同），不应耦合到通用框架 |
| 任务编排/依赖图 | 当前无需求；YAGNI，后续按需扩展 |
