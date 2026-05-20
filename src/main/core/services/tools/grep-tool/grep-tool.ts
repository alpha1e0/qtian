import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream } from 'fs';
import * as readline from 'readline';
import { createLogger } from '@/core/utils/logger';
import { ITool } from '../tool.interface';

const logger = createLogger('GrepTool');

/** 默认输出上限 */
const DEFAULT_HEAD_LIMIT = 50;

/** 单行最大显示字符数 (防止 base64/压缩文件刷屏) */
const MAX_LINE_LENGTH = 500;

/** 排除的 VCS 目录 */
const VCS_DIRS = new Set(['.git', '.svn', '.hg', '.bzr']);

/** 跳过的二进制文件扩展名 */
const BINARY_EXTENSIONS = new Set([
  'exe', 'dll', 'so', 'dylib', 'bin', 'obj', 'o',
  'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'ico', 'cur',
  'mp3', 'mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm',
  'wav', 'flac', 'aac', 'ogg',
  'sqlite', 'db', 'iso', 'dmg', 'jar', 'class',
  'pyc', 'pyd', 'png', 'jpg', 'jpeg', 'gif', 'webp',
]);

type OutputMode = 'files_with_matches' | 'content' | 'count';

/** 搜索匹配结果 */
interface GrepMatch {
  filePath: string;
  lineNumber: number;
  line: string;
}

/** 文件级匹配统计 */
interface FileMatchCount {
  filePath: string;
  count: number;
}

/**
 * 判断文件扩展名是否应跳过
 */
function shouldSkipFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase().slice(1);
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * 将 glob 模式转为正则表达式
 * 简化版本，支持 * 和 ** 以及 {a,b}
 */
function globToRegex(pattern: string): RegExp {
  let regex = pattern
    .replace(/\\/g, '/')
    // ** → 跨目录匹配
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    // * → 单层通配
    .replace(/\*/g, '[^/]*')
    .replace(/{{DOUBLESTAR}}/g, '.*')
    // ? → 单字符
    .replace(/\?/g, '[^/]')
    // {a,b} → 替代组
    .replace(/\{([^}]+)\}/g, (_, group) => `(?:${group.replace(/,/g, '|')})`)
    // 转义点号
    .replace(/\./g, '\\.');
  return new RegExp('^' + regex + '$', 'i');
}

/**
 * 截断过长行
 */
function truncateLine(line: string): string {
  if (line.length <= MAX_LINE_LENGTH) return line;
  return line.slice(0, MAX_LINE_LENGTH) + '... [truncated]';
}

/**
 * 在单个文件中搜索匹配行
 */
async function searchFile(
  filePath: string,
  regex: RegExp,
): Promise<GrepMatch[]> {
  const matches: GrepMatch[] = [];

  const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber++;
    if (regex.test(line)) {
      matches.push({ filePath, lineNumber, line: truncateLine(line) });
    }
    // 重置 regex lastIndex (非全局 regex 无需，但全局 regex 需要)
    regex.lastIndex = 0;
  }

  return matches;
}

/**
 * 递归收集目录下的所有文件路径
 * 排除 VCS 目录和二进制文件
 */
async function collectFiles(
  dir: string,
  globRegex: RegExp | null,
): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // 跳过 VCS 目录和 node_modules
      if (VCS_DIRS.has(entry.name) || entry.name === 'node_modules') continue;
      const subFiles = await collectFiles(fullPath, globRegex);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      // 跳过二进制文件
      if (shouldSkipFile(entry.name)) continue;
      // glob 过滤
      if (globRegex && !globRegex.test(entry.name)) continue;
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * 内置文件内容搜索工具 — 在文件内容中搜索正则表达式
 *
 * 功能:
 * 1. 三种输出模式 — files_with_matches / content / count
 * 2. 正则匹配 + 大小写忽略
 * 3. glob 文件过滤
 * 4. 上下文行 (-B/-A/-C)
 * 5. 结果分页 (head_limit + offset)
 *
 * 安全措施:
 * 1. VCS 目录排除
 * 2. 二进制文件跳过
 * 3. 行长度截断
 */
