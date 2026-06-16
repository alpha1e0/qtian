/**
 * Todo-app 测试用：通用内存 SQL 执行器（better-sqlite3 mock）
 *
 * 设计目标：
 * - 覆盖 todo-app 6 张表（todo_category / todo_list / todo_label / todo_item /
 *   todo_item_label / todo_document）的 INSERT/SELECT/UPDATE/DELETE
 * - 支持 WHERE（= ?/literal, IS NULL, IS NOT NULL, AND, IN (subquery)）、
 *   ORDER BY、JOIN（todo_item INNER JOIN todo_item_label）、COUNT、GROUP BY
 * - 支持 AUTOINCREMENT id
 *
 * 不追求通用 SQL 兼容，仅覆盖 Service 层实际使用的 SQL 模式。
 * 与 task-db.test.ts 的"表专用 mock"不同，这里采用"通用执行器"，
 * 因为 todo-app 跨表查询较多，通用方案更易维护。
 */

/** 表行存储：表名 -> 行数组（每行为对象） */
type TableStore = Map<string, any[]>;

/**
 * 创建 better-sqlite3 mock 工厂函数。
 * 每个实例拥有独立的表存储（不共享），保证测试隔离。
 */
export function createTodoMemDbFactory(): { default: any; Database: any } {
  class TodoMemDb {
    private tables: TableStore = new Map();
    private seqs: Map<string, number> = new Map();

    constructor(_filename?: string) {}

    pragma(_setting: string): void {
      // no-op
    }

    exec(_sql: string): void {
      // CREATE TABLE/INDEX/PRAGMA 幂等 no-op；表在首次 INSERT 时惰性创建
    }

    close(): void {
      // no-op
    }

    prepare(sql: string) {
      return {
        all: (...params: any[]) => this.execAll(sql, params),
        get: (...params: any[]) => {
          const rows = this.execAll(sql, params);
          return rows.length > 0 ? rows[0] : undefined;
        },
        run: (...params: any[]) => this.execRun(sql, params),
      };
    }

    // ------------------------------------------------------------------------

    /** 确保表存在（惰性创建） */
    private ensureTable(name: string): any[] {
      if (!this.tables.has(name)) {
        this.tables.set(name, []);
      }
      if (!this.seqs.has(name)) {
        this.seqs.set(name, 0);
      }
      return this.tables.get(name)!;
    }

    private execRun(
      sql: string,
      params: any[],
    ): { changes: number; lastInsertRowid: number | bigint } {
      const trimmed = sql.trim().replace(/\s+/g, ' ');

      // INSERT INTO table (cols) VALUES (?, ?, NULL, ...)
      const insMatch = trimmed.match(/^INSERT (?:OR IGNORE )?INTO (\w+) \(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
      if (insMatch) {
        const [, tableName, colsStr, valsStr] = insMatch;
        const cols = colsStr.split(',').map((c) => c.trim());
        const valTokens = this.splitByComma(valsStr);
        const rows = this.ensureTable(tableName);
        const seq = this.seqs.get(tableName)! + 1;
        this.seqs.set(tableName, seq);
        const row: Record<string, any> = { id: seq };
        let paramIdx = 0;
        cols.forEach((col, idx) => {
          const token = valTokens[idx]?.trim();
          if (token === '?') {
            row[col] = params[paramIdx];
            paramIdx += 1;
          } else if (/^NULL$/i.test(token)) {
            row[col] = null;
          } else if (/^'(.*)'$/.test(token)) {
            row[col] = token.slice(1, -1);
          } else if (/^-?\d+$/.test(token)) {
            row[col] = parseInt(token, 10);
          } else {
            row[col] = token;
          }
        });
        // OR IGNORE：若主键冲突则跳过（todo_item_label 多对多）
        const ignore = /^INSERT OR IGNORE/i.test(trimmed);
        if (ignore) {
          const exists = rows.some((r) => {
            // 复合主键 todo_item_label(todo_item_id, label_id)
            if (tableName === 'todo_item_label') {
              return r.todo_item_id === row.todo_item_id && r.label_id === row.label_id;
            }
            return r.id === row.id;
          });
          if (exists) {
            return { changes: 0, lastInsertRowid: 0 };
          }
        }
        rows.push(row);
        return { changes: 1, lastInsertRowid: seq };
      }

      // UPDATE table SET col=?, ... WHERE ...
      if (/^UPDATE (\w+) SET /i.test(trimmed)) {
        return { changes: this.applyUpdate(trimmed, params), lastInsertRowid: 0 };
      }

      // DELETE FROM table WHERE ...
      if (/^DELETE FROM (\w+)/i.test(trimmed)) {
        return { changes: this.applyDelete(trimmed, params), lastInsertRowid: 0 };
      }

      // CREATE / PRAGMA / DROP 等 DDL
      if (/^(CREATE|PRAGMA|DROP)/i.test(trimmed)) {
        return { changes: 0, lastInsertRowid: 0 };
      }

      return { changes: 0, lastInsertRowid: 0 };
    }

    private execAll(sql: string, params: any[]): Record<string, any>[] {
      const trimmed = sql.trim().replace(/\s+/g, ' ');

      // sqlite_master 初始化检查 → 返回空（DBManager.isInitialized 用）
      if (/FROM sqlite_master/i.test(trimmed)) {
        return [];
      }

      // SELECT ... 可能含 COUNT(*) AS xxx
      const isCount = /COUNT\(\*\)\s+AS\s+(\w+)/i.test(trimmed);

      // 解析 FROM（含 JOIN）
      const { primaryTable, joinInfo } = this.parseFrom(trimmed);

      if (!primaryTable) {
        return [];
      }

      // 收集候选行（应用 JOIN）
      let candidates: Record<string, any>[] = [];
      const tableRows = this.tables.get(primaryTable) ?? [];

      if (joinInfo) {
        // INNER JOIN：左表 a × 右表 b，ON 条件在合并前评估
        // onLeft 来自 FROM 表（左），onRight 来自 JOIN 表（右）
        const joinRows = this.tables.get(joinInfo.table) ?? [];
        for (const a of tableRows) {
          for (const b of joinRows) {
            if (a[joinInfo.onLeft] === b[joinInfo.onRight]) {
              // 左表优先：右表字段不覆盖左表同名字段
              candidates.push({ ...b, ...a });
            }
          }
        }
      } else {
        candidates = tableRows.map((r) => ({ ...r }));
      }

      // 解析 WHERE
      const whereClause = this.extractWhere(trimmed);
      const resolvedParams = [...params];
      const conditions = this.parseWhereConditions(whereClause, resolvedParams);
      candidates = candidates.filter((row) => this.matchConditions(row, conditions));

      // GROUP BY（用于 list_count 聚合）
      const groupMatch = trimmed.match(/GROUP BY (\w+)/i);
      if (groupMatch) {
        const groupCol = groupMatch[1];
        return this.applyGroupBy(candidates, groupCol, isCount);
      }

      // COUNT 聚合（无 GROUP BY）
      if (isCount && !groupMatch) {
        const cntCol = trimmed.match(/COUNT\(\*\)\s+AS\s+(\w+)/i)![1];
        return [{ [cntCol]: candidates.length }];
      }

      // 投影列（SELECT * 或显式列）
      const projected = this.applyProjection(candidates, trimmed);

      // ORDER BY
      const ordered = this.applyOrderBy(projected, trimmed);

      return ordered;
    }

    // ------------------------------------------------------------------------
    // 解析辅助
    // ------------------------------------------------------------------------

    /** 去掉列名表别名前缀：t.id → id */
    private stripAlias(col: string): string {
      const idx = col.indexOf('.');
      return idx >= 0 ? col.slice(idx + 1) : col;
    }

    /** 解析 FROM + JOIN */
    private parseFrom(
      sql: string,
    ): { primaryTable: string | null; joinInfo: JoinInfo | null } {
      // FROM table [AS alias] 或 FROM table t
      // JOIN table [AS alias] ON a.col = b.col
      const fromMatch = sql.match(/\bFROM (\w+)(?:\s+(?:AS\s+)?(\w+))?/i);
      if (!fromMatch) {
        return { primaryTable: null, joinInfo: null };
      }
      const primaryTable = fromMatch[1];

      const joinMatch = sql.match(
        /\bINNER JOIN (\w+)(?:\s+(?:AS\s+)?(\w+))?\s+ON\s+([\w.]+)\s*=\s*([\w.]+)/i,
      );
      if (!joinMatch) {
        return { primaryTable, joinInfo: null };
      }
      return {
        primaryTable,
        joinInfo: {
          table: joinMatch[1],
          onLeft: this.stripAlias(joinMatch[3]),
          onRight: this.stripAlias(joinMatch[4]),
        },
      };
    }

    /** 提取 WHERE 子句字符串（到 ORDER BY / GROUP BY / LIMIT / 末尾前） */
    private extractWhere(sql: string): string {
      const m = sql.match(/\bWHERE (.+?)(?:\bORDER BY\b|\bGROUP BY\b|\bLIMIT\b|$)/i);
      return m ? m[1].trim() : '';
    }

    /**
     * 解析 WHERE 条件为结构化条件数组。
     * 同时消费 ? 参数（从 resolvedParams 末尾取，因为是 get/all 的 params）。
     *
     * 注意：better-sqlite3 的 params 按位置传入，WHERE 中的 ? 与 SET 中的 ?
     * 共享同一 params 数组（SET 在前，WHERE 在后）。本方法仅解析 WHERE 部分，
     * 参数位置由调用方传入已偏移的 params。
     *
     * 为简化实现，这里用正则识别条件类型而非精确游标。
     */
    private parseWhereConditions(
      whereStr: string,
      params: any[],
    ): WhereCondition[] {
      if (!whereStr) return [];
      // 按 AND 拆分（忽略 IN (...) 内的逗号）
      const parts = this.splitByAnd(whereStr);
      const conditions: WhereCondition[] = [];
      let paramCursor = 0;

      for (const partRaw of parts) {
        const part = partRaw.trim();
        if (part.length === 0) continue;

        // col IN (SELECT id FROM ... WHERE ...) — 子查询
        const inSubMatch = part.match(/^([\w.]+)\s+IN\s*\(\s*SELECT\b/i);
        if (inSubMatch) {
          const colMatch = part.match(/^([\w.]+)\s+IN\s*\((.+)\)$/i);
          if (colMatch) {
            const col = this.stripAlias(colMatch[1]);
            const subSql = colMatch[2];
            const subIds = this.evalSubquery(subSql, params, paramCursor);
            conditions.push({ type: 'in', col, values: subIds.ids, paramConsumed: subIds.consumed });
            paramCursor += subIds.consumed;
          }
          continue;
        }

        // col IN (1, 2, 3) — 字面量数字列表（collectSubtreeIds 拼接）
        const inListMatch = part.match(/^([\w.]+)\s+IN\s*\(([^()]+)\)/i);
        if (inListMatch) {
          const col = this.stripAlias(inListMatch[1]);
          const items = inListMatch[2].split(',').map((s) => s.trim());
          const values = items.map((s) => {
            if (/^-?\d+$/.test(s)) return parseInt(s, 10);
            if (/^'(.*)'$/.test(s)) return s.slice(1, -1);
            return s;
          });
          conditions.push({ type: 'in', col, values, paramConsumed: 0 });
          continue;
        }

        // col IS NULL
        const isNullMatch = part.match(/^([\w.]+)\s+IS\s+NULL$/i);
        if (isNullMatch) {
          conditions.push({ type: 'is_null', col: this.stripAlias(isNullMatch[1]) });
          continue;
        }

        // col IS NOT NULL
        const isNotNullMatch = part.match(/^([\w.]+)\s+IS\s+NOT\s+NULL$/i);
        if (isNotNullMatch) {
          conditions.push({ type: 'is_not_null', col: this.stripAlias(isNotNullMatch[1]) });
          continue;
        }

        // col = ? (参数)
        const paramEq = part.match(/^([\w.]+)\s*=\s*\?$/);
        if (paramEq) {
          const val = params[paramCursor];
          paramCursor += 1;
          conditions.push({ type: 'eq', col: this.stripAlias(paramEq[1]), value: val });
          continue;
        }

        // col = 'literal'
        const litEq = part.match(/^([\w.]+)\s*=\s*'([^']*)'$/);
        if (litEq) {
          conditions.push({ type: 'eq', col: this.stripAlias(litEq[1]), value: litEq[2] });
          continue;
        }

        // col = number (无引号字面量)
        const numEq = part.match(/^([\w.]+)\s*=\s*(\d+)$/);
        if (numEq) {
          conditions.push({ type: 'eq', col: this.stripAlias(numEq[1]), value: parseInt(numEq[2], 10) });
          continue;
        }

        // 忽略无法识别的条件（如 BETWEEN 等未使用模式）
      }
      return conditions;
    }

    /** 评估子查询：SELECT id FROM table WHERE ... — 返回 id 集合与消费的参数数 */
    private evalSubquery(
      subSql: string,
      params: any[],
      paramOffset: number,
    ): { ids: any[]; consumed: number } {
      const trimmed = subSql.trim().replace(/\s+/g, ' ');
      const tableMatch = trimmed.match(/^SELECT\s+[\w.*]+\s+FROM\s+(\w+)/i);
      if (!tableMatch) {
        return { ids: [], consumed: 0 };
      }
      const tableName = tableMatch[1];
      const rows = this.tables.get(tableName) ?? [];
      const whereStr = this.extractWhere(trimmed);
      // 子查询参数从主 params 的 paramOffset 开始
      const subParams = params.slice(paramOffset);
      const consumed = (whereStr.match(/\?/g) || []).length;
      const conditions = this.parseWhereConditions(whereStr, subParams);
      const matched = rows.filter((row) => this.matchConditions(row, conditions));
      return { ids: matched.map((r) => r.id), consumed };
    }

    /** 判断行是否满足全部条件 */
    private matchConditions(row: Record<string, any>, conditions: WhereCondition[]): boolean {
      for (const cond of conditions) {
        const actual = row[cond.col];
        switch (cond.type) {
          case 'eq':
            if (actual !== cond.value) return false;
            break;
          case 'is_null':
            if (actual !== null && actual !== undefined) return false;
            break;
          case 'is_not_null':
            if (actual === null || actual === undefined) return false;
            break;
          case 'in': {
            const vals = cond.values ?? [];
            if (!vals.includes(actual)) return false;
            break;
          }
        }
      }
      return true;
    }

    /** 按 AND 拆分（忽略括号内的内容） */
    private splitByAnd(str: string): string[] {
      const parts: string[] = [];
      let depth = 0;
      let current = '';
      let i = 0;
      while (i < str.length) {
        const ch = str[i];
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
        if (depth === 0 && str.substring(i, i + 5).match(/\sAND\s/i)) {
          parts.push(current);
          current = '';
          i += 5;
          continue;
        }
        current += ch;
        i += 1;
      }
      if (current.trim().length > 0) parts.push(current);
      return parts;
    }

    /** 应用投影（SELECT 列表 → 仅保留指定列；SELECT * → 全列） */
    private applyProjection(rows: Record<string, any>[], sql: string): Record<string, any>[] {
      const selectMatch = sql.match(/^SELECT (.+?)\s+FROM/i);
      if (!selectMatch) return rows;
      const colList = selectMatch[1].trim();
      if (colList === '*') return rows;
      // 解析显式列（可能带别名前缀 t.col 或聚合 COUNT）
      if (/COUNT\(/i.test(colList)) return rows;
      const cols = colList.split(',').map((c) => this.stripAlias(c.trim()));
      return rows.map((row) => {
        const out: Record<string, any> = {};
        for (const c of cols) {
          out[c] = row[c];
        }
        return out;
      });
    }

    /** 应用 ORDER BY col [ASC|DESC] */
    private applyOrderBy(rows: Record<string, any>[], sql: string): Record<string, any>[] {
      const orderMatch = sql.match(/ORDER BY ([\w.]+)(?:\s+(ASC|DESC))?/i);
      if (!orderMatch) return rows;
      const col = this.stripAlias(orderMatch[1]);
      const dir = (orderMatch[2] || 'ASC').toUpperCase();
      const sorted = [...rows].sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        if (typeof av === 'number' && typeof bv === 'number') {
          return dir === 'DESC' ? bv - av : av - bv;
        }
        return dir === 'DESC'
          ? String(bv).localeCompare(String(av))
          : String(av).localeCompare(String(bv));
      });
      return sorted;
    }

    /** 应用 GROUP BY + COUNT 聚合 */
    private applyGroupBy(
      rows: Record<string, any>[],
      groupCol: string,
      isCount: boolean,
    ): Record<string, any>[] {
      const groups = new Map<any, any[]>();
      for (const r of rows) {
        const key = r[groupCol];
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
      }
      const cntColMatch = 'cnt';
      const result: Record<string, any>[] = [];
      for (const [key, members] of groups.entries()) {
        result.push({ [groupCol]: key, [cntColMatch]: members.length });
      }
      return isCount ? result : result;
    }

    // ------------------------------------------------------------------------
    // UPDATE / DELETE
    // ------------------------------------------------------------------------

    private applyUpdate(sql: string, params: any[]): number {
      const m = sql.match(/^UPDATE (\w+) SET (.+?)\s+WHERE\s+(.+)$/i);
      if (!m) {
        // 无 WHERE 的 UPDATE（不应出现在 service 中，兜底）
        const m2 = sql.match(/^UPDATE (\w+) SET (.+)$/i);
        if (!m2) return 0;
        return 0;
      }
      const [, tableName, setStr, whereStr] = m;
      const rows = this.tables.get(tableName) ?? [];

      // 解析 SET（注意 SET 在前、WHERE 在后的参数顺序）
      const setParts = this.splitByComma(setStr);
      const assignments: Array<{ col: string; value: any }> = [];
      let cursor = 0;
      for (const part of setParts) {
        const pm = part.match(/^([\w.]+)\s*=\s*\?$/);
        if (pm) {
          assignments.push({ col: this.stripAlias(pm[1]), value: params[cursor] });
          cursor += 1;
          continue;
        }
        // col = 'literal'
        const lm = part.match(/^([\w.]+)\s*=\s*'([^']*)'$/);
        if (lm) {
          assignments.push({ col: this.stripAlias(lm[1]), value: lm[2] });
          continue;
        }
        // col = NULL
        const nm = part.match(/^([\w.]+)\s*=\s*NULL$/i);
        if (nm) {
          assignments.push({ col: this.stripAlias(nm[1]), value: null });
          continue;
        }
        // col = number
        const numm = part.match(/^([\w.]+)\s*=\s*(\d+)$/);
        if (numm) {
          assignments.push({ col: this.stripAlias(numm[1]), value: parseInt(numm[2], 10) });
          continue;
        }
      }

      // WHERE 参数从 cursor 开始
      const whereParams = params.slice(cursor);
      const conditions = this.parseWhereConditions(whereStr, whereParams);

      let changes = 0;
      for (const row of rows) {
        if (this.matchConditions(row, conditions)) {
          for (const a of assignments) {
            row[a.col] = a.value;
          }
          changes += 1;
        }
      }
      return changes;
    }

    private applyDelete(sql: string, params: any[]): number {
      const m = sql.match(/^DELETE FROM (\w+)(?:\s+WHERE\s+(.+))?$/i);
      if (!m) return 0;
      const [, tableName, whereStr] = m;
      const rows = this.tables.get(tableName) ?? [];
      if (!whereStr) {
        const cnt = rows.length;
        rows.length = 0;
        return cnt;
      }
      const conditions = this.parseWhereConditions(whereStr, params);
      const before = rows.length;
      const remaining = rows.filter((row) => !this.matchConditions(row, conditions));
      const removed = before - remaining.length;
      // 替换数组内容（保持引用）
      rows.length = 0;
      rows.push(...remaining);
      return removed;
    }

    /** 按逗号拆分（忽略括号内逗号） */
    private splitByComma(str: string): string[] {
      const parts: string[] = [];
      let depth = 0;
      let current = '';
      for (const ch of str) {
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
        if (ch === ',' && depth === 0) {
          parts.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      if (current.trim().length > 0) parts.push(current.trim());
      return parts;
    }
  }

  return { default: TodoMemDb, Database: TodoMemDb };
}

// ============================================================================
// 类型
// ============================================================================

interface JoinInfo {
  table: string;
  onLeft: string;
  onRight: string;
}

type WhereCondition =
  | { type: 'eq'; col: string; value: any }
  | { type: 'is_null'; col: string }
  | { type: 'is_not_null'; col: string }
  | { type: 'in'; col: string; values: any[]; paramConsumed: number };
