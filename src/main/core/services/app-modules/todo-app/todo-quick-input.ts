/**
 * 快捷输入解析（中间面板底部快捷创建待办条目）
 *
 * 用户在快捷输入框中可附加 `#1`～`#4` 控制符指定优先级：
 *   #4 → urgent（紧急）
 *   #3 → important（重要）
 *   #2 → normal（普通）
 *   #1 → hint（提示）
 *
 * 控制符必须出现在字符串结尾；解析后连同前后空白一并从 title 中剔除。
 * 未附加控制符时优先级取默认值 `'normal'`（与 TodoItemService.DEFAULT_PRIORITY 一致）。
 *
 * 设计为纯函数（无 DB / IPC 依赖），便于单元测试覆盖各边界情形。
 */

import { TodoItemPriority } from './types';

/** `#N` → 优先级 映射；N 越大优先级越高 */
const PRIORITY_BY_CODE: Record<string, TodoItemPriority> = {
  '4': 'urgent',
  '3': 'important',
  '2': 'normal',
  '1': 'hint',
};

/** 无控制符时的默认优先级（与 TodoItemService.DEFAULT_PRIORITY 保持一致） */
export const DEFAULT_QUICK_PRIORITY: TodoItemPriority = 'normal';

/** 匹配结尾的 ` #1`～` #4` 控制符（含前后任意空白）；#5/#0 等不识别 */
const TRAILING_PRIORITY_TAG = /\s*#([1-4])\s*$/;

export interface ParsedQuickItemInput {
  /** 剔除控制符及前后空白后的标题 */
  title: string;
  /** 解析得到的优先级；无控制符时为默认值 normal */
  priority: TodoItemPriority;
}

/**
 * 解析快捷输入，拆分为 title + priority。
 *
 * @param raw - 用户原始输入（可能含结尾 `#N` 控制符）
 * @returns `{ title, priority }`
 * @throws Error("Title cannot be empty") —— 控制符剔除后 title 为空（如 "  #4"）
 */
export function parseQuickItemInput(raw: string): ParsedQuickItemInput {
  const text = (raw ?? '').trim();
  const match = text.match(TRAILING_PRIORITY_TAG);
  if (match) {
    const priority = PRIORITY_BY_CODE[match[1]] ?? DEFAULT_QUICK_PRIORITY;
    const title = text.slice(0, match.index).trim();
    if (title.length === 0) {
      throw new Error('Title cannot be empty');
    }
    return { title, priority };
  }
  // 无控制符：整段即为 title，优先级取默认
  if (text.length === 0) {
    throw new Error('Title cannot be empty');
  }
  return { title: text, priority: DEFAULT_QUICK_PRIORITY };
}
