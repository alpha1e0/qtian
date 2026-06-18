/**
 * TodoTaskService 单元测试（Phase 5）
 *
 * 重点覆盖：
 * - buildPrompt：模板段落 + 子任务缩进 + extraPrompt
 * - createTaskFromItem：item 校验、子树收集、agent_task_id 更新、run 调用
 * - rerun：覆盖 agent_task_id，旧 task 历史保留
 * - listTasksByItem：委托 listBySource('todo-app', itemId)
 * - handleAgentTaskResult：成功路径生成 todo_document / 失败路径返回 handler_error
 *
 * Mock 策略：
 * - better-sqlite3：复用 createTodoMemDbFactory（真实 SQL 执行器）
 * - logger：静默
 * - AiAgentService：mock sendMessage 单轮返回固定总结
 * - AiAgentMgrService / AiConfigService：mock getAgent / getConfig
 * - TaskManager：构造 fake（参考 task-manager.service.test.ts createFakeExecutor 模式）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';

vi.mock('better-sqlite3', async () => {
  const { createTodoMemDbFactory } = await import('./todo-mock-db');
  return createTodoMemDbFactory();
});

vi.mock('@/core/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@/core/services/agent/ai-agent.service', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({
    sendMessage: async function* () {
      // 单条 user 消息已被构造；不产出事件，仅在 getMessages 中返回 assistant 总结
    },
    getMessages: () => [
      { role: 'user', content: 'summary instruction', timestamp: 1 },
      { role: 'assistant', content: '## 任务总结\n- 关键点 A\n- 关键点 B', timestamp: 2 },
    ],
    abort: vi.fn(),
  })),
}));

vi.mock('@/core/services/agent/ai-agent-mgr.service', () => ({
  AiAgentMgrService: vi.fn().mockImplementation(() => ({
    getAgent: vi.fn(async (name: string) => ({
      name,
      description: 'mock',
      tools: [],
      instructions: '',
    })),
  })),
}));

vi.mock('@/core/services/common/ai-config.service', () => ({
  AiConfigService: vi.fn().mockImplementation(() => ({
    getConfig: vi.fn(async (name: string) => ({
      base_url: 'http://mock',
      model: name,
      key: 'mock-key',
      temperature: 0.7,
      max_tokens: 1024,
    })),
  })),
}));

import { TodoDb } from './todo-db';
import { TodoAppService } from './todo-app.service';
import { TodoTaskService } from './todo-task.service';
import { AiAgentMgrService } from '@/core/services/agent/ai-agent-mgr.service';
import { AiConfigService } from '@/core/services/common/ai-config.service';
import {
  TaskAgentView,
  Task,
  TaskExecutionResult,
  TaskSource,
  TaskType,
} from '@/core/services/task/task.types';

const SQL_PATH = path.join(process.cwd(), 'data', 'todo-app.sql');

/** 测试用 fake TaskManager */
interface FakeTaskManager {
  // 使用 any 兼容 vi.fn 强类型 mock 签名差异
  createAgentTask: any;
  run: any;
  cancel: any;
  getTask: any;
  listBySource: any;
  registerSourceHandler: any;
  /** 暴露保存的 source handler（测试直接调用以模拟 completed 回调） */
  sourceHandler: ((task: Task, result: TaskExecutionResult) => Promise<any>) | null;
  /** 任务 id 自增计数 */
  seq: number;
  /** 已创建任务列表（listTasksByItem 用） */
  tasks: TaskAgentView[];
}

