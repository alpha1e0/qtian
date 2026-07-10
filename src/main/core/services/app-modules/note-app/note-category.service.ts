import { DBManager } from '@/core/database/db-manager';
import { createLogger } from '@/core/utils/logger';
import { NoteCategory, NoteCategoryNode, MAX_CATEGORY_DEPTH } from './types';
import { NoteSearchService } from './note-search.service';

const logger = createLogger('NoteCategoryService');

/**
 * Category Service — note-app 递归分组 CRUD + 树构建 + 递归层级校验
 *
 * 职责：
 * - create / update / delete（递归软删除子 category + 关联 doc）
 * - restore（parent 已删则提升至根）
 * - getTree（内存构建树 + doc_count 聚合）
 * - validateDepth（递归层级上限校验）
 *
 * FTS 集成：searchService 为可选依赖（默认 null）；
 * 写操作在事务内调用 `searchService?.syncFts(...)`，无 searchService 时为 noop。
 *
 * 与 todo-category.service 的区别：
 * - 级联软删除仅涉及子 category + 关联 doc（无 todo_list/todo_item 层级）
 * - doc_count 聚合（而非 list_count）
 * - category 不纳入 FTS（note-app 仅索引 doc）
 */
export class NoteCategoryService {
  private db: DBManager;
  private searchService: NoteSearchService | null;

  constructor(db: DBManager, searchService: NoteSearchService | null = null) {
    this.db = db;
    this.searchService = searchService;
  }

