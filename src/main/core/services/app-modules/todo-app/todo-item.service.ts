import { DBManager } from '@/core/database/db-manager';
import { createLogger } from '@/core/utils/logger';
import {
  TodoItem,
  TodoItemNode,
  TodoItemPriority,
  TodoItemStatus,
  MAX_TODO_ITEM_DEPTH,
  VALID_STATUS_TRANSITIONS,
} from './types';
import { TodoLabelService } from './todo-label.service';
import { TodoSearchService } from './todo-search.service';

const logger = createLogger('TodoItemService');

/** 默认值 */
const DEFAULT_PRIORITY: TodoItemPriority = 'normal';
const DEFAULT_STATUS: TodoItemStatus = 'init';

/**
 * TodoItem Service — 条目 CRUD + 递归层级校验 + 状态机校验 + 进度联动
 *
 * 职责：
 * - create / update / delete（递归软删除子 item + document）/ restore
 * - getById / getTreeByList / listByLabel
 * - updateStatus（含状态机校验）
 * - recalcParentProgress（含防环检测）
 * - collectSubtree（Phase 5 任务拼装用，本期实现）
 *
 * FTS 集成（Phase 3）：searchService 为可选依赖（默认 null）。
 * 可搜索字段：title + description + task_prompt（body = description + task_prompt 合并分词）。
 * updateStatus / 进度变更不触发 FTS（不影响可搜索内容）。
 *
 * 进度联动规则：
 *   parent.progress = AVG(未删除、非 is_manual_progress 子项 progress)
 *   parent.is_manual_progress=true 时跳过（不自动覆盖）
 *
 * create/update 后自动触发 recalcParentProgress。
 */
export class TodoItemService {
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
   * 拼装 todo_item 的可搜索文本：title + (description + task_prompt 合并为 body)。
   * 设计文档 §7.2.2：多字段合并后统一 jieba 分词，让所有 token 进入同一倒排索引。
   */
  private buildItemFtsBody(item: { description: string; task_prompt: string }): string {
    return `${item.description}\n${item.task_prompt}`;
  }

  /**
   * 创建 todo_item。
   * create 后自动触发 recalcParentProgress（影响父进度）。
   */
  create(data: {
    title: string;
    description?: string;
    task_prompt?: string;
    parent_id?: number | null;
    status?: TodoItemStatus;
    progress?: number;
    priority?: TodoItemPriority;
    due_at?: number | null;
    todo_list_id: number;
    is_manual_progress?: boolean;
    label_ids?: number[];
  }): TodoItem {
    const title = data.title.trim();
    if (title.length === 0) {
      throw new Error('TodoItem title cannot be empty');
    }

    const parentId = data.parent_id ?? null;
    // 校验递归深度
    this.validateDepth(parentId, data.todo_list_id, MAX_TODO_ITEM_DEPTH);

    const now = Date.now();
    const progress = this.clampProgress(data.progress ?? 0);
    const description = data.description ?? '';
    const taskPrompt = data.task_prompt ?? '';
    const newId = this.db.transaction(() => {
      const result = this.db.insert(
        `INSERT INTO todo_item
          (title, description, task_prompt, parent_id, status, progress, priority, due_at,
           todo_list_id, agent_task_id, is_manual_progress, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)`,
        [
          title,
          description,
          taskPrompt,
          parentId,
          data.status ?? DEFAULT_STATUS,
          progress,
          data.priority ?? DEFAULT_PRIORITY,
          data.due_at ?? null,
          data.todo_list_id,
          data.is_manual_progress ? 1 : 0,
          now,
          now,
        ],
      );
      const insertedId = result.lastRowid;

      // 设置标签关联
      if (data.label_ids && data.label_ids.length > 0) {
        this.labelService.setItemLabels(insertedId, data.label_ids);
      }

      // FTS 同步：title + (description + task_prompt 合并)
      this.searchService?.syncFts('todo_item', insertedId, {
        title,
        body: this.buildItemFtsBody({ description, task_prompt: taskPrompt }),
      });
      return insertedId;
    });

    logger.info(`TodoItem created: id=${newId}, title='${title}'`);

    const item = this.getById(newId)!;
    // 进度联动（新增子项可能影响父进度）；放在事务外，避免与 FTS 写入耦合
    if (parentId !== null) {
      this.recalcParentProgress(parentId);
    }
    return item;
  }

