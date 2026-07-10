import { DBManager } from '@/core/database/db-manager';
import { createLogger } from '@/core/utils/logger';
import { NoteLabel, MAX_LABEL_NAME_LENGTH } from './types';

const logger = createLogger('NoteLabelService');

/** 默认标签类型 */
const DEFAULT_LABEL_TYPE = 'default';

/**
 * Label Service — note-app 全局标签 CRUD
 *
 * 职责：
 * - list / create / update / delete（软删除 + 清理 note_doc_label）/ restore
 * - setDocLabels / getDocLabels：维护 note_doc_label 多对多关系
 *
 * create 时 name 唯一性由 DB 的部分唯一索引 uq_note_label_name_active 保证，
 * 插入冲突由 better-sqlite3 抛出约束错误，Service 层转换为可读异常。
 */
export class NoteLabelService {
  private db: DBManager;

  constructor(db: DBManager) {
    this.db = db;
  }

  /** 列出所有未删除标签（按 created_at 升序） */
  list(): NoteLabel[] {
    const rows = this.db.query<NoteLabelRow>(
      `SELECT id, name, type, created_at, deleted_at
       FROM note_label
       WHERE deleted_at IS NULL
       ORDER BY created_at ASC`,
    );
    return rows.map((r) => this.mapRow(r));
  }

  /**
   * 创建标签（name 在未删除行内唯一）
   * @throws Error name 为空 / 超 30 字符 / 已存在时抛错
   */
  create(data: { name: string; type?: string }): NoteLabel {
    const name = data.name.trim();
    if (name.length === 0) {
      throw new Error('Label name cannot be empty');
    }
    if (name.length > MAX_LABEL_NAME_LENGTH) {
      throw new Error(`Label name exceeds ${MAX_LABEL_NAME_LENGTH} characters`);
    }

    const now = Date.now();
    let newId: number;
    try {
      const result = this.db.insert(
        `INSERT INTO note_label (name, type, created_at, deleted_at) VALUES (?, ?, ?, NULL)`,
        [name, data.type ?? DEFAULT_LABEL_TYPE, now],
      );
      newId = result.lastRowid;
    } catch (err) {
      throw new Error(`Label name '${name}' already exists`);
    }

    logger.info(`Label created: id=${newId}, name='${name}'`);
    return this.getById(newId)!;
  }

  /**
   * 更新标签（仅 name / type）
   * @throws Error 新 name 已存在时抛错
   */
  update(id: number, patch: { name?: string; type?: string }): NoteLabel {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`Label ${id} not found`);
    }

    const sets: string[] = [];
    const params: Array<string | number | null> = [];

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (name.length === 0) {
        throw new Error('Label name cannot be empty');
      }
      if (name.length > MAX_LABEL_NAME_LENGTH) {
        throw new Error(`Label name exceeds ${MAX_LABEL_NAME_LENGTH} characters`);
      }
      sets.push('name = ?');
      params.push(name);
    }
    if (patch.type !== undefined) {
      sets.push('type = ?');
      params.push(patch.type);
    }

    if (sets.length === 0) {
      return existing;
    }

    params.push(id);
    try {
      this.db.execute(
        `UPDATE note_label SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
        params,
      );
    } catch (err) {
      throw new Error(`Label name already exists`);
    }

    return this.getById(id)!;
  }

  /**
   * 软删除标签，同时清理 note_doc_label 关联（保持引用完整性）
   */
  delete(id: number): void {
    const now = Date.now();
    const changes = this.db.execute(
      `UPDATE note_label SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [now, id],
    );
    if (changes > 0) {
      this.db.execute(`DELETE FROM note_doc_label WHERE label_id = ?`, [id]);
      logger.info(`Label deleted: id=${id}`);
    }
  }

  /**
   * 恢复软删除的标签（name 冲突时由唯一索引拦截）
   */
  restore(id: number): NoteLabel | undefined {
    const changes = this.db.execute(
      `UPDATE note_label SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`,
      [id],
    );
    if (changes > 0) {
      logger.info(`Label restored: id=${id}`);
    }
    return this.getById(id);
  }

  /** 列出回收站中的标签 */
  listTrash(): NoteLabel[] {
    const rows = this.db.query<NoteLabelRow>(
      `SELECT id, name, type, created_at, deleted_at
       FROM note_label WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
    );
    return rows.map((r) => this.mapRow(r));
  }

  /**
   * 物理删除已软删除的标签（不可恢复）。
   *
   * 级联清理 note_doc_label 关联。
   * 幂等性：先校验 `deleted_at IS NOT NULL`，未删除实体为 no-op。
   */
  purge(id: number): void {
    const row = this.db.get<{ deleted_at: number | null }>(
      `SELECT deleted_at FROM note_label WHERE id = ?`,
      [id],
    );
    if (!row || row.deleted_at === null) {
      return;
    }
    this.db.transaction(() => {
      this.db.execute(
        `DELETE FROM note_doc_label WHERE label_id = ?`,
        [id],
      );
      this.db.execute(
        `DELETE FROM note_label WHERE id = ?`,
        [id],
      );
    });
    logger.info(`Label purged: id=${id}`);
  }

  /** 按 id 获取未删除标签 */
  getById(id: number): NoteLabel | undefined {
    const row = this.db.get<NoteLabelRow>(
      `SELECT id, name, type, created_at, deleted_at
       FROM note_label WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    return row ? this.mapRow(row) : undefined;
  }

  /**
   * 设置 doc 的标签集合（全量覆盖）。
   * 先删除现有关联，再插入新的关联；note_doc_label 复合主键冲突时忽略（INSERT OR IGNORE）。
   */
  setDocLabels(docId: number, labelIds: number[]): void {
    this.db.execute(`DELETE FROM note_doc_label WHERE doc_id = ?`, [docId]);
    for (const labelId of labelIds) {
      this.db.execute(
        `INSERT OR IGNORE INTO note_doc_label (doc_id, label_id) VALUES (?, ?)`,
        [docId, labelId],
      );
    }
  }

  /** 获取 doc 关联的标签 ID 列表 */
  getDocLabels(docId: number): number[] {
    const rows = this.db.query<{ label_id: number }>(
      `SELECT label_id FROM note_doc_label WHERE doc_id = ?`,
      [docId],
    );
    return rows.map((r) => r.label_id);
  }

  // =========================================================================
  // 内部工具
  // =========================================================================

  private mapRow(row: NoteLabelRow): NoteLabel {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      created_at: row.created_at,
      deleted_at: row.deleted_at ?? null,
    };
  }
}

interface NoteLabelRow {
  id: number;
  name: string;
  type: string;
  created_at: number;
  deleted_at: number | null;
}
