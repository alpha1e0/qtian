/**
 * 描述字段选中文本 → 待办条目标题列表解析（纯函数）。
 *
 * 用于「描述字段右键一键创建待办条目」特性（详见 docs/specs/100_todo-app-design.md §9.4）：
 * 用户在 todo_item / todo_list 的 description textarea 里选中一段文本，按行拆为
 * 多个新待办条目的 title，调 `TodoItemService.createFromText` 落库。
 *
 * 与快捷输入框 `parseQuickItemInput` 的区别：
 * - **不解析 `#N` 控制符**：描述里的 `#数字` 是正文语义（如「依赖 #3」），
 *   若复用快捷解析会被误识别为优先级。
 * - 输入是多行文本，输出是 title 列表（快捷输入是单行 → 单个 title）。
 *
 * 设计为纯函数（无 DB / IPC 依赖），便于单元测试覆盖各边界情形。
 */

/**
 * 把描述字段选中文本拆为待办条目标题列表。
 *
 * 规则：按 `\n` split → 每行 `trim()` → 过滤空行。
 * - 不去重（保留用户语义；同一标题多次出现意味着用户希望多次创建）
 * - 兼容 `\r\n`（`trim()` 会清掉行尾 `\r`）
 * - `null` / `undefined` 安全处理为空串，返回 `[]`
 *
 * @param text - 选中的原始文本（可能含 `\n` / `\r\n` / 前后空行 / 纯空白行）
 * @returns 拆分后的 title 列表（已 trim、过滤空行，保留出现顺序）
 */
export function splitSelectionToTitles(text: string | null | undefined): string[] {
  return (text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
