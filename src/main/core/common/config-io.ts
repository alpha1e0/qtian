import * as fs from 'fs';
import * as path from 'path';

import { createLogger } from '@/core/utils/logger';
import type { WebdavConfig } from './context';

const logger = createLogger('ConfigIO');

/** 临时文件后缀，配合 fs.rename 实现原子写入 */
const TMP_SUFFIX = '.tmp';

/**
 * WebDAV 配置（snake_case 形式，对应 qtian.json 的 global.webdav 段）
 */
export interface WebdavConfigJson {
  url?: string;
  account_name?: string;
  account_password?: string;
  folder?: string;
}

/**
 * 将内存 camelCase 的 WebdavConfig 转为 snake_case JSON 段。
 *
 * 注意：清空配置（cfg 为 null）会从 JSON 中移除 `global.webdav` 段，
 * 以保证 qtian.json 干净（不留空对象）。
 */
function toWebdavJson(cfg: WebdavConfig | null): WebdavConfigJson {
  return {
    url: cfg?.url ?? '',
    account_name: cfg?.accountName ?? '',
    account_password: cfg?.accountPassword ?? '',
    folder: cfg?.folder ?? '',
  };
}

/**
 * 原子写入 qtian.json 的 `global.webdav` 段，保留其余段不变。
 *
 * 实现：读取现有 JSON → 仅替换 `global.webdav`（或置空时清空字段）→
 * 写入 `<configPath>.tmp` → `fs.rename` 原子替换。
 *
 * @param configPath - qtian.json 完整路径
 * @param cfg - 待写入的 WebDAV 配置；传 null 表示清空（写入空串字段）
 */
export function writeGlobalWebdavConfig(configPath: string, cfg: WebdavConfig | null): void {
  let root: Record<string, unknown> = {};

  // 读取现有配置（若文件不存在或解析失败，从空对象开始重建）
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      root = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      logger.warn(`Failed to parse existing config at '${configPath}', rebuilding`, err);
      root = {};
    }
  }

  // 仅修改 global.webdav 段，其余段保留
  const globalSeg = (root.global as Record<string, unknown> | undefined) ?? {};
  globalSeg.webdav = toWebdavJson(cfg);
  root.global = globalSeg;

  // 原子写：先写 .tmp，再 rename
  const tmpPath = configPath + TMP_SUFFIX;
  const jsonStr = JSON.stringify(root, null, 2);
  fs.writeFileSync(tmpPath, jsonStr, 'utf-8');
  fs.renameSync(tmpPath, configPath);

  logger.info(`WebDAV config written to ${path.basename(configPath)}`);
}

/**
 * 读取 qtian.json 的 `global.webdav` 段并转为 camelCase 内存形式。
 *
 * 文件不存在或段缺失时返回 null。
 *
 * @param configPath - qtian.json 完整路径
 */
export function readGlobalWebdavConfig(configPath: string): WebdavConfig | null {
  if (!fs.existsSync(configPath)) {
    return null;
  }
  let root: Record<string, unknown>;
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    root = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    logger.warn(`Failed to parse config at '${configPath}'`, err);
    return null;
  }

  const webdavJson = (root.global as { webdav?: WebdavConfigJson } | undefined)?.webdav;
  if (!webdavJson) {
    return null;
  }

  // 全字段为空视为未配置
  const url = webdavJson.url ?? '';
  const accountName = webdavJson.account_name ?? '';
  const accountPassword = webdavJson.account_password ?? '';
  const folder = webdavJson.folder ?? '';
  if (!url && !accountName && !accountPassword && !folder) {
    return null;
  }

  return { url, accountName, accountPassword, folder };
}
