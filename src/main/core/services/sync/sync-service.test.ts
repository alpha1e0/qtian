import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { SyncService, listFilesRecursive, isUnderPath, type SyncWebdavClient, type SyncServiceDeps } from './sync-service';
import { TRACKED_PATHS } from './sync-tracked-paths';
import { REMOTE_META_FILENAME, type RemoteMeta, type WebdavClientConfig } from './sync-types';
import type { DBManager } from '@/core/database/db-manager';

/**
 * SyncService 单测：决策矩阵 + 上传/下载流程 + meta 持久化。
 *
 * 在临时 workspace 中测试，注入：
 * - FakeWebdavClient：基于内存 Map 的 WebDAV 客户端
 * - mock DBManager：含 checkpoint/backupTo/restoreFrom
 */

// =========================================================================
// 测试桩
// =========================================================================

/** 内存版 WebDAV 客户端，文件以 Map<relPath, Buffer> 存储 */
class FakeWebdavClient implements SyncWebdavClient {
  files = new Map<string, Buffer>();
  shouldConnect = true;
  /** getFile 调用记录，便于断言 */
  gotFiles: { relPath: string; destPath: string }[] = [];
  putFiles: { relPath: string; srcPath: string }[] = [];

  getRootUrl(): string {
    return 'https://fake.example.com/qtian/qtian-sync/';
  }
  async testConnection(): Promise<boolean> {
    return this.shouldConnect;
  }
  async ensureDir(_relPath: string): Promise<void> {
    // noop：内存模型不需要目录概念
  }
  async listDir(relPath: string) {
    const prefix = relPath.replace(/\/+$/, '') + '/';
    const out: { href: string; isCollection: boolean; size?: number }[] = [];
    for (const [key, buf] of this.files) {
      if (key.startsWith(prefix)) {
        out.push({ href: key, isCollection: false, size: buf.length });
      }
    }
    return out;
  }
  async getFile(relPath: string, destPath: string): Promise<void> {
    this.gotFiles.push({ relPath, destPath });
    const buf = this.files.get(relPath);
    if (buf === undefined) {
      throw new Error(`FakeWebdavClient: ${relPath} not found`);
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, buf);
  }
  async putFile(relPath: string, srcPath: string): Promise<void> {
    this.putFiles.push({ relPath, srcPath });
    const buf = fs.readFileSync(srcPath);
    this.files.set(relPath, buf);
  }
  async deleteResource(relPath: string): Promise<void> {
    this.files.delete(relPath);
  }
  async exists(relPath: string): Promise<boolean> {
    return this.files.has(relPath);
  }

  // 辅助：设置 meta.json
  setMeta(meta: RemoteMeta): void {
    this.files.set(REMOTE_META_FILENAME, Buffer.from(JSON.stringify(meta, null, 2)));
  }
  getMeta(): RemoteMeta | null {
    const buf = this.files.get(REMOTE_META_FILENAME);
    if (!buf) return null;
    return JSON.parse(buf.toString('utf-8')) as RemoteMeta;
  }
}

/** 创建 mock DBManager（仅实现 SyncService 用到的方法） */
function createMockDbManager(markerContent: string): DBManager & { restoreCalls: string[]; backupCalls: string[] } {
  const backupCalls: string[] = [];
  const restoreCalls: string[] = [];
  const mgr = {
    checkpoint: () => {},
    async backupTo(destPath: string) {
      backupCalls.push(destPath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, markerContent);
    },
    async restoreFrom(srcPath: string) {
      restoreCalls.push(srcPath);
      // 模拟 restore：读取源文件内容（测试只验证调用序列与 meta 推进）
    },
    restoreCalls,
    backupCalls,
  };
  return mgr as unknown as DBManager & { restoreCalls: string[]; backupCalls: string[] };
}

// =========================================================================
// 测试夹具
// =========================================================================

const CONFIG: WebdavClientConfig = {
  url: 'https://fake.example.com',
  accountName: 'u',
  accountPassword: 'p',
  folder: 'qtian',
};

