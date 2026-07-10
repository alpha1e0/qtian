/**
 * NoteCategoryService 单元测试
 *
 * 重点：create 根/子 / name 空 / 深度校验 / update 成环 / 递归软删除 /
 *      restore 提升至根 / getTree doc_count 聚合 / purge 级联清理
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
import { NoteCategoryService } from './note-category.service';
import { MAX_CATEGORY_DEPTH } from './types';

describe('NoteCategoryService', () => {
  let db: DBManager;
  let svc: NoteCategoryService;

  beforeEach(() => {
    db = new DBManager(':memory:');
    svc = new NoteCategoryService(db);
  });

  /** 插入 note_doc 主表行 */
  function insertDoc(title: string, categoryId: number | null = null): number {
    const now = Date.now();
    const r = db.insert(
      `INSERT INTO note_doc (title, summary, content, category_id, task_prompt, is_favorite, created_at, updated_at, deleted_at)
       VALUES (?, '', '', ?, '', 0, ?, ?, NULL)`,
      [title, categoryId, now, now],
    );
    return r.lastRowid;
  }

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('创建根分类', () => {
      const cat = svc.create({ name: '根', parent_id: null });
      expect(cat.id).toBeDefined();
      expect(cat.name).toBe('根');
      expect(cat.parent_id).toBeNull();
    });

    it('创建子分类', () => {
      const root = svc.create({ name: '根', parent_id: null });
      const child = svc.create({ name: '子', parent_id: root.id });
      expect(child.parent_id).toBe(root.id);
    });

    it('name 为空时抛错', () => {
      expect(() => svc.create({ name: '', parent_id: null })).toThrow(/empty/);
      expect(() => svc.create({ name: '   ', parent_id: null })).toThrow(/empty/);
    });
  });

  // =========================================================================
  // validateDepth
  // =========================================================================

  describe('validateDepth', () => {
    it('深度 4 层通过', () => {
      const l1 = svc.create({ name: 'L1', parent_id: null });
      const l2 = svc.create({ name: 'L2', parent_id: l1.id });
      const l3 = svc.create({ name: 'L3', parent_id: l2.id });
      // L4 是第 4 层（在 l3 下），应通过
      expect(() => svc.create({ name: 'L4', parent_id: l3.id })).not.toThrow();
    });

    it('深度 5 层抛错', () => {
      const l1 = svc.create({ name: 'L1', parent_id: null });
      const l2 = svc.create({ name: 'L2', parent_id: l1.id });
      const l3 = svc.create({ name: 'L3', parent_id: l2.id });
      const l4 = svc.create({ name: 'L4', parent_id: l3.id });
      // L5 超出最大深度
      expect(() => svc.create({ name: 'L5', parent_id: l4.id })).toThrow(/最大递归层级/);
    });

    it('根 parent_id=null 恒通过', () => {
      expect(() => svc.validateDepth(null, MAX_CATEGORY_DEPTH)).not.toThrow();
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('更新 name', () => {
      const cat = svc.create({ name: '原名', parent_id: null });
      const updated = svc.update(cat.id, { name: '新名' });
      expect(updated.name).toBe('新名');
    });

    it('移动到新 parent', () => {
      const root = svc.create({ name: '根', parent_id: null });
      const other = svc.create({ name: '其他', parent_id: null });
      const moved = svc.update(other.id, { parent_id: root.id });
      expect(moved.parent_id).toBe(root.id);
    });

    it('设为自身子节点时抛错（成环）', () => {
      const cat = svc.create({ name: '节点', parent_id: null });
      expect(() => svc.update(cat.id, { parent_id: cat.id })).toThrow(/self/);
    });

    it('移动到自己的子孙下时抛错（成环）', () => {
      const root = svc.create({ name: '根', parent_id: null });
      const child = svc.create({ name: '子', parent_id: root.id });
      // 把 root 移到 child 下 → 成环
      expect(() => svc.update(root.id, { parent_id: child.id })).toThrow(/cycle|descendant/);
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('递归软删除子 category', () => {
      const root = svc.create({ name: '根', parent_id: null });
      const child = svc.create({ name: '子', parent_id: root.id });
      const grand = svc.create({ name: '孙', parent_id: child.id });

      svc.delete(root.id);

      expect(svc.getById(root.id)).toBeUndefined();
      expect(svc.getById(child.id)).toBeUndefined();
      expect(svc.getById(grand.id)).toBeUndefined();
    });

    it('递归软删除关联 doc', () => {
      const root = svc.create({ name: '根', parent_id: null });
      const child = svc.create({ name: '子', parent_id: root.id });
      const docId = insertDoc('文档', child.id);

      svc.delete(root.id);

      const doc = db.get('SELECT deleted_at FROM note_doc WHERE id = ?', [docId]);
      expect(doc.deleted_at).not.toBeNull();
    });

    it('删除不存在的 category 为 no-op', () => {
      expect(() => svc.delete(9999)).not.toThrow();
    });
  });

  // =========================================================================
  // restore
  // =========================================================================

  describe('restore', () => {
    it('恢复时 parent 已删则提升至根', () => {
      const root = svc.create({ name: '根', parent_id: null });
      const child = svc.create({ name: '子', parent_id: root.id });

      svc.delete(root.id);
      // 此时 child 也被级联软删除，restore child 时 parent 在回收站 → 提升至根
      const restored = svc.restore(child.id);
      expect(restored).toBeDefined();
      expect(restored!.parent_id).toBeNull();
      expect(restored!.name).toBe('子');
    });

    it('恢复时 parent 未删则保持原 parent', () => {
      const root = svc.create({ name: '根', parent_id: null });
      const child = svc.create({ name: '子', parent_id: root.id });

      svc.delete(child.id);
      const restored = svc.restore(child.id);
      expect(restored).toBeDefined();
      expect(restored!.parent_id).toBe(root.id);
    });
  });

  // =========================================================================
  // getTree
  // =========================================================================

  describe('getTree', () => {
    it('返回空数组（无分类）', () => {
      expect(svc.getTree()).toEqual([]);
    });

    it('构建正确的树结构', () => {
      const root = svc.create({ name: '根', parent_id: null });
      svc.create({ name: '子A', parent_id: root.id });
      svc.create({ name: '子B', parent_id: root.id });

      const tree = svc.getTree();
      expect(tree.length).toBe(1);
      expect(tree[0].name).toBe('根');
      expect(tree[0].children.length).toBe(2);
    });

    it('doc_count 聚合正确（含子分类）', () => {
      const root = svc.create({ name: '根', parent_id: null });
      const child = svc.create({ name: '子', parent_id: root.id });

      insertDoc('文档1', root.id);
      insertDoc('文档2', child.id);
      insertDoc('文档3', child.id);

      const tree = svc.getTree();
      expect(tree[0].doc_count).toBe(3); // root 含 child 的 doc
      expect(tree[0].children[0].doc_count).toBe(2);
    });
  });

  // =========================================================================
  // purge
  // =========================================================================

  describe('purge', () => {
    it('物理删除已软删除的子树', () => {
      const root = svc.create({ name: '根', parent_id: null });
      const child = svc.create({ name: '子', parent_id: root.id });

      svc.delete(root.id);
      svc.purge(root.id);

      expect(svc.listTrash().length).toBe(0);
      // 物理删除后行不存在
      const row = db.get('SELECT id FROM note_category WHERE id = ?', [child.id]);
      expect(row).toBeUndefined();
    });

    it('purge 清理 note_doc_label 关联', () => {
      const root = svc.create({ name: '根', parent_id: null });
      const docId = insertDoc('文档', root.id);

      // 插入 doc_label 关联
      const labelId = db.insert(
        'INSERT INTO note_label (name, type, created_at, deleted_at) VALUES (?, ?, ?, NULL)',
        ['标签', 'default', Date.now()],
      ).lastRowid;
      db.insert(
        'INSERT OR IGNORE INTO note_doc_label (doc_id, label_id) VALUES (?, ?)',
        [docId, labelId],
      );

      svc.delete(root.id);
      svc.purge(root.id);

      // note_doc_label 应被清理
      const dl = db.get('SELECT * FROM note_doc_label WHERE doc_id = ?', [docId]);
      expect(dl).toBeUndefined();
    });

    it('purge 未删除 category 为 no-op', () => {
      const root = svc.create({ name: '活跃', parent_id: null });
      expect(() => svc.purge(root.id)).not.toThrow();
      expect(svc.getById(root.id)).toBeDefined();
    });
  });
});
