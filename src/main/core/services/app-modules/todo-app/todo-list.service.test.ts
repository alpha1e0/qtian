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
});
