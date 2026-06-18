import { DBManager } from '@/core/database/db-manager';
import { createLogger } from '@/core/utils/logger';
import { TodoCategory, TodoCategoryNode, MAX_CATEGORY_DEPTH } from './types';
import { TodoSearchService } from './todo-search.service';

const logger = createLogger('TodoCategoryService');

/**
 * Category Service — 递归分组 CRUD + 树构建 + 递归层级校验
 *
 * 职责：
 * - create / update / delete（递归软删除子 category + 关联 list + item + document）
 * - restore（parent 已删则提升至根）
 * - getTree（内存构建树 + list_count 聚合）
 * - validateDepth（递归层级上限校验）
 *
 * FTS 集成（Phase 3）：searchService 为可选依赖（默认 null）；
 * 写操作在事务内调用 `searchService?.syncFts(...)`，无 searchService 时为 noop。
 *
 * 递归软删除使用 db 事务保证一致性。
 */
export class TodoCategoryService {
  private db: DBManager;
  private searchService: TodoSearchService | null;

  constructor(db: DBManager, searchService: TodoSearchService | null = null) {
    this.db = db;
    this.searchService = searchService;
  }

  /** 创建分类（parent_id=null 表示根分类） */
  create(data: { name: string; parent_id: number | null }): TodoCategory {
    const name = data.name.trim();
    if (name.length === 0) {
      throw new Error('Category name cannot be empty');
    }

    // 校验递归深度
    this.validateDepth(data.parent_id, MAX_CATEGORY_DEPTH);

    const now = Date.now();
    // 主表写入 + FTS 同步在同一事务内（设计文档 §4.3 / §7.2.3）
    const newId = this.db.transaction(() => {
      const result = this.db.insert(
        `INSERT INTO todo_category (name, parent_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL)`,
        [name, data.parent_id, now, now],
      );
      // category 仅 name 作为可搜索字段，body 为空
      this.searchService?.syncFts('category', result.lastRowid, { title: name, body: '' });
      return result.lastRowid;
    });
    logger.info(`Category created: id=${newId}, name='${name}'`);
    return this.getById(newId)!;
  }

