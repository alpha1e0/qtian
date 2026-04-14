# 测试脚本

本目录包含测试相关的工具脚本。

## 脚本列表

### init-workspace.ts

**用途**：初始化测试工作目录

**功能**：
- 创建与实际运行时一致的目录结构
- 生成默认配置文件
- 创建 LLM 配置模板

**使用方法**：
```bash
# 使用 npm 脚本（推荐）
npm run test:workspace:init

# 直接使用 ts-node
npx ts-node testing/scripts/init-workspace.ts
```

**环境变量**：
- `QTIAN_WORKSPACE`：自定义工作目录路径（默认：`testing/workspace`）

---

### ensure-test-workspace.ts

**用途**：测试前检查工作目录状态

**功能**：
- 检查工作目录是否已初始化
- 验证必需的配置文件是否存在
- 如果未配置则退出并提示用户

**使用方法**：
```bash
# 直接使用 ts-node
npx ts-node testing/scripts/ensure-test-workspace.ts
```

**自动调用**：
- 在 `npm test` 命令中自动调用
- 确保测试运行前工作目录已正确配置

**环境变量**：
- `QTIAN_WORKSPACE`：自定义工作目录路径（默认：`testing/workspace`）

## 工作流程

1. **首次运行测试前**：
   ```bash
   npm run test:workspace:init
   ```

2. **运行测试**（自动检查工作目录）：
   ```bash
   npm test
   ```

3. **自定义工作目录**：
   ```bash
   export QTIAN_WORKSPACE=/custom/path
   npm test
   ```

## 相关文档

- [testing/README.md](../README.md) - 测试资源总览
- [workspace/README.md](../workspace/README.md) - 工作目录说明
