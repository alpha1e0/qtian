# 数据同步（WebDAV）设计文档

> 关联需求：[`010_data-sync-req.md`](./010_data-sync-req.md)
> 模块编号：010
> 阶段：**后端优先**（配置 schema、WebDAV 客户端、SQLite online backup、SyncService 编排、IPC、preload API、单元测试与冒烟 e2e。**不含前端 UI**，设置页留到下一阶段）

---

## 1. 目标与范围

通过 WebDAV 把工作区数据同步到云端，支持多设备间数据迁移与备份。本阶段交付：

- `qtian.json` 新增 `global.webdav` 配置段（原子写入）
- WebDAV 客户端（PROPFIND / GET / PUT / MKCOL / DELETE / HEAD）
- SQLite online backup（`better-sqlite3` 的 `backup()` API，不直接拷盘文件）
- SyncService 编排：状态判定（upload/download/noop/conflict）+ 上传 / 下载流程
- IPC 通道 + preload `window.sync` API
- SideBar 同步触发按钮（Refresh 图标，旋转动效 + ElMessage 结果提示）
- 单元测试覆盖决策矩阵与上传/下载流程，e2e 冒烟验证 IPC 接线

**不含**：完整设置页 UI（WebDAV 配置表单留到下一阶段）、定时同步、启动自动同步、按文件粒度增量同步。

### 1.1 同步触发入口（SideBar）

左侧图标工具栏底部「打开设置」与「退出应用」之间新增 `Refresh` 图标按钮（`aria-label='数据同步'`）。点击行为：

1. 未配置 WebDAV（`window.sync.getConfig()` 返回 null）→ `ElMessage.warning('请先配置 WebDAV 同步')`
2. 已配置 → 调 `window.sync.syncAuto()`，同步期间 Refresh 图标 CSS 旋转动效（`is-spinning` 类，1s 线性循环）+ 按钮禁用防重复点击
3. 结果提示：
   - 成功 → `ElMessage.success('同步成功（上传/下载 N 项）')`
   - 无变化（noop）→ `ElMessage.info('已是最新，无需同步')`
   - 失败 → `ElMessage.error(错误信息)`

SideBar 为纯展示组件（新增 `isSyncing` prop 控制动效），业务逻辑在 `MainComponent.handleSync`。

---

## 2. 关键决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 冲突策略 | **整体方向 + 最新优先** | 同步内容视为整体；冲突时较新时间戳一方覆盖另一方并告警。简单、可预测，避免复杂的按文件合并 |
| 同步时机 | **仅手动触发** | 不做定时/启动自动同步，降低误覆盖风险；用户显式点击 |
| 远端结构 | `<folder>/qtian-sync/` 镜像本地 workspace | 结构一致便于排查；meta.json 位于根 |
| DB 备份 | SQLite online backup API | WAL 模式下直接拷盘文件会破坏一致性，必须用 `db.backup()` |
| DB 恢复 | close → copyFileSync → reopen → 恢复 WAL pragma → 删 -wal/-shm | `@types/better-sqlite3` 的 `backup()` 仅声明文件路径重载；为类型安全 restore 走文件覆盖 |
| 配置写入 | 写 `.tmp` → `fs.rename` | 原子性，仅修改 `global.webdav` 段，其余段保留 |

> 注：需求文档里的 `webdava` 是 `webdav` 的笔误，实现以 `webdav` 为准。

---

## 3. 同步数据流

### 3.1 Tracked 内容（相对 workspace）

| 类型 | 相对路径 | 处理方式 |
|------|---------|---------|
| 目录 | `assistant/agent` | 递归 putFile / getFile |
| 目录 | `assistant/llm` | 递归 putFile / getFile |
| 目录 | `assistant/skill` | 递归 putFile / getFile |
| 目录 | `assistant/tool` | 递归 putFile / getFile |
| DB 文件 | `app_modules/todo_app/todo.db` | 经 SQLite online backup |
| 目录 | `app_modules/todo_app/attach` | 递归 putFile / getFile |
| DB 文件 | `app_modules/note_app/note.db` | 经 SQLite online backup |
| 目录 | `app_modules/note_app/attach` | 递归 putFile / getFile |

### 3.2 远端镜像

远端根目录：`<folder>/qtian-sync/`，结构与本地 workspace 一致；`meta.json` 位于该根。

### 3.3 meta.json 结构

**远端 `meta.json`**（位于 `<folder>/qtian-sync/meta.json`）：
```json
{
  "version": 1,
  "last_sync_time": 1700000000000,
  "device_id": "device-xxx",
  "files": {
    "assistant/llm/default.json": { "size": 1024, "mtime": 1700000000000 }
  }
}
```

