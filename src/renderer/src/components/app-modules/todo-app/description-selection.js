/**
 * 描述字段 textarea 选中文本读取（详见 docs/specs/100_todo-app-design.md §9.4）。
 *
 * 浏览器 window.getSelection() 对原生 <textarea> 不返回选区（历史行为），
 * 必须读 selectionStart / selectionEnd + value.slice。
 *
 * 设计为纯函数（无 Vue 依赖），便于在多处 textarea（TodoItemDetail / TodoListDetail
 * 内联 + TodoDescriptionDialog）复用，且不进入响应式系统。
 */

/**
 * 从 contextmenu 事件目标读取 textarea 选中文本。
 *
 * @param {Event} event - contextmenu 事件（event.target 为触发右键的 textarea）
 * @returns {string|null} 选中文本；无选区或目标非 textarea 返回 null
 *   （调用方据此决定是否 preventDefault，让浏览器原生菜单弹出）
 */
export function getDescriptionSelection(event) {
  const ta = event?.target;
  if (!ta || typeof ta.selectionStart !== 'number') return null;
  if (ta.selectionStart === ta.selectionEnd) return null;
  return ta.value.slice(ta.selectionStart, ta.selectionEnd);
}
