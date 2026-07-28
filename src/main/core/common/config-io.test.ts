import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { writeGlobalWebdavConfig, readGlobalWebdavConfig, createDefaultConfigFile } from './config-io';
import { Config, DEFAULT_CONFIG_DATA } from './context';
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

/**
 * createDefaultConfigFile 单测：首次启动 qtian.json 不存在时的默认配置生成。
 *
 * 验证：文件不存在时创建 / 文件已存在不覆盖 / 原子写不残留 .tmp /
 * 写入结果可被 Config.initConfig 正确解析（与 DEFAULT_CONFIG_DATA 往返一致）。
 */
describe('createDefaultConfigFile', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtian-default-config-'));
    configPath = path.join(tmpDir, 'qtian.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('文件不存在时创建默认 qtian.json 并返回 true', () => {
    const created = createDefaultConfigFile(configPath);

    expect(created).toBe(true);
    expect(fs.existsSync(configPath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    // 完整结构等价于 DEFAULT_CONFIG_DATA
    expect(parsed).toEqual(DEFAULT_CONFIG_DATA);
  });

  it('默认配置包含所有期望字段（防御式断言）', () => {
    createDefaultConfigFile(configPath);
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    expect(parsed.ai_assistant.default_agent).toBe('default');
    expect(parsed.ai_assistant.default_llm_config).toBe('default');
    expect(parsed.ai_assistant.max_tool_rounds).toBe(10);
    expect(parsed.ai_assistant.tool_timeout_ms).toBe(30000);
    expect(parsed.ai_assistant.tavily_api_key).toBe('');
    expect(parsed.todo_app.default_category_id).toBeNull();
    expect(parsed.todo_app.default_sort).toBe('created_at');
    expect(parsed.todo_app.show_completed).toBe(true);
    expect(parsed.todo_app.max_category_depth).toBe(4);
    expect(parsed.todo_app.max_todo_item_depth).toBe(4);
    expect(parsed.note_app.default_sort).toBe('updated_at');
    expect(parsed.note_app.max_category_depth).toBe(4);
    expect(parsed.global.webdav.url).toBe('');
    expect(parsed.global.webdav.account_name).toBe('');
    expect(parsed.global.webdav.account_password).toBe('');
    expect(parsed.global.webdav.folder).toBe('');
  });

  it('文件已存在时不覆盖且返回 false', () => {
    const userCustom = { ai_assistant: { default_agent: 'my-agent' }, extra: '保留' };
    fs.writeFileSync(configPath, JSON.stringify(userCustom), 'utf-8');

    const created = createDefaultConfigFile(configPath);

    expect(created).toBe(false);
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(parsed).toEqual(userCustom);
  });

  it('原子写入：不残留 .tmp 文件', () => {
    createDefaultConfigFile(configPath);

    const files = fs.readdirSync(tmpDir);
    expect(files).toContain('qtian.json');
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('写入的默认配置可被 Config.initConfig 正确解析（往返一致性）', async () => {
    createDefaultConfigFile(configPath);

    const cfg = new Config();
    await cfg.initConfig(configPath);

    // 内存默认值与从磁盘加载结果一致（DEFAULT_CONFIG_DATA 单一数据源保证）
    expect(cfg.aiAssistant).toEqual({
      defaultAgent: 'default',
      defaultLlmConfig: 'default',
      maxToolRounds: 10,
      toolTimeoutMs: 30000,
      tavilyApiKey: '',
    });
    expect(cfg.todoApp).toEqual({
      defaultCategoryId: null,
      defaultSort: 'created_at',
      showCompleted: true,
      maxCategoryDepth: 4,
      maxTodoItemDepth: 4,
    });
    expect(cfg.noteApp).toEqual({
      defaultCategoryId: null,
      defaultSort: 'updated_at',
      maxCategoryDepth: 4,
    });
    expect(cfg.global.webdav).toEqual({
      url: '',
      accountName: '',
      accountPassword: '',
      folder: '',
    });
  });
});
