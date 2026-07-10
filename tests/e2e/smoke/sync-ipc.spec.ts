import { test, expect } from '../fixtures/app.fixture';
import { waitForAppReady } from '../helpers/electron-helper';

/**
 * 数据同步（WebDAV）IPC 接线冒烟测试。
 *
 * 仅验证 window.sync API 已正确挂载、IPC 通道可达、空配置下不崩溃。
 * 不验证真实 WebDAV 上传/下载（留待 Phase 2 UI 联调真机验证）。
 */
test.describe('数据同步 IPC 接线冒烟', () => {
  test('window.sync API 已挂载', async ({ window }) => {
    await waitForAppReady(window);

    const syncApi = await window.evaluate(() => {
      const sync = (window as unknown as { sync?: Record<string, unknown> }).sync;
      return {
        exists: !!sync,
        methods: sync ? Object.keys(sync) : [],
      };
    });

    expect(syncApi.exists).toBe(true);
    expect(syncApi.methods).toContain('getStatus');
    expect(syncApi.methods).toContain('getConfig');
    expect(syncApi.methods).toContain('testConnection');
    expect(syncApi.methods).toContain('saveConfig');
  });

  test('getConfig 在未配置时返回 null', async ({ window }) => {
    await waitForAppReady(window);

    const result = await window.evaluate(async () => {
      const sync = (window as unknown as { sync: { getConfig: () => Promise<unknown> } }).sync;
      return await sync.getConfig();
    });

    // 未配置时为 null（或空对象，取决于 qtian.json 初始状态）
    expect(result === null || result === undefined).toBe(true);
  });

  test('getStatus 返回带 direction 的对象', async ({ window }) => {
    await waitForAppReady(window);

    const status = await window.evaluate(async () => {
      const sync = (window as unknown as {
        sync: { getStatus: () => Promise<Record<string, unknown>> };
      }).sync;
      return await sync.getStatus();
    });

    expect(status).toBeTruthy();
    expect(status).toHaveProperty('direction');
    // 未配置时方向为 error 或 upload（取决于 meta 状态），不应崩溃
    expect(['upload', 'download', 'noop', 'conflict', 'error']).toContain(status.direction);
  });

  test('testConnection 在空配置下不崩溃', async ({ window }) => {
    await waitForAppReady(window);

    const result = await window.evaluate(async () => {
      const sync = (window as unknown as {
        sync: { testConnection: () => Promise<Record<string, unknown>> };
      }).sync;
      return await sync.testConnection();
    });

    // 应返回结构化结果（success 字段），而非抛错
    expect(result).toHaveProperty('success');
  });
});
