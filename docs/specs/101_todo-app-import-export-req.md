# Todo 应用 — 待办项目导入/导出 需求

## 1. 背景

todo-app 目前只能在应用内手动建立分类 / 待办项目 / 待办条目，数据无法在分类之间迁移，也无法在机器之间流转。本期提供「待办项目（todo_list）导出为 JSON 文件」「从 JSON 文件导入到指定分类下」的能力，用于备份、迁移、共享。

## 2. 功能入口

入口位于左侧 sidebar 分类树的右键菜单（与既有"新建/重命名/删除"同菜单）：

- **待办项目（todo_list）节点** 右键 → 增加菜单项「**导出待办项目**」
- **分类（category）节点** 右键 → 增加菜单项「**导入待办项目**」

> 文案统一使用「待办项目」，与既有 UI（"新建待办项目"）保持一致。

## 3. 导出（Export）

### 3.1 交互流程

1. 用户在某个待办项目节点上右键 → 「导出待办项目」
2. 弹出系统原生保存文件对话框，默认文件名 `todo-list-<listId>-<timestamp>.json`，过滤器仅 `.json`
3. 用户选择路径并确认 → 写入 JSON 文件 → 成功提示「已导出到：xxx.json」
4. 用户取消对话框 → 静默，无任何提示

### 3.2 导出范围

- 包含该 `todo_list` 下的所有**未软删除** `todo_item`，按父子关系组装成嵌套树
- 携带字段：title / description / task_prompt / status / progress / priority / due_at / is_manual_progress / 标签（仅 name）/ 子条目（递归）
- **不导出**：`agent_task_id`（运行时关联 task 表，跨库无意义）、`document`（独立附件体系，附件文件无法跨机器）、原 `id` / `created_at` / `updated_at`（跨库无意义）

### 3.3 导出文件格式

带版本号的 JSON，结构如下：

```json
{
  "version": 1,
  "exported_at": 1719235200000,
  "list": {
    "name": "项目名",
    "description": "项目描述"
  },
  "items": [
    {
      "title": "条目标题",
      "description": "",
      "task_prompt": "",
      "status": "init",
      "progress": 0,
      "priority": "normal",
      "due_at": null,
      "is_manual_progress": false,
      "labels": ["标签A", "标签B"],
      "children": []
    }
  ]
}
```

- `version` 当前为 `1`，后续 schema 变更按版本分支兼容
- `items` 为嵌套树（children 递归）

## 4. 导入（Import）

### 4.1 交互流程

1. 用户在某个分类节点上右键 → 「导入待办项目」
2. 弹出系统原生打开文件对话框，过滤器仅 `.json`
3. 用户选择文件并确认 → 主进程读取、解析、按快照重建到该分类下 → 成功提示「已导入 N 个条目」，左侧树自动选中新创建的待办项目
4. 用户取消 → 静默

### 4.2 导入语义

| 项 | 行为 |
|---|---|
| 待办项目 | **总是新建**一个 `todo_list`（即便与现有同名；`todo_list.name` 无唯一约束） |
| 时间戳 | 使用当前时间，不保留导出文件中的原 `created_at` |
| 父子关系 | 按嵌套 children 结构 DFS 自顶向下重建，`parent_id` 指向新建父条目 |
| 进度 | **按快照原值落库，不触发进度联动重算**（避免子项均值覆盖导出时的进度） |
| 标签 | 按 name **find-or-create**：本地已存在（未软删）则复用其 id，否则新建同名标签后挂载；标签 `type` 不参与导入导出 |
| agent_task_id | 导入后置为 null |
| document | 不导入（独立体系） |

### 4.3 校验与错误处理

导入前预校验（不留下脏数据）：

- JSON 解析失败 → 报错「JSON 解析失败」
- `version` 不等于 `1` → 报错「不支持的版本」
- 缺少 `list.name` → 报错
- 目标 `categoryId` 不存在或已软删 → 报错
- 嵌套深度超过 `MAX_TODO_ITEM_DEPTH`(=4) → 报错
- 条目总数超过 `TODO_MAX_IMPORT_ITEMS`(=5000) → 报错（防御性，避免超大文件 OOM）
- 任一条目 `title` 为空 → 报错

### 4.4 事务与回滚

- 待办项目创建后，批量重建 item 在单个事务内完成
- 若重建过程中抛错，补偿回滚已创建的 `todo_list`（软删 + 物理删），避免孤儿数据

## 5. 非功能要求

- 导出 / 导入逻辑（序列化、反序列化）与文件 IO、对话框解耦，便于单元测试
- 主进程服务层代码必须有对应 `.test.ts` 单元测试覆盖（见 100 系列规约）
- IPC 通道命名延续 `qtian:todo:<verb-...>` 规范
