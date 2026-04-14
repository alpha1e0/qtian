/**
 * AI助手 E2E 测试辅助工具
 *
 * 提供测试环境初始化、场景/历史/配置数据创建与清理、导航等通用功能。
 * 所有 AI 助手相关的测试 spec 都应使用此辅助模块。
 *
 * AI助手数据目录结构：
 * - assistant/scenario/{id}.json     场景配置
 * - assistant/llm/{name}.json        LLM配置
 * - assistant/history/{scenarioId}/{historyId}.json  对话历史
 */

import path from 'path';
import fs from 'fs';

// AI助手工作子目录
const ASSISTANT_DIR = 'assistant';
const SCENARIO_DIR = 'scenario';
const LLM_DIR = 'llm';
const HISTORY_DIR = 'history';

/** 默认场景模板 */
export const DEFAULT_AI_SCENARIO = {
  role_id: 'default',
  llm_config: 'default',
  is_agent: false,
  tools: [],
  skills: [],
  start: [],
};

/** 默认 LLM 配置模板 */
export const DEFAULT_AI_LLM_CONFIG = {
  base_url: 'https://api.example.com/v1',
  model: 'test-model',
  key: '',
  temperature: 0.7,
  max_tokens: 2000,
  proxy: '',
};

/**
 * 获取 assistant 目录路径
 */
export function getAssistantDir(workspace: string): string {
  return path.join(workspace, ASSISTANT_DIR);
}

/**
 * 获取场景文件路径：assistant/scenario/{id}.json
 */
export function getScenarioFilePath(workspace: string, scenarioId: string): string {
  return path.join(workspace, ASSISTANT_DIR, SCENARIO_DIR, `${scenarioId}.json`);
}

/**
 * 获取 LLM 配置文件路径：assistant/llm/{name}.json
 */
export function getLlmConfigFilePath(workspace: string, configName: string): string {
  return path.join(workspace, ASSISTANT_DIR, LLM_DIR, `${configName}.json`);
}

/**
 * 获取历史文件路径：assistant/history/{scenarioId}/{historyId}.json
 */
export function getHistoryFilePath(
  workspace: string,
  scenarioId: string,
  historyId: string
): string {
  return path.join(workspace, ASSISTANT_DIR, HISTORY_DIR, scenarioId, `${historyId}.json`);
}

/**
 * 创建场景配置文件
 */
export function createAiScenario(
  workspace: string,
  scenarioId: string,
  data?: Record<string, unknown>
): void {
  const scenarioDir = path.join(workspace, ASSISTANT_DIR, SCENARIO_DIR);
  fs.mkdirSync(scenarioDir, { recursive: true });

  const scenarioData = { ...DEFAULT_AI_SCENARIO, ...data };
  fs.writeFileSync(
    getScenarioFilePath(workspace, scenarioId),
    JSON.stringify(scenarioData, null, 2),
    'utf-8'
  );
}

/**
 * 创建 LLM 配置文件
 */
export function createAiLlmConfig(
  workspace: string,
  configName: string,
  data?: Record<string, unknown>
): void {
  const llmDir = path.join(workspace, ASSISTANT_DIR, LLM_DIR);
  fs.mkdirSync(llmDir, { recursive: true });

  const configData = { ...DEFAULT_AI_LLM_CONFIG, ...data };
  fs.writeFileSync(
    getLlmConfigFilePath(workspace, configName),
    JSON.stringify(configData, null, 2),
    'utf-8'
  );
}

/**
 * 创建对话历史文件
 */
