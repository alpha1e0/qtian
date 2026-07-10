/**
 * NoteLabelService 单元测试
 *
 * 重点：create / name 唯一性 / name 长度限制 / update / delete 清理 doc_label /
 *      setDocLabels 全量覆盖 + OR IGNORE 幂等 / getDocLabels / purge / restore
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
import { NoteLabelService } from './note-label.service';
import { MAX_LABEL_NAME_LENGTH } from './types';

describe('NoteLabelService', () => {
  let db: DBManager;
  let svc: NoteLabelService;

  beforeEach(() => {
    db = new DBManager(':memory:');
    svc = new NoteLabelService(db);
  });

  /** 插入 note_doc 主表行以支持 setDocLabels 关联 */
  function insertDoc(id: number): void {
    const now = Date.now();
    db.insert(
      `INSERT INTO note_doc (id, title, summary, content, category_id, task_prompt, is_favorite, created_at, updated_at, deleted_at)
       VALUES (?, 'doc', '', '', NULL, '', 0, ?, ?, NULL)`,
      [id, now, now],
    );
  }

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('正常创建标签', () => {
      const label = svc.create({ name: '重要' });
      expect(label.id).toBeDefined();
      expect(label.name).toBe('重要');
      expect(label.type).toBe('default');
    });

    it('name 为空时抛错', () => {
      expect(() => svc.create({ name: '' })).toThrow(/empty/);
      expect(() => svc.create({ name: '   ' })).toThrow(/empty/);
    });

    it('name 超 30 字符时抛错', () => {
      const longName = 'a'.repeat(MAX_LABEL_NAME_LENGTH + 1);
      expect(() => svc.create({ name: longName })).toThrow(/exceeds/);
    });

    it('name 正好 30 字符可通过', () => {
      const maxName = 'a'.repeat(MAX_LABEL_NAME_LENGTH);
      const label = svc.create({ name: maxName });
      expect(label.name).toBe(maxName);
    });

    it('name 重复时抛错', () => {
      svc.create({ name: '重复' });
      expect(() => svc.create({ name: '重复' })).toThrow(/already exists/);
    });

    it('自定义 type 生效', () => {
      const label = svc.create({ name: '标签', type: 'custom' });
      expect(label.type).toBe('custom');
    });
  });

  // =========================================================================
  // list / getById
  // =========================================================================

  describe('list / getById', () => {
    it('list 返回所有未删除标签', () => {
      svc.create({ name: '标签A' });
      svc.create({ name: '标签B' });
      const labels = svc.list();
      expect(labels.length).toBe(2);
    });

    it('getById 返回指定标签', () => {
      const created = svc.create({ name: '查找' });
      const found = svc.getById(created.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('查找');
    });

    it('getById 已删除标签返回 undefined', () => {
      const created = svc.create({ name: '删除' });
      svc.delete(created.id);
      expect(svc.getById(created.id)).toBeUndefined();
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('更新 name', () => {
      const label = svc.create({ name: '原名' });
      const updated = svc.update(label.id, { name: '新名' });
      expect(updated.name).toBe('新名');
    });

    it('更新 type', () => {
      const label = svc.create({ name: '标签' });
      const updated = svc.update(label.id, { type: 'important' });
      expect(updated.type).toBe('important');
    });

    it('更新为已存在的 name 时抛错', () => {
      svc.create({ name: '已有' });
      const label = svc.create({ name: '其他' });
      expect(() => svc.update(label.id, { name: '已有' })).toThrow(/already exists/);
    });

    it('name 超长时抛错', () => {
      const label = svc.create({ name: '标签' });
      const longName = 'a'.repeat(MAX_LABEL_NAME_LENGTH + 1);
      expect(() => svc.update(label.id, { name: longName })).toThrow(/exceeds/);
    });
  });

  // =========================================================================
  // delete / restore / purge
  // =========================================================================

  describe('delete', () => {
    it('软删除标签', () => {
      const label = svc.create({ name: '删除' });
      svc.delete(label.id);
      expect(svc.getById(label.id)).toBeUndefined();
      expect(svc.listTrash().length).toBe(1);
    });

    it('删除时清理 note_doc_label 关联', () => {
      insertDoc(1);
      const label = svc.create({ name: '标签' });
      svc.setDocLabels(1, [label.id]);
      expect(svc.getDocLabels(1)).toEqual([label.id]);
      svc.delete(label.id);
      expect(svc.getDocLabels(1)).toEqual([]);
    });
  });

  describe('restore', () => {
    it('恢复软删除标签', () => {
      const label = svc.create({ name: '恢复' });
      svc.delete(label.id);
      const restored = svc.restore(label.id);
      expect(restored).toBeDefined();
      expect(restored!.name).toBe('恢复');
    });
  });

  describe('purge', () => {
    it('物理删除已软删除标签', () => {
      const label = svc.create({ name: '彻底删除' });
      svc.delete(label.id);
      svc.purge(label.id);
      expect(svc.listTrash().length).toBe(0);
    });

    it('purge 未删除标签为 no-op', () => {
      const label = svc.create({ name: '活跃' });
      expect(() => svc.purge(label.id)).not.toThrow();
      expect(svc.getById(label.id)).toBeDefined();
    });

    it('purge 清理 note_doc_label 关联', () => {
      insertDoc(1);
      const label = svc.create({ name: '标签' });
      svc.setDocLabels(1, [label.id]);
      svc.delete(label.id);
      svc.purge(label.id);
      expect(svc.getDocLabels(1)).toEqual([]);
    });
  });

  // =========================================================================
  // setDocLabels / getDocLabels
  // =========================================================================

  describe('setDocLabels / getDocLabels', () => {
    it('全量覆盖标签关联', () => {
      insertDoc(1);
      const l1 = svc.create({ name: '标签1' });
      const l2 = svc.create({ name: '标签2' });
      const l3 = svc.create({ name: '标签3' });

      svc.setDocLabels(1, [l1.id, l2.id]);
      expect(svc.getDocLabels(1).sort()).toEqual([l1.id, l2.id]);

      // 全量覆盖为 [l3]
      svc.setDocLabels(1, [l3.id]);
      expect(svc.getDocLabels(1)).toEqual([l3.id]);
    });

    it('OR IGNORE 幂等：重复 label_id 不报错', () => {
      insertDoc(1);
      const label = svc.create({ name: '标签' });
      expect(() => svc.setDocLabels(1, [label.id, label.id])).not.toThrow();
      expect(svc.getDocLabels(1)).toEqual([label.id]);
    });

    it('空数组清空所有关联', () => {
      insertDoc(1);
      const l1 = svc.create({ name: '标签1' });
      svc.setDocLabels(1, [l1.id]);
      svc.setDocLabels(1, []);
      expect(svc.getDocLabels(1)).toEqual([]);
    });
  });
});
