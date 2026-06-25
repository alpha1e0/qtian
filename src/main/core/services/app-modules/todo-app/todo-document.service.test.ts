/**
 * TodoDocumentService 单元测试
 *
 * 重点：saveAttachment hash 去重、分桶目录、list_id 和 item_id 互斥
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

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
import { TodoDocumentService } from './todo-document.service';

const SQL_PATH = path.join(process.cwd(), 'data', 'todo-app.sql');

/** 每个测试使用独立的临时附件目录 */
function makeAttachDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'todo-attach-'));
}

describe('TodoDocumentService', () => {
  let db: TodoDb;
  let svc: TodoDocumentService;
  let attachDir: string;

  beforeEach(() => {
    db = new TodoDb(':memory:', SQL_PATH);
    db.initialize();
    attachDir = makeAttachDir();
    svc = new TodoDocumentService(db.getDBManager(), attachDir);
  });

  describe('create', () => {
    it('应创建文档（关联 item）', () => {
      const doc = svc.create({ name: '笔记', content: '# Hello', todo_item_id: 1 });
      expect(doc.id).toBeGreaterThan(0);
      expect(doc.name).toBe('笔记');
      expect(doc.content).toBe('# Hello');
      expect(doc.todo_item_id).toBe(1);
      expect(doc.todo_list_id).toBeNull();
    });

    it('应创建文档（关联 list）', () => {
      const doc = svc.create({ name: 'list-doc', todo_list_id: 5 });
      expect(doc.todo_list_id).toBe(5);
      expect(doc.todo_item_id).toBeNull();
    });

    it('name 为空时抛错', () => {
      expect(() => svc.create({ name: '' })).toThrow(/empty/);
    });

    it('list_id 和 item_id 同时非 null 时抛错', () => {
      expect(() => svc.create({ name: 'x', todo_list_id: 1, todo_item_id: 2 })).toThrow(
        /不可同时/,
      );
    });

    it('两者都为 null 时允许（游离文档）', () => {
      const doc = svc.create({ name: 'free' });
      expect(doc.todo_list_id).toBeNull();
      expect(doc.todo_item_id).toBeNull();
    });
  });

  describe('getById', () => {
    it('应返回指定文档', () => {
      const created = svc.create({ name: 'd', todo_item_id: 1 });
      expect(svc.getById(created.id)?.name).toBe('d');
    });

    it('不存在的 id 返回 undefined', () => {
      expect(svc.getById(999)).toBeUndefined();
    });
  });

  describe('update', () => {
    it('应更新 name/content', () => {
      const doc = svc.create({ name: 'old', content: 'a' });
      const updated = svc.update(doc.id, { name: 'new', content: 'b' });
      expect(updated.name).toBe('new');
      expect(updated.content).toBe('b');
    });

    it('不存在的 id 抛错', () => {
      expect(() => svc.update(999, { name: 'x' })).toThrow(/not found/);
    });
  });

  describe('listByList / listByItem', () => {
    it('listByList 返回该项目文档', () => {
      svc.create({ name: 'c1', todo_list_id: 1 });
      svc.create({ name: 'c2', todo_list_id: 1 });
      svc.create({ name: 'i1', todo_item_id: 9 });
      expect(svc.listByList(1)).toHaveLength(2);
    });

    it('listByItem 返回该 item 文档', () => {
      svc.create({ name: 'd1', todo_item_id: 7 });
      svc.create({ name: 'd2', todo_item_id: 7 });
      expect(svc.listByItem(7)).toHaveLength(2);
    });
  });

  describe('delete / restore', () => {
    it('应软删除文档', () => {
      const doc = svc.create({ name: 'tmp' });
      svc.delete(doc.id);
      expect(svc.getById(doc.id)).toBeUndefined();
    });

    it('应恢复文档', () => {
      const doc = svc.create({ name: 'rev' });
      svc.delete(doc.id);
      const restored = svc.restore(doc.id);
      expect(restored).toBeDefined();
      expect(restored!.deleted_at).toBeNull();
    });
  });

  describe('listTrash', () => {
    it('应返回已软删除文档', () => {
      const doc = svc.create({ name: 'gone', content: 'x' });
      svc.delete(doc.id);
      const trash = svc.listTrash();
      expect(trash).toHaveLength(1);
      expect(trash[0].id).toBe(doc.id);
      expect(trash[0].deleted_at).not.toBeNull();
    });

    it('恢复后不应出现在 listTrash', () => {
      const doc = svc.create({ name: 'rev2' });
      svc.delete(doc.id);
      svc.restore(doc.id);
      expect(svc.listTrash()).toHaveLength(0);
    });

    it('未删除的文档不出现', () => {
      svc.create({ name: 'alive' });
      expect(svc.listTrash()).toHaveLength(0);
    });
  });

  describe('purge', () => {
    it('应物理删除已软删除的文档', () => {
      const mgr = db.getDBManager();
      const doc = svc.create({ name: 'gone', content: 'data' });
      svc.delete(doc.id);
      svc.purge(doc.id);
      expect(mgr.get('SELECT id FROM todo_document WHERE id = ?', [doc.id])).toBeUndefined();
    });

    it('未删除实体 purge 为 no-op（实体仍存在）', () => {
      const mgr = db.getDBManager();
      const doc = svc.create({ name: 'alive' });
      expect(() => svc.purge(doc.id)).not.toThrow();
      expect(mgr.get('SELECT id FROM todo_document WHERE id = ?', [doc.id])).toBeDefined();
      expect(svc.getById(doc.id)).toBeDefined();
    });

    it('不存在的 id purge 为 no-op', () => {
      expect(() => svc.purge(99999)).not.toThrow();
    });
  });

  describe('saveAttachment', () => {
    it('应保存附件并返回 local-resource URL', () => {
      const buf = Buffer.from('fake-image-data');
      const url = svc.saveAttachment(buf, '.png');
      expect(url).toContain('local-resource://');
      expect(url).toContain('.png');
    });

    it('文件名使用 sha256 前 16 位', () => {
      const buf = Buffer.from('test');
      const url = svc.saveAttachment(buf, '.txt');
      // sha256('test') = 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
      // 前 16 位: 9f86d081884c7d65
      expect(url).toContain('9f86d081884c7d65');
    });

    it('前 2 位 hash 作为分桶子目录', () => {
      const buf = Buffer.from('bucket-test');
      const url = svc.saveAttachment(buf, '.png');
      // 应包含 /9f/ 或类似分桶路径
      expect(url).toMatch(/\/[0-9a-f]{2}\//);
    });

    it('相同内容去重（不重写）', () => {
      const buf = Buffer.from('duplicate-content');
      const url1 = svc.saveAttachment(buf, '.png');
      const url2 = svc.saveAttachment(buf, '.png');
      expect(url1).toBe(url2);
    });

    it('不同内容生成不同文件名', () => {
      const url1 = svc.saveAttachment(Buffer.from('aaa'), '.png');
      const url2 = svc.saveAttachment(Buffer.from('bbb'), '.png');
      expect(url1).not.toBe(url2);
    });

    it('扩展名无点时自动补', () => {
      const url = svc.saveAttachment(Buffer.from('x'), 'jpg');
      expect(url).toContain('.jpg');
    });

    it('实际写入文件到分桶目录', () => {
      const buf = Buffer.from('written-file');
      const url = svc.saveAttachment(buf, '.png');
      // 从 URL 提取路径并验证文件存在
      const filePath = url.replace(/^local-resource:\/\//, '').replace(/\//g, path.sep);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath)).toEqual(buf);
    });
  });
});
