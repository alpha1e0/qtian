import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream } from 'fs';
import * as readline from 'readline';
import { createLogger } from '@/core/utils/logger';
import { ITool } from '../tool.interface';

const logger = createLogger('ReadTool');

/** 文本文件最大读取字节数 (256KB) */
const MAX_FILE_SIZE_BYTES = 256 * 1024;

/** 输出最大字符数 */
const MAX_OUTPUT_LENGTH = 100_000;

/** 无 limit 时默认最大读取行数 */
const MAX_DEFAULT_LINES = 2000;

/** 行号格式化宽度 (右对齐，6 位) */
const LINE_NUMBER_WIDTH = 6;

/**
 * 设备文件黑名单 — 防止无限输出或阻塞输入的设备文件
 * 安全设备如 /dev/null 不在黑名单中
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

/** 支持的图片扩展名 */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

/** 常见二进制文件扩展名 (非文本、非图片) */
const BINARY_EXTENSIONS = new Set([
  'exe', 'dll', 'so', 'dylib', 'bin', 'obj', 'o',
  'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'ico', 'cur',
  'mp3', 'mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm',
  'wav', 'flac', 'aac', 'ogg',
  'sqlite', 'db', 'iso', 'dmg', 'jar', 'class',
  'pyc', 'pyd', 'nupkg',
]);

/**
 * 判断路径是否为被阻止的设备文件
 * @param filePath - 规范化后的文件路径
 */
function isBlockedDevicePath(filePath: string): boolean {
  if (BLOCKED_DEVICE_PATHS.has(filePath)) return true;
  // /proc/self/fd/0-2 等 Linux 别名
  if (filePath.startsWith('/proc/') && /\/fd\/[012]$/.test(filePath)) {
    return true;
  }
  return false;
}

/**
 * 判断文件扩展名是否为二进制文件
 * PDF 和图片不在二进制列表中 (工具原生支持)
 * @param ext - 文件扩展名 (不含点，小写)
 */
function isBinaryExtension(ext: string): boolean {
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * 判断文件扩展名是否为图片
 * @param ext - 文件扩展名 (不含点，小写)
 */
function isImageExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext);
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
 * 为行内容添加行号前缀 (cat -n 格式)
 * @param lineContent - 行内容 (不含换行符)
 * @param lineNumber - 行号
 */
function addLineNumber(lineContent: string, lineNumber: number): string {
  return String(lineNumber).padStart(LINE_NUMBER_WIDTH) + '→' + lineContent;
}

/**
 * 读取图片文件并返回 base64 编码描述
 * @param filePath - 文件绝对路径
 */
async function readImageFile(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

  if (buffer.length === 0) {
    throw new Error(`Image file is empty: ${filePath}`);
  }

  const base64 = buffer.toString('base64');
  const sizeStr = formatFileSize(buffer.length);

  const header = `[Image: ${filePath}, Type: ${mimeType}, Size: ${sizeStr}]\n`;
  const truncated = base64.length > MAX_OUTPUT_LENGTH
    ? base64.substring(0, MAX_OUTPUT_LENGTH) + '\n... (base64 truncated)'
    : base64;

  return header + truncated;
}

/**
 * 分段读取文本文件，支持 offset/limit 和行号格式化
 * @param filePath - 文件绝对路径
 * @param offset - 起始行号 (1-based)
 * @param limit - 读取行数 (undefined 表示读到末尾)
 */
async function readTextFile(
  filePath: string,
  offset: number,
  limit: number | undefined,
): Promise<string> {
  // 检查文件大小
  const stats = await fs.stat(filePath);
  if (stats.size > MAX_FILE_SIZE_BYTES && limit === undefined) {
    throw new Error(
      `File size (${formatFileSize(stats.size)}) exceeds maximum allowed size `
      + `(${formatFileSize(MAX_FILE_SIZE_BYTES)}). Use offset and limit parameters to read specific portions.`,
    );
  }

  // 使用 readline 按行读取
  const effectiveLimit = limit ?? MAX_DEFAULT_LINES;
  const lineOffset = Math.max(offset - 1, 0); // 转为 0-based

  const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity, // 自动处理 \r\n
  });

  const lines: string[] = [];
  let currentLine = 0;
  let totalLines = 0;

  for await (const line of rl) {
    totalLines++;
    if (currentLine >= lineOffset && lines.length < effectiveLimit) {
      lines.push(addLineNumber(line, currentLine + 1));
    }
    currentLine++;
  }

  const startLine = lineOffset + 1;
  const readCount = lines.length;
  const content = lines.join('\n');

  // 附加元信息
  const linesInfo = readCount > 0
    ? `Lines: ${startLine}-${startLine + readCount - 1}/${totalLines}`
    : `Lines: 0 read (offset ${startLine} beyond ${totalLines} total)`;
  const meta = `\n\n[File: ${filePath}, ${linesInfo}, Size: ${formatFileSize(stats.size)}]`;

  let output = content + meta;

  // 截断过长输出
  if (output.length > MAX_OUTPUT_LENGTH) {
    output = output.substring(0, MAX_OUTPUT_LENGTH) + '\n... (output truncated)';
  }

  return output;
}

