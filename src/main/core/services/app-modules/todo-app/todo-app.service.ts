import { createLogger } from '@/core/utils/logger';
import { TodoDb } from './todo-db';
import { TodoLabelService } from './todo-label.service';
import { TodoCategoryService } from './todo-category.service';
import { TodoListService } from './todo-list.service';
import { TodoItemService } from './todo-item.service';
import { TodoDocumentService } from './todo-document.service';
import { TodoAppConfig } from './types';

const logger = createLogger('TodoAppService');

/**
 * Todo 应用模块入口 Service
 *
 * 职责：
 * 1. 持有 TodoDb 连接（建表 + 暴露 DBManager）
 * 2. 读取 config.todoApp，提供运行时配置
 * 3. 装配所有子 Service（label / category / list / item / document）
 * 4. 提供统一访问入口（getXxxService）
 *
 * 不负责：IPC handler 注册（由 todo-app-bootstrap 完成）。
 */
export class TodoAppService {
  private db: TodoDb;
  private config: TodoAppConfig;
  private labelService: TodoLabelService;
  private categoryService: TodoCategoryService;
  private listService: TodoListService;
  private itemService: TodoItemService;
  private documentService: TodoDocumentService;

  /**
   * @param db - 已初始化的 TodoDb
   * @param config - todo-app 运行时配置
   * @param attachDir - 附件目录路径（workspace/app_modules/todo_app/attach）
   */
  constructor(db: TodoDb, config: TodoAppConfig, attachDir: string) {
    this.db = db;
    this.config = config;
    const manager = db.getDBManager();
    this.labelService = new TodoLabelService(manager);
    this.categoryService = new TodoCategoryService(manager);
    this.listService = new TodoListService(manager);
    this.itemService = new TodoItemService(manager, this.labelService);
    this.documentService = new TodoDocumentService(manager, attachDir);
    logger.info('TodoAppService initialized');
  }

  getLabelService(): TodoLabelService {
    return this.labelService;
  }

  getCategoryService(): TodoCategoryService {
    return this.categoryService;
  }

  getListService(): TodoListService {
    return this.listService;
  }

  getItemService(): TodoItemService {
    return this.itemService;
  }

  getDocumentService(): TodoDocumentService {
    return this.documentService;
  }

  getConfig(): TodoAppConfig {
    return this.config;
  }

  /** 关闭数据库连接 */
  close(): void {
    this.db.close();
  }
}
