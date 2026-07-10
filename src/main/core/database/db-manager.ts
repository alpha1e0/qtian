import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

import { BaseDBError } from '@/core/common/exceptions';

/**
 * Database Manager using better-sqlite3
 * Provides synchronous database operations
 */
export class DBManager {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;

    // Connect to database
    try {
      this.db = new Database(this.dbPath, { fileMustExist: false });
      this.db.pragma('journal_mode = WAL');
    } catch (err) {
      throw new BaseDBError(`Error connecting to database: ${err}`);
    }

    // Initialize database if not already initialized
    this.initializeDbIfNeeded();
  }

  /**
   * Execute a query and return results
   * @param sql - SQL query string
   * @param params - Query parameters
   * @returns Array of result rows
   */
  query<T = any>(sql: string, params?: any[]): T[] {
    try {
      const stmt = this.db.prepare(sql);
      return params ? (stmt.all(...params) as T[]) : (stmt.all() as T[]);
    } catch (err) {
      throw new BaseDBError(`Error executing query: ${err}`);
    }
  }

  /**
   * Execute a statement and return number of changes
   * @param sql - SQL statement
   * @param params - Statement parameters
   * @returns Number of rows affected
   */
  execute(sql: string, params?: any[]): number {
    try {
      const stmt = this.db.prepare(sql);
      const result = params ? stmt.run(...params) : stmt.run();
      return result.changes;
    } catch (err) {
      throw new BaseDBError(`Error executing statement: ${err}`);
    }
  }

  /**
   * 执行 SQL 脚本（可包含多条语句、注释、空行）
   *
   * better-sqlite3 的 `db.exec()` 专为初始化脚本设计，自动按 ';' 切分
   * 并跳过纯注释/空白片段。相比手工 split + prepare，可避免尾部纯注释
   * 片段触发 `RangeError: The supplied SQL string contains no statements`。
   *
   * 注意：exec 不支持参数绑定，仅用于 DDL/初始化脚本。
   *
   * @param sql - 完整 SQL 脚本
   */
  exec(sql: string): void {
    try {
      this.db.exec(sql);
    } catch (err) {
      throw new BaseDBError(`Error executing SQL script: ${err}`);
    }
  }

  /**
   * Execute an insert statement and return last rowid and changes
   * @param sql - SQL insert statement
   * @param params - Insert parameters
   * @returns Object with lastRowid and changes
   */
  insert(sql: string, params?: any[]): { lastRowid: number; changes: number } {
    try {
      const stmt = this.db.prepare(sql);
      const result = params ? stmt.run(...params) : stmt.run();
      return {
        lastRowid: result.lastInsertRowid as number,
        changes: result.changes,
      };
    } catch (err) {
      throw new BaseDBError(`Error executing statement: ${err}`);
    }
  }

  /**
   * Get a single row from query
   * @param sql - SQL query string
   * @param params - Query parameters
   * @returns Single row or undefined
   */
  get<T = any>(sql: string, params?: any[]): T | undefined {
    try {
      const stmt = this.db.prepare(sql);
      return params ? (stmt.get(...params) as T | undefined) : (stmt.get() as T | undefined);
    } catch (err) {
      throw new BaseDBError(`Error executing get: ${err}`);
    }
  }

  /**
   * Begin a transaction
   * @deprecated 不要使用：返回的事务闭包不会包裹任何写操作（fn 为空）。
   *              请改用 `transaction<T>(fn)`，在回调内执行所有写操作。
   */
  beginTransaction(): Database.Transaction {
    return this.db.transaction(() => {});
  }

  /**
   * 在事务中执行回调：自动 BEGIN / COMMIT / ROLLBACK。
   *
   * 用法：
   *   ```ts
   *   db.transaction(() => {
   *     db.execute('INSERT ...');
   *     searchService.syncFts(...);
   *   });
   *   ```
   *
   * 说明：better-sqlite3 的 `db.transaction(fn)` 返回一个**新函数**，
   *      调用该函数时才会真正进入事务；此处直接立即调用 (`()`)，
   *      让调用方按同步函数语义使用。
   *
   * @param fn - 事务内执行的回调（同步）
   * @returns fn 的返回值
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * 触发 WAL checkpoint（TRUNCATE 模式），将 -wal 日志合并回主 .db 文件。
   *
   * 用途：同步前调用，使 .db 文件成为单一时间源（stat mtime 可靠），
   *      避免 WAL 边界导致的时间判定问题。
   */
  checkpoint(): void {
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      throw new BaseDBError(`Error checkpointing database: ${err}`);
    }
  }

  /**
   * 使用 SQLite online backup API 将当前数据库备份到目标文件。
   *
   * 为什么不直接拷盘文件：WAL 模式下直接 copy .db 文件可能得到不一致快照
   * （未合并的 -wal / 并发写），必须用 better-sqlite3 的 `backup()` API
   * 保证一致性。这是需求 010 明确要求的。
   *
   * @param destPath - 备份目标文件完整路径（父目录需已存在）
   */
  async backupTo(destPath: string): Promise<void> {
    try {
      // 先 checkpoint 使主文件包含全部已提交事务
      this.checkpoint();
      // better-sqlite3 backup() 返回 BackupMetrics；接受文件路径重载
      await (this.db.backup(destPath) as Promise<unknown>);
    } catch (err) {
      throw new BaseDBError(`Error backing up database to '${destPath}': ${err}`);
    }
  }

  /**
   * 从源文件恢复数据库（覆盖当前 dbPath）。
   *
   * 实现策略（close → copy → reopen）：
   *   1. 关闭当前连接
   *   2. fs.copyFileSync 覆盖 dbPath
   *   3. 重新打开连接
   *   4. 恢复 WAL pragma
   *   5. 删除残留的 -wal / -shm 文件
   *
   * 为什么不用 backup() 反向：@types/better-sqlite3 的 backup() 仅声明文件路径重载
   * （index.d.ts:87），为类型安全与简单性，restore 走文件覆盖。
   * 在原 DBManager 实例上重赋值 this.db，下游 Service 持有的是 DBManager 引用，
   * 经由 TodoDb/NoteDb.getDBManager() 仍可用。
   *
   * 风险：关连接瞬间若有并发写会失败；同步仅手动触发且 better-sqlite3 同步语义，风险低。
   * 失败时 SyncResult.errors 记录且本地 meta 不推进，可重试。
   *
   * @param srcPath - 源备份文件完整路径
   */
  async restoreFrom(srcPath: string): Promise<void> {
    try {
      // 1. 关闭当前连接，释放文件锁
      this.db.close();

      // 2. 覆盖 dbPath
      fs.copyFileSync(srcPath, this.dbPath);

      // 3. 重新打开连接
      this.db = new Database(this.dbPath, { fileMustExist: false });

      // 4. 恢复 WAL pragma（与构造函数一致）
      this.db.pragma('journal_mode = WAL');

      // 5. 删除 restore 前残留的 -wal / -shm（已被新连接接管，清掉旧文件）
      const walPath = this.dbPath + '-wal';
      const shmPath = this.dbPath + '-shm';
      for (const sidecar of [walPath, shmPath]) {
        try {
          if (fs.existsSync(sidecar)) {
            fs.unlinkSync(sidecar);
          }
        } catch (err) {
          // sidecar 删除失败不阻断恢复（新连接已接管 WAL）
          // 用 path.basename 让日志更简洁
          // eslint-disable-next-line no-console
          console.warn(`[DBManager] Failed to remove sidecar ${path.basename(sidecar)}: ${err}`);
        }
      }
    } catch (err) {
      throw new BaseDBError(`Error restoring database from '${srcPath}': ${err}`);
    }
  }

  /**
   * Check if database has been initialized (has tables)
   */
  private isInitialized(): boolean {
    try {
      const result = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      ).get();
      return !!result;
    } catch (err) {
      return false;
    }
  }

  /**
   * Initialize database from SQL file if not already initialized
   */
  private initializeDbIfNeeded(sqlFile?: string): void {
    // Check if database is already initialized
    if (this.isInitialized()) {
      return; // Database already initialized
    }

    if (!sqlFile) {
      return;
    }

    try {
      const sqlScript = fs.readFileSync(sqlFile, 'utf-8');

      // Split and execute SQL statements
      const statements = sqlScript.split(';');
      for (const statement of statements) {
        const trimmed = statement.trim();
        if (trimmed) {
          this.db.exec(trimmed);
        }
      }
    } catch (err) {
      throw new BaseDBError(`Error initializing database: ${err}`);
    }
  }
}
