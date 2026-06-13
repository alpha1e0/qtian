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

