web search tool设计

## 0 About

搜索工具（web search tool）用于实现agent联网搜索

## 1 工具名称

`web_search`

## 2 工具描述


- 搜索网络，并使用搜索结果来辅助生成回复
- 为时事和近期数据提供最新信息
- 以搜索结果块的形式返回搜索结果信息，其中的链接使用 Markdown 超链接格式
- 使用此工具获取超出 Claude 知识截止日期之外的信息
- 搜索在单次 API 调用中自动执行

**关键要求 - 您必须遵循以下规定**：

- 在回答用户问题后，必须在回复末尾包含一个 “Sources:”（来源）部分
- 在来源部分，将搜索结果中的所有相关 URL 以 Markdown 超链接形式列出：[标题](URL)
- 这是强制性的 —— 绝不要在回复中省略来源
- 格式示例：

```
[您的回答内容]

Sources:

- [Source Title 1](https://example.com/1)
- [Source Title 2](https://example.com/2)
```

使用说明：

支持域名过滤，可包含或屏蔽特定网站
网络搜索仅在美国可用
重要提示 - 在搜索查询中使用正确的年份：

当前月份为 ${currentMonthYear}。在搜索近期信息、文档或时事时，必须使用今年的年份。
示例：如果用户询问 “latest React docs”（最新 React 文档），请使用当前年份搜索 “React documentation”（React 文档），而不是去年。


## 3 工具输入参数

`query`： 必选参数，字符串，需要查询的问题

## 4 工具实现

工具使用`Tavily` API，API调用参考 `4.1 Tavily search 接口使用`

### 4.1 Tavily search 接口使用

```
curl -X POST https://api.tavily.com/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer tvly-YOUR_API_KEY" \
  -d '{"query": "Who is Leo Messi?"}'
```

**参数说明：**

`query`： 必选参数，字符串，需要查询的问题


**返回结果示例**

{
  "query": "Who is Leo Messi?",
  "answer": "Lionel Messi, born in 1987, is an Argentine footballer widely regarded as one of the greatest players of his generation. He spent the majority of his career playing for FC Barcelona, where he won numerous domestic league titles and UEFA Champions League titles. Messi is known for his exceptional dribbling skills, vision, and goal-scoring ability. He has won multiple FIFA Ballon d'Or awards, numerous La Liga titles with Barcelona, and holds the record for most goals scored in a calendar year. In 2014, he led Argentina to the World Cup final, and in 2015, he helped Barcelona capture another treble. Despite turning 36 in June, Messi remains highly influential in the sport.",
  "images": [],
  "results": [
    {
      "title": "Lionel Messi Facts | Britannica",
      "url": "https://www.britannica.com/facts/Lionel-Messi",
      "content": "Lionel Messi, an Argentine footballer, is widely regarded as one of the greatest football players of his generation. Born in 1987, Messi spent the majority of his career playing for Barcelona, where he won numerous domestic league titles and UEFA Champions League titles. Messi is known for his exceptional dribbling skills, vision, and goal",
      "score": 0.81025416,
      "raw_content": null,
      "favicon": "https://britannica.com/favicon.png",
      "images": [
        {
          "url": "<string>",
          "description": "<string>"
        }
      ]
    }
  ],
  "response_time": "1.67",
  "auto_parameters": {
    "topic": "general",
    "search_depth": "basic"
  },
  "usage": {
    "credits": 1
  },
  "request_id": "123e4567-e89b-12d3-a456-426614174111"
}


参考文档：https://docs.tavily.com/documentation/api-reference/endpoint/search

### 4.2 实现设计


**Tavily API key获取**

从 `qtian.json` 中参数 `tavily_api_key`获取

### 4.3 工具接口定义

工具名称：`web_search`

```ts
class WebSearchTool implements ITool {
  readonly name = 'web_search';
  readonly description = '...'; // 详见需求文档 §2
  readonly parameters = { /* JSON Schema，详见下表 */ };

  constructor(apiKeyProvider: () => string) {}
  async execute(args: Record<string, any>): Promise<string> {}
}
```

