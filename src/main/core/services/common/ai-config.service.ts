import * as fs from 'fs/promises';
import * as path from 'path';

import { wpath, config } from '@/core/common/context';
import { createLogger } from '@/core/utils/logger';
import { AiLLMConfig } from '@/core/common/config';

const logger = createLogger('AiConfigService');

/**
 * AI 助手 LLM 配置管理服务
 * 负责模型配置 JSON 文件的 CRUD 操作
 */
export class AiConfigService {
  /**
   * 列出所有 LLM 配置
   * @returns 配置文件名列表 (不含 .json 后缀，排序后)
   */
  async listConfigs(): Promise<string[]> {
    try {
      const entries = await fs.readdir(wpath.assistantLlmDir);
      return entries
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.replace(/\.json$/, ''))
        .sort();
    } catch (err) {
      logger.error('Failed to list LLM configs', err);
      return [];
    }
  }

  /**
   * 获取 LLM 配置
   * @param name - 配置名称 (不含 .json 后缀)
   * @returns LLM 配置数据
   */
  async getConfig(name: string): Promise<AiLLMConfig> {
    this.validateConfigName(name);

    const configPath = path.join(wpath.assistantLlmDir, `${name}.json`);

    try {
      const data = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(data) as AiLLMConfig;
    } catch (err) {
      logger.error(`Failed to get config ${name}`, err);
      throw new Error(`Config '${name}' not found`);
    }
  }

  /**
   * 保存 LLM 配置
   * @param name - 配置名称
   * @param data - LLM 配置数据
   */
  async saveConfig(name: string, data: AiLLMConfig): Promise<void> {
    this.validateConfigName(name);

    const configPath = path.join(wpath.assistantLlmDir, `${name}.json`);

    try {
      await fs.writeFile(configPath, JSON.stringify(data, null, 2), 'utf-8');
      logger.info(`Config '${name}' saved`);
    } catch (err) {
      logger.error(`Failed to save config ${name}`, err);
      throw new Error(`Failed to save config '${name}': ${err}`);
    }
  }

  /**
   * 删除 LLM 配置
   * @param name - 配置名称
   */
  async deleteConfig(name: string): Promise<void> {
    this.validateConfigName(name);

    const configPath = path.join(wpath.assistantLlmDir, `${name}.json`);

    try {
      await fs.unlink(configPath);
      logger.info(`Config '${name}' deleted`);
    } catch (err) {
      logger.error(`Failed to delete config ${name}`, err);
      throw new Error(`Failed to delete config '${name}': ${err}`);
    }
  }

  /**
   * 获取默认 LLM 配置
   * @returns 默认 LLM 配置
   */
  async getDefaultConfig(): Promise<AiLLMConfig> {
    const defaultConfigName = config.aiAssistant.defaultLlmConfig;

    try {
      return await this.getConfig(defaultConfigName);
    } catch (err) {
      logger.warn('Default AI config not found, using fallback');
      return {
        base_url: 'https://api.example.com/v1',
        model: 'default',
        key: '',
        temperature: 0.7,
        max_tokens: 2000,
      };
    }
  }

  /**
   * 检查配置是否存在
   * @param name - 配置名称
   * @returns 是否存在
   */
  async configExists(name: string): Promise<boolean> {
    this.validateConfigName(name);

    const configPath = path.join(wpath.assistantLlmDir, `${name}.json`);

    try {
      await fs.access(configPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 校验配置名称，防止路径遍历攻击
   * @param name - 配置名称
   */
  private validateConfigName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new Error('Config name cannot be empty');
    }

    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      throw new Error('Invalid config name');
    }
  }
}
