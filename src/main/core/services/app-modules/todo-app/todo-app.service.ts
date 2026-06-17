import { createLogger } from '@/core/utils/logger';
import { TodoDb } from './todo-db';
import { TodoLabelService } from './todo-label.service';
import { TodoCategoryService } from './todo-category.service';
import { TodoListService } from './todo-list.service';
import { TodoItemService } from './todo-item.service';
import { TodoDocumentService } from './todo-document.service';
import { TodoSearchService } from './todo-search.service';
import { TodoTokenizer } from './todo-tokenizer';
import { TodoAppConfig } from './types';

const logger = createLogger('TodoAppService');

/**
 * Todo 应用模块入口 Service
 *
 * 职责：
 * 1. 持有 TodoDb 连接（建表 + 暴露 DBManager）
 * 2. 读取 config.todoApp，提供运行时配置
 * 3. 装配所有子 Service（label / category / list / item / document / search）
 * 4. 提供统一访问入口（getXxxService）
 *
 * 装配顺序（Phase 3）：
 *   - 先创建 TodoSearchService（仅依赖 DBManager）
 *   - 再以可选参数注入到其他业务 Service（保持现有测试不传 searchService 时为 noop）
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
  private searchService: TodoSearchService;

  /**
   * @param db - 已初始化的 TodoDb
   * @param config - todo-app 运行时配置
   * @param attachDir - 附件目录路径（workspace/app_modules/todo_app/attach）
   */
  constructor(db: TodoDb, config: TodoAppConfig, attachDir: string) {
    this.db = db;
    this.config = config;
    const manager = db.getDBManager();
    // 装配顺序：先创建 search（无依赖），再注入到业务 Service
    this.searchService = new TodoSearchService(manager, new TodoTokenizer());
    this.labelService = new TodoLabelService(manager);
    this.categoryService = new TodoCategoryService(manager, this.searchService);
    this.listService = new TodoListService(manager, this.searchService);
    this.itemService = new TodoItemService(manager, this.labelService, this.searchService);
    this.documentService = new TodoDocumentService(manager, attachDir, this.searchService);
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

  getSearchService(): TodoSearchService {
    return this.searchService;
  }

  getConfig(): TodoAppConfig {
    return this.config;
  }

  /** 关闭数据库连接 */
  close(): void {
    this.db.close();
  }
}
