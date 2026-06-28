/**
 * Todo 标签解析共享工具。
 *
 * 抽取自 TodoListDetail.resolveLabelIds，供 TodoAppPage.handleCreateListUnderCategory
 * 在"新建待办项目"对话框拿到 labelIds 后做同样解析，避免逻辑重复（CLAUDE.md "禁止重复"原则）。
 *
 * 背景：el-select allow-create 会把用户新输入的标签名以"字符串"塞入 v-model，
 * 而后端 setListLabels / updateTodoList 拿到非数字 id 会触发外键约束失败
 * （todo_list_label.label_id REFERENCES todo_label.id）。
 * 因此提交前需把字符串值解析为真实 label id：同名已存在则复用，否则新建。
 */

/** 标签最小结构（只需 id + name 即可完成解析） */
export interface TodoLabelLike {
  id: number;
  name: string;
}

/** 创建标签的 IPC 函数签名（与 window.todoApp.createLabel 一致） */
export type CreateLabelFn = (payload: { name: string }) => Promise<{ id: number }>;

/**
 * 把 labelIds 中的字符串值（el-select allow-create 输入的新标签名）解析为真实 label id。
 *
 * 解析规则：
 *   - number：原样返回
 *   - string：先在 allLabels 中按 name 精确匹配（避免重名触发唯一索引冲突），
 *             找不到则调 createLabel 新建并返回新 id
 *   - 空字符串/空白：跳过
 *
 * @param allLabels - 当前全量标签列表（用于按 name 去重重用）
 * @param labelIds  - 待解析的 id/name 混合数组（el-select v-model 原始值）
 * @param createLabel - 创建新标签的 IPC 函数（注入以解耦 window.todoApp，便于单测）
 * @returns 解析后的真实 label id 数组（全部为 number）
 */
export async function resolveLabelIds(
  allLabels: TodoLabelLike[],
  labelIds: Array<number | string>,
  createLabel: CreateLabelFn,
): Promise<number[]> {
  const resolved: number[] = [];
  for (const id of labelIds) {
    if (typeof id === 'number') {
      resolved.push(id);
      continue;
    }
    const name = String(id).trim();
    if (!name) continue;
    const existing = allLabels.find((l) => l.name === name);
    if (existing) {
      resolved.push(existing.id);
      continue;
    }
    const created = await createLabel({ name });
    resolved.push(created.id);
  }
  return resolved;
}
