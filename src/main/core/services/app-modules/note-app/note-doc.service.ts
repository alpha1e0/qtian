import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

import { DBManager } from '@/core/database/db-manager';
import { createLogger } from '@/core/utils/logger';
import { NoteDoc, MAX_DOC_TITLE_LENGTH, MAX_DOC_SUMMARY_LENGTH } from './types';
import { NoteLabelService } from './note-label.service';
import { NoteSearchService } from './note-search.service';

const logger = createLogger('NoteDocService');

/** 附件文件名使用的 hash 长度（sha256 前 16 位） */
const ATTACH_HASH_LENGTH = 16;
/** 默认文档内容 */
const DEFAULT_CONTENT = '';
/** 默认文档摘要 */
const DEFAULT_SUMMARY = '';

/**
 * Note Doc Service — Markdown 文档 CRUD + 附件落盘
 *
 * 职责：
 * - create / update / delete（软删除）/ restore / getById
 * - list(categoryId) / listByLabel / listFavorites
 * - toggleFavorite
 * - saveAttachment：sha256 前 16 位命名 + 前 2 位分桶 + 去重
 *
 * FTS 集成：searchService 为可选依赖（默认 null）。
 * 可搜索字段：title（title）+ summary + content（body）。
 *
 * label_ids 由 NoteLabelService 的 setDocLabels / getDocLabels 维护。
 */
export class NoteDocService {
  private db: DBManager;
  private labelService: NoteLabelService;
  private searchService: NoteSearchService | null;
  /** 附件根目录（workspace/app_modules/note_app/attach） */
  private readonly attachDir: string;

  constructor(
    db: DBManager,
    labelService: NoteLabelService,
    searchService: NoteSearchService | null = null,
    attachDir: string = '',
  ) {
    this.db = db;
    this.labelService = labelService;
    this.searchService = searchService;
    this.attachDir = attachDir;
  }

  /**
   * 创建文档
   * @throws Error title 为空 / 超长 / summary 超长
   */
  create(data: {
    title: string;
    summary?: string;
    content?: string;
    category_id?: number | null;
    task_prompt?: string;
    label_ids?: number[];
  }): NoteDoc {
    const title = data.title.trim();
    if (title.length === 0) {
      throw new Error('Doc title cannot be empty');
    }
    if (title.length > MAX_DOC_TITLE_LENGTH) {
      throw new Error(`Doc title exceeds ${MAX_DOC_TITLE_LENGTH} characters`);
    }

    const summary = data.summary ?? DEFAULT_SUMMARY;
    if (summary.length > MAX_DOC_SUMMARY_LENGTH) {
      throw new Error(`Doc summary exceeds ${MAX_DOC_SUMMARY_LENGTH} characters`);
    }

    const content = data.content ?? DEFAULT_CONTENT;
    const categoryId = data.category_id ?? null;
    const taskPrompt = data.task_prompt ?? '';
    const labelIds = data.label_ids ?? [];

    const now = Date.now();
    const newId = this.db.transaction(() => {
      const result = this.db.insert(
        `INSERT INTO note_doc (title, summary, content, category_id, task_prompt, is_favorite, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL)`,
        [title, summary, content, categoryId, taskPrompt, now, now],
      );
      const docId = result.lastRowid;
      // FTS body 构造：title=title，body=summary + ' ' + content
      this.searchService?.syncFts('doc', docId, {
        title,
        body: `${summary} ${content}`,
      });
      // 维护 label 关联
      if (labelIds.length > 0) {
        this.labelService.setDocLabels(docId, labelIds);
      }
      return docId;
    });
    logger.info(`Doc created: id=${newId}, title='${title}'`);
    return this.getById(newId)!;
  }

