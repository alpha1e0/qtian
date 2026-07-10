import * as os from 'os';
import * as crypto from 'crypto';

import { wpath, config } from '@/core/common/context';
import { createLogger } from '@/core/utils/logger';
import { registerSyncHandlers } from '@/core/ipc/handlers/sync.handler';
import { getTodoAppService } from '@/core/services/app-modules/todo-app/todo-app-bootstrap';
import { getNoteAppService } from '@/core/services/app-modules/note-app/note-app-bootstrap';
import { SyncService } from './sync-service';
import type { WebdavClientConfig } from './sync-types';

const logger = createLogger('SyncBootstrap');

/** 进程级单例：SyncService（由 bootstrapSync 创建） */
let syncSingleton: SyncService | null = null;

/** 设备 ID 缓存（首次计算后复用） */
let cachedDeviceId: string | null = null;

/**
 * 生成本机设备 ID（hostname + 随机后缀，持久化于工作区以稳定多设备判定）。
 */
function ensureDeviceId(): string {
  if (cachedDeviceId) {
    return cachedDeviceId;
  }
  const keyPath = wpath.syncDir + '/.device-id';
  const fs = require('fs') as typeof import('fs');
  try {
    if (fs.existsSync(keyPath)) {
      cachedDeviceId = fs.readFileSync(keyPath, 'utf-8').trim();
      return cachedDeviceId;
    }
  } catch {
    // 读取失败则重建
  }
  const host = os.hostname() || 'unknown';
  const suffix = crypto.randomBytes(4).toString('hex');
  cachedDeviceId = `${host}-${suffix}`;
  try {
    fs.writeFileSync(keyPath, cachedDeviceId, 'utf-8');
  } catch (err) {
    logger.warn('Failed to persist device id', err);
  }
  return cachedDeviceId;
}

/**
 * 引导数据同步模块：
 * 1. 获取 todo / note 的 DBManager
 * 2. 创建 SyncService（DI：workspace 根、DB 引用、webdav 配置 provider、设备 ID）
 * 3. 注册 IPC handlers
 *
 * 幂等：重复调用直接返回已创建的单例。
 *
 * 前置依赖：todo-app / note-app 已引导（getTodoAppService / getNoteAppService 可用）。
 *
 * @returns SyncService 单例
 */
export function bootstrapSync(): SyncService {
  if (syncSingleton) {
    return syncSingleton;
  }

  const todoDbManager = getTodoAppService().getDb().getDBManager();
  const noteDbManager = getNoteAppService().getDb().getDBManager();

  const deviceId = ensureDeviceId();

  const service = new SyncService({
    workspaceRoot: wpath.workspace,
    syncMetaPath: wpath.syncMetaPath,
    todoDbManager,
    noteDbManager,
    webdavConfigProvider: (): WebdavClientConfig | null => {
      const w = config.global.webdav;
      if (!w.url && !w.accountName && !w.accountPassword && !w.folder) {
        return null;
      }
      return {
        url: w.url,
        accountName: w.accountName,
        accountPassword: w.accountPassword,
        folder: w.folder,
      };
    },
    deviceId,
  });

  registerSyncHandlers(service);

  syncSingleton = service;
  logger.info(`Sync service bootstrapped (deviceId=${deviceId})`);
  return service;
}

/**
 * 获取 SyncService 单例（未引导时抛错）。
 */
export function getSyncService(): SyncService {
  if (!syncSingleton) {
    throw new Error('Sync service not bootstrapped. Call bootstrapSync() first.');
  }
  return syncSingleton;
}
