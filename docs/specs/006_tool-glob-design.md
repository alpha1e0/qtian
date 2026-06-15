## 1 GlobTool 设计

GlobTool — 文件模式匹配查找工具，供 AI Agent 按 glob 模式快速查找文件。

### 1.1 工具定义

- **name**: `glob`
- **description**: Fast file pattern matching tool
- **parameters**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| pattern | string | 是 | glob 模式，如 `**/*.ts`、`src/**/*.js` |
| path | string | 否 | 搜索目录，默认当前工作目录 |

### 1.2 核心功能

| 功能 | 说明 |
|------|------|
| glob 模式匹配 | 支持 `**`（递归目录）、`*`（单层通配）、`?`（单字符） |
| 搜索目录验证 | 验证 path 存在且为目录 |
| 绝对路径处理 | pattern 包含绝对路径时提取 base directory |
| 结果排序 | 按修改时间排序（最新优先） |
| 结果截断 | 默认最多 100 条，超出提示 |
| 路径相对化 | 输出相对于 cwd 的相对路径，节省 token |

### 1.3 glob-to-regex 转换规则

| glob 模式 | 正则表达式 | 说明 |
|-----------|-----------|------|
| `**` | `.*` | 跨目录任意匹配 |
| `*` | `[^/\\]*` | 单目录层级任意匹配 |
| `?` | `[^/\\]` | 单字符匹配 |
| `.` | `\.` | 字面量点号 |

处理步骤：先按 `/` 分割 pattern 为段，对含 `**` 的段特殊处理，其余段按规则转换。

### 1.4 执行流程

```
execute(args)
  ├─ 1. 参数校验 (pattern 必填)
  ├─ 2. 搜索目录确定
  │     ├─ pattern 含绝对路径 → 提取 baseDir
  │     ├─ path 参数 → 使用指定目录
  │     └─ 默认 → process.cwd()
  ├─ 3. 目录验证 (存在 + 是目录)
  ├─ 4. glob-to-regex 转换
  ├─ 5. 递归列出文件 (fs.readdir recursive)
  ├─ 6. 正则匹配过滤
  ├─ 7. 按修改时间排序 (stat.mtimeMs)
  ├─ 8. 截断 (最多 100 条)
  └─ 9. 格式化输出
```

### 1.5 输出格式

#### 找到文件

```
src/main/file1.ts
src/main/file2.ts
src/renderer/App.vue

[Found 3 files]
```

#### 截断提示

```
src/...

(Results are truncated. Consider using a more specific path or pattern.)
[Found 100+ files]
```

#### 无匹配

```
No files found
```

### 1.6 常量配置

| 常量 | 值 | 说明 |
|------|----|------|
| MAX_RESULTS | 100 | 默认最大返回文件数 |

### 1.7 代码组织

```
glob-tool/
  ├── glob-tool.ts          # GlobTool 主实现 + glob-to-regex 转换
  └── glob-tool.test.ts     # 单元测试
```
