note-app是一个和agent结合到一起的文档、笔记应用模块

**note应用的需求**：

1. 文档（doc），markdown格式，支持图片插入，增删改查，通过分组（category）和标签（label）进行组织
2. 分组（category），支持多级分组，增删改查
3. 标签（label），文档绑定标签，基于标签找文档
4. 全文搜索功能，能够搜索doc标题、doc摘要、doc内容（使用sqlite + FTS5插件实现）
5. 文档删除，软删除，放到回收站

**category要包含如下字段**：

- 名称
- 创建时间、最后修改时间
- 父category ID

*注：catetory是递归结构，为了性能考虑，可限制在4层以内*

**doc 要包含如下字段**：

- title（150字以内）
- 摘要（800字以内）
- 内容
- category ID
- AI任务描述（驱动AI任务来写文档）
- 创建时间、最后修改时间
- 标签列表（标签ID列表）
- is_favorite，是否收藏

**标签包含如下字段**

- 名称（30字符以内）
- 创建时间
- 类型（待后续扩展）

**目录结构**

```

安装目录/

      workspace/         # 工作目录，保存配置、数据文件、任务数据等
        assistant/         # 保存LLM配置、Agent定义、Skill定义等和助手定义相关的内容
        app_modules/       # 应用模块目录、
	      note_app/          # note应用模块的工作目录
              config.jsonc       # note应用的配置文件
              note.db            # note应用的数据库文件
              attach/            # 关联的图片、附件等内容
        projects/          # 项目目录
        log/               # 日志目录
        qtian.json         # 配置文件
      app/               # 应用exe目录
        qtian.exe          # 应用主程序
```

**UI**

UI `参考todo-app` 实现：

1. 图标侧栏SideBar.vue增加Document图标，触发note-app
2. 参考todo-app，最上面为搜索框
3. 参考todo-app，左侧为文档导航树，三个标签页（分类、标签、收藏）
4. 右侧为文档编辑区域，参考todo-app TodoDocumentEditor.vue 的实现
5. 文档编辑区域右下侧增加一个全局浮动按钮（使用ChatDotRound图标），点击后弹出模态框完成AI驱动任务（这部分可以先做简单原型，后续我再补充细节）

**注意事项**

note-app为独立的模块，不要直接引用todo-app中的模块，尤其是前端component