/**
 * TaskEventBroadcaster 单元测试
 *
 * 通过自定义 mock WebContents 验证订阅、广播、过滤与销毁清理逻辑，
 * 不依赖真实 Electron 运行时。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/core/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// 局部 mock electron 的 BrowserWindow.getAllWindows
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

import { TaskEventBroadcaster } from './task-event-broadcaster';
import { TaskEvent } from './task.types';

/** 构造一个 mock WebContents */
function createMockContents(id: number): any {
  const handlers: Record<string, Array<() => void>> = {};
  const sent: TaskEvent[] = [];
  return {
    id,
    isDestroyed: vi.fn(() => false),
    send: vi.fn((channel: string, event: TaskEvent) => {
      sent.push(event);
    }),
    once: vi.fn((event: string, cb: () => void) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(cb);
    }),
    // 测试辅助：触发 destroyed 事件
    __emitDestroyed() {
      (handlers['destroyed'] || []).forEach((cb) => cb());
    },
    __sent: sent,
  };
}

function makeEvent(taskId: number, type: TaskEvent['type'] = 'done'): TaskEvent {
  return { taskId, type } as TaskEvent;
}

describe('TaskEventBroadcaster', () => {
  let broadcaster: TaskEventBroadcaster;

  beforeEach(() => {
    broadcaster = new TaskEventBroadcaster();
  });

  describe('subscribe / broadcast', () => {
    it('订阅全部任务时应收到所有事件', () => {
      const c = createMockContents(1);
      broadcaster.subscribe(c, null);

      broadcaster.broadcast(makeEvent(10));
      broadcaster.broadcast(makeEvent(20));

      expect(c.__sent).toHaveLength(2);
      expect(c.__sent[0].taskId).toBe(10);
      expect(c.__sent[1].taskId).toBe(20);
    });

    it('订阅指定 taskId 时应仅收到该任务的事件', () => {
      const c = createMockContents(1);
      broadcaster.subscribe(c, 10);

      broadcaster.broadcast(makeEvent(10));
      broadcaster.broadcast(makeEvent(20));

      expect(c.__sent).toHaveLength(1);
      expect(c.__sent[0].taskId).toBe(10);
    });

    it('未订阅任何任务时不应收到事件', () => {
      const c = createMockContents(1);
      broadcaster.broadcast(makeEvent(10));
      expect(c.__sent).toHaveLength(0);
    });

    it('多个订阅者应各自按规则收到事件', () => {
      const all = createMockContents(1);
      const t10 = createMockContents(2);
      const t20 = createMockContents(3);
      broadcaster.subscribe(all, null);
      broadcaster.subscribe(t10, 10);
      broadcaster.subscribe(t20, 20);

      broadcaster.broadcast(makeEvent(10));

      expect(all.__sent).toHaveLength(1);
      expect(t10.__sent).toHaveLength(1);
      expect(t20.__sent).toHaveLength(0);
    });

    it('同一 contents 可订阅多个 taskId（去重）', () => {
      const c = createMockContents(1);
      broadcaster.subscribe(c, 10);
      broadcaster.subscribe(c, 20);
      broadcaster.subscribe(c, 10); // 重复订阅应去重

      broadcaster.broadcast(makeEvent(10));
      broadcaster.broadcast(makeEvent(20));
      broadcaster.broadcast(makeEvent(30));

      expect(c.__sent).toHaveLength(2);
    });

    it('同一 contents 可同时订阅全部和指定 taskId', () => {
      const c = createMockContents(1);
      broadcaster.subscribe(c, null);
      broadcaster.subscribe(c, 10);

      broadcaster.broadcast(makeEvent(10));
      // 虽订阅了 null 与 10，但同一 contents 仅投递一次
      expect(c.__sent).toHaveLength(1);
    });
  });

  describe('unsubscribe', () => {
    it('取消指定 taskId 订阅后不再收到该任务事件', () => {
      const c = createMockContents(1);
      broadcaster.subscribe(c, 10);
      broadcaster.subscribe(c, 20);

      broadcaster.unsubscribe(c, 10);
      broadcaster.broadcast(makeEvent(10));
      broadcaster.broadcast(makeEvent(20));

      expect(c.__sent).toHaveLength(1);
      expect(c.__sent[0].taskId).toBe(20);
    });

    it('取消全部订阅（taskId undefined）应清空该 contents', () => {
      const c = createMockContents(1);
      broadcaster.subscribe(c, null);
      broadcaster.subscribe(c, 10);

      broadcaster.unsubscribe(c);
      broadcaster.broadcast(makeEvent(10));

      expect(c.__sent).toHaveLength(0);
      expect(broadcaster.getSubscriberCount()).toBe(0);
    });

    it('最后一个订阅被取消后应移除 contents 条目', () => {
      const c = createMockContents(1);
      broadcaster.subscribe(c, 10);
      expect(broadcaster.getSubscriberCount()).toBe(1);

      broadcaster.unsubscribe(c, 10);
      expect(broadcaster.getSubscriberCount()).toBe(0);
    });

    it('对未订阅的 contents 调用 unsubscribe 应安全无副作用', () => {
      const c = createMockContents(1);
      expect(() => broadcaster.unsubscribe(c, 10)).not.toThrow();
      expect(broadcaster.getSubscriberCount()).toBe(0);
    });
  });

  describe('销毁清理', () => {
    it('WebContents destroyed 时应自动移除订阅', () => {
      const c = createMockContents(1);
      broadcaster.subscribe(c, null);
      expect(broadcaster.getSubscriberCount()).toBe(1);

      c.__emitDestroyed();

      expect(broadcaster.getSubscriberCount()).toBe(0);
      // 销毁后再广播不应报错，也不应尝试发送
      broadcaster.broadcast(makeEvent(10));
      expect(c.__sent).toHaveLength(0);
    });

    it('broadcast 时遇到已销毁 contents 应跳过并清理', () => {
      const healthy = createMockContents(1);
      const dead = createMockContents(2);
      dead.isDestroyed = vi.fn(() => true);

      broadcaster.subscribe(healthy, null);
      // 手动注入"已销毁"订阅者（模拟 destroyed 事件未触发的边界场景）
      (broadcaster as any).subscribers.set(dead.id, { contents: dead, filter: new Set([null]) });

      broadcaster.broadcast(makeEvent(10));

      expect(healthy.__sent).toHaveLength(1);
      expect(dead.__sent).toHaveLength(0);
      // 已销毁的应被清理
      expect(broadcaster.getSubscriberCount()).toBe(1);
    });
  });

  describe('send 异常', () => {
    it('contents.send 抛错时应移除该订阅者但不影响其他', () => {
      const ok = createMockContents(1);
      const bad = createMockContents(2);
      bad.send = vi.fn(() => {
        throw new Error('send failed');
      });

      broadcaster.subscribe(ok, null);
      broadcaster.subscribe(bad, null);

      broadcaster.broadcast(makeEvent(10));

      expect(ok.__sent).toHaveLength(1);
      expect(broadcaster.getSubscriberCount()).toBe(1);
    });
  });

  describe('broadcastToAll', () => {
    it('应对所有 BrowserWindow 广播', async () => {
      const { BrowserWindow } = await import('electron');
      const c1 = createMockContents(1);
      const c2 = createMockContents(2);
      const c3 = createMockContents(3);
      (BrowserWindow.getAllWindows as any).mockReturnValue([
        { webContents: c1 },
        { webContents: c2 },
        { webContents: c3 },
      ]);

      broadcaster.broadcastToAll(makeEvent(99));

      expect(c1.__sent).toHaveLength(1);
      expect(c2.__sent).toHaveLength(1);
      expect(c3.__sent).toHaveLength(1);
    });

    it('已销毁窗口应被跳过', async () => {
      const { BrowserWindow } = await import('electron');
      const ok = createMockContents(1);
      const dead = createMockContents(2);
      dead.isDestroyed = vi.fn(() => true);
      (BrowserWindow.getAllWindows as any).mockReturnValue([
        { webContents: ok },
        { webContents: dead },
      ]);

      broadcaster.broadcastToAll(makeEvent(99));

      expect(ok.__sent).toHaveLength(1);
      expect(dead.__sent).toHaveLength(0);
    });
  });
});
