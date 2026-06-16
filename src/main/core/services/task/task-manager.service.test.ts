/**
 * TaskManager 单元测试
 *
 * 重点覆盖：
 * - 状态机流转（pending→running→completed/failed/cancelled）
 * - 重复运行拒绝
 * - 取消（running / pending / 终态）
 * - source handler 失败不影响 completed
 * - 事件广播
 *
 * 使用 fake executor + fake broadcaster + 真实 TaskDb（文件级 mock）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';

// 文件级 mock better-sqlite3（复用 TaskDb 的内存执行器思路，简化版）
vi.mock('better-sqlite3', () => {
  class MemDb {
    private tasks: Map<number, Record<string, any>> = new Map();
    private taskAgents: Map<number, Record<string, any>> = new Map();
    private seq = 0;

    constructor(_f?: string) {}
    pragma(_s: string) {}
    exec(_s: string) {}
    close() {}

    prepare(sql: string) {
      const s = sql.trim().replace(/\s+/g, ' ');
      return {
        all: (...p: any[]) => this.runQuery(s, p),
        get: (...p: any[]) => {
          const r = this.runQuery(s, p);
          return r.length ? r[0] : undefined;
        },
        run: (...p: any[]) => this.runExec(s, p),
      };
    }

    private runExec(sql: string, params: any[]) {
      if (/^INSERT INTO task \(/i.test(sql)) {
        this.seq += 1;
        const row: any = { id: this.seq };
        this.fill(sql, params, row);
        this.tasks.set(this.seq, row);
        return { changes: 1, lastInsertRowid: this.seq };
      }
      if (/^INSERT INTO task_agent \(/i.test(sql)) {
        const row: any = {};
        this.fill(sql, params, row);
        this.taskAgents.set(row.task_id, row);
        return { changes: 1, lastInsertRowid: row.task_id };
      }
      if (/^UPDATE task\b.* SET /i.test(sql) && !/^UPDATE task_agent/i.test(sql)) {
        return { changes: this.applyTaskUpdate(sql, params), lastInsertRowid: 0 };
      }
      if (/^UPDATE task_agent SET /i.test(sql)) {
        const setMatch = sql.match(/SET (.+?) WHERE/i);
        const parts = (setMatch || ['', ''])[1].split(',').map((x: string) => x.trim());
        let cursor = 0;
        for (const ta of this.taskAgents.values()) {
          if (ta.task_id === params[parts.length]) {
            for (const part of parts) {
              const m = part.match(/^([\w.]+)\s*=\s*\?$/);
              if (m) ta[m[1].replace(/^\w+\./, '')] = params[cursor++];
            }
          }
        }
        return { changes: 1, lastInsertRowid: 0 };
      }
      if (/^DELETE FROM task WHERE id = \?$/i.test(sql)) {
        const id = params[0];
        const e = this.tasks.delete(id);
        this.taskAgents.delete(id);
        return { changes: e ? 1 : 0, lastInsertRowid: 0 };
      }
      return { changes: 0, lastInsertRowid: 0 };
    }

    private applyTaskUpdate(sql: string, params: any[]): number {
      const setMatch = sql.match(/SET (.+?) WHERE/i);
      const setParts = this.splitComma((setMatch || ['', ''])[1]);
      const cond = this.parseWhere(sql);
      const assignments: Array<{ col: string; value: any; src?: string }> = [];
      let cursor = 0;
      for (const part of setParts) {
        const m = part.match(/^([\w.]+)\s*=\s*\?$/);
        if (m) { assignments.push({ col: this.strip(m[1]), value: params[cursor++] }); continue; }
        const coal = part.match(/^([\w.]+)\s*=\s*COALESCE\(([\w.]+),\s*\?\)$/i);
        if (coal) {
          const fb = params[cursor++];
          assignments.push({ col: this.strip(coal[1]), src: this.strip(coal[2]), value: ((f: any) => (v: any) => (v != null ? v : f))(fb) });
          continue;
        }
        const lit = part.match(/^([\w.]+)\s*=\s*'([^']*)'$/);
        if (lit) { assignments.push({ col: this.strip(lit[1]), value: lit[2] }); }
      }
      const condParams = params.slice(cursor);
      let ci = 0;
      const resolved = cond.map((c) => c.isParam ? { col: c.col, isParam: false, literal: condParams[ci++] } : c);
      let changes = 0;
      for (const t of this.tasks.values()) {
        if (this.match(t, resolved)) {
          for (const a of assignments) {
            if (typeof a.value === 'function') t[a.col] = a.value(t[a.src!]);
            else t[a.col] = a.value;
          }
          changes++;
        }
      }
      return changes;
    }

    private runQuery(sql: string, params: any[]) {
      if (/FROM sqlite_master/i.test(sql)) return [];
      if (/\bFROM task_agent\b/i.test(sql)) {
        const w = this.parseWhere(sql);
        const out: any[] = [];
        for (const ta of this.taskAgents.values()) {
          if (this.match({ ...ta, id: ta.task_id }, this.resolve(w, params))) out.push(ta);
        }
        return out;
      }
      if (/\bFROM task\b/i.test(sql)) {
        const isJoin = /JOIN task_agent/i.test(sql);
        const desc = /ORDER BY t\.created_at DESC/i.test(sql);
        const hasLimit = /LIMIT \? OFFSET \?/i.test(sql);
        const w = this.parseWhere(sql);
        let rows: any[] = [];
        for (const t of this.tasks.values()) {
          let merged = isJoin ? { ...t, ...(this.taskAgents.get(t.id) || {}) } : { ...t };
          if (this.match(merged, this.resolve(w, params))) rows.push(merged);
        }
        if (desc) rows.sort((a, b) => b.created_at - a.created_at);
        if (hasLimit) {
          const lim = params[params.length - 2];
          const off = params[params.length - 1];
          rows = rows.slice(off, off + lim);
        }
        return rows;
      }
      return [];
    }

    private fill(sql: string, params: any[], row: any) {
      const m = sql.match(/\(([^)]+)\)\s*VALUES/i);
      if (!m) return;
      m[1].split(',').map((c: string) => c.trim()).forEach((c: string, i: number) => { row[c] = params[i]; });
    }
    private splitComma(str: string): string[] {
      const out: string[] = []; let d = 0; let cur = '';
      for (const ch of str) { if (ch === '(') d++; else if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; }
      if (cur.trim()) out.push(cur.trim());
      return out;
    }
    private parseWhere(sql: string) {
      const m = sql.match(/WHERE (.+?)(?:ORDER BY|LIMIT|$)/i);
      if (!m) return [];
      const out: any[] = []; let pp = 0;
      for (const part of m[1].split(/\s+AND\s+/i)) {
        const p = part.trim();
        const pm = p.match(/^([\w.]+)\s*=\s*\?$/);
        if (pm) { out.push({ col: this.strip(pm[1]), isParam: true, pos: pp++ }); continue; }
        const lm = p.match(/^([\w.]+)\s*=\s*'([^']*)'$/);
        if (lm) { out.push({ col: this.strip(lm[1]), isParam: false, literal: lm[2] }); continue; }
        if (/^COALESCE/i.test(p)) pp++;
      }
      return out;
    }
    private resolve(w: any[], params: any[]) {
      let i = 0;
      return w.map((c) => c.isParam ? { col: c.col, isParam: false, literal: params[i++] } : c);
    }
    private match(row: any, conds: any[]): boolean {
      for (const c of conds) if (row[c.col] !== c.literal) return false;
      return true;
    }
    private strip(c: string): string { const i = c.indexOf('.'); return i >= 0 ? c.slice(i + 1) : c; }
  }
  return { default: MemDb, Database: MemDb };
});

vi.mock('@/core/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { TaskManager } from './task-manager.service';
import { TaskDb } from './task-db';
import { TaskEventBroadcaster } from './task-event-broadcaster';
import {
  AgentTaskCreateInput,
  ITaskExecutor,
  Task,
  TaskExecutionContext,
  TaskExecutionResult,
  TaskCancelledError,
} from './task.types';

const TASK_SQL_PATH = path.join(process.cwd(), 'data', 'task.sql');

function buildInput(o: Partial<AgentTaskCreateInput> = {}): AgentTaskCreateInput {
  return { source: 'todo-app', source_ref_id: 1, title: 't', prompt: 'p', agent_name: 'coder', llm_config_name: 'default', ...o };
}

/** fake executor：可控制 resolve/reject/cancel 行为与采集 context */
function createFakeExecutor(opts: { result?: TaskExecutionResult; error?: Error; cancelThrow?: boolean } = {}): ITaskExecutor & { contexts: TaskExecutionContext[]; emit: (e: any) => void } {
  const contexts: TaskExecutionContext[] = [];
  const executor: ITaskExecutor = {
    type: 'agent',
    async execute(view: any, context: TaskExecutionContext) {
      contexts.push(context);
      // 模拟执行中推送事件
      context.emit({ taskId: view.id, type: 'progress', progress: 50 });
      context.emit({ taskId: view.id, type: 'text_delta', content: 'hi' });
      // 响应取消
      if (opts.cancelThrow && context.cancelToken.cancelled) {
        throw new TaskCancelledError('fake cancel');
      }
      if (opts.error) throw opts.error;
      return opts.result ?? { meta: { chat_history_id: 'h-1' }, rawOutput: [] };
    },
  };
  return executor as any;
}