export class GrepTool implements ITool {
  readonly name = 'grep';
  readonly description =
    'Search file contents with a regex pattern. '
    + 'Supports three output modes: files_with_matches (default), content, and count. '
    + 'Use this tool when you need to find files containing specific text or patterns.';
  readonly parameters: Record<string, any> = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The regex pattern to search for in file contents',
      },
      path: {
        type: 'string',
        description:
          'File or directory to search in. Defaults to current working directory.',
      },
      glob: {
        type: 'string',
        description: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}")',
      },
      output_mode: {
        type: 'string',
        enum: ['files_with_matches', 'content', 'count'],
        description: 'Output mode (default: files_with_matches)',
      },
      '-i': {
        type: 'boolean',
        description: 'Case insensitive search',
      },
      '-C': {
        type: 'number',
        description: 'Number of context lines before and after match',
      },
      '-B': {
        type: 'number',
        description: 'Number of lines before match',
      },
      '-A': {
        type: 'number',
        description: 'Number of lines after match',
      },
      head_limit: {
        type: 'number',
        description: 'Limit output count (default: 50)',
      },
    },
    required: ['pattern'],
  };

  /**
   * 执行文件内容搜索
   */
  async execute(args: Record<string, any>): Promise<string> {
    const {
      pattern,
      path: searchPath,
      glob: globPattern,
      output_mode: rawMode,
      '-i': caseInsensitive = false,
      '-C': contextC,
      '-B': contextB,
      '-A': contextA,
      head_limit: rawHeadLimit,
    } = args;

    // 参数校验
    if (!pattern || typeof pattern !== 'string') {
      return 'Error: "pattern" is required and must be a string';
    }

    const outputMode: OutputMode = rawMode || 'files_with_matches';
    if (!['files_with_matches', 'content', 'count'].includes(outputMode)) {
      return `Error: Invalid output_mode "${outputMode}". Must be one of: files_with_matches, content, count`;
    }

    // head_limit 处理: null/undefined → 默认值
    const headLimit = rawHeadLimit === 0 ? Infinity : (rawHeadLimit ?? DEFAULT_HEAD_LIMIT);

    // 构造正则表达式
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, caseInsensitive ? 'gi' : 'g');
    } catch (err) {
      return `Error: Invalid regex pattern: ${pattern}`;
    }

    // 确定搜索路径
    const searchDir = searchPath ? path.resolve(searchPath) : process.cwd();
    logger.info(`Grep search: pattern="${pattern}", path="${searchDir}", mode="${outputMode}"`);

    // 验证搜索路径
    let isSingleFile = false;
    try {
      const stat = await fs.stat(searchDir);
      if (stat.isFile()) {
        isSingleFile = true;
      } else if (!stat.isDirectory()) {
        return `Error: Path is not a file or directory: ${searchDir}`;
      }
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT') {
        return `Error: Path does not exist: ${searchDir}`;
      }
      return `Error: Cannot access path: ${searchDir}`;
    }

    try {
      // 收集待搜索文件
      const globRegex = globPattern ? globToRegex(globPattern) : null;
      const files = isSingleFile
        ? [searchDir]
        : await collectFiles(searchDir, globRegex);

      if (files.length === 0) {
        return 'No files found';
      }

      // 上下文行数
      const contextBefore = contextC ?? contextB ?? 0;
      const contextAfter = contextC ?? contextA ?? 0;

      // 按模式搜索
      if (outputMode === 'files_with_matches') {
        return await this.searchFilesMode(files, regex, headLimit, globRegex);
      } else if (outputMode === 'count') {
        return await this.searchCountMode(files, regex, headLimit, globRegex);
      } else {
        return await this.searchContentMode(files, regex, headLimit, contextBefore, contextAfter, globRegex);
      }
    } catch (error) {
      const err = error as Error;
      logger.error(`Grep search failed: ${searchDir}`, err);
      return `Error: Failed to search: ${err.message}`;
    }
  }

  /**
   * files_with_matches 模式 — 返回匹配的文件路径列表
   */
  private async searchFilesMode(
    files: string[],
    regex: RegExp,
    headLimit: number,
    _globRegex: RegExp | null,
  ): Promise<string> {
    const matchedFiles: string[] = [];

    for (const file of files) {
      if (matchedFiles.length >= headLimit) break;

      try {
        const matches = await searchFile(file, regex);
        if (matches.length > 0) {
          matchedFiles.push(file);
        }
      } catch {
        // 跳过无法读取的文件
      }
    }

    if (matchedFiles.length === 0) return 'No matches found';

    const cwd = process.cwd();
    const truncated = matchedFiles.length >= headLimit;
    const results = matchedFiles.slice(0, headLimit);
    const lines = results.map(f => path.relative(cwd, f) || f);

    let output = lines.join('\n');
    if (truncated) {
      output += `\n\n(Results are truncated. Consider using a more specific path or pattern.)`;
    }

    return output;
  }

  /**
   * content 模式 — 返回匹配行内容
   */
  private async searchContentMode(
    files: string[],
    regex: RegExp,
    headLimit: number,
    contextBefore: number,
    contextAfter: number,
    _globRegex: RegExp | null,
  ): Promise<string> {
    const allMatches: GrepMatch[] = [];

    for (const file of files) {
      try {
        const matches = await searchFile(file, regex);
        allMatches.push(...matches);
      } catch {
        // 跳过无法读取的文件
      }

      // 提前截断以避免处理过多匹配
      if (allMatches.length >= headLimit + 100) break;
    }

    if (allMatches.length === 0) return 'No matches found';

    const cwd = process.cwd();
    const truncated = allMatches.length > headLimit;
    const results = allMatches.slice(0, headLimit);

    // 按文件分组，添加上下文
    const lines: string[] = [];
    for (const match of results) {
      const relPath = path.relative(cwd, match.filePath) || match.filePath;

      if (contextBefore > 0 || contextAfter > 0) {
        // 需要上下文 → 重新读取文件获取上下文行
        const contextLines = await this.getContextLines(
          match.filePath, match.lineNumber, contextBefore, contextAfter,
        );
        for (const ctx of contextLines.before) {
          lines.push(`${relPath}:${ctx.lineNumber}-${ctx.line}`);
        }
        lines.push(`${relPath}:${match.lineNumber}:${match.line}`);
        for (const ctx of contextLines.after) {
          lines.push(`${relPath}:${ctx.lineNumber}+${ctx.line}`);
        }
      } else {
        lines.push(`${relPath}:${match.lineNumber}:${match.line}`);
      }
    }

    let output = lines.join('\n');
    if (truncated) {
      output += `\n\n(Results are truncated. Consider using a more specific path or pattern.)`;
    }

    return output;
  }

  /**
   * count 模式 — 返回每个文件的匹配计数
   */
  private async searchCountMode(
    files: string[],
    regex: RegExp,
    headLimit: number,
    _globRegex: RegExp | null,
  ): Promise<string> {
    const counts: FileMatchCount[] = [];

    for (const file of files) {
      if (counts.length >= headLimit) break;

      try {
        const matches = await searchFile(file, regex);
        if (matches.length > 0) {
          counts.push({ filePath: file, count: matches.length });
        }
      } catch {
        // 跳过无法读取的文件
      }
    }

    if (counts.length === 0) return 'No matches found';

    const cwd = process.cwd();
    const lines = counts.map(c => {
      const relPath = path.relative(cwd, c.filePath) || c.filePath;
      return `${relPath}: ${c.count} match${c.count !== 1 ? 'es' : ''}`;
    });

    return lines.join('\n');
  }

  /**
   * 获取匹配行的上下文行
   */
  private async getContextLines(
    filePath: string,
    matchLine: number,
    before: number,
    after: number,
  ): Promise<{
    before: Array<{ lineNumber: number; line: string }>;
    after: Array<{ lineNumber: number; line: string }>;
  }> {
    const result = {
      before: [] as Array<{ lineNumber: number; line: string }>,
      after: [] as Array<{ lineNumber: number; line: string }>,
    };

    if (before === 0 && after === 0) return result;

    const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let currentLine = 0;
    const allLines: Array<{ lineNumber: number; line: string }> = [];

    for await (const line of rl) {
      currentLine++;
      allLines.push({ lineNumber: currentLine, line: truncateLine(line) });
    }

    // 提取上下文
    const matchIndex = matchLine - 1; // 0-based
    const startBefore = Math.max(0, matchIndex - before);
    const startAfter = Math.min(allLines.length, matchIndex + 1);

    result.before = allLines.slice(startBefore, matchIndex);
    result.after = allLines.slice(startAfter, startAfter + after);

    return result;
  }
}
