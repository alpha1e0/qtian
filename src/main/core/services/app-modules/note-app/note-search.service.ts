import { DBManager } from '@/core/database/db-manager';
import { createLogger } from '@/core/utils/logger';
import { NoteTokenizer } from './note-tokenizer';
import {
  NoteFtsEntityType,
  NoteSearchResult,
  NoteSearchHistory,
} from './types';

const logger = createLogger('NoteSearchService');

/** 默认搜索返回上限 */
const DEFAULT_SEARCH_LIMIT = 30;
/** snippet 在 title 字段的上下文 token 数 */
const SNIPPET_TITLE_TOKENS = 12;
/** snippet 在 body 字段的上下文 token 数 */
const SNIPPET_BODY_TOKENS = 24;
/** bm25 中 title 列权重（FTS5 非 UNINDEXED 列顺序：title, body） */
const BM25_TITLE_WEIGHT = 10.0;
/** bm25 中 body 列权重 */
const BM25_BODY_WEIGHT = 1.0;
/** snippet 高亮起始标签 */
const SNIPPET_MARK_OPEN = '<mark>';
/** snippet 高亮结束标签 */
const SNIPPET_MARK_CLOSE = '</mark>';
/** snippet 省略号占位 */
const SNIPPET_ELLIPSIS = '...';
/** 列表历史默认返回上限 */
const DEFAULT_HISTORY_LIMIT = 10;

/**
 * 全局搜索 SQL 模板（12 参数）。
 * 参数布局：snippet(title) 4 + snippet(body) 4 + bm25 2 + MATCH 1 + LIMIT 1。
 *
 * note-app 仅索引 doc 实体（无 scope 模式），故比 todo-app 更简洁。
 */
const SEARCH_SQL = `SELECT
    entity_type,
    entity_id,
    snippet(note_fts, 2, ?, ?, ?, ?) AS title_snippet,
    snippet(note_fts, 3, ?, ?, ?, ?) AS body_snippet,
    bm25(note_fts, ?, ?) AS rank
 FROM note_fts
 WHERE note_fts MATCH ?
 ORDER BY rank
 LIMIT ?`;

/**
 * 前缀 token 中需剔除的 FTS5 操作符 / 控制字符。
 *
 * 最后一个 token 以 bare 形式（不带双引号）输出为 `token*`，无法用 phrase
 * 转义机制屏蔽操作符，故在这里显式清洗，避免破坏 FTS5 表达式语法。
 */
