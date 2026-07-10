import * as fs from 'fs';
import * as path from 'path';

import { DBManager } from '@/core/database/db-manager';
import { createLogger } from '@/core/utils/logger';

const logger = createLogger('NoteDb');

/**
 * Note 应用数据库封装
 *
 * 职责：
 * 1. 连接 workspace/app_modules/note_app/note.db 并按 data/note-app.sql 建表
 * 2. 暴露 getDBManager() 供 Service 层执行业务查询
 * 3. 关闭连接
 *
 * 不负责：递归软删除、FTS 同步（这些在 Service 层）。
 */
export class NoteDb {
  private db: DBManager;
  private readonly dbPath: string;
  private readonly sqlFile: string;

  /**
   * @param dbPath - note.db 文件路径
   * @param sqlFile - data/note-app.sql 路径（建表脚本）
   */
  constructor(dbPath: string, sqlFile: string) {
    this.dbPath = dbPath;
    this.sqlFile = sqlFile;
    this.db = new DBManager(dbPath);
  }

  /**
   * 初始化：确保目录存在并按 note-app.sql 建表（幂等，IF NOT EXISTS）。
   *
   * 注意：DBManager 的 isInitialized 仅检查是否有任意表，不会自动建表，
   *      因此 NoteDb 显式调用 runSqlScript。
   */
  initialize(): void {
    this.ensureDir(path.dirname(this.dbPath));
    this.runSqlScript(this.sqlFile);
    logger.info(`NoteDb initialized at ${this.dbPath}`);
  }

  /**
   * 暴露内部 DBManager 供 Service 层执行业务查询。
   */
  getDBManager(): DBManager {
    return this.db;
  }

  /** 关闭数据库连接 */
  close(): void {
    this.db.close();
    logger.info('NoteDb closed');
  }

  // =========================================================================
  // 内部工具
  // =========================================================================

  /** 确保 DB 文件所在目录存在 */
  private ensureDir(dir: string): void {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (err) {
      logger.error(`Failed to ensure note-app dir ${dir}`, err);
      throw err;
    }
  }

  /**
   * 执行 SQL 建表脚本
   *
   * 委托 better-sqlite3 原生 `exec()`，正确处理多语句、注释、空白片段。
   * PRAGMA 与 CREATE 均为幂等（IF NOT EXISTS），重复执行安全。
   */
  private runSqlScript(sqlFile: string): void {
    let script: string;
    try {
      script = fs.readFileSync(sqlFile, 'utf-8');
    } catch (err) {
      throw new Error(`Cannot read note-app SQL file '${sqlFile}': ${err}`);
    }
    this.db.exec(script);
  }
}