/**
 * 内置文件读取工具 — 安全地读取本地文件
 *
 * 支持:
 * 1. 文本文件 — 分段读取 + 行号格式化 + 大小限制
 * 2. 图片文件 — base64 编码
 *
 * 安全措施:
 * 1. 设备文件黑名单拦截
 * 2. 二进制文件拒绝
 * 3. 路径规范化
 * 4. 文件大小限制
 */
export class ReadTool implements ITool {
  readonly name = 'file_read';
  readonly description =
    'Reads a file from the local filesystem. You can access any file directly by using this tool. '
    + 'Assume this tool is able to read all files on the machine. '
    + 'If the User provides a path to a file assume that path is valid. '
    + 'It is okay to read a file that does not exist; an error will be returned. '
    + 'By default, it reads up to 2000 lines starting from the beginning of the file. '
    + 'You can optionally specify a line offset and limit (especially handy for long files), '
    + 'but it\'s recommended to read the whole file by not providing these parameters.';
  readonly parameters: Record<string, any> = {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to read',
      },
      offset: {
        type: 'number',
        description:
          'The line number to start reading from. Only provide if the file is too large to read at once.',
      },
      limit: {
        type: 'number',
        description:
          'The number of lines to read. Only provide if the file is too large to read at once.',
      },
    },
    required: ['file_path'],
  };

  /**
   * 执行文件读取
   * @param args - 工具参数
   * @param args.file_path - 文件路径
   * @param args.offset - 起始行号 (默认 1)
   * @param args.limit - 读取行数 (默认 2000)
   * @returns 文件内容文本
   */
  async execute(args: Record<string, any>): Promise<string> {
    const { file_path, offset: rawOffset, limit: rawLimit } = args;

    // 参数校验
    if (!file_path || typeof file_path !== 'string') {
      return 'Error: "file_path" is required and must be a string';
    }

    const offset = typeof rawOffset === 'number' ? Math.max(rawOffset, 1) : 1;
    const limit = typeof rawLimit === 'number' ? rawLimit : undefined;

    // 设备文件黑名单检查 — 在路径规范化前检查原始路径
    // Windows 上 path.resolve('/dev/zero') 会变为 'D:\dev\zero'，导致黑名单失效
    const trimmedPath = file_path.trim();
    if (isBlockedDevicePath(trimmedPath)) {
      logger.warn(`Blocked device path: ${trimmedPath}`);
      return `Error: Cannot read '${file_path}': this device file would block or produce infinite output.`;
    }

    // 路径规范化
    const resolvedPath = path.resolve(trimmedPath);
    logger.info(`Reading file: ${resolvedPath} (offset=${offset}, limit=${limit ?? 'all'})`)

    // 按扩展名分发
    const ext = path.extname(resolvedPath).toLowerCase().slice(1);

    // 二进制文件检查 (图片除外)
    if (ext && isBinaryExtension(ext) && !isImageExtension(ext)) {
      return `Error: Cannot read binary file '${file_path}'. The file appears to be a .${ext} binary file.`;
    }

    try {
      // 图片文件
      if (isImageExtension(ext)) {
        const result = await readImageFile(resolvedPath);
        logger.debug(`Image file read successfully: ${resolvedPath}`);
        return result;
      }

      // 文本文件
      const result = await readTextFile(resolvedPath, offset, limit);
      logger.debug(`Text file read successfully: ${resolvedPath}`);
      return result;
    } catch (error) {
      return this.handleReadError(error, file_path, resolvedPath);
    }
  }

  /**
   * 处理文件读取错误，提供友好提示
   * @param error - 捕获的异常
   * @param originalPath - 用户输入的原始路径
   * @param resolvedPath - 规范化后的路径
   */
  private handleReadError(error: unknown, originalPath: string, resolvedPath: string): string {
    const err = error as NodeJS.ErrnoException;

    if (err.code === 'ENOENT') {
      logger.warn(`File not found: ${resolvedPath}`);
      return `Error: File does not exist: ${originalPath}`;
    }

    if (err.code === 'EACCES' || err.code === 'EPERM') {
      logger.warn(`Permission denied: ${resolvedPath}`);
      return `Error: Permission denied: ${originalPath}`;
    }

    if (err.code === 'EISDIR') {
      logger.warn(`Path is a directory: ${resolvedPath}`);
      return `Error: '${originalPath}' is a directory, not a file.`;
    }

    // MaxFileReadTokenExceededError 或其他已知错误
    if (err.message?.includes('exceeds maximum')) {
      logger.warn(`File size exceeded: ${resolvedPath}`);
      return `Error: ${err.message}`;
    }

    logger.error(`Failed to read file: ${resolvedPath}`, err);
    return `Error: Failed to read file '${originalPath}': ${err.message}`;
  }
}
