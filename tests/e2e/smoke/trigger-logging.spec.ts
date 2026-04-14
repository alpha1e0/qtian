import { test, expect } from '../fixtures/app.fixture';
import { waitForAppReady } from '../helpers/electron-helper';
import * as path from 'path';

test.describe('触发主进程日志', () => {
  test('通过 IPC 调用触发日志', async ({ electronApp, window, testWorkspace }) => {
    test.setTimeout(60000);

    console.log('\n========================================');
    console.log('测试触发主进程日志');
    console.log('========================================');

    // 监听 IPC 消息
    const logs: any[] = [];
    electronApp.on('ipc-message', (message) => {
      if (message.channel === 'log-message') {
        logs.push(message.data);
        console.log('📟 [IPC LOG]:', message.data);
      }
    });

    // 等待应用启动
    await waitForAppReady(window);

    console.log('✅ 应用已启动，触发 IPC 调用...');

    // 调用一个 IPC 处理器，这应该会产生日志
    try {
      const result = await electronApp.evaluate(async ({ ipcMain }) => {
        // 这个 eval 会在主进程中执行
        return new Promise((resolve) => {
          // 发送一个测试消息
          resolve('test-complete');
        });
      });

      console.log('评估结果:', result);
    } catch (err) {
      console.log('评估错误:', err);
    }

    // 通过页面触发 IPC 调用
    await window.evaluate(() => {
      // 在渲染进程中触发一个 IPC 调用
      if (window.electronAPI) {
        window.electronAPI.testLogging?.();
      }
    });

    // 等待日志
    await window.waitForTimeout(2000);

    console.log(`\n📊 收集到的日志数: ${logs.length}`);

    if (logs.length > 0) {
      console.log('\n日志内容:');
      logs.forEach((log, i) => {
        console.log(`  ${i + 1}. [${log.level}] [${log.category}] ${log.message}`);
      });
    }

    // 检查文件日志
    const logDir = path.join(testWorkspace, 'log');
    const { readdir } = require('fs/promises');
    try {
      const files = await readdir(logDir);
      console.log(`\n📁 日志目录中的文件数: ${files.length}`);

      if (files.length > 0) {
        console.log('✅ 日志文件已创建!');
        console.log('文件列表:', files);

        // 读取第一个日志文件
        const { readFile } = require('fs/promises');
        const content = await readFile(path.join(logDir, files[0]), 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        console.log(`\n📝 日志文件内容 (${lines.length} 行):`);
        lines.slice(0, 10).forEach((line, i) => {
          console.log(`  ${i + 1}. ${line.substring(0, 100)}...`);
        });
      } else {
        console.log('❌ 日志目录仍然为空');
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
