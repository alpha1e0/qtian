## 1 GrepTool 设计

GrepTool — 文件内容搜索工具，供 AI Agent 在文件内容中搜索匹配的正则表达式。

### 1.1 工具定义

- **name**: `grep`
- **description**: Search file contents with regex pattern
- **parameters**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| pattern | string | 是 | 正则表达式搜索模式 |
| path | string | 否 | 搜索路径（文件或目录），默认 cwd |
| glob | string | 否 | 文件过滤模式（如 `*.ts`, `*.{ts,tsx}`） |
| output_mode | string | 否 | `files_with_matches` / `content` / `count`，默认 `files_with_matches` |
| -i | boolean | 否 | 忽略大小写，默认 false |
| -C | number | 否 | 上下文行数 |
| -B | number | 否 | 匹配前显示行数 |
| -A | number | 否 | 匹配后显示行数 |
| head_limit | number | 否 | 限制输出条数，默认 50 |

### 1.2 三种输出模式

| 模式 | 输出内容 | head_limit 作用对象 |
|------|---------|-------------------|
| `files_with_matches` (默认) | 匹配的文件路径列表 | 文件数 |
| `content` | 匹配行内容（含行号 + 上下文） | 输出行数 |
| `count` | 每个文件的匹配计数 | 文件数 |

### 1.3 执行流程

```
execute(args)
  ├─ 1. 参数校验 (pattern 必填)
  ├─ 2. 搜索路径确定 + 验证
  ├─ 3. 构造正则表达式 (pattern + -i)
  ├─ 4. 收集待搜索文件列表
  │     ├─ path 是文件 → 搜索单个文件
  │     └─ path 是目录 → 递归列出文件
  │           └─ glob 过滤
  │           └─ VCS 目录排除 (.git, .svn 等)
  │           └─ 二进制文件跳过
  ├─ 5. 逐文件搜索
  │     ├─ 读取文件内容
  │     ├─ 正则匹配
  │     └─ 按 output_mode 收集结果
  ├─ 6. 应用 head_limit / offset
  ├─ 7. 路径相对化
  └─ 8. 格式化输出
```

### 1.4 输出格式

#### files_with_matches

```
src/main/file1.ts
src/main/file2.ts
```

末尾附截断提示（如需要）。

#### content

```
src/main/file1.ts:10:matching line content
src/main/file1.ts:10-context line before
src/main/file1.ts:10+context line after
```

#### count

```
src/main/file1.ts: 3 matches
src/main/file2.ts: 1 match
```

#### 无匹配

```
No matches found
```

### 1.5 常量配置

| 常量 | 值 | 说明 |
|------|----|------|
| DEFAULT_HEAD_LIMIT | 50 | 默认输出上限 |
| MAX_LINE_LENGTH | 500 | 单行最大显示字符数 |
| VCS_DIRS | Set\<string\> | 排除的 VCS 目录 |
| BINARY_EXTENSIONS | Set\<string\> | 跳过的二进制文件扩展名 |

### 1.6 代码组织

```
grep-tool/
  ├── grep-tool.ts          # GrepTool 主实现
  └── grep-tool.test.ts     # 单元测试
```