**参数 JSON Schema**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| query | string | 是 | 搜索关键词 |
| max_results | number | 否 | 返回结果条数，默认 5，范围 1-10 |
| search_depth | string | 否 | `basic`(默认) / `advanced` |
| include_domains | string[] | 否 | 仅包含这些域名的结果 |
| exclude_domains | string[] | 否 | 排除这些域名的结果 |
| include_answer | boolean | 否 | 是否返回 Tavily 生成的摘要答案，默认 true |

**构造参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| apiKeyProvider | () => string | 同步函数，返回最新 API key（从 config 读取，避免硬编码、便于单测注入） |

### 4.4 执行流程

```
execute(args)
  ├─ 1. 参数校验
  │     ├─ query 必填且为字符串、非空
  │     ├─ max_results 1-10
  │     ├─ search_depth ∈ {basic, advanced}
  │     └─ include_domains / exclude_domains 为字符串数组
  ├─ 2. 获取 API key (apiKeyProvider())
  │     └─ 为空 → 返回错误提示
  ├─ 3. 构造 Tavily 请求 body
  │     { query, max_results, search_depth, include_domains,
  │       exclude_domains, include_answer: true, topic: 'general' }
  ├─ 4. fetch POST https://api.tavily.com/search
  │     ├─ headers: Content-Type + Authorization Bearer
  │     ├─ signal: AbortController (默认 30s)
  │     └─ HTTP 非 2xx → 抛错并返回错误文本
  ├─ 5. 解析 JSON 响应
  │     ├─ network/timeout → 错误文本
  │     └─ JSON 解析失败 → 错误文本
  └─ 6. formatResults() 格式化输出
```

### 4.5 输出格式

成功时返回 Markdown 文本：

```
<answer 字段，若 include_answer=true 且非空>

## Sources

- [Title 1](https://example.com/1)
  Content snippet... (最多 500 字符)
- [Title 2](https://example.com/2)
  Content snippet...

Found 5 results in 1.67s
```

无结果：

```
No results found for: <query>
```

错误：

```
Error: <具体错误信息>
```

### 4.6 常量配置

| 常量 | 值 | 说明 |
|------|----|------|
| TAVILY_ENDPOINT | `https://api.tavily.com/search` | Tavily 搜索接口地址 |
| DEFAULT_TIMEOUT_MS | 30000 | 默认请求超时 |
| DEFAULT_MAX_RESULTS | 5 | 默认返回结果数 |
| MAX_RESULTS_LIMIT | 10 | 返回结果数上限 |
| MAX_CONTENT_LENGTH | 500 | 单条结果 content 截断长度，防 token 爆炸 |

### 4.7 错误处理

| 场景 | 行为 |
|------|------|
| query 缺失/非字符串/空 | 返回 `Error: "query" is required and must be a non-empty string` |
| max_results 越界 | 返回 `Error: "max_results" must be between 1 and 10` |
| search_depth 非法 | 返回 `Error: "search_depth" must be "basic" or "advanced"` |
| API key 未配置 | 返回 `Error: Tavily API key is not configured` |
| HTTP 4xx/5xx | 返回 `Error: Tavily API request failed: HTTP <status> <message>` |
| 请求超时 (AbortError) | 返回 `Error: Tavily API request timed out after 30s` |
| 网络异常 | 返回 `Error: Failed to call Tavily API: <message>` |
| JSON 解析失败 | 返回 `Error: Invalid response from Tavily API` |

### 4.8 代码组织

```
web-search-tool/
  ├── web-search-tool.ts          # WebSearchTool 主实现 + 结果格式化
  └── web-search-tool.test.ts     # 单元测试 (mock undici fetch)
```

注册位置：
- `src/main/core/services/tools/index.ts` 导出
- `src/main/core/ipc/handlers/ai-assistant.handler.ts` `buildTools()` 中按 `web_search` 名称注册
- API key 注入：`new WebSearchTool(() => config.tavilyApiKey)`

### 4.9 配置文件扩展

`qtian.json` 增加顶层 `tavily_api_key` 字段：

```json
{
  "ai_assistant": { ... },
  "tavily_api_key": "tvly-xxxxxxxxx"
}
```

`src/main/core/common/context.ts` 的 `ConfigData` 与 `Config` 类需同步扩展，运行时由 `config.initConfig()` 读取。

