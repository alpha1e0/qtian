/**
 * TodoLabelService 单元测试
 *
 * 测试策略：文件级 vi.mock('better-sqlite3') 提供 todo schema 通用内存执行器。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';

// 文件级 mock：todo-app 通用内存 SQL 执行器
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
import { TodoLabelService } from './todo-label.service';

const SQL_PATH = path.join(process.cwd(), 'data', 'todo-app.sql');

describe('TodoLabelService', () => {
  let db: TodoDb;
  let svc: TodoLabelService;

  beforeEach(() => {
    db = new TodoDb(':memory:', SQL_PATH);
    db.initialize();
    svc = new TodoLabelService(db.getDBManager());
  });

  describe('create', () => {
    it('应创建标签并返回完整对象', () => {
      const label = svc.create({ name: '前端' });
      expect(label.id).toBeGreaterThan(0);
      expect(label.name).toBe('前端');
      expect(label.type).toBe('default');
      expect(label.deleted_at).toBeNull();
      expect(label.created_at).toBeGreaterThan(0);
    });

    it('name 为空时应抛错', () => {
      expect(() => svc.create({ name: '   ' })).toThrow(/empty/);
    });

    it('自定义 type', () => {
      const label = svc.create({ name: '后端', type: 'custom' });
      expect(label.type).toBe('custom');
    });
  });

  describe('list', () => {
    it('应返回所有未删除标签（按 created_at 升序）', () => {
      svc.create({ name: 'a' });
      svc.create({ name: 'b' });
      const list = svc.list();
      expect(list).toHaveLength(2);
      expect(list[0].name).toBe('a');
      expect(list[1].name).toBe('b');
    });

    it('不返回已软删除标签', () => {
      const l1 = svc.create({ name: 'keep' });
      svc.create({ name: 'del' });
      svc.delete(l1.id);
      const list = svc.list();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('del');
    });
  });

  describe('getById', () => {
    it('应返回指定标签', () => {
      const created = svc.create({ name: 'x' });
      const got = svc.getById(created.id);
      expect(got).toBeDefined();
      expect(got!.name).toBe('x');
    });

    it('不存在的 id 返回 undefined', () => {
      expect(svc.getById(99999)).toBeUndefined();
    });
  });

  describe('update', () => {
    it('应更新 name', () => {
      const label = svc.create({ name: 'old' });
      const updated = svc.update(label.id, { name: 'new' });
      expect(updated.name).toBe('new');
    });

    it('name 为空时抛错', () => {
      const label = svc.create({ name: 'x' });
      expect(() => svc.update(label.id, { name: '' })).toThrow(/empty/);
    });

    it('不存在的 id 抛错', () => {
      expect(() => svc.update(999, { name: 'y' })).toThrow(/not found/);
    });
  });

  describe('delete', () => {
    it('应软删除标签（deleted_at 非空）', () => {
      const label = svc.create({ name: 'tmp' });
      svc.delete(label.id);
      expect(svc.getById(label.id)).toBeUndefined();
    });

    it('软删除后同名标签可重建（部分唯一索引仅约束未删除行）', () => {
      const l1 = svc.create({ name: 'dup' });
      svc.delete(l1.id);
      // 同名重建不应抛错
      const l2 = svc.create({ name: 'dup' });
      expect(l2.id).not.toBe(l1.id);
    });

    it('删除标签时清理 todo_item_label 关联', () => {
      const label = svc.create({ name: 'linked' });
      // 直接通过 DBManager 模拟关联行
      const mgr = db.getDBManager();
      mgr.insert(
        'INSERT INTO todo_item_label (todo_item_id, label_id) VALUES (?, ?)',
        [1, label.id],
      );
      expect(mgr.get('SELECT label_id FROM todo_item_label WHERE todo_item_id = ?', [1])).toBeDefined();
      svc.delete(label.id);
      expect(mgr.get('SELECT label_id FROM todo_item_label WHERE todo_item_id = ?', [1])).toBeUndefined();
    });
  });

  describe('restore', () => {
    it('应恢复软删除标签', () => {
      const label = svc.create({ name: 'rev' });
      svc.delete(label.id);
      const restored = svc.restore(label.id);
      expect(restored).toBeDefined();
      expect(restored!.deleted_at).toBeNull();
    });
  });

  describe('setItemLabels / getItemLabels', () => {
    it('应全量覆盖 item 的标签关联', () => {
      const l1 = svc.create({ name: 'a' });
      const l2 = svc.create({ name: 'b' });
      const l3 = svc.create({ name: 'c' });

      svc.setItemLabels(10, [l1.id, l2.id]);
      expect(svc.getItemLabels(10).sort()).toEqual([l1.id, l2.id].sort());

      // 覆盖为 l3
      svc.setItemLabels(10, [l3.id]);
      expect(svc.getItemLabels(10)).toEqual([l3.id]);
    });

    it('传空数组清除所有关联', () => {
      const l1 = svc.create({ name: 'a' });
      svc.setItemLabels(20, [l1.id]);
      svc.setItemLabels(20, []);
      expect(svc.getItemLabels(20)).toEqual([]);
    });
  });
});
