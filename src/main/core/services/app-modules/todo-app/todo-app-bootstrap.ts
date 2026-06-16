import { wpath, config } from '@/core/common/context';
import { createLogger } from '@/core/utils/logger';
import { registerTodoAppHandlers } from '@/core/ipc/handlers/todo-app.handler';
import { TodoDb } from './todo-db';
import { TodoAppService } from './todo-app.service';

const logger = createLogger('TodoAppBootstrap');

/** 进程级单例：todo-app 服务（由 bootstrapTodoApp 创建） */
let todoAppSingleton: TodoAppService | null = null;

/**
 * 引导 todo-app 模块：
 * 1. 创建 TodoDb（workspace/app_modules/todo_app/todo.db）+ 建表
 * 2. 读取 config.todoApp 运行时配置
 * 3. 创建 TodoAppService 并装配子 Service
 * 4. 注册 IPC handlers
 *
 * 幂等：重复调用直接返回已创建的单例。
 *
 * Phase 5 注入点：后续可通过 setTaskManager() 注入 TaskManager 以支持 Todo 驱动任务。
 *
 * @returns todo-app 服务单例
 */
export function bootstrapTodoApp(): TodoAppService {
  if (todoAppSingleton) {
    return todoAppSingleton;
  }

  // 1. 数据库
  const db = new TodoDb(wpath.todoDbPath, wpath.getTodoAppSqlFile());
  db.initialize();

  // 2. 运行时配置
  const todoConfig = {
    defaultCategoryId: config.todoApp.defaultCategoryId,
    defaultSort: config.todoApp.defaultSort,
    showCompleted: config.todoApp.showCompleted,
    maxCategoryDepth: config.todoApp.maxCategoryDepth,
    maxTodoItemDepth: config.todoApp.maxTodoItemDepth,
  };

  // 3. 装配 Service
  const service = new TodoAppService(db, todoConfig, wpath.appModulesTodoAttachDir);

  // 4. 注册 IPC handlers
  registerTodoAppHandlers(service);

  todoAppSingleton = service;
  logger.info('Todo app bootstrapped');
  return service;
}

/**
 * 获取 todo-app 服务单例（未引导时抛错）
 */
export function getTodoAppService(): TodoAppService {
  if (!todoAppSingleton) {
    throw new Error('Todo app not bootstrapped. Call bootstrapTodoApp() first.');
  }
  return todoAppSingleton;
}
