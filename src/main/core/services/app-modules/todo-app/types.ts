/**
 * Todo 应用（todo-app）类型定义
 *
 * 设计文档：docs/specs/100_todo-app-design.md §3
 *
 * 所有 todo-app 相关类型集中定义在此文件，供主进程服务、IPC handler、
 * 渲染进程（通过 preload 桥接的类型推断）共享。
 *
 * Phase 1-2 范围：不含 FTS 搜索结果类型、不含任务适配层类型。
 * Phase 3 补充：TodoSearchResult / TodoSearchHistory / TodoFtsEntityType（见文件末尾）。
 */

// ============================================================================
// 枚举类型
// ============================================================================

/**
 * Todo 条目状态
 *
 * 状态机（VALID_STATUS_TRANSITIONS）：
 *   init       -> in_progress | done | abandoned
 *   in_progress -> done | abandoned | init（回退）
 *   done        -> in_progress（重新打开）
 *   abandoned   -> init（恢复）
 */
export type TodoItemStatus = 'init' | 'in_progress' | 'done' | 'abandoned';

/**
 * 重要性等级
 */
export type TodoItemPriority = 'urgent' | 'important' | 'normal' | 'hint';

// ============================================================================
// 常量
// ============================================================================

/** Category 递归最大深度（根为第 1 层） */
export const MAX_CATEGORY_DEPTH = 4;

/** TodoItem 递归最大深度（顶层为第 1 层） */
export const MAX_TODO_ITEM_DEPTH = 4;

/**
 * TodoItem 状态机：合法的目标状态集合
 *
 * 用法：VALID_STATUS_TRANSITIONS[from] 包含所有可从 from 流转到的新状态。
 * 约定：from === to 视为合法（幂等调用安全）。
 */
export const VALID_STATUS_TRANSITIONS: Readonly<Record<TodoItemStatus, ReadonlySet<TodoItemStatus>>> = {
  init: new Set<TodoItemStatus>(['init', 'in_progress', 'done', 'abandoned']),
  in_progress: new Set<TodoItemStatus>(['in_progress', 'done', 'abandoned', 'init']),
  done: new Set<TodoItemStatus>(['done', 'in_progress']),
  abandoned: new Set<TodoItemStatus>(['abandoned', 'init']),
};

// ============================================================================
// 基础实体（对应数据库行，snake_case 列名）
// ============================================================================

/**
 * Todo 分组（递归结构，限制 4 层）
 */
export interface TodoCategory {
  id: number;
  name: string;
  parent_id: number | null;
  created_at: number;
  updated_at: number;
  /** 软删除时间（null 表示未删除） */
  deleted_at: number | null;
}

/**
 * Todo 列表容器
 *
 * 注意：label_ids 不在 todo_list 表中，由 todo_list_label 多对多表 JOIN 得到。
 *      Service 层在返回 TodoList 时补全该字段。
 */
export interface TodoList {
  id: number;
  name: string;
  description: string;
  category_id: number | null;
  /** 标签 ID 列表（来自 todo_list_label 多对多） */
  label_ids: number[];
  created_at: number;
  updated_at: number;
  /** 软删除时间（null 表示未删除） */
  deleted_at: number | null;
}

/**
 * Todo 条目（递归结构，限制 4 层）
 *
 * 标签功能已迁移到 todo_list 维度（见 TodoList.label_ids）；todo_item 不再持有标签。
 * 历史 todo_item_label 表保留以兼容旧数据，但不再写入。
 */
export interface TodoItem {
  id: number;
  title: string;
  description: string;
  /** 任务描述（驱动 AI 任务，可选；为补充上下文） */
  task_prompt: string;
  parent_id: number | null;
  status: TodoItemStatus;
  progress: number;
  priority: TodoItemPriority;
  due_at: number | null;
  todo_list_id: number;
  /** 关联的 agent 任务 ID（指向最新 task.id，每次重跑覆盖） */
  agent_task_id: number | null;
  /** 是否手动设置进度；为 true 时父进度计算跳过该子项 */
  is_manual_progress: boolean;
  created_at: number;
  updated_at: number;
  /** 软删除时间（null 表示未删除） */
  deleted_at: number | null;
}

/**
 * 全局标签
 */
export interface TodoLabel {
  id: number;
  name: string;
  /** 类型（保留扩展，默认 'default'） */
  type: string;
  created_at: number;
  /** 软删除时间（null 表示未删除） */
  deleted_at: number | null;
}

/**
 * 关联到 todo_list 或 todo_item 的 Markdown 文档
 */
export interface TodoDocument {
  id: number;
  name: string;
  content: string;
  /** 关联的 todo_list ID（与 todo_item_id 不可同时非 null） */
  todo_list_id: number | null;
  todo_item_id: number | null;
  created_at: number;
  updated_at: number;
  /** 软删除时间（null 表示未删除） */
  deleted_at: number | null;
}

// ============================================================================
// 聚合视图（业务返回结构）
// ============================================================================

/**
 * 含子层级的 Category 树节点（业务返回结构）
 */
export interface TodoCategoryNode extends TodoCategory {
  children: TodoCategoryNode[];
  /** 该分类下（含子分类）未删除的 todo_list 计数 */
  list_count: number;
}

/**
 * 含子层级的 TodoItem 树节点（业务返回结构）
 */
export interface TodoItemNode extends TodoItem {
  children: TodoItemNode[];
  /** 在 todo_list 中的层级深度（顶层为 1） */
  depth: number;
}

// ============================================================================
// 配置
// ============================================================================

/**
 * Todo 应用配置（运行时结构，与 ConfigData.todo_app 对应）
 */
