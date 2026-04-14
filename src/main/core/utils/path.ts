import * as path from 'path';
import * as os from 'os';
import { MIME_MAP } from '@/core/common/constants';

/**
 * Get the current working directory for inner resources
 * Compatible with both development and production environments
 */
export function getInnerCurPath(): string {
  if (process.resourcesPath) {
    return process.resourcesPath;
  }
  return process.cwd();
}

/**
 * Check if a file is an image based on its extension
 * @param filePath - File path to check
 * @returns True if file is an image
 */
export function isImage(filePath: string | path.ParsedPath): boolean {
  let ext: string;
  if (typeof filePath === 'string') {
    ext = path.extname(filePath);
  } else {
    ext = filePath.ext;
  }
  return ext in MIME_MAP;
}

/**
 * Get file size in megabytes
 * @param filePath - File path to check
 * @returns File size in MB
 */
export function getFileSizeMB(filePath: string): number {
  const stats = require('fs').statSync(filePath);
  return Math.round((stats.size / 1024 / 1024) * 1000) / 1000;
}

/**
 * Get file size in bytes
 * @param filePath - File path to check
 * @returns File size in bytes
 */
export function getFileSize(filePath: string): number {
  const stats = require('fs').statSync(filePath);
  return stats.size;
}

/**
 * Check if a directory exists
 * @param dirPath - Directory path to check
 * @returns True if directory exists
 */
export function directoryExists(dirPath: string): boolean {
  try {
    const fs = require('fs');
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a file exists
 * @param filePath - File path to check
 * @returns True if file exists
 */
export function fileExists(filePath: string): boolean {
  try {
    const fs = require('fs');
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Ensure a directory exists, create it if not
 * @param dirPath - Directory path to ensure
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  const fs = await import('fs/promises');
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
  }
}

/**
 * Get user home directory
 * @returns User home directory
 */
export function getUserHomeDir(): string {
  return os.homedir();
}

/**
 * Join path segments
 * @param segments - Path segments to join
 * @returns Joined path
 */
export function joinPath(...segments: string[]): string {
  return path.join(...segments);
}

/**
 * Get file extension
 * @param filePath - File path
 * @returns File extension including dot
 */
export function getFileExtension(filePath: string): string {
  return path.extname(filePath);
}

/**
 * Get file name without extension
 * @param filePath - File path
 * @returns File name without extension
 */
export function getFileNameWithoutExt(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

/**
 * Get file name with extension
 * @param filePath - File path
 * @returns File name with extension
 */
export function getFileName(filePath: string): string {
  return path.basename(filePath);
}

/**
 * Get parent directory
 * @param filePath - File path
 * @returns Parent directory path
 */
export function getParentDirectory(filePath: string): string {
  return path.dirname(filePath);
}
