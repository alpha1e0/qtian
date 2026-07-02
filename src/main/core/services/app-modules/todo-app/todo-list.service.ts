import { DBManager } from '@/core/database/db-manager';
import { createLogger } from '@/core/utils/logger';
import { TodoList } from './types';
import { TodoLabelService } from './todo-label.service';
import { TodoSearchService } from './todo-search.service';

const logger = createLogger('TodoListService');

/** 默认描述 */
const DEFAULT_DESCRIPTION = '';

/**
 * TodoList Service — 列表 CRUD + 级联软删除 + 标签多对多维护 + 收藏
 *
 * 职责：
 * - list（按 categoryId 过滤，null 表示未分类）
 * - create / update / delete（级联 todo_item + document）/ restore
 * - 标签作用域：todo_list_label 多对多（label_ids 在 create/update 时全量覆盖）
 * - listByLabel：列出某 label 关联的未删除 todo_list（标签云视图使用）
 * - toggleFavorite / listFavorites：收藏快捷置顶（sidebar 收藏 tab 数据源）
 *
 * FTS 集成（Phase 3）：searchService 为可选依赖（默认 null）。
 * 可搜索字段：name（title） + description（body）。
 */
export class TodoListService {
  private db: DBManager;
  private labelService: TodoLabelService;
  private searchService: TodoSearchService | null;

  constructor(
    db: DBManager,
    labelService: TodoLabelService,
    searchService: TodoSearchService | null = null,
  ) {
    this.db = db;
    this.labelService = labelService;
    this.searchService = searchService;
  }

  /**
   * 列出 todo_list：
   * - categoryId === undefined：所有未删除列表
   * - categoryId === null：无分类列表（category_id IS NULL）
   * - categoryId 为数字：该分类下的列表
   */
  list(categoryId?: number | null): TodoList[] {
    let rows: TodoListRow[];
    if (categoryId === undefined) {
      rows = this.db.query<TodoListRow>(
        `SELECT id, name, description, category_id, is_favorite, created_at, updated_at, deleted_at
         FROM todo_list WHERE deleted_at IS NULL ORDER BY created_at ASC`,
      );
    } else if (categoryId === null) {
      // 未分类
      rows = this.db.query<TodoListRow>(
        `SELECT id, name, description, category_id, is_favorite, created_at, updated_at, deleted_at
         FROM todo_list WHERE category_id IS NULL AND deleted_at IS NULL ORDER BY created_at ASC`,
      );
    } else {
      rows = this.db.query<TodoListRow>(
        `SELECT id, name, description, category_id, is_favorite, created_at, updated_at, deleted_at
         FROM todo_list WHERE category_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`,
        [categoryId],
      );
    }
    return rows.map((r) => this.mapRow(r, this.labelService.getListLabels(r.id)));
  }

  /** 按 id 获取未删除 todo_list（含 label_ids） */
  getById(id: number): TodoList | undefined {
    const row = this.db.get<TodoListRow>(
      `SELECT id, name, description, category_id, is_favorite, created_at, updated_at, deleted_at
       FROM todo_list WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    return row ? this.mapRow(row, this.labelService.getListLabels(id)) : undefined;
  }

  /** 创建 todo_list */
  create(data: {
    name: string;
    description?: string;
    category_id?: number | null;
    label_ids?: number[];
  }): TodoList {
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
      if (data.label_ids && data.label_ids.length > 0) {
        this.labelService.setListLabels(result.lastRowid, data.label_ids);
      }
      this.searchService?.syncFts('todo_list', result.lastRowid, { title: name, body: description });
      return result.lastRowid;
    });
    logger.info(`TodoList created: id=${newId}, name='${name}'`);
    return this.getById(newId)!;
  }

  /** 更新 todo_list（name / description / category_id / label_ids） */
  update(
    id: number,
    patch: {
      name?: string;
      description?: string;
      category_id?: number | null;
      label_ids?: number[];
    },
  ): TodoList {
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
      // 标签关联（全量覆盖）
      if (patch.label_ids !== undefined) {
        this.labelService.setListLabels(id, patch.label_ids);
      }
      // 仅 name/description 变更时才同步 FTS（category_id / label_ids 不影响可搜索内容）
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

  /** 列出某 label 关联的未删除 todo_list（标签云视图使用） */
  listByLabel(labelId: number): TodoList[] {
    const rows = this.db.query<TodoListRow>(
      `SELECT tl.id, tl.name, tl.description, tl.category_id, tl.is_favorite, tl.created_at, tl.updated_at, tl.deleted_at
       FROM todo_list tl
       INNER JOIN todo_list_label tll ON tl.id = tll.todo_list_id
       WHERE tll.label_id = ? AND tl.deleted_at IS NULL
       ORDER BY tl.created_at ASC`,
      [labelId],
    );
    return rows.map((r) => this.mapRow(r, this.labelService.getListLabels(r.id)));
  }

  /**
   * 切换 todo_list 收藏状态（收藏 ↔ 取消收藏）。
   *
   * 幂等安全：连续两次调用恢复原态。仅作用于未删除实体（已删除的 list
   * 即使切换也不会被 listFavorites 查出，故无副作用）。不涉及 FTS——
   * 收藏是展示属性，不属于可搜索内容。
   *
   * @param id - 目标 todo_list id
   * @returns 更新后的 TodoList；实体不存在时返回 undefined
   */
  toggleFavorite(id: number): TodoList | undefined {
    const existing = this.getById(id);
    if (!existing) {
      return undefined;
    }
    const now = Date.now();
    const next = existing.is_favorite ? 0 : 1;
    this.db.execute(
      `UPDATE todo_list SET is_favorite = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [next, now, id],
    );
    logger.info(`TodoList favorite toggled: id=${id}, is_favorite=${next === 1}`);
    return this.getById(id);
  }

