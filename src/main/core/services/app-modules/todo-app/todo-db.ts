import * as fs from 'fs';
import * as path from 'path';

import { DBManager } from '@/core/database/db-manager';
import { createLogger } from '@/core/utils/logger';

const logger = createLogger('TodoDb');

/**
 * Todo 应用数据库封装
 *
 * 职责：
 * 1. 连接 workspace/app_modules/todo_app/todo.db 并按 data/todo-app.sql 建表
 * 2. 暴露 getDBManager() 供 Service 层执行业务查询（todo-app 跨表 JOIN 较多，
 *    集中在 TodoDb 会导致类过大，故业务查询下沉到各 Service）
 * 3. 关闭连接
 *
 * 不负责：递归软删除、状态机校验、进度联动、FTS 同步（这些在 Service 层）。
 */
export class TodoDb {
  private db: DBManager;
  private readonly dbPath: string;
  private readonly sqlFile: string;

  /**
   * @param dbPath - todo.db 文件路径
   * @param sqlFile - data/todo-app.sql 路径（建表脚本）
   */
  constructor(dbPath: string, sqlFile: string) {
    this.dbPath = dbPath;
    this.sqlFile = sqlFile;
    this.db = new DBManager(dbPath);
  }

  /**
   * 初始化：确保目录存在并按 todo-app.sql 建表（幂等，IF NOT EXISTS）。
   *
   * 注意：DBManager 的 isInitialized 仅检查是否有任意表，不会自动建表，
   *      因此 TodoDb 显式调用 runSqlScript（与 TaskDb 一致）。
   */
  initialize(): void {
    this.ensureDir(path.dirname(this.dbPath));
    this.runSqlScript(this.sqlFile);
    logger.info(`TodoDb initialized at ${this.dbPath}`);
  }

  /**
   * 暴露内部 DBManager 供 Service 层执行业务查询。
   *
   * 设计原因：todo-app 6 张表跨表 JOIN 较多，集中在 TodoDb 会导致类过大，
   *          且查询语义属于具体 Service。Service 通过此方法拿到 DBManager
   *          执行 query/execute/insert/get。
   */
  getDBManager(): DBManager {
    return this.db;
  }

  /** 关闭数据库连接 */
  close(): void {
    this.db.close();
    logger.info('TodoDb closed');
  }

  // =========================================================================
  // 内部工具
  // =========================================================================

  /** 确保 DB 文件所在目录存在 */
  private ensureDir(dir: string): void {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (err) {
      logger.error(`Failed to ensure todo-app dir ${dir}`, err);
      throw err;
    }
  }

  /** 执行 SQL 建表脚本（按 ';' 拆分语句） */
  private runSqlScript(sqlFile: string): void {
    let script: string;
    try {
      script = fs.readFileSync(sqlFile, 'utf-8');
    } catch (err) {
      throw new Error(`Cannot read todo-app SQL file '${sqlFile}': ${err}`);
    }

    // PRAGMA 与 CREATE 均为幂等（IF NOT EXISTS），重复执行安全
    const statements = script.split(';');
    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (trimmed.length > 0) {
        this.db.execute(trimmed);
      }
    }
  }
}