function createFakeTaskManager(): FakeTaskManager {
  const fake: FakeTaskManager = {
    seq: 0,
    tasks: [],
    sourceHandler: null,
    createAgentTask: vi.fn((input: any) => {
      fake.seq += 1;
      const id = fake.seq;
      const view: TaskAgentView = {
        id,
        type: 'agent' as TaskType,
        source: input.source as TaskSource,
        source_ref_id: input.source_ref_id,
        title: input.title,
        status: 'pending',
        progress: 0,
        error_message: null,
        created_at: Date.now(),
        updated_at: Date.now(),
        prompt: input.prompt,
        agent_name: input.agent_name,
        llm_config_name: input.llm_config_name,
        chat_history_id: null,
        result_meta: null,
      };
      fake.tasks.push(view);
      return view;
    }),
    run: vi.fn((taskId: number) => {
      const v = fake.tasks.find((t) => t.id === taskId);
      if (v) v.status = 'running';
      return v;
    }),
    cancel: vi.fn(() => true),
    getTask: vi.fn((taskId: number) => fake.tasks.find((t) => t.id === taskId)),
    listBySource: vi.fn((_source: string, refId?: number) => {
      if (refId === undefined) return [...fake.tasks];
      return fake.tasks.filter((t) => t.source_ref_id === refId);
    }),
    registerSourceHandler: vi.fn((_source: any, _type: any, handler: any) => {
      fake.sourceHandler = handler;
    }),
  };
  return fake;
}

