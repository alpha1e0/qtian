/**
 * buildExportFileName 单元测试
 *
 * 重点：名称安全化（非法字符替换）、空名回退、时间戳格式、长度限制、默认参数。
 */

import { describe, it, expect } from 'vitest';
import { buildExportFileName } from './todo-export-filename';

// 固定时间戳：2026-06-25 12:00:00 UTC → 本地时区由运行环境决定，
// 但同一进程内 getFullYear/getMonth 等返回一致，断言时用同一 Date 反推。
const FIXED_NOW = new Date(2026, 5, 25, 12, 0, 0).getTime();

describe('buildExportFileName', () => {
  it('正常名称应拼为 `<name>-<YYYYMMDDHHmmss>.json`', () => {
    const name = buildExportFileName('我的项目', FIXED_NOW);
    // 校验前缀与后缀结构，时间戳不写死以避免时区问题
    expect(name.startsWith('我的项目-')).toBe(true);
    expect(name.endsWith('.json')).toBe(true);
    // 中间应该是 14 位数字（YYYYMMDDHHmmss）
    const ts = name.slice('我的项目-'.length, name.length - '.json'.length);
    expect(/^\d{14}$/.test(ts)).toBe(true);
  });

  it('时间戳应与传入的 now 一致（年月日时分秒）', () => {
    const name = buildExportFileName('demo', FIXED_NOW);
    // 期望秒级两位补零：12:00:00 → HHmmss 末两位 '00'
    expect(name).toMatch(/120000\.json$/);
  });

  it('名称包含 Windows 非法字符应全部替换为 `_`', () => {
    const name = buildExportFileName('a\\b/c:d*e?f"g<h>i|j', FIXED_NOW);
    // `:` `<` `>` 等都被替换，trim 后不会出现非法字符
    expect(name.startsWith('a_b_c_d_e_f_g_h_i_j-')).toBe(true);
  });

  it('名称包含控制字符应被替换为 `_`', () => {
    const name = buildExportFileName('a\u0000b\u001fc', FIXED_NOW);
    expect(name.startsWith('a_b_c-')).toBe(true);
  });

  it('名称两端空白应被 trim', () => {
    const name = buildExportFileName('   hello   ', FIXED_NOW);
    expect(name.startsWith('hello-')).toBe(true);
  });

  it('名称仅含非法字符（trim 后为空）应回退为 todolist-<listId>', () => {
    const name = buildExportFileName('///', FIXED_NOW, 42);
    expect(name.startsWith('todolist-42-')).toBe(true);
  });

  it('名称为空字符串应回退为 todolist-<listId>', () => {
    const name = buildExportFileName('', FIXED_NOW, 7);
    expect(name.startsWith('todolist-7-')).toBe(true);
  });

  it('名称为 null/undefined 应回退为 todolist-<listId>', () => {
    expect(buildExportFileName(null as unknown as string, FIXED_NOW, 7).startsWith('todolist-7-')).toBe(true);
    expect(buildExportFileName(undefined as unknown as string, FIXED_NOW, 7).startsWith('todolist-7-')).toBe(true);
  });

  it('回退时未提供 listId 应使用 unknown 占位', () => {
    const name = buildExportFileName('', FIXED_NOW);
    expect(name.startsWith('todolist-unknown-')).toBe(true);
  });

  it('名称超长应被截断到上限以内', () => {
    const longName = 'A'.repeat(200);
    const name = buildExportFileName(longName, FIXED_NOW);
    // base 部分长度上限 60，文件名应匹配 `<1~60 个 A>-YYYYMMDDHHmmss.json`
    expect(/^A{1,60}-\d{14}\.json$/.test(name)).toBe(true);
  });

  it('默认参数（不传 now）应使用当前时间，结构合法', () => {
    const name = buildExportFileName('auto');
    expect(/^auto-\d{14}\.json$/.test(name)).toBe(true);
  });
});