**本地缓存 `workspace/.sync/meta.json`**：
```json
{
  "last_sync_time": 1700000000000,
  "known_remote_time": 1700000000000,
  "known_remote_device": "device-xxx"
}
```

---

## 4. getStatus() 决策矩阵（整体方向）

1. 远端 meta 不存在 → `upload`（首次同步，本机作为初始上传源）
2. 本地 meta 不存在 → `download`（本机首次接入，信任远端）
3. `localChanged = localNewestMtime > localMeta.last_sync_time`
4. `remoteChanged = remoteMeta.last_sync_time !== localMeta.known_remote_time`
5. 都未变 → `noop`
6. 仅 local 变 → `upload`
7. 仅 remote 变 → `download`
8. 都变（冲突）→ 最新优先：
   - `localNewestMtime >= remoteMeta.last_sync_time` → `upload`（带 warning）
   - 否则 → `download`（带 warning）

**localNewestMtime 计算**：先 `checkpoint()`（`wal_checkpoint(TRUNCATE)`）使 `.db` 文件成为单一时间源，再只 stat `.db` 文件，避免 WAL 边界问题。

---

## 5. 关键签名

### 5.1 DBManager（`db-manager.ts`）

```ts
checkpoint(): void                                   // this.db.pragma('wal_checkpoint(TRUNCATE)')
async backupTo(destPath: string): Promise<void>      // this.checkpoint(); await this.db.backup(destPath)
async restoreFrom(srcPath: string): Promise<void>    // close → copyFileSync(src→dbPath) → reopen → WAL pragma → 删 -wal/-shm
```

`restoreFrom` 在 `DBManager` 内部重赋值 `this.db`，下游 Service 持有的是 `DBManager` 引用（经由 `TodoDb.getDBManager()`），仍可用。

### 5.2 WebdavClient（注入 transport 便于测试）

```ts
type TransportFn = (method: string, url: string, opts: {headers; body?}) => Promise<{statusCode; body; headers}>;
class WebdavClient {
  constructor(cfg: {url, accountName, accountPassword, folder}, transport?: TransportFn);
  testConnection(): Promise<boolean>                 // PROPFIND depth 0
  ensureDir(relPath: string): Promise<void>          // MKCOL，405/409 视为已存在
  listDir(relPath: string): Promise<WebdavResource[]>// PROPFIND depth 1，正则解析 multistatus
  getFile(relPath: string, destPath: string): Promise<void>
  putFile(relPath: string, srcPath: string): Promise<void>
  deleteResource(relPath: string): Promise<void>
  exists(relPath: string): Promise<boolean>          // HEAD
}
```

### 5.3 SyncService（DI）

```ts
interface SyncServiceDeps {
  workspaceRoot: string; syncMetaPath: string;
  todoDb: TodoDb; noteDb: NoteDb;
  webdavConfigProvider: () => WebdavClientConfig | null;
  deviceId: string;
}
class SyncService {
  getStatus(): Promise<SyncStatus>
  syncUpload(): Promise<SyncResult>      // DB: checkpoint+backupTo→putFile；dir: 递归 putFile；写远端 meta + 本地 meta
  syncDownload(): Promise<SyncResult>    // 读远端 manifest→getFile 到 temp；DB: restoreFrom；dir: 覆盖本地 + 按 manifest 裁剪；写本地 meta
  syncAuto(): Promise<SyncResult>        // getStatus → 路由
  testConnection(): Promise<boolean>
  getWebdavConfig(): WebdavClientConfig | null
}
```

依赖注入（workspace 路径、DB 引用、webdav 配置 provider）避免依赖全局 mock 的 `wpath`/`config`，便于单元测试。

---

## 6. IPC 通道

`src/shared/ipc-channels.ts` 新增：

```
SYNC_GET_STATUS / SYNC_UPLOAD / SYNC_DOWNLOAD / SYNC_AUTO
SYNC_TEST_CONNECTION / SYNC_GET_CONFIG / SYNC_SAVE_CONFIG
```

`SYNC_SAVE_CONFIG`：调 `writeGlobalWebdavConfig(wpath.configPath, cfg)`，并更新内存 `config.global.webdav`。

preload 暴露 `window.sync` 命名空间（`getStatus`/`syncUpload`/`syncDownload`/`syncAuto`/`testConnection`/`getConfig`/`saveConfig`）。

---

