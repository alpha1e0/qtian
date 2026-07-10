import { wpath, config } from '@/core/common/context';
import { createLogger } from '@/core/utils/logger';
import { registerNoteAppHandlers } from '@/core/ipc/handlers/note-app.handler';
import { NoteDb } from './note-db';
import { NoteAppService } from './note-app.service';

const logger = createLogger('NoteAppBootstrap');

/** 进程级单例：note-app 服务（由 bootstrapNoteApp 创建） */
let noteAppSingleton: NoteAppService | null = null;

/**
 * 引导 note-app 模块：
 * 1. 创建 NoteDb（workspace/app_modules/note_app/note.db）+ 建表
 * 2. 读取 config.noteApp 运行时配置
 * 3. 创建 NoteAppService 并装配子 Service
 * 4. 注册 IPC handlers
 *
 * 幂等：重复调用直接返回已创建的单例。
 *
 * @returns note-app 服务单例
 */
export function bootstrapNoteApp(): NoteAppService {
  if (noteAppSingleton) {
    return noteAppSingleton;
  }

  // 1. 数据库
  const db = new NoteDb(wpath.noteDbPath, wpath.getNoteAppSqlFile());
  db.initialize();

  // 2. 运行时配置
  const noteConfig = {
    defaultCategoryId: config.noteApp.defaultCategoryId,
    defaultSort: config.noteApp.defaultSort,
    maxCategoryDepth: config.noteApp.maxCategoryDepth,
  };

  // 3. 装配 Service
  const service = new NoteAppService(db, noteConfig, wpath.appModulesNoteAttachDir);

  // 4. 注册 IPC handlers
  registerNoteAppHandlers(service);

  noteAppSingleton = service;
  logger.info('Note app bootstrapped');
  return service;
}

/**
 * 获取 note-app 服务单例（未引导时抛错）
 */
export function getNoteAppService(): NoteAppService {
  if (!noteAppSingleton) {
    throw new Error('Note app not bootstrapped. Call bootstrapNoteApp() first.');
  }
  return noteAppSingleton;
}