export function createAiHistory(
  workspace: string,
  scenarioId: string,
  historyId: string,
  messages?: Array<{ role: string; content: string; name?: string }>
): void {
  const historyDir = path.join(workspace, ASSISTANT_DIR, HISTORY_DIR, scenarioId);
  fs.mkdirSync(historyDir, { recursive: true });

  const historyData = {
    id: historyId,
    scenario_id: scenarioId,
    title: historyId,
    messages: messages || [],
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  fs.writeFileSync(
    getHistoryFilePath(workspace, scenarioId, historyId),
    JSON.stringify(historyData, null, 2),
    'utf-8'
  );
}

/**
 * 删除场景及其关联历史
 */
export function removeAiScenario(workspace: string, scenarioId: string): void {
  // 删除场景文件
  const scenarioFile = getScenarioFilePath(workspace, scenarioId);
  if (fs.existsSync(scenarioFile)) {
    fs.unlinkSync(scenarioFile);
  }

  // 删除关联历史目录
  const historyDir = path.join(workspace, ASSISTANT_DIR, HISTORY_DIR, scenarioId);
  if (fs.existsSync(historyDir)) {
    fs.rmSync(historyDir, { recursive: true, force: true });
  }
}

/**
 * 删除 LLM 配置文件
 */
export function removeAiLlmConfig(workspace: string, configName: string): void {
  const configFile = getLlmConfigFilePath(workspace, configName);
  if (fs.existsSync(configFile)) {
    fs.unlinkSync(configFile);
  }
}

/**
 * 清理所有测试数据（场景 + LLM配置）
 */
export function cleanupAiTestData(
  workspace: string,
  scenarioIds: string[],
  llmConfigNames?: string[]
): void {
  for (const id of scenarioIds) {
    removeAiScenario(workspace, id);
  }
  if (llmConfigNames) {
    for (const name of llmConfigNames) {
      removeAiLlmConfig(workspace, name);
    }
  }
}

/**
 * 通用环境设置：创建场景 + LLM配置 + 历史
 */
export function setupAiTestEnvironment(
  workspace: string,
  options?: {
    scenarioId?: string;
    historyId?: string;
    llmConfigName?: string;
    scenarioData?: Record<string, unknown>;
    historyMessages?: Array<{ role: string; content: string; name?: string }>;
  }
): { scenarioId: string; historyId: string; llmConfigName: string } {
  const scenarioId = options?.scenarioId || 'e2e_test_scenario';
  const historyId = options?.historyId || 'e2e_test_history';
  const llmConfigName = options?.llmConfigName || 'e2e_test_config';

  createAiLlmConfig(workspace, llmConfigName);
  createAiScenario(workspace, scenarioId, options?.scenarioData);
  createAiHistory(workspace, scenarioId, historyId, options?.historyMessages);

  return { scenarioId, historyId, llmConfigName };
}

/**
 * 导航到 AI 助手页面
 */
export async function navigateToAiAssistant(page: any): Promise<void> {
  const tool = page.getByLabel('AI助手工具');
  try {
    await tool.click({ timeout: 3000 });
  } catch {
    // 可能已在AI助手页面
  }
  await page.waitForTimeout(1000);
}

/**
 * 侧边栏通用选择操作：点击 el-select 并选择指定选项
 *
 * Element Plus 的 el-select 需要精确坐标点击才能触发。
 *
 * @param page - Playwright Page 对象
 * @param ariaLabel - 目标 select 的 aria-label
 * @param optionText - 要选择的选项文本
 */
export async function selectOption(
  page: any,
  ariaLabel: string,
  optionText: string
): Promise<void> {
  // Element Plus el-select 的 DOM 结构：
  //   .el-select > .el-select__wrapper > (placeholder div, input[combobox])
  //   input[combobox] 和 dropdown listbox 共享同一 aria-label。
  // 使用 getByRole('combobox') 精确定位 input，再定位其父级 wrapper。
  // placeholder div 会遮挡 input 点击，所以通过 wrapper 坐标点击。
  const combobox = page.getByRole('combobox', { name: ariaLabel });
  await expect(combobox).toBeVisible({ timeout: 5000 });

  // 定位 combobox 的父级 .el-select__wrapper
  const wrapper = combobox.locator('xpath=ancestor::div[contains(@class,"el-select__wrapper")]');
  const box = await wrapper.boundingBox();
  if (!box) throw new Error(`Select wrapper with aria-label="${ariaLabel}" not found`);

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);

  // 选择选项
  const option = page.locator('.el-select-dropdown__item').filter({ hasText: optionText });
  await expect(option).toBeVisible({ timeout: 5000 });

  const optBox = await option.boundingBox();
  if (optBox) {
    await page.mouse.click(optBox.x + optBox.width / 2, optBox.y + optBox.height / 2);
  } else {
    await option.click();
  }
  await page.waitForTimeout(500);
}

/**
 * 点击 el-select 下拉框（仅打开，不选择）
 *
 * 用于需要打开下拉框查看选项列表的场景。
 */
export async function clickSelect(page: any, ariaLabel: string): Promise<void> {
  const combobox = page.getByRole('combobox', { name: ariaLabel });
  await expect(combobox).toBeVisible({ timeout: 5000 });

  const wrapper = combobox.locator('xpath=ancestor::div[contains(@class,"el-select__wrapper")]');
  const box = await wrapper.boundingBox();
  if (!box) throw new Error(`Select wrapper with aria-label="${ariaLabel}" not found`);

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
}

/**
 * 填充聊天输入框
 *
 * Element Plus el-input type="textarea" 将 aria-label 放在外层 wrapper 上，
 * Playwright 的 getByLabel 定位到 wrapper 而非原生 textarea。
 * 此函数直接定位原生 textarea 并 fill，确保 Vue v-model 正确更新。
 */
export async function fillChatInput(page: any, text: string): Promise<void> {
  const textarea = page.locator('.input-container textarea');
  await textarea.waitFor({ state: 'visible', timeout: 5000 });
  await textarea.fill(text);
}

/**
 * 通用前置：选择场景 → 历史，等待对话界面就绪
 */
export async function setupChatSession(
  page: any,
  scenarioId: string,
  historyId: string
): Promise<void> {
  await selectOption(page, '选择场景', scenarioId);
  await selectOption(page, '选择对话历史', historyId);
  await page.waitForTimeout(1500);
}

/**
 * 等待 AI 回复完成（发送按钮恢复可点击状态）
 */
export async function waitForSendButtonReady(page: any, timeout = 60000): Promise<void> {
  await page.waitForFunction(() => {
    const buttons = document.querySelectorAll('.input-actions .el-button');
    for (const btn of buttons) {
      if (btn.textContent?.trim() === '发送') {
        return !btn.classList.contains('is-loading') && !btn.hasAttribute('disabled');
      }
    }
    return false;
  }, { timeout });
}

// 需要从 fixture 导入 expect 用于 selectOption
import { expect } from '../../fixtures/app.fixture';