  /**
   * 更新文档（label_ids 全量覆盖）
   */
  update(id: number, patch: {
    title?: string;
    summary?: string;
    content?: string;
    category_id?: number | null;
    task_prompt?: string;
    label_ids?: number[];
    is_favorite?: boolean;
  }): NoteDoc {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`Doc ${id} not found`);
    }

    const now = Date.now();
    const sets: string[] = ['updated_at = ?'];
    const params: Array<string | number | null> = [now];
    let needFtsSync = false;

    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (title.length === 0) {
        throw new Error('Doc title cannot be empty');
      }
      if (title.length > MAX_DOC_TITLE_LENGTH) {
        throw new Error(`Doc title exceeds ${MAX_DOC_TITLE_LENGTH} characters`);
      }
      sets.push('title = ?');
      params.push(title);
      needFtsSync = true;
    }

    if (patch.summary !== undefined) {
      if (patch.summary.length > MAX_DOC_SUMMARY_LENGTH) {
        throw new Error(`Doc summary exceeds ${MAX_DOC_SUMMARY_LENGTH} characters`);
      }
      sets.push('summary = ?');
      params.push(patch.summary);
      needFtsSync = true;
    }

    if (patch.content !== undefined) {
      sets.push('content = ?');
      params.push(patch.content);
      needFtsSync = true;
    }

    if (patch.category_id !== undefined) {
      sets.push('category_id = ?');
      params.push(patch.category_id);
    }

    if (patch.task_prompt !== undefined) {
      sets.push('task_prompt = ?');
      params.push(patch.task_prompt);
    }

    if (patch.is_favorite !== undefined) {
      sets.push('is_favorite = ?');
      params.push(patch.is_favorite ? 1 : 0);
    }

    params.push(id);

    this.db.transaction(() => {
      this.db.execute(
        `UPDATE note_doc SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
        params,
      );

      // label_ids 全量覆盖
      if (patch.label_ids !== undefined) {
        this.labelService.setDocLabels(id, patch.label_ids);
      }

      // title/summary/content 变更时同步 FTS
      if (needFtsSync) {
        const after = this.getById(id);
        if (after) {
          this.searchService?.syncFts('doc', id, {
            title: after.title,
            body: `${after.summary} ${after.content}`,
          });
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
        `UPDATE note_doc SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
        [now, now, id],
      );
      if (changes > 0) {
        this.searchService?.syncFts('doc', id, null);
        logger.info(`Doc deleted: id=${id}`);
      }
    });
  }

  /** 恢复软删除文档 */
  restore(id: number): NoteDoc | undefined {
    const now = Date.now();
    this.db.transaction(() => {
      const changes = this.db.execute(
        `UPDATE note_doc SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL`,
        [now, id],
      );
      if (changes > 0) {
        const restored = this.getById(id);
        if (restored) {
          this.searchService?.syncFts('doc', id, {
            title: restored.title,
            body: `${restored.summary} ${restored.content}`,
          });
        }
        logger.info(`Doc restored: id=${id}`);
      }
    });
    return this.getById(id);
  }

  /** 列出回收站中的文档 */
  listTrash(): NoteDoc[] {
    const rows = this.db.query<NoteDocRow>(
      `SELECT id, title, summary, content, category_id, task_prompt, is_favorite, created_at, updated_at, deleted_at
       FROM note_doc WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
    );
    return rows.map((r) => this.mapRow(r, []));
  }

  /**
   * 物理删除已软删除的文档（不可恢复）。
   *
   * 级联清理 note_doc_label 关联。
   * 幂等性：先校验 `deleted_at IS NOT NULL`，未删除实体为 no-op。
   */
  purge(id: number): void {
    const row = this.db.get<{ deleted_at: number | null }>(
      `SELECT deleted_at FROM note_doc WHERE id = ?`,
      [id],
    );
    if (!row || row.deleted_at === null) {
      return;
    }
    this.db.transaction(() => {
      this.db.execute(`DELETE FROM note_doc_label WHERE doc_id = ?`, [id]);
      this.db.execute(`DELETE FROM note_doc WHERE id = ?`, [id]);
    });
    logger.info(`Doc purged: id=${id}`);
  }

  /** 按 id 获取未删除文档（含 label_ids 补全） */
  getById(id: number): NoteDoc | undefined {
    const row = this.db.get<NoteDocRow>(
      `SELECT id, title, summary, content, category_id, task_prompt, is_favorite, created_at, updated_at, deleted_at
       FROM note_doc WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    if (!row) return undefined;
    const labelIds = this.labelService.getDocLabels(id);
    return this.mapRow(row, labelIds);
  }

  /** 列出未删除文档（可选按 category 过滤） */
  list(categoryId?: number | null): NoteDoc[] {
    const rows = categoryId === undefined
      ? this.db.query<NoteDocRow>(
          `SELECT id, title, summary, content, category_id, task_prompt, is_favorite, created_at, updated_at, deleted_at
           FROM note_doc WHERE deleted_at IS NULL ORDER BY updated_at DESC`,
        )
      : this.db.query<NoteDocRow>(
          `SELECT id, title, summary, content, category_id, task_prompt, is_favorite, created_at, updated_at, deleted_at
           FROM note_doc WHERE category_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`,
          [categoryId],
        );
    return rows.map((r) => this.mapRow(r, this.labelService.getDocLabels(r.id)));
  }

  /** 列出指定 label 关联的文档 */
  listByLabel(labelId: number): NoteDoc[] {
    const rows = this.db.query<NoteDocRow>(
      `SELECT d.id, d.title, d.summary, d.content, d.category_id, d.task_prompt, d.is_favorite, d.created_at, d.updated_at, d.deleted_at
       FROM note_doc d
       INNER JOIN note_doc_label dl ON d.id = dl.doc_id
       WHERE dl.label_id = ? AND d.deleted_at IS NULL
       ORDER BY d.updated_at DESC`,
      [labelId],
    );
    return rows.map((r) => this.mapRow(r, this.labelService.getDocLabels(r.id)));
  }

  /** 列出收藏文档 */
  listFavorites(): NoteDoc[] {
    const rows = this.db.query<NoteDocRow>(
      `SELECT id, title, summary, content, category_id, task_prompt, is_favorite, created_at, updated_at, deleted_at
       FROM note_doc WHERE is_favorite = 1 AND deleted_at IS NULL ORDER BY updated_at DESC`,
    );
    return rows.map((r) => this.mapRow(r, this.labelService.getDocLabels(r.id)));
  }

  /** 切换收藏状态 */
  toggleFavorite(id: number): NoteDoc | undefined {
    const existing = this.getById(id);
    if (!existing) {
      return undefined;
    }
    const now = Date.now();
    this.db.execute(
      `UPDATE note_doc SET is_favorite = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [existing.is_favorite ? 0 : 1, now, id],
    );
    return this.getById(id);
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

    fs.mkdirSync(bucketDir, { recursive: true, mode: 0o700 });

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

  private mapRow(row: NoteDocRow, labelIds: number[]): NoteDoc {
    return {
      id: row.id,
      title: row.title,
      summary: row.summary,
      content: row.content,
      category_id: row.category_id,
      task_prompt: row.task_prompt,
      label_ids: labelIds,
      is_favorite: Boolean(row.is_favorite),
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at ?? null,
    };
  }
}

interface NoteDocRow {
  id: number;
  title: string;
  summary: string;
  content: string;
  category_id: number | null;
  task_prompt: string;
  is_favorite: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}
