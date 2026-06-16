/**
 * Todo 应用（todo-app）类型定义
 *
 * 设计文档：docs/specs/100_todo-app-design.md §3
 *
 * 所有 todo-app 相关类型集中定义在此文件，供主进程服务、IPC handler、
 * 渲染进程（通过 preload 桥接的类型推断）共享。
 *
 * Phase 1-2 范围：不含 FTS 搜索结果类型、不含任务适配层类型。
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
 */
export interface TodoList {
  id: number;
  name: string;
  description: string;
  category_id: number | null;
  created_at: number;
  updated_at: number;
  /** 软删除时间（null 表示未删除） */
  deleted_at: number | null;
}

/**
 * Todo 条目（递归结构，限制 4 层）
 *
 * 注意：label_ids 不在 todo_item 表中，由 todo_item_label 多对多表 JOIN 得到。
 *      Service 层在返回 TodoItem 时补全该字段。
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
  /** 标签 ID 列表（来自 todo_item_label 多对多） */
  label_ids: number[];
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
 * 关联到 category 或 todo_item 的 Markdown 文档
 */
export interface TodoDocument {
  id: number;
  name: string;
  content: string;
  /** 关联的 category ID（与 todo_item_id 至少一个为 null） */
  todo_category_id: number | null;
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
