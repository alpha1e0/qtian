/**
 * AI助手 E2E 测试辅助工具
 *
 * 提供测试环境初始化、Agent/历史/配置数据创建与清理、导航等通用功能。
 * 所有 AI 助手相关的测试 spec 都应使用此辅助模块。
 *
 * AI助手数据目录结构：
 * - assistant/agent/{name}.md       Agent 定义 (YAML front-matter + Markdown)
 * - assistant/llm/{name}.json        LLM配置
 * - assistant/history/{agentId}/{historyId}.json  对话历史
 */

import path from 'path';
import fs from 'fs';

// AI助手工作子目录
const ASSISTANT_DIR = 'assistant';
const AGENT_DIR = 'agent';
const LLM_DIR = 'llm';
const HISTORY_DIR = 'history';

/** 默认 Agent Markdown 内容模板 */
export const DEFAULT_AI_AGENT_MD = `---
name: default
description: 默认助手
tools: []
---

你是一个 AI 助手。`;

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
 * 获取 Agent 文件路径：assistant/agent/{name}.md
 */
export function getAgentFilePath(workspace: string, agentName: string): string {
  return path.join(workspace, ASSISTANT_DIR, AGENT_DIR, `${agentName}.md`);
}

/**
 * 获取 LLM 配置文件路径：assistant/llm/{name}.json
 */
export function getLlmConfigFilePath(workspace: string, configName: string): string {
  return path.join(workspace, ASSISTANT_DIR, LLM_DIR, `${configName}.json`);
}

/**
 * 获取历史文件路径：assistant/history/{agentId}/{historyId}.json
 */
export function getHistoryFilePath(
  workspace: string,
  agentId: string,
  historyId: string
): string {
  return path.join(workspace, ASSISTANT_DIR, HISTORY_DIR, agentId, `${historyId}.json`);
}

/**
 * 创建 Agent 定义文件 (YAML front-matter + Markdown)
 * @param workspace - 测试工作目录
 * @param agentName - Agent 名称
 * @param data - 覆盖字段 (会合并到 YAML front-matter)
 */
export function createAiAgent(
  workspace: string,
  agentName: string,
  data?: Record<string, unknown>
): void {
  const agentDir = path.join(workspace, ASSISTANT_DIR, AGENT_DIR);
  fs.mkdirSync(agentDir, { recursive: true });

  // 构建 Agent Markdown 内容
  const name = agentName;
  const description = (data?.description as string) || `E2E 测试 Agent: ${agentName}`;
  const tools: string[] = (data?.tools as string[]) || [];
  const model = (data?.model as string) || '';
  const skills: string[] = (data?.skills as string[]) || [];
  const enableMemory = data?.enable_memory as boolean | undefined;
  const maxContextRounds = data?.max_context_rounds as number | undefined;

  const lines: string[] = ['---'];
  lines.push(`name: ${name}`);
  lines.push(`description: ${description}`);

  if (tools.length > 0) {
    lines.push('tools:');
    for (const tool of tools) {
      lines.push(`  - ${tool}`);
    }
  } else {
    lines.push('tools: []');
  }

  if (model) {
    lines.push(`model: ${model}`);
  }

  if (skills.length > 0) {
    lines.push('skills:');
    for (const skill of skills) {
      lines.push(`  - ${skill}`);
    }
  }

  if (enableMemory !== undefined) {
    lines.push(`enable_memory: ${enableMemory}`);
  }

  if (maxContextRounds !== undefined) {
    lines.push(`max_context_rounds: ${maxContextRounds}`);
  }

  lines.push('---');
  lines.push('');
  lines.push(`你是 ${name}，一个 AI 助手。`);

  fs.writeFileSync(
    getAgentFilePath(workspace, agentName),
    lines.join('\n') + '\n',
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
  agentId: string,
  historyId: string,
  messages?: Array<{ role: string; content: string; name?: string }>,
  title?: string
): void {
  const historyDir = path.join(workspace, ASSISTANT_DIR, HISTORY_DIR, agentId);
  fs.mkdirSync(historyDir, { recursive: true });

  const historyData = {
    id: historyId,
    agent_id: agentId,
    title: title ?? historyId,
    messages: messages || [],
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  fs.writeFileSync(
    getHistoryFilePath(workspace, agentId, historyId),
    JSON.stringify(historyData, null, 2),
    'utf-8'
  );
}

/**
 * 删除 Agent 及其关联历史
 */
export function removeAiAgent(workspace: string, agentName: string): void {
  // 删除 Agent 文件
  const agentFile = getAgentFilePath(workspace, agentName);
  if (fs.existsSync(agentFile)) {
    fs.unlinkSync(agentFile);
  }

  // 删除关联历史目录
  const historyDir = path.join(workspace, ASSISTANT_DIR, HISTORY_DIR, agentName);
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
 * 清理整个 assistant 目录（所有 Agent、LLM配置、历史）
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
 * 清理指定测试数据（Agent + LLM配置）
 */
export function cleanupAiTestData(
  workspace: string,
  agentNames: string[],
  llmConfigNames?: string[]
): void {
  for (const name of agentNames) {
    removeAiAgent(workspace, name);
  }
  if (llmConfigNames) {
    for (const name of llmConfigNames) {
      removeAiLlmConfig(workspace, name);
    }
  }
}

/**
 * 通用环境设置：创建 Agent + LLM配置 + 历史
 */
export function setupAiTestEnvironment(
  workspace: string,
  options?: {
    agentId?: string;
    historyId?: string;
    llmConfigName?: string;
    agentData?: Record<string, unknown>;
    historyMessages?: Array<{ role: string; content: string; name?: string }>;
  }
): { agentId: string; historyId: string; llmConfigName: string } {
  const agentId = options?.agentId || 'e2e_test_agent';
  const historyId = options?.historyId || 'e2e_test_history';
  const llmConfigName = options?.llmConfigName || 'e2e_test_config';

  createAiLlmConfig(workspace, llmConfigName);
  createAiAgent(workspace, agentId, options?.agentData);
  createAiHistory(workspace, agentId, historyId, options?.historyMessages);

  return { agentId, historyId, llmConfigName };
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
 * 用于 ChatInput 中的 Agent/模型选择器。
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
 * 通用前置：通过 ChatInput 选择 Agent，点击侧边栏历史项，等待对话界面就绪
 *
 * @param page - Playwright Page 对象
 * @param agentId - Agent 名称
 * @param historyId - 历史 ID（也用作标题匹配文本）
 */
export async function setupChatSession(
  page: any,
  agentId: string,
  historyId: string
): Promise<void> {
  await selectOption(page, '选择Agent', agentId);
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
