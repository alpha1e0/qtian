/**
 * TodoListExchangeService 单元测试
 *
 * 重点：
 * - serialize：list/item/label 序列化为 ExportBundle（剔除 agent_task_id、原 id，label 转 name）
 * - deserialize：bundle 校验、category 校验、深度/数量预校验、label find-or-create、失败回滚
 * - 与 TodoItemService.bulkCreateForImport 协作（不触发进度联动）
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

import { TodoDb } from './todo-db';
import { TodoListService } from './todo-list.service';
import { TodoItemService } from './todo-item.service';
import { TodoLabelService } from './todo-label.service';
import { TodoCategoryService } from './todo-category.service';
import { TodoListExchangeService } from './todo-list-exchange.service';
import {
  TODO_EXPORT_BUNDLE_VERSION,
  TODO_MAX_IMPORT_ITEMS,
  MAX_TODO_ITEM_DEPTH,
} from './types';

const SQL_PATH = path.join(process.cwd(), 'data', 'todo-app.sql');

describe('TodoListExchangeService', () => {
  let db: TodoDb;
  let listSvc: TodoListService;
  let itemSvc: TodoItemService;
  let labelSvc: TodoLabelService;
  let categorySvc: TodoCategoryService;
  let exchange: TodoListExchangeService;

  beforeEach(() => {
    db = new TodoDb(':memory:', SQL_PATH);
    db.initialize();
    const manager = db.getDBManager();
    labelSvc = new TodoLabelService(manager);
    categorySvc = new TodoCategoryService(manager);
    listSvc = new TodoListService(manager, labelSvc);
    itemSvc = new TodoItemService(manager);
    exchange = new TodoListExchangeService(listSvc, itemSvc, labelSvc, categorySvc);
  });

  // =========================================================================
  // serialize
  // =========================================================================
  describe('serialize', () => {
    it('list + 多层 item + label → bundle 结构正确（label 在 list 维度）', () => {
      const cat = categorySvc.create({ name: 'C1' });
      const labelA = labelSvc.create({ name: 'A' });
      const labelB = labelSvc.create({ name: 'B' });
      const list = listSvc.create({
        name: 'L1', description: 'desc', category_id: cat.id, label_ids: [labelA.id, labelB.id],
      });
      const parent = itemSvc.create({
        title: '父', todo_list_id: list.id, progress: 30,
        is_manual_progress: true,
      });
      itemSvc.create({
        title: '子', todo_list_id: list.id, parent_id: parent.id, progress: 60,
      });

      const bundle = exchange.serialize(list.id);

      expect(bundle.version).toBe(TODO_EXPORT_BUNDLE_VERSION);
      expect(typeof bundle.exported_at).toBe('number');
      expect(bundle.list).toEqual({ name: 'L1', description: 'desc' });
      // 标签已迁移到 list 维度
      expect(bundle.labels.sort()).toEqual(['A', 'B']);
      expect(bundle.items).toHaveLength(1);
      const root = bundle.items[0];
      expect(root.title).toBe('父');
      expect(root.progress).toBe(30);
      // item 节点不再携带 labels
      expect((root as any).labels).toBeUndefined();
      expect(root.children).toHaveLength(1);
      expect(root.children[0].title).toBe('子');
      expect(root.children[0].progress).toBe(60);
    });

    it('不导出 agent_task_id / 原 id（断言字段不存在）', () => {
      const list = listSvc.create({ name: 'L', category_id: null });
      itemSvc.create({ title: 't', todo_list_id: list.id });
      const bundle = exchange.serialize(list.id);
      const node = bundle.items[0] as unknown as Record<string, unknown>;
      expect(node).not.toHaveProperty('id');
      expect(node).not.toHaveProperty('agent_task_id');
      expect(node).not.toHaveProperty('parent_id');
    });

    it('软删除 item 不进 bundle', () => {
      const list = listSvc.create({ name: 'L', category_id: null });
      const keep = itemSvc.create({ title: 'keep', todo_list_id: list.id });
      const gone = itemSvc.create({ title: 'gone', todo_list_id: list.id });
      itemSvc.delete(gone.id);
      const bundle = exchange.serialize(list.id);
      const titles = bundle.items.map((n) => n.title);
      expect(titles).toContain('keep');
      expect(titles).not.toContain('gone');
      // 显式确认 keep 还在
      expect(keep.id).toBeGreaterThan(0);
    });

    it('list 不存在时抛错', () => {
      expect(() => exchange.serialize(99999)).toThrow(/not found/);
    });

    it('空 list → items 为 []', () => {
      const list = listSvc.create({ name: 'empty', category_id: null });
      const bundle = exchange.serialize(list.id);
      expect(bundle.items).toEqual([]);
    });
  });

  // =========================================================================
  // deserialize
  // =========================================================================
  describe('deserialize', () => {
    /** 构造合法 bundle 工厂 */
    const makeBundle = (overrides: Partial<{
      name: string; description: string; items: any[]; version: number; labels: string[];
    }> = {}) => ({
      version: overrides.version ?? TODO_EXPORT_BUNDLE_VERSION,
      exported_at: Date.now(),
      list: { name: overrides.name ?? '导入项目', description: overrides.description ?? '' },
      labels: overrides.labels ?? [],
      items: overrides.items ?? [],
    });

    it('正常 bundle：新建 list + 重建 item 树 + parent_id 链', () => {
      const cat = categorySvc.create({ name: 'C' });
      const bundle = makeBundle({
        items: [
          {
            title: '父', description: '', task_prompt: '', status: 'init', progress: 40,
            priority: 'normal', due_at: null, is_manual_progress: false,
            children: [
              { title: '子', description: '', task_prompt: '', status: 'init', progress: 0, priority: 'normal', due_at: null, is_manual_progress: false, children: [] },
            ],
          },
        ],
      });

      const result = exchange.deserialize(bundle, cat.id);

      expect(result.itemCount).toBe(2);
      const list = listSvc.getById(result.listId);
      expect(list?.name).toBe('导入项目');
      expect(list?.category_id).toBe(cat.id);
      const tree = itemSvc.getTreeByList(result.listId);
      expect(tree).toHaveLength(1);
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].parent_id).toBe(tree[0].id);
    });

    it('version 不符抛错', () => {
      const cat = categorySvc.create({ name: 'C' });
      const bundle = makeBundle({ version: 999 });
      expect(() => exchange.deserialize(bundle, cat.id)).toThrow(/version/);
    });

    it('list.name 缺失抛错', () => {
      const cat = categorySvc.create({ name: 'C' });
      const bad = { version: TODO_EXPORT_BUNDLE_VERSION, exported_at: 1, list: {}, items: [] };
      expect(() => exchange.deserialize(bad as any, cat.id)).toThrow(/list.name/);
    });

    it('items 非数组抛错', () => {
      const cat = categorySvc.create({ name: 'C' });
      const bad = { version: TODO_EXPORT_BUNDLE_VERSION, exported_at: 1, list: { name: 'x' }, items: 'no' };
      expect(() => exchange.deserialize(bad as any, cat.id)).toThrow(/items/);
    });

    it('categoryId 不存在抛错', () => {
      const bundle = makeBundle();
      expect(() => exchange.deserialize(bundle, 99999)).toThrow(/Category/);
    });

    it('categoryId 已软删除抛错', () => {
      const cat = categorySvc.create({ name: 'C' });
      categorySvc.delete(cat.id);
      const bundle = makeBundle();
      expect(() => exchange.deserialize(bundle, cat.id)).toThrow(/Category/);
    });

    it('深度 = MAX 通过，> MAX 抛错（预校验，INSERT 前）', () => {
      const cat = categorySvc.create({ name: 'C' });
      const makeChain = (depth: number) => {
        let node: any = { title: 'leaf', description: '', task_prompt: '', status: 'init', progress: 0, priority: 'normal', due_at: null, is_manual_progress: false, children: [] };
        for (let i = depth - 1; i > 0; i--) {
          node = { title: `L${i}`, description: '', task_prompt: '', status: 'init', progress: 0, priority: 'normal', due_at: null, is_manual_progress: false, children: [node] };
        }
        return [node];
      };
      // depth=MAX 通过
      expect(() => exchange.deserialize(makeBundle({ items: makeChain(MAX_TODO_ITEM_DEPTH) }), cat.id)).not.toThrow();
      // depth=MAX+1 抛错
      expect(() => exchange.deserialize(makeBundle({ items: makeChain(MAX_TODO_ITEM_DEPTH + 1) }), cat.id)).toThrow(/MAX_TODO_ITEM_DEPTH/);
    });

    it('标签 find-or-create（list 维度）：已存在用现成 id，不存在的建后挂', () => {
      const cat = categorySvc.create({ name: 'C' });
      const existing = labelSvc.create({ name: '已存在' });
      const beforeCount = labelSvc.list().length;

      const bundle = makeBundle({
        labels: ['已存在', '新标签'],
        items: [
          { title: 'A', description: '', task_prompt: '', status: 'init', progress: 0, priority: 'normal', due_at: null, is_manual_progress: false, children: [] },
        ],
      });
      const result = exchange.deserialize(bundle, cat.id);

      // 新标签被建出来，原标签未重建
      expect(labelSvc.list().length).toBe(beforeCount + 1);
      const list = listSvc.getById(result.listId);
      const labels = labelSvc.list();
      const attached = (list?.label_ids ?? []).map((id) => labels.find((l) => l.id === id)?.name).sort();
      expect(attached).toEqual(['已存在', '新标签']);
      // 原标签 id 被复用
      expect(list?.label_ids).toContain(existing.id);
    });

    it('标签 name 在回收站（软删）→ 视为不存在，允许新建同名', () => {
      const cat = categorySvc.create({ name: 'C' });
      const ghost = labelSvc.create({ name: '幽灵' });
      labelSvc.delete(ghost.id); // 进回收站

      const bundle = makeBundle({
        labels: ['幽灵'],
        items: [
          { title: 'A', description: '', task_prompt: '', status: 'init', progress: 0, priority: 'normal', due_at: null, is_manual_progress: false, children: [] },
        ],
      });
      const result = exchange.deserialize(bundle, cat.id);

      const list = listSvc.getById(result.listId);
      const attachedName = labelSvc.list().find((l) => l.id === (list?.label_ids ?? [])[0])?.name;
      expect(attachedName).toBe('幽灵');
    });

    it('条目数超过 TODO_MAX_IMPORT_ITEMS 抛错', () => {
      const cat = categorySvc.create({ name: 'C' });
      const items = Array.from({ length: TODO_MAX_IMPORT_ITEMS + 1 }, (_, i) => ({
        title: `t${i}`, description: '', task_prompt: '', status: 'init', progress: 0,
        priority: 'normal', due_at: null, is_manual_progress: false, children: [],
      }));
      expect(() => exchange.deserialize(makeBundle({ items }), cat.id)).toThrow(/exceed limit/);
    });

    it('title 缺失 → 预校验在 list 创建前抛错，未创建 list', () => {
      const cat = categorySvc.create({ name: 'C' });
      const purgeSpy = vi.spyOn(listSvc, 'purge');
      const bundle = makeBundle({
        items: [
          { title: '', description: '', task_prompt: '', status: 'init', progress: 0, priority: 'normal', due_at: null, is_manual_progress: false, labels: [], children: [] },
        ],
      });

      expect(() => exchange.deserialize(bundle, cat.id)).toThrow(/title missing/);
      // list 还没创建即抛错，无需回滚
      expect(purgeSpy).not.toHaveBeenCalled();
      expect(listSvc.list(cat.id)).toHaveLength(0);
    });

    it('bulkCreateForImport 抛错 → 已创建的 list 被回滚（delete + purge）', () => {
      const cat = categorySvc.create({ name: 'C' });
      const purgeSpy = vi.spyOn(listSvc, 'purge');
      // 模拟重建阶段失败（precheck 已通过，list 已创建）
      vi.spyOn(itemSvc, 'bulkCreateForImport').mockImplementation(() => {
        throw new Error('boom');
      });
      const bundle = makeBundle({
        items: [
          { title: '正常', description: '', task_prompt: '', status: 'init', progress: 0, priority: 'normal', due_at: null, is_manual_progress: false, labels: [], children: [] },
        ],
      });

      expect(() => exchange.deserialize(bundle, cat.id)).toThrow(/boom/);
      expect(purgeSpy).toHaveBeenCalled();
      // 该 category 下不应残留任何 list（被回滚）
      expect(listSvc.list(cat.id)).toHaveLength(0);
    });

    it('与 serialize 互为逆运算：导出后导入，结构等价', () => {
      const cat = categorySvc.create({ name: 'C' });
      const labelX = labelSvc.create({ name: 'X' });
      // 标签挂 list 维度；parent 用 is_manual_progress=true，避免 create('c') 时进度联动改写 parent.progress
      const list = listSvc.create({
        name: '原始', description: 'd', category_id: cat.id, label_ids: [labelX.id],
      });
      const parent = itemSvc.create({
        title: 'p', todo_list_id: list.id, progress: 55, is_manual_progress: true,
      });
      itemSvc.create({ title: 'c', todo_list_id: list.id, parent_id: parent.id, progress: 10 });

      const bundle = exchange.serialize(list.id);
      const result = exchange.deserialize(bundle, cat.id);

      // 新 list 与原 list 同名、同 category、label 迁移到 list 维度
      const newList = listSvc.getById(result.listId);
      expect(newList?.name).toBe('原始');
      expect(newList?.category_id).toBe(cat.id);
      expect(newList?.label_ids).toContain(labelX.id);
      // 结构等价（不含 id）；parent.is_manual_progress=true，progress 保持 55 不被联动改写
      const newTree = itemSvc.getTreeByList(result.listId);
      expect(newTree).toHaveLength(1);
      expect(newTree[0].title).toBe('p');
      expect(newTree[0].progress).toBe(55);
      expect(newTree[0].is_manual_progress).toBe(true);
      expect(newTree[0].children).toHaveLength(1);
      expect(newTree[0].children[0].title).toBe('c');
      expect(newTree[0].children[0].progress).toBe(10);
    });
  });
});