describe('TodoTaskService', () => {
  let db: TodoDb;
  let app: TodoAppService;
  let fakeMgr: FakeTaskManager;
  let svc: TodoTaskService;
  let AgentMgrCtor: any;
  let ConfigSvcCtor: any;

  beforeEach(() => {
    db = new TodoDb(':memory:', SQL_PATH);
    db.initialize();
    // 不传 taskManager 构造 TodoAppService（仅业务子 Service 就绪）
    app = new TodoAppService(
      db,
      {
        defaultCategoryId: null,
        defaultSort: 'created_at',
        showCompleted: false,
        maxCategoryDepth: 4,
        maxTodoItemDepth: 4,
      },
      '/tmp/mock-attach',
    );
    fakeMgr = createFakeTaskManager();
    // mock 模块为构造器，每次 new 返回新的 mock 实例
    AgentMgrCtor = AiAgentMgrService as any;
    ConfigSvcCtor = AiConfigService as any;
    svc = new TodoTaskService(
      app,
      fakeMgr as any,
      new AgentMgrCtor() as any,
      new ConfigSvcCtor() as any,
    );
  });

  describe('createTaskFromItem', () => {
    it('item 不存在时抛错', () => {
      expect(() =>
        svc.createTaskFromItem(99999, { agentName: 'coder', llmConfigName: 'default' }),
      ).toThrow(/not found/);
    });

    it('正常流程：调用 createAgentTask + run，agent_task_id 更新', () => {
      const list = app.getListService().create({ name: 'L1' });
      const item = app.getItemService().create({ title: 'task1', todo_list_id: list.id });

      const view = svc.createTaskFromItem(item.id, {
        agentName: 'coder',
        llmConfigName: 'default',
      });

      expect(fakeMgr.createAgentTask).toHaveBeenCalledTimes(1);
      expect(fakeMgr.run).toHaveBeenCalledWith(view.id);
      // 验证 taskManager.createAgentTask 入参
      const callArg = fakeMgr.createAgentTask.mock.calls[0][0];
      expect(callArg.source).toBe('todo-app');
      expect(callArg.source_ref_id).toBe(item.id);
      expect(callArg.title).toBe('task1');
      expect(callArg.agent_name).toBe('coder');
      expect(callArg.llm_config_name).toBe('default');
      // agent_task_id 更新
      const after = app.getItemService().getById(item.id);
      expect(after?.agent_task_id).toBe(view.id);
    });

    it('prompt 含 [任务上下文] / [当前 todo] 段落', () => {
      const list = app.getListService().create({ name: 'L1' });
      const item = app.getItemService().create({
        title: '任务A',
        description: 'desc',
        task_prompt: 'do something',
        todo_list_id: list.id,
      });

      svc.createTaskFromItem(item.id, { agentName: 'coder', llmConfigName: 'default' });

      const arg = fakeMgr.createAgentTask.mock.calls[0][0];
      expect(arg.prompt).toContain('[任务上下文]');
      expect(arg.prompt).toContain('[当前 todo]');
      expect(arg.prompt).toContain('标题：任务A');
      expect(arg.prompt).toContain('描述：desc');
      expect(arg.prompt).toContain('任务说明：do something');
      expect(arg.prompt).toContain('所属列表：L1');
    });

    it('有子 todo 时含 [子任务列表] 且按深度缩进', () => {
      const list = app.getListService().create({ name: 'L1' });
      const root = app.getItemService().create({ title: 'root', todo_list_id: list.id });
      const c1 = app.getItemService().create({
        title: 'c1',
        description: 'c1d',
        todo_list_id: list.id,
        parent_id: root.id,
      });
      app.getItemService().create({
        title: 'gc',
        description: 'gcd',
        todo_list_id: list.id,
        parent_id: c1.id,
      });

      svc.createTaskFromItem(root.id, { agentName: 'coder', llmConfigName: 'default' });

      const arg = fakeMgr.createAgentTask.mock.calls[0][0];
      expect(arg.prompt).toContain('[子任务列表]');
      // depth=1 子项以 "- " 开头（无前导空格）
      expect(arg.prompt).toMatch(/^- c1：c1d$/m);
      // depth=2 子项以 "  - " 开头（2 个前导空格）
      expect(arg.prompt).toMatch(/^  - gc：gcd$/m);
    });

    it('有 extraPrompt 时含 [运行时补充] 段落', () => {
      const list = app.getListService().create({ name: 'L1' });
      const item = app.getItemService().create({ title: 't', todo_list_id: list.id });

      svc.createTaskFromItem(item.id, {
        agentName: 'coder',
        llmConfigName: 'default',
        extraPrompt: '重点关注性能',
      });

      const arg = fakeMgr.createAgentTask.mock.calls[0][0];
      expect(arg.prompt).toContain('[运行时补充]');
      expect(arg.prompt).toContain('重点关注性能');
    });

    it('无 extraPrompt 时不含 [运行时补充] 段落', () => {
      const list = app.getListService().create({ name: 'L1' });
      const item = app.getItemService().create({ title: 't', todo_list_id: list.id });

      svc.createTaskFromItem(item.id, { agentName: 'coder', llmConfigName: 'default' });

      const arg = fakeMgr.createAgentTask.mock.calls[0][0];
      expect(arg.prompt).not.toContain('[运行时补充]');
    });

    it('category_path 解析：item.todo_list_id → list.category_id → 父链', () => {
      const cat = app.getCategoryService().create({ name: '根', parent_id: null });
      const subCat = app.getCategoryService().create({ name: '子', parent_id: cat.id });
      const list = app.getListService().create({ name: 'L1', category_id: subCat.id });
      const item = app.getItemService().create({ title: 't', todo_list_id: list.id });

      svc.createTaskFromItem(item.id, { agentName: 'coder', llmConfigName: 'default' });

      const arg = fakeMgr.createAgentTask.mock.calls[0][0];
      expect(arg.prompt).toContain('所属分类：根 / 子');
    });
  });

  describe('rerun', () => {
    it('新建 task 并覆盖 agent_task_id，旧 task 历史保留', () => {
      const list = app.getListService().create({ name: 'L1' });
      const item = app.getItemService().create({ title: 't', todo_list_id: list.id });

      const v1 = svc.createTaskFromItem(item.id, {
        agentName: 'coder',
        llmConfigName: 'default',
      });
      const v2 = svc.rerun(item.id, { agentName: 'coder', llmConfigName: 'default' });

      // agent_task_id 已覆盖为最新
      const after = app.getItemService().getById(item.id);
      expect(after?.agent_task_id).toBe(v2.id);
      // 旧 task 历史仍在 listTasksByItem
      const list_ = svc.listTasksByItem(item.id);
      expect(list_.map((t) => t.id).sort()).toEqual([v1.id, v2.id].sort());
    });
  });

  describe('listTasksByItem', () => {
    it('委托 listBySource("todo-app", itemId)', () => {
      const list = app.getListService().create({ name: 'L1' });
      const item = app.getItemService().create({ title: 't', todo_list_id: list.id });
      svc.createTaskFromItem(item.id, { agentName: 'coder', llmConfigName: 'default' });

      const result = svc.listTasksByItem(item.id);
      expect(fakeMgr.listBySource).toHaveBeenCalledWith('todo-app', item.id);
      expect(result).toHaveLength(1);
      expect(result[0].source_ref_id).toBe(item.id);
    });
  });

  describe('handleAgentTaskResult', () => {
    it('LLM 成功 → 创建 todo_document，返回 { summary_doc_id }', async () => {
      const list = app.getListService().create({ name: 'L1' });
      const item = app.getItemService().create({ title: 'task', todo_list_id: list.id });
      const view = svc.createTaskFromItem(item.id, {
        agentName: 'coder',
        llmConfigName: 'default',
      });

      // 模拟 TaskManager 完成后回调 handler
      const fakeTask: Task = {
        id: view.id,
        type: 'agent',
        source: 'todo-app',
        source_ref_id: item.id,
        title: 'task',
        status: 'completed',
        progress: 100,
        error_message: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      const fakeResult: TaskExecutionResult = {
        meta: { chat_history_id: 'h-1' },
        rawOutput: [
          { role: 'user', content: 'do it', timestamp: 1 },
          { role: 'assistant', content: 'done', timestamp: 2 },
        ],
      };

      const meta = await fakeMgr.sourceHandler!(fakeTask, fakeResult);
      expect(meta).toBeDefined();
      expect(meta.summary_doc_id).toBeGreaterThan(0);

      // 验证 todo_document 已创建
      const docs = app.getDocumentService().listByItem(item.id);
      expect(docs).toHaveLength(1);
      expect(docs[0].name).toContain('任务总结');
      expect(docs[0].content).toContain('任务总结');
      expect(docs[0].todo_item_id).toBe(item.id);
    });

    it('source_ref_id 为 null 时返回 handler_error', async () => {
      const fakeTask: Task = {
        id: 1,
        type: 'agent',
        source: 'todo-app',
        source_ref_id: null,
        title: 't',
        status: 'completed',
        progress: 100,
        error_message: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      const meta = await fakeMgr.sourceHandler!(fakeTask, { rawOutput: [] });
      expect(meta).toBeDefined();
      expect(meta.handler_error).toMatch(/source_ref_id/);
    });

    it('LLM 抛错时不抛出，返回 handler_error', async () => {
      // 通过反射调用 private handler，使其内部 generateSummary 抛错
      // 这里直接模拟 AiAgentMgrService.getAgent 抛错路径
      const failingAgentMgr = {
        getAgent: vi.fn().mockRejectedValue(new Error('agent not found')),
      };
      const svcFailing = new TodoTaskService(
        app,
        fakeMgr as any,
        failingAgentMgr as any,
        new ConfigSvcCtor() as any,
      );

      const list = app.getListService().create({ name: 'L1' });
      const item = app.getItemService().create({ title: 't', todo_list_id: list.id });
      // 通过 svcFailing 真实创建 task（注册到 fakeMgr.tasks，保证 loadTaskView 能取到）
      const view = svcFailing.createTaskFromItem(item.id, {
        agentName: 'coder',
        llmConfigName: 'default',
      });

      const fakeTask: Task = {
        id: view.id,
        type: 'agent',
        source: 'todo-app',
        source_ref_id: item.id,
        title: 't',
        status: 'completed',
        progress: 100,
        error_message: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      // 直接调用 svcFailing 的 handler（failingAgentMgr 会让 generateSummary 抛错）
      const handler = (svcFailing as any).handleAgentTaskResult.bind(svcFailing);
      const meta = await handler(fakeTask, {
        meta: {},
        rawOutput: [{ role: 'user', content: 'q', timestamp: 1 }],
      });
      expect(meta).toBeDefined();
      expect(meta.handler_error).toBeDefined();
    });
  });
});
