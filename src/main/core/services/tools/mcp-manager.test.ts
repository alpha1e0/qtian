/**
 * McpManager 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as context from '@/core/common/context';
import { McpManager } from '@/core/services/tools/mcp-manager';
import { McpClient } from '@/core/services/tools/mcp-client';
import { McpRemoteClient } from '@/core/services/tools/mcp-remote-client';
import {
  getTestAssistantToolDir,
  setupTestAssistantEnvironment,
  finalAssistantCleanup,
  initAssistantTestState,
} from '#testing/scripts/ai-assistant-test-helper';

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

vi.mock('@/core/services/tools/mcp-client', () => {
  return {
    McpClient: vi.fn().mockImplementation(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      getTools: vi.fn().mockReturnValue([]),
      callTool: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
      getServerName: vi.fn().mockReturnValue(''),
    })),
  };
});

vi.mock('@/core/services/tools/mcp-remote-client', () => {
  return {
    McpRemoteClient: vi.fn().mockImplementation(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      getTools: vi.fn().mockReturnValue([]),
      callTool: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
      getServerName: vi.fn().mockReturnValue(''),
    })),
  };
});

const TEST_FILE = 'test_mcp-manager';

/** 测试用本地 MCP 配置 */
const FILESYSTEM_SERVER = {
  name: 'filesystem',
  command: 'npx',
  args: ['-y', '@anthropic/mcp-filesystem'],
  enabled: true,
};

const DISABLED_SERVER = {
  name: 'disabled-server',
  command: 'node',
  args: ['server.js'],
  enabled: false,
};

const SEARCH_SERVER = {
  name: 'web-search',
  command: 'npx',
  args: ['-y', '@anthropic/mcp-search'],
  enabled: true,
};

/** 测试用远程 MCP 配置 */
const REMOTE_API_SERVER = {
  type: 'remote' as const,
  name: 'remote-api',
  url: 'https://example.com/mcp',
  enabled: true,
};

const REMOTE_DISABLED_SERVER = {
  type: 'remote' as const,
  name: 'remote-disabled',
  url: 'https://example.com/mcp2',
  enabled: false,
};

let testToolDir: string;
let manager: McpManager;

beforeEach(async () => {
  initAssistantTestState(TEST_FILE);
  testToolDir = getTestAssistantToolDir(TEST_FILE);
  await fs.rm(testToolDir, { recursive: true, force: true });
  await setupTestAssistantEnvironment(testToolDir);

  vi.spyOn(context.wpath, 'assistantToolDir', 'get').mockReturnValue(testToolDir);

  manager = new McpManager();
});

afterEach(async () => {
  await finalAssistantCleanup(TEST_FILE);
  vi.restoreAllMocks();
});

describe('McpManager', () => {
  describe('loadFromConfig', () => {
    it('无配置文件时不报错，clients 为空', async () => {
      await manager.loadFromConfig();
      const tools = manager.getAllTools();
      expect(tools).toHaveLength(0);
    });

    it('只连接 enabled 的服务器', async () => {
      const configService = manager.getConfigService();
      await configService.saveConfig({ servers: [FILESYSTEM_SERVER, DISABLED_SERVER] });

      await manager.loadFromConfig();

      const MockClient = vi.mocked(McpClient);
      expect(MockClient).toHaveBeenCalledTimes(1);
    });

    it('配置变更后 reload 重新连接', async () => {
      const configService = manager.getConfigService();
      await configService.saveConfig({ servers: [FILESYSTEM_SERVER] });

      await manager.loadFromConfig();

      // 添加新服务器
      await configService.saveConfig({ servers: [FILESYSTEM_SERVER, SEARCH_SERVER] });

      const MockClient = vi.mocked(McpClient);
      MockClient.mockClear();

      await manager.reload();
      expect(MockClient).toHaveBeenCalledTimes(2);
    });
  });

  describe('createClient routing', () => {
    it('local 配置 (无 type) 创建 McpClient', () => {
      const client = manager.createClient(FILESYSTEM_SERVER);
      expect(client).toBeInstanceOf(McpClient);
    });

    it('local 配置 (type=local) 创建 McpClient', () => {
      const localConfig = { ...FILESYSTEM_SERVER, type: 'local' as const };
      const client = manager.createClient(localConfig);
      expect(client).toBeInstanceOf(McpClient);
    });

    it('remote 配置 (type=remote) 创建 McpRemoteClient', () => {
      const client = manager.createClient(REMOTE_API_SERVER);
      expect(client).toBeInstanceOf(McpRemoteClient);
    });
  });

  describe('mixed local and remote config', () => {
    it('同时连接 local 和 remote 服务器', async () => {
      const configService = manager.getConfigService();
      await configService.saveConfig({
        servers: [FILESYSTEM_SERVER, REMOTE_API_SERVER],
      });

      await manager.loadFromConfig();

      const MockLocalClient = vi.mocked(McpClient);
      const MockRemoteClient = vi.mocked(McpRemoteClient);

      expect(MockLocalClient).toHaveBeenCalledTimes(1);
      expect(MockRemoteClient).toHaveBeenCalledTimes(1);
    });

    it('跳过禁用的 remote 服务器', async () => {
      const configService = manager.getConfigService();
      await configService.saveConfig({
        servers: [FILESYSTEM_SERVER, REMOTE_DISABLED_SERVER],
      });

      await manager.loadFromConfig();

      const MockLocalClient = vi.mocked(McpClient);
      const MockRemoteClient = vi.mocked(McpRemoteClient);

      expect(MockLocalClient).toHaveBeenCalledTimes(1);
      expect(MockRemoteClient).not.toHaveBeenCalled();
    });

    it('同时包含 local/remote/disabled 三种配置时正确路由', async () => {
      const configService = manager.getConfigService();
      await configService.saveConfig({
        servers: [
          FILESYSTEM_SERVER,
          DISABLED_SERVER,
          REMOTE_API_SERVER,
          REMOTE_DISABLED_SERVER,
        ],
      });

      await manager.loadFromConfig();

      const MockLocalClient = vi.mocked(McpClient);
      const MockRemoteClient = vi.mocked(McpRemoteClient);

      // 只有 filesystem (local) 和 remote-api (remote) 是 enabled
      expect(MockLocalClient).toHaveBeenCalledTimes(1);
      expect(MockRemoteClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAllTools', () => {
    it('无连接时返回空数组', () => {
      const tools = manager.getAllTools();
      expect(tools).toEqual([]);
    });
  });

  describe('getStatuses', () => {
    it('无连接时返回空对象', () => {
      const statuses = manager.getStatuses();
      expect(statuses).toEqual({});
    });
  });

  describe('hasConnections', () => {
    it('无连接时返回 false', () => {
      expect(manager.hasConnections()).toBe(false);
    });
  });

  describe('disconnectAll', () => {
    it('无连接时不报错', async () => {
      await expect(manager.disconnectAll()).resolves.not.toThrow();
    });
  });

  describe('getConfigService', () => {
    it('返回 McpConfigService 实例', () => {
      const configService = manager.getConfigService();
      expect(configService).toBeDefined();
      expect(typeof configService.saveServer).toBe('function');
    });
  });
});
