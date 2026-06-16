import { DBManager } from '@/core/database/db-manager';
import { createLogger } from '@/core/utils/logger';
import { TodoCategory, TodoCategoryNode, MAX_CATEGORY_DEPTH } from './types';

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
 * 递归软删除使用 db 事务保证一致性。
 */
export class TodoCategoryService {
  private db: DBManager;

  constructor(db: DBManager) {
    this.db = db;
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
    const result = this.db.insert(
      `INSERT INTO todo_category (name, parent_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL)`,
      [name, data.parent_id, now, now],
    );
    logger.info(`Category created: id=${result.lastRowid}, name='${name}'`);
    return this.getById(result.lastRowid)!;
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
    this.db.execute(
      `UPDATE todo_category SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );

    return this.getById(id)!;
  }

  /**
   * 软删除分类：递归软删除子 category + 关联 todo_list + todo_item + todo_document。
   * 使用单事务包装保证一致性。
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
