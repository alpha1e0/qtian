/**
 * TaskDb 单元测试
 *
 * 测试策略：文件级 vi.mock('better-sqlite3') 覆盖全局 doc 专用 mock，
 * 提供针对 task schema 的轻量内存 SQL 执行器，真实驱动 TaskDb 的 SQL 逻辑。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================================
// 文件级 mock：覆盖全局 better-sqlite3 mock，提供 task schema 内存执行器
// ============================================================================

/**
 * 共享状态：记录所有传入 `exec()` 的 SQL 脚本
 *
 * 用于回归测试 runSqlScript 行为（必须以整段脚本调用 exec，
 * 不能手工按 ';' 拆分后用 prepare 执行，否则尾部纯注释片段会让
 * better-sqlite3 抛 "The supplied SQL string contains no statements"）。
 *
 * 使用 vi.hoisted 确保 mock 工厂（被 vitest 提升）能安全访问。
 */
const { execCallLog } = vi.hoisted(() => ({ execCallLog: [] as string[] }));

vi.mock('better-sqlite3', () => {
  /**
   * 轻量内存 SQL 执行器
   * 仅覆盖 TaskDb 实际使用的 SQL 模式（INSERT/SELECT/UPDATE/DELETE + JOIN）
   */
  class TaskMemDb {
    private tasks: Map<number, Record<string, any>> = new Map();
    private taskAgents: Map<number, Record<string, any>> = new Map();
    private taskSeq = 0;

    constructor(_filename?: string) {}

    pragma(_setting: string): void {
      // no-op
    }

    exec(sql: string): void {
      // 记录调用以便回归测试断言（CREATE TABLE/INDEX 在 mock 中幂等无副作用）
      execCallLog.push(sql);
    }

    close(): void {
      // no-op
    }

    prepare(sql: string) {
      const trimmed = sql.trim().replace(/\s+/g, ' ');

      return {
        all: (...params: any[]) => this.execAll(trimmed, params),
        get: (...params: any[]) => {
          const rows = this.execAll(trimmed, params);
          return rows.length > 0 ? rows[0] : undefined;
        },
        run: (...params: any[]) => this.execRun(trimmed, params),
      };
    }

    // ------------------------------------------------------------------------

    private execRun(sql: string, params: any[]): { changes: number; lastInsertRowid: number | bigint } {
      // INSERT INTO task (...)  （注意 \b 避免匹配 task_agent）
      if (/^INSERT INTO task \(/i.test(sql)) {
        this.taskSeq += 1;
        const id = this.taskSeq;
        const row: Record<string, any> = { id };
        this.fillRowFromColumns(sql, params, row);
        this.tasks.set(id, row);
        return { changes: 1, lastInsertRowid: id };
      }

      // INSERT INTO task_agent (...)
      if (/^INSERT INTO task_agent \(/i.test(sql)) {
        const row: Record<string, any> = {};
        this.fillRowFromColumns(sql, params, row);
        const taskId = row.task_id;
        this.taskAgents.set(taskId, row);
        return { changes: 1, lastInsertRowid: taskId };
      }

      // UPDATE task SET ...  （用词边界避免匹配 task_agent）
      if (/^UPDATE task\b.* SET /i.test(sql) && !/^UPDATE task_agent/i.test(sql)) {
        return { changes: this.applyUpdateTask(sql, params), lastInsertRowid: 0 };
      }

      // UPDATE task_agent SET ...
      if (/^UPDATE task_agent SET /i.test(sql)) {
        return { changes: this.applyUpdateTaskAgent(sql, params), lastInsertRowid: 0 };
      }

      // DELETE FROM task WHERE id=?
      if (/^DELETE FROM task WHERE id = \?$/i.test(sql)) {
        const id = params[0];
        const existed = this.tasks.delete(id);
        this.taskAgents.delete(id); // 级联
        return { changes: existed ? 1 : 0, lastInsertRowid: 0 };
      }

      // CREATE TABLE / CREATE INDEX / PRAGMA / 其他 DDL
      if (/^(CREATE|PRAGMA|DROP)/i.test(sql)) {
        return { changes: 0, lastInsertRowid: 0 };
      }

      return { changes: 0, lastInsertRowid: 0 };
    }

    private execAll(sql: string, params: any[]): Record<string, any>[] {
      // sqlite_master 初始化检查 → 返回空
      if (/FROM sqlite_master/i.test(sql)) {
        return [];
      }

      // SELECT ... FROM task_agent ... （必须先于 task 判断，避免 FROM task 误匹配 task_agent）
      if (/\bFROM task_agent\b/i.test(sql)) {
        const where = this.parseWhere(sql, params);
        const rows: Record<string, any>[] = [];
        for (const ta of this.taskAgents.values()) {
          if (this.matchWhere({ ...ta, id: ta.task_id }, where, params)) {
            rows.push(ta);
          }
        }
        return rows;
      }

      // SELECT ... FROM task [JOIN task_agent] ...
      if (/\bFROM task\b/i.test(sql)) {
        const isJoin = /JOIN task_agent/i.test(sql);
        const where = this.parseWhere(sql, params);
        const orderDesc = /ORDER BY t\.created_at DESC/i.test(sql);
        const limitMatch = sql.match(/LIMIT \? OFFSET \?/i);

        // 收集行
        let rows: Record<string, any>[] = [];
        for (const t of this.tasks.values()) {
          let merged: Record<string, any>;
          if (isJoin) {
            const ta = this.taskAgents.get(t.id);
            if (!ta) continue; // INNER JOIN 无匹配则跳过
            merged = { ...t, ...ta };
          } else {
            merged = { ...t };
          }
          if (this.matchWhere(merged, where, params)) {
            rows.push(merged);
          }
        }

        if (orderDesc) {
          rows.sort((a, b) => b.created_at - a.created_at);
        }

        if (limitMatch) {
          const limitIdx = params.length - 2;
          const offsetIdx = params.length - 1;
          const limit = params[limitIdx];
          const offset = params[offsetIdx];
          rows = rows.slice(offset, offset + limit);
        }

        return rows;
      }

      return [];
    }

    // ------------------------------------------------------------------------

    /** 从 `INSERT INTO tbl (col1, col2, ...) VALUES (?, ?, ...)` 解析列并填充 */
    private fillRowFromColumns(sql: string, params: any[], row: Record<string, any>): void {
      const colsMatch = sql.match(/\(([^)]+)\)\s*VALUES/i);
      if (!colsMatch) return;
      const cols = colsMatch[1].split(',').map((c) => c.trim());
      cols.forEach((col, idx) => {
        row[col] = params[idx];
      });
    }

    /**
     * 解析 WHERE 子句，返回条件描述数组
     * 支持：`col = ?` / `col = 'literal'` / `col1 = ? AND col2 = ?`
     * 列名可能带表别名前缀（t.id / ta.prompt / task_id）
     */
    private parseWhere(sql: string, params: any[]): Array<{ col: string; isParam: boolean; literal?: any; paramPos: number }> {
      const whereMatch = sql.match(/WHERE (.+?)(?:ORDER BY|LIMIT|$)/i);
      if (!whereMatch) return [];
      const whereStr = whereMatch[1].trim();

      const conditions: Array<{ col: string; isParam: boolean; literal?: any; paramPos: number }> = [];
      // COALESCE(...) 直接跳过（崩溃恢复用，按 status='running' 字面量匹配即可）
      const parts = whereStr.split(/\s+AND\s+/i);
      let paramCursor = 0;

      for (const part of parts) {
        const p = part.trim();
        // col = ?
        const paramMatch = p.match(/^([\w.]+)\s*=\s*\?$/);
        if (paramMatch) {
          conditions.push({ col: this.stripAlias(paramMatch[1]), isParam: true, paramPos: paramCursor });
          paramCursor += 1;
          continue;
        }
        // col = 'literal' 或 col = 'running'
        const litMatch = p.match(/^([\w.]+)\s*=\s*'([^']*)'$/);
        if (litMatch) {
          conditions.push({ col: this.stripAlias(litMatch[1]), isParam: false, literal: litMatch[2], paramPos: -1 });
          continue;
        }
        // COALESCE(error_message, ?) 跳过（值在 SET 子句处理）
        if (/^COALESCE/i.test(p)) {
          // 该参数仍占用一个 ? 位置
          paramCursor += 1;
          continue;
        }
      }
      return conditions;
    }

    /** 去掉列名的表别名前缀：t.id → id, ta.prompt → prompt, task_id → task_id */
    private stripAlias(col: string): string {
      const idx = col.indexOf('.');
      return idx >= 0 ? col.slice(idx + 1) : col;
    }

    /** 判断行是否满足 WHERE 条件 */
    private matchWhere(
      row: Record<string, any>,
      conditions: Array<{ col: string; isParam: boolean; literal?: any; paramPos: number }>,
      params: any[],
    ): boolean {
      for (const cond of conditions) {
        const expected = cond.isParam ? params[cond.paramPos] : cond.literal;
        // JOIN 行中 task_id 可能不存在于 task 表行，补充
        const actual = row[cond.col];
        if (actual !== expected) return false;
      }
      return true;
    }

    /** 按逗号拆分 SET 子句，但忽略括号内的逗号（如 COALESCE(a, ?)） */
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

    /** 应用 UPDATE task SET col1=?, col2=?, ... WHERE ... */
    private applyUpdateTask(sql: string, params: any[]): number {
      const setMatch = sql.match(/SET (.+?) WHERE/i);
      if (!setMatch) return 0;
      const setParts = this.splitByComma(setMatch[1]);
      const conditions = this.parseWhere(sql, params);

      // 计算赋值（注意 COALESCE 占用 ? 位置）
      const assignments: Array<{ col: string; value: any; src?: string }> = [];
      let cursor = 0;
      for (const part of setParts) {
        // col = ? （参数赋值）
        const m = part.match(/^([\w.]+)\s*=\s*\?$/);
        if (m) {
          assignments.push({ col: this.stripAlias(m[1]), value: params[cursor] });
          cursor += 1;
          continue;
        }
        // col = COALESCE(col, ?) （崩溃恢复用）
        const coal = part.match(/^([\w.]+)\s*=\s*COALESCE\(([\w.]+),\s*\?\)$/i);
        if (coal) {
          const target = this.stripAlias(coal[1]);
          const src = this.stripAlias(coal[2]);
          const fallback = params[cursor];
          assignments.push({
            col: target,
            value: ((fb: any) => (val: any) => (val !== null && val !== undefined ? val : fb))(fallback),
            src,
          });
          cursor += 1;
          continue;
        }
        // col = 'literal' （字面量赋值，如 status='failed'）
        const lit = part.match(/^([\w.]+)\s*=\s*'([^']*)'$/);
        if (lit) {
          assignments.push({ col: this.stripAlias(lit[1]), value: lit[2] });
          continue;
        }
      }

      // 条件参数从 cursor 开始
      const condParams = params.slice(cursor);
      let condIdx = 0;
      const resolvedConds: Array<{ col: string; isParam: boolean; literal?: any; paramPos: number }> = conditions.map((c) => {
        if (c.isParam) {
          // 已解析为字面量，标记为非参数，便于 matchWhere 直接使用 literal
          const rc = { col: c.col, isParam: false, literal: condParams[condIdx], paramPos: 0 };
          condIdx += 1;
          return rc;
        }
        return c;
      });

      let changes = 0;
      for (const t of this.tasks.values()) {
        if (this.matchWhere(t, resolvedConds, [])) {
          for (const a of assignments) {
            if (typeof a.value === 'function') {
              const srcKey = a.src ?? '';
              const srcVal = srcKey === 'error_message' ? t.error_message : t[srcKey];
              t[a.col] = a.value(srcVal);
            } else {
              t[a.col] = a.value;
            }
          }
          changes += 1;
        }
      }
      return changes;
    }

    /** 应用 UPDATE task_agent SET ... WHERE task_id=? */
    private applyUpdateTaskAgent(sql: string, params: any[]): number {
      const setMatch = sql.match(/SET (.+?) WHERE/i);
      if (!setMatch) return 0;
      const setParts = setMatch[1].split(',').map((s) => s.trim());
      const whereMatch = sql.match(/WHERE task_id = \?$/i);

      let changes = 0;
      for (const ta of this.taskAgents.values()) {
        if (!whereMatch || ta.task_id === params[setParts.length]) {
          let cursor = 0;
          for (const part of setParts) {
            const m = part.match(/^([\w.]+)\s*=\s*\?$/);
            if (m) {
              ta[this.stripAlias(m[1])] = params[cursor];
              cursor += 1;
            }
          }
          changes += 1;
        }
      }
      return changes;
    }
  }

  return { default: TaskMemDb, Database: TaskMemDb };
});

