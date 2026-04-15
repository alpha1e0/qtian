import * as fs from 'fs/promises';
import * as path from 'path';

import { wpath } from '@/core/common/context';
import { createLogger } from '@/core/utils/logger';
import { AiAgent } from '@/core/common/config';

const logger = createLogger('AiAgentService');

/**
 * AI 助手 Agent 管理服务
 *
 * Agent 以 Markdown 文件形式存储在 assistant/agent/ 下，
 * 使用 YAML front-matter + Markdown 格式（与 Skill 的 SKILL.md 模式一致）。
 *
 * 文件格式:
 *   agent/
 *     default.md
 *     coder.md
 *     translator.md
 *
 * 每个 .md 文件结构:
 *   ---
 *   name: coder
 *   description: 编程助手
 *   tools:
 *     - shell_execute
 *   model: default
 *   skills:
 *     - code-review
 *   enable_memory: true
 *   max_context_rounds: 20
 *   ---
 *
 *   你是一个专业的编程助手...
 */
export class AiAgentService {
  /**
   * 列出所有 Agent 名称
   * @returns Agent 名称列表 (排序后)
   */
  async listAgents(): Promise<string[]> {
    try {
      const entries = await fs.readdir(wpath.assistantAgentDir);
      return entries
        .filter((file) => file.endsWith('.md'))
        .map((file) => file.replace(/\.md$/, ''))
        .sort();
    } catch (err) {
      logger.error('Failed to list agents', err);
      return [];
    }
  }

  /**
   * 获取完整 Agent 数据（解析 front-matter + instructions）
   * @param name - Agent 名称 (不含 .md 后缀)
   * @returns 完整 Agent 数据
   */
  async getAgent(name: string): Promise<AiAgent> {
    this.validateAgentName(name);

    const agentPath = path.join(wpath.assistantAgentDir, `${name}.md`);

    try {
      const content = await fs.readFile(agentPath, 'utf-8');
      return this.parseAgentMd(content);
    } catch (err) {
      logger.error(`Failed to get agent ${name}`, err);
      throw new Error(`Agent '${name}' not found`);
    }
  }

  /**
   * 保存 Agent（front-matter + markdown）
   * @param name - Agent 名称
   * @param agent - Agent 数据
   */
  async saveAgent(name: string, agent: AiAgent): Promise<void> {
    this.validateAgentName(name);

    const agentPath = path.join(wpath.assistantAgentDir, `${name}.md`);

    // 确保 name 一致
    agent.name = name;

    try {
      const content = this.buildAgentMd(agent);
      await fs.writeFile(agentPath, content, 'utf-8');
      logger.info(`Agent '${name}' saved`);
    } catch (err) {
      logger.error(`Failed to save agent ${name}`, err);
      throw new Error(`Failed to save agent '${name}': ${err}`);
    }
  }

  /**
   * 删除 Agent（同时清理对应的历史目录）
   * @param name - Agent 名称
   */
  async deleteAgent(name: string): Promise<void> {
    this.validateAgentName(name);

    const agentPath = path.join(wpath.assistantAgentDir, `${name}.md`);

    try {
      await fs.unlink(agentPath);

      // 同时清理对应的历史目录
      const historyDir = path.join(wpath.assistantHistoryDir, name);
      await fs.rm(historyDir, { recursive: true, force: true });

      logger.info(`Agent '${name}' deleted`);
    } catch (err) {
      logger.error(`Failed to delete agent ${name}`, err);
      throw new Error(`Failed to delete agent '${name}': ${err}`);
    }
  }

  /**
   * 检查 Agent 是否存在
   * @param name - Agent 名称
   * @returns 是否存在
   */
  async agentExists(name: string): Promise<boolean> {
    this.validateAgentName(name);

    const agentPath = path.join(wpath.assistantAgentDir, `${name}.md`);

    try {
      await fs.access(agentPath);
      return true;
    } catch {
      return false;
    }
  }

  // =========================================================================
  // 内部方法：YAML front-matter 解析与构建
  // =========================================================================

