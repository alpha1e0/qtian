/**
 * splitSelectionToTitles 单元测试
 *
 * 覆盖：空串 / null / undefined / 纯空行 / `\r\n` / 前后空行 /
 *      单行 / 多行 / 含中间空白行 / 不去重。
 */

import { describe, it, expect } from 'vitest';
import { splitSelectionToTitles } from './todo-selection-create';

describe('splitSelectionToTitles', () => {
  it('空串返回空数组', () => {
    expect(splitSelectionToTitles('')).toEqual([]);
  });

  it('null 安全处理为空数组', () => {
    expect(splitSelectionToTitles(null)).toEqual([]);
  });

  it('undefined 安全处理为空数组', () => {
    expect(splitSelectionToTitles(undefined)).toEqual([]);
  });

  it('纯空白字符串（空格 / 制表符）返回空数组', () => {
    expect(splitSelectionToTitles('   ')).toEqual([]);
    expect(splitSelectionToTitles('\t\t')).toEqual([]);
  });

  it('纯空行（多个 \\n）返回空数组', () => {
    expect(splitSelectionToTitles('\n\n\n')).toEqual([]);
  });

  it('混合空白与空行返回空数组', () => {
    expect(splitSelectionToTitles('  \n  \n\t\n')).toEqual([]);
  });

  it('单行（无换行）返回单元素数组', () => {
    expect(splitSelectionToTitles('买菜')).toEqual(['买菜']);
  });

  it('单行前后空白被 trim', () => {
    expect(splitSelectionToTitles('  买菜  ')).toEqual(['买菜']);
  });

  it('多行基本拆分', () => {
    expect(splitSelectionToTitles('买菜\n写报告\n读书')).toEqual([
      '买菜',
      '写报告',
      '读书',
    ]);
  });

  it('兼容 \\r\\n 换行（trim 清掉 \\r）', () => {
    expect(splitSelectionToTitles('买菜\r\n写报告\r\n读书')).toEqual([
      '买菜',
      '写报告',
      '读书',
    ]);
  });

  it('兼容 \\r\\n + 前后空白', () => {
    expect(splitSelectionToTitles('  买菜  \r\n  写报告  ')).toEqual([
      '买菜',
      '写报告',
    ]);
  });

  it('剔除前后空行', () => {
    expect(splitSelectionToTitles('\n\n买菜\n写报告\n\n')).toEqual([
      '买菜',
      '写报告',
    ]);
  });

  it('过滤中间的空白行', () => {
    expect(splitSelectionToTitles('买菜\n\n写报告\n  \n读书')).toEqual([
      '买菜',
      '写报告',
      '读书',
    ]);
  });

  it('不去重：相同标题多次出现都保留', () => {
    expect(splitSelectionToTitles('重复\n重复\n重复')).toEqual([
      '重复',
      '重复',
      '重复',
    ]);
  });

  it('保留 title 内部的空白', () => {
    expect(splitSelectionToTitles('买 菜 任务\n写 报告')).toEqual([
      '买 菜 任务',
      '写 报告',
    ]);
  });

  it('不解析 #N 控制符（描述里的 #数字 视为普通文本）', () => {
    // 这是与 parseQuickItemInput 的关键区别：描述场景不识别优先级控制符
    expect(splitSelectionToTitles('依赖 #3\n备份 #5')).toEqual([
      '依赖 #3',
      '备份 #5',
    ]);
  });

  it('混合 \\n 与 \\r\\n 也能正确拆分', () => {
    expect(splitSelectionToTitles('a\r\nb\nc\r\nd')).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });
});
