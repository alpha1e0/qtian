import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '@/core/utils/logger';
import { ITool } from '../tool.interface';

const logger = createLogger('EditTool');

/**
 * 设备文件黑名单 — 与 ReadTool/WriteTool 共享
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

// 弯引号常量 — 模型无法输出弯引号，但文件中可能包含
const LEFT_SINGLE_CURLY_QUOTE = '\u2018';   // '
const RIGHT_SINGLE_CURLY_QUOTE = '\u2019';  // '
const LEFT_DOUBLE_CURLY_QUOTE = '\u201C';   // "
const RIGHT_DOUBLE_CURLY_QUOTE = '\u201D';  // "

/**
 * 判断路径是否为被阻止的设备文件
 */
function isBlockedDevicePath(filePath: string): boolean {
  if (BLOCKED_DEVICE_PATHS.has(filePath)) return true;
  if (filePath.startsWith('/proc/') && /\/fd\/[012]$/.test(filePath)) {
    return true;
  }
  return false;
}

/**
 * 将弯引号转为直引号
 * @param str - 包含可能弯引号的字符串
 */
function normalizeQuotes(str: string): string {
  return str
    .replaceAll(LEFT_SINGLE_CURLY_QUOTE, "'")
    .replaceAll(RIGHT_SINGLE_CURLY_QUOTE, "'")
    .replaceAll(LEFT_DOUBLE_CURLY_QUOTE, '"')
    .replaceAll(RIGHT_DOUBLE_CURLY_QUOTE, '"');
}

/**
 * 在文件内容中查找匹配字符串（精确匹配 → 引号规范化匹配）
 * @param fileContent - 文件内容
 * @param searchString - 搜索字符串
 * @returns 文件中实际匹配的字符串，未找到返回 null
 */
function findActualString(
  fileContent: string,
  searchString: string,
): string | null {
  // 先精确匹配
  if (fileContent.includes(searchString)) {
    return searchString;
  }

  // 引号规范化匹配
  const normalizedSearch = normalizeQuotes(searchString);
  const normalizedFile = normalizeQuotes(fileContent);

  const searchIndex = normalizedFile.indexOf(normalizedSearch);
  if (searchIndex !== -1) {
    return fileContent.substring(searchIndex, searchIndex + searchString.length);
  }

  return null;
}

/**
 * 判断引号字符前是否为开引号上下文
 */
function isOpeningContext(chars: string[], index: number): boolean {
  if (index === 0) return true;
  const prev = chars[index - 1];
  return (
    prev === ' ' || prev === '\t' || prev === '\n' || prev === '\r'
    || prev === '(' || prev === '[' || prev === '{'
  );
}

/**
 * 对字符串中的双引号应用弯引号风格
 */
function applyCurlyDoubleQuotes(str: string): string {
  const chars = [...str];
  const result: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '"') {
      result.push(
        isOpeningContext(chars, i)
          ? LEFT_DOUBLE_CURLY_QUOTE
          : RIGHT_DOUBLE_CURLY_QUOTE,
      );
    } else {
      result.push(chars[i]!);
    }
  }
  return result.join('');
}

/**
 * 对字符串中的单引号应用弯引号风格（区分引号与缩写撇号）
 */
function applyCurlySingleQuotes(str: string): string {
  const chars = [...str];
  const result: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "'") {
      // 两个字母之间的撇号视为缩写（如 don't），使用 right single curly quote
      const prev = i > 0 ? chars[i - 1] : undefined;
      const next = i < chars.length - 1 ? chars[i + 1] : undefined;
      const prevIsLetter = prev !== undefined && /\p{L}/u.test(prev);
      const nextIsLetter = next !== undefined && /\p{L}/u.test(next);
      if (prevIsLetter && nextIsLetter) {
        result.push(RIGHT_SINGLE_CURLY_QUOTE);
      } else {
        result.push(
          isOpeningContext(chars, i)
            ? LEFT_SINGLE_CURLY_QUOTE
            : RIGHT_SINGLE_CURLY_QUOTE,
        );
      }
    } else {
      result.push(chars[i]!);
    }
  }
  return result.join('');
}

