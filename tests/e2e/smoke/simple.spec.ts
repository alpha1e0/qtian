import { test, expect } from '../fixtures/app.fixture';
import { waitForAppReady } from '../helpers/electron-helper';

test.describe('极简冒烟测试', () => {
  test('应该能打开首页并导航到MD编辑器', async ({ window }) => {
    // 增加测试超时时间到60秒
    test.setTimeout(60000);

    // 1. 等待应用就绪
    await waitForAppReady(window);

    // 2. 验证首页已加载 - 检查搜索框
    const searchInput = window.getByLabel('搜索输入框');
    await expect(searchInput).toBeVisible({ timeout: 15000 });
    console.log('✅ 首页加载成功');

    // 3. 点击"MD编辑器"工具卡片
    const mdEditorTool = window.getByLabel('MD编辑器工具');
    await mdEditorTool.click();
    console.log('✅ 点击MD编辑器工具');

    // 4. 等待导航完成
    await window.waitForTimeout(2000);

    // 5. 验证MD编辑器页面已加载 - 检查新建文档按钮
    const newDocButton = window.getByLabel('新建文档');
    await expect(newDocButton).toBeVisible({ timeout: 15000 });
    console.log('✅ MD编辑器页面加载成功');
  });
});