export interface TodoAppConfig {
  defaultCategoryId: number | null;
  defaultSort: string;
  showCompleted: boolean;
  maxCategoryDepth: number;
  maxTodoItemDepth: number;
}

// ============================================================================
// 全文搜索（Phase 3）
// ============================================================================

/**
 * FTS 实体类型集合。
 *
 * 与 §7.1 一致：**不包含 label**（label 不纳入 FTS 索引）。
 */
export type TodoFtsEntityType = 'category' | 'todo_list' | 'todo_item' | 'document';

/**
 * 全文搜索命中结果（统一返回结构）。
 *
 * 与 docs/specs/100_todo-app-design.md §3.7 一致。
 */
export interface TodoSearchResult {
  /** 命中类型 */
  type: TodoFtsEntityType;
  /** 命中实体 ID */
  id: number;
  /** 命中实体标题/名称（主表回查补全，避免 snippet 截断） */
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
 *
 * 与 docs/specs/100_todo-app-design.md §3.7 一致。
 */
export interface TodoSearchHistory {
  id: number;
  /** 用户原始输入（未做分词处理） */
  query: string;
  /** 该 query 命中结果数（用于 UI 展示） */
  hit_count: number;
  /** 最后一次搜索时间（Unix ms） */
  searched_at: number;
}

// ============================================================================
// 回收站（Phase 4）
// ============================================================================

/**
 * 回收站实体类型集合。
 *
 * 比 `TodoFtsEntityType` 多一个 `'label'`（label 不纳入 FTS 索引，但参与回收站）。
 * 与 docs/specs/100_todo-app-design.md §10 Phase 4 / §6.2 一致。
 */
export type TodoTrashEntityType = 'category' | 'todo_list' | 'todo_item' | 'document' | 'label';

/**
 * 回收站统一展示项（跨表聚合）。
 *
 * 由 TodoAppService.listTrash() 聚合 5 张业务表的软删除行得到。
 * 可选父级字段用于 UI 展示恢复提示（如"该实体父级已删除，恢复后将提升至根"）。
 */
export interface TodoTrashItem {
  /** 实体类型 */
  type: TodoTrashEntityType;
  /** 实体 ID */
  id: number;
  /** 展示名称（category.name / todo_list.name / todo_item.title / document.name / label.name） */
  name: string;
  /** 软删除时间（Unix ms；listTrash 已确保仅返回已删除项，故非 null） */
  deleted_at: number;
  /** 父级 ID（仅 category / todo_item 适用；用于恢复提示） */
  parent_id?: number | null;
  /** 所属 category ID（仅 todo_list 适用） */
  category_id?: number | null;
  /** 所属 todo_list ID（仅 todo_item 适用） */
  todo_list_id?: number | null;
}

/**
 * 清空回收站返回结果。
 *
 * `removed` 为本次实际物理删除的条目数（等于清空前 listTrash().length）。
 */
export interface TodoEmptyTrashResult {
  removed: number;
}

// ============================================================================
// Todo 驱动 AI 任务（Phase 5）
// ============================================================================

/**
 * createTaskFromItem 入参（运行任务 / 重跑共用）。
 *
 * 与 docs/specs/100_todo-app-design.md §8.2 对应：
 *   agentName / llmConfigName 由用户在 TaskRunDialog 选择；
 *   extraPrompt 为运行时补充段落（§8.3 的 [运行时补充] 模板字段）。
 */
export interface CreateTaskFromItemOptions {
  /** Agent 名称（指向 AiAgentMgrService.getAgent 入参） */
  agentName: string;
  /** LLM 配置名（指向 AiConfigService.getConfig 入参） */
  llmConfigName: string;
  /** 运行时补充 prompt（可选） */
  extraPrompt?: string;
}

// ============================================================================
// 待办项目 导入/导出（Exchange）
// 需求文档：docs/specs/101_todo-app-import-export-req.md
// ============================================================================

/** ExportBundle 版本号（schema 变更时递增，按版本分支兼容） */
export const TODO_EXPORT_BUNDLE_VERSION = 1;

/** 单次导入条目数硬上限（防御性，避免超大文件 OOM） */
export const TODO_MAX_IMPORT_ITEMS = 5000;

/**
 * 导出/导入用的 item 嵌套节点。
 *
 * 与 TodoItemNode 对齐，但剔除运行时字段（id / parent_id / todo_list_id /
 * agent_task_id / created_at / updated_at / deleted_at），跨库无意义。
 * 父子关系用 children 递归表达，导入端 DFS 自顶向下重建。
 *
 * 注意：标签已迁移到 todo_list 维度，item 节点不再携带 labels。
 */
export interface TodoListExportItemNode {
  title: string;
  description: string;
  task_prompt: string;
  status: TodoItemStatus;
  progress: number;
  priority: TodoItemPriority;
  due_at: number | null;
  is_manual_progress: boolean;
  /** 子条目（递归） */
  children: TodoListExportItemNode[];
}

/**
 * 导出文件顶层结构。
 * version 由 TODO_EXPORT_BUNDLE_VERSION 约定，导入端校验。
 *
 * labels 位于 list 维度（与运行时 TodoList.label_ids 对应），
 * 仅保留 name（id 跨库无效，type 不参与导入导出）。
 */
export interface TodoListExportBundle {
  version: number;
  exported_at: number;
  list: { name: string; description: string };
  /** 待办项目级标签名称列表（不含 id / type） */
  labels: string[];
  items: TodoListExportItemNode[];
}

/** deserialize 返回：新建的 todo_list id 与重建的 item 总数 */
export interface TodoListImportResult {
  listId: number;
  itemCount: number;
}
