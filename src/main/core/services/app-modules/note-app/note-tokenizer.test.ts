/**
 * NoteTokenizer 单元测试
 *
 * 重点：中英文混合分词、空白过滤、大小写归一化、空输入容错、纯标点过滤。
 * 使用真实 @node-rs/jieba（与 search.service.test 互不影响）。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NoteTokenizer } from './note-tokenizer';

describe('NoteTokenizer', () => {
  let tokenizer: NoteTokenizer;

  beforeEach(() => {
    tokenizer = new NoteTokenizer();
  });

  it('中文文本应被切成多个 token（非整段）', () => {
    const result = tokenizer.cut('我喜欢编程');
    const tokens = result.split(' ').filter(Boolean);
    expect(tokens.length).toBeGreaterThanOrEqual(2);
    expect(result.includes('  ')).toBe(false);
  });

  it('英文文本应按空格切分并小写化', () => {
    const result = tokenizer.cut('Hello World FOO');
    expect(result).toBe('hello world foo');
  });

  it('中英文混合应被正确切分', () => {
    const result = tokenizer.cut('使用 Electron 开发');
    expect(result).toContain('electron');
    const tokens = result.split(' ').filter(Boolean);
    expect(tokens.length).toBeGreaterThanOrEqual(2);
  });

  it('空白字符串应返回空串', () => {
    expect(tokenizer.cut('')).toBe('');
    expect(tokenizer.cut('   ')).toBe('');
    expect(tokenizer.cut('\n\t')).toBe('');
  });

  it('大小写归一化：全部转小写', () => {
    expect(tokenizer.cut('CamelCase')).toBe('camelcase');
    expect(tokenizer.cut('UPPER')).toBe('upper');
  });

  it('纯标点/符号应被过滤为空串', () => {
    expect(tokenizer.cut('，！。')).toBe('');
    expect(tokenizer.cut('!!!???')).toBe('');
    expect(tokenizer.cut('， ，')).toBe('');
  });

  it('包含标点的文本应去标点后分词', () => {
    const result = tokenizer.cut('工作，计划！');
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toMatch(/[,，!！]/);
  });
});
