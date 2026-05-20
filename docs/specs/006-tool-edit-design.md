## 1 EditTool 设计

EditTool — 增量文件编辑工具，供 AI Agent 通过字符串替换来修改文件内容。

### 1.1 工具定义

- **name**: `file_edit`
- **description**: Performs exact string replacements in files
- **parameters**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file_path | string | 是 | 绝对路径或相对路径 |
| old_string | string | 是 | 要查找替换的文本（空字符串表示创建新文件） |
| new_string | string | 是 | 替换后的文本 |
| replace_all | boolean | 否 | 是否替换所有匹配（默认 false） |

### 1.2 核心功能

| 功能 | 说明 |
|------|------|
| 精确字符串替换 | 在文件中查找 old_string 并替换为 new_string |
| 引号规范化 | 支持弯引号 (curly quote) ↔ 直引号 (straight quote) 匹配 |
| 唯一性检查 | 多匹配且 replace_all=false 时报错，要求提供更多上下文或设置 replace_all |
| 新文件创建 | old_string="" 时创建新文件 |
| 保留原始行尾 | 保留文件原始的 CRLF/LF 行尾（与 WriteTool 强制 LF 不同） |
| 自动创建父目录 | 递归 mkdir |

### 1.3 安全措施

1. **设备文件黑名单** — 拒绝编辑设备文件
2. **路径规范化** — path.resolve 统一处理
3. **相同字符串检查** — old_string === new_string 时拒绝（无变更）
4. **目录检查** — 拒绝对目录路径的编辑

### 1.4 编辑流程

```
execute(args)
  ├─ 1. 参数校验 (file_path, old_string, new_string 必填)
  ├─ 2. 路径规范化 + 设备文件黑名单
  ├─ 3. 相同字符串检查
  ├─ 4. 读取文件内容
  │     ├─ 文件不存在
  │     │   ├─ old_string="" → 创建新文件
  │     │   └─ 否则 → 报错
  │     └─ 文件存在
  ├─ 5. 空文件 + old_string="" → 允许写入
  ├─ 6. 查找匹配 (findActualString)
  │     ├─ 精确匹配
  │     └─ 引号规范化匹配
  ├─ 7. 唯一性检查
  │     └─ matches > 1 && !replace_all → 报错
  ├─ 8. 执行替换 (保留原始行尾)
  ├─ 9. 写入文件
  └─ 10. 返回结果
```

### 1.5 引号规范化

模型无法输出弯引号（`'` `"`），但文件中可能包含。EditTool 通过两步处理：

1. **findActualString** — 先精确匹配，失败后将文件和搜索字符串都规范化为直引号再匹配
2. **preserveQuoteStyle** — 当 old_string 通过引号规范化匹配时，将 new_string 中的直引号转为相同风格的弯引号

### 1.6 输出格式

#### 编辑成功

```
The file {filePath} has been updated successfully.
```

#### 全局替换

```
The file {filePath} has been updated. All {count} occurrences were replaced.
```

#### 新文件创建

```
File created successfully at: {filePath}
```

#### 错误

```
Error: {errorMessage}
```

### 1.7 代码组织

```
edit-tool/
  ├── edit-tool.ts          # EditTool 主实现 + 引号规范化工具函数
  └── edit-tool.test.ts     # 单元测试
```

### 1.8 与 ReadTool/WriteTool 的对比

| 维度 | ReadTool | WriteTool | EditTool |
|------|----------|-----------|----------|
| 用途 | 读取文件 | 创建/覆盖文件 | 增量编辑文件 |
| 输入 | path + offset + limit | path + content | path + old + new + replace_all |
| 行尾 | 保留原始 | 强制 LF | 保留原始 |
| 传输效率 | — | 发送完整内容 | 只发送 diff 片段 |
