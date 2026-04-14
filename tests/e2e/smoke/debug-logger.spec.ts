import { test, expect } from '../fixtures/app.fixture';
import { waitForAppReady } from '../helpers/electron-helper';

test.describe('日志输出验证', () => {
  test('应该能看到主进程的日志输出', async ({ window }) => {
    test.setTimeout(60000);

    console.log('=== 测试开始：验证日志输出 ===');

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

    console.log('=== 测试完成 ===');
  });
});
