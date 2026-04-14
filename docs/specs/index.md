# 项目需求总览

## 1. 核心架构说明

## 2. 功能模块列表 (Feature Registry)

| 编号 | 功能名称 | 状态 | 关联文档 | 简述 |
| :--- | :--- | :--- | :--- | :--- |
| 001 | 首页 | 🚧 开发中 | ./001_homepage.md | 项目首页，路由到具体功能、简介、配置 |
| 002 | AI个人助手 | 🚧 开发中 | ./002_ai-assistant.md | 翻译、搜索总结、本地查找文档总结、智能体 |

该应用的工作目录用于保存配置、数据，工作目录通过环境变量 `QTIAN_WORKSPACE` 指定，如果没有该环境变量则默认为当前目录下的 `.qtian` 目录

## 3. 全局依赖关系 (Global Dependencies)

## 4. 测试基础设施

### 4.1 单元测试 (Vitest)

项目使用 Vitest 进行单元测试，测试文件位于 `src/main/core/` 目录下，与源代码文件并列放置。

**运行命令：**
- `npm test` - 运行所有单元测试
- `npm run test:ui` - 使用UI界面运行测试
- `npm run test:coverage` - 生成测试覆盖率报告

### 4.2 冒烟测试 (Playwright)

项目使用 Playwright 进行端到端冒烟测试，测试文件位于 `tests/e2e/smoke/` 目录。

**测试覆盖：**
- 应用启动和基本功能
- 导航功能
- 各功能模块的基本可用性

**运行命令：**
- `npm run test:smoke` - 运行所有冒烟测试
- `npm run test:e2e` - 运行所有E2E测试
- `npm run test:e2e:ui` - 使用UI界面运行测试
- `npm run test:e2e:debug` - 使用调试模式运行测试

详细文档请参考：`tests/e2e/README.md`

## 4. 公共模块设计

### 4.1 工作目录设计

工作目录用于：保存配置、本地数据库、后台任务队列

工作目录默认为：`~/.qtian`，如果设置了环境变量 `QTIAN_WORKSPACE`则优先使用环境变量中的目录为工作目录

工作目录保存：

- 配置文件 qtian.json（主配置文件，位于工作目录根目录）
- log/目录，保存日志

### 4.2 全局配置设计

应用主配置文件，位于工作目录根目录，为json格式，例如：

```
{
	"ai_assistant": {}
}
```

### 4.3 local-resource 自定义协议

各模块需要在渲染进程中展示本地图片文件。为避免使用不安全的 `file://` 伪协议 + `webSecurity: false` 方案，项目注册了自定义协议 `local-resource`。

**协议注册**（`src/main/index.ts`）：

- 在 `app.on('ready')` 前通过 `protocol.registerSchemesAsPrivileged` 注册 scheme
- 在 `app.on('ready')` 后通过 `protocol.registerFileProtocol` 注册处理回调

**安全策略**：

- 仅允许加载图片扩展名的文件（jpg/jpeg/png/gif/webp 等），拒绝其他文件类型
- 文件必须存在，否则返回 404

**URL 格式**：

```
local-resource://C:/Users/test/image.jpg
```

**使用方式**：

- 主进程：通过 `toLocalResourceUrl(filePath)` 工具函数生成 URL
- 渲染进程：直接拼接 `local-resource://${absolutePath}`（路径中的 `\` 需替换为 `/`）

**公共模块**：`src/main/core/utils/local-resource-protocol.ts`