  /**
   * 更新 todo_item。
   * 若 progress / parent_id / is_manual_progress 变更，自动触发 recalcParentProgress。
   */
  update(
    id: number,
    patch: {
      title?: string;
      description?: string;
      task_prompt?: string;
      parent_id?: number | null;
      status?: TodoItemStatus;
      progress?: number;
      priority?: TodoItemPriority;
      due_at?: number | null;
      is_manual_progress?: boolean;
      label_ids?: number[];
    },
  ): TodoItem {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`TodoItem ${id} not found`);
    }

    const now = Date.now();
    const sets: string[] = ['updated_at = ?'];
    const params: Array<string | number | null> = [now];
    let progressChanged = false;
    let parentChanged = false;
    let manualFlagChanged = false;

    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (title.length === 0) {
        throw new Error('TodoItem title cannot be empty');
      }
      sets.push('title = ?');
      params.push(title);
    }
    if (patch.description !== undefined) {
      sets.push('description = ?');
      params.push(patch.description);
    }
    if (patch.task_prompt !== undefined) {
      sets.push('task_prompt = ?');
      params.push(patch.task_prompt);
    }
    if (patch.parent_id !== undefined && patch.parent_id !== existing.parent_id) {
      const newParentId = patch.parent_id;
      if (newParentId !== null) {
        if (newParentId === id) {
          throw new Error('Cannot set parent to self');
        }
        if (this.isDescendant(newParentId, id, existing.todo_list_id)) {
          throw new Error('Cannot move item under its own descendant (cycle)');
        }
      }
      this.validateDepth(newParentId, existing.todo_list_id, MAX_TODO_ITEM_DEPTH);
      sets.push('parent_id = ?');
      params.push(newParentId);
      parentChanged = true;
    }
    if (patch.status !== undefined) {
      sets.push('status = ?');
      params.push(patch.status);
    }
    if (patch.progress !== undefined) {
      sets.push('progress = ?');
      params.push(this.clampProgress(patch.progress));
      progressChanged = true;
    }
    if (patch.priority !== undefined) {
      sets.push('priority = ?');
      params.push(patch.priority);
    }
    if (patch.due_at !== undefined) {
      sets.push('due_at = ?');
      params.push(patch.due_at);
    }
    if (patch.is_manual_progress !== undefined) {
      sets.push('is_manual_progress = ?');
      params.push(patch.is_manual_progress ? 1 : 0);
      manualFlagChanged = true;
    }

    params.push(id);
    // 是否需要同步 FTS：title/description/task_prompt 任一变更
    const ftsDirty =
      patch.title !== undefined ||
      patch.description !== undefined ||
      patch.task_prompt !== undefined;

    this.db.transaction(() => {
      this.db.execute(
        `UPDATE todo_item SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
        params,
      );

      // 标签关联
      if (patch.label_ids !== undefined) {
        this.labelService.setItemLabels(id, patch.label_ids);
      }

      // FTS 同步（仅可搜索字段变更时）
      if (ftsDirty) {
        const after = this.getById(id);
        if (after) {
          this.searchService?.syncFts('todo_item', id, {
            title: after.title,
            body: this.buildItemFtsBody(after),
          });
        }
      }
    });

    const updated = this.getById(id)!;

    // 进度联动触发条件：progress 变更 / parent 变更 / 手动标记变更
    if (progressChanged || parentChanged || manualFlagChanged) {
      const targetParent = patch.parent_id !== undefined ? patch.parent_id : existing.parent_id;
      const oldParent = existing.parent_id;
      if (targetParent !== null) {
        this.recalcParentProgress(targetParent);
      }
      // parent 变更时旧 parent 也需重算
      if (parentChanged && oldParent !== null && oldParent !== targetParent) {
        this.recalcParentProgress(oldParent);
      }
    }

    return updated;
  }

  /**
   * 软删除：递归软删除子 todo_item + 关联 document。
   * 删除后触发父进度重算；同事务内清理子树 + 关联 document 的 FTS 索引。
   */
  delete(id: number): void {
    const existing = this.getById(id);
    if (!existing) {
      return;
    }
    const now = Date.now();
    const subtreeIds = this.collectSubtreeIds(id);
    const idList = subtreeIds.join(',');

    // 删除前收集关联 document id（删除后无法再查）
    const relatedDocIds = this.db.query<{ id: number }>(
      `SELECT id FROM todo_document WHERE todo_item_id IN (${idList}) AND deleted_at IS NULL`,
    ).map((r) => r.id);

    this.db.transaction(() => {
      this.db.execute(
        `UPDATE todo_item SET deleted_at = ?, updated_at = ? WHERE id IN (${idList}) AND deleted_at IS NULL`,
        [now, now],
      );
      this.db.execute(
        `UPDATE todo_document SET deleted_at = ?, updated_at = ? WHERE todo_item_id IN (${idList}) AND deleted_at IS NULL`,
        [now, now],
      );
      // 清理标签关联
      this.db.execute(
        `DELETE FROM todo_item_label WHERE todo_item_id IN (${idList})`,
      );

      // 级联清理 FTS（子树 + 关联 document）
      this.searchService?.syncFtsBatch('todo_item', subtreeIds);
      this.searchService?.syncFtsBatch('document', relatedDocIds);
    });

    logger.info(`TodoItem deleted: id=${id}, subtree=${subtreeIds.length} nodes`);

    // 父进度重算
    if (existing.parent_id !== null) {
      this.recalcParentProgress(existing.parent_id);
    }
  }

  /** 恢复软删除 todo_item（parent 已删则提升至根） */
  restore(id: number): TodoItem | undefined {
    const row = this.db.get<{ parent_id: number | null; deleted_at: number | null; todo_list_id: number }>(
      `SELECT parent_id, deleted_at, todo_list_id FROM todo_item WHERE id = ?`,
      [id],
    );
    if (!row || row.deleted_at === null) {
      return this.getById(id);
    }

    let promoteToRoot = false;
    if (row.parent_id !== null) {
      const parentRow = this.db.get<{ deleted_at: number | null }>(
        `SELECT deleted_at FROM todo_item WHERE id = ?`,
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
          `UPDATE todo_item SET deleted_at = NULL, parent_id = NULL, updated_at = ? WHERE id = ?`,
          [now, id],
        );
      } else {
        this.db.execute(
          `UPDATE todo_item SET deleted_at = NULL, updated_at = ? WHERE id = ?`,
          [now, id],
        );
      }
      // 恢复后重建 FTS
      const restored = this.getById(id);
      if (restored) {
        this.searchService?.syncFts('todo_item', id, {
          title: restored.title,
          body: this.buildItemFtsBody(restored),
        });
      }
    });
    logger.info(`TodoItem restored: id=${id}, promotedToRoot=${promoteToRoot}`);
    return this.getById(id);
  }

  /**
   * 物理删除已软删除的 todo_item（不可恢复）。
   *
   * 级联物理删除（依赖关系逆序）：
   *   todo_document → todo_item_label → todo_item（子树）
   *
   * 幂等性：先校验 `deleted_at IS NOT NULL`，未删除实体为 no-op。
   * FTS 无需操作：软删除时已清理。
   *
   * @param id - 待物理删除的 todo_item ID（必须已软删除）
   */
  purge(id: number): void {
    const row = this.db.get<{ deleted_at: number | null }>(
      `SELECT deleted_at FROM todo_item WHERE id = ?`,
      [id],
    );
    if (!row || row.deleted_at === null) {
      return;
    }

    // 收集子树所有 item id（含已软删除子节点，故用 collectSubtreeIdsAll）
    const subtreeIds = this.collectSubtreeIdsAll(id);
    const idList = subtreeIds.join(',');

    this.db.transaction(() => {
      // 1. 物理删除关联 document（item 维度）
      this.db.execute(
        `DELETE FROM todo_document WHERE todo_item_id IN (${idList})`,
      );
      // 2. 清理 todo_item_label 关联
      this.db.execute(
        `DELETE FROM todo_item_label WHERE todo_item_id IN (${idList})`,
      );
      // 3. 物理删除 todo_item（子树）
      this.db.execute(
        `DELETE FROM todo_item WHERE id IN (${idList})`,
      );
    });

    logger.info(`TodoItem purged: id=${id}, subtree=${subtreeIds.length} nodes`);
  }

  /** 列出回收站中的 todo_item（label_ids 返回 []，因为软删除时已清关联） */
  listTrash(): TodoItem[] {
    const rows = this.db.query<TodoItemRow>(
      `SELECT id, title, description, task_prompt, parent_id, status, progress, priority,
              due_at, todo_list_id, agent_task_id, is_manual_progress, created_at, updated_at, deleted_at
       FROM todo_item WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
    );
    return rows.map((r) => this.mapRow(r, []));
  }

  /** 按 id 获取未删除 todo_item（含 label_ids） */
  getById(id: number): TodoItem | undefined {
    const row = this.db.get<TodoItemRow>(
      `SELECT id, title, description, task_prompt, parent_id, status, progress, priority,
              due_at, todo_list_id, agent_task_id, is_manual_progress, created_at, updated_at, deleted_at
       FROM todo_item WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    if (!row) {
      return undefined;
    }
    return this.mapRow(row, this.labelService.getItemLabels(id));
  }

  /**
   * 获取 todo_list 下所有未删除 todo_item，按 parent_id 组装成树。
   * 每个节点附带 depth（顶层为 1）。
   */
  getTreeByList(listId: number): TodoItemNode[] {
    const rows = this.db.query<TodoItemRow>(
      `SELECT id, title, description, task_prompt, parent_id, status, progress, priority,
              due_at, todo_list_id, agent_task_id, is_manual_progress, created_at, updated_at, deleted_at
       FROM todo_item WHERE todo_list_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`,
      [listId],
    );

    if (rows.length === 0) {
      return [];
    }

    // 构建索引（含 label_ids）
    const nodeMap = new Map<number, TodoItemNode>();
    for (const r of rows) {
      const labels = this.labelService.getItemLabels(r.id);
      nodeMap.set(r.id, { ...this.mapRow(r, labels), children: [], depth: 0 });
    }

    // 组装父子 + 计算深度
    const roots: TodoItemNode[] = [];
    for (const node of nodeMap.values()) {
      if (node.parent_id !== null && nodeMap.has(node.parent_id)) {
        nodeMap.get(node.parent_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    for (const root of roots) {
      this.assignDepth(root, 1);
    }
    return roots;
  }

  /** 列出某 label 关联的未删除 todo_item */
  listByLabel(labelId: number): TodoItem[] {
    const rows = this.db.query<TodoItemRow>(
      `SELECT ti.id, ti.title, ti.description, ti.task_prompt, ti.parent_id, ti.status, ti.progress,
              ti.priority, ti.due_at, ti.todo_list_id, ti.agent_task_id, ti.is_manual_progress,
              ti.created_at, ti.updated_at, ti.deleted_at
       FROM todo_item ti
       INNER JOIN todo_item_label til ON ti.id = til.todo_item_id
       WHERE til.label_id = ? AND ti.deleted_at IS NULL
       ORDER BY ti.created_at ASC`,
      [labelId],
    );
    return rows.map((r) => this.mapRow(r, this.labelService.getItemLabels(r.id)));
  }

  /**
   * 更新状态（含状态机校验）。
   * @throws Error("非法状态转换") 非法转换时抛错
   */
  updateStatus(id: number, status: TodoItemStatus): TodoItem {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`TodoItem ${id} not found`);
    }
    this.validateStatusTransition(existing.status, status);

    const now = Date.now();
    this.db.execute(
      `UPDATE todo_item SET status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [status, now, id],
    );

    // done → progress=100；恢复为非 done 时不自动改 progress（由调用方控制）
    if (status === 'done') {
      this.db.execute(
        `UPDATE todo_item SET progress = 100, updated_at = ? WHERE id = ? AND is_manual_progress = 0`,
        [now, id],
      );
    }

    // 状态变更可能联动父进度（如 done → 子项进度变化）
    if (existing.parent_id !== null) {
      this.recalcParentProgress(existing.parent_id);
    }

    return this.getById(id)!;
  }

  /**
   * 更新 todo_item.agent_task_id 指向（每次任务运行后覆盖）。
   *
   * 仅由 TodoTaskService 内部调用，**不通过 IPC / update() 公共 patch 暴露**，
   * 避免业务侧误改导致与 task 系统不一致（设计文档 §8.6）。
   *
   * @param id - todo_item ID
   * @param taskId - 最新关联的 task.id
   */
  updateAgentTaskId(id: number, taskId: number): void {
    const now = Date.now();
    this.db.execute(
      `UPDATE todo_item SET agent_task_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [taskId, now, id],
    );
  }

  /**
   * 状态机转换校验。
   * @throws Error("非法状态转换")
   */
  validateStatusTransition(from: TodoItemStatus, to: TodoItemStatus): void {
    const allowed = VALID_STATUS_TRANSITIONS[from];
    if (!allowed || !allowed.has(to)) {
      throw new Error(`非法状态转换: ${from} -> ${to}`);
    }
  }

  /**
   * 进度联动：反向更新 parent 进度。
   *
   * 计算规则：
   *   parent.progress = AVG(未删除、非 is_manual_progress、直接子项的 progress)
   *   若 parent 自身 is_manual_progress=true，则跳过（不自动覆盖）
   *   若无有效子项（全部 is_manual_progress 或无子项），不修改 parent.progress
   *
   * 含防环检测（Set<number> visited）。
   */
  recalcParentProgress(itemId: number): void {
    const visited = new Set<number>();
    let cursor: number | null = itemId;

    while (cursor !== null) {
      if (visited.has(cursor)) {
        logger.warn(`Detected cycle in parent chain at item ${cursor}, abort recalc`);
        return;
      }
      visited.add(cursor);

      const parent: { parent_id: number | null; is_manual_progress: number } | undefined = this.db.get(
        `SELECT parent_id, is_manual_progress FROM todo_item WHERE id = ? AND deleted_at IS NULL`,
        [cursor],
      );
      if (!parent) {
        break;
      }

      // parent 自身手动标记则跳过
      if (parent.is_manual_progress === 1) {
        break;
      }

      // 计算直接子项平均进度
      const childRows = this.db.query<{ progress: number; is_manual_progress: number }>(
        `SELECT progress, is_manual_progress FROM todo_item
         WHERE parent_id = ? AND deleted_at IS NULL`,
        [cursor],
      );
      const autoChildren = childRows.filter((c) => c.is_manual_progress === 0);

      if (autoChildren.length > 0) {
        const avg = Math.round(
          autoChildren.reduce((sum, c) => sum + c.progress, 0) / autoChildren.length,
        );
        const clamped = this.clampProgress(avg);
        const now = Date.now();
        this.db.execute(
          `UPDATE todo_item SET progress = ?, updated_at = ? WHERE id = ? AND is_manual_progress = 0`,
          [clamped, now, cursor],
        );
      }

      cursor = parent.parent_id;
    }
  }

  /**
   * 递归收集 todo_item 的所有子项（含孙子），扁平化为数组。
   * 用于 TodoTaskService 组装 prompt（Phase 5）。
   * @returns 按 (depth, created_at) 升序排列的子项（不含自身）
   */
  collectSubtree(itemId: number): Array<TodoItem & { depth: number }> {
    const result: Array<TodoItem & { depth: number }> = [];
    const queue: Array<{ id: number; depth: number }> = [];
    // 收集直接子项作为起点
    const directChildren = this.db.query<{ id: number }>(
      `SELECT id FROM todo_item WHERE parent_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`,
      [itemId],
    );
    for (const c of directChildren) {
      queue.push({ id: c.id, depth: 1 });
    }

    while (queue.length > 0) {
      const node = queue.shift()!;
      const item = this.getById(node.id);
      if (!item) continue;
      result.push({ ...item, depth: node.depth });
      const children = this.db.query<{ id: number }>(
        `SELECT id FROM todo_item WHERE parent_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`,
        [node.id],
      );
      for (const c of children) {
        queue.push({ id: c.id, depth: node.depth + 1 });
      }
    }

    // 按 (depth, created_at) 升序
    result.sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return a.created_at - b.created_at;
    });
    return result;
  }

  /**
   * 校验在指定 parent 下新增/移动是否超过最大深度。
   * @throws Error("超出最大递归层级")
   */
  validateDepth(parentId: number | null, listId: number, maxDepth: number): void {
    if (parentId === null) {
      return;
    }
    let depth = 1;
    let cursor: number | null = parentId;
    const visited = new Set<number>();
    while (cursor !== null) {
      if (visited.has(cursor)) {
        throw new Error('Detected cycle in todo_item parent chain');
      }
      visited.add(cursor);
      depth += 1;
      if (depth > maxDepth) {
        throw new Error(`超出最大递归层级 (${maxDepth})`);
      }
      const row: { parent_id: number | null; deleted_at: number | null; todo_list_id: number } | undefined = this.db.get(
        `SELECT parent_id, deleted_at, todo_list_id FROM todo_item WHERE id = ?`,
        [cursor],
      );
      if (!row) break;
      cursor = row.parent_id;
    }
    if (depth > maxDepth) {
      throw new Error(`超出最大递归层级 (${maxDepth})`);
    }
  }

  // =========================================================================
  // 内部工具
  // =========================================================================

  /** 收集子树所有 item id（含自身），BFS */
  private collectSubtreeIds(rootId: number): number[] {
    const result: number[] = [];
    const queue: number[] = [rootId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);
      const children = this.db.query<{ id: number }>(
        `SELECT id FROM todo_item WHERE parent_id = ? AND deleted_at IS NULL`,
        [current],
      );
      for (const c of children) {
        queue.push(c.id);
      }
    }
    return result;
  }

  /**
   * 收集子树所有 item id（含自身），**不过滤 deleted_at**。
   *
   * 与 `collectSubtreeIds` 区别：用于 purge 时收集已被软删除的子节点。
   */
  private collectSubtreeIdsAll(rootId: number): number[] {
    const result: number[] = [];
    const queue: number[] = [rootId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);
      const children = this.db.query<{ id: number }>(
        `SELECT id FROM todo_item WHERE parent_id = ?`,
        [current],
      );
      for (const c of children) {
        queue.push(c.id);
      }
    }
    return result;
  }

  /** 判断 candidateId 是否为 ancestorId 的子孙（同 list 内） */
  private isDescendant(candidateId: number, ancestorId: number, _listId: number): boolean {
    let cursor: number | null = candidateId;
    const visited = new Set<number>();
    while (cursor !== null) {
      if (visited.has(cursor)) return false;
      visited.add(cursor);
      if (cursor === ancestorId) return true;
      const row: { parent_id: number | null } | undefined = this.db.get(
        `SELECT parent_id FROM todo_item WHERE id = ?`,
        [cursor],
      );
      if (!row) return false;
      cursor = row.parent_id;
    }
    return false;
  }

  /** 递归赋值 depth */
  private assignDepth(node: TodoItemNode, depth: number): void {
    node.depth = depth;
    for (const child of node.children) {
      this.assignDepth(child, depth + 1);
    }
  }

  /** clamp 进度到 0-100 整数 */
  private clampProgress(p: number): number {
    return Math.min(Math.max(Math.trunc(p), 0), 100);
  }

  private mapRow(row: TodoItemRow, labelIds: number[]): TodoItem {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      task_prompt: row.task_prompt,
      parent_id: row.parent_id,
      status: row.status as TodoItemStatus,
      progress: row.progress,
      priority: row.priority as TodoItemPriority,
      due_at: row.due_at,
      todo_list_id: row.todo_list_id,
      agent_task_id: row.agent_task_id,
      is_manual_progress: row.is_manual_progress === 1,
      label_ids: labelIds,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at ?? null,
    };
  }
}

interface TodoItemRow {
  id: number;
  title: string;
  description: string;
  task_prompt: string;
  parent_id: number | null;
  status: string;
  progress: number;
  priority: string;
  due_at: number | null;
  todo_list_id: number;
  agent_task_id: number | null;
  is_manual_progress: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}
