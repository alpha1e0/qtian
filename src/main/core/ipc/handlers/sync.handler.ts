import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../channels';
import { createLogger } from '@/core/utils/logger';
import { config, wpath, type WebdavConfig } from '@/core/common/context';
import { writeGlobalWebdavConfig } from '@/core/common/config-io';
import type { SyncService } from '@/core/services/sync/sync-service';

const logger = createLogger('IPC:Sync');

/**
 * 注册数据同步 IPC handlers。
 *
 * @param syncService - SyncService 单例
 */
export function registerSyncHandlers(syncService: SyncService): void {
  ipcMain.handle(IPC_CHANNELS.SYNC_GET_STATUS, async () => {
    try {
      return await syncService.getStatus();
    } catch (err) {
      logger.error('getStatus failed', err);
      return {
        direction: 'error',
        localNewestMtime: 0,
        lastSyncTime: null,
        remoteLastSyncTime: null,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SYNC_UPLOAD, async () => {
    return syncService.syncUpload();
  });

  ipcMain.handle(IPC_CHANNELS.SYNC_DOWNLOAD, async () => {
    return syncService.syncDownload();
  });

  ipcMain.handle(IPC_CHANNELS.SYNC_AUTO, async () => {
    return syncService.syncAuto();
  });

  ipcMain.handle(IPC_CHANNELS.SYNC_TEST_CONNECTION, async () => {
    try {
      const ok = await syncService.testConnection();
      return { success: ok };
    } catch (err) {
      logger.error('testConnection failed', err);
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SYNC_GET_CONFIG, async () => {
    return syncService.getWebdavConfig();
  });

  ipcMain.handle(IPC_CHANNELS.SYNC_SAVE_CONFIG, async (_e, cfg: WebdavConfig | null) => {
    try {
      // 原子写入 qtian.json 的 global.webdav 段
      writeGlobalWebdavConfig(wpath.configPath, cfg);
      // 同步更新内存 config（避免重启前用旧值）
      if (cfg) {
        config.global.webdav.url = cfg.url;
        config.global.webdav.accountName = cfg.accountName;
        config.global.webdav.accountPassword = cfg.accountPassword;
        config.global.webdav.folder = cfg.folder;
      } else {
        config.global.webdav.url = '';
        config.global.webdav.accountName = '';
        config.global.webdav.accountPassword = '';
        config.global.webdav.folder = '';
      }
      logger.info('WebDAV config saved');
      return { success: true };
    } catch (err) {
      logger.error('saveConfig failed', err);
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  });
}
