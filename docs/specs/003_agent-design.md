## 1 Agent

Agent 使用 `streaming tool-use loop` 实现

## 1 上下文

agent定义用Yaml-frontmatter + markdown，其中frontmatter支持如下字段：

	name: 必选，字符串，名称，使用大小写、下划线、减号、数字字符组成
    alias: 可选，字符串，该Agent的别名，用于展示
	description: 必选，字符串，agent功能描述
	tools: 可选，列表，可用工具列表
	model: 可选，字符串，建议的模型provider（llm/目录下的配置文件文件名（不包含后缀））
