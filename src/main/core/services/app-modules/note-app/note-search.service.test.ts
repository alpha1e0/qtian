/**
 * NoteSearchService 单元测试
 *
 * 重点：syncFts/search/history/category_path/bm25 排序/snippet 高亮/buildFtsQuery。
 *
 * 策略：使用 note-mock-db，mock 支持 FTS5 MATCH/snippet/bm25 近似 + ON CONFLICT UPSERT。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('better-sqlite3', async () => {
  const { createNoteMemDbFactory } = await import('./note-mock-db');
  return createNoteMemDbFactory();
});

vi.mock('@/core/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { DBManager } from '@/core/database/db-manager';
import { NoteSearchService } from './note-search.service';
import { NoteTokenizer } from './note-tokenizer';

describe('NoteSearchService', () => {
  let db: DBManager;
  let svc: NoteSearchService;

  beforeEach(() => {
    db = new DBManager(':memory:');
    svc = new NoteSearchService(db, new NoteTokenizer());
  });

  // =========================================================================
  // 测试辅助
  // =========================================================================

  /** 插入 note_category 主表行，返回分配的 id */
  function insertCategory(name: string, parentId: number | null = null): number {
    const now = Date.now();
    const r = db.insert(
      `INSERT INTO note_category (name, parent_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, NULL)`,
      [name, parentId, now, now],
    );
    return r.lastRowid;
  }

  /** 插入 note_doc 主表行，返回分配的 id */
  function insertDoc(
    title: string,
    summary: string = '',
    content: string = '',
    categoryId: number | null = null,
  ): number {
    const now = Date.now();
    const r = db.insert(
      `INSERT INTO note_doc (title, summary, content, category_id, task_prompt, is_favorite, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, '', 0, ?, ?, NULL)`,
      [title, summary, content, categoryId, now, now],
    );
    return r.lastRowid;
  }

  // =========================================================================
  // syncFts
  // =========================================================================

  describe('syncFts', () => {
    it('写入非空文本后应可在 FTS 中查到', () => {
      insertDoc('测试文档');
      svc.syncFts('doc', 1, { title: '测试文档', body: '内容' });
      const results = svc.search('测试文档');
      expect(results.length).toBe(1);
      expect(results[0].id).toBe(1);
      expect(results[0].type).toBe('doc');
    });

    it('rawText=null 时仅删除不写入', () => {
      insertDoc('待删除');
      svc.syncFts('doc', 1, { title: '待删除', body: '' });
      svc.syncFts('doc', 1, null);
      const results = svc.search('待删除');
      expect(results.length).toBe(0);
    });

    it('全空文本不写入 FTS', () => {
      insertDoc('空文档');
      svc.syncFts('doc', 1, { title: '', body: '' });
      const results = svc.search('any');
      expect(results.length).toBe(0);
    });
  });

  // =========================================================================
  // syncFtsBatch
  // =========================================================================

  describe('syncFtsBatch', () => {
    it('批量删除 FTS 索引', () => {
      insertDoc('文档一');
      insertDoc('文档二');
      insertDoc('文档三');
      svc.syncFts('doc', 1, { title: '文档一', body: '' });
      svc.syncFts('doc', 2, { title: '文档二', body: '' });
      svc.syncFts('doc', 3, { title: '文档三', body: '' });
      svc.syncFtsBatch('doc', [1, 2]);
      expect(svc.search('文档一').length).toBe(0);
      expect(svc.search('文档二').length).toBe(0);
      expect(svc.search('文档三').length).toBe(1);
    });

    it('空数组为 no-op', () => {
      expect(() => svc.syncFtsBatch('doc', [])).not.toThrow();
    });
  });

  // =========================================================================
  // search
  // =========================================================================

  describe('search', () => {
    it('命中结果 type 为 doc', () => {
      insertDoc('架构设计', '系统架构概览');
      svc.syncFts('doc', 1, { title: '架构设计', body: '系统架构概览' });
      const results = svc.search('架构');
      expect(results.length).toBe(1);
      expect(results[0].type).toBe('doc');
      expect(results[0].id).toBe(1);
      expect(results[0].title).toBe('架构设计');
    });

    it('title 命中 rank 小于 body 命中（title 权重更高）', () => {
      insertDoc('关键词测试');
      insertDoc('其他标题', '关键词在正文');
      svc.syncFts('doc', 1, { title: '关键词测试', body: '' });
      svc.syncFts('doc', 2, { title: '其他标题', body: '关键词在正文' });
      const results = svc.search('关键词');
      expect(results.length).toBe(2);
      // title 命中（id=1）应排在前面（rank 更小）
      expect(results[0].id).toBe(1);
    });

    it('snippet 应包含 <mark> 标签', () => {
      insertDoc('Markdown 语法');
      svc.syncFts('doc', 1, { title: 'Markdown 语法', body: '' });
      const results = svc.search('Markdown');
      expect(results.length).toBe(1);
      expect(results[0].snippet).toContain('<mark>');
    });

    it('category_path 正确解析', () => {
      const rootId = insertCategory('根分类');
      const childId = insertCategory('子分类', rootId);
      insertDoc('文档', '', '', childId);
      svc.syncFts('doc', 1, { title: '文档', body: '' });
      const results = svc.search('文档');
      expect(results.length).toBe(1);
      // category_path 应为根→父（不含自身）
      expect(results[0].category_path).toEqual(['根分类', '子分类']);
    });

    it('无 category 的文档返回空 category_path', () => {
      insertDoc('无分类文档');
      svc.syncFts('doc', 1, { title: '无分类文档', body: '' });
      const results = svc.search('无分类');
      expect(results.length).toBe(1);
      expect(results[0].category_path).toEqual([]);
    });

    it('空查询返回空数组', () => {
      insertDoc('测试');
      svc.syncFts('doc', 1, { title: '测试', body: '' });
      expect(svc.search('')).toEqual([]);
      expect(svc.search('   ')).toEqual([]);
    });
  });

  // =========================================================================
  // buildFtsQuery
  // =========================================================================

  describe('buildFtsQuery', () => {
    it('中文单个 token 走前缀匹配', () => {
      const q = svc.buildFtsQuery('架构');
      // NoteTokenizer.cut 会分词，最后一个 token 追加 *
      expect(q).toMatch(/\*$/);
    });

    it('英文单词小写化', () => {
      const q = svc.buildFtsQuery('Hello');
      expect(q).toContain('hello');
    });

    it('空串返回空字符串', () => {
      expect(svc.buildFtsQuery('')).toBe('');
      expect(svc.buildFtsQuery('   ')).toBe('');
    });

    it('多个 token 最后一个走前缀', () => {
      const q = svc.buildFtsQuery('系统 架构');
      expect(q).toMatch(/\*$/);
    });
  });

  // =========================================================================
  // 搜索历史
  // =========================================================================

  describe('搜索历史', () => {
    it('search 后应 UPSERT 历史', () => {
      insertDoc('测试');
      svc.syncFts('doc', 1, { title: '测试', body: '' });
      svc.search('测试');
      const history = svc.listSearchHistory();
      expect(history.length).toBe(1);
      expect(history[0].query).toBe('测试');
      expect(history[0].hit_count).toBe(1);
    });

    it('重复查询 UPSERT 更新 hit_count', () => {
      insertDoc('测试');
      svc.syncFts('doc', 1, { title: '测试', body: '' });
      svc.search('测试');
      svc.search('测试');
      const history = svc.listSearchHistory();
      expect(history.length).toBe(1);
      expect(history[0].hit_count).toBe(1);
    });

    it('listSearchHistory 按 searched_at DESC 排序', () => {
      insertDoc('文档A');
      insertDoc('文档B');
      svc.syncFts('doc', 1, { title: '文档A', body: '' });
      svc.syncFts('doc', 2, { title: '文档B', body: '' });
      svc.search('文档A');
      svc.search('文档B');
      const history = svc.listSearchHistory();
      expect(history[0].query).toBe('文档B');
      expect(history[1].query).toBe('文档A');
    });

    it('deleteSearchHistory 删除单条', () => {
      insertDoc('文档A');
      svc.syncFts('doc', 1, { title: '文档A', body: '' });
      svc.search('文档A');
      const history = svc.listSearchHistory();
      svc.deleteSearchHistory(history[0].id);
      expect(svc.listSearchHistory().length).toBe(0);
    });

    it('clearSearchHistory 清空全部', () => {
      insertDoc('文档A');
      insertDoc('文档B');
      svc.syncFts('doc', 1, { title: '文档A', body: '' });
      svc.syncFts('doc', 2, { title: '文档B', body: '' });
      svc.search('文档A');
      svc.search('文档B');
      svc.clearSearchHistory();
      expect(svc.listSearchHistory().length).toBe(0);
    });
  });
});
