import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { writeGlobalWebdavConfig, readGlobalWebdavConfig } from './config-io';
import type { WebdavConfig } from './context';

/**
 * config-io 单测：原子写 / 读取 qtian.json 的 global.webdav 段。
 *
 * 直接操作真实临时文件（不经过 vitest.setup.ts 的全局 mock），
 * 验证：空文件 / 已有段混写 / 清空 / 临时文件无残留 / 异常路径。
 */
describe('config-io', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtian-config-io-'));
    configPath = path.join(tmpDir, 'qtian.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const sampleConfig: WebdavConfig = {
    url: 'https://dav.example.com',
    accountName: 'user1',
    accountPassword: 'pass1',
    folder: 'qtian',
  };

  it('写入到不存在的 qtian.json（从空创建）', () => {
    writeGlobalWebdavConfig(configPath, sampleConfig);

    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.global.webdav).toEqual({
      url: 'https://dav.example.com',
      account_name: 'user1',
      account_password: 'pass1',
      folder: 'qtian',
    });
  });

  it('保留已有的其他配置段（ai_assistant / todo_app）', () => {
    const existing = {
      ai_assistant: { default_agent: 'alpha' },
      todo_app: { default_sort: 'created_at' },
      global: { webdav: { url: 'old', account_name: 'old', account_password: 'x', folder: 'y' } },
    };
    fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), 'utf-8');

    writeGlobalWebdavConfig(configPath, sampleConfig);

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(parsed.ai_assistant.default_agent).toBe('alpha');
    expect(parsed.todo_app.default_sort).toBe('created_at');
    expect(parsed.global.webdav.url).toBe('https://dav.example.com');
    expect(parsed.global.webdav.account_name).toBe('user1');
  });

  it('原子写入：不残留 .tmp 文件', () => {
    writeGlobalWebdavConfig(configPath, sampleConfig);

    const files = fs.readdirSync(tmpDir);
    expect(files).toContain('qtian.json');
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('清空配置：传 null 写入空字段', () => {
    writeGlobalWebdavConfig(configPath, sampleConfig);
    writeGlobalWebdavConfig(configPath, null);

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(parsed.global.webdav).toEqual({
      url: '',
      account_name: '',
      account_password: '',
      folder: '',
    });
  });

  it('readGlobalWebdavConfig 读取并转为 camelCase', () => {
    writeGlobalWebdavConfig(configPath, sampleConfig);

    const result = readGlobalWebdavConfig(configPath);
    expect(result).toEqual(sampleConfig);
  });

  it('readGlobalWebdavConfig 文件不存在时返回 null', () => {
    expect(readGlobalWebdavConfig(configPath)).toBeNull();
  });

  it('readGlobalWebdavConfig 段缺失时返回 null', () => {
    fs.writeFileSync(configPath, JSON.stringify({ ai_assistant: {} }), 'utf-8');
    expect(readGlobalWebdavConfig(configPath)).toBeNull();
  });

  it('readGlobalWebdavConfig 全空字段视为未配置返回 null', () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ global: { webdav: { url: '', account_name: '', account_password: '', folder: '' } } }),
      'utf-8',
    );
    expect(readGlobalWebdavConfig(configPath)).toBeNull();
  });

  it('写入损坏的 JSON 时从空重建不抛错', () => {
    fs.writeFileSync(configPath, '{ broken json', 'utf-8');

    expect(() => writeGlobalWebdavConfig(configPath, sampleConfig)).not.toThrow();

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(parsed.global.webdav.url).toBe('https://dav.example.com');
  });

  it('readGlobalWebdavConfig 读取损坏 JSON 返回 null', () => {
    fs.writeFileSync(configPath, '{ broken', 'utf-8');
    expect(readGlobalWebdavConfig(configPath)).toBeNull();
  });

  it('往返一致性：写入后读取应等价', () => {
    const cfg: WebdavConfig = {
      url: 'https://cloud.test',
      accountName: 'me',
      accountPassword: 'secret',
      folder: 'backup',
    };
    writeGlobalWebdavConfig(configPath, cfg);
    expect(readGlobalWebdavConfig(configPath)).toEqual(cfg);
  });
});
