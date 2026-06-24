import { createLogger } from '@/core/utils/logger';
import { TaskManager } from '@/core/services/task/task-manager.service';
import { AiAgentMgrService } from '@/core/services/agent/ai-agent-mgr.service';
import { AiConfigService } from '@/core/services/common/ai-config.service';
import { TodoDb } from './todo-db';
import { TodoLabelService } from './todo-label.service';
import { TodoCategoryService } from './todo-category.service';
import { TodoListService } from './todo-list.service';
import { TodoItemService } from './todo-item.service';
import { TodoDocumentService } from './todo-document.service';
import { TodoSearchService } from './todo-search.service';
import { TodoListExchangeService } from './todo-list-exchange.service';
import { TodoTokenizer } from './todo-tokenizer';
import { TodoTaskService } from './todo-task.service';
import { TodoAppConfig, TodoTrashItem, TodoTrashEntityType, TodoEmptyTrashResult } from './types';

const logger = createLogger('TodoAppService');

/**
 * Todo 应用模块入口 Service
 *
 * 职责：
 * 1. 持有 TodoDb 连接（建表 + 暴露 DBManager）
 * 2. 读取 config.todoApp，提供运行时配置
 * 3. 装配所有子 Service（label / category / list / item / document / search）
 * 4. 提供统一访问入口（getXxxService）
 * 5. （Phase 5）可选装配 TodoTaskService —— 注入 TaskManager 后才具备任务能力
 *
 * 装配顺序（Phase 3）：
 *   - 先创建 TodoSearchService（仅依赖 DBManager）
 *   - 再以可选参数注入到其他业务 Service（保持现有测试不传 searchService 时为 noop）
 *
 * 装配顺序（Phase 5）：
 *   - 第 4 参数 taskManager 可选；未传时 taskService=null，向后兼容现有 149 个测试。
 *   - 注入 TaskManager 时实例化 TodoTaskService（其构造函数内会注册 source handler）。
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
  /** 待办项目 导入/导出（依赖 list/item/label/category service） */
  private exchangeService: TodoListExchangeService;
  /** Phase 5：todo-app 任务适配层（taskManager 未注入时为 null） */
  private taskService: TodoTaskService | null = null;

  /**
   * @param db - 已初始化的 TodoDb
   * @param config - todo-app 运行时配置
   * @param attachDir - 附件目录路径（workspace/app_modules/todo_app/attach）
   * @param taskManager - （可选，Phase 5）公共任务管理器；注入后装配 TodoTaskService
   */
  constructor(db: TodoDb, config: TodoAppConfig, attachDir: string, taskManager?: TaskManager) {
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
    // 导入/导出 service：聚合 list/item/label/category，纯逻辑无 IO
    this.exchangeService = new TodoListExchangeService(
      this.listService,
      this.itemService,
      this.labelService,
      this.categoryService,
    );

    // Phase 5：可选装配 TodoTaskService（注入 TaskManager 后启用任务能力）
    if (taskManager) {
      this.taskService = new TodoTaskService(
        this,
        taskManager,
        new AiAgentMgrService(),
        new AiConfigService(),
      );
    }
    logger.info(`TodoAppService initialized (taskService=${this.taskService ? 'enabled' : 'disabled'})`);
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

  /** 待办项目 导入/导出（list 维度 JSON 序列化与重建） */
  getExchangeService(): TodoListExchangeService {
    return this.exchangeService;
  }

  /** Phase 5：todo-app 任务适配层（未注入 TaskManager 时为 null） */
  getTaskService(): TodoTaskService | null {
    return this.taskService;
  }

  getConfig(): TodoAppConfig {
    return this.config;
  }

  /** 关闭数据库连接 */
  close(): void {
    this.db.close();
  }

  // =========================================================================
  // 回收站聚合层（Phase 4）
  //
  // 设计依据 docs/specs/100_todo-app-design.md §10 Phase 4 / §6.2 / §9.3。
  // 跨表聚合 5 张业务表（category / todo_list / todo_item / document / label）
  // 的软删除行，提供统一的 listTrash / purgeTrash / emptyTrash 入口。
  // =========================================================================

  /**
   * 列出回收站全部条目（跨 5 张表聚合，按 deleted_at DESC 排序）。
   *
   * @returns TodoTrashItem[] —— 仅包含已软删除的实体
   */
  listTrash(): TodoTrashItem[] {
    const items: TodoTrashItem[] = [];

    for (const c of this.categoryService.listTrash()) {
      items.push({
        type: 'category',
        id: c.id,
        name: c.name,
        deleted_at: c.deleted_at!,
        parent_id: c.parent_id,
      });
    }
    for (const l of this.listService.listTrash()) {
      items.push({
        type: 'todo_list',
        id: l.id,
        name: l.name,
        deleted_at: l.deleted_at!,
        category_id: l.category_id,
      });
    }
    for (const i of this.itemService.listTrash()) {
      items.push({
        type: 'todo_item',
        id: i.id,
        name: i.title,
        deleted_at: i.deleted_at!,
        parent_id: i.parent_id,
        todo_list_id: i.todo_list_id,
      });
    }
    for (const d of this.documentService.listTrash()) {
      items.push({
        type: 'document',
        id: d.id,
        name: d.name,
        deleted_at: d.deleted_at!,
      });
    }
    for (const lb of this.labelService.listTrash()) {
      items.push({
        type: 'label',
        id: lb.id,
        name: lb.name,
        deleted_at: lb.deleted_at!,
      });
    }

    // 按 deleted_at DESC 排序（最近删除在前）
    items.sort((a, b) => b.deleted_at - a.deleted_at);
    return items;
  }

  /**
   * 物理删除回收站中的指定条目（按 type 路由到对应 Service.purge）。
   *
   * 各 Service 内部保证幂等性（未删除实体为 no-op）。
   *
   * @param type - 实体类型
   * @param id - 实体 ID
   */
  purgeTrash(type: TodoTrashEntityType, id: number): void {
    switch (type) {
      case 'category':
        this.categoryService.purge(id);
        break;
      case 'todo_list':
        this.listService.purge(id);
        break;
      case 'todo_item':
        this.itemService.purge(id);
        break;
      case 'document':
        this.documentService.purge(id);
        break;
      case 'label':
        this.labelService.purge(id);
        break;
    }
    logger.info(`Trash purged: type=${type}, id=${id}`);
  }

  /**
   * 清空回收站（逐条物理删除所有软删除条目）。
   *
   * 不引入跨 Service 大事务，避免长事务锁；各 Service 内部事务保证一致性。
   * 中途失败时已 purge 的不回滚（可接受的折衷，调用方需重试）。
   *
   * @returns { removed } 实际删除条目数（等于清空前 listTrash().length）
   */
  emptyTrash(): TodoEmptyTrashResult {
    const items = this.listTrash();
    for (const item of items) {
      this.purgeTrash(item.type, item.id);
    }
    logger.info(`Trash emptied: removed=${items.length}`);
    return { removed: items.length };
  }
}
