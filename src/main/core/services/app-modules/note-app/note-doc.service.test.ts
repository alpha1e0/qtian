/**
 * NoteDocService 单元测试
 *
 * 重点：create 默认值 / label_ids / title 长度 / summary 长度 /
 *      update label_ids 全量覆盖 / toggleFavorite / list / listByLabel /
 *      listFavorites / delete 同步 FTS / purge 清理 doc_label / saveAttachment
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

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
import { NoteDocService } from './note-doc.service';
import { NoteLabelService } from './note-label.service';
import { MAX_DOC_TITLE_LENGTH, MAX_DOC_SUMMARY_LENGTH } from './types';

describe('NoteDocService', () => {
  let db: DBManager;
  let labelSvc: NoteLabelService;
  let svc: NoteDocService;
  let attachDir: string;

  beforeEach(() => {
    db = new DBManager(':memory:');
    labelSvc = new NoteLabelService(db);
    attachDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-attach-'));
    svc = new NoteDocService(db, labelSvc, null, attachDir);
  });

  afterEach(() => {
    fs.rmSync(attachDir, { recursive: true, force: true });
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('使用默认值创建文档', () => {
      const doc = svc.create({ title: '测试文档' });
      expect(doc.id).toBeDefined();
      expect(doc.title).toBe('测试文档');
      expect(doc.summary).toBe('');
      expect(doc.content).toBe('');
      expect(doc.category_id).toBeNull();
      expect(doc.task_prompt).toBe('');
      expect(doc.label_ids).toEqual([]);
      expect(doc.is_favorite).toBe(false);
    });

    it('带完整字段创建文档', () => {
      const doc = svc.create({
        title: '完整文档',
        summary: '摘要',
        content: '# 正文',
        category_id: 5,
        task_prompt: 'AI 任务',
      });
      expect(doc.summary).toBe('摘要');
      expect(doc.content).toBe('# 正文');
      expect(doc.category_id).toBe(5);
      expect(doc.task_prompt).toBe('AI 任务');
    });

    it('创建时关联 label_ids', () => {
      const l1 = labelSvc.create({ name: '标签1' });
      const l2 = labelSvc.create({ name: '标签2' });
      const doc = svc.create({ title: '文档', label_ids: [l1.id, l2.id] });
      expect(doc.label_ids.sort()).toEqual([l1.id, l2.id]);
    });

    it('title 为空时抛错', () => {
      expect(() => svc.create({ title: '' })).toThrow(/empty/);
      expect(() => svc.create({ title: '   ' })).toThrow(/empty/);
    });

    it('title 超过 150 字符时抛错', () => {
      const longTitle = 'a'.repeat(MAX_DOC_TITLE_LENGTH + 1);
      expect(() => svc.create({ title: longTitle })).toThrow(/exceeds/);
    });

    it('summary 超过 800 字符时抛错', () => {
      const longSummary = 'a'.repeat(MAX_DOC_SUMMARY_LENGTH + 1);
      expect(() => svc.create({ title: '测试', summary: longSummary })).toThrow(/exceeds/);
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('更新 title / content', () => {
      const doc = svc.create({ title: '原标题' });
      const updated = svc.update(doc.id, { title: '新标题', content: '新内容' });
      expect(updated.title).toBe('新标题');
      expect(updated.content).toBe('新内容');
    });

    it('update label_ids 全量覆盖', () => {
      const l1 = labelSvc.create({ name: '标签1' });
      const l2 = labelSvc.create({ name: '标签2' });
      const l3 = labelSvc.create({ name: '标签3' });

      const doc = svc.create({ title: '文档', label_ids: [l1.id, l2.id] });
      const updated = svc.update(doc.id, { label_ids: [l3.id] });
      expect(updated.label_ids).toEqual([l3.id]);
    });

    it('update title 超长时抛错', () => {
      const doc = svc.create({ title: '测试' });
      const longTitle = 'a'.repeat(MAX_DOC_TITLE_LENGTH + 1);
      expect(() => svc.update(doc.id, { title: longTitle })).toThrow(/exceeds/);
    });

    it('更新不存在的 doc 抛错', () => {
      expect(() => svc.update(9999, { title: 'x' })).toThrow(/not found/);
    });
  });

  // =========================================================================
  // toggleFavorite / listFavorites
  // =========================================================================

  describe('toggleFavorite / listFavorites', () => {
    it('切换收藏状态', () => {
      const doc = svc.create({ title: '文档' });
      expect(doc.is_favorite).toBe(false);

      const fav = svc.toggleFavorite(doc.id);
      expect(fav!.is_favorite).toBe(true);

      const unfav = svc.toggleFavorite(doc.id);
      expect(unfav!.is_favorite).toBe(false);
    });

    it('listFavorites 仅返回收藏文档', () => {
      const d1 = svc.create({ title: '普通' });
      svc.create({ title: '收藏' });
      svc.toggleFavorite(d1.id);

      const favs = svc.listFavorites();
      // listFavorites 返回已收藏的
      expect(favs.length).toBe(1);
      expect(favs[0].title).toBe('普通');
    });
  });

  // =========================================================================
  // list / listByLabel
  // =========================================================================

  describe('list', () => {
    it('list 返回所有未删除文档', () => {
      svc.create({ title: 'A' });
      svc.create({ title: 'B' });
      expect(svc.list().length).toBe(2);
    });

    it('list 按 categoryId 过滤', () => {
      svc.create({ title: 'A', category_id: 1 });
      svc.create({ title: 'B', category_id: 2 });
      const filtered = svc.list(1);
      expect(filtered.length).toBe(1);
      expect(filtered[0].title).toBe('A');
    });
  });

  describe('listByLabel', () => {
    it('返回指定 label 关联的文档', () => {
      const l1 = labelSvc.create({ name: '标签1' });
      svc.create({ title: '文档A', label_ids: [l1.id] });
      svc.create({ title: '文档B' });

      const docs = svc.listByLabel(l1.id);
      expect(docs.length).toBe(1);
      expect(docs[0].title).toBe('文档A');
    });
  });

  // =========================================================================
  // delete / restore / purge
  // =========================================================================

  describe('delete / restore', () => {
    it('软删除文档', () => {
      const doc = svc.create({ title: '测试' });
      svc.delete(doc.id);
      expect(svc.getById(doc.id)).toBeUndefined();
      expect(svc.listTrash().length).toBe(1);
    });

    it('恢复软删除文档', () => {
      const doc = svc.create({ title: '测试' });
      svc.delete(doc.id);
      const restored = svc.restore(doc.id);
      expect(restored).toBeDefined();
      expect(restored!.title).toBe('测试');
    });
  });

  describe('purge', () => {
    it('物理删除已软删除文档', () => {
      const doc = svc.create({ title: '测试' });
      svc.delete(doc.id);
      svc.purge(doc.id);
      expect(svc.listTrash().length).toBe(0);
    });

    it('purge 未删除文档为 no-op', () => {
      const doc = svc.create({ title: '活跃' });
      expect(() => svc.purge(doc.id)).not.toThrow();
      expect(svc.getById(doc.id)).toBeDefined();
    });

    it('purge 清理 note_doc_label 关联', () => {
      const l1 = labelSvc.create({ name: '标签1' });
      const doc = svc.create({ title: '测试', label_ids: [l1.id] });
      svc.delete(doc.id);
      svc.purge(doc.id);

      // doc_label 关联应被清理
      const dl = db.get('SELECT * FROM note_doc_label WHERE doc_id = ?', [doc.id]);
      expect(dl).toBeUndefined();
    });
  });

  // =========================================================================
  // saveAttachment
  // =========================================================================

  describe('saveAttachment', () => {
    it('返回 local-resource:// URL', () => {
      const buffer = Buffer.from('test-image-data');
      const url = svc.saveAttachment(buffer, '.png');
      expect(url).toMatch(/^local-resource:\/\//);
      expect(url).toMatch(/\.png$/);
    });

    it('相同内容去重（不重写）', () => {
      const buffer = Buffer.from('same-content');
      const url1 = svc.saveAttachment(buffer, '.txt');
      const url2 = svc.saveAttachment(buffer, '.txt');
      expect(url1).toBe(url2);
    });

    it('文件实际落盘', () => {
      const buffer = Buffer.from('file-content');
      const url = svc.saveAttachment(buffer, '.md');
      // 提取路径并验证文件存在
      const filePath = url.replace(/^local-resource:\/\//, '');
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });
});
