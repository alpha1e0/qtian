/**
 * TodoDb 单元测试
 *
 * 重点：initialize 建表幂等、getDBManager 可用、close 安全
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

const SQL_PATH = path.join(process.cwd(), 'data', 'todo-app.sql');

describe('TodoDb', () => {
  let db: TodoDb;

  beforeEach(() => {
    db = new TodoDb(':memory:', SQL_PATH);
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
      const bad = new TodoDb(':memory:', path.join(process.cwd(), 'data', 'not-exist.sql'));
      expect(() => bad.initialize()).toThrow(/Cannot read todo-app SQL file/);
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

    it('通过 DBManager 可插入并查询 todo_category', () => {
      const mgr = db.getDBManager();
      const result = mgr.insert(
        'INSERT INTO todo_category (name, parent_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL)',
        ['test', null, 1, 1],
      );
      const row = mgr.get('SELECT id, name FROM todo_category WHERE id = ?', [result.lastRowid]);
      expect(row).toBeDefined();
      expect(row.name).toBe('test');
    });

    it('通过 DBManager 可插入并查询 todo_item（含 CHECK 约束字段）', () => {
      const mgr = db.getDBManager();
      mgr.insert(
        'INSERT INTO todo_item (title, description, task_prompt, parent_id, status, progress, priority, due_at, todo_list_id, agent_task_id, is_manual_progress, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)',
        ['t', '', '', null, 'init', 0, 'normal', null, 1, 0, 1, 1],
      );
      const row = mgr.get('SELECT title, status FROM todo_item WHERE id = ?', [1]);
      expect(row.title).toBe('t');
      expect(row.status).toBe('init');
    });
  });

  describe('close', () => {
    it('不应抛错', () => {
      db.initialize();
      expect(() => db.close()).not.toThrow();
    });
  });
});
