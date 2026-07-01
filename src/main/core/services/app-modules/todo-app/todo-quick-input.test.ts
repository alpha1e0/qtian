/**
 * parseQuickItemInput 单元测试
 *
 * 覆盖：#1-#4 映射、无控制符默认、前后空白剔除、title 为空抛错、
 *      非法 #N（#0/#5/#）保留原样、控制符仅结尾生效。
 */

import { describe, it, expect } from 'vitest';
import { parseQuickItemInput, DEFAULT_QUICK_PRIORITY } from './todo-quick-input';

describe('parseQuickItemInput', () => {
  describe('优先级映射（#N 结尾）', () => {
    it('#4 → urgent', () => {
      expect(parseQuickItemInput('买菜 #4')).toEqual({ title: '买菜', priority: 'urgent' });
    });

    it('#3 → important', () => {
      expect(parseQuickItemInput('写报告 #3')).toEqual({ title: '写报告', priority: 'important' });
    });

    it('#2 → normal', () => {
      expect(parseQuickItemInput('读书 #2')).toEqual({ title: '读书', priority: 'normal' });
    });

    it('#1 → hint', () => {
      expect(parseQuickItemInput('散步 #1')).toEqual({ title: '散步', priority: 'hint' });
    });
  });

  describe('空白剔除', () => {
    it('剔除控制符前的空白', () => {
      expect(parseQuickItemInput('买菜    #4').title).toBe('买菜');
    });

    it('剔除结尾控制符后的空白', () => {
      // 末尾空白由正则 \s*$ 吸收
      const r = parseQuickItemInput('买菜 #4   ');
      expect(r.priority).toBe('urgent');
      expect(r.title).toBe('买菜');
    });

    it('控制符紧贴标题（无前导空白）也能识别', () => {
      expect(parseQuickItemInput('买菜#4')).toEqual({ title: '买菜', priority: 'urgent' });
    });

    it('保留 title 内部的空白', () => {
      expect(parseQuickItemInput('买 菜 任务 #4').title).toBe('买 菜 任务');
    });
  });

  describe('无控制符', () => {
    it('默认优先级为 normal', () => {
      expect(parseQuickItemInput('开会')).toEqual({ title: '开会', priority: DEFAULT_QUICK_PRIORITY });
    });

    it('默认优先级值等于 normal', () => {
      expect(DEFAULT_QUICK_PRIORITY).toBe('normal');
    });
  });

  describe('非法 / 边界情形', () => {
    it('#5 不识别（保留原样、优先级 normal）', () => {
      // #5 不在 [1-4]，正则不匹配，整段作为 title
      expect(parseQuickItemInput('备份 #5')).toEqual({ title: '备份 #5', priority: 'normal' });
    });

    it('#0 不识别', () => {
      expect(parseQuickItemInput('任务 #0')).toEqual({ title: '任务 #0', priority: 'normal' });
    });

    it('孤立的 # 不识别', () => {
      expect(parseQuickItemInput('任务 #')).toEqual({ title: '任务 #', priority: 'normal' });
    });

    it('仅结尾匹配：开头的 #4 视为普通文本', () => {
      expect(parseQuickItemInput('#4 买菜')).toEqual({ title: '#4 买菜', priority: 'normal' });
    });

    it('多个控制符：仅匹配最后一个（前者保留在 title）', () => {
      expect(parseQuickItemInput('任务 #2 #4')).toEqual({ title: '任务 #2', priority: 'urgent' });
    });

    it('title 为空抛错（仅有控制符）', () => {
      expect(() => parseQuickItemInput('#4')).toThrow(/empty/i);
      expect(() => parseQuickItemInput('  #3  ')).toThrow(/empty/i);
    });

    it('空字符串抛错', () => {
      expect(() => parseQuickItemInput('')).toThrow(/empty/i);
    });

    it('仅空白抛错', () => {
      expect(() => parseQuickItemInput('    ')).toThrow(/empty/i);
    });

    it('null/undefined 安全处理为空串并抛错', () => {
      expect(() => parseQuickItemInput(null as unknown as string)).toThrow(/empty/i);
      expect(() => parseQuickItemInput(undefined as unknown as string)).toThrow(/empty/i);
    });
  });
});
