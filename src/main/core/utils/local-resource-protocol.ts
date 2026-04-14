/**
 * Local Resource Protocol
 *
 * 注册自定义协议 local-resource，替代 file:// + webSecurity:false 方案。
 * 仅允许加载指定扩展名的本地文件（图片），提升安全性。
 *
 * URL 格式: local-resource:///C:/path/to/image.jpg
 * 使用方式:
 *   - 主进程: toLocalResourceUrl(filePath) 生成 URL
 *   - 渲染进程: 直接拼接 `local-resource:///${path}` (path 中的 \ 需替换为 /)
 */

import { Protocol } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { MIME_MAP } from '@/core/common/constants';
import { createLogger } from '@/core/utils/logger';

const logger = createLogger('LocalResourceProtocol');

/** 允许的文件扩展名集合（从 MIME_MAP 提取） */
const ALLOWED_EXTENSIONS = new Set(Object.keys(MIME_MAP));

/**
 * 将本地文件绝对路径转换为 local-resource:// URL
 *
 * Windows 路径中的反斜杠会被替换为正斜杠。
 *
 * @param filePath - 本地文件的绝对路径
 * @returns local-resource:// URL
 */
export function toLocalResourceUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return `local-resource://${normalized}`;
}

/**
 * 从 local-resource:// URL 中提取本地文件路径
 *
 * @param url - local-resource:// URL
 * @returns 解码后的本地文件绝对路径
 */
export function fromLocalResourceUrl(url: string): string {
  // local-resource:///C:/path/to/file -> C:/path/to/file
  // local-resource://C:/path/to/file -> C:/path/to/file
  let decoded = decodeURIComponent(url.replace(/^local-resource:\/\//, ''));
  // 三斜杠情况：去掉开头的 /
  if (decoded.startsWith('/') && decoded.length > 2 && decoded.charAt(2) === ':') {
    decoded = decoded.substring(1);
  }
  return decoded;
}

/**
 * 注册 local-resource 自定义协议
 *
 * 必须在 app.on('ready') 之后调用。
 * 同时需要在 app.on('ready') 之前通过 protocol.registerSchemesAsPrivileged 注册 scheme。
 *
 * @param protocol - Electron protocol 模块
 */
export function registerLocalResourceProtocol(protocol: Protocol): void {
  protocol.registerFileProtocol('local-resource', (request, callback) => {
    const filePath = fromLocalResourceUrl(request.url);

    // 安全校验：检查文件扩展名
    const ext = path.extname(filePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext) && !ALLOWED_EXTENSIONS.has(path.extname(filePath))) {
      logger.warn(`Blocked non-image file access: ${filePath}`);
      callback({ error: -2 }); // net::FAILED
      return;
    }

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      logger.warn(`File not found: ${filePath}`);
      callback({ error: -6 }); // net::FILE_NOT_FOUND
      return;
    }

    callback({ path: filePath });
  });

  logger.info('local-resource protocol registered');
}
