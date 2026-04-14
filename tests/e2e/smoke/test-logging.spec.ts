import { test, expect } from '../fixtures/app.fixture';
import { waitForAppReady } from '../helpers/electron-helper';

test.describe('测试日志捕获', () => {
  test('应该能捕获到主进程日志', async ({ electronApp, window }) => {
    test.setTimeout(60000);

    console.log('\n📋 开始测试日志捕获...\n');

    const messages: string[] = [];

    // 立即设置监听器
    electronApp.on('console', msg => {
      const text = msg.text();
      messages.push(text);

      // 实时显示
      console.log(`[捕获到消息]: ${text.substring(0, 100)}...`);
    });

    console.log('✅ console 监听器已设置');

    // 等待 Electron 完全启动
    await waitForAppReady(window);
    console.log('✅ 应用已就绪');

    // 再等待一下，确保捕获到一些日志
    await window.waitForTimeout(2000);

    console.log(`\n📊 捕获到的消息数: ${messages.length}\n`);

    if (messages.length > 0) {
      console.log('前 5 条消息:');
      messages.slice(0, 5).forEach((msg, i) => {
        console.log(`  ${i + 1}. ${msg.substring(0, 150)}...`);
      });
    }

    // 验证
    expect(messages.length).toBeGreaterThan(0);
    console.log('✅ 日志捕获成功');
  });
});
