/**
 * 测试前检查脚本
 * 确保测试工作目录已正确配置
 *
 * 该脚本会：
 * 1. 从 .env.test 加载环境变量
 * 2. 验证 QTIAN_WORKSPACE 是否配置
 * 3. 检查测试工作目录结构是否完整
 * 4. 如果有问题则异常退出并给出提示
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { loadTestEnv, getTestWorkspacePath } from './load-test-env';

/**
 * 检查工作目录结构是否完整
 */
async function validateWorkspaceStructure(workspacePath: string): Promise<{
  isValid: boolean;
  missingItems: string[];
}> {
  const requiredDirs = [
    path.join(workspacePath, 'log'),
    path.join(workspacePath, 'tmp'),
    path.join(workspacePath, 'assistant'),
  ];

  const requiredFiles = [
    path.join(workspacePath, 'qtian.json'),
  ];

  const missingItems: string[] = [];

  // 检查必需的目录
  for (const dir of requiredDirs) {
    try {
      await fs.access(dir);
    } catch {
      missingItems.push(`目录: ${path.relative(process.cwd(), dir)}`);
    }
  }

  // 检查必需的文件
  for (const file of requiredFiles) {
    try {
      await fs.access(file);
    } catch {
      missingItems.push(`文件: ${path.relative(process.cwd(), file)}`);
    }
  }

  return {
    isValid: missingItems.length === 0,
    missingItems,
  };
}

/**
 * 主函数：验证测试环境配置
 */
export async function ensureTestEnvironment(): Promise<void> {
  try {
    // 1. 加载 .env.test 环境变量
    await loadTestEnv();

    // 2. 获取并验证工作目录路径
    const workspacePath = getTestWorkspacePath();

    // 3. 验证工作目录结构
    const { isValid, missingItems } = await validateWorkspaceStructure(workspacePath);

    if (!isValid) {
      console.error('\n❌ 测试工作目录未初始化或配置不完整');
      console.error(`   工作目录: ${workspacePath}`);
      console.error('\n缺少以下项目:');
      missingItems.forEach(item => console.error(`  - ${item}`));
      console.error('\n请运行以下命令初始化测试工作目录:');
      console.error('   npm run test:workspace:init');
      console.error('\n初始化后，请根据模板文件补充必要的配置。\n');
      throw new Error('测试工作目录配置不完整');
    }

    // 工作目录配置正确
    console.log(`✅ 测试环境验证通过: ${workspacePath}`);
  } catch (error) {
    if (error instanceof Error) {
      console.error('\n❌ 测试环境验证失败:');
      console.error(`   ${error.message}`);
      console.error('\n请确保:');
      console.error('  1. .env.test 文件存在于项目根目录');
      console.error('  2. .env.test 中配置了 QTIAN_WORKSPACE 环境变量');
      console.error('  3. 已运行 npm run test:workspace:init 初始化测试工作目录\n');
    }
    throw error;
  }
}

/**
 * 主函数：直接运行时的入口
 */
async function main(): Promise<void> {
  try {
    await ensureTestEnvironment();
    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
}

// 只有直接运行此脚本时才执行 main 函数
if (require.main === module) {
  main();
}
