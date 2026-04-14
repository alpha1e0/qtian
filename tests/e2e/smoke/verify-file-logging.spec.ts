import { test, expect } from '../fixtures/app.fixture';
import { waitForAppReady } from '../helpers/electron-helper';
import * as path from 'path';
import * as fs from 'fs/promises';

test.describe('验证文件日志功能', () => {
  test('应该能写入日志文件', async ({ electronApp, window, testWorkspace }) => {
    test.setTimeout(60000);

    console.log('\n========================================');
    console.log('测试文件日志功能');
    console.log('========================================');

    // 等待应用启动
    await waitForAppReady(window);

    // 等待一段时间，确保所有日志都已写入
    await window.waitForTimeout(2000);

    // 检查日志目录
    const logDir = path.join(testWorkspace, 'log');
    console.log(`日志目录: ${logDir}`);

    try {
      const files = await fs.readdir(logDir);
      console.log(`✅ 日志目录中的文件数: ${files.length}`);

      if (files.length > 0) {
        console.log('日志文件:');
        files.forEach((file) => console.log(`  - ${file}`));

        // 读取日志文件内容
        const logFile = path.join(logDir, files[0]);
        const content = await fs.readFile(logFile, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());

        console.log(`\n📝 日志文件内容 (${lines.length} 行):`);
        console.log('前 5 条日志:');
        lines.slice(0, 5).forEach((line, i) => {
          try {
            const logEntry = JSON.parse(line);
            console.log(`  ${i + 1}. [${logEntry.level}] [${logEntry.category}] ${logEntry.message}`);
          } catch {
            console.log(`  ${i + 1}. ${line.substring(0, 100)}`);
          }
        });

        // 验证日志内容
        expect(lines.length).toBeGreaterThan(0);
        console.log('\n✅ 文件日志功能正常!');

        // 验证关键日志存在
        const logText = content;
        expect(logText).toContain('background');
        expect(logText).toContain('Workspace initialized');
        console.log('✅ 关键日志内容验证通过');
      } else {
        console.log('\n❌ 日志目录为空');
        expect(files.length).toBeGreaterThan(0);
      }
    } catch (err) {
      console.log(`\n❌ 无法读取日志目录: ${err}`);
      throw err;
    }

    console.log('========================================\n');

    // 验证应用功能正常
    const searchInput = window.getByLabel('搜索输入框');
    await expect(searchInput).toBeVisible();
  });
});
