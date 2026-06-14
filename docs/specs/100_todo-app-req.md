todo应用模块是一个和agent结合到一起的待办应用模块，可以基于todo创建agent任务；todo应用模块通过分组（category）和标签（label）进行组织

**todo应用的需求**：

1. 分组（category），支持多级分组，增删改查
2. todolist，todo 条目增删改差
3. todo条目，支持子条目，可以关联**文档**
4. 全文搜索功能，能够搜索category、todolist、todo项目（使用sqlite + FTS5插件实现）
5. 文档系统，文档为markdown文档，支持图片

**category要包含如下字段**：

- 名称
- 创建时间、最后修改时间
- 父category ID

*注：catetory是递归结构，为了性能考虑，可限制在4层以内*

**todo_list包含如下字段**：

- 名称（150字以内）
- 描述（500字以内）
- 创建时间、最后修改时间

**todo_item 要包含如下字段**：

- 待办条目内容（150字以内）
- 待办条目描述（500字以内）
- 任务描述（驱动AI任务，补充信息给agent）
- 父 todo_item_id
- 状态标记（初始化、进行种、结束、废弃）
- 进度（0-100数字）
- 重要性标记（紧急、重要、一般、提示）
- 创建时间、最后修改时间
- 截止时间
- 标签列表（标签ID列表）
- todo_list_id
- agent_task_id（关联的agent任务）

*注：todo_item是递归结构，为了性能考虑，可限制在4层以内*

**文档系统要包含如下字段**：

- 名称
- 内容
- todo_category_id
- todo_item_id
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
