import { DBManager } from '@/core/database/db-manager';
import { createLogger } from '@/core/utils/logger';
import { TodoList } from './types';
import { TodoSearchService } from './todo-search.service';

const logger = createLogger('TodoListService');

/** 默认描述 */
const DEFAULT_DESCRIPTION = '';

/**
 * TodoList Service — 列表 CRUD + 级联软删除
 *
 * 职责：
 * - list（按 categoryId 过滤，null 表示未分类）
 * - create / update / delete（级联 todo_item + document）/ restore
 *
 * FTS 集成（Phase 3）：searchService 为可选依赖（默认 null）。
 * 可搜索字段：name（title） + description（body）。
 */
export class TodoListService {
  private db: DBManager;
  private searchService: TodoSearchService | null;

  constructor(db: DBManager, searchService: TodoSearchService | null = null) {
    this.db = db;
    this.searchService = searchService;
  }

  /**
   * 列出 todo_list：
   * - categoryId === null 且 includeUncategorized=true：未分类列表
   * - categoryId === null 且 includeUncategorized=false：所有未删除列表
   * - categoryId 为数字：该分类下的列表
   */
  list(categoryId?: number | null): TodoList[] {
    if (categoryId === undefined) {
      const rows = this.db.query<TodoListRow>(
        `SELECT id, name, description, category_id, created_at, updated_at, deleted_at
         FROM todo_list WHERE deleted_at IS NULL ORDER BY created_at ASC`,
      );
      return rows.map((r) => this.mapRow(r));
    }
    if (categoryId === null) {
      // 未分类
      const rows = this.db.query<TodoListRow>(
        `SELECT id, name, description, category_id, created_at, updated_at, deleted_at
         FROM todo_list WHERE category_id IS NULL AND deleted_at IS NULL ORDER BY created_at ASC`,
      );
      return rows.map((r) => this.mapRow(r));
    }
    const rows = this.db.query<TodoListRow>(
      `SELECT id, name, description, category_id, created_at, updated_at, deleted_at
       FROM todo_list WHERE category_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`,
      [categoryId],
    );
    return rows.map((r) => this.mapRow(r));
  }

  /** 按 id 获取未删除 todo_list */
  getById(id: number): TodoList | undefined {
    const row = this.db.get<TodoListRow>(
      `SELECT id, name, description, category_id, created_at, updated_at, deleted_at
       FROM todo_list WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    return row ? this.mapRow(row) : undefined;
  }

  /** 创建 todo_list */
  create(data: { name: string; description?: string; category_id?: number | null }): TodoList {
    const name = data.name.trim();
    if (name.length === 0) {
      throw new Error('TodoList name cannot be empty');
    }
    const now = Date.now();
    const description = data.description ?? DEFAULT_DESCRIPTION;
    const newId = this.db.transaction(() => {
      const result = this.db.insert(
        `INSERT INTO todo_list (name, description, category_id, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
        [name, description, data.category_id ?? null, now, now],
      );
      this.searchService?.syncFts('todo_list', result.lastRowid, { title: name, body: description });
      return result.lastRowid;
    });
    logger.info(`TodoList created: id=${newId}, name='${name}'`);
    return this.getById(newId)!;
  }

  /** 更新 todo_list（name / description / category_id） */
  update(id: number, patch: { name?: string; description?: string; category_id?: number | null }): TodoList {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`TodoList ${id} not found`);
    }

    const now = Date.now();
    const sets: string[] = ['updated_at = ?'];
    const params: Array<string | number | null> = [now];

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (name.length === 0) {
        throw new Error('TodoList name cannot be empty');
      }
      sets.push('name = ?');
      params.push(name);
    }
    if (patch.description !== undefined) {
      sets.push('description = ?');
      params.push(patch.description);
    }
    if (patch.category_id !== undefined) {
      sets.push('category_id = ?');
      params.push(patch.category_id);
    }

    params.push(id);
    this.db.transaction(() => {
      this.db.execute(
        `UPDATE todo_list SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
        params,
      );
      // 仅 name/description 变更时才同步 FTS（category_id 移动不影响可搜索内容）
      if (patch.name !== undefined || patch.description !== undefined) {
        const after = this.getById(id);
        if (after) {
          this.searchService?.syncFts('todo_list', id, {
            title: after.name,
            body: after.description,
          });
        }
      }
    });

    return this.getById(id)!;
  }

  /**
   * 软删除 todo_list：级联软删除其下的 todo_item + 关联 document。
   * 同事务内清理 list + 子 item + 子 document 的 FTS 索引。
   */
  delete(id: number): void {
    const existing = this.getById(id);
    if (!existing) {
      return;
    }
    const now = Date.now();
    // 删除前先收集关联实体 id（删除后无法再查）
    const relatedItemIds = this.db.query<{ id: number }>(
      `SELECT id FROM todo_item WHERE todo_list_id = ? AND deleted_at IS NULL`,
      [id],
    ).map((r) => r.id);
    const relatedDocIds = this.db.query<{ id: number }>(
      `SELECT id FROM todo_document WHERE todo_item_id IN (SELECT id FROM todo_item WHERE todo_list_id = ?) AND deleted_at IS NULL`,
      [id],
    ).map((r) => r.id);

    this.db.transaction(() => {
      this.db.execute(
        `UPDATE todo_list SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
        [now, now, id],
      );
      // 级联软删除 todo_item（递归子项在此一并标记，由 todo_item 自身的递归软删除处理；
      // 这里仅删除该 list 下所有 item，子 item 同属一个 list 故一并标记）
      this.db.execute(
        `UPDATE todo_item SET deleted_at = ?, updated_at = ? WHERE todo_list_id = ? AND deleted_at IS NULL`,
        [now, now, id],
      );
      // 软删除关联 document（item 维度的 document 也一并清理）
      this.db.execute(
        `UPDATE todo_document SET deleted_at = ?, updated_at = ?
         WHERE todo_item_id IN (SELECT id FROM todo_item WHERE todo_list_id = ?) AND deleted_at IS NULL`,
        [now, now, id],
      );

      // 级联清理 FTS
      this.searchService?.syncFtsBatch('todo_list', [id]);
      this.searchService?.syncFtsBatch('todo_item', relatedItemIds);
      this.searchService?.syncFtsBatch('document', relatedDocIds);
    });
    logger.info(`TodoList deleted: id=${id}`);
  }

  /** 恢复软删除的 todo_list（item/document 的恢复需独立调用对应 Service） */
  restore(id: number): TodoList | undefined {
    const now = Date.now();
    this.db.transaction(() => {
      const changes = this.db.execute(
        `UPDATE todo_list SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL`,
        [now, id],
      );
      if (changes > 0) {
        const restored = this.getById(id);
        if (restored) {
          this.searchService?.syncFts('todo_list', id, {
            title: restored.name,
            body: restored.description,
          });
        }
      }
    });
    logger.info(`TodoList restored: id=${id}`);
    return this.getById(id);
  }

  // =========================================================================
  // 内部工具
  // =========================================================================

  private mapRow(row: TodoListRow): TodoList {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category_id: row.category_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at ?? null,
    };
  }
}

interface TodoListRow {
  id: number;
  name: string;
  description: string;
  category_id: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}
