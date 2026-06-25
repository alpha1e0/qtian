/**
 * 导出文件名生成 — 纯函数工具
 *
 * 职责：根据待办项目名称与时间戳，生成保存对话框使用的默认文件名。
 *
 * 设计要点：
 * - 与 Electron dialog / fs 解耦，便于单元测试
 * - 名称需做文件名安全化：Windows/macOS/Linux 通用非法字符统一替换为 `_`
 *   （`\ / : * ? " < > |` 以及控制字符）
 * - 名称两端空白 trim；为空或仅空白时回退为 `todolist-<listId>`
 * - 时间格式使用本地时区 `YYYYMMDDHHmmss`，可读且分钟级冲突概率低
 *
 * 需求文档：docs/specs/101_todo-app-import-export-req.md §3.1
 */

/** 文件名（含扩展）最大长度上限，留出 `-YYYYMMDDHHmmss.json` 的余量 */
const MAX_NAME_LENGTH = 60;

/** 待办项目名称中需要被替换的文件名非法字符（Windows/macOS/Linux 并集） */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * 把 `Date` 格式化为本地时区 `YYYYMMDDHHmmss` 字符串。
 * 不依赖第三方库，仅用标准 API；padStart 保证两位补零。
 */
function formatLocalTimestamp(date: Date): string {
  const yyyy = date.getFullYear().toString().padStart(4, '0');
  const MM = (date.getMonth() + 1).toString().padStart(2, '0');
  const dd = date.getDate().toString().padStart(2, '0');
  const HH = date.getHours().toString().padStart(2, '0');
  const mm = date.getMinutes().toString().padStart(2, '0');
  const ss = date.getSeconds().toString().padStart(2, '0');
  return `${yyyy}${MM}${dd}${HH}${mm}${ss}`;
}

/**
 * 规范化待办项目名称为可安全用于文件名的片段。
 * - 替换非法字符为 `_`
 * - trim 两端空白以及首尾下划线（替换后产生的 `_`）
 * - 限制长度，避免 Windows 路径过长
 * - 结果为空时返回空字符串，由调用方决定回退策略
 */
function sanitizeListName(name: string): string {
  const cleaned = name.replace(ILLEGAL_FILENAME_CHARS, '_').replace(/^[\s_]+|[\s_]+$/g, '');
  if (cleaned.length === 0) return '';
  return cleaned.length > MAX_NAME_LENGTH ? cleaned.slice(0, MAX_NAME_LENGTH) : cleaned;
}

/**
 * 生成导出文件默认文件名。
 *
 * @param listName 待办项目名称（原始字符串，可包含任意字符）
 * @param now      时间戳（毫秒），默认 `Date.now()`；传入便于测试
 * @param listId   待办项目 id，仅在 `listName` 规范化后为空时用作回退
 * @returns        形如 `xxx-20260625120000.json` 的文件名
 */
export function buildExportFileName(listName: string, now: number = Date.now(), listId?: number): string {
  const safeName = sanitizeListName(listName ?? '');
  const base = safeName.length > 0 ? safeName : `todolist-${listId ?? 'unknown'}`;
  const timestamp = formatLocalTimestamp(new Date(now));
  return `${base}-${timestamp}.json`;
}
