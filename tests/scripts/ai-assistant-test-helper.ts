/**
 * AI 助手测试辅助工具模块
 *
 * 提供统一的测试环境管理功能，确保测试使用与生产环境一致的路径结构
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 测试状态跟踪，用于智能清理
 */
interface TestState {
  hasFailed: boolean;
}

// 测试状态缓存
const testStates = new Map<string, TestState>();

/**
 * 获取 AI 助手模块的基础测试目录
 */
function getAssistantBaseDir(): string {
  return path.join(process.env.QTIAN_WORKSPACE || path.join(process.cwd(), 'tests', 'resource', 'workspace'), 'assistant');
}

/**
 * 获取测试专用 assistant 根目录
 * @param testFileName 测试文件名
 * @returns 测试专用的 assistant 目录路径
 */
export function getTestAssistantDir(testFileName: string = ''): string {
  const baseDir = getAssistantBaseDir();
  if (testFileName) {
    return path.join(baseDir, testFileName);
  }
  return baseDir;
}

/**
 * 获取测试专用 scenario 目录
 */
export function getTestAssistantScenarioDir(testFileName: string = ''): string {
  return path.join(getAssistantBaseDir(), 'scenario', testFileName);
}

/**
 * 获取测试专用 role 目录
 */
export function getTestAssistantRoleDir(testFileName: string = ''): string {
  return path.join(getAssistantBaseDir(), 'role', testFileName);
}

/**
 * 获取测试专用 LLM 配置目录
 */
export function getTestAssistantLlmDir(testFileName: string = ''): string {
  return path.join(getAssistantBaseDir(), 'llm', testFileName);
}

/**
 * 获取测试专用 history 目录
 */
export function getTestAssistantHistoryDir(testFileName: string = ''): string {
  return path.join(getAssistantBaseDir(), 'history', testFileName);
}

/**
 * 获取测试专用 tool 目录
 */
export function getTestAssistantToolDir(testFileName: string = ''): string {
  return path.join(getAssistantBaseDir(), 'tool', testFileName);
}

/**
 * 获取测试专用 skill 目录
 */
export function getTestAssistantSkillDir(testFileName: string = ''): string {
  return path.join(getAssistantBaseDir(), 'skill', testFileName);
}

/**
 * 获取测试专用 memory 目录
 */
export function getTestAssistantMemoryDir(testFileName: string = ''): string {
  return path.join(getAssistantBaseDir(), 'memory', testFileName);
}

/**
 * 创建测试目录结构
 * @param testDir 测试目录
 */
export async function setupTestAssistantEnvironment(testDir: string): Promise<void> {
  await fs.mkdir(testDir, { recursive: true });
}

/**
 * 清理测试目录
 * @param dirPath 目录路径
 */
async function cleanupDirectory(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Failed to cleanup test directory: ${dirPath}`);
  }
}

/**
 * 最终清理（测试套件结束时调用）
 * 只在测试全部通过时清理数据
 * @param testFileName 测试文件名
 */
export async function finalAssistantCleanup(testFileName: string): Promise<void> {
  const state = testStates.get(testFileName);

  if (state && !state.hasFailed) {
    const testDir = getTestAssistantDir(testFileName);
    await cleanupDirectory(testDir);
  } else if (state && state.hasFailed) {
    const testDir = getTestAssistantDir(testFileName);
    console.log(`测试失败，保留数据在: ${testDir}`);
  }
}

/**
 * 标记测试失败
 * @param testFileName 测试文件名
 */
export function markAssistantTestFailed(testFileName: string): void {
  let state = testStates.get(testFileName);
  if (!state) {
    state = { hasFailed: false };
    testStates.set(testFileName, state);
  }
  state.hasFailed = true;
}

/**
 * 初始化测试状态
 * @param testFileName 测试文件名
 */
export function initAssistantTestState(testFileName: string): void {
  testStates.set(testFileName, { hasFailed: false });
}

/**
 * 创建测试用的场景文件
 * @param testScenarioDir 测试 scenario 目录
 * @param scenarioId 场景 ID
 * @param scenario 场景数据
 */
export async function createTestAssistantScenario(
  testScenarioDir: string,
  scenarioId: string,
  scenario: any
): Promise<void> {
  const scenarioPath = path.join(testScenarioDir, `${scenarioId}.json`);
  await fs.mkdir(testScenarioDir, { recursive: true });
  await fs.writeFile(scenarioPath, JSON.stringify(scenario, null, 2), 'utf-8');
}

/**
 * 创建测试用的角色文件
 * @param testRoleDir 测试 role 目录
 * @param roleName 角色名称
 * @param content 角色内容
 */
export async function createTestAssistantRole(
  testRoleDir: string,
  roleName: string,
  content: string
): Promise<void> {
  const rolePath = path.join(testRoleDir, `${roleName}.md`);
  await fs.mkdir(testRoleDir, { recursive: true });
  await fs.writeFile(rolePath, content, 'utf-8');
}

/**
 * 创建测试用的 LLM 配置文件
 * @param testLlmDir 测试 LLM 配置目录
 * @param configName 配置文件名
 * @param config 配置内容
 */
export async function createTestAssistantLlmConfig(
  testLlmDir: string,
  configName: string,
  config: any
): Promise<void> {
  const configPath = path.join(testLlmDir, `${configName}.json`);
  await fs.mkdir(testLlmDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * 创建测试用的对话历史文件
 * @param testHistoryDir 测试 history 目录
 * @param scenarioId 场景 ID
 * @param historyId 历史 ID
 * @param history 历史数据
 */
export async function createTestAssistantHistory(
  testHistoryDir: string,
  scenarioId: string,
  historyId: string,
  history: any
): Promise<void> {
  const historyDir = path.join(testHistoryDir, scenarioId);
  const historyPath = path.join(historyDir, `${historyId}.json`);
  await fs.mkdir(historyDir, { recursive: true });
  await fs.writeFile(historyPath, JSON.stringify(history, null, 2), 'utf-8');
}

/**
 * 创建测试用的 Skill 目录和 SKILL.md 文件
 * @param testSkillDir 测试 skill 根目录
 * @param dirName Skill 目录名
 * @param skillMdContent SKILL.md 完整内容 (含 YAML front-matter)
 * @param options 可选，创建 scripts/ 或 templates/ 子目录
 */
export async function createTestAssistantSkill(
  testSkillDir: string,
  dirName: string,
  skillMdContent: string,
  options?: { hasScripts?: boolean; hasTemplates?: boolean }
): Promise<void> {
  const skillPath = path.join(testSkillDir, dirName);
  await fs.mkdir(skillPath, { recursive: true });
  await fs.writeFile(path.join(skillPath, 'SKILL.md'), skillMdContent, 'utf-8');

  if (options?.hasScripts) {
    await fs.mkdir(path.join(skillPath, 'scripts'), { recursive: true });
  }
  if (options?.hasTemplates) {
    await fs.mkdir(path.join(skillPath, 'templates'), { recursive: true });
  }
}

/**
 * 创建测试用的 Memory JSONL 文件
 * @param testMemoryDir 测试 memory 目录
 * @param fileName JSONL 文件名 (如 '_global.jsonl' 或 '{scenarioId}.jsonl')
 * @param memories 记忆条目数组
 */
export async function createTestAssistantMemory(
  testMemoryDir: string,
  fileName: string,
  memories: any[]
): Promise<void> {
  await fs.mkdir(testMemoryDir, { recursive: true });
  const filePath = path.join(testMemoryDir, fileName);
  const content = memories.map((m) => JSON.stringify(m)).join('\n') + '\n';
  await fs.writeFile(filePath, content, 'utf-8');
}
