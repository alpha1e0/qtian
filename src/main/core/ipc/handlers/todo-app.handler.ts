import { ipcMain, BrowserWindow, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

import { IPC_CHANNELS } from '../channels';
import { createLogger } from '@/core/utils/logger';
import { TodoAppService } from '@/core/services/app-modules/todo-app/todo-app.service';
import { buildExportFileName } from '@/core/services/app-modules/todo-app/todo-export-filename';
import {
  TodoItemStatus,
  TodoItemPriority,
  TodoTrashEntityType,
  TodoListExportBundle,
} from '@/core/services/app-modules/todo-app/types';
import { parseQuickItemInput } from '@/core/services/app-modules/todo-app/todo-quick-input';

const logger = createLogger('IPC:TodoApp');

/**
 * 注册 todo-app IPC handlers（Phase 1-5 范围）。
 *
 * 覆盖：Category / TodoList / TodoItem / Label / Document / Config（Phase 1-2），
 *      全文搜索（Phase 3）、回收站统一入口（Phase 4）、Todo 驱动 AI 任务（Phase 5）。
 *
 * Phase 5 任务 handler 仅在 todoAppService.getTaskService() 非 null 时注册
 * （TaskManager 未注入时跳过，保证 bootstrap 降级安全）。
 *
 * @param todoAppService - todo-app 服务单例
 */
export function registerTodoAppHandlers(todoAppService: TodoAppService): void {
  const category = todoAppService.getCategoryService();
  const list = todoAppService.getListService();
  const item = todoAppService.getItemService();
  const label = todoAppService.getLabelService();
  const doc = todoAppService.getDocumentService();
  const search = todoAppService.getSearchService();
  const exchange = todoAppService.getExchangeService();

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

  // ===== TodoList 收藏 =====
  ipcMain.handle(IPC_CHANNELS.TODO_TOGGLE_FAVORITE, async (_e, id: number) => {
    logger.info(`Toggle favorite: id=${id}`);
    return list.toggleFavorite(id);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_LIST_FAVORITES, async () => {
    return list.listFavorites();
  });

  // ===== TodoList 导入/导出 JSON =====
  // 主进程聚合 dialog + fs + exchange service，渲染进程只调单一 IPC。
  // 用户取消对话框时返回 null，渲染层静默处理。

  ipcMain.handle(IPC_CHANNELS.TODO_EXPORT_TODO_LIST, async (_e, listId: number) => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined;
    // 默认文件名包含待办项目名称与本地时间戳（YYYYMMDDHHmmss），
    // 取不到 list 时由工具内部回退为 `todolist-<listId>-...`
    const targetList = list.getById(listId);
    const defaultName = buildExportFileName(targetList?.name ?? '', Date.now(), listId);
    const result = await dialog.showSaveDialog(win!, {
      title: '导出待办项目',
      defaultPath: defaultName,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) {
      logger.info(`Export canceled: listId=${listId}`);
      return null;
    }
    try {
      const bundle = exchange.serialize(listId);
      fs.writeFileSync(result.filePath, JSON.stringify(bundle, null, 2), 'utf8');
      logger.info(`Exported list: listId=${listId}, file=${result.filePath}`);
      return { filePath: result.filePath };
    } catch (err) {
      logger.error(`Export failed: listId=${listId}`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.TODO_IMPORT_TODO_LIST, async (_e, categoryId: number) => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined;
    const result = await dialog.showOpenDialog(win!, {
      title: '导入待办项目',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      logger.info(`Import canceled: categoryId=${categoryId}`);
      return null;
    }
    const filePath = result.filePaths[0];
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      let bundle: unknown;
      try {
        bundle = JSON.parse(raw);
      } catch (parseErr) {
        throw new Error(`文件不是合法的 JSON：${path.basename(filePath)}`);
      }
      const importResult = exchange.deserialize(bundle as TodoListExportBundle, categoryId);
      logger.info(`Imported list: categoryId=${categoryId}, file=${filePath}, items=${importResult.itemCount}`);
      return importResult;
    } catch (err) {
      logger.error(`Import failed: categoryId=${categoryId}, file=${filePath}`, err);
      throw err;
    }
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

  // ===== TodoItem 快捷创建（中间面板底部输入框） =====
  // 解析结尾 #N 控制符（#4=urgent/#3=important/#2=normal/#1=hint）后落库，
  // 单一通道保证解析逻辑只存于 main（renderer 无需重复实现，便于单测覆盖）。
  ipcMain.handle(
    IPC_CHANNELS.TODO_CREATE_ITEM_QUICK,
    async (_e, raw: string, listId: number, parentId: number | null) => {
      const { title, priority } = parseQuickItemInput(raw);
      logger.info(`Quick create item: title='${title}', priority=${priority}, listId=${listId}`);
      return item.create({
        title,
        todo_list_id: listId,
        parent_id: parentId,
        priority,
      });
    },
  );

  // ===== 描述字段选中批量创建（详见 §9.4「描述字段右键快捷创建待办条目」）=====
  // 与 TODO_CREATE_ITEM_QUICK 区别：不解析 #N，整段文本按 \n 拆为多条 title。
  // 一次事务批量 INSERT + 事务外 recalcParentProgress 一次。
  ipcMain.handle(
    IPC_CHANNELS.TODO_CREATE_ITEMS_FROM_TEXT,
    async (_e, text: string, listId: number, parentId: number | null) => {
      const items = item.createFromText(text, {
        todo_list_id: listId,
        parent_id: parentId,
      });
      logger.info(
        `Create items from text: count=${items.length}, listId=${listId}, parentId=${parentId}`,
      );
      return items;
    },
  );

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

  ipcMain.handle(IPC_CHANNELS.TODO_LIST_TODO_LISTS_BY_LABEL, async (_e, labelId: number) => {
    return list.listByLabel(labelId);
  });

  // ===== Document =====
  ipcMain.handle(IPC_CHANNELS.TODO_LIST_DOCS_BY_LIST, async (_e, listId: number) => {
    return doc.listByList(listId);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_LIST_DOCS_BY_ITEM, async (_e, itemId: number) => {
    return doc.listByItem(itemId);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_GET_DOCUMENT, async (_e, id: number) => {
    return doc.getById(id);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_SAVE_DOCUMENT, async (_e, data: { id?: number; name: string; content?: string; todo_list_id?: number | null; todo_item_id?: number | null }) => {
    if (data.id) {
      return doc.update(data.id, { name: data.name, content: data.content });
    }
    return doc.create({
      name: data.name,
      content: data.content,
      todo_list_id: data.todo_list_id,
      todo_item_id: data.todo_item_id,
    });
  });

  ipcMain.handle(IPC_CHANNELS.TODO_DELETE_DOCUMENT, async (_e, id: number) => {
    doc.delete(id);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_SAVE_ATTACHMENT, async (_e, buffer: Buffer, ext: string) => {
    return doc.saveAttachment(Buffer.from(buffer), ext);
  });

  // 基于文件路径的附件保存：主进程直接读取文件落盘，避免大文件经 IPC 传输完整 buffer
  ipcMain.handle(
    IPC_CHANNELS.TODO_SAVE_ATTACHMENT_FROM_PATH,
    async (_e, filePath: string) => {
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      return doc.saveAttachment(buffer, ext);
    },
  );

  // ===== Config =====
  ipcMain.handle(IPC_CHANNELS.TODO_GET_CONFIG, async () => {
    return todoAppService.getConfig();
  });

  // ===== 全文搜索（Phase 3） =====
  ipcMain.handle(IPC_CHANNELS.TODO_SEARCH, async (_e, query: string, limit?: number) => {
    logger.info(`Search: query='${query}'`);
    return search.search(query, limit);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_LIST_SEARCH_HISTORY, async (_e, limit?: number) => {
    return search.listSearchHistory(limit);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_DELETE_SEARCH_HISTORY, async (_e, id: number) => {
    search.deleteSearchHistory(id);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_CLEAR_SEARCH_HISTORY, async () => {
    search.clearSearchHistory();
  });

  // ===== 回收站（Phase 4：跨表聚合 + 物理删除） =====
  ipcMain.handle(IPC_CHANNELS.TODO_LIST_TRASH, async () => {
    return todoAppService.listTrash();
  });

  ipcMain.handle(IPC_CHANNELS.TODO_PURGE_TRASH, async (_e, type: TodoTrashEntityType, id: number) => {
    logger.info(`Purge trash: type=${type}, id=${id}`);
    todoAppService.purgeTrash(type, id);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_EMPTY_TRASH, async () => {
    logger.info('Empty trash');
    return todoAppService.emptyTrash();
  });

  // ===== 回收站 UI 恢复补全（document / label） =====
  ipcMain.handle(IPC_CHANNELS.TODO_RESTORE_DOCUMENT, async (_e, id: number) => {
    logger.info(`Restore document: id=${id}`);
    return doc.restore(id);
  });

  ipcMain.handle(IPC_CHANNELS.TODO_RESTORE_LABEL, async (_e, id: number) => {
    logger.info(`Restore label: id=${id}`);
    return label.restore(id);
  });

  // ===== Todo 驱动 AI 任务（Phase 5） =====
  // 仅在 TaskManager 已注入时注册；未注入时 IPC 调用会因 channel 未注册而失败
  // （与 bootstrap 降级策略一致：todo-app 其他功能不受影响）
  const task = todoAppService.getTaskService();
  if (task) {
    ipcMain.handle(
      IPC_CHANNELS.TODO_CREATE_TASK_FROM_ITEM,
      async (_e, itemId: number, options: { agentName: string; llmConfigName: string; extraPrompt?: string }) => {
        logger.info(`Create task from item: itemId=${itemId}, agent=${options?.agentName}`);
        return task.createTaskFromItem(itemId, options);
      },
    );

    ipcMain.handle(IPC_CHANNELS.TODO_LIST_TASKS_BY_ITEM, async (_e, itemId: number) => {
      return task.listTasksByItem(itemId);
    });
  }

  logger.info('Todo app IPC handlers registered');
}

// 导出类型供 handler 内部引用（避免 unused import 警告）
export type { TodoItemStatus, TodoItemPriority, TodoTrashEntityType, TodoListExportBundle };
