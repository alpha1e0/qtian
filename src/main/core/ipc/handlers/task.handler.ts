import { ipcMain, IpcMainInvokeEvent } from 'electron';

import { IPC_CHANNELS } from '../channels';
import { createLogger } from '@/core/utils/logger';
import { TaskManager } from '@/core/services/task/task-manager.service';
import { TaskEventBroadcaster } from '@/core/services/task/task-event-broadcaster';
import {
  AgentTaskCreateInput,
  TaskListFilter,
  TaskSource,
} from '@/core/services/task/task.types';

const logger = createLogger('IPC:Task');

/**
 * 注册任务系统 IPC handlers
 *
 * @param taskManager - 任务管理器单例
 * @param broadcaster - 任务事件广播器（用于订阅管理）
 */
export function registerTaskHandlers(taskManager: TaskManager, broadcaster: TaskEventBroadcaster): void {
  // 创建 Agent 任务
  ipcMain.handle(IPC_CHANNELS.TASK_CREATE_AGENT_TASK, async (_event, input: AgentTaskCreateInput) => {
    logger.info(`Create agent task: source=${input.source}, title='${input.title}'`);
    return taskManager.createAgentTask(input);
  });

  // 运行任务
  ipcMain.handle(IPC_CHANNELS.TASK_RUN, async (_event, taskId: number) => {
    logger.info(`Run task: ${taskId}`);
    return taskManager.run(taskId);
  });

  // 取消任务
  ipcMain.handle(IPC_CHANNELS.TASK_CANCEL, async (_event, taskId: number) => {
    logger.info(`Cancel task: ${taskId}`);
    return taskManager.cancel(taskId);
  });

  // 获取任务详情
  ipcMain.handle(IPC_CHANNELS.TASK_GET, async (_event, taskId: number) => {
    return taskManager.getTask(taskId);
  });

  // 按来源列出任务
  ipcMain.handle(
    IPC_CHANNELS.TASK_LIST_BY_SOURCE,
    async (_event, source: TaskSource, sourceRefId?: number) => {
      return taskManager.listBySource(source, sourceRefId);
    },
  );

  // 全局任务列表（任务中心用）
  ipcMain.handle(IPC_CHANNELS.TASK_LIST, async (_event, filter?: TaskListFilter) => {
    return taskManager.listTasks(filter);
  });

  // 订阅任务事件
  ipcMain.handle(IPC_CHANNELS.TASK_SUBSCRIBE, async (event: IpcMainInvokeEvent, taskId?: number) => {
    broadcaster.subscribe(event.sender, taskId ?? null);
    logger.debug(`Subscribed: contents=${event.sender.id}, taskId=${taskId ?? 'all'}`);
  });

  // 取消订阅任务事件
  ipcMain.handle(IPC_CHANNELS.TASK_UNSUBSCRIBE, async (event: IpcMainInvokeEvent, taskId?: number) => {
    broadcaster.unsubscribe(event.sender, taskId);
    logger.debug(`Unsubscribed: contents=${event.sender.id}, taskId=${taskId ?? 'all'}`);
  });

  logger.info('Task IPC handlers registered');
}
