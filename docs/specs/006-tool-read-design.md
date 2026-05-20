## 1 ReadTool 设计

ReadTool — 文件读取工具，供 AI Agent 读取本地文件内容。

### 1.1 工具定义

- **name**: `file_read`
- **description**: Reads a file from the local filesystem
- **parameters**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file_path | string | 是 | 绝对路径或相对路径 |
| offset | number | 否 | 起始行号（默认 1，从第一行开始） |
| limit | number | 否 | 读取行数（不填则读取到文件末尾） |

### 1.2 文件类型支持

| 类型 | 扩展名 | 处理方式 | 大小限制 |
|------|--------|---------|---------|
| 文本 | 其他 | `readFileInRange()` 分段读取 + 行号格式化 | maxSizeBytes(256KB) |
| 图片 | .png/.jpg/.jpeg/.gif/.webp | 读取二进制 → base64 编码 | maxSizeBytes(256KB) |

> 注：PDF、Jupyter Notebook 支持将在后续版本添加。

### 1.3 安全措施

1. **设备文件黑名单** — 拒绝读取 `/dev/zero`、`/dev/random`、`/dev/urandom`、`/dev/full`、`/dev/stdin`、`/dev/tty`、`/dev/console`、`/dev/stdout`、`/dev/stderr`、`/dev/fd/0-2` 等，防止无限输出挂起进程
2. **二进制文件拒绝** — 通过扩展名判断，拒绝非文本、非图片的二进制文件
3. **路径规范化** — 使用 `path.resolve()` 统一处理 `~`、相对路径
4. **文件大小限制** — 默认 256KB 上限，超出提示使用 offset/limit 分段读取

### 1.4 读取流程

```
execute(args)
  ├─ 1. 参数校验 (file_path 必填)
  ├─ 2. 路径规范化 (path.resolve)
  ├─ 3. 设备文件黑名单检查
  ├─ 4. 按扩展名分发
  │     ├─ 图片 (.png/.jpg/.jpeg/.gif/.webp) → readImageFile()
  │     └─ 文本 → readTextFile()
  │           ├─ stat 检查文件大小
  │           ├─ createReadStream 分段读取
  │           └─ 添加行号 (cat -n 格式)
  ├─ 5. 输出格式化
  └─ 6. 错误处理 (ENOENT / 权限 / 大小超限)
```

### 1.5 输出格式

#### 文本文件

```
     1→第一行内容
     2→第二行内容
     3→第三行内容
```

文件末尾附加元信息：

```
[File: {filePath}, Lines: {startLine}-{endLine}/{totalLines}, Size: {size}B]
```

#### 图片文件

```
[Image: {filePath}, Type: {mimeType}, Size: {size}B, Base64 length: {length}]
```

并返回 base64 编码内容（供支持多模态的模型使用）。

#### 错误

```
Error: {errorMessage}
```

### 1.6 常量配置

| 常量 | 值 | 说明 |
|------|----|------|
| MAX_FILE_SIZE_BYTES | 262144 (256KB) | 文本文件最大读取字节数 |
| MAX_OUTPUT_LENGTH | 100000 | 输出最大字符数 |
| MAX_DEFAULT_LINES | 2000 | 无 limit 时默认最大读取行数 |
| BLOCKED_DEVICE_PATHS | Set<string> | 设备文件黑名单 |

### 1.7 代码组织

```
read-tool/
  ├── read-tool.ts          # ReadTool 主实现
  └── read-tool.test.ts     # 单元测试
```