  /**
   * 列出所有已收藏且未删除的 todo_list（sidebar 收藏 tab 数据源）。
   * 按 created_at ASC 排序，与 list / listByLabel 保持一致。
   */
  listFavorites(): TodoList[] {
    const rows = this.db.query<TodoListRow>(
      `SELECT id, name, description, category_id, is_favorite, created_at, updated_at, deleted_at
       FROM todo_list WHERE is_favorite = 1 AND deleted_at IS NULL ORDER BY created_at ASC`,
    );
    return rows.map((r) => this.mapRow(r, this.labelService.getListLabels(r.id)));
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
    // document 通过 todo_list_id 直接关联 + 通过 todo_item_id 间接关联，分别收集后合并去重
    const docByList = this.db.query<{ id: number }>(
      `SELECT id FROM todo_document WHERE deleted_at IS NULL AND todo_list_id = ?`,
      [id],
    ).map((r) => r.id);
    const docByItem = this.db.query<{ id: number }>(
      `SELECT id FROM todo_document
       WHERE deleted_at IS NULL
         AND todo_item_id IN (SELECT id FROM todo_item WHERE todo_list_id = ?)`,
      [id],
    ).map((r) => r.id);
    const relatedDocIds = Array.from(new Set([...docByList, ...docByItem]));

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
      // 软删除关联 document（拆为两条避免 OR 写法以兼容 mock-db）
      this.db.execute(
        `UPDATE todo_document SET deleted_at = ?, updated_at = ?
         WHERE deleted_at IS NULL AND todo_list_id = ?`,
        [now, now, id],
      );
      this.db.execute(
        `UPDATE todo_document SET deleted_at = ?, updated_at = ?
         WHERE deleted_at IS NULL
           AND todo_item_id IN (SELECT id FROM todo_item WHERE todo_list_id = ?)`,
        [now, now, id],
      );
      // 清理 todo_list_label 关联（todo_item_label 由 item 维度清理，保留兼容）
      this.db.execute(`DELETE FROM todo_list_label WHERE todo_list_id = ?`, [id]);

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

  /** 列出回收站中的 todo_list（label_ids 返回 []，因为软删除时已清关联） */
  listTrash(): TodoList[] {
    const rows = this.db.query<TodoListRow>(
      `SELECT id, name, description, category_id, is_favorite, created_at, updated_at, deleted_at
       FROM todo_list WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
    );
    return rows.map((r) => this.mapRow(r, []));
  }

  /**
   * 物理删除已软删除的 todo_list（不可恢复）。
   *
   * 级联物理删除（依赖关系逆序）：
   *   todo_list_label → todo_item_label → todo_document → todo_item → todo_list
   *
   * 幂等性：先校验 `deleted_at IS NOT NULL`，未删除实体为 no-op。
   * FTS 无需操作：软删除时已清理。
   *
   * @param id - 待物理删除的 todo_list ID（必须已软删除）
   */
  purge(id: number): void {
    const row = this.db.get<{ deleted_at: number | null }>(
      `SELECT deleted_at FROM todo_list WHERE id = ?`,
      [id],
    );
    if (!row || row.deleted_at === null) {
      return;
    }

    // 收集关联 item id（删除后无法再查）
    const itemIdsRows = this.db.query<{ id: number }>(
      `SELECT id FROM todo_item WHERE todo_list_id = ?`,
      [id],
    );
    const itemIds = itemIdsRows.map((r) => r.id);

    this.db.transaction(() => {
      // 1. 清理 todo_list_label 关联（当前作用域）
      this.db.execute(
        `DELETE FROM todo_list_label WHERE todo_list_id = ?`,
        [id],
      );
      // 2. 清理 todo_item_label 关联（历史作用域，保留清理以防残留）
      if (itemIds.length > 0) {
        const itemIdList = itemIds.join(',');
        this.db.execute(
          `DELETE FROM todo_item_label WHERE todo_item_id IN (${itemIdList})`,
        );
      }
      // 3. 物理删除关联 document（todo_list 维度）
      this.db.execute(
        `DELETE FROM todo_document WHERE todo_list_id = ?`,
        [id],
      );
      // 3b. 物理删除关联 document（item 维度）
      if (itemIds.length > 0) {
        const itemIdList = itemIds.join(',');
        this.db.execute(
          `DELETE FROM todo_document WHERE todo_item_id IN (${itemIdList})`,
        );
      }
      // 4. 物理删除 todo_item
      this.db.execute(
        `DELETE FROM todo_item WHERE todo_list_id = ?`,
        [id],
      );
      // 5. 物理删除 todo_list
      this.db.execute(
        `DELETE FROM todo_list WHERE id = ?`,
        [id],
      );
    });

    logger.info(`TodoList purged: id=${id}, items=${itemIds.length}`);
  }

  // =========================================================================
  // 内部工具
  // =========================================================================

  private mapRow(row: TodoListRow, labelIds: number[]): TodoList {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category_id: row.category_id,
      label_ids: labelIds,
      is_favorite: row.is_favorite === 1,
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
  /** 0=未收藏 1=已收藏（SQLite 无原生布尔，按整数存储） */
  is_favorite: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}
