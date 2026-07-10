/**
 * NoteDb 单元测试
 *
 * 重点：initialize 建表幂等、getDBManager 可用、close 安全
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';

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

import { NoteDb } from './note-db';

const SQL_PATH = path.join(process.cwd(), 'data', 'note-app.sql');

describe('NoteDb', () => {
  let db: NoteDb;

  beforeEach(() => {
    db = new NoteDb(':memory:', SQL_PATH);
  });

  describe('initialize', () => {
    it('应在给定有效 SQL 文件时正常初始化', () => {
      expect(() => db.initialize()).not.toThrow();
    });

    it('重复 initialize 幂等（不抛错）', () => {
      db.initialize();
      expect(() => db.initialize()).not.toThrow();
    });

    it('SQL 文件不存在时应抛出错误', () => {
      const bad = new NoteDb(':memory:', path.join(process.cwd(), 'data', 'not-exist.sql'));
      expect(() => bad.initialize()).toThrow(/Cannot read note-app SQL file/);
    });
  });

  describe('getDBManager', () => {
    beforeEach(() => {
      db.initialize();
    });

    it('应返回可用 DBManager', () => {
      const mgr = db.getDBManager();
      expect(mgr).toBeDefined();
      expect(typeof mgr.query).toBe('function');
      expect(typeof mgr.execute).toBe('function');
      expect(typeof mgr.insert).toBe('function');
      expect(typeof mgr.get).toBe('function');
    });

    it('通过 DBManager 可插入并查询 note_category', () => {
      const mgr = db.getDBManager();
      const result = mgr.insert(
        'INSERT INTO note_category (name, parent_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL)',
        ['test', null, 1, 1],
      );
      const row = mgr.get('SELECT id, name FROM note_category WHERE id = ?', [result.lastRowid]);
      expect(row).toBeDefined();
      expect(row.name).toBe('test');
    });

    it('通过 DBManager 可插入并查询 note_doc', () => {
      const mgr = db.getDBManager();
      const result = mgr.insert(
        'INSERT INTO note_doc (title, summary, content, category_id, task_prompt, is_favorite, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)',
        ['doc1', '', '', null, '', 0, 1, 1],
      );
      const row = mgr.get('SELECT title FROM note_doc WHERE id = ?', [result.lastRowid]);
      expect(row.title).toBe('doc1');
    });
  });

  describe('close', () => {
    it('不应抛错', () => {
      db.initialize();
      expect(() => db.close()).not.toThrow();
    });
  });
});
