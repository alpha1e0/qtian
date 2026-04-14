# E2E 冒烟测试目录说明

本目录包含 QTian 应用的端到端冒烟测试，按业务功能模块组织。

## 工作目录说明

**重要**：E2E 测试与单元测试使用相同的测试工作目录。

### 环境变量配置

测试工作目录通过项目根目录的 `.env.test` 文件配置：

```env
# 测试工作目录路径
QTIAN_WORKSPACE=D:\sources\qtian\testing\workspace
```

### 初始化测试工作目录

在运行测试前，确保已初始化测试工作目录：

```bash
# 检查测试环境
npm run test:env:check

# 初始化测试工作目录（首次运行或需要重置时）
npm run test:workspace:init
```

## 运行测试

### 运行所有冒烟测试
```bash
npm run test:e2e
npm run test:smoke
```

### 运行特定模块的测试
```bash
# 首页测试
npm run test:e2e tests/e2e/smoke/homepage

# AI助手测试
npm run test:e2e tests/e2e/smoke/ai-assistant
```

## 测试命名规范

所有测试使用 Playwright 的 `locator` API 和 `aria-label` 进行元素定位：

### 常用定位方法

```typescript
// 通过 aria-label 定位
const searchInput = window.getByLabel('搜索输入框');
const newDocButton = window.getByLabel('新建文档');

// 通过 locator 定位
const container = window.locator('.homepage-container');

// 通过文本定位（用于验证）
const element = window.getByText('确定');

// 组合定位
const submitButton = window.getByRole('button', { name: '提交' });
```

### aria-label 命名规范

- **按钮**：使用动词+名词，如"新建文档"、"删除分类"
- **输入框**：使用"功能名称+输入"，如"文档名称"、"用户消息输入"
- **选择器**：使用"选择+功能"，如"选择LLM模型"、"选择场景"
- **对话框按钮**：使用"动作+对象+操作"，如"确认文档操作"、"取消分类操作"

## 编写新测试

1. 在对应功能目录下创建 `*.spec.ts` 文件
2. 导入必要的 fixture 和辅助函数
3. 使用 `test.describe` 组织相关测试
4. 在 `test.beforeEach` 中进行页面导航和准备
5. 使用 `locator` API 和 `aria-label` 进行元素定位
6. 使用 `expect` 进行断言

### 测试模板

```typescript
import { test, expect } from '../../fixtures/app.fixture';
import { waitForAppReady } from '../../helpers/electron-helper';

test.describe('功能模块测试', () => {
  test.beforeEach(async ({ window }) => {
    await waitForAppReady(window);
    // 导航到对应页面
  });

  test('应该显示功能', async ({ window }) => {
    const element = window.getByLabel('元素标签');
    await expect(element).toBeVisible();
  });

  test('应该能够执行操作', async ({ window }) => {
    const button = window.getByLabel('按钮标签');
    await button.click();

    const result = window.getByLabel('结果标签');
    await expect(result).toBeVisible();
  });
});
```

## 注意事项

1. **测试隔离**：每个测试应该独立运行，不依赖其他测试的状态
2. **超时设置**：某些操作可能需要较长时间，合理设置 timeout
3. **页面等待**：使用 `waitForTimeout` 或 `waitForSelector` 等待页面加载完成
4. **跳过测试**：对于暂未实现的功能，使用 `test.skip()` 标记
5. **错误处理**：使用 try-catch 处理可能的导航失败等异常情况
