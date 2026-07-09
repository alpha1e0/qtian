todo应用模块是一个和agent结合到一起的待办应用模块，可以基于todo创建agent任务；todo应用模块通过分组（category）和标签（label）进行组织

**todo应用的需求**：

1. 分组（category），支持多级分组，增删改查
2. 待办项目（todo_list），todo 条目增删改查
3. 待办条目（todo_item），支持子条目，可以关联**文档**
4. 全文搜索功能，能够搜索category、todo_list、todo_item（使用sqlite + FTS5插件实现）；支持前缀匹配（输入不完整词也能命中以该词为开头的索引词，满足"边打边搜"体验）
   - 支持项目内搜索（scope）：选中某个"待办项目"（todo_list）时，可将搜索范围限定在该项目内的 todo_item + todo_document；范围切换通过搜索栏的"全部 / 当前项目"分段按钮控制
5. 文档系统，文档为markdown文档，支持图片

**category要包含如下字段**：

- 名称
- 创建时间、最后修改时间
- 父category ID

*注：catetory是递归结构，为了性能考虑，可限制在4层以内*

**todo_list包含如下字段**：

- 名称（150字以内）
- 描述（1200字以内）
- 创建时间、最后修改时间
- 标签列表（标签ID列表）
- category_id

**todo_item 要包含如下字段**：

- 待办条目内容（150字以内）
- 待办条目描述（1200字以内，支持选中文本右键一键创建为子/根待办条目，按行拆分）
- 任务描述（驱动AI任务，补充信息给agent）
- 父 todo_item_id
- 状态标记（初始化、进行种、结束、废弃）
- 进度（0-100数字）
- 重要性标记（紧急、重要、一般、提示）
- 创建时间、最后修改时间
- 截止时间
- todo_list_id
- agent_task_id（关联的agent任务）

*注：todo_item是递归结构，为了性能考虑，可限制在4层以内*

**文档系统要包含如下字段**：

- 名称
- 内容
- todo_list_id（关联待办项目）
- todo_item_id（关联待办条目，与 todo_list_id 互斥）
- 创建时间、最后修改时间

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
	      todo_app/          # todo应用模块的工作目录
            config.jsonc       # todo应用的配置文件
	        todo.db            # todo应用的数据库文件
            attach/            # 关联的图片、附件等内容
        projects/          # 项目目录
        log/               # 日志目录
        qtian.json         # 配置文件
      app/               # 应用exe目录
        qtian.exe          # 应用主程序
```

**UI**

左中右结构：

- 左侧用于导航，两种方式：category（默认）和label方式，每个category和label下显示其中包含的todo list
- 中间部分用于展示todo list
- 右侧部分显示摘要信息

**todo驱动AI任务**

支持通过todo_item驱动agent完成任务
