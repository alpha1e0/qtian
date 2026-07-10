# 项目需求总览

## 1. 需求组织结构

需求文档命名方式：

	<编号>_<模块名称>_<作用>.md

	其中，作用包含 *req 需求* 、*design 设计* 、*ui-design UI设计*，如果没有则可能混合各种内容

## 2. 功能模块列表 (Feature Registry)



| 模块名称 | 简述 | 关联文档 |
| :--- | :--- | :--- |
| 总体需求 | 项目总体需求 | ./002_ai-assistant-req.md |
| 总体设计 | 项目总体设计 | ./002_ai-assistant-design.md |
| 快捷模式UI设计 | 快捷模式UI设计（独立窗口架构） | ./003_quick-mode-ui-design.md |
| 普通模式UI设计 | 普通模式UI设计 | ./003_normal-mode-chat-ui-design.md |
| 任务系统设计 | 公共任务系统（任务抽象、TaskManager、AgentTaskExecutor、Source 机制） | ./007_task-design.md |
| Todo 应用需求 | Todo 应用（含 FTS5 搜索、文档系统、Todo 驱动 AI 任务）需求 | ./100_todo-app-req.md |
| Todo 应用设计 | Todo 应用补充设计 | ./100_todo-app-design.md |
| Todo 导入导出需求 | 待办项目 JSON 导入/导出（备份、迁移、共享）需求 | ./101_todo-app-import-export-req.md |
| Note 应用需求 | Note 应用（Markdown 文档 + 分类 + 标签 + 全文搜索）需求 | ./110_note-app-req.md |
| Note 应用设计 | Note 应用补充设计（后端 Service + FTS5 + 回收站 + Sidebar 集成） | ./110_note-app-design.md |
| 主窗口外壳设计 | 主窗口 TitleBar 与 SideBar 重构（纯 UI） | ./003_main-window-shell-design.md |


**注意**： AI助手包含 **快捷模式（quick-mode）** 和 **普通模式（normal-mode）**，二者运行在**独立的 `BrowserWindow`** 中：

- **快捷模式（quick-mode）**，独立快捷窗口，一次性的临时对话，快捷键唤起，对话结果不保存，可手动转换为普通模式（经主进程中转，主窗口接收数据）
- **普通模式（normal-mode）**，主窗口默认模式，完整模式，记录历史，多轮对话

详见 `003_quick-mode-ui-design.md` 的"独立窗口架构"章节。


## 3. 公共模块

### 3.1 工作目录结构

应用安装后，最终的目录结构如下：

```
安装目录/
	  workspace/         # 工作目录，保存配置、数据文件、任务数据等
        assistant/         # 保存LLM配置、Agent定义、Skill定义等和助手定义相关的内容
        task/              # 公共任务系统数据（task.db，见007）
        app_modules/       # 应用模块目录
        projects/          # 项目目录
        log/               # 日志目录
        qtian.json         # 配置文件
	  app/               # 应用exe目录
		qtian.exe          # 应用主程序
```

工作目录默认为：`%LocalAppData%/Qtian/workspace`（Windows），如果设置了环境变量 `QTIAN_WORKSPACE`则优先使用环境变量中的目录为工作目录


### 4.2 全局配置设计

应用主配置文件，位于工作目录根目录，为json格式，例如：

```json
{
  "ai_assistant": {
    "default_agent": "default",
    "default_llm_config": "default",
    "max_tool_rounds": 30,
    "context_compress_threshold": 0.75,
    "tool_timeout_ms": 30000
  }
}
```

## 4. 测试基础设施

### 4.1 单元测试 (Vitest)

项目使用 Vitest 进行单元测试，测试文件位于 `src/main/core/` 目录下，与源代码文件并列放置。

**运行命令：**
- `npm test` - 运行所有单元测试
- `npm run test:ui` - 使用UI界面运行测试
- `npm run test:coverage` - 生成测试覆盖率报告

### 4.2 冒烟测试 (Playwright)

项目使用 Playwright 进行端到端冒烟测试，测试文件位于 `tests/e2e/smoke/` 目录。

**测试覆盖：**
- 应用启动和基本功能
- 导航功能
- 各功能模块的基本可用性

**运行命令：**
- `npm run test:smoke` - 运行所有冒烟测试
- `npm run test:e2e` - 运行所有E2E测试
- `npm run test:e2e:ui` - 使用UI界面运行测试
- `npm run test:e2e:debug` - 使用调试模式运行测试

详细文档请参考：`tests/e2e/README.md`


