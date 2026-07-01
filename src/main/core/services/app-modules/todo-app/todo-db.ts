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
   * 初始化：确保目录存在并按 todo-app.sql 建表（幂等，IF NOT EXISTS），
   * 再执行增量列迁移（为已有库补齐后续新增字段）。
   *
   * 注意：DBManager 的 isInitialized 仅检查是否有任意表，不会自动建表，
   *      因此 TodoDb 显式调用 runSqlScript（与 TaskDb 一致）。
   *      CREATE TABLE IF NOT EXISTS 对已存在的表不会加列，故新增字段需
   *      由 runMigrations 显式 ALTER TABLE ADD COLUMN 补齐。
   */
  initialize(): void {
    this.ensureDir(path.dirname(this.dbPath));
    this.runSqlScript(this.sqlFile);
    this.runMigrations();
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

  /**
   * 执行 SQL 建表脚本
   *
   * 委托 better-sqlite3 原生 `exec()`，正确处理多语句、注释、空白片段，
   * 避免尾部纯注释片段触发 `The supplied SQL string contains no statements`。
   * PRAGMA 与 CREATE 均为幂等（IF NOT EXISTS），重复执行安全。
   */
  private runSqlScript(sqlFile: string): void {
    let script: string;
    try {
      script = fs.readFileSync(sqlFile, 'utf-8');
    } catch (err) {
      throw new Error(`Cannot read todo-app SQL file '${sqlFile}': ${err}`);
    }
    this.db.exec(script);
  }

  /**
   * 增量列迁移：为已有数据库补齐后续版本新增的列。
   *
   * 背景：CREATE TABLE IF NOT EXISTS 对已存在的表不会添加新列，老库升级时
   *      需通过 ALTER TABLE ADD COLUMN 显式补齐。每条迁移均先以
   *      PRAGMA table_info 检查列是否已存在，保证幂等（重复执行安全）。
   *
   * 新增字段在此追加迁移项，保持向前兼容。
   */
  private runMigrations(): void {
    this.ensureColumn('todo_list', 'is_favorite', 'INTEGER NOT NULL DEFAULT 0');
  }

  /**
   * 幂等加列：若目标表无该列则执行 ALTER TABLE ADD COLUMN。
   *
   * @param table - 业务表名
   * @param column - 待新增列名
   * @param definition - 列定义（类型 + 约束，如 'INTEGER NOT NULL DEFAULT 0'）
   */
  private ensureColumn(table: string, column: string, definition: string): void {
    const rows = this.db.query<{ name: string }>(`PRAGMA table_info(${table})`);
    const exists = rows.some((r) => r.name === column);
    if (!exists) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      logger.info(`Migration: added column ${table}.${column}`);
    }
  }
}