const FTS5_OPERATOR_CHARS = /["*:^()[\]{}]/g;

/**
 * 全文搜索 Service（note-app）
 *
 * 职责：
 * - `syncFts(type, id, rawText | null)`：UPSERT 单条 FTS 索引（DELETE + INSERT）
 * - `syncFtsBatch(type, ids[])`：批量删除（级联软删除时调用，不带自有事务）
 * - `search(query, limit)`：jieba 分词 → FTS5 MATCH → bm25 排序 → snippet → 二次查主表补全 → UPSERT 历史
 * - `buildFtsQuery(query)`：构造 FTS5 查询——最后一个 token 走前缀匹配（边打边搜），其余 phrase 精确匹配
 * - `resolveCategoryPath(categoryId)`：递归反查 parent_id 链
 * - 搜索历史：list / delete / clear
 *
 * 与 todo-search.service 的区别：
 * - 仅索引 doc 实体（不支持 category/todo_list/todo_item/document scope）
 * - 无 scope 模式（note-app 无 todo_list 维度）
 *
 * 独立性约束：不引用 todo-app 的代码。
 */
export class NoteSearchService {
  private db: DBManager;
  private tokenizer: NoteTokenizer;

  constructor(db: DBManager, tokenizer?: NoteTokenizer) {
    this.db = db;
    this.tokenizer = tokenizer ?? new NoteTokenizer();
  }

  // =========================================================================
  // FTS 同步
  // =========================================================================

  /**
   * UPSERT 单条 FTS 索引：先 DELETE 旧记录，若 rawText 非空再 INSERT。
   *
   * FTS5 不支持 `INSERT OR REPLACE`，故用 DELETE + INSERT 实现 UPSERT。
   * 调用方应在事务内调用本方法（与主表写入同事务保证一致性）。
   *
   * @param type - 实体类型（note-app 仅 'doc'）
   * @param id - 实体 ID
   * @param rawText - 待索引的文本（null / 空对象表示仅删除不重建）
   */
  syncFts(
    type: NoteFtsEntityType,
    id: number,
    rawText: { title: string; body: string } | null,
  ): void {
    this.db.execute(
      `DELETE FROM note_fts WHERE entity_type = ? AND entity_id = ?`,
      [type, id],
    );

    if (!rawText) {
      return;
    }

    const titleTokens = this.tokenizer.cut(rawText.title);
    const bodyTokens = this.tokenizer.cut(rawText.body);
    if (titleTokens.length === 0 && bodyTokens.length === 0) {
      return;
    }

    this.db.insert(
      `INSERT INTO note_fts (entity_type, entity_id, title, body) VALUES (?, ?, ?, ?)`,
      [type, id, titleTokens, bodyTokens],
    );
  }

  /**
   * 批量删除 FTS 索引（不带自有事务，调用方负责事务）。
   *
   * @param type - 实体类型
   * @param ids - 实体 ID 列表
   */
  syncFtsBatch(type: NoteFtsEntityType, ids: number[]): void {
    if (ids.length === 0) {
      return;
    }
    const placeholders = ids.map(() => '?').join(',');
    this.db.execute(
      `DELETE FROM note_fts WHERE entity_type = ? AND entity_id IN (${placeholders})`,
      [type, ...ids],
    );
  }

  // =========================================================================
  // 搜索
  // =========================================================================

  /**
   * 执行全文搜索：分词 → MATCH → bm25 排序 → snippet 高亮 → 主表补全 → 历史 UPSERT。
   *
   * @param query - 用户原始输入
   * @param limit - 返回上限（默认 30）
   * @returns 命中结果数组（按相关度升序）
   */
  search(query: string, limit: number = DEFAULT_SEARCH_LIMIT): NoteSearchResult[] {
    const trimmed = (query ?? '').trim();
    const ftsQuery = this.buildFtsQuery(trimmed);

    if (ftsQuery.length === 0) {
      this.upsertSearchHistory(trimmed, 0);
      return [];
    }

    const params = [
      SNIPPET_MARK_OPEN,
      SNIPPET_MARK_CLOSE,
      SNIPPET_ELLIPSIS,
      SNIPPET_TITLE_TOKENS,
      SNIPPET_MARK_OPEN,
      SNIPPET_MARK_CLOSE,
      SNIPPET_ELLIPSIS,
      SNIPPET_BODY_TOKENS,
      BM25_TITLE_WEIGHT,
      BM25_BODY_WEIGHT,
      ftsQuery,
      limit,
    ];

    let rows: FtsRow[] = [];
    try {
      rows = this.db.query<FtsRow>(SEARCH_SQL, params);
    } catch (err) {
      logger.error('FTS search failed', err);
      this.upsertSearchHistory(trimmed, 0);
      return [];
    }

    const results = rows
      .map((row) => this.enrichRow(row))
      .filter((r): r is NoteSearchResult => r !== null);

    this.upsertSearchHistory(trimmed, results.length);
    return results;
  }

  /**
   * 构造 FTS5 查询：jieba 分词后，最后一个 token 走前缀匹配（`token*`），
   * 其余 token 用 phrase 双引号包裹做精确匹配。
   *
   * @param query - 用户原始输入（已 trim）
   * @returns FTS5 MATCH 表达式；空输入或清洗后无 token 返回空串
   */
  buildFtsQuery(query: string): string {
    if (!query) {
      return '';
    }
    const tokens = this.tokenizer
      .cut(query)
      .split(' ')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (tokens.length === 0) {
      return '';
    }

    const phrases = tokens.slice(0, -1).map((t) => `"${t.replace(/"/g, '""')}"`);
    const cleanedLast = tokens[tokens.length - 1].replace(FTS5_OPERATOR_CHARS, '');
    if (cleanedLast.length === 0) {
      return phrases.join(' ');
    }
    return [...phrases, `${cleanedLast}*`].join(' ');
  }

  // =========================================================================
  // 主表回查 & category_path
  // =========================================================================

  /**
   * 对单条 FTS 命中行进行二次查询：补全 title（snippet 可能截断）+ category_path。
   * 若主表行已软删除（FTS 未及时清理的边界），返回 null（由调用方过滤）。
   */
  private enrichRow(row: FtsRow): NoteSearchResult | null {
    const entityType = row.entity_type as NoteFtsEntityType;
    const entityId = row.entity_id;

    if (entityType !== 'doc') {
      return null;
    }

    const r = this.db.get<{ title: string; category_id: number | null }>(
      `SELECT title, category_id FROM note_doc WHERE id = ? AND deleted_at IS NULL`,
      [entityId],
    );
    if (!r) return null;

    const categoryPath = this.resolveCategoryPath(r.category_id);

    // snippet 优先用 title_snippet；title 未命中时回退 body_snippet
    const snippet = row.title_snippet && /<mark>/.test(row.title_snippet)
      ? row.title_snippet
      : row.body_snippet || row.title_snippet || '';

    return {
      type: entityType,
      id: entityId,
      title: r.title,
      snippet,
      category_path: categoryPath,
      rank: row.rank,
    };
  }

  /**
   * 递归反查 category 的 parent_id 链，返回根→父的名称数组（不含自身）。
   *
   * @param categoryId - 起始 category（通常是命中实体的归属分类）
   * @returns 名称数组；categoryId 为 null 时返回空数组
   */
  resolveCategoryPath(categoryId: number | null): string[] {
    if (categoryId === null) {
      return [];
    }
    const chain: string[] = [];
    let cursor: number | null = categoryId;
    const visited = new Set<number>(); // 防环保护
    while (cursor !== null) {
      if (visited.has(cursor)) {
        logger.warn(`Detected cycle in category parent chain at ${cursor}`);
        break;
      }
      visited.add(cursor);
      const r = this.db.get<{ name: string; parent_id: number | null }>(
        `SELECT name, parent_id FROM note_category WHERE id = ? AND deleted_at IS NULL`,
        [cursor],
      );
      if (!r) break;
      chain.push(r.name);
      cursor = r.parent_id;
    }
    return chain.reverse();
  }

  // =========================================================================
  // 搜索历史
  // =========================================================================

  /** UPSERT 搜索历史：依赖 uq_note_search_history_query 唯一索引。 */
  upsertSearchHistory(query: string, hitCount: number): void {
    if (!query) {
      return;
    }
    const now = Date.now();
    this.db.execute(
      `INSERT INTO note_search_history (query, hit_count, searched_at)
       VALUES (?, ?, ?)
       ON CONFLICT(query) DO UPDATE SET
         hit_count = excluded.hit_count,
         searched_at = excluded.searched_at`,
      [query, hitCount, now],
    );
  }

  /** 列出最近的搜索历史（默认 10 条，按 searched_at DESC + id DESC 排序） */
  listSearchHistory(limit: number = DEFAULT_HISTORY_LIMIT): NoteSearchHistory[] {
    return this.db.query<NoteSearchHistory>(
      `SELECT id, query, hit_count, searched_at
       FROM note_search_history
       ORDER BY searched_at DESC, id DESC
       LIMIT ?`,
      [limit],
    );
  }

  /** 删除单条搜索历史 */
  deleteSearchHistory(id: number): void {
    this.db.execute(`DELETE FROM note_search_history WHERE id = ?`, [id]);
  }

  /** 清空全部搜索历史 */
  clearSearchHistory(): void {
    this.db.execute(`DELETE FROM note_search_history`, []);
  }
}

// ============================================================================
// 内部类型
// ============================================================================

interface FtsRow {
  entity_type: string;
  entity_id: number;
  title_snippet: string;
  body_snippet: string;
  rank: number;
}
