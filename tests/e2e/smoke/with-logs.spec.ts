import { test, expect } from '../fixtures/app.fixture';
import { waitForAppReady } from '../helpers/electron-helper';

test.describe('带日志输出的冒烟测试', () => {
  test('应该能看到主进程日志并成功导航', async ({ electronApp, window }) => {
    test.setTimeout(60000);

    // 监听主进程的 console 消息
    const messages: string[] = [];
    electronApp.on('console', msg => {
      const text = msg.text();
      messages.push(text);
      console.log('📟 [MAIN]:', text);
    });

    console.log('========================================');
    console.log('🚀 测试开始');
    console.log('========================================');

    // 等待应用就绪
    await waitForAppReady(window);
    console.log('✅ 应用已就绪');

    // 验证首页已加载
    const searchInput = window.getByLabel('搜索输入框');
    await expect(searchInput).toBeVisible({ timeout: 15000 });
    console.log('✅ 首页加载成功');

    // 点击 MD 编辑器
    const mdEditorTool = window.getByLabel('MD编辑器工具');
    await mdEditorTool.click();
    console.log('✅ 点击MD编辑器工具');

    // 等待导航
    await window.waitForTimeout(2000);

    // 验证编辑器加载
    const newDocButton = window.getByLabel('新建文档');
    await expect(newDocButton).toBeVisible({ timeout: 15000 });
    console.log('✅ MD编辑器页面加载成功');

    console.log('========================================');
    console.log('📊 主进程消息统计:');
    console.log('   - 总消息数:', messages.length);
    console.log('   - 带 [MAIN PROCESS] 的消息:', messages.filter(m => m.includes('[MAIN PROCESS]')).length);
    console.log('========================================');

    // 验证至少有一些主进程日志
    expect(messages.length).toBeGreaterThan(0);
  });
});