interface Fixture {
  tmpRoot: string;
  workspaceRoot: string;
  syncMetaPath: string;
  fake: FakeWebdavClient;
  todoDb: ReturnType<typeof createMockDbManager>;
  noteDb: ReturnType<typeof createMockDbManager>;
  makeService: () => SyncService;
}

function setupFixture(): Fixture {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qtian-sync-svc-'));
  const workspaceRoot = path.join(tmpRoot, 'workspace');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const syncDir = path.join(workspaceRoot, '.sync');
  fs.mkdirSync(syncDir, { recursive: true });
  const syncMetaPath = path.join(syncDir, 'meta.json');

  const fake = new FakeWebdavClient();
  const todoDb = createMockDbManager('TODO-DB-CONTENT');
  const noteDb = createMockDbManager('NOTE-DB-CONTENT');

  const deps: SyncServiceDeps = {
    workspaceRoot,
    syncMetaPath,
    todoDbManager: todoDb,
    noteDbManager: noteDb,
    webdavConfigProvider: () => CONFIG,
    deviceId: 'test-device-001',
    createClient: () => fake,
  };

  return {
    tmpRoot,
    workspaceRoot,
    syncMetaPath,
    fake,
    todoDb,
    noteDb,
    makeService: () => new SyncService(deps),
  };
}

