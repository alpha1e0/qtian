/**
 * WPath 默认工作空间路径解析单测
 *
 * 仅测纯函数 resolveDefaultWorkspacePath（不实例化 WPath，
 * 避免在测试机上触发真实目录创建；模块导入时的 WPath 单例
 * 由 .env.test 的 QTIAN_WORKSPACE 指向测试目录）。
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';

import { resolveDefaultWorkspacePath } from './context';

describe('resolveDefaultWorkspacePath', () => {
  it('Windows：提供 LOCALAPPDATA 时使用 %LOCALAPPDATA%/Qtian/workspace', () => {
    const result = resolveDefaultWorkspacePath('/home/user', 'C:\\Users\\user\\AppData\\Local');
    expect(result).toBe(path.join('C:\\Users\\user\\AppData\\Local', 'Qtian', 'workspace'));
  });

  it('macOS/Linux：无 LOCALAPPDATA 时使用 ~/.qtian/workspace', () => {
    const result = resolveDefaultWorkspacePath('/home/alpha');
    expect(result).toBe(path.join('/home/alpha', '.qtian', 'workspace'));
  });

  it('LOCALAPPDATA 为空串时视为未设置，回退到 ~/.qtian/workspace', () => {
    const result = resolveDefaultWorkspacePath('/home/alpha', '');
    expect(result).toBe(path.join('/home/alpha', '.qtian', 'workspace'));
  });
});
