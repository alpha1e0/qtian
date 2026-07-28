import { wpath, config } from '@/core/common/context';
import { createLogger } from '@/core/utils/logger';
import { AiAgentMgrService } from '@/core/services/agent/ai-agent-mgr.service';
import { AiConfigService } from '@/core/services/common/ai-config.service';
import { AiHistoryService } from '@/core/services/common/ai-history.service';
import { registerTaskHandlers } from '@/core/ipc/handlers/task.handler';
import { TaskDb } from './task-db';
import { TaskEventBroadcaster } from './task-event-broadcaster';
import { TaskManager } from './task-manager.service';
import { AgentTaskExecutor } from './executors/agent-task-executor';

const logger = createLogger('TaskBootstrap');

/** 进程级单例：任务管理器（由 bootstrapTaskSystem 创建） */
let taskManagerSingleton: TaskManager | null = null;

/**
 * 引导任务系统：
 * 1. 创建 TaskDb（workspace/task/task.db）+ 建表 + 崩溃恢复
 * 2. 创建事件广播器
 * 3. 创建 TaskManager 并注册 AgentTaskExecutor
 * 4. 注册 IPC handlers
 *
 * 幂等：重复调用直接返回已创建的单例。
 *
 * @returns 任务管理器单例（source 模块可据此注册 source handler）
 */
export function bootstrapTaskSystem(): TaskManager {
  if (taskManagerSingleton) {
    return taskManagerSingleton;
  }

  // 1. 数据库
  const db = new TaskDb(wpath.taskDbPath, wpath.getTaskSqlFile());

  // 2. 事件广播器
  const broadcaster = new TaskEventBroadcaster();

  // 3. 任务管理器（initialize 内含建表 + 崩溃恢复）
  const taskManager = new TaskManager(db, broadcaster);
  taskManager.initialize();

  // 4. 注册 AgentTaskExecutor
  //    依赖 AI 助手的服务（无状态文件 IO，独立实例即可）
  //    ask_human 暂不接入任务上下文（需独立的任务级 IPC，Phase 1 跳过）
  const agentExecutor = new AgentTaskExecutor(
    new AiAgentMgrService(),
    new AiConfigService(),
    new AiHistoryService(),
    {
      getTavilyApiKey: () => config.aiAssistant.tavilyApiKey,
    },
  );
  taskManager.registerExecutor(agentExecutor);

  // 5. 注册 IPC handlers
  registerTaskHandlers(taskManager, broadcaster);

  taskManagerSingleton = taskManager;
  logger.info('Task system bootstrapped');
  return taskManager;
}

/**
 * 获取任务管理器单例（未引导时抛错）
 */
export function getTaskManager(): TaskManager {
  if (!taskManagerSingleton) {
    throw new Error('Task system not bootstrapped. Call bootstrapTaskSystem() first.');
  }
  return taskManagerSingleton;
}
