import { DBManager } from '@/core/database/db-manager';
import { createLogger } from '@/core/utils/logger';
import { TodoTokenizer } from './todo-tokenizer';
import {
  TodoFtsEntityType,
  TodoSearchResult,
  TodoSearchHistory,
} from './types';

const logger = createLogger('TodoSearchService');

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
 * 前缀 token 中需剔除的 FTS5 操作符 / 控制字符。
 *
 * 最后一个 token 以 bare 形式（不带双引号）输出为 `token*`，无法用 phrase
 * 转义机制屏蔽操作符，故在这里显式清洗，避免破坏 FTS5 表达式语法。
 */
const FTS5_OPERATOR_CHARS = /["*:^()[\]{}]/g;

/**
 * 全文搜索 Service（Phase 3）
 *
 * 职责：
 * - `syncFts(type, id, rawText | null)`：UPSERT 单条 FTS 索引（DELETE + INSERT）
 * - `syncFtsBatch(type, ids[])`：批量删除（级联软删除时调用，不带自有事务）
 * - `search(query, limit)`：jieba 分词 → FTS5 MATCH → bm25 排序 → snippet → 二次查主表补全 → UPSERT 历史
 * - `buildFtsQuery(query)`：构造 FTS5 查询——最后一个 token 走前缀匹配（边打边搜），其余 phrase 精确匹配
 * - `resolveCategoryPath(categoryId)`：递归反查 parent_id 链
 * - 搜索历史：list / delete / clear
 *
 * 依赖关系（关键决策）：
 *  - 仅依赖 `DBManager` + `TodoTokenizer`，**不依赖其他业务 Service**（避免循环依赖）
 *  - 其他 Service 通过可选构造参数注入本类（默认 null），调用时 `?.syncFts(...)`
 *
 * 设计文档：docs/specs/100_todo-app-design.md §7
 */
export class TodoSearchService {
  private db: DBManager;
  private tokenizer: TodoTokenizer;

  constructor(db: DBManager, tokenizer?: TodoTokenizer) {
    this.db = db;
    this.tokenizer = tokenizer ?? new TodoTokenizer();
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
   * @param type - 实体类型
   * @param id - 实体 ID
   * @param rawText - 待索引的文本（null / 空对象表示仅删除不重建）
   */
  syncFts(
    type: TodoFtsEntityType,
    id: number,
    rawText: { title: string; body: string } | null,
  ): void {
    // DELETE：幂等，无论是否重建都先删
    this.db.execute(
      `DELETE FROM todo_fts WHERE entity_type = ? AND entity_id = ?`,
      [type, id],
    );

    if (!rawText) {
      return;
    }

    // 应用层 jieba 分词
    const titleTokens = this.tokenizer.cut(rawText.title);
    const bodyTokens = this.tokenizer.cut(rawText.body);
    // 全空的文本不入库（避免空 token 干扰 MATCH）
    if (titleTokens.length === 0 && bodyTokens.length === 0) {
      return;
    }

    this.db.insert(
      `INSERT INTO todo_fts (entity_type, entity_id, title, body) VALUES (?, ?, ?, ?)`,
      [type, id, titleTokens, bodyTokens],
    );
  }

  /**
   * 批量删除 FTS 索引（不带自有事务，调用方负责事务）。
   *
   * 用途：category/list/item 软删除时，级联清理子树 + 关联实体的 FTS。
   *
   * @param type - 实体类型
   * @param ids - 实体 ID 列表
   */
  syncFtsBatch(type: TodoFtsEntityType, ids: number[]): void {
    if (ids.length === 0) {
      return;
    }
    const placeholders = ids.map(() => '?').join(',');
    this.db.execute(
      `DELETE FROM todo_fts WHERE entity_type = ? AND entity_id IN (${placeholders})`,
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
  search(query: string, limit: number = DEFAULT_SEARCH_LIMIT): TodoSearchResult[] {
    const trimmed = (query ?? '').trim();
    const ftsQuery = this.buildFtsQuery(trimmed);

    // 无可搜索 token（空串或仅标点）：
    //   - 非空 trimmed（如纯标点）仍记录历史，便于 UI 展示用户尝试过的输入
    //   - 空串不记录（不算一次有效搜索动作）
    if (ftsQuery.length === 0) {
      this.upsertSearchHistory(trimmed, 0);
      return [];
    }

    let rows: FtsRow[] = [];
    try {
      rows = this.db.query<FtsRow>(
        `SELECT
            entity_type,
            entity_id,
            snippet(todo_fts, 2, ?, ?, ?, ?) AS title_snippet,
            snippet(todo_fts, 3, ?, ?, ?, ?) AS body_snippet,
            bm25(todo_fts, ?, ?) AS rank
         FROM todo_fts
         WHERE todo_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
        [
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
        ],
      );
    } catch (err) {
      logger.error('FTS search failed', err);
      // FTS 查询出错（如分词后语法异常）时降级为空结果，避免阻断 UI
      this.upsertSearchHistory(trimmed, 0);
      return [];
    }

    const results = rows
      .map((row) => this.enrichRow(row))
      .filter((r): r is TodoSearchResult => r !== null);

    this.upsertSearchHistory(trimmed, results.length);
    return results;
  }

  /**
   * 构造 FTS5 查询：jieba 分词后，最后一个 token 走前缀匹配（`token*`），
   * 其余 token 用 phrase 双引号包裹做精确匹配。
   *
   * 设计动机（边打边搜）：FTS5 索引按 jieba 完整词存储（如 "白板" 是一个 token），
   * 若所有 token 都用 phrase 精确匹配，输入 "白" 时 `"白"` 无法命中 "白板"。
   * 让最后一个未完成 token 走 `白*` 前缀查询，可匹配所有以 "白" 开头的索引 token；
   * 前面已完成的 token 保持 phrase 精确匹配，避免误命中。
   *
   * 注意：
   * - phrase token 内字面双引号用 `""` 转义；FTS5 操作符（`* : ^ ( )` 等）因双引号包裹自动失效。
   * - 前缀 token 以 bare 形式输出（不带双引号），无法用 phrase 转义，故先剔除
   *   `FTS5_OPERATOR_CHARS` 中的字符再追加 `*`，避免破坏表达式语法。
   * - 清洗后前缀为空（如纯标点 token）则跳过，避免产出独立的 `*` 通配。
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

    // 前面 token：phrase 精确匹配（双引号包裹，内部 " 用 "" 转义）
    const phrases = tokens.slice(0, -1).map((t) => `"${t.replace(/"/g, '""')}"`);
    // 最后一个 token：清洗 FTS5 操作符字符后追加 * 作为前缀
    const cleanedLast = tokens[tokens.length - 1].replace(FTS5_OPERATOR_CHARS, '');
    if (cleanedLast.length === 0) {
      // 最后 token 清洗后为空（纯符号）：仅返回前面的 phrase，避免独立的 `*` 通配
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
  private enrichRow(row: FtsRow): TodoSearchResult | null {
    const entityType = row.entity_type as TodoFtsEntityType;
    const entityId = row.entity_id;

    let title = '';
    let categoryId: number | null = null;

    switch (entityType) {
      case 'category': {
        const r = this.db.get<{ name: string; parent_id: number | null }>(
          `SELECT name, parent_id FROM todo_category WHERE id = ? AND deleted_at IS NULL`,
          [entityId],
        );
        if (!r) return null;
        title = r.name;
        categoryId = r.parent_id;
        break;
      }
      case 'todo_list': {
        const r = this.db.get<{ name: string; category_id: number | null }>(
          `SELECT name, category_id FROM todo_list WHERE id = ? AND deleted_at IS NULL`,
          [entityId],
        );
        if (!r) return null;
        title = r.name;
        categoryId = r.category_id;
        break;
      }
      case 'todo_item': {
        const r = this.db.get<{ title: string; todo_list_id: number }>(
          `SELECT title, todo_list_id FROM todo_item WHERE id = ? AND deleted_at IS NULL`,
          [entityId],
        );
        if (!r) return null;
        title = r.title;
        // item → list → category
        const listRow = this.db.get<{ category_id: number | null }>(
          `SELECT category_id FROM todo_list WHERE id = ? AND deleted_at IS NULL`,
          [r.todo_list_id],
        );
        categoryId = listRow?.category_id ?? null;
        break;
      }
      case 'document': {
        const r = this.db.get<{
          name: string;
          todo_list_id: number | null;
          todo_item_id: number | null;
        }>(
          `SELECT name, todo_list_id, todo_item_id FROM todo_document WHERE id = ? AND deleted_at IS NULL`,
          [entityId],
        );
        if (!r) return null;
        title = r.name;
        // document 通过 todo_list_id 或 todo_item_id 关联；回查所属 category 路径
        if (r.todo_list_id !== null) {
          const listRow = this.db.get<{ category_id: number | null }>(
            `SELECT category_id FROM todo_list WHERE id = ? AND deleted_at IS NULL`,
            [r.todo_list_id],
          );
          categoryId = listRow?.category_id ?? null;
        } else if (r.todo_item_id !== null) {
          const itemRow = this.db.get<{ todo_list_id: number }>(
            `SELECT todo_list_id FROM todo_item WHERE id = ? AND deleted_at IS NULL`,
            [r.todo_item_id],
          );
          if (itemRow) {
            const listRow = this.db.get<{ category_id: number | null }>(
              `SELECT category_id FROM todo_list WHERE id = ? AND deleted_at IS NULL`,
              [itemRow.todo_list_id],
            );
            categoryId = listRow?.category_id ?? null;
          }
        }
        break;
      }
      default:
        return null;
    }

    const categoryPath = this.resolveCategoryPath(categoryId);

    // snippet 优先用 title_snippet；title 未命中时回退 body_snippet
    const snippet = row.title_snippet && /<mark>/.test(row.title_snippet)
      ? row.title_snippet
      : row.body_snippet || row.title_snippet || '';

    return {
      type: entityType,
      id: entityId,
      title,
      snippet,
      category_path: categoryPath,
      rank: row.rank,
    };
  }

  /**
   * 递归反查 category 的 parent_id 链，返回根→父的名称数组（不含自身）。
   *
   * 用于 UI 面包屑：用户在搜索结果中看到"工作 / 项目A / 待办列表1"。
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
        `SELECT name, parent_id FROM todo_category WHERE id = ? AND deleted_at IS NULL`,
        [cursor],
      );
      if (!r) break;
      chain.push(r.name);
      cursor = r.parent_id;
    }
    // chain 当前是 自身→根 的顺序；翻转成 根→自身 的父链
    return chain.reverse();
  }

  // =========================================================================
  // 搜索历史
  // =========================================================================

  /**
   * UPSERT 搜索历史：依赖 uq_search_history_query 唯一索引。
   */
  upsertSearchHistory(query: string, hitCount: number): void {
    if (!query) {
      return;
    }
    const now = Date.now();
    this.db.execute(
      `INSERT INTO todo_search_history (query, hit_count, searched_at)
       VALUES (?, ?, ?)
       ON CONFLICT(query) DO UPDATE SET
         hit_count = excluded.hit_count,
         searched_at = excluded.searched_at`,
      [query, hitCount, now],
    );
  }

  /** 列出最近的搜索历史（默认 10 条） */
  listSearchHistory(limit: number = DEFAULT_HISTORY_LIMIT): TodoSearchHistory[] {
    return this.db.query<TodoSearchHistory>(
      `SELECT id, query, hit_count, searched_at
       FROM todo_search_history
       ORDER BY searched_at DESC
       LIMIT ?`,
      [limit],
    );
  }

  /** 删除单条搜索历史 */
  deleteSearchHistory(id: number): void {
    this.db.execute(`DELETE FROM todo_search_history WHERE id = ?`, [id]);
  }

  /** 清空全部搜索历史 */
  clearSearchHistory(): void {
    this.db.execute(`DELETE FROM todo_search_history`, []);
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
