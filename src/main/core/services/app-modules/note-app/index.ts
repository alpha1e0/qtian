/**
 * Note-app 模块统一导出
 *
 * 供外部（bootstrap / handler / 其他模块）按需引用。
 */

export { NoteDb } from './note-db';
export { NoteTokenizer } from './note-tokenizer';
export { NoteSearchService } from './note-search.service';
export { NoteLabelService } from './note-label.service';
export { NoteCategoryService } from './note-category.service';
export { NoteDocService } from './note-doc.service';
export { NoteAppService } from './note-app.service';
export * from './types';
