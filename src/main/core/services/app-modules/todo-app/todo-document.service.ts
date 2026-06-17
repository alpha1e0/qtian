import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

import { DBManager } from '@/core/database/db-manager';
import { createLogger } from '@/core/utils/logger';
import { TodoDocument } from './types';
import { TodoSearchService } from './todo-search.service';

const logger = createLogger('TodoDocumentService');

/** 附件文件名使用的 hash 长度（sha256 前 16 位） */
const ATTACH_HASH_LENGTH = 16;
/** 默认文档内容 */
const DEFAULT_CONTENT = '';

/**
 * Document Service — Markdown 文档 CRUD + 附件落盘
 *
 * 职责：
 * - create / update / delete（软删除）/ restore / getById
 * - listByCategory / listByItem
 * - saveAttachment：sha256 前 16 位命名 + 前 2 位分桶 + 去重（已存在不重写）
 *
 * FTS 集成（Phase 3）：searchService 为可选依赖（默认 null）。
 * 可搜索字段：name（title） + content（body）。
 *
 * create 约束：todo_category_id 和 todo_item_id 不可同时非 null。
 */
export class TodoDocumentService {
  private db: DBManager;
  /** 附件根目录（workspace/app_modules/todo_app/attach） */
  private readonly attachDir: string;
  private searchService: TodoSearchService | null;

  constructor(db: DBManager, attachDir: string, searchService: TodoSearchService | null = null) {
    this.db = db;
    this.attachDir = attachDir;
    this.searchService = searchService;
  }

  /**
   * 创建文档。
   * @throws Error todo_category_id 和 todo_item_id 同时非 null 时抛错
   */
  create(data: {
    name: string;
    content?: string;
    todo_category_id?: number | null;
    todo_item_id?: number | null;
  }): TodoDocument {
    const name = data.name.trim();
    if (name.length === 0) {
      throw new Error('Document name cannot be empty');
    }

    const categoryId = data.todo_category_id ?? null;
    const itemId = data.todo_item_id ?? null;
    if (categoryId !== null && itemId !== null) {
      throw new Error('todo_category_id 和 todo_item_id 不可同时非 null');
    }

    const now = Date.now();
    const content = data.content ?? DEFAULT_CONTENT;
    const newId = this.db.transaction(() => {
      const result = this.db.insert(
        `INSERT INTO todo_document (name, content, todo_category_id, todo_item_id, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        [name, content, categoryId, itemId, now, now],
      );
      this.searchService?.syncFts('document', result.lastRowid, { title: name, body: content });
      return result.lastRowid;
    });
    logger.info(`Document created: id=${newId}, name='${name}'`);
    return this.getById(newId)!;
  }

  /** 更新文档（name / content） */
  update(id: number, patch: { name?: string; content?: string }): TodoDocument {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`Document ${id} not found`);
    }

    const now = Date.now();
    const sets: string[] = ['updated_at = ?'];
    const params: Array<string | number | null> = [now];

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (name.length === 0) {
        throw new Error('Document name cannot be empty');
      }
      sets.push('name = ?');
      params.push(name);
    }
    if (patch.content !== undefined) {
      sets.push('content = ?');
      params.push(patch.content);
    }

    params.push(id);
    this.db.transaction(() => {
      this.db.execute(
        `UPDATE todo_document SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
        params,
      );
      // name/content 任一变更才同步 FTS
      if (patch.name !== undefined || patch.content !== undefined) {
        const after = this.getById(id);
        if (after) {
          this.searchService?.syncFts('document', id, { title: after.name, body: after.content });
        }
      }
    });

    return this.getById(id)!;
  }

  /** 软删除文档 */
  delete(id: number): void {
    const now = Date.now();
    this.db.transaction(() => {
      const changes = this.db.execute(
        `UPDATE todo_document SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
        [now, now, id],
      );
      if (changes > 0) {
        this.searchService?.syncFts('document', id, null);
        logger.info(`Document deleted: id=${id}`);
      }
    });
  }

  /** 恢复软删除文档 */
  restore(id: number): TodoDocument | undefined {
    const now = Date.now();
    this.db.transaction(() => {
      const changes = this.db.execute(
        `UPDATE todo_document SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL`,
        [now, id],
      );
      if (changes > 0) {
        const restored = this.getById(id);
        if (restored) {
          this.searchService?.syncFts('document', id, {
            title: restored.name,
            body: restored.content,
          });
        }
        logger.info(`Document restored: id=${id}`);
      }
    });
    return this.getById(id);
  }

  /** 按 id 获取未删除文档 */
  getById(id: number): TodoDocument | undefined {
    const row = this.db.get<TodoDocumentRow>(
      `SELECT id, name, content, todo_category_id, todo_item_id, created_at, updated_at, deleted_at
       FROM todo_document WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    return row ? this.mapRow(row) : undefined;
  }

  /** 列出 category 下的未删除文档 */
  listByCategory(categoryId: number): TodoDocument[] {
    const rows = this.db.query<TodoDocumentRow>(
      `SELECT id, name, content, todo_category_id, todo_item_id, created_at, updated_at, deleted_at
       FROM todo_document WHERE todo_category_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`,
      [categoryId],
    );
    return rows.map((r) => this.mapRow(r));
  }

  /** 列出 todo_item 下的未删除文档 */
  listByItem(itemId: number): TodoDocument[] {
    const rows = this.db.query<TodoDocumentRow>(
      `SELECT id, name, content, todo_category_id, todo_item_id, created_at, updated_at, deleted_at
       FROM todo_document WHERE todo_item_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`,
      [itemId],
    );
    return rows.map((r) => this.mapRow(r));
  }

  /**
   * 保存附件到 attach/ 目录，返回 local-resource URL。
   *
   * 命名规则：sha256(content).slice(0,16) + ext
   * 分桶规则：前 2 位 hash 作为子目录，避免单目录文件过多
   * 去重：已存在则不重写
   *
   * @param buffer - 文件二进制
   * @param ext - 扩展名（含点，如 '.png'）
   * @returns local-resource:// URL（绝对路径形式）
   */
  saveAttachment(buffer: Buffer, ext: string): string {
    const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const shortHash = hash.slice(0, ATTACH_HASH_LENGTH);
    const bucket = shortHash.slice(0, 2);
    const bucketDir = path.join(this.attachDir, bucket);
    const filename = `${shortHash}${normalizedExt}`;
    const filePath = path.join(bucketDir, filename);

    // 确保分桶目录存在
    fs.mkdirSync(bucketDir, { recursive: true, mode: 0o700 });

    // 去重：已存在不重写
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, buffer, { mode: 0o600 });
      logger.info(`Attachment saved: ${filename} (${buffer.length} bytes)`);
    } else {
      logger.debug(`Attachment deduplicated: ${filename}`);
    }

    return this.toLocalResourceUrl(filePath);
  }

  // =========================================================================
  // 内部工具
  // =========================================================================

  /** 将绝对路径转为 local-resource:// URL（与主进程协议一致） */
  private toLocalResourceUrl(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    return `local-resource://${normalized}`;
  }

  private mapRow(row: TodoDocumentRow): TodoDocument {
    return {
      id: row.id,
      name: row.name,
      content: row.content,
      todo_category_id: row.todo_category_id,
      todo_item_id: row.todo_item_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at ?? null,
    };
  }
}

interface TodoDocumentRow {
  id: number;
  name: string;
  content: string;
  todo_category_id: number | null;
  todo_item_id: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}
