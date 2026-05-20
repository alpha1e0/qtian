## 1 概述

BashTool 是一个基于 PortableGit bash 的命令执行工具，实现 `ITool` 接口，工具名 `bash_execute`。与现有 ShellTool（系统 cmd + `exec()`）并存，提供 spawn-based 进程控制、后台执行和统一的 bash 环境。

### 1.1 与 ShellTool 的关系

| 对比项 | ShellTool | BashTool |
| :--- | :--- | :--- |
| 工具名 | `shell_execute` | `bash_execute` |
| Shell 环境 | 系统默认 (cmd) | PortableGit bash |
| 执行方式 | `child_process.exec()` | `child_process.spawn()` |
| 后台执行 | 不支持 | 支持 (`detached`) |
| 进程管理 | 无 | `activeProcesses` Map，可取消 |
| 超时终止 | `exec` 内置 timeout | SIGTERM → 5s → SIGKILL |
| Agent 选择 | 通过 `tools` 列表按名选用 | 同左 |

两者独立注册，Agent 在定义文件的 `tools` 列表中通过名称选择使用。

### 1.2 设计参考

参考 Claude Code 源码的 BashTool 实现，剥离 React/UI 依赖，简化安全系统，适配项目 ITool 接口。

## 2 文件结构

```
src/main/core/services/tools/
├── BashTool.ts               # 核心类，实现 ITool 接口
├── bash-tool-path.ts         # PortableGit bash.exe 路径解析
├── bash-tool-security.ts     # 安全验证（危险命令检测、路径范围检查）
├── BashTool.test.ts          # 核心类测试 (29 tests)
├── bash-tool-path.test.ts    # 路径解析测试 (4 tests)
└── bash-tool-security.test.ts # 安全模块测试 (32 tests)
```

修改的现有文件：

- `index.ts` — 添加 `BashTool`、`bash-tool-path`、`bash-tool-security` 的导出

## 3 模块设计

### 3.1 bash-tool-path — 路径解析

职责：定位 PortableGit 的 `bash.exe` 可执行文件。

**接口**

| 函数 | 说明 |
| :--- | :--- |
| `resolveBashPath(): Promise<string>` | 解析 bash.exe 绝对路径，结果缓存 |
| `resetBashPathCache(): void` | 清除缓存（仅测试用） |

**查找策略（按优先级）**

1. `process.cwd()/bin-vendor/PortableGit/bin/bash.exe` — 开发环境
2. `process.resourcesPath/bin-vendor/PortableGit/bin/bash.exe` — Electron 打包后
3. `__dirname` 相对路径回退 — 从 tools 目录向上 5 级到项目根
4. 系统路径：
   - `%ProgramFiles%/Git/bin/bash.exe`
   - `%ProgramFiles(x86)%/Git/bin/bash.exe`
   - `%LocalAppData%/Programs/Git/bin/bash.exe`

所有候选路径均不存在时抛出 Error。首次解析成功后缓存，后续调用 O(1)。

### 3.2 bash-tool-security — 安全验证

职责：危险命令前置拦截、工作目录范围检查。

**接口**

| 函数 | 说明 |
| :--- | :--- |
| `validateCommandSafety(command: string): string \| null` | 检测危险命令，返回拦截原因或 null |
| `isCwdAllowed(resolvedCwd: string, allowedCwd: string \| null): boolean` | 路径范围检查 |

**危险命令模式**

继承 ShellTool 的 13 条基础模式，扩展 9 条 bash 环境特有的模式：

| 类别 | 模式示例 | 说明 |
| :--- | :--- | :--- |
| 远程脚本执行 | `curl/wget \| sh/bash` | 防止下载执行远程脚本 |
| fork bomb | `:(){ :\|:& };:` | 防止 fork 炸弹 |
| 磁盘写入 | `> /dev/sda` 等 | 防止直接写入磁盘设备 |
| 销毁数据 | `mv file /dev/null` | 防止将文件移入黑洞 |
| 系统文件 | `> /etc/passwd` 等 | 防止覆写关键系统文件 |
| 属性操作 | `chattr -i` | 防止移除文件 immutable 属性 |
| 启动分区 | `> /boot/...` | 防止覆写引导文件 |

**路径范围检查**

- `allowedCwd` 为 null 时不限制
- 完全匹配时允许
- 前缀匹配时要求路径分隔符边界（防止 `/project` 匹配 `/project2`）
- Windows 下不区分大小写

### 3.3 BashTool — 核心类

职责：实现 `ITool` 接口，提供 spawn-based bash 命令执行。

**工具参数 (JSON Schema)**

| 参数 | 类型 | 必选 | 说明 |
| :--- | :--- | :--- | :--- |
| `command` | string | 是 | 要执行的 bash 命令 |
| `timeout` | number | 否 | 超时时间 (ms)，默认 30000 |
| `cwd` | string | 否 | 工作目录 |
| `background` | boolean | 否 | 后台执行模式，默认 false |

**构造参数**

| 选项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `allowedCwd` | string \| null | null | 限制执行的工作目录范围 |
| `timeoutMs` | number | 30000 | 默认超时 (ms) |

**执行流程**

```
execute(args)
  │
  ├─ 1. 参数校验 (command 必填且为 string)
  ├─ 2. 危险命令检测 (validateCommandSafety)
  ├─ 3. 工作目录范围检查 (isCwdAllowed)
  ├─ 4. 解析 bash 路径 (resolveBashPath)
  │
  ├─ [background=true]  → executeBackground()
  │    ├─ spawn(detached, stdio='ignore')
  │    ├─ proc.unref()
  │    └─ 返回 "Background process started with PID {pid}"
  │
  └─ [background=false] → executeForeground()
       ├─ spawn(['-c', command], stdio=['pipe','pipe','pipe'])
       ├─ 注册到 activeProcesses Map
       ├─ 流式收集 stdout + stderr
       ├─ 超时处理: SIGTERM → 5s → SIGKILL
       ├─ 输出截断 (> 100000 字符)
       └─ resolve 输出文本
```

**常量**

| 常量 | 值 | 说明 |
| :--- | :--- | :--- |
| `DEFAULT_TIMEOUT` | 30000 | 默认超时 (ms) |
| `SIGKILL_DELAY` | 5000 | SIGTERM 后等待 SIGKILL 的延迟 (ms) |
| `MAX_OUTPUT_LENGTH` | 100000 | 输出截断阈值 (字符) |

**进程管理**

- `activeProcesses: Map<string, ChildProcess>` — 跟踪所有前台进程
- `cancelProcess(pid: string): boolean` — 发送 SIGTERM 取消进程
- `activeProcessCount: number` — 当前活跃进程数（只读属性）

## 4 测试覆盖

| 测试文件 | 测试数 | 覆盖范围 |
| :--- | :--- | :--- |
| `bash-tool-path.test.ts` | 4 | 路径解析、缓存、绝对路径、缓存重置 |
| `bash-tool-security.test.ts` | 32 | 继承模式 (12)、bash 扩展模式 (10)、安全命令 (6)、路径检查 (4) |
| `BashTool.test.ts` | 29 | 属性校验 (3)、输入验证 (3)、危险命令 (4)、目录限制 (3)、前台执行 (6)、超时 (1)、后台模式 (2)、输出截断 (1)、构造选项 (2)、进程管理 (3)、无输出 (1) |

**总计：65 个测试，全部通过。**