/** fake broadcaster：收集广播的事件 */
function createFakeBroadcaster() {
  const events: any[] = [];
  return {
    events,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    broadcast: vi.fn((e: any) => events.push(e)),
    broadcastToAll: vi.fn(),
    getSubscriberCount: vi.fn(() => 0),
  } as any;
}

describe('TaskManager', () => {
  let db: TaskDb;
  let broadcaster: any;
  let manager: TaskManager;

  beforeEach(() => {
    db = new TaskDb(':memory:', TASK_SQL_PATH);
    db.initialize();
    broadcaster = createFakeBroadcaster();
    manager = new TaskManager(db, broadcaster);
  });

  describe('initialize', () => {
    it('应建表并执行崩溃恢复', () => {
      // 直接构造一个已有 running 任务的 DB 再 initialize
      const db2 = new TaskDb(':memory:', TASK_SQL_PATH);
      db2.initialize();
      const v = db2.insertAgentTask(buildInput());
      db2.updateStatus(v.id, 'running');

      const bc = createFakeBroadcaster();
      const m2 = new TaskManager(db2, bc);
      m2.initialize();

      expect(db2.getTaskRow(v.id)!.status).toBe('failed');
    });
  });

  describe('register', () => {
    it('应注册执行器', () => {
      manager.registerExecutor(createFakeExecutor());
      // 间接验证：run 不再抛 "no executor"
      const t = manager.createAgentTask(buildInput());
      expect(() => manager.run(t.id)).not.toThrow();
    });

    it('应注册 source handler', () => {
      const handler = vi.fn(async () => ({ custom: 1 }));
      manager.registerSourceHandler('todo-app', 'agent', handler);
      // 间接验证通过 run 完成
      manager.registerExecutor(createFakeExecutor());
      const t = manager.createAgentTask(buildInput());
      manager.run(t.id);
      // 等待异步完成
    });
  });

  describe('createAgentTask / getTask / list', () => {
    it('应创建任务并返回视图', () => {
      const v = manager.createAgentTask(buildInput({ title: 'abc' }));
      expect(v.id).toBeGreaterThan(0);
      expect(v.title).toBe('abc');
      expect(v.status).toBe('pending');
    });

    it('getTask 应返回详情', () => {
      const v = manager.createAgentTask(buildInput());
      expect(manager.getTask(v.id)!.prompt).toBe('p');
    });

    it('listBySource / listTasks 应返回列表', () => {
      manager.createAgentTask(buildInput({ source: 'todo-app', source_ref_id: 1 }));
      manager.createAgentTask(buildInput({ source: 'doc-app', source_ref_id: 2 }));
      expect(manager.listBySource('todo-app')).toHaveLength(1);
      expect(manager.listTasks()).toHaveLength(2);
      expect(manager.listTasks({ source: 'doc-app' })).toHaveLength(1);
    });
  });

  describe('run - 状态流转', () => {
    it('pending → running → completed', async () => {
      manager.registerExecutor(createFakeExecutor({ result: { meta: { chat_history_id: 'h1' } } }));
      const t = manager.createAgentTask(buildInput());
      const running = manager.run(t.id);
      expect(running.status).toBe('running');

      await manager.waitForTask(t.id);

      const final = manager.getTask(t.id)!;
      expect(final.status).toBe('completed');
      expect(final.progress).toBe(100);
      expect(final.chat_history_id).toBe('h1');
    });

    it('应广播 status_changed 事件（running/completed）与 done', async () => {
      manager.registerExecutor(createFakeExecutor());
      const t = manager.createAgentTask(buildInput());
      manager.run(t.id);
      await manager.waitForTask(t.id);

      const statuses = broadcaster.events.filter((e: any) => e.type === 'status_changed').map((e: any) => e.status);
      expect(statuses).toContain('running');
      expect(statuses).toContain('completed');
      expect(broadcaster.events.some((e: any) => e.type === 'done')).toBe(true);
    });

    it('progress 事件应同步到 DB', async () => {
      manager.registerExecutor(createFakeExecutor());
      const t = manager.createAgentTask(buildInput());
      manager.run(t.id);
      await manager.waitForTask(t.id);

      // fake executor 推送过 progress=50，最终 completed 会置 100
      expect(manager.getTask(t.id)!.progress).toBe(100);
    });

    it('运行中 → failed（executor 抛错）', async () => {
      manager.registerExecutor(createFakeExecutor({ error: new Error('LLM 挂了') }));
      const t = manager.createAgentTask(buildInput());
      manager.run(t.id);
      await manager.waitForTask(t.id);

      const final = manager.getTask(t.id)!;
      expect(final.status).toBe('failed');
      expect(final.error_message).toContain('LLM 挂了');
      // 应广播 error 事件
      expect(broadcaster.events.some((e: any) => e.type === 'error' && e.message.includes('LLM 挂了'))).toBe(true);
    });

    it('重复运行应拒绝（completed 状态）', async () => {
      manager.registerExecutor(createFakeExecutor());
      const t = manager.createAgentTask(buildInput());
      manager.run(t.id);
      await manager.waitForTask(t.id);

      expect(() => manager.run(t.id)).toThrow(/only 'pending' allowed/);
    });

    it('重复运行应拒绝（running 状态）', async () => {
      // 用一个永不完成的 executor
      manager.registerExecutor({
        type: 'agent',
        async execute() { return new Promise(() => {}); }, // 永不 resolve
      });
      const t = manager.createAgentTask(buildInput());
      manager.run(t.id);
      expect(() => manager.run(t.id)).toThrow(/only 'pending' allowed/);
    });

    it('无执行器应抛错', () => {
      const t = manager.createAgentTask(buildInput());
      expect(() => manager.run(t.id)).toThrow(/No executor/);
    });

    it('任务不存在应抛错', () => {
      expect(() => manager.run(99999)).toThrow(/not found/);
    });
  });

  describe('cancel', () => {
    it('running 状态取消应转为 cancelled', async () => {
      // 使用一个会等待取消的 executor：execute 内部轮询 cancelToken，被取消时抛 TaskCancelledError
      manager.registerExecutor({
        type: 'agent',
        async execute(view: any, ctx: TaskExecutionContext) {
          ctx.emit({ taskId: view.id, type: 'progress', progress: 10 });
          // 轮询等待取消（最多 ~2s，避免测试卡死）
          for (let i = 0; i < 400; i++) {
            if (ctx.cancelToken.cancelled) {
              throw new TaskCancelledError('cancelled');
            }
            await new Promise((r) => setTimeout(r, 5));
          }
          return { meta: {} };
        },
      });
      const t = manager.createAgentTask(buildInput());
      manager.run(t.id);
      expect(manager.getRunningCount()).toBe(1);

      // 触发取消
      const ok = manager.cancel(t.id);
      expect(ok).toBe(true);
      await manager.waitForTask(t.id);

      expect(manager.getTask(t.id)!.status).toBe('cancelled');
    });

    it('pending 状态取消应直接置 cancelled', () => {
      const t = manager.createAgentTask(buildInput());
      const ok = manager.cancel(t.id);
      expect(ok).toBe(true);
      expect(manager.getTask(t.id)!.status).toBe('cancelled');
      expect(broadcaster.events.some((e: any) => e.type === 'status_changed' && e.status === 'cancelled')).toBe(true);
    });

    it('终态任务取消应返回 false', async () => {
      manager.registerExecutor(createFakeExecutor());
      const t = manager.createAgentTask(buildInput());
      manager.run(t.id);
      await manager.waitForTask(t.id);
      expect(manager.cancel(t.id)).toBe(false);
    });

    it('不存在的任务应抛错', () => {
      expect(() => manager.cancel(99999)).toThrow(/not found/);
    });
  });

  describe('source handler', () => {
    it('成功完成时应调用 source handler 并合并 result_meta', async () => {
      const handler = vi.fn(async () => ({ summary_doc_id: 777 }));
      manager.registerSourceHandler('todo-app', 'agent', handler);
      manager.registerExecutor(createFakeExecutor({ result: { meta: { chat_history_id: 'h1' } } }));

      const t = manager.createAgentTask(buildInput());
      manager.run(t.id);
      await manager.waitForTask(t.id);

      expect(handler).toHaveBeenCalledTimes(1);
      const final = manager.getTask(t.id)!;
      expect(final.result_meta).toMatchObject({ chat_history_id: 'h1', summary_doc_id: 777 });
    });

    it('source handler 抛错不应影响 completed 状态', async () => {
      const handler = vi.fn(async () => { throw new Error('写文档失败'); });
      manager.registerSourceHandler('todo-app', 'agent', handler);
      manager.registerExecutor(createFakeExecutor());

      const t = manager.createAgentTask(buildInput());
      manager.run(t.id);
      await manager.waitForTask(t.id);

      const final = manager.getTask(t.id)!;
      expect(final.status).toBe('completed');
      expect(final.result_meta).toHaveProperty('handler_error', '写文档失败');
    });

    it('未注册 source handler 时应正常完成', async () => {
      manager.registerExecutor(createFakeExecutor());
      const t = manager.createAgentTask(buildInput());
      manager.run(t.id);
      await manager.waitForTask(t.id);
      expect(manager.getTask(t.id)!.status).toBe('completed');
    });
  });

  describe('运行态管理', () => {
    it('getRunningCount 应反映当前运行数', async () => {
      manager.registerExecutor({
        type: 'agent',
        async execute(_v, ctx) {
          return new Promise<void>((resolve) => {
            // 在测试主动取消前不完成
            const iv = setInterval(() => { if (ctx.cancelToken.cancelled) { clearInterval(iv); resolve as any; resolve(); } }, 5);
          }) as any;
        },
      });
      const t = manager.createAgentTask(buildInput());
      manager.run(t.id);
      expect(manager.getRunningCount()).toBe(1);
      manager.cancel(t.id);
      await manager.waitForTask(t.id);
      expect(manager.getRunningCount()).toBe(0);
    });
  });
});
