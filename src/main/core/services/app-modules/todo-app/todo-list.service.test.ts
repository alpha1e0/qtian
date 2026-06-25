/**
 * TodoListService 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';

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

import { TodoDb } from './todo-db';
import { TodoListService } from './todo-list.service';
import { TodoItemService } from './todo-item.service';
import { TodoLabelService } from './todo-label.service';

const SQL_PATH = path.join(process.cwd(), 'data', 'todo-app.sql');

describe('TodoListService', () => {
  let db: TodoDb;
  let svc: TodoListService;

  beforeEach(() => {
    db = new TodoDb(':memory:', SQL_PATH);
    db.initialize();
    svc = new TodoListService(db.getDBManager());
  });

  describe('create', () => {
    it('应创建 todo_list', () => {
      const l = svc.create({ name: '今天', category_id: 1 });
      expect(l.id).toBeGreaterThan(0);
      expect(l.name).toBe('今天');
      expect(l.category_id).toBe(1);
      expect(l.description).toBe('');
    });

    it('name 为空时抛错', () => {
      expect(() => svc.create({ name: '' })).toThrow(/empty/);
    });

    it('支持未分类（category_id=null）', () => {
      const l = svc.create({ name: 'uncat', category_id: null });
      expect(l.category_id).toBeNull();
    });
  });

  describe('list', () => {
    it('无参返回全部未删除列表', () => {
      svc.create({ name: 'a' });
      svc.create({ name: 'b' });
      expect(svc.list()).toHaveLength(2);
    });

    it('按 categoryId 过滤', () => {
      svc.create({ name: 'in1', category_id: 1 });
      svc.create({ name: 'in1b', category_id: 1 });
      svc.create({ name: 'in2', category_id: 2 });
      expect(svc.list(1)).toHaveLength(2);
    });

    it('categoryId=null 返回未分类列表', () => {
      svc.create({ name: 'uncat', category_id: null });
      svc.create({ name: 'cat', category_id: 5 });
      const uncat = svc.list(null);
      expect(uncat).toHaveLength(1);
      expect(uncat[0].name).toBe('uncat');
    });
  });

  describe('getById', () => {
    it('应返回指定列表', () => {
      const created = svc.create({ name: 'x' });
      expect(svc.getById(created.id)?.name).toBe('x');
    });

    it('不存在的 id 返回 undefined', () => {
      expect(svc.getById(999)).toBeUndefined();
    });
  });

  describe('update', () => {
    it('应更新 name/description/category_id', () => {
      const l = svc.create({ name: 'old' });
      const updated = svc.update(l.id, { name: 'new', description: 'desc', category_id: 7 });
      expect(updated.name).toBe('new');
      expect(updated.description).toBe('desc');
      expect(updated.category_id).toBe(7);
    });

    it('不存在的 id 抛错', () => {
      expect(() => svc.update(999, { name: 'x' })).toThrow(/not found/);
    });
  });

  describe('delete 级联', () => {
    it('应级联软删除其下的 todo_item', () => {
      const l = svc.create({ name: 'list' });
      const labelSvc = new TodoLabelService(db.getDBManager());
      const itemSvc = new TodoItemService(db.getDBManager(), labelSvc);
      const item = itemSvc.create({ title: 'task', todo_list_id: l.id });

      svc.delete(l.id);

      expect(svc.getById(l.id)).toBeUndefined();
      // item 也被软删除
      expect(itemSvc.getById(item.id)).toBeUndefined();
    });

    it('应级联软删除 list/item 维度的 document', () => {
      const mgr = db.getDBManager();
      const l = svc.create({ name: 'list' });
      const labelSvc = new TodoLabelService(db.getDBManager());
      const itemSvc = new TodoItemService(db.getDBManager(), labelSvc);
      const item = itemSvc.create({ title: 'task', todo_list_id: l.id });
      // 构造 item 维度 + list 维度的 document
      mgr.insert(
        'INSERT INTO todo_document (name, content, todo_list_id, todo_item_id, created_at, updated_at, deleted_at) VALUES (?, ?, NULL, ?, ?, ?, NULL)',
        ['doc-item', '', item.id, 1, 1],
      );
      mgr.insert(
        'INSERT INTO todo_document (name, content, todo_list_id, todo_item_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, NULL, ?, ?, NULL)',
        ['doc-list', '', l.id, 1, 1],
      );

      svc.delete(l.id);

      // 两类 doc 都被软删除（deleted_at 非 null）。mock-db 不支持 OR，分别查询。
      const listDocs = mgr.query<{ deleted_at: number | null }>(
        'SELECT deleted_at FROM todo_document WHERE todo_list_id = ?',
        [l.id],
      );
      const itemDocs = mgr.query<{ deleted_at: number | null }>(
        'SELECT deleted_at FROM todo_document WHERE todo_item_id = ?',
        [item.id],
      );
      expect(listDocs.length).toBe(1);
      expect(itemDocs.length).toBe(1);
      expect(listDocs[0].deleted_at).not.toBeNull();
      expect(itemDocs[0].deleted_at).not.toBeNull();
    });

    it('不存在的 id 不抛错', () => {
      expect(() => svc.delete(999)).not.toThrow();
    });
  });

  describe('restore', () => {
    it('应恢复软删除列表', () => {
      const l = svc.create({ name: 'rev' });
      svc.delete(l.id);
      const restored = svc.restore(l.id);
      expect(restored).toBeDefined();
      expect(restored!.deleted_at).toBeNull();
    });
  });

  describe('listTrash', () => {
    it('应返回已软删除列表', () => {
      const l = svc.create({ name: 'trash', category_id: 1 });
      svc.delete(l.id);
      const trash = svc.listTrash();
      expect(trash).toHaveLength(1);
      expect(trash[0].id).toBe(l.id);
      expect(trash[0].deleted_at).not.toBeNull();
    });

    it('恢复后不应出现在 listTrash', () => {
      const l = svc.create({ name: 'rev2' });
      svc.delete(l.id);
      svc.restore(l.id);
      expect(svc.listTrash()).toHaveLength(0);
    });

    it('未删除的列表不出现', () => {
      svc.create({ name: 'alive' });
      expect(svc.listTrash()).toHaveLength(0);
    });
  });

  describe('purge', () => {
    it('应物理删除已软删除的 todo_list', () => {
      const mgr = db.getDBManager();
      const l = svc.create({ name: 'gone' });
      svc.delete(l.id);
      svc.purge(l.id);
      expect(mgr.get('SELECT id FROM todo_list WHERE id = ?', [l.id])).toBeUndefined();
    });

    it('应级联物理删除其下 todo_item + document（list/item 维度） + item_label', () => {
      const mgr = db.getDBManager();
      const l = svc.create({ name: 'list' });
      const labelSvc = new TodoLabelService(db.getDBManager());
      const itemSvc = new TodoItemService(db.getDBManager(), labelSvc);
      const item = itemSvc.create({ title: 'task', todo_list_id: l.id });
      // 为 item 关联 label 和 document（item 维度 + list 维度）
      const label = labelSvc.create({ name: 'L1' });
      itemSvc.update(item.id, { label_ids: [label.id] });
      mgr.insert(
        'INSERT INTO todo_document (name, content, todo_list_id, todo_item_id, created_at, updated_at, deleted_at) VALUES (?, ?, NULL, ?, ?, ?, NULL)',
        ['doc-item', '', item.id, 1, 1],
      );
      mgr.insert(
        'INSERT INTO todo_document (name, content, todo_list_id, todo_item_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, NULL, ?, ?, NULL)',
        ['doc-list', '', l.id, 1, 1],
      );

      svc.delete(l.id); // 级联软删除 item + document
      svc.purge(l.id);

      expect(mgr.get('SELECT id FROM todo_list WHERE id = ?', [l.id])).toBeUndefined();
      expect(mgr.get('SELECT id FROM todo_item WHERE id = ?', [item.id])).toBeUndefined();
      expect(mgr.get('SELECT id FROM todo_document WHERE todo_item_id = ?', [item.id])).toBeUndefined();
      expect(mgr.get('SELECT id FROM todo_document WHERE todo_list_id = ?', [l.id])).toBeUndefined();
      expect(
        mgr.get('SELECT todo_item_id FROM todo_item_label WHERE todo_item_id = ?', [item.id]),
      ).toBeUndefined();
    });

    it('未删除实体 purge 为 no-op（实体仍存在）', () => {
      const mgr = db.getDBManager();
      const l = svc.create({ name: 'alive' });
      expect(() => svc.purge(l.id)).not.toThrow();
      expect(mgr.get('SELECT id FROM todo_list WHERE id = ?', [l.id])).toBeDefined();
      expect(svc.getById(l.id)).toBeDefined();
    });

    it('不存在的 id purge 为 no-op', () => {
      expect(() => svc.purge(99999)).not.toThrow();
    });
  });
});
