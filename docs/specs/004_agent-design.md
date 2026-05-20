## 1 Agent

### 1.1 agent技术

Agent 使用 `streaming tool-use loop` 技术实现

### 1.2 agent定义文件

agent定义文件为`Markdown`文件，开头包含**YAML 元数据 (Front-matter)**

	name: 必选，字符串，名称，使用大小写、下划线、减号、数字字符组成
    alias: 可选，字符串，该Agent的别名，用于展示
	description: 必选，字符串，agent功能描述
	tools: 可选，列表，可用工具列表
	model: 可选，字符串，建议的模型provider（llm/目录下的配置文件文件名（不包含后缀））

agent定义文件正文部分包含该agent的角色定义、行为准则、输出约束等内容

### 1.3 system_prompt

system_prompt是`动态组装`的，包含如下部分：

| 组成部分 | 简述 | 来源 |
| :--- | :--- | :--- |
| 角色定义 | 你是谁，你是做什么的 | agent定义文件 |
| 行为准则 | 哪些可以做，哪些不能做 | agent定义文件 |
| skill | 有哪些可用的skill（仅包含元数据name、description） | skill模块 |
| 工具 | 有哪些工具可用（内置工具、MCP工具） | tools模块 |
| 记忆 | 有哪些记忆 | memory模块 |
| 环境信息 | 当前在什么环境执行 | 内置函数 |
| 输出风格 | 输出风格 | 全局system prompt片段 |

**环境信息**

- 操作系统类型
- 当前工作目录
- 当前时间

## 2 上下文

**Todo：待补充**
