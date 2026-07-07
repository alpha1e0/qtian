/**
 * TodoSearchService 单元测试
 *
 * 重点：syncFts/search/history/category_path/bm25 排序/snippet 高亮/buildFtsQuery。
 *
 * 策略：使用 todo-mock-db（与其它 Service 测试一致），mock 已扩展支持
 *      FTS5 MATCH/snippet/bm25 近似 + ON CONFLICT UPSERT。
 *      原因：真实 better-sqlite3 在 vitest 下无法加载（编译为 Electron ABI），
 *      全局 vitest.setup.ts 已 mock；本文件通过文件级 vi.mock 覆盖为 todo-mock-db。
 *      FTS5 排序为近似实现，仅验证 Service 层编排逻辑。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 文件级 mock：覆盖全局 vitest.setup.ts 的 better-sqlite3 mock
vi.mock('better-sqlite3', async () => {
  const { createTodoMemDbFactory } = await import('./todo-mock-db');
  return createTodoMemDbFactory();
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
import { TodoSearchService } from './todo-search.service';
import { TodoTokenizer } from './todo-tokenizer';

describe('TodoSearchService', () => {
  let db: DBManager;
  let svc: TodoSearchService;

  beforeEach(() => {
    db = new DBManager(':memory:');
    svc = new TodoSearchService(db, new TodoTokenizer());
  });

  // =========================================================================
  // 测试辅助：插入主表实体（enrichRow 需要回查主表补全 title）
  // =========================================================================

  /** 插入 category 主表行，返回分配的 id */
  function insertCategory(name: string, parentId: number | null = null): number {
    const now = Date.now();
    const r = db.insert(
      `INSERT INTO todo_category (name, parent_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, NULL)`,
      [name, parentId, now, now],
    );
    // DBManager.insert 返回 { lastRowid, changes }（非 lastInsertRowid）
    return r.lastRowid;
  }

  /** 插入 todo_list 主表行，返回分配的 id */
  function insertList(name: string, categoryId: number | null = null): number {
    const now = Date.now();
    const r = db.insert(
      `INSERT INTO todo_list (name, description, category_id, created_at, updated_at, deleted_at)
       VALUES (?, '', ?, ?, ?, NULL)`,
      [name, categoryId, now, now],
    );
    return r.lastRowid;
  }

  /** 插入 todo_item 主表行，返回分配的 id */
  function insertItem(title: string, listId: number): number {
    const now = Date.now();
    const r = db.insert(
      `INSERT INTO todo_item
        (title, description, task_prompt, parent_id, status, progress, priority, due_at,
         todo_list_id, agent_task_id, is_manual_progress, created_at, updated_at, deleted_at)
       VALUES (?, '', '', NULL, 'init', 0, 'normal', NULL, ?, NULL, 0, ?, ?, NULL)`,
      [title, listId, now, now],
    );
    return r.lastRowid;
  }

  // =========================================================================
  // syncFts
  // =========================================================================

  describe('syncFts', () => {
    it('写入后应能被搜索命中', () => {
      const id = insertCategory('工作计划');
      svc.syncFts('category', id, { title: '工作计划', body: '' });
      const results = svc.search('工作');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].type).toBe('category');
      expect(results[0].id).toBe(id);
    });

    it('rawText=null 应仅删除不重建', () => {
      const id = insertCategory('工作');
      svc.syncFts('category', id, { title: '工作', body: '' });
      svc.syncFts('category', id, null);
      expect(svc.search('工作')).toHaveLength(0);
    });

    it('全空文本不应入库', () => {
      const id = insertCategory('空');
      svc.syncFts('category', id, { title: '', body: '' });
      expect(svc.search('anything')).toHaveLength(0);
    });

    it('重复 syncFts 应覆盖（UPSERT 语义）', () => {
      const id = insertCategory('占位');
      svc.syncFts('category', id, { title: '旧名称', body: '' });
      svc.syncFts('category', id, { title: '新名称', body: '' });
      // 主表名仍为"占位"，但 FTS 索引已更新；搜索"旧名称"不应命中
      expect(svc.search('旧名称')).toHaveLength(0);
      // 搜索"新名称"命中（title 来自主表回查 = "占位"，但 FTS MATCH 命中证明索引已更新）
      expect(svc.search('新名称').length).toBeGreaterThanOrEqual(1);
    });

    it('body 字段单独写入也能被搜索', () => {
      const listId = insertList('列表占位');
      const itemId = insertItem('任务占位', listId);
      svc.syncFts('todo_item', itemId, {
        title: '任务占位',
        body: '这是一个详细的描述内容',
      });
      const results = svc.search('描述');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe(itemId);
    });
  });

  describe('syncFtsBatch', () => {
    it('批量删除多条 FTS', () => {
      const id1 = insertItem('苹果', insertList('L'));
      const id2 = insertItem('香蕉', insertList('L'));
      const id3 = insertItem('橙子', insertList('L'));
      svc.syncFts('todo_item', id1, { title: '苹果', body: '' });
      svc.syncFts('todo_item', id2, { title: '香蕉', body: '' });
      svc.syncFts('todo_item', id3, { title: '橙子', body: '' });
      svc.syncFtsBatch('todo_item', [id1, id2]);
      expect(svc.search('苹果')).toHaveLength(0);
      expect(svc.search('香蕉')).toHaveLength(0);
      expect(svc.search('橙子').length).toBeGreaterThanOrEqual(1);
    });

    it('空 id 列表不抛错', () => {
      expect(() => svc.syncFtsBatch('todo_item', [])).not.toThrow();
    });
  });

  // =========================================================================
  // search / bm25 / snippet
  // =========================================================================

  describe('search', () => {
    it('空 query 返回空数组且不记录历史', () => {
      expect(svc.search('')).toEqual([]);
      expect(svc.search('   ')).toEqual([]);
      expect(svc.listSearchHistory()).toHaveLength(0);
    });

    it('非空但无命中的 query 应记录 hit_count=0', () => {
      svc.search('完全不存在的词组xyz');
      const history = svc.listSearchHistory();
      expect(history).toHaveLength(1);
      expect(history[0].hit_count).toBe(0);
    });

    it('bm25 排序：title 命中权重高于 body', () => {
      const listId = insertList('L');
      const id1 = insertItem('A', listId);
      const id2 = insertItem('B', listId);
      // A 仅 body 命中，B title 命中
      svc.syncFts('todo_item', id1, { title: 'A', body: '关键词内容' });
      svc.syncFts('todo_item', id2, { title: '关键词B', body: '其他内容' });
      const results = svc.search('关键词');
      expect(results.length).toBeGreaterThanOrEqual(2);
      // title 命中（rank 更小）应排在前面
      expect(results[0].id).toBe(id2);
    });

    it('snippet 应包含 <mark> 高亮标签', () => {
      const id = insertCategory('这是一个测试分类');
      svc.syncFts('category', id, { title: '这是一个测试分类', body: '' });
      const results = svc.search('测试');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].snippet).toContain('<mark>');
      expect(results[0].snippet).toContain('</mark>');
    });

    it('AND 匹配：多 token query 要求全部命中', () => {
      const listId = insertList('L');
      const id1 = insertItem('工作', listId);
      const id2 = insertItem('计划', listId);
      const id3 = insertItem('工作计划', listId);
      svc.syncFts('todo_item', id1, { title: '工作', body: '' });
      svc.syncFts('todo_item', id2, { title: '计划', body: '' });
      svc.syncFts('todo_item', id3, { title: '工作计划', body: '' });
      const results = svc.search('工作 计划');
      // 只有同时包含两者的 #3 才命中
      const ids = results.map((r) => r.id);
      expect(ids).toContain(id3);
      expect(ids).not.toContain(id1);
      expect(ids).not.toContain(id2);
    });

    it('返回结果按 rank 升序排列', () => {
      const listId = insertList('L');
      const id1 = insertItem('苹果', listId);
      const id2 = insertItem('苹果苹果', listId);
      svc.syncFts('todo_item', id1, { title: '苹果', body: '' });
      svc.syncFts('todo_item', id2, { title: '苹果苹果', body: '' });
      const results = svc.search('苹果');
      for (let i = 1; i < results.length; i++) {
        expect(results[i].rank).toBeGreaterThanOrEqual(results[i - 1].rank);
      }
    });

    it('前缀匹配：索引"白板会议"，搜索"白"命中（边打边搜）', () => {
      const id = insertCategory('白板会议');
      svc.syncFts('category', id, { title: '白板会议', body: '' });
      const results = svc.search('白');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe(id);
      // snippet 应高亮以"白"开头的 token（如"白板"）
      expect(results[0].snippet).toContain('<mark>');
    });

    it('多 token 前缀：搜索"vue 组"命中"vue 组件设计"', () => {
      const listId = insertList('L');
      const id = insertItem('vue 组件设计', listId);
      svc.syncFts('todo_item', id, { title: 'vue 组件设计', body: '' });
      const results = svc.search('vue 组');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe(id);
    });
  });

  describe('buildFtsQuery', () => {
    it('空输入返回空串', () => {
      expect(svc.buildFtsQuery('')).toBe('');
      expect(svc.buildFtsQuery('   ')).toBe('');
    });

    it('中文分词：除最后一个 token 外，其余被 phrase 包裹；最后一个以 * 结尾（前缀）', () => {
      const q = svc.buildFtsQuery('工作计划');
      // 至少分出 2 个 token
      const parts = q.split(' ').filter(Boolean);
      expect(parts.length).toBeGreaterThanOrEqual(2);
      // 最后一个 token 是 bare prefix（无引号、以 * 结尾）
      const last = parts[parts.length - 1];
      expect(last.endsWith('*')).toBe(true);
      expect(last.startsWith('"')).toBe(false);
      // 前面的 token 都是 phrase（双引号包裹）
      for (let i = 0; i < parts.length - 1; i++) {
        expect(parts[i].startsWith('"')).toBe(true);
        expect(parts[i].endsWith('"')).toBe(true);
      }
    });

    it('英文单词保持完整并被包裹', () => {
      const q = svc.buildFtsQuery('hello world');
      // hello 在前 → phrase；world 在末 → 前缀
      expect(q).toContain('"hello"');
      expect(q.endsWith('world*')).toBe(true);
    });

    it('FTS5 操作符字符不破坏 query 语法（清洗后末尾追加前缀 *）', () => {
      // jieba 将 * 作为分隔符切出 foo / bar 两个 token；输出形如 `"foo" bar*`
      const q = svc.buildFtsQuery('foo*bar');
      expect(q.endsWith('*')).toBe(true);
      // 除末尾前缀通配符外，q 中不应残留输入的 * 字面字符（避免破坏 FTS5 语法）
      expect(q.slice(0, -1)).not.toContain('*');
    });

    it('单 token：中文/英文均以 * 结尾（前缀语义）', () => {
      expect(svc.buildFtsQuery('白')).toBe('白*');
      expect(svc.buildFtsQuery('vue')).toBe('vue*');
    });

    it('多 token：前面 phrase 精确匹配，最后一个走前缀', () => {
      const q = svc.buildFtsQuery('vue 组件');
      expect(q.startsWith('"vue"')).toBe(true);
      expect(q.endsWith('组件*')).toBe(true);
    });

    it('纯标点输入：jieba 过滤后返回空串', () => {
      expect(svc.buildFtsQuery('***')).toBe('');
      expect(svc.buildFtsQuery('（）')).toBe('');
    });
  });

  // =========================================================================
  // category_path
  // =========================================================================

  describe('resolveCategoryPath', () => {
    it('null categoryId 返回空数组', () => {
      expect(svc.resolveCategoryPath(null)).toEqual([]);
    });

    it('根 category 的 path 仅含自身（无父链）', () => {
      const id = insertCategory('根');
      expect(svc.resolveCategoryPath(id)).toEqual(['根']);
    });

    it('多层路径返回根→自身的完整名称数组', () => {
      // L1 (root) -> L2 -> L3 (target)
      const l1 = insertCategory('L1');
      const l2 = insertCategory('L2', l1);
      const l3 = insertCategory('L3', l2);
      const path = svc.resolveCategoryPath(l3);
      // 含完整链根→自身：[L1, L2, L3]
      expect(path).toEqual(['L1', 'L2', 'L3']);
    });

    it('搜索结果中 category_path 应正确回填（多层）', () => {
      const root = insertCategory('根分类');
      const listId = insertList('子列表', root);
      svc.syncFts('todo_list', listId, { title: '子列表', body: '' });
      const results = svc.search('子列表');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].category_path).toEqual(['根分类']);
    });
  });

  // =========================================================================
  // 搜索历史
  // =========================================================================

  describe('search history', () => {
    it('listSearchHistory 默认按时间倒序', () => {
      svc.search('第一次');
      // 手动调整时间戳以保证顺序（mock 支持 UPDATE）
      db.execute(
        `UPDATE todo_search_history SET searched_at = ? WHERE query = ?`,
        [1000, '第一次'],
      );
      svc.search('第二次');
      const history = svc.listSearchHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(history[0].query).toBe('第二次');
    });

    it('UPSERT：相同 query 不新增，仅更新 hit_count + searched_at', () => {
      const listId = insertList('L');
      const itemId = insertItem('工作', listId);
      svc.syncFts('todo_item', itemId, { title: '工作', body: '' });
      svc.search('工作'); // hit_count >= 1
      const beforeCount = db.get<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM todo_search_history`,
      )!.cnt;
      svc.search('工作'); // 再次 UPSERT
      const afterCount = db.get<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM todo_search_history`,
      )!.cnt;
      expect(afterCount).toBe(beforeCount); // 不新增行
    });

    it('deleteSearchHistory 单条删除', () => {
      svc.search('foo');
      const list = svc.listSearchHistory();
      svc.deleteSearchHistory(list[0].id);
      expect(svc.listSearchHistory()).toHaveLength(0);
    });

    it('clearSearchHistory 清空全部', () => {
      svc.search('a');
      svc.search('b');
      svc.clearSearchHistory();
      expect(svc.listSearchHistory()).toHaveLength(0);
    });
  });

  // =========================================================================
  // 集成：软删除后搜索不应命中
  // =========================================================================

  describe('与软删除集成', () => {
    it('软删除后 FTS 不命中（syncFts(null) 后）', () => {
      const listId = insertList('L');
      const itemId = insertItem('工作', listId);
      svc.syncFts('todo_item', itemId, { title: '工作', body: '' });
      expect(svc.search('工作').length).toBeGreaterThanOrEqual(1);
      svc.syncFts('todo_item', itemId, null); // 模拟软删除
      expect(svc.search('工作')).toHaveLength(0);
    });

    it('restore 后重新 syncFts 又能命中', () => {
      const listId = insertList('L');
      const itemId = insertItem('工作', listId);
      svc.syncFts('todo_item', itemId, { title: '工作', body: '' });
      svc.syncFts('todo_item', itemId, null);
      expect(svc.search('工作')).toHaveLength(0);
      svc.syncFts('todo_item', itemId, { title: '工作', body: '' });
      expect(svc.search('工作').length).toBeGreaterThanOrEqual(1);
    });
  });
});