  /**
   * 更新分类（name / parent_id）
   *
   * 若变更 parent_id，需校验：
   * 1. 新 parent 不形成环（不能把自己设为自己的子节点）
   * 2. 新位置不超出最大深度
   */
  update(id: number, patch: { name?: string; parent_id?: number | null }): TodoCategory {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`Category ${id} not found`);
    }

    const now = Date.now();
    const sets: string[] = ['updated_at = ?'];
    const params: Array<string | number | null> = [now];

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (name.length === 0) {
        throw new Error('Category name cannot be empty');
      }
      sets.push('name = ?');
      params.push(name);
    }

    if (patch.parent_id !== undefined && patch.parent_id !== existing.parent_id) {
      const newParentId = patch.parent_id;
      // 环检测：不能把自己设为自己的子孙
      if (newParentId !== null) {
        if (newParentId === id) {
          throw new Error('Cannot set parent to self');
        }
        if (this.isDescendant(newParentId, id)) {
          throw new Error('Cannot move category under its own descendant (cycle)');
        }
      }
      // 深度校验
      this.validateDepth(newParentId, MAX_CATEGORY_DEPTH);
      sets.push('parent_id = ?');
      params.push(newParentId);
    }

    params.push(id);
    this.db.transaction(() => {
      this.db.execute(
        `UPDATE todo_category SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
        params,
      );
      // 仅 name 变更时才同步 FTS（parent_id 不影响可搜索内容）
      if (patch.name !== undefined) {
        this.searchService?.syncFts('category', id, { title: patch.name.trim(), body: '' });
      }
    });

    return this.getById(id)!;
  }

  /**
   * 软删除分类：递归软删除子 category + 关联 todo_list + todo_item + todo_document。
   * 使用单事务包装保证一致性，同时级联清理子树 + 关联实体的 FTS 索引。
   */
  delete(id: number): void {
    const existing = this.getById(id);
    if (!existing) {
      return;
    }

    const now = Date.now();
    // 收集所有子树 category id（含自身）
    const subtreeIds = this.collectSubtreeIds(id);
    const idList = subtreeIds.join(',');

    // 在删除前先收集所有需清理 FTS 的关联实体 id（删除后无法再查）
    const relatedListIds = this.db.query<{ id: number }>(
      `SELECT id FROM todo_list WHERE category_id IN (${idList}) AND deleted_at IS NULL`,
    ).map((r) => r.id);
    const relatedItemIds = this.db.query<{ id: number }>(
      `SELECT id FROM todo_item WHERE todo_list_id IN (SELECT id FROM todo_list WHERE category_id IN (${idList})) AND deleted_at IS NULL`,
    ).map((r) => r.id);
    const relatedDocIds = this.db.query<{ id: number }>(
      `SELECT id FROM todo_document WHERE todo_category_id IN (${idList}) AND deleted_at IS NULL`,
    ).map((r) => r.id);

    this.db.transaction(() => {
      this.db.execute(
        `UPDATE todo_category SET deleted_at = ?, updated_at = ? WHERE id IN (${idList}) AND deleted_at IS NULL`,
        [now, now],
      );
      // 软删除关联 todo_list
      this.db.execute(
        `UPDATE todo_list SET deleted_at = ?, updated_at = ? WHERE category_id IN (${idList}) AND deleted_at IS NULL`,
        [now, now],
      );
      // 软删除关联 todo_list 下的 todo_item
      this.db.execute(
        `UPDATE todo_item SET deleted_at = ?, updated_at = ?
         WHERE todo_list_id IN (SELECT id FROM todo_list WHERE category_id IN (${idList}))
         AND deleted_at IS NULL`,
        [now, now],
      );
      // 软删除关联 document
      this.db.execute(
        `UPDATE todo_document SET deleted_at = ?, updated_at = ? WHERE todo_category_id IN (${idList}) AND deleted_at IS NULL`,
        [now, now],
      );

      // 级联清理 FTS（FTS 不保留软删除）
      this.searchService?.syncFtsBatch('category', subtreeIds);
      this.searchService?.syncFtsBatch('todo_list', relatedListIds);
      this.searchService?.syncFtsBatch('todo_item', relatedItemIds);
      this.searchService?.syncFtsBatch('document', relatedDocIds);
    });

    logger.info(`Category deleted: id=${id}, subtree=${subtreeIds.length} nodes`);
  }

  /**
   * 恢复软删除分类：
   * - 若 parent 已删除（也在回收站），则将自身提升至根（parent_id=NULL），
   *   避免恢复后悬挂在已删除节点下。
   */
  restore(id: number): TodoCategory | undefined {
    const row = this.db.get<{ parent_id: number | null; deleted_at: number | null }>(
      `SELECT parent_id, deleted_at FROM todo_category WHERE id = ?`,
      [id],
    );
    if (!row || row.deleted_at === null) {
      // 不存在或未删除，查未删除视图返回
      return this.getById(id);
    }

    // 检查 parent 是否仍在回收站
    let promoteToRoot = false;
    if (row.parent_id !== null) {
      const parentRow = this.db.get<{ deleted_at: number | null }>(
        `SELECT deleted_at FROM todo_category WHERE id = ?`,
        [row.parent_id],
      );
      if (!parentRow || parentRow.deleted_at !== null) {
        promoteToRoot = true;
      }
    }

    const now = Date.now();
    this.db.transaction(() => {
      if (promoteToRoot) {
        this.db.execute(
          `UPDATE todo_category SET deleted_at = NULL, parent_id = NULL, updated_at = ? WHERE id = ?`,
          [now, id],
        );
      } else {
        this.db.execute(
          `UPDATE todo_category SET deleted_at = NULL, updated_at = ? WHERE id = ?`,
          [now, id],
        );
      }
      // 恢复后重建 FTS 索引
      const restored = this.getById(id);
      if (restored) {
        this.searchService?.syncFts('category', id, { title: restored.name, body: '' });
      }
    });
    logger.info(`Category restored: id=${id}, promotedToRoot=${promoteToRoot}`);
    return this.getById(id);
  }

  /** 按 id 获取未删除分类 */
  getById(id: number): TodoCategory | undefined {
    const row = this.db.get<TodoCategoryRow>(
      `SELECT id, name, parent_id, created_at, updated_at, deleted_at
       FROM todo_category WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    return row ? this.mapRow(row) : undefined;
  }

  /**
   * 获取全部未删除分类，构建树（含 list_count 聚合）。
   *
   * list_count 含子分类下的 list（递归聚合）。
   */
  getTree(): TodoCategoryNode[] {
    const categories = this.db.query<TodoCategoryRow>(
      `SELECT id, name, parent_id, created_at, updated_at, deleted_at
       FROM todo_category WHERE deleted_at IS NULL ORDER BY created_at ASC`,
    );

    if (categories.length === 0) {
      return [];
    }

    // 查询每个 category 直接关联的 list 计数
    const listCountRows = this.db.query<{ category_id: number; cnt: number }>(
      `SELECT category_id, COUNT(*) AS cnt FROM todo_list
       WHERE deleted_at IS NULL AND category_id IS NOT NULL
       GROUP BY category_id`,
    );
    const directCount = new Map<number, number>();
    for (const r of listCountRows) {
      directCount.set(r.category_id, r.cnt);
    }

    // 构建索引
    const nodeMap = new Map<number, TodoCategoryNode>();
    for (const c of categories) {
      nodeMap.set(c.id, {
        ...this.mapRow(c),
        children: [],
        list_count: directCount.get(c.id) ?? 0,
      });
    }

    // 组装父子关系
    const roots: TodoCategoryNode[] = [];
    for (const node of nodeMap.values()) {
      if (node.parent_id !== null && nodeMap.has(node.parent_id)) {
        nodeMap.get(node.parent_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    // 递归聚合子树 list_count
    for (const root of roots) {
      this.aggregateListCount(root, nodeMap);
    }

    return roots;
  }

  /** 获取指定分类下的直接子分类 */
  getChildren(parentId: number | null): TodoCategory[] {
    const rows = parentId === null
      ? this.db.query<TodoCategoryRow>(
          `SELECT id, name, parent_id, created_at, updated_at, deleted_at
           FROM todo_category WHERE parent_id IS NULL AND deleted_at IS NULL ORDER BY created_at ASC`,
        )
      : this.db.query<TodoCategoryRow>(
          `SELECT id, name, parent_id, created_at, updated_at, deleted_at
           FROM todo_category WHERE parent_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`,
          [parentId],
        );
    return rows.map((r) => this.mapRow(r));
  }

  /** 列出回收站中的分类 */
  listTrash(): TodoCategory[] {
    const rows = this.db.query<TodoCategoryRow>(
      `SELECT id, name, parent_id, created_at, updated_at, deleted_at
       FROM todo_category WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
    );
    return rows.map((r) => this.mapRow(r));
  }

  /**
   * 物理删除已软删除的分类（不可恢复）。
   *
   * 级联物理删除（依赖关系逆序）：
   *   todo_item_label → todo_document → todo_item → todo_list → todo_category
   *
   * 幂等性：先校验 `deleted_at IS NOT NULL`，未删除实体为 no-op（不抛错），
   * 避免误 purge 活跃数据。
   *
   * FTS 无需操作：软删除时已 syncFts(type, id, null) 清理，物理删除时 FTS 已无数据。
   *
   * @param id - 待物理删除的 category ID（必须已软删除）
   */
  purge(id: number): void {
    // 幂等校验：仅处理已软删除的实体
    const row = this.db.get<{ deleted_at: number | null }>(
      `SELECT deleted_at FROM todo_category WHERE id = ?`,
      [id],
    );
    if (!row || row.deleted_at === null) {
      return;
    }

    // 收集子树所有 category id（含已软删除子节点，故用 collectSubtreeIdsAll）
    const subtreeIds = this.collectSubtreeIdsAll(id);
    const idList = subtreeIds.join(',');

    // 收集级联涉及的 list / item id（用于清理 item_label 和 document）
    const listIdsRows = this.db.query<{ id: number }>(
      `SELECT id FROM todo_list WHERE category_id IN (${idList})`,
    );
    const listIds = listIdsRows.map((r) => r.id);
    const listIdList = listIds.length > 0 ? listIds.join(',') : 'NULL';
    const itemIdsRows = this.db.query<{ id: number }>(
      `SELECT id FROM todo_item WHERE todo_list_id IN (${listIdList})`,
    );
    const itemIds = itemIdsRows.map((r) => r.id);

    this.db.transaction(() => {
      // 1. 清理 todo_item_label 关联（item 维度）
      if (itemIds.length > 0) {
        const itemIdList = itemIds.join(',');
        this.db.execute(
          `DELETE FROM todo_item_label WHERE todo_item_id IN (${itemIdList})`,
        );
      }
      // 2. 物理删除关联 document（category 维度）
      this.db.execute(
        `DELETE FROM todo_document WHERE todo_category_id IN (${idList})`,
      );
      // 2b. 物理删除关联 document（item 维度，子树 list 下的 item 关联文档）
      if (itemIds.length > 0) {
        const itemIdList = itemIds.join(',');
        this.db.execute(
          `DELETE FROM todo_document WHERE todo_item_id IN (${itemIdList})`,
        );
      }
      // 3. 物理删除 todo_item（子树 list 下）
      if (listIds.length > 0) {
        this.db.execute(
          `DELETE FROM todo_item WHERE todo_list_id IN (${listIdList})`,
        );
      }
      // 4. 物理删除 todo_list（子树 category 下）
      this.db.execute(
        `DELETE FROM todo_list WHERE category_id IN (${idList})`,
      );
      // 5. 物理删除 todo_category（子树）
      this.db.execute(
        `DELETE FROM todo_category WHERE id IN (${idList})`,
      );
    });

    logger.info(`Category purged: id=${id}, subtree=${subtreeIds.length} nodes`);
  }

  /**
   * 校验在指定 parent 下新增/移动是否超过最大深度。
   * @param parentId - 新位置的父 id（null 表示根）
   * @param maxDepth - 最大允许深度
   * @throws Error("超出最大递归层级") 超出时抛错
   */
  validateDepth(parentId: number | null, maxDepth: number): void {
    if (parentId === null) {
      // 根节点深度为 1，恒满足 maxDepth >= 1
      return;
    }
    // 计算 parent 的链路深度（向上数到根的层数）
    let depth = 1;
    let cursor: number | null = parentId;
    const visited = new Set<number>();
    while (cursor !== null) {
      if (visited.has(cursor)) {
        // 环保护
        throw new Error('Detected cycle in category parent chain');
      }
      visited.add(cursor);
      depth += 1;
      if (depth > maxDepth) {
        throw new Error(`超出最大递归层级 (${maxDepth})`);
      }
      const row: { parent_id: number | null; deleted_at: number | null } | undefined = this.db.get(
        `SELECT parent_id, deleted_at FROM todo_category WHERE id = ?`,
        [cursor],
      );
      if (!row) {
        break;
      }
      cursor = row.parent_id;
    }
    // depth = 新节点所在层级（含自身）；<= maxDepth 通过
    if (depth > maxDepth) {
      throw new Error(`超出最大递归层级 (${maxDepth})`);
    }
  }

  // =========================================================================
  // 内部工具
  // =========================================================================

  /** 收集子树所有 category id（含自身），BFS */
  private collectSubtreeIds(rootId: number): number[] {
    const result: number[] = [];
    const queue: number[] = [rootId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);
      const children = this.db.query<{ id: number }>(
        `SELECT id FROM todo_category WHERE parent_id = ? AND deleted_at IS NULL`,
        [current],
      );
      for (const c of children) {
        queue.push(c.id);
      }
    }
    return result;
  }

  /**
   * 收集子树所有 category id（含自身），**不过滤 deleted_at**。
   *
   * 与 `collectSubtreeIds` 区别：用于 purge 时收集已被软删除的子节点
   * （软删除级联时子节点 deleted_at 已被标记，但仍需 purge）。
   */
  private collectSubtreeIdsAll(rootId: number): number[] {
    const result: number[] = [];
    const queue: number[] = [rootId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);
      const children = this.db.query<{ id: number }>(
        `SELECT id FROM todo_category WHERE parent_id = ?`,
        [current],
      );
      for (const c of children) {
        queue.push(c.id);
      }
    }
    return result;
  }

  /** 判断 candidateId 是否为 ancestorId 的子孙 */
  private isDescendant(candidateId: number, ancestorId: number): boolean {
    let cursor: number | null = candidateId;
    const visited = new Set<number>();
    while (cursor !== null) {
      if (visited.has(cursor)) return false;
      visited.add(cursor);
      if (cursor === ancestorId) return true;
      const row: { parent_id: number | null } | undefined = this.db.get(
        `SELECT parent_id FROM todo_category WHERE id = ?`,
        [cursor],
      );
      if (!row) return false;
      cursor = row.parent_id;
    }
    return false;
  }

  /** 递归聚合子树 list_count：node.list_count += sum(children.list_count) */
  private aggregateListCount(node: TodoCategoryNode, _nodeMap: Map<number, TodoCategoryNode>): number {
    let total = node.list_count;
    for (const child of node.children) {
      total += this.aggregateListCount(child, _nodeMap);
    }
    node.list_count = total;
    return total;
  }

  private mapRow(row: TodoCategoryRow): TodoCategory {
    return {
      id: row.id,
      name: row.name,
      parent_id: row.parent_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at ?? null,
    };
  }
}

interface TodoCategoryRow {
  id: number;
  name: string;
  parent_id: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}
