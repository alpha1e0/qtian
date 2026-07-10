import { createLogger } from '@/core/utils/logger';
import { NoteDb } from './note-db';
import { NoteLabelService } from './note-label.service';
import { NoteCategoryService } from './note-category.service';
import { NoteDocService } from './note-doc.service';
import { NoteSearchService } from './note-search.service';
import { NoteTokenizer } from './note-tokenizer';
import {
  NoteAppConfig,
  NoteTrashItem,
  NoteTrashEntityType,
  NoteEmptyTrashResult,
} from './types';

const logger = createLogger('NoteAppService');

/**
 * Note 应用模块入口 Service
 *
 * 职责：
 * 1. 持有 NoteDb 连接（建表 + 暴露 DBManager）
 * 2. 读取 config.noteApp，提供运行时配置
 * 3. 装配所有子 Service（label / category / doc / search）
 * 4. 提供统一访问入口（getXxxService）
 * 5. 回收站聚合（跨 category/doc/label 三表）
 *
 * 装配顺序：
 *   - 先创建 NoteSearchService（仅依赖 DBManager + Tokenizer）
 *   - 再以可选参数注入到业务 Service（保持向后兼容）
 *
 * 不负责：IPC handler 注册（由 note-app-bootstrap 完成）。
 *
 * 独立性约束：不引用 todo-app 的代码。
 */
export class NoteAppService {
  private db: NoteDb;
  private config: NoteAppConfig;
  private labelService: NoteLabelService;
  private categoryService: NoteCategoryService;
  private docService: NoteDocService;
  private searchService: NoteSearchService;

  /**
   * @param db - 已初始化的 NoteDb
   * @param config - note-app 运行时配置
   * @param attachDir - 附件目录路径（workspace/app_modules/note_app/attach）
   */
  constructor(db: NoteDb, config: NoteAppConfig, attachDir: string) {
    this.db = db;
    this.config = config;
    const manager = db.getDBManager();
    // 装配顺序：先创建 search（无依赖），再注入到业务 Service
    this.searchService = new NoteSearchService(manager, new NoteTokenizer());
    this.labelService = new NoteLabelService(manager);
    this.categoryService = new NoteCategoryService(manager, this.searchService);
    this.docService = new NoteDocService(manager, this.labelService, this.searchService, attachDir);
    logger.info('NoteAppService initialized');
  }

  getCategoryService(): NoteCategoryService {
    return this.categoryService;
  }

  getDocService(): NoteDocService {
    return this.docService;
  }

  getLabelService(): NoteLabelService {
    return this.labelService;
  }

  getSearchService(): NoteSearchService {
    return this.searchService;
  }

  getConfig(): NoteAppConfig {
    return this.config;
  }

  /**
   * 暴露内部 NoteDb 实例（供数据同步模块执行 backup/restore）。
   *
   * 调用方：SyncService 通过此方法拿到 live DB，执行 checkpoint + backupTo / restoreFrom。
   */
  getDb(): NoteDb {
    return this.db;
  }

  /** 关闭数据库连接 */
  close(): void {
    this.db.close();
  }

  // =========================================================================
  // 回收站聚合层
  //
  // 跨表聚合 3 张业务表（category / doc / label）的软删除行，
  // 提供统一的 listTrash / purgeTrash / emptyTrash 入口。
  // =========================================================================

  /**
   * 列出回收站全部条目（跨 3 张表聚合，按 deleted_at DESC 排序）。
   */
  listTrash(): NoteTrashItem[] {
    const items: NoteTrashItem[] = [];

    for (const c of this.categoryService.listTrash()) {
      items.push({
        type: 'category',
        id: c.id,
        name: c.name,
        deleted_at: c.deleted_at!,
        parent_id: c.parent_id,
      });
    }
    for (const d of this.docService.listTrash()) {
      items.push({
        type: 'doc',
        id: d.id,
        name: d.title,
        deleted_at: d.deleted_at!,
        category_id: d.category_id,
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

    items.sort((a, b) => b.deleted_at - a.deleted_at);
    return items;
  }

  /**
   * 物理删除回收站中的指定条目（按 type 路由到对应 Service.purge）。
   *
   * @param type - 实体类型
   * @param id - 实体 ID
   */
  purgeTrash(type: NoteTrashEntityType, id: number): void {
    switch (type) {
      case 'category':
        this.categoryService.purge(id);
        break;
      case 'doc':
        this.docService.purge(id);
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
   * @returns { removed } 实际删除条目数
   */
  emptyTrash(): NoteEmptyTrashResult {
    const items = this.listTrash();
    for (const item of items) {
      this.purgeTrash(item.type, item.id);
    }
    logger.info(`Trash emptied: removed=${items.length}`);
    return { removed: items.length };
  }
}
