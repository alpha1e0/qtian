## 1 需求概述

构建一个高度模块化的桌面 AI 助手，支持从简单的**一问一答**到复杂的**自动化 Agent** 任务。

- **高度可扩展性**：无需写代码通过扩展能力可实现翻译、问答、文档分析、内容生成、自动化任务等，支持的扩展如下：
	- **场景**，通过prompt自定义角色、场景
	- **Skill**，通过Skill为Agent增加技能
	- **MCP**，扩展Agent工具
- **本地化优先**：所有配置、历史记录和记忆均存储在用户本地。

## 2 核心交互流程

### 2.1 任务执行流程（Agent 模式）

1. **用户输入**：用户在 UI 选择“操作助手”场景并输入指令。
2. **场景加载**：应用读取 `scenario/*.json`，注入对应的 `role` Markdown 内容，默认为default.json。
3. **Streaming Tool-use Loop 循环**，LLM LOOP 输出内容或决定工具调用。
4. **最终输出**：LLM 汇总结果，展示给用户。


## 3 功能模块划分

- **场景管理器 (Scenario Manager)**：负责调度模型、角色、技能的组装。
- **执行引擎 (Execution Engine)**：
    - **Streaming Tool-use Loop Agent**：负责 `Reasoning -> Acting` 的循环控制。
    - **上下文管理**：包含上下文压缩、Memory。
- **工具链 (Toolchain)**：
    - **MCP 集成器**：解析 `mcp.setting.json` 并连接外部服务。
    - **内置工具集**：Tavily 搜索、Local RAG、Shell（git-bash） 执行。
- **存储层 (Storage Layer)**：处理 JSON 场景文件、Markdown 文件及 SQLite/LevelDB 历史记录。


## 4 数据结构设计

### 4.1 数据存储

数据存储在localhost中，以文件形式存储在'工作目录/assistant'中，目录的结构如下：

```
assistant/          # 助手根目录
    agent/             # 存放Agent定义文件
    llm/               # 存放模型文件，定义模型基本信息 base_url、key、model_id
    skill/             # 存放skill文件，遵循skill标准
    tool/              # 工具文件
        mcp.setting.json   # mcp定义
    history/           # 历史记录存储位置
    memory/            # 记忆存储位置
```

### 4.2 LLM配置（llm/*.json）

该目录用于存放LLM参数配置，格式如下：

参考：
```json
{
  "base_url": "https://api.xxx.com/v1",  // 必选，模型base url
  "model": "Qwen/Qwen3.5-9B",            // 必选，模型ID
  "key": "api-key",                      // 必选，api_key
  "alias": "qwen",                       // 可选，模型别名，用于展示
  "temperature": 0.7,                    // 可选，模型温度
  "max_tokens": 2000,                    // 可选，模型最大输出token
  "proxy": ""                            // 可选，代理服务器
}
```

### 4.3 Agent定义文件 (`agent/*.md`)

该目录用于存放agent定义文件，agent定义文件为Markdown格式，开头包含**YAML 元数据 (Front-matter)**

详细内容参考 (./004_agent-design.md)

**默认Agent**：应用首次启动（工作目录初始化）时，若 `agent/default.md` 不存在，则自动创建默认Agent（name: `default`，个人综合工作助理）。文件已存在时不覆盖，保护用户修改。该默认Agent保证首次打开即可直接发起对话（快捷模式自动选中），无需手动创建。

### 4.4 Skill数据

该目录用于存放skill定义文件，详细内容参考 (./005_skill-design.md)


## 5 接口设计 (TypeScript 抽象)

### 5.1 模型适配器


```typescript
interface ILLMProvider {
  chat(messages: Message[], options: ChatOptions): Promise<ChatResponse>;
  stream(messages: Message[]): AsyncIterable<ChatResponse>;
}
```


### 5.2 工具调用接口


```typescript
interface ITool {
  name: string;
  description: string;
  parameters: object; // JSON Schema
  execute(args: any): Promise<string>;
}
```


## 6 UI交互设计

**触发**

在首页输入框输入指令，路由到“AI助手页面”

**AI助手页面**

页面布局为左右结构：

1. 左侧为“对话历史区域”
2. 右侧为“对话内容区域”

**对话历史区域**

从上到下依次为：

1. 场景选择下拉框
2. “+创建新对话” 按钮
3. 对话历史
4. 左侧区域可向左隐藏

**对话内容区域**

从上到下依次为：

1. 对话内容展示区域，用户输入内容靠右，AI回答内容靠左
2. 输入区域：左侧多行输入框、右侧为发送按钮

用户在未新建/未选择对话的情况下直接在输入区域发送消息时，自动以消息内容为标题创建新对话并发送，无需先手动“新建对话”。

`AI回答`内容为一个富文本气泡，支持markdown渲染
