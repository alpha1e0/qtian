## 1 WriteTool 设计

WriteTool — 文件写入工具，供 AI Agent 创建新文件或覆盖已有文件。

### 1.1 工具定义

- **name**: `file_write`
- **description**: Writes a file to the local filesystem
- **parameters**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file_path | string | 是 | 绝对路径或相对路径 |
| content | string | 是 | 要写入的完整文件内容 |

### 1.2 功能范围

| 功能 | 说明 |
|------|------|
| 创建新文件 | 文件不存在时创建新文件 |
| 覆盖已有文件 | 文件已存在时用 content 完整替换 |
| 自动创建父目录 | 递归 mkdir 确保目标目录存在 |
| 强制 LF 行尾 | 不继承旧文件的 CRLF，防止跨平台脚本损坏 |
| 内容大小限制 | 默认 1MB，防止写入过大内容 |

### 1.3 安全措施

1. **设备文件黑名单** — 拒绝写入 `/dev/zero` 等设备文件，与 ReadTool 共享黑名单
2. **路径规范化** — 使用 `path.resolve()` 统一处理路径
3. **内容大小限制** — 默认 1MB 上限，超出拒绝写入
4. **目录检查** — 拒绝对目录路径的写入

### 1.4 写入流程

```
execute(args)
  ├─ 1. 参数校验 (file_path 必填, content 必填)
  ├─ 2. 路径规范化 (path.resolve)
  ├─ 3. 设备文件黑名单检查
  ├─ 4. 内容大小检查 (1MB 限制)
  ├─ 5. 确认目标不是目录
  ├─ 6. 创建父目录 (recursive mkdir)
  ├─ 7. 检测文件是否已存在
  ├─ 8. 统一行尾为 LF
  ├─ 9. 写入文件 (fs.writeFile)
  └─ 10. 返回结果 (create / update)
```

### 1.5 输出格式

#### 创建新文件

```
File created successfully at: {filePath}
({lines} lines, {size})
```

#### 更新已有文件

```
File updated successfully at: {filePath}
({lines} lines, {size})
```

#### 错误

```
Error: {errorMessage}
```

### 1.6 常量配置

| 常量 | 值 | 说明 |
|------|----|------|
| MAX_CONTENT_SIZE_BYTES | 1048576 (1MB) | 写入内容最大字节数 |
| BLOCKED_DEVICE_PATHS | Set\<string\> | 设备文件黑名单 (与 ReadTool 共享) |

### 1.7 代码组织

```
write-tool/
  ├── write-tool.ts          # WriteTool 主实现
  └── write-tool.test.ts     # 单元测试
```

### 1.8 与 ReadTool 的对比

| 维度 | ReadTool | WriteTool |
|------|----------|-----------|
| 用途 | 读取文件内容 | 创建或覆盖文件 |
| 输入 | file_path + offset + limit | file_path + content |
| 行尾 | 读取时保留原始行尾 | 写入时强制 LF |
| 安全重点 | 设备文件 / 二进制文件 / 大小 | 设备文件 / 大小 / 目录检查 |