  /** 创建分类（parent_id=null 表示根分类） */
  create(data: { name: string; parent_id: number | null }): NoteCategory {
    const name = data.name.trim();
    if (name.length === 0) {
      throw new Error('Category name cannot be empty');
    }

    this.validateDepth(data.parent_id, MAX_CATEGORY_DEPTH);

    const now = Date.now();
    const newId = this.db.transaction(() => {
      const result = this.db.insert(
        `INSERT INTO note_category (name, parent_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL)`,
        [name, data.parent_id, now, now],
      );
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
  update(id: number, patch: { name?: string; parent_id?: number | null }): NoteCategory {
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
      if (newParentId !== null) {
        if (newParentId === id) {
          throw new Error('Cannot set parent to self');
        }
        if (this.isDescendant(newParentId, id)) {
          throw new Error('Cannot move category under its own descendant (cycle)');
        }
      }
      this.validateDepth(newParentId, MAX_CATEGORY_DEPTH);
      sets.push('parent_id = ?');
      params.push(newParentId);
    }

    params.push(id);
    this.db.execute(
      `UPDATE note_category SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );

    return this.getById(id)!;
  }

  /**
   * 软删除分类：递归软删除子 category + 关联 doc。
   * 使用单事务包装保证一致性，同时级联清理子树 + 关联实体的 FTS 索引。
   */
  delete(id: number): void {
    const existing = this.getById(id);
    if (!existing) {
      return;
    }

    const now = Date.now();
    const subtreeIds = this.collectSubtreeIds(id);
    const idList = subtreeIds.join(',');

    // 在删除前先收集关联 doc id（删除后无法再查）
    const relatedDocIds = this.db.query<{ id: number }>(
      `SELECT id FROM note_doc WHERE category_id IN (${idList}) AND deleted_at IS NULL`,
    ).map((r) => r.id);

    this.db.transaction(() => {
      this.db.execute(
        `UPDATE note_category SET deleted_at = ?, updated_at = ? WHERE id IN (${idList}) AND deleted_at IS NULL`,
        [now, now],
      );
      this.db.execute(
        `UPDATE note_doc SET deleted_at = ?, updated_at = ? WHERE category_id IN (${idList}) AND deleted_at IS NULL`,
        [now, now],
      );

      // 级联清理 FTS（FTS 不保留软删除）
      this.searchService?.syncFtsBatch('doc', relatedDocIds);
    });

    logger.info(`Category deleted: id=${id}, subtree=${subtreeIds.length} nodes`);
  }

  /**
   * 恢复软删除分类：
   * - 若 parent 已删除（也在回收站），则将自身提升至根（parent_id=NULL）
   */
  restore(id: number): NoteCategory | undefined {
    const row = this.db.get<{ parent_id: number | null; deleted_at: number | null }>(
      `SELECT parent_id, deleted_at FROM note_category WHERE id = ?`,
      [id],
    );
    if (!row || row.deleted_at === null) {
      return this.getById(id);
    }

    let promoteToRoot = false;
    if (row.parent_id !== null) {
      const parentRow = this.db.get<{ deleted_at: number | null }>(
        `SELECT deleted_at FROM note_category WHERE id = ?`,
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
          `UPDATE note_category SET deleted_at = NULL, parent_id = NULL, updated_at = ? WHERE id = ?`,
          [now, id],
        );
      } else {
        this.db.execute(
          `UPDATE note_category SET deleted_at = NULL, updated_at = ? WHERE id = ?`,
          [now, id],
        );
      }
    });
    logger.info(`Category restored: id=${id}, promotedToRoot=${promoteToRoot}`);
    return this.getById(id);
  }

  /** 按 id 获取未删除分类 */
  getById(id: number): NoteCategory | undefined {
    const row = this.db.get<NoteCategoryRow>(
      `SELECT id, name, parent_id, created_at, updated_at, deleted_at
       FROM note_category WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    return row ? this.mapRow(row) : undefined;
  }

  /**
   * 获取全部未删除分类，构建树（含 doc_count 聚合）。
   *
   * doc_count 含子分类下的 doc（递归聚合）。
   */
  getTree(): NoteCategoryNode[] {
    const categories = this.db.query<NoteCategoryRow>(
      `SELECT id, name, parent_id, created_at, updated_at, deleted_at
       FROM note_category WHERE deleted_at IS NULL ORDER BY created_at ASC`,
    );

    if (categories.length === 0) {
      return [];
    }

    // 查询每个 category 直接关联的 doc 计数
    const docCountRows = this.db.query<{ category_id: number; cnt: number }>(
      `SELECT category_id, COUNT(*) AS cnt FROM note_doc
       WHERE deleted_at IS NULL AND category_id IS NOT NULL
       GROUP BY category_id`,
    );
    const directCount = new Map<number, number>();
    for (const r of docCountRows) {
      directCount.set(r.category_id, r.cnt);
    }

    // 构建索引
    const nodeMap = new Map<number, NoteCategoryNode>();
    for (const c of categories) {
      nodeMap.set(c.id, {
        ...this.mapRow(c),
        children: [],
        doc_count: directCount.get(c.id) ?? 0,
      });
    }

    // 组装父子关系
    const roots: NoteCategoryNode[] = [];
    for (const node of nodeMap.values()) {
      if (node.parent_id !== null && nodeMap.has(node.parent_id)) {
        nodeMap.get(node.parent_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    // 递归聚合子树 doc_count
    for (const root of roots) {
      this.aggregateDocCount(root);
    }

    return roots;
  }

  /** 列出回收站中的分类 */
  listTrash(): NoteCategory[] {
    const rows = this.db.query<NoteCategoryRow>(
      `SELECT id, name, parent_id, created_at, updated_at, deleted_at
       FROM note_category WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
    );
    return rows.map((r) => this.mapRow(r));
  }

  /**
   * 物理删除已软删除的分类（不可恢复）。
   *
   * 级联物理删除：
   *   note_doc_label → note_doc → note_category（子树）
   *
   * 幂等性：先校验 `deleted_at IS NOT NULL`，未删除实体为 no-op。
   */
  purge(id: number): void {
    const row = this.db.get<{ deleted_at: number | null }>(
      `SELECT deleted_at FROM note_category WHERE id = ?`,
      [id],
    );
    if (!row || row.deleted_at === null) {
      return;
    }

    // 收集子树所有 category id（含已软删除子节点）
    const subtreeIds = this.collectSubtreeIdsAll(id);
    const idList = subtreeIds.join(',');

    // 收集关联 doc id
    const docIdsRows = this.db.query<{ id: number }>(
      `SELECT id FROM note_doc WHERE category_id IN (${idList})`,
    );
    const docIds = docIdsRows.map((r) => r.id);

    this.db.transaction(() => {
      // 1. 清理 note_doc_label 关联
      if (docIds.length > 0) {
        const docIdList = docIds.join(',');
        this.db.execute(
          `DELETE FROM note_doc_label WHERE doc_id IN (${docIdList})`,
        );
      }
      // 2. 物理删除关联 doc
      if (docIds.length > 0) {
        const docIdList = docIds.join(',');
        this.db.execute(
          `DELETE FROM note_doc WHERE id IN (${docIdList})`,
        );
      }
      // 3. 物理删除 note_category（子树）
      this.db.execute(
        `DELETE FROM note_category WHERE id IN (${idList})`,
      );
    });

    logger.info(`Category purged: id=${id}, subtree=${subtreeIds.length} nodes`);
  }

  /**
   * 校验在指定 parent 下新增/移动是否超过最大深度。
   * @throws Error("超出最大递归层级") 超出时抛错
   */
  validateDepth(parentId: number | null, maxDepth: number): void {
    if (parentId === null) {
      return;
    }
    let depth = 1;
    let cursor: number | null = parentId;
    const visited = new Set<number>();
    while (cursor !== null) {
      if (visited.has(cursor)) {
        throw new Error('Detected cycle in category parent chain');
      }
      visited.add(cursor);
      depth += 1;
      if (depth > maxDepth) {
        throw new Error(`超出最大递归层级 (${maxDepth})`);
      }
      const row: { parent_id: number | null; deleted_at: number | null } | undefined = this.db.get(
        `SELECT parent_id, deleted_at FROM note_category WHERE id = ?`,
        [cursor],
      );
      if (!row) {
        break;
      }
      cursor = row.parent_id;
    }
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
        `SELECT id FROM note_category WHERE parent_id = ? AND deleted_at IS NULL`,
        [current],
      );
      for (const c of children) {
        queue.push(c.id);
      }
    }
    return result;
  }

  /** 收集子树所有 category id（含自身），不过滤 deleted_at */
  private collectSubtreeIdsAll(rootId: number): number[] {
    const result: number[] = [];
    const queue: number[] = [rootId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);
      const children = this.db.query<{ id: number }>(
        `SELECT id FROM note_category WHERE parent_id = ?`,
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
        `SELECT parent_id FROM note_category WHERE id = ?`,
        [cursor],
      );
      if (!row) return false;
      cursor = row.parent_id;
    }
    return false;
  }

  /** 递归聚合子树 doc_count */
  private aggregateDocCount(node: NoteCategoryNode): number {
    let total = node.doc_count;
    for (const child of node.children) {
      total += this.aggregateDocCount(child);
    }
    node.doc_count = total;
    return total;
  }

  private mapRow(row: NoteCategoryRow): NoteCategory {
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

interface NoteCategoryRow {
  id: number;
  name: string;
  parent_id: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}