  /**
   * 解析 Agent Markdown 文件内容
   * @param content - 完整的 .md 文件内容
   * @returns Agent 数据
   */
  private parseAgentMd(content: string): AiAgent {
    const frontMatter = this.extractFrontMatter(content);

    const name = this.extractYamlValue(frontMatter, 'name') || '';
    const description = this.extractYamlValue(frontMatter, 'description') || '';

    if (!name) {
      throw new Error('Agent front-matter must contain a "name" field');
    }
    if (!description) {
      throw new Error('Agent front-matter must contain a "description" field');
    }

    const tools = this.extractYamlList(frontMatter, 'tools');
    const model = this.extractYamlValue(frontMatter, 'model') || undefined;
    const skills = this.extractYamlList(frontMatter, 'skills');
    const enableMemory = this.extractYamlBoolean(frontMatter, 'enable_memory');
    const maxContextRounds = this.extractYamlNumber(frontMatter, 'max_context_rounds');

    const instructions = this.extractInstructions(content);

    return {
      name,
      description,
      tools,
      ...(model !== undefined && { model }),
      ...(skills.length > 0 && { skills }),
      ...(enableMemory !== undefined && { enable_memory: enableMemory }),
      ...(maxContextRounds !== undefined && { max_context_rounds: maxContextRounds }),
      instructions,
    };
  }

  /**
   * 构建 Agent Markdown 文件内容
   * @param agent - Agent 数据
   * @returns 完整的 .md 文件内容
   */
  private buildAgentMd(agent: AiAgent): string {
    const lines: string[] = ['---'];

    lines.push(`name: ${agent.name}`);
    lines.push(`description: ${agent.description}`);

    if (agent.tools && agent.tools.length > 0) {
      lines.push('tools:');
      for (const tool of agent.tools) {
        lines.push(`  - ${tool}`);
      }
    }

    if (agent.model) {
      lines.push(`model: ${agent.model}`);
    }

    if (agent.skills && agent.skills.length > 0) {
      lines.push('skills:');
      for (const skill of agent.skills) {
        lines.push(`  - ${skill}`);
      }
    }

    if (agent.enable_memory !== undefined) {
      lines.push(`enable_memory: ${agent.enable_memory}`);
    }

    if (agent.max_context_rounds !== undefined) {
      lines.push(`max_context_rounds: ${agent.max_context_rounds}`);
    }

    lines.push('---');

    if (agent.instructions) {
      lines.push('');
      lines.push(agent.instructions);
    }

    return lines.join('\n') + '\n';
  }

  /**
   * 提取 YAML front-matter (--- ... --- 之间的内容)
   */
  private extractFrontMatter(content: string): string {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    return match ? match[1].trim() : '';
  }

  /**
   * 从 YAML 文本中提取指定 key 的字符串值
   * 支持格式: key: "value" / key: 'value' / key: value
   */
  private extractYamlValue(yaml: string, key: string): string | null {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escapedKey}\\s*:\\s*(?:"([^"]*)"|'([^']*)'|(.*))$`, 'm');
    const match = yaml.match(regex);
    if (!match) return null;
    return (match[1] || match[2] || match[3] || '').trim();
  }

  /**
   * 从 YAML 文本中提取指定 key 的列表值
   * 支持格式:
   *   key:
   *     - item1
   *     - item2
   */
  private extractYamlList(yaml: string, key: string): string[] {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escapedKey}\\s*:\\s*$`, 'm');
    const match = yaml.match(regex);
    if (!match) return [];

    // 提取列表项
    const afterKey = yaml.slice(match.index! + match[0].length);
    const listRegex = /^\s+-\s+(.+)$/gm;
    const items: string[] = [];
    let listMatch;
    while ((listMatch = listRegex.exec(afterKey)) !== null) {
      items.push(listMatch[1].trim());
    }
    return items;
  }

  /**
   * 从 YAML 文本中提取布尔值
   */
  private extractYamlBoolean(yaml: string, key: string): boolean | undefined {
    const value = this.extractYamlValue(yaml, key);
    if (value === null) return undefined;
    return value === 'true';
  }

  /**
   * 从 YAML 文本中提取数值
   */
  private extractYamlNumber(yaml: string, key: string): number | undefined {
    const value = this.extractYamlValue(yaml, key);
    if (value === null) return undefined;
    const num = parseInt(value, 10);
    return isNaN(num) ? undefined : num;
  }

  /**
   * 提取 instructions 部分 (front-matter 之后的 Markdown 内容)
   */
  private extractInstructions(content: string): string {
    const withoutFrontMatter = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
    return withoutFrontMatter.trim();
  }

  /**
   * 校验 Agent 名称，防止路径遍历攻击
   * @param name - Agent 名称
   */
  private validateAgentName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new Error('Agent name cannot be empty');
    }

    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      throw new Error('Invalid agent name');
    }
  }
}
