/**
 * 测试工作目录初始化脚本
 *
 * 为单元测试和冒烟测试创建与实际运行时一致的工作目录结构
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { loadTestEnv, getTestWorkspacePath } from './load-test-env';

/**
 * 创建默认的 qtian.json 配置文件
 *
 * 如果文件已存在，则跳过创建以避免覆盖
 */
async function createDefaultConfig(workspacePath: string): Promise<void> {
  const configPath = path.join(workspacePath, 'qtian.json');

  try {
    // 检查文件是否存在
    await fs.access(configPath);
    console.log('✓ 配置文件已存在，跳过创建:', configPath);
    return;
  } catch (error) {
    // 文件不存在，继续创建
    const defaultConfig = {
      ai_assistant: {
        default_scenario: 'default',
        default_llm_config: 'default',
      },
    };

    try {
      await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
      console.log('✓ 创建默认配置文件:', configPath);
    } catch (writeError) {
      console.error('✗ 创建配置文件失败:', configPath);
      throw writeError;
    }
  }
}

/**
 * 创建测试工作目录结构
 */
async function createDirectoryStructure(workspacePath: string): Promise<void> {
  const directories = [
    'log',
    'tmp',
    path.join('assistant', 'scenario'),
    path.join('assistant', 'role'),
    path.join('assistant', 'llm'),
    path.join('assistant', 'skill'),
    path.join('assistant', 'tool'),
    path.join('assistant', 'history'),
    path.join('assistant', 'memory'),
  ];

  for (const dir of directories) {
    const dirPath = path.join(workspacePath, dir);
    try {
      await fs.access(dirPath);
      console.log('✓ 目录已存在:', dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true, mode: 0o755 });
      console.log('✓ 创建目录:', dirPath);
    }
  }
}

/**
 * 检查工作目录是否已完全配置
 */
export async function isWorkspaceConfigured(workspacePath: string): Promise<boolean> {
  const requiredFiles = [
    path.join(workspacePath, 'qtian.json'),
  ];

  // 检查必需的文件
  for (const file of requiredFiles) {
    try {
      await fs.access(file);
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * 初始化测试工作目录
 */
export async function initTestWorkspace(): Promise<string> {
  // 加载测试环境变量
  await loadTestEnv();

  const workspacePath = getTestWorkspacePath();

  console.log('\n========================================');
  console.log('初始化测试工作目录');
  console.log('========================================');
  console.log('工作目录路径:', workspacePath);

  try {
    // 创建目录结构
    await createDirectoryStructure(workspacePath);

    // 创建默认配置文件
    await createDefaultConfig(workspacePath);

    console.log('\n✅ 测试工作目录初始化完成！');
    console.log('\n⚠️  重要提示:');
    console.log('  请在工作目录中补充必要的配置文件:');
    console.log(`  - ${path.join(workspacePath, 'qtian.json')}`);
    console.log('\n  如需运行需要真实 API 的测试，请配置相应的 API 密钥。');
    console.log('========================================\n');

    return workspacePath;
  } catch (error) {
    console.error('❌ 初始化测试工作目录失败:', error);
    throw error;
  }
}

// 如果直接运行此脚本，则初始化工作目录
if (require.main === module) {
  initTestWorkspace()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('初始化失败:', error);
      process.exit(1);
    });
}
