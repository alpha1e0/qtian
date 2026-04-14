import Database from 'better-sqlite3';
import * as fs from 'fs';

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
   */
  beginTransaction(): Database.Transaction {
    return this.db.transaction(() => {});
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
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