/**
 * 当 old_string 通过引号规范化匹配时，将 new_string 中的直引号转为弯引号
 * 保持文件的引号风格一致性
 */
function preserveQuoteStyle(
  oldString: string,
  actualOldString: string,
  newString: string,
): string {
  if (oldString === actualOldString) return newString;

  const hasDoubleQuotes =
    actualOldString.includes(LEFT_DOUBLE_CURLY_QUOTE)
    || actualOldString.includes(RIGHT_DOUBLE_CURLY_QUOTE);
  const hasSingleQuotes =
    actualOldString.includes(LEFT_SINGLE_CURLY_QUOTE)
    || actualOldString.includes(RIGHT_SINGLE_CURLY_QUOTE);

  if (!hasDoubleQuotes && !hasSingleQuotes) return newString;

  let result = newString;
  if (hasDoubleQuotes) result = applyCurlyDoubleQuotes(result);
  if (hasSingleQuotes) result = applyCurlySingleQuotes(result);
  return result;
}

/**
 * 执行字符串替换
 * 当 new_string 为空且 old_string 后紧跟换行时，一并移除换行
 */
function applyEdit(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): string {
  const replaceFn = replaceAll
    ? (s: string) => s.replaceAll(oldString, newString)
    : (s: string) => s.replace(oldString, newString);

  if (newString !== '') return replaceFn(content);

  // 删除场景：如果 old_string 末尾无换行但文件中紧跟换行，一并删除
  const stripTrailingNewline =
    !oldString.endsWith('\n') && content.includes(oldString + '\n');

  return stripTrailingNewline
    ? replaceFn(
      replaceAll
        ? content.replaceAll(oldString + '\n', newString)
        : content.replace(oldString + '\n', newString),
    )
    : replaceFn(content);
}

/**
 * 内置文件编辑工具 — 通过字符串替换增量编辑文件
 *
 * 功能:
 * 1. 精确字符串替换 — old_string → new_string
 * 2. 引号规范化 — curly quote ↔ straight quote 兼容匹配
 * 3. 唯一性检查 — 多匹配时要求 replace_all 或更多上下文
 * 4. 新文件创建 — old_string="" 时创建新文件
 * 5. 保留原始行尾 — 不强制 LF
 *
 * 安全措施:
 * 1. 设备文件黑名单
 * 2. 相同字符串检查
 * 3. 路径规范化
 */
export class EditTool implements ITool {
  readonly name = 'file_edit';
  readonly description =
    'Performs exact string replacements in files. '
    + 'Use this tool to edit files by specifying the exact text to replace (old_string) and the replacement text (new_string). '
    + 'The tool will fail if old_string is not unique in the file (unless replace_all is true). '
    + 'To create a new file, pass an empty string as old_string. '
    + 'You MUST use the Read tool first to read the file contents before editing.';
  readonly parameters: Record<string, any> = {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to edit',
      },
      old_string: {
        type: 'string',
        description: 'The text to replace in the file. Use empty string to create a new file.',
      },
      new_string: {
        type: 'string',
        description: 'The text to replace it with',
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace all occurrences of old_string (default false)',
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
  };

  /**
   * 执行文件编辑
   * @param args - 工具参数
   * @returns 编辑结果文本
   */
  async execute(args: Record<string, any>): Promise<string> {
    const { file_path, old_string, new_string, replace_all = false } = args;

    // 参数校验
    if (!file_path || typeof file_path !== 'string') {
      return 'Error: "file_path" is required and must be a string';
    }

    if (old_string === undefined || old_string === null || typeof old_string !== 'string') {
      return 'Error: "old_string" is required and must be a string';
    }

    if (new_string === undefined || new_string === null || typeof new_string !== 'string') {
      return 'Error: "new_string" is required and must be a string';
    }

    // 相同字符串检查
    if (old_string === new_string) {
      return 'Error: No changes to make: old_string and new_string are exactly the same.';
    }

    // 设备文件黑名单检查
    const trimmedPath = file_path.trim();
    if (isBlockedDevicePath(trimmedPath)) {
      return `Error: Cannot edit '${file_path}': device files are not editable.`;
    }

    // 路径规范化
    const resolvedPath = path.resolve(trimmedPath);
    logger.info(`Editing file: ${resolvedPath} (replace_all=${replace_all})`);

    try {
      // 读取文件内容
      let fileContent: string | null = null;
      let fileExists = false;

      try {
        const stat = await fs.stat(resolvedPath);
        if (stat.isDirectory()) {
          return `Error: '${file_path}' is a directory, not a file.`;
        }
        fileContent = await fs.readFile(resolvedPath, 'utf-8');
        fileExists = true;
      } catch (err) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code === 'ENOENT') {
          fileContent = null;
          fileExists = false;
        } else {
          throw err;
        }
      }

