import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '@/core/utils/logger';
import { ITool } from '../tool.interface';

const logger = createLogger('GlobTool');

/** 默认最大返回文件数 */
const MAX_RESULTS = 100;

/**
 * 将 glob 模式转换为正则表达式
 * 支持: ** (递归目录), * (单层通配), ? (单字符)
 * @param pattern - glob 模式字符串
 */
function globToRegex(pattern: string): RegExp {
  // 处理路径分隔符统一
  const normalized = pattern.replace(/\\/g, '/');

  // 转义正则特殊字符 (先保护 glob 字符)
  let regex = '';
  let i = 0;

  while (i < normalized.length) {
    const char = normalized[i];

    // ** — 递归目录匹配 (必须在 * 之前检查)
    if (char === '*' && normalized[i + 1] === '*') {
      // **/ 或 /** 都匹配任意路径段
      if (normalized[i + 2] === '/') {
        regex += '(?:.+/)?';
        i += 3;
      } else {
        regex += '.*';
        i += 2;
      }
      continue;
    }

    // * — 单层通配 (不含路径分隔符)
    if (char === '*') {
      regex += '[^/]*';
      i++;
      continue;
    }

    // ? — 单字符通配 (不含路径分隔符)
    if (char === '?') {
      regex += '[^/]';
      i++;
      continue;
    }

    // 正则特殊字符转义
    if ('.+^${}()|[]\\'.includes(char)) {
      regex += '\\' + char;
      i++;
      continue;
    }

    regex += char;
    i++;
  }

  return new RegExp('^' + regex + '$', 'i');
}

/**
 * 从 glob pattern 中提取静态基础目录
 * 基础目录是第一个 glob 特殊字符 (* ? [ {) 之前的路径部分
 * @param pattern - glob 模式
 */
function extractGlobBaseDirectory(pattern: string): {
  baseDir: string;
  relativePattern: string;
} {
  const normalized = pattern.replace(/\\/g, '/');
  const globChars = /[*?[{]/;
  const match = normalized.match(globChars);

  if (!match || match.index === undefined) {
    // 无 glob 字符 — 字面路径
    const dir = path.dirname(normalized);
    const file = path.basename(normalized);
    return { baseDir: dir, relativePattern: file };
  }

  const staticPrefix = normalized.slice(0, match.index);
  const lastSepIndex = staticPrefix.lastIndexOf('/');

  if (lastSepIndex === -1) {
    return { baseDir: '', relativePattern: pattern };
  }

  const baseDir = staticPrefix.slice(0, lastSepIndex);
  const relativePattern = pattern.slice(lastSepIndex + 1);

  return { baseDir, relativePattern };
}

/**
 * 将绝对路径转为相对于 cwd 的相对路径
 * 如果路径不在 cwd 下，返回原始绝对路径
 * @param filePath - 文件绝对路径
 * @param cwd - 当前工作目录
 */
function toRelativePath(filePath: string, cwd: string): string {
  const rel = path.relative(cwd, filePath);
  // 如果相对路径以 .. 开头，说明不在 cwd 下，返回绝对路径
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return filePath;
  }
  return rel;
}

/**
 * 内置文件查找工具 — 按 glob 模式快速匹配文件
 *
 * 功能:
 * 1. glob 模式匹配 (**, *, ?)
 * 2. 搜索目录验证
 * 3. 结果按修改时间排序
 * 4. 截断限制 (100 条)
 * 5. 路径相对化输出
 */
export class GlobTool implements ITool {
  readonly name = 'glob';
  readonly description =
    'Fast file pattern matching tool that works with any codebase size. '
    + 'Supports glob patterns like "**/*.js" or "src/**/*.ts". '
    + 'Returns matching file paths sorted by modification time. '
    + 'Use this tool when you need to find files by name patterns.';
  readonly parameters: Record<string, any> = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The glob pattern to match files against (e.g. "**/*.js", "src/**/*.ts")',
      },
      path: {
        type: 'string',
        description:
          'The directory to search in. If not specified, the current working directory will be used. Must be a valid directory path.',
      },
    },
    required: ['pattern'],
  };

  /**
   * 执行文件查找
   * @param args - 工具参数
   * @param args.pattern - glob 模式
   * @param args.path - 搜索目录 (可选)
   * @returns 匹配的文件路径列表
   */
  async execute(args: Record<string, any>): Promise<string> {
    const { pattern, path: searchPath } = args;

    // 参数校验
    if (!pattern || typeof pattern !== 'string') {
      return 'Error: "pattern" is required and must be a string';
    }

    if (searchPath !== undefined && searchPath !== null && typeof searchPath !== 'string') {
      return 'Error: "path" must be a string if provided';
    }

    // 确定搜索目录和 glob 模式
    let searchDir: string;
    let globPattern = pattern;

    if (path.isAbsolute(pattern)) {
      // pattern 包含绝对路径 → 提取 base directory
      const { baseDir, relativePattern } = extractGlobBaseDirectory(pattern);
      if (baseDir) {
        searchDir = baseDir;
        globPattern = relativePattern;
      } else {
        searchDir = searchPath ? path.resolve(searchPath) : process.cwd();
      }
    } else if (searchPath) {
      searchDir = path.resolve(searchPath);
    } else {
      searchDir = process.cwd();
    }

    logger.info(`Glob search: pattern="${globPattern}", dir="${searchDir}"`);

    // 验证搜索目录
    try {
      const stat = await fs.stat(searchDir);
      if (!stat.isDirectory()) {
        return `Error: Path is not a directory: ${searchDir}`;
      }
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT') {
        return `Error: Directory does not exist: ${searchDir}`;
      }
      return `Error: Cannot access directory: ${searchDir}`;
    }

    try {
      // 递归列出所有文件
      const entries = await fs.readdir(searchDir, {
        recursive: true,
        withFileTypes: false,
      });

      // 将 glob 模式转为正则
      const regex = globToRegex(globPattern);

      // 匹配过滤 + 收集 stat 信息
      const matches: { filePath: string; mtimeMs: number }[] = [];

      for (const entry of entries) {
        const entryStr = String(entry);
        // 将路径分隔符统一为 / 以便正则匹配
        const relativeEntry = entryStr.replace(/\\/g, '/');

        if (regex.test(relativeEntry)) {
          const fullPath = path.resolve(searchDir, entryStr);
          try {
            const stat = await fs.stat(fullPath);
            if (stat.isFile()) {
              matches.push({ filePath: fullPath, mtimeMs: stat.mtimeMs });
            }
          } catch {
            // 跳过无法 stat 的文件 (权限问题等)
          }
        }
      }

      // 按修改时间排序 (最新优先)
      matches.sort((a, b) => b.mtimeMs - a.mtimeMs);

      // 截断
      const truncated = matches.length > MAX_RESULTS;
      const results = matches.slice(0, MAX_RESULTS);

      // 格式化输出
      if (results.length === 0) {
        return 'No files found';
      }

      const cwd = process.cwd();
      const lines = results.map(m => toRelativePath(m.filePath, cwd));

      let output = lines.join('\n');
      if (truncated) {
        output += '\n\n(Results are truncated. Consider using a more specific path or pattern.)';
      }

      logger.info(`Glob found ${matches.length} files (showing ${results.length})`);
      return output;
    } catch (error) {
      const err = error as Error;
      logger.error(`Glob search failed: ${searchDir}`, err);
      return `Error: Failed to search files: ${err.message}`;
    }
  }
}
