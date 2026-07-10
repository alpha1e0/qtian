import type { TrackedPath } from './sync-types';

/**
 * 数据同步 tracked 路径定义（相对 workspace）。
 *
 * 内容来源（需求 010）：
 * - assistant 配置：agent / llm / skill / tool 四个目录
 * - todo-app：todo.db（DB 文件）+ attach 附件目录
 * - note-app：note.db（DB 文件）+ attach 附件目录
 *
 * DB 文件用 SQLite online backup，目录用递归文件传输。
 */
export const TRACKED_PATHS: readonly TrackedPath[] = [
  { relPath: 'assistant/agent', kind: 'dir' },
  { relPath: 'assistant/llm', kind: 'dir' },
  { relPath: 'assistant/skill', kind: 'dir' },
  { relPath: 'assistant/tool', kind: 'dir' },
  { relPath: 'app_modules/todo_app/todo.db', kind: 'db' },
  { relPath: 'app_modules/todo_app/attach', kind: 'dir' },
  { relPath: 'app_modules/note_app/note.db', kind: 'db' },
  { relPath: 'app_modules/note_app/attach', kind: 'dir' },
];
