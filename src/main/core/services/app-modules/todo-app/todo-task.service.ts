import { createLogger } from '@/core/utils/logger';
import { AiAgentService } from '@/core/services/agent/ai-agent.service';
import { AiAgentMgrService } from '@/core/services/agent/ai-agent-mgr.service';
import { AiConfigService } from '@/core/services/common/ai-config.service';
import { AiAgent, AiChatMessage, AiLLMConfig } from '@/core/common/config';
import { TaskManager } from '@/core/services/task/task-manager.service';
import {
  AgentTaskCreateInput,
  Task,
  TaskAgentView,
  TaskExecutionResult,
  TaskSource,
} from '@/core/services/task/task.types';
import { TodoAppService } from './todo-app.service';
import { CreateTaskFromItemOptions, TodoItem } from './types';

const logger = createLogger('TodoTaskService');

/** Todo 任务来源标识（与 task.types.ts VALID_TASK_SOURCES 一致） */
const TODO_TASK_SOURCE: TaskSource = 'todo-app';

/** 总结文档标题前缀（与 §8.4 输出语义对应） */
const SUMMARY_DOC_TITLE_SUFFIX = ' - 任务总结';

/**
 * Todo 驱动 AI 任务适配层（Phase 5）
 *
 * 职责（docs/specs/100_todo-app-design.md §8）：
 * 1. createTaskFromItem —— 组装 prompt + 委托 TaskManager.createAgentTask + run
 * 2. rerun —— 等价 createTaskFromItem（新建 task，覆盖 agent_task_id，旧 task 历史保留）
 * 3. listTasksByItem —— 查询某 todo_item 的全部历史任务
 * 4. handleAgentTaskResult —— source result handler：消费对话 + 调用 LLM 生成总结文档
 *
 * 依赖关系（构造注入）：
 * - TodoAppService —— 用于访问 item / list / category / document 4 个子 Service
 * - TaskManager —— 公共任务系统（007 Phase 1）
 * - AiAgentMgrService / AiConfigService —— 总结生成时复用任务的 agent_name + llm_config_name
 *
 * 生命周期注册：
 * - 构造函数末尾调用 taskManager.registerSourceHandler('todo-app', 'agent', handler)
 *   TaskManager 在 task completed 后回调 handler（失败不阻断 completed 状态，
 *   仅在 result_meta 写入 handler_error，见 task-manager.service.ts:302-333）
 */
export class TodoTaskService {
  private readonly app: TodoAppService;
  private readonly taskManager: TaskManager;
  private readonly agentMgr: AiAgentMgrService;
  private readonly configService: AiConfigService;

  constructor(
    app: TodoAppService,
    taskManager: TaskManager,
    agentMgr: AiAgentMgrService,
    configService: AiConfigService,
  ) {
    this.app = app;
    this.taskManager = taskManager;
    this.agentMgr = agentMgr;
    this.configService = configService;

    // 注册 source result handler（TaskManager.completed 后自动回调）
    this.taskManager.registerSourceHandler(
      TODO_TASK_SOURCE,
      'agent',
      this.handleAgentTaskResult.bind(this),
    );
    logger.info('TodoTaskService initialized (source handler registered)');
  }

  /**
   * 由 todo_item 创建并立即运行 Agent 任务。
   *
   * 步骤（§8.2）：
   * 1. 校验 item 存在且未删除
   * 2. collectSubtree 收集子 todo
   * 3. buildPrompt 组装 prompt（§8.3）
   * 4. 解析 category_path
   * 5. TaskManager.createAgentTask → 得到 taskView
   * 6. itemService.updateAgentTaskId 覆盖指向
   * 7. TaskManager.run 异步启动（不阻塞）
   *
   * @throws item 不存在或已软删除时抛错
   */
  createTaskFromItem(itemId: number, options: CreateTaskFromItemOptions): TaskAgentView {
    const itemService = this.app.getItemService();
    const item = itemService.getById(itemId);
    if (!item) {
      throw new Error(`TodoItem ${itemId} not found`);
    }

    // 收集子 todo（按 depth + created_at 排序）
    const subtree = itemService.collectSubtree(itemId);

    // 解析 category_path
    const categoryPath = this.resolveCategoryPath(item.todo_list_id);
    const todoList = this.app.getListService().getById(item.todo_list_id);

    // 组装 prompt
    const prompt = this.buildPrompt(item, subtree, categoryPath, todoList?.name ?? '', options);

    // 委托 TaskManager 创建任务
    const input: AgentTaskCreateInput = {
      source: TODO_TASK_SOURCE,
      source_ref_id: itemId,
      title: item.title,
      prompt,
      agent_name: options.agentName,
      llm_config_name: options.llmConfigName,
    };
    const taskView = this.taskManager.createAgentTask(input);

    // 覆盖 todo_item.agent_task_id 指向（旧 task 历史保留）
    itemService.updateAgentTaskId(itemId, taskView.id);

    // 异步启动任务执行（run 返回 status=running 的视图；执行 fire-and-forget）
    this.taskManager.run(taskView.id);

    logger.info(
      `Task created from todo_item: itemId=${itemId}, taskId=${taskView.id}, agent=${options.agentName}`,
    );
    return taskView;
  }

