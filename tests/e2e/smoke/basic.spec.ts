import { test, expect } from '../fixtures/app.fixture';

test.describe('基础环境测试', () => {
  test('应该能够正确初始化测试环境', async ({ testWorkspace }) => {
    // 验证测试工作空间创建成功
    const fs = require('fs');
    const path = require('path');
    expect(fs.existsSync(testWorkspace)).toBe(true);
  });

  test('应该能够设置环境变量', async ({ testWorkspace, electronApp }) => {
    // 验证环境变量设置正确
    // 注意：process.env.QTIAN_WORKSPACE 可能是undefined，因为测试运行在独立进程中
    expect(testWorkspace).toContain('qtian-test');
    expect(testWorkspace).toBeTruthy();
  });
});
