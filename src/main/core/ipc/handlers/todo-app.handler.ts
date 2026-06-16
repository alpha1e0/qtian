import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../channels';
import { createLogger } from '@/core/utils/logger';
import { TodoAppService } from '@/core/services/app-modules/todo-app/todo-app.service';
import {
  TodoItemStatus,
  TodoItemPriority,
} from '@/core/services/app-modules/todo-app/types';

const logger = createLogger('IPC:TodoApp');

/**
 * 注册 todo-app IPC handlers（Phase 1-2 范围）。
 *
 * 覆盖：Category / TodoList / TodoItem / Label / Document / Config。
 * 未覆盖（后续 Phase）：全文搜索、回收站统一入口、Todo 驱动任务。
 *
 * @param todoAppService - todo-app 服务单例
 */
export function registerTodoAppHandlers(todoAppService: TodoAppService): void {
  const category = todoAppService.getCategoryService();
  const list = todoAppService.getListService();
  const item = todoAppService.getItemService();
  const label = todoAppService.getLabelService();
  const doc = todoAppService.getDocumentService();

  // ===== Category =====
  ipcMain.handle(IPC_CHANNELS.TODO_GET_CATEGORY_TREE, async () => {
    return category.getTree();
  });

  ipcMain.handle(IPC_CHANNELS.TODO_CREATE_CATEGORY, async (_e, data: { name: string; parent_id: number | null }) => {
    logger.info(`Create category: name='${data.name}'`);
    return category.create(data);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_UPDATE_CATEGORY, async (_e, id: number, patch: { name?: string; parent_id?: number | null }) => {
    return category.update(id, patch);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_DELETE_CATEGORY, async (_e, id: number) => {
    category.delete(id);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_RESTORE_CATEGORY, async (_e, id: number) => {
    return category.restore(id);
  });

  // ===== TodoList =====
  ipcMain.handle(IPC_CHANNELS.TODO_LIST_TODO_LISTS, async (_e, categoryId?: number | null) => {
    return list.list(categoryId);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_GET_TODO_LIST, async (_e, id: number) => {
    return list.getById(id);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_CREATE_TODO_LIST, async (_e, data: { name: string; description?: string; category_id?: number | null }) => {
    logger.info(`Create todo list: name='${data.name}'`);
    return list.create(data);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_UPDATE_TODO_LIST, async (_e, id: number, patch: { name?: string; description?: string; category_id?: number | null }) => {
    return list.update(id, patch);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_DELETE_TODO_LIST, async (_e, id: number) => {
    list.delete(id);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_RESTORE_TODO_LIST, async (_e, id: number) => {
    return list.restore(id);
  });

  // ===== TodoItem =====
  ipcMain.handle(IPC_CHANNELS.TODO_GET_TODO_ITEM, async (_e, id: number) => {
    return item.getById(id);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_GET_TODO_ITEM_TREE, async (_e, listId: number) => {
    return item.getTreeByList(listId);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_CREATE_TODO_ITEM, async (_e, data: any) => {
    logger.info(`Create todo item: title='${data?.title}'`);
    return item.create(data);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_UPDATE_TODO_ITEM, async (_e, id: number, patch: any) => {
    return item.update(id, patch);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_DELETE_TODO_ITEM, async (_e, id: number) => {
    item.delete(id);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_RESTORE_TODO_ITEM, async (_e, id: number) => {
    return item.restore(id);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_UPDATE_TODO_ITEM_STATUS, async (_e, id: number, status: TodoItemStatus) => {
    return item.updateStatus(id, status);
  });

  // ===== Label =====
  ipcMain.handle(IPC_CHANNELS.TODO_LIST_LABELS, async () => {
    return label.list();
  });

  ipcMain.handle(IPC_CHANNELS.TODO_CREATE_LABEL, async (_e, data: { name: string; type?: string }) => {
    logger.info(`Create label: name='${data.name}'`);
    return label.create(data);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_UPDATE_LABEL, async (_e, id: number, patch: { name?: string; type?: string }) => {
    return label.update(id, patch);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_DELETE_LABEL, async (_e, id: number) => {
    label.delete(id);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_LIST_TODO_ITEMS_BY_LABEL, async (_e, labelId: number) => {
    return item.listByLabel(labelId);
  });

  // ===== Document =====
  ipcMain.handle(IPC_CHANNELS.TODO_LIST_DOCS_BY_CATEGORY, async (_e, categoryId: number) => {
    return doc.listByCategory(categoryId);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_LIST_DOCS_BY_ITEM, async (_e, itemId: number) => {
    return doc.listByItem(itemId);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_GET_DOCUMENT, async (_e, id: number) => {
    return doc.getById(id);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_SAVE_DOCUMENT, async (_e, data: { id?: number; name: string; content?: string; todo_category_id?: number | null; todo_item_id?: number | null }) => {
    if (data.id) {
      return doc.update(data.id, { name: data.name, content: data.content });
    }
    return doc.create({
      name: data.name,
      content: data.content,
      todo_category_id: data.todo_category_id,
      todo_item_id: data.todo_item_id,
    });
  });

  ipcMain.handle(IPC_CHANNELS.TODO_DELETE_DOCUMENT, async (_e, id: number) => {
    doc.delete(id);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_SAVE_ATTACHMENT, async (_e, buffer: Buffer, ext: string) => {
    return doc.saveAttachment(Buffer.from(buffer), ext);
  });

  // ===== Config =====
  ipcMain.handle(IPC_CHANNELS.TODO_GET_CONFIG, async () => {
    return todoAppService.getConfig();
  });

  logger.info('Todo app IPC handlers registered');
}

// 导出类型供 handler 内部引用（避免 unused import 警告）
export type { TodoItemStatus, TodoItemPriority };