  /**
   * 重跑任务：语义等价 createTaskFromItem。
   *
   * 新建 task + 新 chat_history + 新总结文档；旧 task 保留为历史可查（§8.6）。
   */
  rerun(itemId: number, options: CreateTaskFromItemOptions): TaskAgentView {
    return this.createTaskFromItem(itemId, options);
  }

  /**
   * 列出某 todo_item 的全部历史任务（按 created_at DESC）。
   */
  listTasksByItem(itemId: number): TaskAgentView[] {
    return this.taskManager.listBySource(TODO_TASK_SOURCE, itemId);
  }

  // =========================================================================
  // 内部：prompt 组装
  // =========================================================================

  /**
   * 按 §8.3 模板组装 prompt。
   *
   * 段落顺序：[任务上下文] [当前 todo] [子任务列表]（按 depth + created_at 排序、缩进）
   *           [运行时补充]（仅 extraPrompt 非空时输出）
   *
   * 子任务缩进规则：depth=1 用 `- `，depth=2 用 `  - `，依此类推。
   */
  private buildPrompt(
    item: TodoItem,
    subtree: Array<TodoItem & { depth: number }>,
    categoryPath: string,
    todoListName: string,
    options: CreateTaskFromItemOptions,
  ): string {
    const lines: string[] = [];

    // [任务上下文]
    lines.push('[任务上下文]');
    lines.push('你正在为以下 todo 任务执行，请基于信息完成任务。');
    lines.push('');

    // [当前 todo]
    lines.push('[当前 todo]');
    lines.push(`标题：${item.title}`);
    lines.push(`描述：${item.description}`);
    lines.push(`任务说明：${item.task_prompt}`);
    lines.push(`所属分类：${categoryPath}`);
    lines.push(`所属待办项目：${todoListName}`);
    lines.push('');

    // [子任务列表]
    if (subtree.length > 0) {
      lines.push('[子任务列表]');
      lines.push('（按 depth + created_at 排序）');
      for (const child of subtree) {
        // depth=1 → 0 个空格，depth=2 → 2 个空格，依此类推
        const indent = '  '.repeat(Math.max(0, child.depth - 1));
        lines.push(`${indent}- ${child.title}：${child.description}`);
      }
      lines.push('');
    }

    // [运行时补充]
    if (options.extraPrompt && options.extraPrompt.trim().length > 0) {
      lines.push('[运行时补充]');
      lines.push(options.extraPrompt);
      lines.push('');
    }

    lines.push('请基于以上信息完成任务，最终给出可执行的方案或结论。');
    return lines.join('\n');
  }

  /**
   * 解析 todo_item 所属的 category 路径（根 → 父，用 ' / ' 连接）。
   *
   * 链路：item.todo_list_id → list.category_id → 沿 parent_id 回溯到根
   * list 无 category 或 category 链断裂时返回空字符串。
   */
  private resolveCategoryPath(listId: number): string {
    const list = this.app.getListService().getById(listId);
    if (!list || list.category_id === null) {
      return '';
    }
    const categoryService = this.app.getCategoryService();

    // 沿 parent_id 回溯到根
    const chain: string[] = [];
    let cursor: number | null = list.category_id;
    const visited = new Set<number>();
    while (cursor !== null) {
      if (visited.has(cursor)) {
        logger.warn(`Detected cycle in category chain at ${cursor}, abort path resolution`);
        break;
      }
      visited.add(cursor);
      // 直接读 DB 获取 category（包括已软删除的，避免误判；路径用名称拼接）
      const row = categoryService.getById(cursor);
      if (!row) break;
      chain.unshift(row.name);
      cursor = row.parent_id;
    }
    return chain.join(' / ');
  }

  // =========================================================================
  // 内部：source result handler
  // =========================================================================