## 7. 文件清单

### 新增（13）

| 文件 | 用途 |
|------|------|
| `src/main/core/common/config-io.ts` | 原子写 `qtian.json` 的 `global.webdav` 段 |
| `src/main/core/common/config-io.test.ts` | 配置 IO 单测 |
| `src/main/core/database/db-manager.test.ts` | backup/restore 单测（文件级 mock） |
| `src/main/core/services/sync/sync-types.ts` | 类型 + 常量（版本号、远端根目录名） |
| `src/main/core/services/sync/sync-tracked-paths.ts` | tracked 路径定义 |
| `src/main/core/services/sync/webdav-client.ts` | WebDAV 客户端 |
| `src/main/core/services/sync/webdav-client.test.ts` | 客户端单测（注入 transport） |
| `src/main/core/services/sync/sync-service.ts` | 编排核心 |
| `src/main/core/services/sync/sync-service.test.ts` | 决策矩阵 + 上传/下载流程单测 |
| `src/main/core/services/sync/sync-bootstrap.ts` | 单例 + `bootstrapSync()`/`getSyncService()` |
| `src/main/core/ipc/handlers/sync.handler.ts` | IPC handler 注册 |
| `tests/e2e/smoke/sync-ipc.spec.ts` | IPC 接线冒烟 |

### 修改（7）

| 文件 | 改动 |
|------|------|
| `src/main/core/common/context.ts` | 新增 `WebdavConfig`/`GlobalConfig` 接口；`ConfigData.global?`；`Config.global.webdav`（camelCase + initConfig 解析 snake_case JSON）；`WPath` 新增 `syncDir`/`syncMetaPath` |
| `src/main/core/database/db-manager.ts` | 新增 `checkpoint()` / `backupTo(destPath)` / `restoreFrom(srcPath)` |
| `src/main/core/services/app-modules/todo-app/todo-app.service.ts` | 新增 `getDb(): TodoDb` |
| `src/main/core/services/app-modules/note-app/note-app.service.ts` | 新增 `getDb(): NoteDb` |
| `src/shared/ipc-channels.ts` | 新增 `SYNC_*` 频道常量 |
| `src/main/index.ts` | `bootstrapNoteApp()` 之后调用 `bootstrapSync()`（try/catch，失败不阻断启动） |
| `src/preload/index.ts` | 新增 `api.sync` 命名空间 + `contextBridge.exposeInMainWorld('sync', api.sync)` |

---

## 8. 测试策略

| 测试 | 要点 |
|------|------|
| `config-io.test.ts` | 空文件 / 已有段混写 / 清空 / 临时文件 + rename 无残留 / 异常路径 |
| `db-manager.test.ts` | 文件级 `vi.mock('better-sqlite3')` 注入含 `backup/close/pragma` 的本地 mock；验证 `backupTo` 调 `backup(destPath)`、`restoreFrom` 走 close→copy→reopen 序列、WAL pragma 恢复、旧 -wal/-shm 删除 |
| `webdav-client.test.ts` | 注入 transport 桩；覆盖 auth header、PROPFIND 解析、MKCOL 405 容错、GET/PUT/DELETE/HEAD、URL 拼接（尾斜杠）、非 2xx 抛 `WebdavError` |
| `sync-service.test.ts` | 临时 workspace；注入 mock `WebdavClient`（接口级）+ mock DBManager；跑全 8 种决策矩阵；上传写 manifest 并 PUT、下载按 manifest 还原 + 裁剪；meta 持久化往返（upload 后再 getStatus 应为 noop）；无配置 / 连接失败的错误形态 |
| e2e 冒烟 | `window.sync.getStatus()` 返回带 `direction` 的对象；`getConfig()` 返回 null；`testConnection()` 在空配置下返回结构化错误不崩 |

---

## 9. 风险与回退

| 风险 | 缓解 |
|------|------|
| restore 关连接瞬间若有并发写会失败 | 同步仅手动触发且 better-sqlite3 同步语义，风险低；失败时 `SyncResult.errors` 记录且本地 meta 不推进，可重试 |
| WebDAV 服务端 XML 差异 | 解析失败降级为空列表 + 告警，不崩溃；后续可加 XML 库（暂不引入） |
| 远端不存在 `meta.json` 时被误判为首次上传 | 决策矩阵第 1 条仅当远端 meta 真不存在（HEAD/GET 404）才触发 upload |
| 真机 WebDAV 端到端验证 | 留待 Phase 2 UI 联调时进行（后端优先阶段以单测 + 冒烟为主） |
