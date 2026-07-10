/**
 * Note 应用前端共享常量。
 *
 * 字段长度限制需与后端 types.ts 保持一致（见 src/main/core/services/app-modules/note-app/types.ts）。
 */

/** Doc title 最大字符数 */
export const NOTE_DOC_TITLE_MAX_LENGTH = 150;

/** Doc summary 最大字符数 */
export const NOTE_DOC_SUMMARY_MAX_LENGTH = 800;

/** Label name 最大字符数 */
export const NOTE_LABEL_NAME_MAX_LENGTH = 30;

/** 搜索 debounce 延迟（ms） */
export const NOTE_SEARCH_DEBOUNCE_MS = 300;

/** 搜索历史默认拉取条数 */
export const NOTE_SEARCH_HISTORY_LIMIT = 10;

/** 搜索结果默认返回上限 */
export const NOTE_SEARCH_DEFAULT_LIMIT = 30;
