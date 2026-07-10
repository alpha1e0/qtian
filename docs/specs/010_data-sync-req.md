增加联网同步功能：

1. 使用webdav实现同步
2. 配置文件增加 global字段，保存webdav配置

```json
{
  "ai_assistant": {
    // ......
  },
  "global": {
    "webdava": {
      "url": "https://you-web-dav.com",
      "account_name": "you account name",
      "account_password": "you account password",
      "folder": "which folder to save"
    }
  }
}
```

4. 保存内容包含workspace中的模型配置（workspace\assistant\llm）、agent（workspace\assistant\agent）、skill（workspace\assistant\skill）、tool（workspace\assistant\tool）、todo-app数据库文件和attach附件目录、note-app数据库文件和attach附件目录
5. 用meta.json记录最后一次同步时间，基于同步是间来判断本地和服务端哪个是最新的
6. sqlite备份的时候使用sqlite的online backup api导出最新内容，不要直接备份磁盘上的文件