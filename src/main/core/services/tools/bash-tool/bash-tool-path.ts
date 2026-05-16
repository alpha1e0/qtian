/**
 * BashTool 路径解析 — 定位 PortableGit bash.exe
 *
 * 查找策略优先级：
 * 1. process.cwd()/bin-vendor/PortableGit/bin/bash.exe (开发环境)
 * 2. process.resourcesPath/bin-vendor/PortableGit/bin/bash.exe (打包后)
 * 3. __dirname 相对路径回退
 * 4. 系统路径 ProgramFiles/Git/bin/bash.exe
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '@/core/utils/logger';

const logger = createLogger('BashToolPath');

/** PortableGit 内 bash.exe 的相对路径 */
const BASH_RELATIVE_PATH = 'bin-vendor/PortableGit/bin/bash.exe';

/** 缓存已解析的 bash.exe 路径 */
let cachedBashPath: string | null = null;

/**
 * 解析 bash.exe 绝对路径
 *
 * 按优先级依次尝试多个候选路径，第一个存在的即为结果。
 * 结果会被缓存，后续调用直接返回缓存值。
 *
 * @returns bash.exe 的绝对路径
 * @throws 如果所有候选路径均不存在
 */
export async function resolveBashPath(): Promise<string> {
  if (cachedBashPath) {
    return cachedBashPath;
  }

  const candidates = buildCandidatePaths();

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    try {
      await fs.promises.access(resolved, fs.constants.X_OK);
      cachedBashPath = resolved;
      logger.info(`Resolved bash path: ${resolved}`);
      return resolved;
    } catch {
      // 当前候选不存在，继续尝试
    }
  }

  const error = new Error(
    `bash.exe not found. Tried: ${candidates.join(', ')}`
  );
  logger.error(error.message);
  throw error;
}

/**
 * 重置 bash 路径缓存（仅用于测试）
 */
export function resetBashPathCache(): void {
  cachedBashPath = null;
}

/**
 * 构建候选路径列表
 * @returns 候选 bash.exe 路径数组
 */
function buildCandidatePaths(): string[] {
  const candidates: string[] = [];

  // 1. 开发环境: process.cwd()
  candidates.push(path.join(process.cwd(), BASH_RELATIVE_PATH));

  // 2. 打包后: process.resourcesPath
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, BASH_RELATIVE_PATH));
  }

  // 3. __dirname 相对路径回退 — 从 tools 目录向上查找
  // __dirname = .../src/main/core/services/tools
  // 需要回到项目根目录 (上 5 级)
  const projectRoot = path.resolve(__dirname, '../../../../../..');
  candidates.push(path.join(projectRoot, BASH_RELATIVE_PATH));

  // 4. 系统路径: ProgramFiles/Git/bin/bash.exe
  if (process.platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    candidates.push(path.join(programFiles, 'Git', 'bin', 'bash.exe'));
    candidates.push(path.join(programFilesX86, 'Git', 'bin', 'bash.exe'));

    // 环境变量 PATH 中可能也有 Git
    const localAppData = process.env['LocalAppData'];
    if (localAppData) {
      candidates.push(path.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'));
    }
  }

  return candidates;
}
