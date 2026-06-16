import { BrowserWindow, WebContents } from 'electron';

import { createLogger } from '@/core/utils/logger';
import { TaskEvent } from './task.types';

const logger = createLogger('TaskEventBroadcaster');

/** 订阅清理回调缓存 key（按 WebContents.id） */
type SubscriptionFilter = Set<number | null>;

/**
 * 任务事件广播器
 *
 * 职责：
 * 1. 维护渲染进程对 `qtian:task:event` 的订阅（全部任务或指定 taskId）
 * 2. 将 TaskEvent 推送到所有匹配的订阅者
 * 3. 自动清理已销毁的 WebContents，避免内存泄漏与发送异常
 *
 * 设计：
 * - 订阅粒度：null 表示订阅全部任务；number 表示订阅指定 taskId
 * - 单个 WebContents 可同时订阅"全部"与多个"指定 taskId"（去重）
 * - 广播时按 event.taskId 过滤订阅者，减少不必要的 IPC 流量
 */
export class TaskEventBroadcaster {
  /** WebContents.id → 订阅过滤器 */
  private subscribers: Map<number, { contents: WebContents; filter: SubscriptionFilter }> = new Map();

  /**
   * 订阅任务事件
   * @param contents - 渲染进程 WebContents
   * @param taskId - 任务 ID；null 表示订阅全部
   */
  subscribe(contents: WebContents, taskId: number | null): void {
    const id = contents.id;
    let entry = this.subscribers.get(id);
    if (!entry) {
      entry = { contents, filter: new Set() };
      this.subscribers.set(id, entry);
      // 首次订阅时绑定销毁清理（避免重复绑定）
      contents.once('destroyed', () => {
        this.removeByContentsId(id);
      });
    }
    entry.filter.add(taskId);
    logger.debug(`Subscribed: contents=${id}, taskId=${taskId}`);
  }

  /**
   * 取消订阅
   * @param contents - 渲染进程 WebContents
   * @param taskId - 任务 ID；省略或 null 表示取消该 contents 的全部订阅
   */
  unsubscribe(contents: WebContents, taskId?: number | null): void {
    const id = contents.id;
    const entry = this.subscribers.get(id);
    if (!entry) return;

    if (taskId === undefined) {
      // 取消该 contents 的所有订阅
      this.subscribers.delete(id);
      logger.debug(`Unsubscribed all: contents=${id}`);
      return;
    }

    entry.filter.delete(taskId);
    if (entry.filter.size === 0) {
      this.subscribers.delete(id);
    }
    logger.debug(`Unsubscribed: contents=${id}, taskId=${taskId}`);
  }

  /**
   * 广播任务事件到所有匹配的订阅者
   *
   * 匹配规则：订阅"全部"(null) 或订阅了 event.taskId 的 contents 会收到事件
   */
  broadcast(event: TaskEvent): void {
    if (this.subscribers.size === 0) return;

    for (const [id, entry] of this.subscribers) {
      const { contents, filter } = entry;

      // 跳过已销毁的 WebContents
      if (contents.isDestroyed()) {
        this.subscribers.delete(id);
        continue;
      }

      // 订阅全部 或 订阅了指定 taskId
      if (filter.has(null) || filter.has(event.taskId)) {
        try {
          contents.send('qtian:task:event', event);
        } catch (err) {
          logger.error(`Failed to broadcast to contents=${id}`, err);
          this.subscribers.delete(id);
        }
      }
    }
  }

  /**
   * 向所有渲染进程（BrowserWindow.webContents）广播
   *
   * 兜底场景：未走订阅流程时，确保事件能投递到所有窗口。
   * 通常应优先使用 broadcast（按订阅过滤）。
   */
  broadcastToAll(event: TaskEvent): void {
    for (const win of BrowserWindow.getAllWindows()) {
      const contents = win.webContents;
      if (contents.isDestroyed()) continue;
      try {
        contents.send('qtian:task:event', event);
      } catch (err) {
        logger.error('Failed to broadcast to window', err);
      }
    }
  }

  /** 获取当前订阅者数量（用于测试与诊断） */
  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  /** 按 WebContents.id 移除订阅（销毁回调用） */
  private removeByContentsId(id: number): void {
    if (this.subscribers.delete(id)) {
      logger.debug(`Removed destroyed contents=${id}`);
    }
  }
}
