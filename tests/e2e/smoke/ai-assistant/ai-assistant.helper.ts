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
 * 清理整个 assistant 目录（所有场景、LLM配置、历史）
 *
 * 用于 beforeEach 中确保测试环境干净，避免残留数据干扰自动选择。
 */
export function cleanAllAiTestData(workspace: string): void {
  const assistantDir = path.join(workspace, ASSISTANT_DIR);
  if (fs.existsSync(assistantDir)) {
    fs.rmSync(assistantDir, { recursive: true, force: true });
  }
}

/**
 * 清理指定测试数据（场景 + LLM配置）
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
 *
 * 使用 Ctrl+Alt+A 快捷键导航，避免触发消息发送和自动创建对话。
 * 如果快捷键不可用，回退到首页搜索框发送消息。
 */
export async function navigateToAiAssistant(page: any): Promise<void> {
  // 检查是否已在 AI 助手页面
  const isAssistant = await page.locator('.ai-assistant-page').isVisible({ timeout: 1000 }).catch(() => false);
  if (isAssistant) return;

  // 优先使用快捷键 Ctrl+Alt+A（不触发消息发送）
  await page.keyboard.press('Control+Alt+a');
  await page.waitForTimeout(2000);

  // 验证是否成功跳转
  const nowAssistant = await page.locator('.ai-assistant-page').isVisible({ timeout: 1000 }).catch(() => false);
  if (nowAssistant) return;

  // 回退：使用首页对话输入框发送消息
  const searchInput = page.getByLabel('对话输入框');
  try {
    await searchInput.waitFor({ state: 'visible', timeout: 3000 });
    await searchInput.fill('e2e 导航测试');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
  } catch {
    // 可能已在 AI 助手页面或搜索框不可见
  }
}

/**
 * 侧边栏通用选择操作：点击 el-select 并选择指定选项
 *
 * Element Plus 的 el-select 需要精确坐标点击才能触发。
 * 用于 ChatInput 中的场景/模型选择器。
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
  const combobox = page.getByRole('combobox', { name: ariaLabel });
  await expect(combobox).toBeVisible({ timeout: 5000 });

  const wrapper = combobox.locator('xpath=ancestor::div[contains(@class,"el-select__wrapper")]');
  const box = await wrapper.boundingBox();
  if (!box) throw new Error(`Select wrapper with aria-label="${ariaLabel}" not found`);

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);

  // 等待下拉菜单出现
  const dropdown = page.locator('.el-select-dropdown:visible');
  await dropdown.waitFor({ state: 'visible', timeout: 3000 });
  await page.waitForTimeout(500);

  // 使用 evaluate 在下拉菜单中查找并点击选项
  // 绕过 Playwright 定位器与 Element Plus 虚拟列表的兼容性问题
  const clicked = await page.evaluate(({ targetText, label }) => {
    const dropdowns = document.querySelectorAll('.el-select-dropdown');
    for (const dd of dropdowns) {
      const el = dd as HTMLElement;
      if (el.style.display === 'none' || el.style.visibility === 'hidden') continue;
      // 查找所有后代元素，检查文本内容
      const allElements = dd.querySelectorAll('*');
      for (const item of allElements) {
        if (item.textContent && item.textContent.trim() === targetText && item.offsetParent !== null) {
          (item as HTMLElement).click();
          return true;
        }
      }
    }
    return false;
  }, { targetText: optionText, label: ariaLabel });

  if (!clicked) {
    throw new Error(`Option "${optionText}" not found in dropdown for "${ariaLabel}"`);
  }
  await page.waitForTimeout(500);
}

/**
 * 点击 el-select 下拉框（仅打开，不选择）
 */
export async function clickSelect(page: any, ariaLabel: string): Promise<void> {
  const combobox = page.getByRole('combobox', { name: ariaLabel });
  await expect(combobox).toBeVisible({ timeout: 5000 });

  const wrapper = combobox.locator('xpath=ancestor::div[contains(@class,"el-select__wrapper")]');
  const box = await wrapper.boundingBox();
  if (!box) throw new Error(`Select wrapper with aria-label="${ariaLabel}" not found`);

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);

  // 等待 listbox 出现
  await page.getByRole('listbox', { name: ariaLabel }).waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
}

/**
 * 点击侧边栏中的对话历史项
 *
 * 侧边栏使用可点击的 .history-item 列表项代替下拉菜单。
 *
 * @param page - Playwright Page 对象
 * @param historyTitle - 历史项标题文本
 */
export async function clickHistoryItem(page: any, historyTitle: string): Promise<void> {
  const item = page.locator('.history-item').filter({ hasText: historyTitle });
  await expect(item).toBeVisible({ timeout: 5000 });
  await item.click();
  await page.waitForTimeout(1000);
}

/**
 * 填充聊天输入框
 *
 * 输入区域现在在独立的 .chat-input 组件中。
 */
export async function fillChatInput(page: any, text: string): Promise<void> {
  const textarea = page.locator('.chat-input textarea');
  await textarea.waitFor({ state: 'visible', timeout: 5000 });
  await textarea.fill(text);
}

/**
 * 通用前置：通过 ChatInput 选择场景，点击侧边栏历史项，等待对话界面就绪
 *
 * @param page - Playwright Page 对象
 * @param scenarioId - 场景 ID
 * @param historyId - 历史 ID（也用作标题匹配文本）
 */
export async function setupChatSession(
  page: any,
  scenarioId: string,
  historyId: string
): Promise<void> {
  await selectOption(page, '选择场景', scenarioId);
  await clickHistoryItem(page, historyId);
  await page.waitForTimeout(1500);
}

/**
 * 等待 AI 回复完成（发送按钮恢复可点击状态）
 */
export async function waitForSendButtonReady(page: any, timeout = 60000): Promise<void> {
  await page.waitForFunction(() => {
    const buttons = document.querySelectorAll('.chat-input .input-actions .el-button');
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
