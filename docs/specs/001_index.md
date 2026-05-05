# 项目需求总览

## 1. 需求组织结构

需求文档命名方式：

	<编号>_<模块名称>_<作用>.md

	其中，作用包含 *req 需求* 、*design 设计* 、*ui-design UI设计*，如果没有则可能混合各种内容

## 2. 功能模块列表 (Feature Registry)

AI助手包含 **快捷模式（quick-mode）** 和 **普通模式（normal-mode）**:

- **快捷模式（quick-mode）**，一次性的临时对话，快捷键换出，对话结果不保存，快捷模式可手动转换为普通模式
- **普通模式（normal-mode）**，完整模式，记录历史，多伦对话

## 3. 公共模块设计

### 3.1 工作目录设计

工作目录用于：保存配置、本地数据库、后台任务队列

工作目录默认为：`%LOCALAPPDATA%/Qtian/workspace`（Windows），如果设置了环境变量 `QTIAN_WORKSPACE`则优先使用环境变量中的目录为工作目录

工作目录保存：

- 配置文件 qtian.json（主配置文件，位于工作目录根目录）
- log/目录，保存日志
- assistant/目录，保存模型、agent、skill、mcp、memory、history等配置、数据

### 4.2 全局配置设计

应用主配置文件，位于工作目录根目录，为json格式，例如：

```json
{
  "ai_assistant": {
    "default_agent": "default",
    "default_llm_config": "default",
    "max_tool_rounds": 30,
    "context_compress_threshold": 0.75,
    "tool_timeout_ms": 30000
  }
}
```

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


