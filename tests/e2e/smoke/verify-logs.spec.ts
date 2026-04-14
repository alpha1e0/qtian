import { test, expect } from '../fixtures/app.fixture';

test.describe('验证主进程日志输出', () => {
  test('应该能够捕获到主进程的所有日志', async ({ electronApp, window }) => {
    test.setTimeout(60000);

    const allMessages: string[] = [];
    const mainProcessMessages: string[] = [];

    // 监听所有主进程 console 消息
    electronApp.on('console', msg => {
      const text = msg.text();
      allMessages.push(text);

      // 只输出包含特定关键词的日志，避免刷屏
      if (text.includes('[MAIN PROCESS]') ||
          text.includes('Starting Qtian') ||
          text.includes('App ready') ||
          text.includes('Error') ||
          text.includes('qtian:')) {
        console.log('📟 [MAIN]:', text);
        mainProcessMessages.push(text);
      }
    });

    console.log('\n========================================');
    console.log('等待窗口加载...');
    console.log('========================================');

    // 等待窗口加载完成
    await window.waitForTimeout(3000);

    console.log('\n========================================');
    console.log('📊 日志统计:');
    console.log('   - 总消息数:', allMessages.length);
    console.log('   - 关键日志数:', mainProcessMessages.length);
    console.log('========================================');

    // 打印所有关键日志
    if (mainProcessMessages.length > 0) {
      console.log('\n关键日志内容:');
      mainProcessMessages.forEach((msg, i) => {
        console.log(`  ${i + 1}. ${msg}`);
      });
    } else {
      console.log('\n⚠️  没有捕获到预期的日志');
    }

    // 验证至少有一些日志输出
    expect(allMessages.length).toBeGreaterThan(0);
  });
});