      // 文件不存在 — 仅在 old_string="" 时允许创建新文件
      if (!fileExists) {
        if (old_string === '') {
          return await this.createNewFile(resolvedPath, new_string);
        }
        return `Error: File does not exist: ${file_path}`;
      }

      // 文件存在 + old_string="" — 仅在文件为空时允许
      if (old_string === '') {
        if (fileContent!.trim() !== '') {
          return 'Error: Cannot create new file - file already exists and is not empty.';
        }
        return await this.createNewFile(resolvedPath, new_string);
      }

      // 查找匹配（精确 → 引号规范化）
      const actualOldString = findActualString(fileContent!, old_string);
      if (!actualOldString) {
        return `Error: String to replace not found in file.\nString: ${old_string}`;
      }

      // 唯一性检查
      const matchCount = fileContent!.split(actualOldString).length - 1;
      if (matchCount > 1 && !replace_all) {
        return (
          `Error: Found ${matchCount} matches of the string to replace, but replace_all is false. `
          + 'To replace all occurrences, set replace_all to true. '
          + 'To replace only one occurrence, provide more context to uniquely identify the instance.'
        );
      }

      // 保持引号风格
      const actualNewString = preserveQuoteStyle(old_string, actualOldString, new_string);

      // 保留原始行尾风格（检测文件中使用的行尾类型）
      const usesCRLF = fileContent!.includes('\r\n');
      const normalizedContent = fileContent!.replace(/\r\n/g, '\n');

      // 执行替换
      const updatedContent = applyEdit(normalizedContent, actualOldString, actualNewString, replace_all);

      // 验证替换是否生效
      if (updatedContent === normalizedContent) {
        return 'Error: String not found in file. Failed to apply edit.';
      }

      // 恢复行尾风格
      const finalContent = usesCRLF
        ? updatedContent.replace(/\n/g, '\r\n')
        : updatedContent;

      // 写入文件
      await fs.writeFile(resolvedPath, finalContent, 'utf-8');

      if (replace_all && matchCount > 1) {
        logger.info(`File updated: ${resolvedPath} (${matchCount} replacements)`);
        return `The file ${resolvedPath} has been updated. All ${matchCount} occurrences were replaced.`;
      }

      logger.info(`File updated: ${resolvedPath}`);
      return `The file ${resolvedPath} has been updated successfully.`;
    } catch (error) {
      return this.handleEditError(error, file_path, resolvedPath);
    }
  }

  /**
   * 创建新文件
   */
  private async createNewFile(resolvedPath: string, content: string): Promise<string> {
    const dir = path.dirname(resolvedPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(resolvedPath, content, 'utf-8');

    logger.info(`File created: ${resolvedPath}`);
    return `File created successfully at: ${resolvedPath}`;
  }

  /**
   * 处理编辑错误
   */
  private handleEditError(error: unknown, originalPath: string, resolvedPath: string): string {
    const err = error as NodeJS.ErrnoException;

    if (err.code === 'EACCES' || err.code === 'EPERM') {
      logger.warn(`Permission denied: ${resolvedPath}`);
      return `Error: Permission denied: ${originalPath}`;
    }

    if (err.code === 'ENOSPC') {
      return `Error: No space left on device when writing to ${originalPath}`;
    }

    if (err.code === 'EROFS') {
      return `Error: Read-only filesystem: ${originalPath}`;
    }

    logger.error(`Failed to edit file: ${resolvedPath}`, err);
    return `Error: Failed to edit file '${originalPath}': ${err.message}`;
  }
}
