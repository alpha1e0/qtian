import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { createLogger } from '@/core/utils/logger';
import type { DBManager } from '@/core/database/db-manager';
import { WebdavClient } from './webdav-client';
import { TRACKED_PATHS } from './sync-tracked-paths';
import {
  META_VERSION,
  REMOTE_META_FILENAME,
  type LocalMeta,
  type RemoteMeta,
  type RemoteFileEntry,
  type SyncDirection,
  type SyncResult,
  type SyncStatus,
  type WebdavClientConfig,
  type WebdavResource,
} from './sync-types';

const logger = createLogger('SyncService');

/**
 * WebDAV 客户端操作接口（WebdavClient 实现该接口，测试可注入桩）。
 */
export interface SyncWebdavClient {
  getRootUrl(): string;
  testConnection(): Promise<boolean>;
  ensureDir(relPath: string): Promise<void>;
  listDir(relPath: string): Promise<WebdavResource[]>;
  getFile(relPath: string, destPath: string): Promise<void>;
  putFile(relPath: string, srcPath: string): Promise<void>;
  deleteResource(relPath: string): Promise<void>;
  exists(relPath: string): Promise<boolean>;
}

/**
 * SyncService 依赖（依赖注入便于测试）。
 */
export interface SyncServiceDeps {
  /** workspace 根目录绝对路径 */
  workspaceRoot: string;
  /** 本地 meta 缓存路径（workspace/.sync/meta.json） */
  syncMetaPath: string;
  /** todo-app DBManager（执行 checkpoint/backupTo/restoreFrom） */
  todoDbManager: DBManager;
  /** note-app DBManager */
  noteDbManager: DBManager;
  /** WebDAV 配置 provider（每次调用读取最新配置） */
  webdavConfigProvider: () => WebdavClientConfig | null;
  /** 本机设备标识 */
  deviceId: string;
  /** WebDAV 客户端工厂（测试注入桩；生产用默认 WebdavClient） */
  createClient?: (cfg: WebdavClientConfig) => SyncWebdavClient;
}

/** tracked db 路径 → 对应 DBManager 的映射键 */
const TODO_DB_REL = 'app_modules/todo_app/todo.db';
const NOTE_DB_REL = 'app_modules/note_app/note.db';

/**
 * 数据同步编排核心。
 *
 * 职责：
 * 1. getStatus：判定同步方向（整体方向 + 最新优先冲突策略）
 * 2. syncUpload：DB online backup + 目录递归上传 + 写远端/本地 meta
 * 3. syncDownload：读远端 manifest + DB restore + 目录覆盖 + 裁剪 + 写本地 meta
 * 4. syncAuto：getStatus → 路由
 *
 * 冲突策略（详见设计文档 §4）：
 * - 远端 meta 不存在 → upload（首次同步）
 * - 本地 meta 不存在 → download（本机首次接入）
 * - 都未变 → noop
 * - 仅 local 变 → upload；仅 remote 变 → download
 * - 都变（冲突）→ 最新优先
 */
export class SyncService {
  private readonly deps: SyncServiceDeps;

  constructor(deps: SyncServiceDeps) {
    this.deps = deps;
  }

  /** 获取当前 WebDAV 配置（可能为 null = 未配置） */
  getWebdavConfig(): WebdavClientConfig | null {
    return this.deps.webdavConfigProvider();
  }

  /** 创建 WebDAV 客户端（使用注入的工厂或默认 WebdavClient） */
  private createClientFromConfig(): { client: SyncWebdavClient; cfg: WebdavClientConfig } {
    const cfg = this.deps.webdavConfigProvider();
    if (!cfg) {
      throw new Error('WebDAV 未配置');
    }
    const factory = this.deps.createClient ?? ((c) => new WebdavClient(c));
    return { client: factory(cfg), cfg };
  }

  /** 根据 tracked db 相对路径取对应 DBManager */
  private getDbManagerFor(relPath: string): DBManager | null {
    if (relPath === TODO_DB_REL) return this.deps.todoDbManager;
    if (relPath === NOTE_DB_REL) return this.deps.noteDbManager;
    return null;
  }

  /**
   * 测试 WebDAV 连接。
   */
  async testConnection(): Promise<boolean> {
    try {
      const { client } = this.createClientFromConfig();
      return await client.testConnection();
    } catch (err) {
      logger.error('testConnection failed', err);
      return false;
    }
  }

