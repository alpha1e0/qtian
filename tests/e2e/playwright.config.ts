import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: './smoke',
  timeout: 60000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Electron应用需要单线程运行
  reporter: 'html',
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  outputDir: path.join(__dirname, '../e2e_test_results'),
});