  /**
   * Source result handler：任务完成时由 TaskManager 回调。
   *
   * 步骤（§8.4）：
   * 1. 从 result.rawOutput 取对话 messages
   * 2. generateSummary 生成 markdown 总结
   * 3. 创建 todo_document 关联到 source_ref_id（即 todo_item_id）
   * 4. 返回 { summary_doc_id } 写入 result_meta
   *
   * 失败容错：catch 后返回 { handler_error }，TaskManager 会合并到 result_meta，
   * 不抛错保证 task 已记录的 completed 状态不受影响。
   */
  private async handleAgentTaskResult(
    task: Task,
    result: TaskExecutionResult,
  ): Promise<Record<string, unknown> | void> {
    try {
      if (task.source_ref_id === null) {
        // 防御：todo-app 任务理论上 source_ref_id 永远非空
        return { handler_error: 'task.source_ref_id is null' };
      }

      const messages = (result.rawOutput as AiChatMessage[] | undefined) ?? [];
      const itemView = await this.loadTaskView(task.id);
      if (!itemView) {
        return { handler_error: `task ${task.id} not found when generating summary` };
      }

      const summary = await this.generateSummary(itemView, messages);
      const doc = this.app.getDocumentService().create({
        name: `${task.title}${SUMMARY_DOC_TITLE_SUFFIX}`,
        content: summary,
        todo_item_id: task.source_ref_id,
        todo_list_id: null,
      });

      logger.info(
        `Summary doc generated: taskId=${task.id}, docId=${doc.id}, itemId=${task.source_ref_id}`,
      );
      return { summary_doc_id: doc.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`handleAgentTaskResult failed for task ${task.id}: ${msg}`, err);
      return { handler_error: msg };
    }
  }

  /** 重新加载 TaskAgentView（用于取 agent_name / llm_config_name） */
  private async loadTaskView(taskId: number): Promise<TaskAgentView | undefined> {
    return this.taskManager.getTask(taskId);
  }

  /**
   * 调用 LLM 生成 Markdown 总结（§8.4）。
   *
   * 复用任务自身的 agent_name + llm_config_name（决策 Q-PHASE5-1）：
   *   - agentMgr.getAgent(taskView.agent_name)
   *   - configService.getConfig(taskView.llm_config_name)
   *   - 实例化 AiAgentService（无工具、无 skill、无 memory，单轮调用）
   *   - 消费 sendMessage 流但不保存事件，仅取 getMessages() 最后一条 assistant content
   *
   * @throws LLM 调用失败时抛错，由 handleAgentTaskResult catch
   */
  private async generateSummary(taskView: TaskAgentView, messages: AiChatMessage[]): Promise<string> {
    const agent: AiAgent = await this.agentMgr.getAgent(taskView.agent_name);
    const llmConfig: AiLLMConfig = await this.configService.getConfig(taskView.llm_config_name);

    // 实例化独立的 AiAgentService（无工具、无 skill、无 memory —— 单轮总结）
    const agentService = new AiAgentService(llmConfig, agent, {
      tools: [],
      skills: [],
      memoryPrompt: '',
    });

    // 构造总结指令（§8.4 模板）+ 对话全文精简
    const conversation = this.stringifyConversation(messages);
    const summaryPrompt = [
      '[指令]',
      '请对以下任务执行对话进行总结，输出 Markdown 文档：',
      '1. 任务目标（来自 todo_item 标题）',
      '2. 执行过程要点（关键决策、调用工具及结果）',
      '3. 最终结论 / 输出物',
      '4. 后续建议（可选）',
      '',
      '[对话内容]',
      conversation,
      '',
      '[输出要求]',
      '- 使用 Markdown 语法',
      '- 不超过 800 字',
      '- 不要重复原文细节，做归纳',
    ].join('\n');

    // 消费 sendMessage 流（仅推进，不持久化事件）
    for await (const _event of agentService.sendMessage(summaryPrompt)) {
      // 流式仅用于获取最终 messages；事件本身忽略
      void _event;
    }

    // 取最后一条 assistant 消息作为总结
    const finalMessages = agentService.getMessages();
    for (let i = finalMessages.length - 1; i >= 0; i -= 1) {
      const msg = finalMessages[i];
      if (msg.role === 'assistant' && msg.content && msg.content.trim().length > 0) {
        return msg.content;
      }
    }
    // 兜底：LLM 未返回 assistant 内容时返回占位（保持文档可创建）
    logger.warn(`Summary LLM returned empty assistant message for task ${taskView.id}`);
    return '> LLM 未返回有效总结内容，请查看对话历史。';
  }

  /**
   * 将对话 messages 精简为纯文本（§8.4 「对话全文精简」）。
   *
   * - user / assistant：保留 role 标注 + content
   * - tool 结果：仅保留截断后的结果文本（避免冗长 JSON）
   * - system：跳过（与任务执行无关）
   */
  private stringifyConversation(messages: AiChatMessage[]): string {
    if (messages.length === 0) return '(无对话内容)';
    const lines: string[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') continue;
      const label = msg.role === 'user' ? '用户' : msg.role === 'assistant' ? '助手' : '工具';
      let body = msg.content ?? '';
      if (msg.role === 'tool') {
        // tool 结果截断到 200 字符避免冲淡总结
        body = body.length > 200 ? `${body.slice(0, 200)}...` : body;
      }
      lines.push(`【${label}】${body}`);
    }
    return lines.join('\n');
  }
}
