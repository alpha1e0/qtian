import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * DBManager backup/restore 单测。
 *
 * 采用文件级 vi.mock('better-sqlite3', factory) 注入含 backup/close/pragma 的本地 mock，
 * 避开 vitest.setup.ts 全局 MockDatabase 的局限（无 backup()、无 serialize()）。
 *
 * 验证：
 * - backupTo 调 checkpoint + backup(destPath)
 * - restoreFrom 走 close → copyFileSync → reopen → WAL pragma → 删 -wal/-shm 序列
 */

// 记录 mock database 的方法调用序列，供断言
interface MockDb {
  prepare: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
  pragma: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  backup: ReturnType<typeof vi.fn>;
}

let currentMockDb: MockDb;
const mockDbCalls: string[] = [];

/**
 * 创建一个 mock Database 实例（函数体作为 better-sqlite3 构造函数）。
 *
 * 注意：vi.mock 工厂内不能用 TypeScript 的 this 类型注解（会破坏 esbuild 解析），
 * 因此用普通函数 + 内部赋值 this 字段的方式实现。
 */
function createMockDbInstance(filename: string): MockDb {
  void filename;
  const inst: MockDb = {
    prepare: vi.fn(() => ({ all: () => [], get: () => undefined, run: () => ({ changes: 0 }) })),
    exec: vi.fn(),
    pragma: vi.fn((setting: string) => {
      mockDbCalls.push(`pragma:${setting}`);
    }),
    close: vi.fn(() => {
      mockDbCalls.push('close');
    }),
    backup: vi.fn(async (dest: string) => {
      mockDbCalls.push(`backup:${dest}`);
      fs.writeFileSync(dest, 'mock-backup-content');
      return { totalPages: 1, totalPagesCopied: 1 };
    }),
  };
  mockDbCalls.push('ctor');
  currentMockDb = inst;
  return inst;
}

vi.mock('better-sqlite3', () => {
  return {
    default: createMockDbInstance,
    Database: createMockDbInstance,
  };
});

// 在 mock 生效后导入
import { DBManager } from './db-manager';

describe('DBManager backup/restore', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtian-dbmgr-'));
    dbPath = path.join(tmpDir, 'test.db');
    mockDbCalls.length = 0;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('checkpoint 调用 wal_checkpoint(TRUNCATE)', () => {
    const mgr = new DBManager(dbPath);
    mockDbCalls.length = 0;

    mgr.checkpoint();

    expect(mockDbCalls).toContain('pragma:wal_checkpoint(TRUNCATE)');
  });

  it('backupTo 先 checkpoint 再 backup(destPath)', async () => {
    const mgr = new DBManager(dbPath);
    mockDbCalls.length = 0;
    const destPath = path.join(tmpDir, 'backup.db');

    await mgr.backupTo(destPath);

    // checkpoint 在 backup 之前
    const checkpointIdx = mockDbCalls.indexOf('pragma:wal_checkpoint(TRUNCATE)');
    const backupIdx = mockDbCalls.indexOf(`backup:${destPath}`);
    expect(checkpointIdx).toBeGreaterThanOrEqual(0);
    expect(backupIdx).toBeGreaterThan(checkpointIdx);
  });

  it('restoreFrom 走 close → copy → reopen → WAL pragma → 删 sidecar', async () => {
    const mgr = new DBManager(dbPath);
    // 准备源备份文件
    const srcPath = path.join(tmpDir, 'source.db');
    fs.writeFileSync(srcPath, 'source-content');
    // 预置残留 -wal / -shm 文件（验证会被删除）
    fs.writeFileSync(dbPath + '-wal', 'old-wal');
    fs.writeFileSync(dbPath + '-shm', 'old-shm');
    mockDbCalls.length = 0;

    await mgr.restoreFrom(srcPath);

    // 1. 关闭旧连接
    expect(mockDbCalls).toContain('close');
    // 2. 文件已被覆盖（copyFileSync）
    expect(fs.readFileSync(dbPath, 'utf-8')).toBe('source-content');
    // 3. 重新构造（ctor 再次出现）
    const ctorCount = mockDbCalls.filter((c) => c === 'ctor').length;
    expect(ctorCount).toBe(1);
    // 4. 恢复 WAL pragma（journal_mode = WAL）
    expect(mockDbCalls).toContain('pragma:journal_mode = WAL');
    // 5. -wal / -shm 被删除
    expect(fs.existsSync(dbPath + '-wal')).toBe(false);
    expect(fs.existsSync(dbPath + '-shm')).toBe(false);
  });

  it('restoreFrom 后 DBManager 实例仍可用（this.db 已重赋值）', async () => {
    const mgr = new DBManager(dbPath);
    const srcPath = path.join(tmpDir, 'source.db');
    fs.writeFileSync(srcPath, 'source-content');

    await mgr.restoreFrom(srcPath);

    // restoreFrom 重新赋值了 this.db（内部 new Database），调用 query 不抛错
    expect(() => mgr.query('SELECT 1')).not.toThrow();
  });

  it('restoreFrom 源文件不存在时抛 BaseDBError', async () => {
    const mgr = new DBManager(dbPath);
    const missingSrc = path.join(tmpDir, 'no-such.db');

    await expect(mgr.restoreFrom(missingSrc)).rejects.toThrow();
  });

  it('backupTo 传给底层 backup 的是 destPath 原值', async () => {
    const mgr = new DBManager(dbPath);
    mockDbCalls.length = 0;
    const dest = path.join(tmpDir, 'out.db');

    await mgr.backupTo(dest);

    expect(currentMockDb.backup).toHaveBeenCalledWith(dest);
  });
});
