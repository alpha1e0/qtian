import { createLogger } from '@/core/utils/logger';
import {
  TODO_EXPORT_BUNDLE_VERSION,
  TODO_MAX_IMPORT_ITEMS,
  MAX_TODO_ITEM_DEPTH,
  TodoItemNode,
  TodoListExportBundle,
  TodoListExportItemNode,
  TodoListImportResult,
} from './types';
import { TodoListService } from './todo-list.service';
import { TodoItemService } from './todo-item.service';
import { TodoLabelService } from './todo-label.service';
import { TodoCategoryService } from './todo-category.service';

const logger = createLogger('TodoListExchangeService');

/**
 * TodoList 导入/导出（Exchange）Service
 *
 * 职责：
 * - `serialize(listId)`：把指定 todo_list 序列化为 ExportBundle（纯函数，不碰 fs）
 * - `deserialize(bundle, categoryId)`：把 ExportBundle 重建到目标 category 下（纯函数，不碰 fs）
 *
 * 设计原则：
 * - 与文件 IO / 对话框解耦，便于单元测试（参考既有 *.service.test.ts 的内存 DB 模式）
 * - 仅含未软删除 item；剔除 agent_task_id / document / 原 id（跨库无意义）
 * - 导入时**跳过进度联动**，保留快照内的 progress（由 TodoItemService.bulkCreateForImport 保证）
 * - label 按 name find-or-create，命中复用现有 id
 *
 * 需求文档：docs/specs/101_todo-app-import-export-req.md
 */
export class TodoListExchangeService {
  constructor(
    private listService: TodoListService,
    private itemService: TodoItemService,
    private labelService: TodoLabelService,
    private categoryService: TodoCategoryService,
  ) {}

  /**
   * 序列化指定 todo_list 为 ExportBundle。
   * @throws listId 不存在时抛错
   */
  serialize(listId: number): TodoListExportBundle {
    const list = this.listService.getById(listId);
    if (!list) {
      throw new Error(`TodoList ${listId} not found`);
    }
    const tree = this.itemService.getTreeByList(listId);
    return {
      version: TODO_EXPORT_BUNDLE_VERSION,
      exported_at: Date.now(),
      list: { name: list.name, description: list.description },
      items: tree.map((n) => this.mapNodeToBundle(n)),
    };
  }

  /**
   * 反序列化 ExportBundle 到指定 category 下。
   *
   * 流程：bundle 校验 → category 校验 → 深度/数量预校验 → 建 label 缓存回调
   *      → listService.create → itemService.bulkCreateForImport → 失败时补偿回滚 list
   *
   * @throws bundle 不合法 / categoryId 不存在或已软删 / 深度超限 / 数量超限 / title 缺失
   */
  deserialize(bundle: TodoListExportBundle, categoryId: number): TodoListImportResult {
    this.validateBundle(bundle);

    const category = this.categoryService.getById(categoryId);
    if (!category) {
      throw new Error(`Category ${categoryId} not found or deleted`);
    }

    // 预校验深度与数量（INSERT 前抛错，避免中途失败留下脏数据）
    const stats = this.precheckBundle(bundle.items);
    if (stats.count > TODO_MAX_IMPORT_ITEMS) {
      throw new Error(`Import items exceed limit (${TODO_MAX_IMPORT_ITEMS})`);
    }

    // label name → id 缓存（同次导入内复用；list() 返回未软删标签）
    const labelCache = new Map<string, number>();
    const resolveLabels = (names: string[]): number[] => {
      const ids: number[] = [];
      for (const name of names) {
        const trimmed = (name ?? '').trim();
        if (trimmed.length === 0) continue;
        let id = labelCache.get(trimmed);
        if (id === undefined) {
          const existing = this.labelService.list().find((l) => l.name === trimmed);
          id = existing ? existing.id : this.labelService.create({ name: trimmed }).id;
          labelCache.set(trimmed, id);
        }
        ids.push(id);
      }
      return ids;
    };

    // Step 1：新建 todo_list（listService 内部自有事务 + FTS）
    const newList = this.listService.create({
      name: bundle.list.name,
      description: bundle.list.description,
      category_id: categoryId,
    });

    try {
      // Step 2：批量重建 items（单事务，跳过进度联动，失败原子回滚 item）
      const itemCount = this.itemService.bulkCreateForImport(newList.id, bundle.items, resolveLabels);
      logger.info(`Imported list: id=${newList.id}, items=${itemCount}`);
      return { listId: newList.id, itemCount };
    } catch (err) {
      // 补偿：item 重建失败时回滚已创建的 list，避免孤儿数据
      logger.error(`Import failed, rolling back list ${newList.id}`, err);
      this.listService.delete(newList.id);
      this.listService.purge(newList.id);
      throw err;
    }
  }

  // =========================================================================
  // 内部工具
  // =========================================================================

  /** 把 TodoItemNode 递归映射为导出节点（label 转为 name 列表） */
  private mapNodeToBundle(node: TodoItemNode): TodoListExportItemNode {
    const labelNames = this.labelService
      .getItemLabels(node.id)
      .map((id) => this.labelService.getById(id)?.name)
      .filter((n): n is string => typeof n === 'string');

    return {
      title: node.title,
      description: node.description,
      task_prompt: node.task_prompt,
      status: node.status,
      progress: node.progress,
      priority: node.priority,
      due_at: node.due_at,
      is_manual_progress: node.is_manual_progress,
      labels: labelNames,
      children: (node.children ?? []).map((c) => this.mapNodeToBundle(c)),
    };
  }

  /** bundle 顶层结构校验 */
  private validateBundle(bundle: unknown): asserts bundle is TodoListExportBundle {
    if (!bundle || typeof bundle !== 'object') {
      throw new Error('Invalid bundle: not an object');
    }
    const b = bundle as Record<string, unknown>;
    if (b.version !== TODO_EXPORT_BUNDLE_VERSION) {
      throw new Error(`Unsupported bundle version: ${b.version}`);
    }
    const list = b.list as { name?: unknown; description?: unknown } | undefined;
    if (!list || typeof list.name !== 'string') {
      throw new Error('Invalid bundle: list.name missing');
    }
    if (!Array.isArray(b.items)) {
      throw new Error('Invalid bundle: items not array');
    }
  }

  /**
   * 预校验嵌套结构：title 非空、深度不超过 MAX_TODO_ITEM_DEPTH。
   * @returns 节点总数与最大深度（用于后续数量上限判断）
   */
  private precheckBundle(items: TodoListExportItemNode[]): { count: number; maxDepth: number } {
    let count = 0;
    let maxDepth = 0;
    const walk = (nodes: TodoListExportItemNode[], depth: number) => {
      for (const n of nodes) {
        if (!n || typeof n.title !== 'string' || n.title.trim().length === 0) {
          throw new Error('Bundle item title missing');
        }
        count += 1;
        maxDepth = Math.max(maxDepth, depth);
        if (depth > MAX_TODO_ITEM_DEPTH) {
          throw new Error(`Imported bundle exceeds MAX_TODO_ITEM_DEPTH at "${n.title}"`);
        }
        if (n.children && n.children.length > 0) {
          walk(n.children, depth + 1);
        }
      }
    };
    walk(items, 1);
    return { count, maxDepth };
  }
}
