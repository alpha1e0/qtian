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

### 4.2 Agent定义文件 (`agent/*.md`)


### 4.3 LLM数据

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


### 4.4 Skill数据

一个标准的 AI Skill 通常以一个独立的文件夹形式存在。

- **技能根目录 (`Skill_Name/`)**：存放该技能所有相关文件的总文件夹，目录名为英文、下划线、减号的组合。
    - **`SKILL.md` (核心文件)**：技能的入口文档，包含技能的元数据、定义和工作流指令。
    - **`scripts/` (可选)**：存放可执行代码（如 Python、Shell 脚本），用于处理 AI 无法直接完成的确定性任务。
    - **`templates/` (可选)**：定义输出结果的固定格式模板。
    - **`assets/` 或 `docs/` (可选)**：存放该技能依赖的背景参考资料、图片或文档。

最关键的 `SKILL.md` 文件采用 **Markdown** 格式，并结合 **YAML** 元数据来定义技能属性。

**(1) YAML 元数据 (Front-matter)**

位于文件顶部，用于让 AI 系统识别技能的基本信息：


```yaml
---
name: "技能名称（如：Markdown格式化助手）"
description: "详细描述技能用途及触发场景。AI 依靠此描述决定何时调用该技能。"
version: "1.0.0"
---
```

**(2) 核心指令 (Instructions)**

使用标准的 Markdown 语法编写，告诉 AI 具体的技能知识


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

`AI回答`内容为一个富文本气泡，支持markdown渲染