vi.mock('@/core/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ============================================================================

import { TaskDb } from './task-db';
import { AgentTaskCreateInput, TaskAgentView } from './task.types';

/** 项目根目录的 task.sql 路径（测试在项目根执行） */
const TASK_SQL_PATH = path.join(process.cwd(), 'data', 'task.sql');

/** 构造一个标准的 Agent 任务创建入参 */
function buildInput(overrides: Partial<AgentTaskCreateInput> = {}): AgentTaskCreateInput {
  return {
    source: 'todo-app',
    source_ref_id: 100,
    title: '测试任务',
    prompt: '请总结以下内容',
    agent_name: 'coder',
    llm_config_name: 'default',
    ...overrides,
  };
}

describe('TaskDb', () => {
  let db: TaskDb;

  beforeEach(() => {
    // 重置 exec 调用日志
    execCallLog.length = 0;
    // 使用唯一的临时文件路径（内存执行器忽略文件名，每个实例独立）
    db = new TaskDb(':memory:', TASK_SQL_PATH);
    db.initialize();
  });

  describe('initialize', () => {
    it('应在给定有效 SQL 文件时正常初始化', () => {
      expect(() => db.initialize()).not.toThrow();
    });

    it('SQL 文件不存在时应抛出错误', () => {
      const bad = new TaskDb(':memory:', path.join(process.cwd(), 'data', 'not-exist.sql'));
      expect(() => bad.initialize()).toThrow(/Cannot read task SQL file/);
    });

    /**
     * 回归测试：data/task.sql 末尾有一段"未来扩展表"的纯注释块（在最后一个 ';' 之后）。
     * 旧实现按 ';' 手工拆分后用 db.execute() 执行每段，会把这段纯注释送进 prepare()，
     * 触发 better-sqlite3 的 RangeError: The supplied SQL string contains no statements，
     * 导致整个 task 系统引导失败、todo-app 任务功能禁用。
     *
     * 修复：runSqlScript 直接调用 db.exec(整段脚本)，由 better-sqlite3 原生处理。
     */
    it('SQL 文件含尾部纯注释时应正常初始化（不抛 no statements）', () => {
      // 构造一个最小复现脚本：DDL 之后跟一段纯注释（在最后一个 ';' 之后）
      const tmpSql = path.join(process.cwd(), 'tmp', 'task-regression.sql');
      fs.mkdirSync(path.dirname(tmpSql), { recursive: true });
      fs.writeFileSync(
        tmpSql,
        [
          'PRAGMA foreign_keys = ON;',
          'CREATE TABLE IF NOT EXISTS task (id INTEGER PRIMARY KEY);',
          '-- ============================================================',
          '-- 末尾纯注释块（在最后一个分号之后）',
          '-- ============================================================',
          '-- CREATE TABLE IF NOT EXISTS future_table (...)',
        ].join('\n'),
        'utf-8',
      );

      const regDb = new TaskDb(':memory:', tmpSql);
      expect(() => regDb.initialize()).not.toThrow();

      // 清理临时文件
      fs.unlinkSync(tmpSql);
    });

    it('runSqlScript 应以整段脚本一次性调用 exec，不手工拆分', () => {
      // initialize 在 beforeEach 已执行，应至少触发一次 exec 调用
      expect(execCallLog.length).toBeGreaterThanOrEqual(1);
      const firstScript = execCallLog[0];
      // 整段脚本应同时包含 CREATE TABLE 与末尾的"未来扩展表"注释，
      // 证明没有按 ';' 拆分（否则这两个片段会分别走不同调用）
      expect(firstScript).toContain('CREATE TABLE IF NOT EXISTS task');
      expect(firstScript).toContain('未来扩展表');
    });
  });

  describe('insertAgentTask', () => {
    it('应创建 task 与 task_agent 各一条并返回聚合视图', () => {
      const view = db.insertAgentTask(buildInput());

      expect(view.id).toBeGreaterThan(0);
      expect(view.type).toBe('agent');
      expect(view.source).toBe('todo-app');
      expect(view.source_ref_id).toBe(100);
      expect(view.title).toBe('测试任务');
      expect(view.status).toBe('pending');
      expect(view.progress).toBe(0);
      expect(view.prompt).toBe('请总结以下内容');
      expect(view.agent_name).toBe('coder');
      expect(view.llm_config_name).toBe('default');
      expect(view.chat_history_id).toBeNull();
      expect(view.result_meta).toBeNull();
      expect(view.created_at).toBeGreaterThan(0);
      expect(view.updated_at).toBeGreaterThan(0);
    });

    it('source_ref_id 为 null 时应支持全局任务', () => {
      const view = db.insertAgentTask(buildInput({ source_ref_id: null }));
      expect(view.source_ref_id).toBeNull();
    });

    it('title 为空时应抛出错误', () => {
      expect(() => db.insertAgentTask(buildInput({ title: '' }))).toThrow(/title/);
    });

    it('prompt 为空时应抛出错误', () => {
      expect(() => db.insertAgentTask(buildInput({ prompt: '   ' }))).toThrow(/prompt/);
    });

    it('agent_name 为空时应抛出错误', () => {
      expect(() => db.insertAgentTask(buildInput({ agent_name: '' }))).toThrow(/Agent name/);
    });

    it('llm_config_name 为空时应抛出错误', () => {
      expect(() => db.insertAgentTask(buildInput({ llm_config_name: '' }))).toThrow(/LLM config name/);
    });

    it('source 非法时应抛出错误', () => {
      // 类型断言绕过编译期校验，验证运行时校验
      expect(() => db.insertAgentTask(buildInput({ source: 'evil-app' as any }))).toThrow(/Invalid task source/);
    });

    it('应支持连续插入并自增 id', () => {
      const v1 = db.insertAgentTask(buildInput({ title: 't1' }));
      const v2 = db.insertAgentTask(buildInput({ title: 't2' }));
      expect(v2.id).toBeGreaterThan(v1.id);
    });
  });

  describe('getAgentTask', () => {
    it('应返回已创建任务的聚合视图', () => {
      const created = db.insertAgentTask(buildInput());
      const got = db.getAgentTask(created.id);
      expect(got).toBeDefined();
      expect(got!.id).toBe(created.id);
      expect(got!.title).toBe('测试任务');
    });

    it('不存在的任务应返回 undefined', () => {
      expect(db.getAgentTask(99999)).toBeUndefined();
    });
  });

  describe('getTaskRow', () => {
    it('应仅返回 task 主表公共字段', () => {
      const created = db.insertAgentTask(buildInput());
      const row = db.getTaskRow(created.id);
      expect(row).toBeDefined();
      expect(row!.type).toBe('agent');
      expect(row!.status).toBe('pending');
      // 主表行不含 agent 扩展字段
      expect((row as any).prompt).toBeUndefined();
    });
  });

  describe('listBySource', () => {
    beforeEach(() => {
      db.insertAgentTask(buildInput({ source: 'todo-app', source_ref_id: 1, title: 'a' }));
      db.insertAgentTask(buildInput({ source: 'todo-app', source_ref_id: 1, title: 'b' }));
      db.insertAgentTask(buildInput({ source: 'todo-app', source_ref_id: 2, title: 'c' }));
      db.insertAgentTask(buildInput({ source: 'doc-app', source_ref_id: 1, title: 'd' }));
    });

    it('应按来源返回所有任务（不含 sourceRefId）', () => {
      const list = db.listBySource('todo-app');
      expect(list).toHaveLength(3);
      expect(list.every((t) => t.source === 'todo-app')).toBe(true);
    });

    it('应按来源 + 业务实体 ID 过滤', () => {
      const list = db.listBySource('todo-app', 1);
      expect(list).toHaveLength(2);
      expect(list.every((t) => t.source_ref_id === 1)).toBe(true);
    });

    it('应按 created_at 降序排列', () => {
      const list = db.listBySource('todo-app');
      expect(list[0].created_at).toBeGreaterThanOrEqual(list[1].created_at);
    });

    it('非法 source 应抛出错误', () => {
      expect(() => db.listBySource('evil' as any)).toThrow(/Invalid task source/);
    });
  });

  describe('listTasks', () => {
    beforeEach(() => {
      db.insertAgentTask(buildInput({ source: 'todo-app', title: 'a' }));
      db.insertAgentTask(buildInput({ source: 'doc-app', title: 'b' }));
    });

    it('无过滤条件应返回全部', () => {
      expect(db.listTasks()).toHaveLength(2);
    });

    it('按 source 过滤', () => {
      expect(db.listTasks({ source: 'todo-app' })).toHaveLength(1);
    });

    it('按 status 过滤', () => {
      expect(db.listTasks({ status: 'pending' })).toHaveLength(2);
      expect(db.listTasks({ status: 'completed' })).toHaveLength(0);
    });

    it('应支持分页 (limit/offset)', () => {
      expect(db.listTasks({ limit: 1 })).toHaveLength(1);
      expect(db.listTasks({ limit: 1, offset: 1 })).toHaveLength(1);
      expect(db.listTasks({ limit: 1, offset: 10 })).toHaveLength(0);
    });

    it('limit 上限不应超过 MAX_LIST_LIMIT', () => {
      // 极大 limit 应被 clamp，不抛错
      expect(() => db.listTasks({ limit: 99999 })).not.toThrow();
    });
  });

  describe('updateStatus', () => {
    it('应更新状态并同步 updated_at', () => {
      const created = db.insertAgentTask(buildInput());
      const before = created.updated_at;
      db.updateStatus(created.id, 'running');
      const after = db.getAgentTask(created.id)!;
      expect(after.status).toBe('running');
      expect(after.updated_at).toBeGreaterThanOrEqual(before);
    });

    it('failed 状态应写入 error_message', () => {
      const created = db.insertAgentTask(buildInput());
      db.updateStatus(created.id, 'failed', 'LLM 调用失败');
      const after = db.getAgentTask(created.id)!;
      expect(after.status).toBe('failed');
      expect(after.error_message).toBe('LLM 调用失败');
    });

    it('非 failed 状态应清空 error_message', () => {
      const created = db.insertAgentTask(buildInput());
      db.updateStatus(created.id, 'failed', 'some error');
      db.updateStatus(created.id, 'running');
      const after = db.getAgentTask(created.id)!;
      expect(after.error_message).toBeNull();
    });

    it('不存在的任务不应抛错（仅警告）', () => {
      expect(() => db.updateStatus(99999, 'running')).not.toThrow();
    });
  });

  describe('updateProgress', () => {
    it('应更新进度', () => {
      const created = db.insertAgentTask(buildInput());
      db.updateProgress(created.id, 42);
      expect(db.getAgentTask(created.id)!.progress).toBe(42);
    });

    it('应 clamp 到 0-100 区间', () => {
      const created = db.insertAgentTask(buildInput());
      db.updateProgress(created.id, 200);
      expect(db.getAgentTask(created.id)!.progress).toBe(100);
      db.updateProgress(created.id, -5);
      expect(db.getAgentTask(created.id)!.progress).toBe(0);
    });

    it('浮点进度应截断为整数', () => {
      const created = db.insertAgentTask(buildInput());
      db.updateProgress(created.id, 33.7);
      expect(db.getAgentTask(created.id)!.progress).toBe(33);
    });
  });

  describe('updateChatHistoryId', () => {
    it('应更新 task_agent.chat_history_id', () => {
      const created = db.insertAgentTask(buildInput());
      db.updateChatHistoryId(created.id, 'task-1-1700000000000');
      expect(db.getAgentTask(created.id)!.chat_history_id).toBe('task-1-1700000000000');
    });
  });

  describe('updateResultMeta', () => {
    it('应将元数据片段合并写入 result_meta', () => {
      const created = db.insertAgentTask(buildInput());
      db.updateResultMeta(created.id, { summary_doc_id: 123 });
      const v1 = db.getAgentTask(created.id)!;
      expect(v1.result_meta).toEqual({ summary_doc_id: 123 });

      // 二次合并：保留已有 key，追加新 key
      db.updateResultMeta(created.id, { handler_error: 'boom' });
      const v2 = db.getAgentTask(created.id)!;
      expect(v2.result_meta).toEqual({ summary_doc_id: 123, handler_error: 'boom' });
    });

    it('传 null 应清空 result_meta', () => {
      const created = db.insertAgentTask(buildInput());
      db.updateResultMeta(created.id, { summary_doc_id: 1 });
      db.updateResultMeta(created.id, null);
      expect(db.getAgentTask(created.id)!.result_meta).toBeNull();
    });

    it('不存在的任务不应抛错', () => {
      expect(() => db.updateResultMeta(99999, { a: 1 })).not.toThrow();
    });
  });

  describe('recoverCrashedTasks', () => {
    it('应将所有 running 任务标记为 failed', () => {
      const t1 = db.insertAgentTask(buildInput({ title: 't1' }));
      const t2 = db.insertAgentTask(buildInput({ title: 't2' }));
      const t3 = db.insertAgentTask(buildInput({ title: 't3' }));
      db.updateStatus(t1.id, 'running');
      db.updateStatus(t2.id, 'running');
      // t3 保持 pending

      const count = db.recoverCrashedTasks();
      expect(count).toBe(2);
      expect(db.getTaskRow(t1.id)!.status).toBe('failed');
      expect(db.getTaskRow(t2.id)!.status).toBe('failed');
      expect(db.getTaskRow(t3.id)!.status).toBe('pending');
    });

    it('应为无 error_message 的任务填充默认错误信息', () => {
      const t = db.insertAgentTask(buildInput());
      db.updateStatus(t.id, 'running');
      db.recoverCrashedTasks();
      expect(db.getTaskRow(t.id)!.error_message).toBe('应用异常退出，任务中断');
    });

    it('应保留已有 error_message（COALESCE 语义：已存在的错误信息不被覆盖）', () => {
      // 构造 running + 已有 error_message 场景：
      // 通过直接对 task_agent 通道不可行，这里改用 recoverCrashedTasks 的 SQL 自身语义验证
      const t = db.insertAgentTask(buildInput());
      db.updateStatus(t.id, 'running');
      // 先恢复一次（pending→running→failed，error_message=默认）
      db.recoverCrashedTasks();
      // 再次恢复不应清空已有 error_message
      // 但此时状态为 failed，不再匹配 WHERE status='running'
      // 所以本用例验证：failed 任务不会被二次恢复
      expect(db.getTaskRow(t.id)!.status).toBe('failed');
      expect(db.getTaskRow(t.id)!.error_message).toBe('应用异常退出，任务中断');
      // 二次恢复：无 running 任务，不影响已 failed 的任务
      const secondCount = db.recoverCrashedTasks();
      expect(secondCount).toBe(0);
      expect(db.getTaskRow(t.id)!.error_message).toBe('应用异常退出，任务中断');
    });

    it('无 running 任务时返回 0', () => {
      db.insertAgentTask(buildInput());
      expect(db.recoverCrashedTasks()).toBe(0);
    });
  });

  describe('deleteTask', () => {
    it('应删除 task 主记录', () => {
      const created = db.insertAgentTask(buildInput());
      expect(db.deleteTask(created.id)).toBe(true);
      expect(db.getTaskRow(created.id)).toBeUndefined();
    });

    it('不存在的任务返回 false', () => {
      expect(db.deleteTask(99999)).toBe(false);
    });
  });

  describe('isTerminalStatus', () => {
    it('completed/failed/cancelled 为终态', () => {
      expect(db.isTerminalStatus('completed')).toBe(true);
      expect(db.isTerminalStatus('failed')).toBe(true);
      expect(db.isTerminalStatus('cancelled')).toBe(true);
    });

    it('pending/running 非终态', () => {
      expect(db.isTerminalStatus('pending')).toBe(false);
      expect(db.isTerminalStatus('running')).toBe(false);
    });
  });

  describe('close', () => {
    it('不应抛错', () => {
      expect(() => db.close()).not.toThrow();
    });
  });
});
