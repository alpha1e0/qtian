import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '@/core/utils/logger';
import { ITool } from '../tool.interface';

const logger = createLogger('WriteTool');

/** 写入内容最大字节数 (1MB) */
const MAX_CONTENT_SIZE_BYTES = 1024 * 1024;

/**
 * 设备文件黑名单 — 与 ReadTool 共享
 * 防止对设备文件的写入操作
 */
const BLOCKED_DEVICE_PATHS = new Set([
  '/dev/zero',
  '/dev/random',
  '/dev/urandom',
  '/dev/full',
  '/dev/stdin',
  '/dev/tty',
  '/dev/console',
  '/dev/stdout',
  '/dev/stderr',
  '/dev/fd/0',
  '/dev/fd/1',
  '/dev/fd/2',
]);

/**
 * 判断路径是否为被阻止的设备文件
 * @param filePath - 文件路径
 */
function isBlockedDevicePath(filePath: string): boolean {
  if (BLOCKED_DEVICE_PATHS.has(filePath)) return true;
  if (filePath.startsWith('/proc/') && /\/fd\/[012]$/.test(filePath)) {
    return true;
  }
  return false;
}

/**
 * 格式化文件大小为可读字符串
 * @param bytes - 字节数
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 计算内容行数
 * 以 \n 分割，尾随换行视为终止符而非空行
 * @param content - 文本内容
 */
function countLines(content: string): number {
  if (content.length === 0) return 0;
  // 尾随换行不计为额外空行
  const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content;
  return trimmed.split('\n').length;
}

/**
 * 将内容中的 CRLF 转为 LF
 * 防止跨平台脚本损坏（如 bash 脚本在 Linux 上被 \r 破坏）
 * @param content - 原始内容
 */
function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/**
 * 内置文件写入工具 — 创建新文件或覆盖已有文件
 *
 * 功能:
 * 1. 创建新文件 — 文件不存在时自动创建
 * 2. 覆盖已有文件 — 用 content 完整替换
 * 3. 自动创建父目录 — recursive mkdir
 * 4. 强制 LF 行尾 — 不继承旧文件的 CRLF
 *
 * 安全措施:
 * 1. 设备文件黑名单
 * 2. 内容大小限制 (1MB)
 * 3. 路径规范化
 * 4. 目录检查
 */
export class WriteTool implements ITool {
  readonly name = 'file_write';
  readonly description =
    'Writes a file to the local filesystem. '
    + 'This tool will overwrite the existing file if there is one at the provided path. '
    + 'If this is an existing file, you MUST use the Read tool first to read the file\'s contents. '
    + 'Prefer the Edit tool for modifying existing files — it only sends the diff. '
    + 'Only use this tool to create new files or for complete rewrites.';
  readonly parameters: Record<string, any> = {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to write (must be absolute, not relative)',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
    },
    required: ['file_path', 'content'],
  };

  /**
   * 执行文件写入
   * @param args - 工具参数
   * @param args.file_path - 目标文件路径
   * @param args.content - 要写入的内容
   * @returns 写入结果文本
   */
  async execute(args: Record<string, any>): Promise<string> {
    const { file_path, content } = args;

    // 参数校验
    if (!file_path || typeof file_path !== 'string') {
      return 'Error: "file_path" is required and must be a string';
    }

    if (content === undefined || content === null) {
      return 'Error: "content" is required';
    }

    if (typeof content !== 'string') {
      return 'Error: "content" must be a string';
    }

    // 设备文件黑名单检查 — 在路径规范化前检查原始路径
    const trimmedPath = file_path.trim();
    if (isBlockedDevicePath(trimmedPath)) {
      logger.warn(`Blocked device path: ${trimmedPath}`);
      return `Error: Cannot write to '${file_path}': device files are not writable.`;
    }

    // 路径规范化
    const resolvedPath = path.resolve(trimmedPath);

    // 内容大小检查
    const contentBytes = Buffer.byteLength(content, 'utf-8');
    if (contentBytes > MAX_CONTENT_SIZE_BYTES) {
      logger.warn(`Content size exceeded: ${contentBytes} bytes`);
      return `Error: Content size (${formatFileSize(contentBytes)}) exceeds maximum allowed size (${formatFileSize(MAX_CONTENT_SIZE_BYTES)}).`;
    }

    logger.info(`Writing file: ${resolvedPath} (${formatFileSize(contentBytes)})`);

    try {
      // 检查目标是否为目录
      try {
        const stat = await fs.stat(resolvedPath);
        if (stat.isDirectory()) {
          return `Error: '${file_path}' is a directory, not a file.`;
        }
      } catch (err) {
        // ENOENT — 文件不存在，可以创建
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code !== 'ENOENT') throw err;
      }

      // 检测文件是否已存在 (用于区分 create / update)
      let fileExists = false;
      try {
        await fs.access(resolvedPath);
        fileExists = true;
      } catch {
        fileExists = false;
      }

      // 创建父目录 (recursive)
      const dir = path.dirname(resolvedPath);
      await fs.mkdir(dir, { recursive: true });

      // 统一行尾为 LF 后写入
      const normalizedContent = normalizeLineEndings(content);
      await fs.writeFile(resolvedPath, normalizedContent, 'utf-8');

      const lines = countLines(normalizedContent);
      const writtenBytes = Buffer.byteLength(normalizedContent, 'utf-8');
      const sizeStr = formatFileSize(writtenBytes);

      if (fileExists) {
        logger.info(`File updated: ${resolvedPath} (${lines} lines, ${sizeStr})`);
        return `File updated successfully at: ${resolvedPath}\n(${lines} lines, ${sizeStr})`;
      } else {
        logger.info(`File created: ${resolvedPath} (${lines} lines, ${sizeStr})`);
        return `File created successfully at: ${resolvedPath}\n(${lines} lines, ${sizeStr})`;
      }
    } catch (error) {
      return this.handleWriteError(error, file_path, resolvedPath);
    }
  }

  /**
   * 处理文件写入错误
   * @param error - 捕获的异常
   * @param originalPath - 用户输入的原始路径
   * @param resolvedPath - 规范化后的路径
   */
  private handleWriteError(error: unknown, originalPath: string, resolvedPath: string): string {
    const err = error as NodeJS.ErrnoException;

    if (err.code === 'EACCES' || err.code === 'EPERM') {
      logger.warn(`Permission denied: ${resolvedPath}`);
      return `Error: Permission denied: ${originalPath}`;
    }

    if (err.code === 'ENOSPC') {
      logger.warn(`No space left on device: ${resolvedPath}`);
      return `Error: No space left on device when writing to ${originalPath}`;
    }

    if (err.code === 'EROFS') {
      logger.warn(`Read-only filesystem: ${resolvedPath}`);
      return `Error: Read-only filesystem: ${originalPath}`;
    }

    logger.error(`Failed to write file: ${resolvedPath}`, err);
    return `Error: Failed to write file '${originalPath}': ${err.message}`;
  }
}
