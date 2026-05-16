/**
 * McpConfigService 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as context from '@/core/common/context';
import { McpConfigService } from '@/core/services/tools/mcp-config.service';
import {
  getTestAssistantToolDir,
  setupTestAssistantEnvironment,
  finalAssistantCleanup,
  initAssistantTestState,
  markAssistantTestFailed,
} from '#testing/scripts/ai-assistant-test-helper';

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

const TEST_FILE = 'test_mcp-config.service';
const CONFIG_FILE = 'mcp.setting.json';

/** 测试用 MCP 服务器配置 */
const TEST_SERVER_A = {
  name: 'filesystem',
  command: 'npx',
  args: ['-y', '@anthropic/mcp-filesystem'],
  env: { FS_ROOT: '/tmp' },
  enabled: true,
};

const TEST_SERVER_B = {
  name: 'web-search',
  command: 'node',
  args: ['search-server.js'],
  enabled: false,
};

/** 测试用远程 MCP 服务器配置 */
const TEST_REMOTE_SERVER = {
  type: 'remote' as const,
  name: 'remote-api',
  url: 'https://example.com/mcp',
  headers: { Authorization: 'Bearer token123' },
  enabled: true,
};

let testToolDir: string;
let service: McpConfigService;

beforeEach(async () => {
  initAssistantTestState(TEST_FILE);
  testToolDir = getTestAssistantToolDir(TEST_FILE);
  await fs.rm(testToolDir, { recursive: true, force: true });
  await setupTestAssistantEnvironment(testToolDir);

  vi.spyOn(context.wpath, 'assistantToolDir', 'get').mockReturnValue(testToolDir);
  service = new McpConfigService();
});

afterEach(async () => {
  await finalAssistantCleanup(TEST_FILE);
  vi.restoreAllMocks();
});

describe('McpConfigService', () => {
  describe('getConfig', () => {
    it('配置文件不存在时返回默认空配置', async () => {
      const config = await service.getConfig();
      expect(config).toEqual({ servers: [] });
    });

    it('正确读取已有配置文件', async () => {
      const setting = { servers: [TEST_SERVER_A, TEST_SERVER_B] };
      await fs.writeFile(
        `${testToolDir}/${CONFIG_FILE}`,
        JSON.stringify(setting, null, 2),
        'utf-8'
      );

      const config = await service.getConfig();
      expect(config.servers).toHaveLength(2);
      expect(config.servers[0].name).toBe('filesystem');
      expect(config.servers[1].name).toBe('web-search');
    });

    it('配置文件格式损坏时返回默认空配置', async () => {
      await fs.writeFile(`${testToolDir}/${CONFIG_FILE}`, 'invalid json', 'utf-8');

      const config = await service.getConfig();
      expect(config).toEqual({ servers: [] });
    });
  });

  describe('saveConfig', () => {
    it('保存配置到文件', async () => {
      const setting = { servers: [TEST_SERVER_A] };
      await service.saveConfig(setting);

      const content = await fs.readFile(`${testToolDir}/${CONFIG_FILE}`, 'utf-8');
      const saved = JSON.parse(content);
      expect(saved.servers).toHaveLength(1);
      expect(saved.servers[0].name).toBe('filesystem');
    });

    it('自动创建配置目录', async () => {
      const newDir = `${testToolDir}/nested`;
      vi.spyOn(context.wpath, 'assistantToolDir', 'get').mockReturnValue(newDir);

      const newService = new McpConfigService();
      await newService.saveConfig({ servers: [TEST_SERVER_B] });

      const content = await fs.readFile(`${newDir}/${CONFIG_FILE}`, 'utf-8');
      expect(JSON.parse(content).servers).toHaveLength(1);
    });
  });

  describe('listServers', () => {
    it('无配置时返回空数组', async () => {
      const servers = await service.listServers();
      expect(servers).toEqual([]);
    });

    it('返回所有服务器配置', async () => {
      await service.saveConfig({ servers: [TEST_SERVER_A, TEST_SERVER_B] });
      const servers = await service.listServers();
      expect(servers).toHaveLength(2);
    });
  });

  describe('getServer', () => {
    it('找到指定名称的服务器', async () => {
      await service.saveConfig({ servers: [TEST_SERVER_A, TEST_SERVER_B] });

      const server = await service.getServer('web-search');
      expect(server).toBeDefined();
      expect(server!.name).toBe('web-search');
      expect(server!.enabled).toBe(false);
    });

    it('找不到时返回 undefined', async () => {
      await service.saveConfig({ servers: [TEST_SERVER_A] });

      const server = await service.getServer('non-existent');
      expect(server).toBeUndefined();
    });
  });

  describe('saveServer', () => {
    it('添加新服务器', async () => {
      await service.saveServer(TEST_SERVER_A);

      const config = await service.getConfig();
      expect(config.servers).toHaveLength(1);
      expect(config.servers[0].name).toBe('filesystem');
    });

    it('更新已有服务器 (同名覆盖)', async () => {
      await service.saveServer(TEST_SERVER_A);
      const updated = { ...TEST_SERVER_A, args: ['-y', '@anthropic/mcp-filesystem-v2'] };
      await service.saveServer(updated);

      const config = await service.getConfig();
      expect(config.servers).toHaveLength(1);
      expect(config.servers[0].args).toEqual(['-y', '@anthropic/mcp-filesystem-v2']);
    });
  });

  describe('deleteServer', () => {
    it('删除已有服务器并返回 true', async () => {
      await service.saveConfig({ servers: [TEST_SERVER_A, TEST_SERVER_B] });

      const deleted = await service.deleteServer('filesystem');
      expect(deleted).toBe(true);

      const config = await service.getConfig();
      expect(config.servers).toHaveLength(1);
      expect(config.servers[0].name).toBe('web-search');
    });

    it('删除不存在的服务器返回 false', async () => {
      const deleted = await service.deleteServer('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('getConfigPath', () => {
    it('返回正确的配置文件路径', () => {
      const configPath = service.getConfigPath();
      expect(configPath).toContain(CONFIG_FILE);
      expect(configPath).toContain(testToolDir);
    });
  });

  describe('remote config', () => {
    it('读写远程 MCP 配置', async () => {
      await service.saveConfig({ servers: [TEST_REMOTE_SERVER] });

      const config = await service.getConfig();
      expect(config.servers).toHaveLength(1);
      expect(config.servers[0].type).toBe('remote');
      expect(config.servers[0].name).toBe('remote-api');
    });

    it('混合 local 和 remote 配置', async () => {
      await service.saveConfig({ servers: [TEST_SERVER_A, TEST_REMOTE_SERVER] });

      const config = await service.getConfig();
      expect(config.servers).toHaveLength(2);

      // local 配置无 type 字段
      expect(config.servers[0].name).toBe('filesystem');
      expect((config.servers[0] as any).type).toBeUndefined();

      // remote 配置有 type 字段
      expect(config.servers[1].type).toBe('remote');
    });

    it('获取远程服务器配置', async () => {
      await service.saveConfig({ servers: [TEST_REMOTE_SERVER] });

      const server = await service.getServer('remote-api');
      expect(server).toBeDefined();
      expect(server!.type).toBe('remote');
      expect((server as any).url).toBe('https://example.com/mcp');
    });

    it('删除远程服务器配置', async () => {
      await service.saveConfig({ servers: [TEST_REMOTE_SERVER] });

      const deleted = await service.deleteServer('remote-api');
      expect(deleted).toBe(true);

      const config = await service.getConfig();
      expect(config.servers).toHaveLength(0);
    });
  });
});
