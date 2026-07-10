import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

import { IPC_CHANNELS } from '../channels';
import { createLogger } from '@/core/utils/logger';
import { NoteAppService } from '@/core/services/app-modules/note-app/note-app.service';
import { NoteTrashEntityType } from '@/core/services/app-modules/note-app/types';

const logger = createLogger('IPC:NoteApp');

/**
 * 注册 note-app IPC handlers（Phase 1 范围）。
 *
 * 覆盖：Category / Doc / Label / Search / Trash / Config。
 *
 * @param noteAppService - note-app 服务单例
 */
export function registerNoteAppHandlers(noteAppService: NoteAppService): void {
  const category = noteAppService.getCategoryService();
  const doc = noteAppService.getDocService();
  const label = noteAppService.getLabelService();
  const search = noteAppService.getSearchService();

  // ===== Category =====
  ipcMain.handle(IPC_CHANNELS.NOTE_GET_CATEGORY_TREE, async () => {
    return category.getTree();
  });

  ipcMain.handle(
    IPC_CHANNELS.NOTE_CREATE_CATEGORY,
    async (_e, data: { name: string; parent_id: number | null }) => {
      logger.info(`Create category: name='${data.name}'`);
      return category.create(data);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.NOTE_UPDATE_CATEGORY,
    async (_e, id: number, patch: { name?: string; parent_id?: number | null }) => {
      return category.update(id, patch);
    },
  );

  ipcMain.handle(IPC_CHANNELS.NOTE_DELETE_CATEGORY, async (_e, id: number) => {
    category.delete(id);
  });

  ipcMain.handle(IPC_CHANNELS.NOTE_RESTORE_CATEGORY, async (_e, id: number) => {
    return category.restore(id);
  });

  // ===== Doc =====
  ipcMain.handle(IPC_CHANNELS.NOTE_LIST_DOCS, async (_e, categoryId?: number | null) => {
    return doc.list(categoryId);
  });

  ipcMain.handle(IPC_CHANNELS.NOTE_GET_DOC, async (_e, id: number) => {
    return doc.getById(id);
  });

  ipcMain.handle(
    IPC_CHANNELS.NOTE_CREATE_DOC,
    async (_e, data: { title: string; summary?: string; content?: string; category_id?: number | null; task_prompt?: string; label_ids?: number[] }) => {
      logger.info(`Create doc: title='${data.title}'`);
      return doc.create(data);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.NOTE_UPDATE_DOC,
    async (_e, id: number, patch: any) => {
      return doc.update(id, patch);
    },
  );

  ipcMain.handle(IPC_CHANNELS.NOTE_DELETE_DOC, async (_e, id: number) => {
    doc.delete(id);
  });

  ipcMain.handle(IPC_CHANNELS.NOTE_RESTORE_DOC, async (_e, id: number) => {
    return doc.restore(id);
  });

  ipcMain.handle(IPC_CHANNELS.NOTE_TOGGLE_FAVORITE, async (_e, id: number) => {
    logger.info(`Toggle favorite: id=${id}`);
    return doc.toggleFavorite(id);
  });

  ipcMain.handle(IPC_CHANNELS.NOTE_LIST_FAVORITES, async () => {
    return doc.listFavorites();
  });

  ipcMain.handle(IPC_CHANNELS.NOTE_LIST_DOCS_BY_LABEL, async (_e, labelId: number) => {
    return doc.listByLabel(labelId);
  });

  ipcMain.handle(IPC_CHANNELS.NOTE_SAVE_ATTACHMENT, async (_e, buffer: Buffer, ext: string) => {
    return doc.saveAttachment(Buffer.from(buffer), ext);
  });

  // 基于文件路径的附件保存：主进程直接读取文件落盘
  ipcMain.handle(
    IPC_CHANNELS.NOTE_SAVE_ATTACHMENT_FROM_PATH,
    async (_e, filePath: string) => {
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      return doc.saveAttachment(buffer, ext);
    },
  );

  // ===== Label =====
  ipcMain.handle(IPC_CHANNELS.NOTE_LIST_LABELS, async () => {
    return label.list();
  });

  ipcMain.handle(
    IPC_CHANNELS.NOTE_CREATE_LABEL,
    async (_e, data: { name: string; type?: string }) => {
      logger.info(`Create label: name='${data.name}'`);
      return label.create(data);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.NOTE_UPDATE_LABEL,
    async (_e, id: number, patch: { name?: string; type?: string }) => {
      return label.update(id, patch);
    },
  );

  ipcMain.handle(IPC_CHANNELS.NOTE_DELETE_LABEL, async (_e, id: number) => {
    label.delete(id);
  });

  ipcMain.handle(IPC_CHANNELS.NOTE_RESTORE_LABEL, async (_e, id: number) => {
    logger.info(`Restore label: id=${id}`);
    return label.restore(id);
  });

  // ===== Search =====
  ipcMain.handle(IPC_CHANNELS.NOTE_SEARCH, async (_e, query: string, limit?: number) => {
    logger.info(`Search: query='${query}'`);
    return search.search(query, limit);
  });

  ipcMain.handle(IPC_CHANNELS.NOTE_LIST_SEARCH_HISTORY, async (_e, limit?: number) => {
    return search.listSearchHistory(limit);
  });

  ipcMain.handle(IPC_CHANNELS.NOTE_DELETE_SEARCH_HISTORY, async (_e, id: number) => {
    search.deleteSearchHistory(id);
  });

  ipcMain.handle(IPC_CHANNELS.NOTE_CLEAR_SEARCH_HISTORY, async () => {
    search.clearSearchHistory();
  });

  // ===== Trash =====
  ipcMain.handle(IPC_CHANNELS.NOTE_LIST_TRASH, async () => {
    return noteAppService.listTrash();
  });

  ipcMain.handle(
    IPC_CHANNELS.NOTE_PURGE_TRASH,
    async (_e, type: NoteTrashEntityType, id: number) => {
      logger.info(`Purge trash: type=${type}, id=${id}`);
      noteAppService.purgeTrash(type, id);
    },
  );

  ipcMain.handle(IPC_CHANNELS.NOTE_EMPTY_TRASH, async () => {
    logger.info('Empty trash');
    return noteAppService.emptyTrash();
  });

  // ===== Config =====
  ipcMain.handle(IPC_CHANNELS.NOTE_GET_CONFIG, async () => {
    return noteAppService.getConfig();
  });

  logger.info('Note app IPC handlers registered');
}

// 导出类型供 handler 内部引用
export type { NoteTrashEntityType };
