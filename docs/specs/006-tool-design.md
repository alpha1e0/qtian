## 1 Tool 系统架构总览

工具系统包含2部分：

1. 工具管理：

    a. 注册、查找
    b. 工具基础类：定义（prompt）、执行
    c. MCP工具client

2. 工具实现


### 1.1 MCP工具

MCP工具配置文件在：

> {工作目录}/assistant/tool/mcp.setting.json

格式如下：

```jsonl
{
    "servers":
    [
        {
          "type": "local",     // local mcp
            "name": "my-local-server",
            "command": "npx",
            "args":["-y", "@some/mcp-server"],
            "env": {
                "API_KEY": "xxx"
            },
            "enabled": true      // 是否启用
        },
        {
            "type": "remote",   // remote mcp
            "name": "my-remote-server",
            "url": "https://my-mcp-server.com",
            "enabled": true,
            "headers": {
                "Authorization": "Bearer MY_API_KEY"
            }
        }
    ]
}
```

### 1.2 工具实现约定


**约定**所有工具代码放在 `src/main/core/services/tools/` 目录下：

1. 每个工具在一个单独目录下，目录名为工具名称或工具名称简写
2. 所有工具的入口文件，命名方式为：{工具名称或工具名称见简写}-tool.tx
3. 统一入口，不论内置工具和MCP工具均在同一个“管理器”中进行注册

## 2 详细设计


### 2.1 工具接口定义

1. 接口定义 — tool.interface.ts

所有工具（内置和 MCP 外部）统一实现 ITool 接口：
interface ITool {
  name: string;                   // 全局唯一标识
  description: string;            // 供 LLM 理解用途
  parameters: Record<string, any>; // OpenAI function calling JSON Schema
  execute(args: Record<string, any>): Promise<string>; // 执行入口
}
ToolResult 定义了结构化的执行结果（success + content），但目前各工具的 execute() 直接返回 string。

2. 注册管理 — ToolRegistry（tool-registry.ts）

核心注册表，内部用 Map<string, ITool> 存储：

```
┌─────────────────────────────────┬─────────────────────────────────────┐
│              方法               │                作用                 │
├─────────────────────────────────┼─────────────────────────────────────┤
│ register(tool)                  │ 注册单个工具，同名会抛异常          │
├─────────────────────────────────┼─────────────────────────────────────┤
│ registerAll(tools)              │ 批量注册，同名静默跳过              │
├─────────────────────────────────┼─────────────────────────────────────┤
│ get(name)                       │ 按名称获取工具                      │
├─────────────────────────────────┼─────────────────────────────────────┤
│ getByNames(names)               │ 按名称列表批量获取                  │
├─────────────────────────────────┼─────────────────────────────────────┤
│ unregister(name)                │ 注销工具                            │
├─────────────────────────────────┼─────────────────────────────────────┤
│ getFunctionDefinitions()        │ 转换为 OpenAI function calling 格式 │
├─────────────────────────────────┼─────────────────────────────────────┤
│ listNames() / hasTools() / size │ 查询类方法                          │
└─────────────────────────────────┴─────────────────────────────────────┘
```


统一注册：在 `ai-assistant.handler.ts` buildTools 中实现注册

### 2.2 工具调用链

3. 工具调用链 — AiAgentService（agent/ai-agent.service.ts）

调用链路：

```
构造函数接收 ITool[]
  → registerAll() 注册到内部 ToolRegistry
  → sendMessage() 触发 runToolUseLoop()
    → 每轮将 getFunctionDefinitions() 传给 LLM
    → LLM 返回 finish_reason='tool_calls'
    → executeTool(name, argsStr)
      → toolRegistry.get(name) 获取工具实例
      → JSON.parse(argsStr) 解析参数
      → tool.execute(args) 执行
    → 结果追加为 role='tool' 消息，继续下一轮
```

关键设计点：

- 最大轮数控制：DEFAULT_MAX_TOOL_ROUNDS = 10
- 流式事件：通过 AsyncGenerator<AiChatEvent> 逐步 yield text_delta → tool_start → tool_result → done
- 中止机制：aborted 标志位可在任意环节中断循环

### 2.3 内置工具

ShellTool（shell-tool.ts）

- name: shell_execute
- 使用 child_process.exec() 执行系统 shell 命令
- 安全措施：危险命令正则拦截（rm -rf、format、shutdown 等）、工作目录限制、30s 超时、100KB 输出截断
- 构造参数：allowedCwd（可选工作目录限制）、timeoutMs

BashTool（BashTool.ts）

- name: bash_execute
- 使用 child_process.spawn() + PortableGit bash 执行
- 额外特性：
  - 后台模式：background=true 时 detached 启动，立即返回 PID
  - 进程管理：activeProcesses Map 跟踪活跃进程，支持 cancelProcess(pid) 取消
  - 双阶段终止：超时后先 SIGTERM，等 5s 再 SIGKILL
- 安全模块独立拆分：
  - bash-tool-path.ts：解析 PortableGit bash 路径
  - bash-tool-security.ts：validateCommandSafety() + isCwdAllowed() 安全校验


### 2.4 MCP工具


由三个文件协作实现：

```
McpConfigService (mcp-config.service.ts)
  → 读写 mcp.setting.json 配置文件
McpClient (mcp-client.ts)
  → 与单个 MCP 服务器通过 stdio 交换 JSON-RPC 2.0 消息
  → connect() → initialize → tools/list → callTool()
McpToolAdapter (mcp-tool-adapter.ts)
  → 适配器模式，将 McpToolDefinition 适配为 ITool 接口
  → 命名规则: mcp__{serverName}__{toolName}，避免与内置工具冲突
  → execute() 委托给 McpClient.callTool()
McpManager (mcp-manager.ts)
  → 管理所有 MCP 服务器生命周期
  → loadFromConfig() → 连接所有 enabled 服务器 → getAllTools() 返回 ITool[]
  → 支持 reload() / disconnectAll() / getStatuses()

```
