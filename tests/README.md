# Testing Resources

本目录包含测试相关的脚本和资源。

## 快速开始

### 1. 配置测试环境

创建测试环境变量文件：

```bash
# 复制示例文件
cp .env.test.example .env.test

# 根据需要修改配置（可选）
# 默认配置已经可以运行大部分测试
```

### 2. 初始化测试工作目录

```bash
npm run test:workspace:init
```

### 3. 运行测试

```bash
# 运行所有测试
npm test

# 运行特定模块测试
npm test -- src/main/core/services/task
```

## 环境变量配置

### .env.test 文件

测试环境变量文件（项目根目录的 `.env.test`）用于配置测试运行时的环境变量。

**重要配置项**：

| 变量名 | 说明 | 默认值 | 是否必需 |
|--------|------|--------|----------|
| `QTIAN_WORKSPACE` | 测试工作目录路径 | `testing/workspace` | 否 |
| `OPENAI_API_KEY` | OpenAI API 密钥 | 空 | 否 |
| `TEST_TIMEOUT` | 测试超时时间 | `30000` | 否 |
| `TEST_VERBOSE_LOGGING` | 是否启用详细日志 | `false` | 否 |

**配置说明**：
- `.env.test` 文件已在 `.gitignore` 中，不会被提交到 Git
- 大部分测试可以使用默认配置运行
- 只有需要调用真实 API 的测试才需要配置 API 密钥
- `QTIAN_WORKSPACE` 环境变量与实际运行时保持一致

## 目录结构

```
testing/
├── scripts/             # 测试脚本
│   ├── README.md
│   ├── init-workspace.ts          # 工作目录初始化脚本
│   └── ensure-test-workspace.ts  # 测试前检查脚本
├── workspace/           # 测试工作目录（运行时生成，git忽略）
│   ├── log/             # 测试日志
│   ├── tmp/             # 测试临时文件
│   └── qtian.json        # 测试配置文件
├── fixtures/            # 测试夹具（预留）
└── mocks/               # Mock 数据（预留）
```

## 脚本（Scripts）

详见 `scripts/README.md`

### 可用脚本

- **init-workspace.ts**：初始化测试工作目录
- **ensure-test-workspace.ts**：测试前检查工作目录状态

## 环境变量（Environment Variables）

### QTIAN_WORKSPACE

测试工作目录的环境变量配置。

**作用**：控制测试工作目录的位置

**默认值**：`testing/workspace`

**使用方式**：
```bash
# 方式1：在 .env.test 文件中设置
echo "QTIAN_WORKSPACE=/custom/test/workspace" >> .env.test

# 方式2：通过命令行设置
export QTIAN_WORKSPACE=/custom/test/workspace
npm test
```

**优先级**：命令行 > .env.test > 默认值

## 工作目录（Workspace）

### 概述

`testing/workspace/` 是用于单元测试和冒烟测试的工作目录，其结构与实际运行时的工作目录（`%LOCALAPPDATA%/Qtian/workspace`）完全一致。

### 特点

- **与实际运行时一致**：目录结构、配置文件格式与生产环境相同
- **自动初始化**：运行测试前会自动检查并初始化工作目录
- **Git 忽略**：工作目录已在 `.gitignore` 中，不会被提交到仓库
- **配置模板**：提供 `.template` 文件作为配置参考

### 初始化

工作目录会在以下情况自动初始化：

1. **运行单元测试**：执行 `npm test` 时自动检查并初始化
2. **运行冒烟测试**：执行冒烟测试前自动检查并初始化

如需手动初始化：

```bash
# 方法1：使用 npm 脚本（推荐）
npm run test:workspace:init

# 方法2：直接使用 ts-node 运行
npx ts-node testing/scripts/init-workspace.ts
```

### 配置文件

工作目录初始化后，包含以下配置文件模板：

- `qtian.json.template` - 主配置文件模板

**重要提示**：
- 模板文件中的 API 密钥为空，需要手动补充
- 复制模板文件并去掉 `.template` 后缀即可使用
- 只有配置了有效 API 密钥的测试才会调用真实 API

### 目录用途

| 目录 | 用途 |
|------|------|
| `log/` | 存放测试运行日志 |
| `tmp/` | 存放测试临时文件 |

### 配置文件

工作目录初始化后，包含以下配置文件模板：

- `qtian.json.template` - 主配置文件模板

**重要提示**：
- 模板文件中的 API 密钥为空，需要手动补充
- 复制模板文件并去掉 `.template` 后缀即可使用
- 只有配置了有效 API 密钥的测试才会调用真实 API
- 大部分测试可以使用 mock 数据，不需要真实 API

## 配置说明

详见 `config/README.md`

## 测试文件位置

实际的单元测试文件位于源代码目录中，采用 `*.test.ts` 命名：

**为什么这样组织？**

- ✅ 测试文件与源代码放在一起，易于维护
- ✅ 符合 Vitest 的扫描规则（`src/main/core/**/*.test.ts`）
- ✅ 本目录仅存放脚本和资源，与测试代码分离
- ✅ 使用与实际运行时一致的配置方式

## 运行测试

```bash
# 运行所有测试（会自动初始化工作目录）
npm test

# 运行特定模块测试
npm test -- src/main/core/services/task

# 运行测试并生成覆盖率报告
npm run test:coverage

# 运行测试 UI
npm run test:ui
```

