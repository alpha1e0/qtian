import { test, expect } from '../fixtures/app.fixture';
import { waitForAppReady } from '../helpers/electron-helper';
import * as path from 'path';

test.describe('主进程日志测试', () => {
  test('通过 IPC 捕获主进程日志', async ({ electronApp, window, testWorkspace }) => {
    test.setTimeout(60000);

    console.log('\n========================================');
    console.log('测试主进程日志通过 IPC 传输');
    console.log('========================================');

    // 监听来自主进程的日志消息
    const logs: string[] = [];
    electronApp.on('ipc-message', (message) => {
      if (message.channel === 'log-message') {
        const logText = JSON.stringify(message.data);
        logs.push(logText);
        console.log('📟 [IPC LOG]:', logText);
      }
    });

    console.log('✅ IPC 监听器已设置');

    // 等待应用启动
    await waitForAppReady(window);

    // 等待一下，收集日志
    await window.waitForTimeout(3000);

    console.log(`\n📊 通过 IPC 收集到的日志数: ${logs.length}`);

    if (logs.length > 0) {
      console.log('\n前 5 条日志:');
      logs.slice(0, 5).forEach((log, i) => {
        console.log(`  ${i + 1}. ${log.substring(0, 100)}`);
      });
    }

    // 检查日志文件
    const logDir = path.join(testWorkspace, 'log');
    const { readdir } = require('fs/promises');
    try {
      const files = await readdir(logDir);
      console.log(`\n📁 日志目录中的文件数: ${files.length}`);

      if (files.length > 0) {
        console.log('日志文件:');
        files.forEach((f) => console.log(`  - ${f}`));
      }
    } catch (err) {
      console.log(`\n❌ 无法读取日志目录: ${err}`);
    }

    console.log('\n========================================\n');

    // 验证应用功能正常
    const searchInput = window.getByLabel('搜索输入框');
    await expect(searchInput).toBeVisible();
  });
});