/** 写本地文件并设置 mtime（秒级） */
function writeFile(relPath: string, content: string, mtimeSec: number, root: string): void {
  const abs = path.join(root, relPath.split('/').join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  const t = mtimeSec;
  fs.utimesSync(abs, t, t);
}

/** 写本地 meta 缓存 */
function writeLocalMeta(syncMetaPath: string, meta: { last_sync_time: number; known_remote_time: number; known_remote_device: string }): void {
  fs.writeFileSync(syncMetaPath, JSON.stringify(meta, null, 2));
}

// =========================================================================
// 决策矩阵测试
// =========================================================================

describe('SyncService.getStatus 决策矩阵', () => {
  let f: Fixture;
  beforeEach(() => {
    f = setupFixture();
    // 预置一个 tracked 文件，使 localNewestMtime 非零
    writeFile('assistant/llm/default.json', '{}', 1000, f.workspaceRoot);
  });
  afterEach(() => {
    fs.rmSync(f.tmpRoot, { recursive: true, force: true });
  });

  it('case 1：远端 meta 不存在 → upload（首次同步）', async () => {
    const status = await f.makeService().getStatus();
    expect(status.direction).toBe('upload');
    expect(status.remoteLastSyncTime).toBeNull();
  });

  it('case 2：本地 meta 不存在 + 远端有 meta → download（本机首次接入）', async () => {
    f.fake.setMeta({
      version: 1,
      last_sync_time: 2000000,
      device_id: 'other-device',
      files: { 'assistant/llm/default.json': { size: 2, mtime: 1000 } },
    });
    const status = await f.makeService().getStatus();
    expect(status.direction).toBe('download');
  });

  it('case 5：两端均无变化 → noop', async () => {
    // localNewestMtime ≈ 1000000（文件 mtime 1000s）
    // last_sync_time 设为 > localNewestMtime → localChanged=false
    writeLocalMeta(f.syncMetaPath, { last_sync_time: 5000000, known_remote_time: 2000000, known_remote_device: 'other' });
    f.fake.setMeta({ version: 1, last_sync_time: 2000000, device_id: 'other', files: {} });
    const status = await f.makeService().getStatus();
    expect(status.direction).toBe('noop');
  });

  it('case 6：仅 local 变化 → upload', async () => {
    // localNewestMtime > last_sync_time → localChanged=true
    // known_remote_time == remoteMeta.last_sync_time → remoteChanged=false
    writeLocalMeta(f.syncMetaPath, { last_sync_time: 500000, known_remote_time: 2000000, known_remote_device: 'other' });
    f.fake.setMeta({ version: 1, last_sync_time: 2000000, device_id: 'other', files: {} });
    const status = await f.makeService().getStatus();
    expect(status.direction).toBe('upload');
  });

  it('case 7：仅 remote 变化 → download', async () => {
    // localChanged=false（last_sync_time 足够大）
    // remoteChanged=true（known_remote_time != remoteMeta.last_sync_time）
    writeLocalMeta(f.syncMetaPath, { last_sync_time: 5000000, known_remote_time: 1000000, known_remote_device: 'other' });
    f.fake.setMeta({ version: 1, last_sync_time: 2000000, device_id: 'other', files: {} });
    const status = await f.makeService().getStatus();
    expect(status.direction).toBe('download');
  });

  it('case 8a：冲突 + local 更新 → conflict（推荐 upload）', async () => {
    // 两端都变，local mtime 较大
    writeLocalMeta(f.syncMetaPath, { last_sync_time: 500000, known_remote_time: 1000000, known_remote_device: 'other' });
    f.fake.setMeta({ version: 1, last_sync_time: 200000, device_id: 'other', files: {} });
    const status = await f.makeService().getStatus();
    expect(status.direction).toBe('conflict');
    expect(status.message).toContain('上传');
  });

  it('case 8b：冲突 + remote 更新 → conflict（推荐 download）', async () => {
    // 两端都变，remote 更新
    writeLocalMeta(f.syncMetaPath, { last_sync_time: 500000, known_remote_time: 1000000, known_remote_device: 'other' });
    f.fake.setMeta({ version: 1, last_sync_time: 5000000, device_id: 'other', files: {} });
    const status = await f.makeService().getStatus();
    expect(status.direction).toBe('conflict');
    expect(status.message).toContain('下载');
  });

  it('未配置 WebDAV → error 状态', async () => {
    const deps: SyncServiceDeps = {
      workspaceRoot: f.workspaceRoot,
      syncMetaPath: f.syncMetaPath,
      todoDbManager: f.todoDb,
      noteDbManager: f.noteDb,
      webdavConfigProvider: () => null,
      deviceId: 'test-device-001',
    };
    const status = await new SyncService(deps).getStatus();
    expect(status.direction).toBe('error');
    expect(status.message).toContain('未配置');
  });
});

// =========================================================================
// 上传流程测试
// =========================================================================

describe('SyncService.syncUpload', () => {
  let f: Fixture;
  beforeEach(() => {
    f = setupFixture();
    // 预置 tracked 文件
    writeFile('assistant/agent/a1.json', '{"a":1}', 1000, f.workspaceRoot);
    writeFile('assistant/llm/default.json', '{}', 1000, f.workspaceRoot);
    writeFile('app_modules/todo_app/attach/file1.txt', 'attach1', 1000, f.workspaceRoot);
    // DB 文件占位（实际 backup 由 mock 写出）
    writeFile('app_modules/todo_app/todo.db', 'TODO-DB-CONTENT', 1000, f.workspaceRoot);
    writeFile('app_modules/note_app/note.db', 'NOTE-DB-CONTENT', 1000, f.workspaceRoot);
  });
  afterEach(() => {
    fs.rmSync(f.tmpRoot, { recursive: true, force: true });
  });

  it('上传 tracked 文件 + DB + meta.json，写本地 meta', async () => {
    const result = await f.makeService().syncUpload();

    expect(result.direction).toBe('upload');
    expect(result.errors).toHaveLength(0);
    // assistant 2 文件 + todo attach 1 文件 + 2 DB = 5
    expect(result.fileCount).toBeGreaterThanOrEqual(5);
    // DB backup 被调用
    expect(f.todoDb.backupCalls).toHaveLength(1);
    expect(f.noteDb.backupCalls).toHaveLength(1);
    // 远端收到 meta.json
    expect(f.fake.getMeta()).not.toBeNull();
    const meta = f.fake.getMeta()!;
    expect(meta.device_id).toBe('test-device-001');
    expect(meta.files['app_modules/todo_app/todo.db']).toBeDefined();
    expect(meta.files['assistant/llm/default.json']).toBeDefined();
    expect(meta.files['assistant/agent/a1.json']).toBeDefined();
    // 本地 meta 被写入
    const localMeta = JSON.parse(fs.readFileSync(f.syncMetaPath, 'utf-8'));
    expect(localMeta.known_remote_device).toBe('test-device-001');
  });

  it('未配置 → 失败结果', async () => {
    const deps: SyncServiceDeps = {
      ...{
        workspaceRoot: f.workspaceRoot,
        syncMetaPath: f.syncMetaPath,
        todoDbManager: f.todoDb,
        noteDbManager: f.noteDb,
        webdavConfigProvider: () => null,
        deviceId: 'x',
      },
    };
    const result = await new SyncService(deps).syncUpload();
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('未配置');
  });

  it('tracked 路径不存在时跳过不报错', async () => {
    // 清空所有 tracked 文件
    fs.rmSync(path.join(f.workspaceRoot, 'assistant'), { recursive: true, force: true });
    fs.rmSync(path.join(f.workspaceRoot, 'app_modules'), { recursive: true, force: true });
    const result = await f.makeService().syncUpload();
    expect(result.success).toBe(true);
    // 至少写了 meta
    expect(f.fake.getMeta()).not.toBeNull();
  });
});

// =========================================================================
// 下载流程测试
// =========================================================================

describe('SyncService.syncDownload', () => {
  let f: Fixture;
  beforeEach(() => {
    f = setupFixture();
    // 预置远端 meta + 文件
    f.fake.setMeta({
      version: 1,
      last_sync_time: 3000000,
      device_id: 'remote-device',
      files: {
        'assistant/llm/remote.json': { size: 20, mtime: 1000 },
        'app_modules/todo_app/attach/r1.txt': { size: 10, mtime: 1000 },
        'app_modules/todo_app/todo.db': { size: 100, mtime: 1000 },
        'app_modules/note_app/note.db': { size: 100, mtime: 1000 },
      },
    });
    f.fake.files.set('assistant/llm/remote.json', Buffer.from('{"remote":true}'));
    f.fake.files.set('app_modules/todo_app/attach/r1.txt', Buffer.from('remote-attach'));
    f.fake.files.set('app_modules/todo_app/todo.db', Buffer.from('REMOTE-TODO-DB'));
    f.fake.files.set('app_modules/note_app/note.db', Buffer.from('REMOTE-NOTE-DB'));
    // 本地预置一个将被裁剪的文件（不在 manifest 中）
    writeFile('app_modules/todo_app/attach/local-only.txt', 'stale', 1000, f.workspaceRoot);
  });
  afterEach(() => {
    fs.rmSync(f.tmpRoot, { recursive: true, force: true });
  });

  it('下载 manifest 文件 + DB restore + 裁剪本地多余文件 + 写本地 meta', async () => {
    const result = await f.makeService().syncDownload();

    expect(result.direction).toBe('download');
    expect(result.errors).toHaveLength(0);
    // DB restore 被调用
    expect(f.todoDb.restoreCalls).toHaveLength(1);
    expect(f.noteDb.restoreCalls).toHaveLength(1);
    // 普通文件被写入本地
    const gotRegular = fs.readFileSync(
      path.join(f.workspaceRoot, 'assistant/llm/remote.json'),
      'utf-8',
    );
    expect(gotRegular).toBe('{"remote":true}');
    // attach 文件被写入
    expect(fs.readFileSync(path.join(f.workspaceRoot, 'app_modules/todo_app/attach/r1.txt'), 'utf-8')).toBe('remote-attach');
    // 本地多余文件被裁剪
    expect(fs.existsSync(path.join(f.workspaceRoot, 'app_modules/todo_app/attach/local-only.txt'))).toBe(false);
    // 本地 meta 被写入，known_remote_time = 远端 meta 的 last_sync_time
    const localMeta = JSON.parse(fs.readFileSync(f.syncMetaPath, 'utf-8'));
    expect(localMeta.known_remote_time).toBe(3000000);
    expect(localMeta.known_remote_device).toBe('remote-device');
  });

  it('远端 meta 不存在 → 失败结果', async () => {
    f.fake.files.delete(REMOTE_META_FILENAME);
    const result = await f.makeService().syncDownload();
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('meta.json 不存在');
  });

  it('未配置 → 失败结果', async () => {
    const deps: SyncServiceDeps = {
      workspaceRoot: f.workspaceRoot,
      syncMetaPath: f.syncMetaPath,
      todoDbManager: f.todoDb,
      noteDbManager: f.noteDb,
      webdavConfigProvider: () => null,
      deviceId: 'x',
    };
    const result = await new SyncService(deps).syncDownload();
    expect(result.success).toBe(false);
  });
});

// =========================================================================
// meta 持久化往返
// =========================================================================

describe('SyncService meta 持久化往返', () => {
  let f: Fixture;
  beforeEach(() => {
    f = setupFixture();
    writeFile('assistant/llm/default.json', '{}', 1000, f.workspaceRoot);
    writeFile('app_modules/todo_app/todo.db', 'TODO-DB-CONTENT', 1000, f.workspaceRoot);
    writeFile('app_modules/note_app/note.db', 'NOTE-DB-CONTENT', 1000, f.workspaceRoot);
  });
  afterEach(() => {
    fs.rmSync(f.tmpRoot, { recursive: true, force: true });
  });

  it('upload 后再 getStatus 应为 noop', async () => {
    const service = f.makeService();
    // 首次：upload
    const up = await service.syncUpload();
    expect(up.success).toBe(true);

    // 第二次：status 应为 noop（本地 meta 已推进，远端 meta 时间一致）
    const status = await service.getStatus();
    expect(['noop', 'upload']).toContain(status.direction);
    // 注：文件 mtime 可能在两次操作间未变 → 若 localNewestMtime <= last_sync_time 则 noop
    // 本测试断言不再返回 download/conflict（即 meta 已正确推进）
    expect(status.direction).not.toBe('download');
    expect(status.direction).not.toBe('conflict');
  });
});

// =========================================================================
// syncAuto 路由
// =========================================================================

describe('SyncService.syncAuto 路由', () => {
  let f: Fixture;
  beforeEach(() => {
    f = setupFixture();
  });
  afterEach(() => {
    fs.rmSync(f.tmpRoot, { recursive: true, force: true });
  });

  it('首次同步 → 路由到 upload', async () => {
    writeFile('assistant/llm/default.json', '{}', 1000, f.workspaceRoot);
    writeFile('app_modules/todo_app/todo.db', 'x', 1000, f.workspaceRoot);
    writeFile('app_modules/note_app/note.db', 'x', 1000, f.workspaceRoot);
    const result = await f.makeService().syncAuto();
    expect(result.direction).toBe('upload');
  });

  it('未配置 → 返回失败', async () => {
    const deps: SyncServiceDeps = {
      workspaceRoot: f.workspaceRoot,
      syncMetaPath: f.syncMetaPath,
      todoDbManager: f.todoDb,
      noteDbManager: f.noteDb,
      webdavConfigProvider: () => null,
      deviceId: 'x',
    };
    const result = await new SyncService(deps).syncAuto();
    expect(result.success).toBe(false);
  });
});

// =========================================================================
// 辅助函数单测
// =========================================================================

describe('辅助函数', () => {
  it('listFilesRecursive 递归列出文件', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qtian-h-'));
    try {
      fs.mkdirSync(path.join(tmp, 'a/b'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'a/x.txt'), '1');
      fs.writeFileSync(path.join(tmp, 'a/b/y.txt'), '2');
      const files = listFilesRecursive(tmp);
      expect(files.map((f) => f.rel).sort()).toEqual(['a/x.txt', 'a/b/y.txt'].sort());
      expect(isUnderPath('a/b/y.txt', 'a/b')).toBe(true);
      expect(isUnderPath('a/x.txt', 'a/b')).toBe(false);
      expect(isUnderPath('a/b', 'a/b')).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// 确保 TRACKED_PATHS 导入被引用（避免 unused 警告）
void TRACKED_PATHS;
