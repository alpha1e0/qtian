/**
 * 测试环境变量加载模块
 *
 * 该模块提供统一的测试环境变量加载功能
 * 被以下脚本使用：
 * - ensure-test-workspace.ts
 * - init-workspace.ts
 * - vitest.setup.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { readFileSync } from 'fs';

// 基于模块位置定位项目根目录（testing/scripts -> 项目根）
const PROJECT_ROOT = path.resolve(__dirname, '../..');

/**
 * 从 .env.test 文件加载环境变量到 process.env（同步版本）
 *
 * 此函数用于 vitest.setup.ts，需要在模块导入前同步加载环境变量
 *
 * @throws {Error} 如果 .env.test 文件不存在
 */
export function loadTestEnvSync(): void {
  const envPath = path.join(PROJECT_ROOT, '.env.test');

  try {
    const envContent = readFileSync(envPath, 'utf-8');

    // 解析并设置环境变量
    envContent.split('\n').forEach(line => {
      const trimmedLine = line.trim();
      // 跳过注释和空行
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, ...valueParts] = trimmedLine.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').trim();
          process.env[key.trim()] = value;
        }
      }
    });
  } catch (error) {
    throw new Error(
      `找不到 .env.test 文件: ${envPath}\n` +
      '请确保 .env.test 文件存在于项目根目录，并配置了必要的环境变量。'
    );
  }
}

/**
 * 从 .env.test 文件加载环境变量到 process.env（异步版本）
 *
 * @throws {Error} 如果 .env.test 文件不存在
 */
export async function loadTestEnv(): Promise<void> {
  const envPath = path.join(PROJECT_ROOT, '.env.test');

  try {
    const envContent = await fs.readFile(envPath, 'utf-8');

    // 解析并设置环境变量
    envContent.split('\n').forEach(line => {
      const trimmedLine = line.trim();
      // 跳过注释和空行
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, ...valueParts] = trimmedLine.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').trim();
          process.env[key.trim()] = value;
        }
      }
    });

    console.log(`[TEST ENV] 已从 ${envPath} 加载环境变量`);
  } catch (error) {
    throw new Error(
      `找不到 .env.test 文件: ${envPath}\n` +
      '请确保 .env.test 文件存在于项目根目录，并配置了必要的环境变量。'
    );
  }
}

/**
 * 获取测试工作目录路径
 *
 * @returns {string} 测试工作目录的绝对路径
 * @throws {Error} 如果 QTIAN_WORKSPACE 环境变量未设置或为空
 */
export function getTestWorkspacePath(): string {
  const workspace = process.env.QTIAN_WORKSPACE;

  if (!workspace || workspace.trim() === '') {
    throw new Error(
      'QTIAN_WORKSPACE 环境变量未设置或为空\n' +
      '请在 .env.test 文件中配置: QTIAN_WORKSPACE=<你的测试工作目录路径>'
    );
  }

  return workspace;
}
