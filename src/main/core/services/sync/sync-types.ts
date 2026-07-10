/**
 * 数据同步（WebDAV）— 公共类型与常量。
 *
 * 仅包含纯类型与常量，无运行时逻辑，便于单元测试与复用。
 */

/** 远端 meta.json 版本号（结构变更时升级） */
export const META_VERSION = 1;

/** 远端镜像根目录名（位于配置的 folder 下） */
export const REMOTE_SYNC_ROOT = 'qtian-sync';

/** 远端 meta.json 文件名 */
export const REMOTE_META_FILENAME = 'meta.json';

/**
 * 同步方向（getStatus 决策结果）。
 *
 * - upload：本地上传到远端
 * - download：远端下载到本地
 * - noop：两端均无变化
 * - conflict：两端均有变化（已按最新优先策略给出推荐方向）
 * - error：状态判定失败（如未配置 / 连接失败）
 */
export type SyncDirection = 'upload' | 'download' | 'noop' | 'conflict' | 'error';

/**
 * 同步状态（getStatus 返回）。
 */
export interface SyncStatus {
  /** 推荐的同步方向 */
  direction: SyncDirection;
  /** 本地最新修改时间（checkpoint 后 stat .db + 目录扫描的最大 mtime，ms） */
  localNewestMtime: number;
  /** 上次同步完成时间（本地 meta 缓存，ms） */
  lastSyncTime: number | null;
  /** 远端 meta 的 last_sync_time（ms），不存在时为 null */
  remoteLastSyncTime: number | null;
  /** 冲突或错误时的提示信息 */
  message?: string;
}

/**
 * 同步操作结果。
 */
export interface SyncResult {
  /** 是否成功完成（有 errors 也可能 success=true，表示主体完成） */
  success: boolean;
  /** 同步方向 */
  direction: 'upload' | 'download';
  /** 本次同步涉及的文件数 */
  fileCount: number;
  /** 本次同步完成的时间戳（ms） */
  syncedAt: number;
  /** 错误信息列表（部分文件失败时记录，不阻断整体） */
  errors: string[];
  /** 警告信息列表（如冲突覆盖提示） */
  warnings: string[];
}

/**
 * 远端 meta.json 中单个文件的元数据。
 */
export interface RemoteFileEntry {
  size: number;
  mtime: number;
}

/**
 * 远端 meta.json 结构。
 */
export interface RemoteMeta {
  version: number;
  last_sync_time: number;
  device_id: string;
  files: Record<string, RemoteFileEntry>;
}

/**
 * 本地 meta.json 缓存结构（workspace/.sync/meta.json）。
 */
export interface LocalMeta {
  last_sync_time: number;
  known_remote_time: number;
  known_remote_device: string;
}

/**
 * tracked 路径条目：区分 DB 文件（需 online backup）与普通目录（递归文件）。
 */
export interface TrackedPath {
  /** 相对 workspace 的路径 */
  relPath: string;
  /** DB 文件（经 SQLite online backup）或普通目录（递归文件传输） */
  kind: 'db' | 'dir';
}

/**
 * WebDAV 客户端配置（camelCase 内存形式）。
 */
export interface WebdavClientConfig {
  url: string;
  accountName: string;
  accountPassword: string;
  folder: string;
}

/**
 * WebDAV PROPFIND 解析出的单个资源。
 */
export interface WebdavResource {
  /** 相对 remote root 的 href（已解码、去前缀） */
  href: string;
  /** 是否为目录（collection） */
  isCollection: boolean;
  /** 内容长度（字节，文件才有） */
  size?: number;
}