  /**
   * 获取同步状态（决策矩阵）。
   */
  async getStatus(): Promise<SyncStatus> {
    const localMeta = this.readLocalMeta();
    const localNewestMtime = this.computeLocalNewestMtime();

    // 远端 meta
    let remoteMeta: RemoteMeta | null = null;
    let remoteLastSyncTime: number | null = null;
    try {
      const { client } = this.createClientFromConfig();
      remoteMeta = await this.fetchRemoteMeta(client);
      remoteLastSyncTime = remoteMeta ? remoteMeta.last_sync_time : null;
    } catch (err) {
      // 未配置或连接失败 → 返回 error 状态
      logger.error('getStatus: failed to fetch remote meta', err);
      return {
        direction: 'error',
        localNewestMtime,
        lastSyncTime: localMeta?.last_sync_time ?? null,
        remoteLastSyncTime: null,
        message: err instanceof Error ? err.message : String(err),
      };
    }

    // 决策矩阵
    const direction = this.decideDirection(localMeta, localNewestMtime, remoteMeta);
    const status: SyncStatus = {
      direction: direction.direction,
      localNewestMtime,
      lastSyncTime: localMeta?.last_sync_time ?? null,
      remoteLastSyncTime,
      message: direction.message,
    };
    return status;
  }

  /**
   * 同步上传：本地 → 远端。
   *
   * 流程：
   * 1. checkpoint 两个 DB，确保 .db 文件一致
   * 2. 递归收集 tracked 路径下的所有文件（DB 文件单独处理）
   * 3. ensureDir 远端目录树
   * 4. DB 文件：backupTo 到临时文件后 putFile
   * 5. 普通文件：putFile
   * 6. 写远端 meta.json + 本地 meta.json
   */
  async syncUpload(): Promise<SyncResult> {
    const startedAt = Date.now();
    const errors: string[] = [];
    const warnings: string[] = [];
    let fileCount = 0;
    const manifest: Record<string, RemoteFileEntry> = {};

    let client: SyncWebdavClient;
    try {
      const r = this.createClientFromConfig();
      client = r.client;
    } catch (err) {
      return this.failResult('upload', err, startedAt);
    }

    // 确保 remote 根目录存在
    try {
      await client.ensureDir('');
    } catch (err) {
      errors.push(`ensureDir root: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 1. checkpoint DB
    try {
      this.deps.todoDbManager.checkpoint();
    } catch (err) {
      errors.push(`todo checkpoint: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      this.deps.noteDbManager.checkpoint();
    } catch (err) {
      errors.push(`note checkpoint: ${err instanceof Error ? err.message : String(err)}`);
    }

    for (const tracked of TRACKED_PATHS) {
      const localAbs = path.join(this.deps.workspaceRoot, tracked.relPath);
      if (!fs.existsSync(localAbs)) {
        // tracked 路径不存在（如尚未使用过 todo/note），跳过
        continue;
      }
      if (tracked.kind === 'db') {
        // 2. DB 文件：backupTo 临时文件后 putFile
        try {
          await this.uploadDbFile(client, tracked.relPath, localAbs, manifest);
          fileCount++;
        } catch (err) {
          errors.push(`upload db ${tracked.relPath}: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        // 3. 目录：递归上传
        const uploaded = await this.uploadDir(client, tracked.relPath, localAbs, manifest, errors);
        fileCount += uploaded;
      }
    }

    // 清理远端 meta 不在本次 manifest 的文件（简化：不做远端裁剪，避免误删；
    //   后续可按 manifest diff 增量删除，当前阶段以全量覆盖为主）

    // 写远端 meta.json
    const remoteMeta: RemoteMeta = {
      version: META_VERSION,
      last_sync_time: startedAt,
      device_id: this.deps.deviceId,
      files: manifest,
    };
    try {
      await this.writeRemoteMeta(client, remoteMeta);
    } catch (err) {
      errors.push(`write remote meta: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 写本地 meta（即使有部分错误，仍推进本地 meta 以反映本次同步时间）
    this.writeLocalMeta({
      last_sync_time: startedAt,
      known_remote_time: startedAt,
      known_remote_device: this.deps.deviceId,
    });

    const success = errors.length === 0;
    logger.info(`syncUpload done: files=${fileCount}, errors=${errors.length}`);
    return {
      success,
      direction: 'upload',
      fileCount,
      syncedAt: startedAt,
      errors,
      warnings,
    };
  }

  /**
   * 同步下载：远端 → 本地。
   *
   * 流程：
   * 1. 读远端 meta.json（作为 manifest）
   * 2. DB 文件：getFile 到临时文件 → restoreFrom
   * 3. 普通文件：getFile 覆盖本地
   * 4. 裁剪本地 tracked 目录中不在 manifest 的文件
   * 5. 写本地 meta
   */
  async syncDownload(): Promise<SyncResult> {
    const startedAt = Date.now();
    const errors: string[] = [];
    const warnings: string[] = [];
    let fileCount = 0;

    let client: SyncWebdavClient;
    try {
      const r = this.createClientFromConfig();
      client = r.client;
    } catch (err) {
      return this.failResult('download', err, startedAt);
    }

    let remoteMeta: RemoteMeta | null;
    try {
      remoteMeta = await this.fetchRemoteMeta(client);
    } catch (err) {
      return this.failResult('download', err, startedAt);
    }
    if (!remoteMeta) {
      return {
        success: false,
        direction: 'download',
        fileCount: 0,
        syncedAt: startedAt,
        errors: ['远端 meta.json 不存在，无法下载'],
        warnings,
      };
    }

    const manifest = remoteMeta.files || {};
    const downloadedRelPaths = new Set<string>();

    // 先处理 DB 文件
    for (const tracked of TRACKED_PATHS) {
      if (tracked.kind !== 'db') continue;
      if (!(tracked.relPath in manifest)) {
        warnings.push(`远端 manifest 缺少 DB 文件 ${tracked.relPath}`);
        continue;
      }
      try {
        await this.downloadDbFile(client, tracked.relPath);
        downloadedRelPaths.add(tracked.relPath);
        fileCount++;
      } catch (err) {
        errors.push(`download db ${tracked.relPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 处理普通文件（目录 kind 下的所有文件）
    for (const [relPath] of Object.entries(manifest)) {
      const tracked = TRACKED_PATHS.find((t) => t.kind === 'dir' && isUnderPath(relPath, t.relPath));
      if (!tracked) continue; // DB 文件已在上面处理或非 tracked
      try {
        await this.downloadRegularFile(client, relPath);
        downloadedRelPaths.add(relPath);
        fileCount++;
      } catch (err) {
        errors.push(`download ${relPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 裁剪本地 tracked 目录中不在 manifest 的文件
    for (const tracked of TRACKED_PATHS) {
      if (tracked.kind !== 'dir') continue;
      const localAbs = path.join(this.deps.workspaceRoot, tracked.relPath);
      if (!fs.existsSync(localAbs)) continue;
      this.pruneLocalDir(localAbs, tracked.relPath, manifest, errors);
    }

    // 写本地 meta（known_remote_time = 远端 meta 的 last_sync_time）
    this.writeLocalMeta({
      last_sync_time: startedAt,
      known_remote_time: remoteMeta.last_sync_time,
      known_remote_device: remoteMeta.device_id,
    });

    const success = errors.length === 0;
    logger.info(`syncDownload done: files=${fileCount}, errors=${errors.length}`);
    return {
      success,
      direction: 'download',
      fileCount,
      syncedAt: startedAt,
      errors,
      warnings,
    };
  }

  /**
   * 自动同步：getStatus → 路由。
   */
  async syncAuto(): Promise<SyncResult> {
    let status: SyncStatus;
    try {
      status = await this.getStatus();
    } catch (err) {
      return this.failResult('upload', err, Date.now());
    }
    switch (status.direction) {
      case 'upload':
        return this.syncUpload();
      case 'download':
        return this.syncDownload();
      case 'noop':
        return {
          success: true,
          direction: 'upload',
          fileCount: 0,
          syncedAt: Date.now(),
          errors: [],
          warnings: ['无变化，跳过同步'],
        };
      case 'conflict':
      case 'error':
        return {
          success: false,
          direction: 'upload',
          fileCount: 0,
          syncedAt: Date.now(),
          errors: [status.message ?? '无法判定同步方向'],
          warnings: [],
        };
      default:
        return this.failResult('upload', new Error(`未知方向: ${status.direction satisfies never}`), Date.now());
    }
  }

  // =========================================================================
  // 内部辅助
  // =========================================================================

  /** 构造一个失败结果 */
  private failResult(direction: 'upload' | 'download', err: unknown, startedAt: number): SyncResult {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`sync ${direction} failed: ${message}`);
    return {
      success: false,
      direction,
      fileCount: 0,
      syncedAt: startedAt,
      errors: [message],
      warnings: [],
    };
  }

  /**
   * 决策矩阵核心（纯函数，便于单测）。
   */
  private decideDirection(
    localMeta: LocalMeta | null,
    localNewestMtime: number,
    remoteMeta: RemoteMeta | null,
  ): { direction: SyncDirection; message?: string } {
    // 1. 远端 meta 不存在 → upload（首次同步）
    if (!remoteMeta) {
      return { direction: 'upload', message: '首次同步：远端无 meta，将上传本地数据' };
    }
    // 2. 本地 meta 不存在 → download（本机首次接入）
    if (!localMeta) {
      return { direction: 'download', message: '本机首次接入：将下载远端数据' };
    }
    // 3. localChanged / remoteChanged
    const localChanged = localNewestMtime > localMeta.last_sync_time;
    const remoteChanged = remoteMeta.last_sync_time !== localMeta.known_remote_time;

    // 5. 都未变 → noop
    if (!localChanged && !remoteChanged) {
      return { direction: 'noop' };
    }
    // 6. 仅 local 变 → upload
    if (localChanged && !remoteChanged) {
      return { direction: 'upload' };
    }
    // 7. 仅 remote 变 → download
    if (!localChanged && remoteChanged) {
      return { direction: 'download' };
    }
    // 8. 都变（冲突）→ 最新优先
    if (localNewestMtime >= remoteMeta.last_sync_time) {
      return {
        direction: 'conflict',
        message: `冲突：两端均有变更，按最新优先策略推荐上传（local ${localNewestMtime} >= remote ${remoteMeta.last_sync_time}）`,
      };
    }
    return {
      direction: 'conflict',
      message: `冲突：两端均有变更，按最新优先策略推荐下载（remote ${remoteMeta.last_sync_time} > local ${localNewestMtime}）`,
    };
  }

  /**
   * 计算本地 tracked 内容的最新 mtime。
   *
   * 先 checkpoint 两个 DB（使 .db 文件成为单一时间源），再 stat .db 文件，
   * 并递归扫描 tracked 目录取所有文件 mtime 的最大值。
   */
  private computeLocalNewestMtime(): number {
    let newest = 0;
    // checkpoint DB
    try {
      this.deps.todoDbManager.checkpoint();
    } catch {
      // checkpoint 失败不阻断状态计算
    }
    try {
      this.deps.noteDbManager.checkpoint();
    } catch {
      // 同上
    }

    for (const tracked of TRACKED_PATHS) {
      const localAbs = path.join(this.deps.workspaceRoot, tracked.relPath);
      if (!fs.existsSync(localAbs)) continue;
      if (tracked.kind === 'db') {
        const st = fs.statSync(localAbs);
        if (st.mtimeMs > newest) newest = st.mtimeMs;
      } else {
        const m = maxMtimeInDir(localAbs);
        if (m > newest) newest = m;
      }
    }
    return Math.floor(newest);
  }

  /** 读本地 meta 缓存（不存在返回 null） */
  private readLocalMeta(): LocalMeta | null {
    try {
      if (!fs.existsSync(this.deps.syncMetaPath)) return null;
      const raw = fs.readFileSync(this.deps.syncMetaPath, 'utf-8');
      return JSON.parse(raw) as LocalMeta;
    } catch (err) {
      logger.warn('readLocalMeta failed, treating as null', err);
      return null;
    }
  }

  /** 写本地 meta 缓存（原子） */
  private writeLocalMeta(meta: LocalMeta): void {
    try {
      const dir = path.dirname(this.deps.syncMetaPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmp = this.deps.syncMetaPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf-8');
      fs.renameSync(tmp, this.deps.syncMetaPath);
    } catch (err) {
      logger.error('writeLocalMeta failed', err);
    }
  }

  /** 拉取远端 meta.json（404 → null） */
  private async fetchRemoteMeta(client: SyncWebdavClient): Promise<RemoteMeta | null> {
    const exists = await client.exists(REMOTE_META_FILENAME);
    if (!exists) return null;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtian-sync-meta-'));
    const tmpFile = path.join(tmpDir, REMOTE_META_FILENAME);
    try {
      await client.getFile(REMOTE_META_FILENAME, tmpFile);
      const raw = fs.readFileSync(tmpFile, 'utf-8');
      return JSON.parse(raw) as RemoteMeta;
    } catch (err) {
      logger.warn('fetchRemoteMeta: parse failed', err);
      return null;
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  /** 写远端 meta.json */
  private async writeRemoteMeta(client: SyncWebdavClient, meta: RemoteMeta): Promise<void> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtian-sync-meta-'));
    const tmpFile = path.join(tmpDir, REMOTE_META_FILENAME);
    try {
      fs.writeFileSync(tmpFile, JSON.stringify(meta, null, 2), 'utf-8');
      await client.putFile(REMOTE_META_FILENAME, tmpFile);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  /** 上传单个 DB 文件：online backup 到临时文件 → putFile */
  private async uploadDbFile(
    client: SyncWebdavClient,
    relPath: string,
    localAbs: string,
    manifest: Record<string, RemoteFileEntry>,
  ): Promise<void> {
    const dbManager = this.getDbManagerFor(relPath);
    if (!dbManager) {
      throw new Error(`未找到 DB manager for ${relPath}`);
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtian-sync-db-'));
    const tmpFile = path.join(tmpDir, path.basename(relPath));
    try {
      await dbManager.backupTo(tmpFile);
      await client.putFile(relPath, tmpFile);
      const st = fs.statSync(localAbs);
      manifest[relPath] = { size: st.size, mtime: Math.floor(st.mtimeMs) };
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  /** 递归上传目录下所有文件 */
  private async uploadDir(
    client: SyncWebdavClient,
    relRoot: string,
    localAbs: string,
    manifest: Record<string, RemoteFileEntry>,
    errors: string[],
  ): Promise<number> {
    let count = 0;
    const files = listFilesRecursive(localAbs);
    for (const { abs, rel } of files) {
      const remoteRel = `${relRoot}/${rel.split(path.sep).join('/')}`;
      try {
        // ensureDir 父目录
        const parent = path.dirname(remoteRel);
        if (parent && parent !== '.') {
          await client.ensureDir(parent);
        }
        await client.putFile(remoteRel, abs);
        const st = fs.statSync(abs);
        manifest[remoteRel] = { size: st.size, mtime: Math.floor(st.mtimeMs) };
        count++;
      } catch (err) {
        errors.push(`upload ${remoteRel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return count;
  }

  /** 下载 DB 文件：getFile 到临时 → restoreFrom */
  private async downloadDbFile(client: SyncWebdavClient, relPath: string): Promise<void> {
    const dbManager = this.getDbManagerFor(relPath);
    if (!dbManager) {
      throw new Error(`未找到 DB manager for ${relPath}`);
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtian-sync-db-'));
    const tmpFile = path.join(tmpDir, path.basename(relPath));
    try {
      await client.getFile(relPath, tmpFile);
      await dbManager.restoreFrom(tmpFile);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  /** 下载普通文件（覆盖本地，自动创建父目录） */
  private async downloadRegularFile(client: SyncWebdavClient, relPath: string): Promise<void> {
    const localAbs = path.join(this.deps.workspaceRoot, relPath.split('/').join(path.sep));
    const parent = path.dirname(localAbs);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    await client.getFile(relPath, localAbs);
  }

  /** 裁剪本地目录中不在 manifest 的文件 */
  private pruneLocalDir(
    localAbs: string,
    relRoot: string,
    manifest: Record<string, RemoteFileEntry>,
    errors: string[],
  ): void {
    let entries: string[];
    try {
      entries = fs.readdirSync(localAbs);
    } catch {
      return;
    }
    for (const name of entries) {
      const childAbs = path.join(localAbs, name);
      const childRel = `${relRoot}/${name}`;
      try {
        const st = fs.statSync(childAbs);
        if (st.isDirectory()) {
          this.pruneLocalDir(childAbs, childRel, manifest, errors);
        } else {
          const norm = childRel.split(path.sep).join('/');
          if (!(norm in manifest)) {
            fs.unlinkSync(childAbs);
          }
        }
      } catch (err) {
        errors.push(`prune ${childRel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

// =========================================================================
// 纯函数辅助（导出便于单测）
// =========================================================================

/** 递归列出一个目录下所有文件，返回 {abs, rel}（rel 相对 root） */
export function listFilesRecursive(root: string): { abs: string; rel: string }[] {
  const out: { abs: string; rel: string }[] = [];
  const walk = (dir: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(abs, rel);
      } else if (e.isFile()) {
        out.push({ abs, rel });
      }
    }
  };
  walk(root, '');
  return out;
}

/** 取目录下所有文件 mtime 的最大值（空目录返回 0） */
export function maxMtimeInDir(dir: string): number {
  let max = 0;
  for (const { abs } of listFilesRecursive(dir)) {
    try {
      const st = fs.statSync(abs);
      if (st.mtimeMs > max) max = st.mtimeMs;
    } catch {
      // ignore stat 失败
    }
  }
  return max;
}

/** 判断 relPath 是否在 dirPrefix 目录下（dirPrefix 不含尾斜杠） */
export function isUnderPath(relPath: string, dirPrefix: string): boolean {
  const norm = dirPrefix.replace(/\/+$/, '');
  return relPath === norm || relPath.startsWith(norm + '/');
}
