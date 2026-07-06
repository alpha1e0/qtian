/**
 * todo-app 渲染层共享常量。
 *
 * 集中管理描述字段长度上限等 spec 约束（单一来源），
 * 避免在多个组件里散落魔鬼数字。
 */

/**
 * 待办条目（todo_item.description）/ 待办项目（todo_list.description）
 * 的字数硬上限。
 *
 * 来源：spec §3.2 / §3.3 + 需求文档 100_todo-app-req.md L21 / L28
 * （描述字段 1200 字以内）。前端通过 el-input maxlength + show-word-limit
 * 在输入时即给出反馈，避免超长被后端截断。
 */
export const TODO_DESCRIPTION_MAX_LENGTH = 1200;
