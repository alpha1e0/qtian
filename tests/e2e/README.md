# E2E冒烟测试文档

## 概述

该目录包含QTian应用的Playwright冒烟测试，用于验证应用的基本功能是否正常工作。

## 目录结构

```
tests/e2e/
├── fixtures/           # 测试fixtures和测试环境设置
├── helpers/            # 测试辅助函数
├── smoke/             # 冒烟测试用例
├── playwright.config.ts # Playwright配置文件
└── tsconfig.json      # TypeScript配置文件
```

## 环境要求

- Node.js (推荐 v16+)
- npm 或 yarn
- 已安装的Playwright浏览器

## 安装和设置

### 首次安装

```bash
# 安装Playwright和浏览器
npm install -D @playwright/test playwright
npx playwright install
```

### 运行测试

```bash
# 运行所有冒烟测试
npm run test:smoke

# 运行所有E2E测试
npm run test:e2e

# 使用UI模式运行测试（推荐用于调试）
npm run test:e2e:ui

# 使用调试模式运行测试
npm run test:e2e:debug

# 查看测试报告
npm run test:e2e:report
```

## 测试环境

测试使用独立的工作空间，避免污染开发数据：

- 测试工作空间：`tests/resource/workspace` (项目根目录)
- 环境变量：`QTIAN_WORKSPACE=tests/resource/workspace`
- 测试模式：`NODE_ENV=test`

## 注意事项

1. **首次运行时间较长**：第一次运行时需要下载Playwright浏览器，可能需要几分钟时间。

2. **并发限制**：Electron应用测试配置为单线程运行（`workers: 1`），避免应用实例冲突。

3. **测试失败时**：
   - 自动截图保存在 `tests/e2e_test_results/` 目录
   - 视频录制会保留失败的测试会话
   - 使用 `npm run test:e2e:report` 查看详细报告

4. **调试技巧**：
   ```bash
   # 使用UI模式可以直观看到测试执行过程
   npm run test:e2e:ui

   # 使用调试模式可以逐步执行测试
   npm run test:e2e:debug
   ```

## 扩展测试

要添加新的冒烟测试用例：

1. 在 `smoke/` 目录下创建新的 `.spec.ts` 文件
2. 使用项目提供的 fixtures：
   ```typescript
   import { test } from '../fixtures/app.fixture';
   import { waitForAppReady } from '../helpers/electron-helper';

   test.describe('新功能冒烟测试', () => {
     test.beforeEach(async ({ window }) => {
       await waitForAppReady(window);
     });

     test('应该正常工作', async ({ window }) => {
       // 你的测试代码
     });
   });
   ```

## CI/CD集成

在CI环境中运行测试时，确保：

1. 已安装Playwright浏览器：`npx playwright install --with-deps`
2. 设置适当的超时时间
3. 配置测试报告上传


