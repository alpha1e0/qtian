import { defineConfig } from '@playwright/test';

export default defineConfig({
  // 明确指定只在 e2e 目录中查找测试
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  // 排除单元测试文件
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/dist-electron/**',
    '**/*.test.ts',
    '**/e2e/**/fixtures/**',
  ],
  timeout: 60000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
