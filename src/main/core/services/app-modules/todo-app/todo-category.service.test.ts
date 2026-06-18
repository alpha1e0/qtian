/**
 * TodoCategoryService 单元测试
 *
 * 重点：递归深度校验、软删除级联、恢复时 parent 已删则提升至根、getTree 正确性
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
import { TodoCategoryService } from './todo-category.service';
import { MAX_CATEGORY_DEPTH } from './types';

const SQL_PATH = path.join(process.cwd(), 'data', 'todo-app.sql');

describe('TodoCategoryService', () => {
  let db: TodoDb;
  let svc: TodoCategoryService;

  beforeEach(() => {
    db = new TodoDb(':memory:', SQL_PATH);
    db.initialize();
    svc = new TodoCategoryService(db.getDBManager());
  });

  describe('create', () => {
    it('应创建根分类', () => {
      const c = svc.create({ name: '工作', parent_id: null });
      expect(c.id).toBeGreaterThan(0);
      expect(c.name).toBe('工作');
      expect(c.parent_id).toBeNull();
    });

    it('应创建子分类', () => {
      const root = svc.create({ name: 'root', parent_id: null });
      const child = svc.create({ name: 'child', parent_id: root.id });
      expect(child.parent_id).toBe(root.id);
    });

    it('name 为空时抛错', () => {
      expect(() => svc.create({ name: '', parent_id: null })).toThrow(/empty/);
    });
  });

  describe('validateDepth / 递归深度', () => {
    it('应允许到第 4 层（MAX_CATEGORY_DEPTH）', () => {
      const l1 = svc.create({ name: 'L1', parent_id: null });
      const l2 = svc.create({ name: 'L2', parent_id: l1.id });
      const l3 = svc.create({ name: 'L3', parent_id: l2.id });
      // 第 4 层（l3 的子，即第 4 层节点）
      expect(() => svc.create({ name: 'L4', parent_id: l3.id })).not.toThrow();
    });

    it('第 5 层创建应抛错（超出 MAX_CATEGORY_DEPTH=4）', () => {
      const l1 = svc.create({ name: 'L1', parent_id: null });
      const l2 = svc.create({ name: 'L2', parent_id: l1.id });
      const l3 = svc.create({ name: 'L3', parent_id: l2.id });
      const l4 = svc.create({ name: 'L4', parent_id: l3.id });
      // 第 5 层：l4 的子 → 抛错
      expect(() => svc.create({ name: 'L5', parent_id: l4.id })).toThrow(/最大递归层级/);
    });

    it('validateDepth(null, 4) 永远通过', () => {
      expect(() => svc.validateDepth(null, 4)).not.toThrow();
    });
  });

  describe('update', () => {
    it('应更新 name', () => {
      const c = svc.create({ name: 'old', parent_id: null });
      const updated = svc.update(c.id, { name: 'new' });
      expect(updated.name).toBe('new');
    });

    it('不能把 parent 设为自己', () => {
      const c = svc.create({ name: 'self', parent_id: null });
      expect(() => svc.update(c.id, { parent_id: c.id })).toThrow(/self/);
    });

    it('不能移动到自己的子孙下（环检测）', () => {
      const root = svc.create({ name: 'root', parent_id: null });
      const child = svc.create({ name: 'child', parent_id: root.id });
      // 把 root 移到 child 下 → 环
      expect(() => svc.update(root.id, { parent_id: child.id })).toThrow(/cycle/);
    });

    it('移动到新 parent 不超深度', () => {
      const root = svc.create({ name: 'root', parent_id: null });
      const a = svc.create({ name: 'a', parent_id: root.id });
      const b = svc.create({ name: 'b', parent_id: null });
      // b 移到 a 下（第 3 层），合法
      expect(() => svc.update(b.id, { parent_id: a.id })).not.toThrow();
    });

    it('不存在的 id 抛错', () => {
      expect(() => svc.update(999, { name: 'x' })).toThrow(/not found/);
    });
  });

  describe('delete 软删除级联', () => {
    it('应递归软删除子 category', () => {
      const root = svc.create({ name: 'root', parent_id: null });
      const child = svc.create({ name: 'child', parent_id: root.id });
      const grand = svc.create({ name: 'grand', parent_id: child.id });

      svc.delete(root.id);

      expect(svc.getById(root.id)).toBeUndefined();
      expect(svc.getById(child.id)).toBeUndefined();
      expect(svc.getById(grand.id)).toBeUndefined();
    });

    it('应级联软删除关联 todo_list', () => {
      const root = svc.create({ name: 'root', parent_id: null });
      // 直接插入 todo_list
      const mgr = db.getDBManager();
      mgr.insert(
        'INSERT INTO todo_list (name, description, category_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, NULL)',
        ['list1', '', root.id, 1, 1],
      );
      svc.delete(root.id);
      const row = mgr.get('SELECT deleted_at FROM todo_list WHERE category_id = ?', [root.id]);
      expect(row.deleted_at).not.toBeNull();
    });

    it('不存在的 id 不抛错', () => {
      expect(() => svc.delete(999)).not.toThrow();
    });
  });

  describe('restore', () => {
    it('应恢复分类（parent 未删除）', () => {
      const root = svc.create({ name: 'root', parent_id: null });
      const child = svc.create({ name: 'child', parent_id: root.id });
      svc.delete(child.id);
      const restored = svc.restore(child.id);
      expect(restored).toBeDefined();
      expect(restored!.deleted_at).toBeNull();
      expect(restored!.parent_id).toBe(root.id);
    });

    it('parent 已删除时恢复应提升至根（parent_id=NULL）', () => {
      const root = svc.create({ name: 'root', parent_id: null });
      const child = svc.create({ name: 'child', parent_id: root.id });
      // 同时软删除 root 和 child
      svc.delete(root.id); // 级联删除 child
      const restored = svc.restore(child.id);
      expect(restored).toBeDefined();
      expect(restored!.parent_id).toBeNull();
    });
  });

  describe('getTree', () => {
    it('空数据返回空数组', () => {
      expect(svc.getTree()).toEqual([]);
    });

    it('应构建多层树结构', () => {
      const root = svc.create({ name: 'root', parent_id: null });
      const c1 = svc.create({ name: 'c1', parent_id: root.id });
      const c2 = svc.create({ name: 'c2', parent_id: root.id });
      const gc = svc.create({ name: 'gc', parent_id: c1.id });

      const tree = svc.getTree();
      expect(tree).toHaveLength(1);
      expect(tree[0].name).toBe('root');
      expect(tree[0].children).toHaveLength(2);
      const c1Node = tree[0].children.find((n) => n.name === 'c1');
      expect(c1Node!.children).toHaveLength(1);
      expect(c1Node!.children[0].name).toBe('gc');
    });

    it('list_count 应聚合子树', () => {
      const root = svc.create({ name: 'root', parent_id: null });
      const child = svc.create({ name: 'child', parent_id: root.id });
      const mgr = db.getDBManager();
      // root 下 2 个 list，child 下 1 个 list
      mgr.insert(
        'INSERT INTO todo_list (name, description, category_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, NULL)',
        ['r1', '', root.id, 1, 1],
      );
      mgr.insert(
        'INSERT INTO todo_list (name, description, category_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, NULL)',
        ['r2', '', root.id, 2, 2],
      );
      mgr.insert(
        'INSERT INTO todo_list (name, description, category_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, NULL)',
        ['c1', '', child.id, 3, 3],
      );

      const tree = svc.getTree();
      expect(tree[0].list_count).toBe(3); // 含子分类
      const childNode = tree[0].children[0];
      expect(childNode.list_count).toBe(1);
    });
  });

  describe('getChildren', () => {
    it('应返回直接子分类', () => {
      const root = svc.create({ name: 'root', parent_id: null });
      svc.create({ name: 'a', parent_id: root.id });
      svc.create({ name: 'b', parent_id: root.id });

      const children = svc.getChildren(root.id);
      expect(children).toHaveLength(2);
    });

    it('parentId=null 返回根分类', () => {
      svc.create({ name: 'r1', parent_id: null });
      svc.create({ name: 'r2', parent_id: null });
      expect(svc.getChildren(null)).toHaveLength(2);
    });
  });

  describe('listTrash', () => {
    it('应返回已软删除分类', () => {
      const c = svc.create({ name: 'trash', parent_id: null });
      svc.delete(c.id);
      const trash = svc.listTrash();
      expect(trash).toHaveLength(1);
      expect(trash[0].id).toBe(c.id);
    });

    it('恢复后不应出现在 listTrash', () => {
      const c = svc.create({ name: 't2', parent_id: null });
      svc.delete(c.id);
      svc.restore(c.id);
      expect(svc.listTrash()).toHaveLength(0);
    });

    it('按 deleted_at DESC 排序（最近删除在前）', async () => {
      const a = svc.create({ name: 'a', parent_id: null });
      const b = svc.create({ name: 'b', parent_id: null });
      svc.delete(a.id);
      // 让 b 的删除时间晚于 a
      await new Promise((r) => setTimeout(r, 5));
      svc.delete(b.id);
      const trash = svc.listTrash();
      expect(trash).toHaveLength(2);
      expect(trash[0].id).toBe(b.id);
      expect(trash[1].id).toBe(a.id);
    });
  });

  describe('purge', () => {
    it('应物理删除已软删除的分类（数据库行消失）', () => {
      const mgr = db.getDBManager();
      const c = svc.create({ name: 'gone', parent_id: null });
      svc.delete(c.id);
      svc.purge(c.id);
      // 直接查表（不带 deleted_at 过滤）确认物理删除
      const row = mgr.get('SELECT id FROM todo_category WHERE id = ?', [c.id]);
      expect(row).toBeUndefined();
    });

    it('应级联物理删除子 category', () => {
      const mgr = db.getDBManager();
      const root = svc.create({ name: 'root', parent_id: null });
      const child = svc.create({ name: 'child', parent_id: root.id });
      svc.delete(root.id); // 级联软删除 child
      svc.purge(root.id);
      expect(mgr.get('SELECT id FROM todo_category WHERE id = ?', [root.id])).toBeUndefined();
      expect(mgr.get('SELECT id FROM todo_category WHERE id = ?', [child.id])).toBeUndefined();
    });

    it('应级联物理删除关联 todo_list / todo_item / document / item_label', () => {
      const mgr = db.getDBManager();
      const root = svc.create({ name: 'root', parent_id: null });
      // 在 root 下构造 list + item + document + item_label
      const listId = mgr.insert(
        'INSERT INTO todo_list (name, description, category_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, NULL)',
        ['list1', '', root.id, 1, 1],
      ).lastRowid;
      const itemId = mgr.insert(
        'INSERT INTO todo_item (title, description, task_prompt, parent_id, status, progress, priority, due_at, todo_list_id, agent_task_id, is_manual_progress, created_at, updated_at, deleted_at) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?, NULL, 0, ?, ?, NULL)',
        ['task', '', '', 'init', 0, 'normal', listId, 1, 1],
      ).lastRowid;
      const labelId = mgr.insert(
        'INSERT INTO todo_label (name, type, created_at, deleted_at) VALUES (?, ?, ?, NULL)',
        ['lbl', 'default', 1],
      ).lastRowid;
      mgr.insert(
        'INSERT INTO todo_item_label (todo_item_id, label_id) VALUES (?, ?)',
        [itemId, labelId],
      );
      mgr.insert(
        'INSERT INTO todo_document (name, content, todo_category_id, todo_item_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, NULL, ?, ?, NULL)',
        ['doc-cat', '', root.id, 1, 1],
      );
      mgr.insert(
        'INSERT INTO todo_document (name, content, todo_category_id, todo_item_id, created_at, updated_at, deleted_at) VALUES (?, ?, NULL, ?, ?, ?, NULL)',
        ['doc-item', '', itemId, 1, 1],
      );

      svc.delete(root.id); // 级联软删除
      svc.purge(root.id);

      expect(mgr.get('SELECT id FROM todo_list WHERE id = ?', [listId])).toBeUndefined();
      expect(mgr.get('SELECT id FROM todo_item WHERE id = ?', [itemId])).toBeUndefined();
      expect(mgr.get('SELECT id FROM todo_document WHERE todo_category_id = ?', [root.id])).toBeUndefined();
      expect(mgr.get('SELECT id FROM todo_document WHERE todo_item_id = ?', [itemId])).toBeUndefined();
      expect(
        mgr.get('SELECT todo_item_id FROM todo_item_label WHERE todo_item_id = ?', [itemId]),
      ).toBeUndefined();
      // label 自身不被 purge（仅清理关联）
      expect(mgr.get('SELECT id FROM todo_label WHERE id = ?', [labelId])).toBeDefined();
    });

    it('未删除实体 purge 为 no-op（不抛错，实体仍存在）', () => {
      const mgr = db.getDBManager();
      const c = svc.create({ name: 'alive', parent_id: null });
      expect(() => svc.purge(c.id)).not.toThrow();
      // 实体仍存在
      expect(mgr.get('SELECT id FROM todo_category WHERE id = ?', [c.id])).toBeDefined();
      expect(svc.getById(c.id)).toBeDefined();
    });

    it('不存在的 id purge 为 no-op', () => {
      expect(() => svc.purge(99999)).not.toThrow();
    });
  });
});
