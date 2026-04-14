import { test, expect } from '../fixtures/app.fixture';
import { waitForAppReady } from '../helpers/electron-helper';

test.describe('完整日志演示', () => {
  test('演示所有日志的捕获情况', async ({ electronApp, window }) => {
    test.setTimeout(60000);

    const allMessages: string[] = [];
    const importantLogs: string[] = [];

    // 监听所有主进程 console 消息
    electronApp.on('console', msg => {
      const text = msg.text();
      const type = msg.type();

      allMessages.push(text);

      // 只输出重要的日志，避免刷屏
      if (text.includes('[MAIN]') ||
          text.includes('INFO]') ||
          text.includes('ERROR]') ||
          text.includes('Starting') ||
          text.includes('Error')) {

        importantLogs.push(text);

        // 在测试控制台显示
        console.log(`📟 [${type}]:`, text);
      }
    });

    console.log('\n========================================');
    console.log('📋 测试说明');
    console.log('========================================');
    console.log('这个测试演示了 e2e 测试中日志捕获的机制');
    console.log('');
    console.log('✅ 已实现的日志输出：');
    console.log('   1. Logger.info/error 输出到 console.error');
    console.log('   2. 关键位置添加 [MAIN] 标记的日志');
    console.log('   3. Playwright 捕获 console 消息');
    console.log('');
    console.log('⚠️  限制：');
    console.log('   - 模块加载阶段的日志无法被捕获');
    console.log('   - 这些日志在 electron.launch() 之前就输出了');
    console.log('========================================\n');

    // 等待窗口加载
    await waitForAppReady(window);

    // 等待一下，确保捕获到一些日志
    await window.waitForTimeout(2000);

    console.log('\n========================================');
    console.log('📊 日志统计');
    console.log('========================================');
    console.log(`总消息数: ${allMessages.length}`);
    console.log(`重要日志数: ${importantLogs.length}`);

    if (importantLogs.length > 0) {
      console.log('\n捕获到的重要日志:');
      importantLogs.forEach((log, i) => {
        console.log(`  ${i + 1}. ${log}`);
      });
    }

    console.log('========================================\n');

    // 验证基本功能
    const searchInput = window.getByLabel('搜索输入框');
    await expect(searchInput).toBeVisible();
    console.log('✅ 应用功能正常');

    // 验证至少有一些日志输出
    expect(allMessages.length).toBeGreaterThan(0);
    console.log('✅ 日志捕获正常');
  });
});
