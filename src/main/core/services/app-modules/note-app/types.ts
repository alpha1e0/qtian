/**
 * Note 应用（note-app）类型定义
 *
 * 设计文档：docs/specs/110_note-app-design.md §4
 *
 * 所有 note-app 相关类型集中定义在此文件，供主进程服务、IPC handler、
 * 渲染进程（通过 preload 桥接的类型推断）共享。
 *
 * 独立性约束（需求文档 §67 行）：note-app 不直接引用 todo-app 的代码，
 * 故类型独立定义。
 */

// ============================================================================
// 常量
// ============================================================================

/** Category 递归最大深度（根为第 1 层） */
export const MAX_CATEGORY_DEPTH = 4;

/** Doc title 最大字符数（应用层校验） */
export const MAX_DOC_TITLE_LENGTH = 150;

/** Doc summary 最大字符数（应用层校验） */
export const MAX_DOC_SUMMARY_LENGTH = 800;

/** Label name 最大字符数（应用层校验） */
export const MAX_LABEL_NAME_LENGTH = 30;

// ============================================================================
// 基础实体（对应数据库行，snake_case 列名）
// ============================================================================

/**
 * Note 分组（递归结构，限制 4 层）
 */
export interface NoteCategory {
  id: number;
  name: string;
  parent_id: number | null;
  created_at: number;
  updated_at: number;
  /** 软删除时间（null 表示未删除） */
  deleted_at: number | null;
}

/**
 * Note 文档（Markdown）
 *
 * 注意：label_ids 不在 note_doc 表中，由 note_doc_label 多对多表 JOIN 得到。
 *      Service 层在返回 NoteDoc 时补全该字段。
 */
export interface NoteDoc {
  id: number;
  title: string;
  summary: string;
  content: string;
  /** 所属 category ID（null = 无分类） */
  category_id: number | null;
  /** AI 任务描述（驱动 AI 任务来写文档；Phase 1 仅落库） */
  task_prompt: string;
  /** 标签 ID 列表（来自 note_doc_label 多对多） */
  label_ids: number[];
  /** 是否收藏（用户置顶常用文档；sidebar 收藏 tab 聚合此标记） */
  is_favorite: boolean;
  created_at: number;
  updated_at: number;
  /** 软删除时间（null 表示未删除） */
  deleted_at: number | null;
}

/**
 * Note 全局标签
 */
export interface NoteLabel {
  id: number;
  name: string;
  /** 类型（保留扩展，默认 'default'） */
  type: string;
  created_at: number;
  /** 软删除时间（null 表示未删除） */
  deleted_at: number | null;
}

// ============================================================================
// 聚合视图（业务返回结构）
// ============================================================================

/**
 * 含子层级的 Category 树节点（业务返回结构）
 */
export interface NoteCategoryNode extends NoteCategory {
  children: NoteCategoryNode[];
  /** 该分类下（含子分类）未删除的 doc 计数 */
  doc_count: number;
}

// ============================================================================
// 全文搜索
// ============================================================================

/**
 * FTS 实体类型集合。
 *
 * 仅索引 doc（label / category 不纳入 FTS 索引）。
 */
export type NoteFtsEntityType = 'doc';

/**
 * 全文搜索命中结果。
 *
 * 与 docs/specs/110_note-app-design.md §7 一致。
 */
export interface NoteSearchResult {
  /** 命中类型 */
  type: NoteFtsEntityType;
  /** 命中实体 ID */
  id: number;
  /** 命中实体标题（主表回查补全，避免 snippet 截断） */
  title: string;
  /** FTS snippet（高亮上下文，已包含 `<mark>` 标签；优先用 title_snippet，无命中时用 body_snippet） */
  snippet: string;
  /** 所属 category 路径（根→父，不含自身；用于 UI 展示面包屑） */
  category_path: string[];
  /** BM25 相关度分数（越小越相关） */
  rank: number;
}

/**
 * 搜索历史条目。
 */
export interface NoteSearchHistory {
  id: number;
  /** 用户原始输入（未做分词处理） */
  query: string;
  /** 该 query 命中结果数（用于 UI 展示） */
  hit_count: number;
  /** 最后一次搜索时间（Unix ms） */
  searched_at: number;
}

// ============================================================================
// 回收站
// ============================================================================

/**
 * 回收站实体类型集合。
 */
export type NoteTrashEntityType = 'category' | 'doc' | 'label';

/**
 * 回收站统一展示项（跨表聚合）。
 *
 * 由 NoteAppService.listTrash() 聚合 3 张业务表的软删除行得到。
 */
export interface NoteTrashItem {
  /** 实体类型 */
  type: NoteTrashEntityType;
  /** 实体 ID */
  id: number;
  /** 展示名称（category.name / doc.title / label.name） */
  name: string;
  /** 软删除时间（Unix ms；listTrash 已确保仅返回已删除项，故非 null） */
  deleted_at: number;
  /** 父级 ID（仅 category 适用；用于恢复提示） */
  parent_id?: number | null;
  /** 所属 category ID（仅 doc 适用） */
  category_id?: number | null;
}

/**
 * 清空回收站返回结果。
 *
 * `removed` 为本次实际物理删除的条目数（等于清空前 listTrash().length）。
 */
export interface NoteEmptyTrashResult {
  removed: number;
}

// ============================================================================
// 配置
// ============================================================================

/**
 * Note 应用配置（运行时结构，与 ConfigData.note_app 对应）
 */
export interface NoteAppConfig {
  defaultCategoryId: number | null;
  defaultSort: string;
  maxCategoryDepth: number;
}
