import * as fs from 'fs/promises';
import * as path from 'path';

import { wpath } from '@/core/common/context';
import { createLogger } from '@/core/utils/logger';
import { AiChatHistory } from '@/core/common/config';

const logger = createLogger('AiHistoryService');

/**
 * AI 助手对话历史管理服务
 * 历史按场景 ID 分目录存储，每个对话一个 JSON 文件
 */
export class AiHistoryService {
  /**
   * 列出指定场景的所有对话历史
   * @param scenarioId - 场景 ID
   * @returns 对话历史 ID 列表 (排序后)
   */
  async listHistories(scenarioId: string): Promise<string[]> {
    this.validateScenarioId(scenarioId);

    const historyDir = path.join(wpath.assistantHistoryDir, scenarioId);

    try {
      const entries = await fs.readdir(historyDir);
      return entries
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.replace(/\.json$/, ''))
        .sort();
    } catch (err) {
      // 历史目录不存在，返回空列表
      return [];
    }
  }

  /**
   * 获取对话历史详情
   * @param scenarioId - 场景 ID
   * @param historyId - 历史 ID
   * @returns 对话历史数据
   */
  async getHistory(scenarioId: string, historyId: string): Promise<AiChatHistory> {
    this.validateScenarioId(scenarioId);
    this.validateHistoryId(historyId);

    const historyPath = this.getHistoryPath(scenarioId, historyId);

    try {
      const data = await fs.readFile(historyPath, 'utf-8');
      return JSON.parse(data) as AiChatHistory;
    } catch (err) {
      logger.error(`Failed to get history ${historyId}`, err);
      throw new Error(`History '${historyId}' not found`);
    }
  }

  /**
   * 创建新对话历史
   * @param scenarioId - 场景 ID
   * @param historyId - 历史 ID
   * @param data - 对话历史数据
   */
  async createHistory(scenarioId: string, historyId: string, data: AiChatHistory): Promise<void> {
    this.validateScenarioId(scenarioId);
    this.validateHistoryId(historyId);

    const historyDir = path.join(wpath.assistantHistoryDir, scenarioId);
    const historyPath = path.join(historyDir, `${historyId}.json`);

    // 检查是否已存在
    let historyExists = false;
    try {
      await fs.access(historyPath);
      historyExists = true;
    } catch {
      // 文件不存在，继续创建
    }

    if (historyExists) {
      throw new Error(`History '${historyId}' already exists`);
    }

    try {
      await fs.mkdir(historyDir, { recursive: true, mode: 0o755 });
      await fs.writeFile(historyPath, JSON.stringify(data, null, 2), 'utf-8');
      logger.info(`History '${historyId}' created for scenario '${scenarioId}'`);
    } catch (err) {
      logger.error(`Failed to create history ${historyId}`, err);
      throw new Error(`Failed to create history '${historyId}': ${err}`);
    }
  }

  /**
   * 保存对话历史 (覆盖写入)
   * @param scenarioId - 场景 ID
   * @param historyId - 历史 ID
   * @param data - 对话历史数据
   */
  async saveHistory(scenarioId: string, historyId: string, data: AiChatHistory): Promise<void> {
    this.validateScenarioId(scenarioId);
    this.validateHistoryId(historyId);

    const historyPath = this.getHistoryPath(scenarioId, historyId);

    try {
      await fs.writeFile(historyPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      logger.error(`Failed to save history ${historyId}`, err);
      throw new Error(`Failed to save history '${historyId}': ${err}`);
    }
  }

  /**
   * 删除对话历史
   * @param scenarioId - 场景 ID
   * @param historyId - 历史 ID
   */
  async deleteHistory(scenarioId: string, historyId: string): Promise<void> {
    this.validateScenarioId(scenarioId);
    this.validateHistoryId(historyId);

    const historyPath = this.getHistoryPath(scenarioId, historyId);

    try {
      await fs.unlink(historyPath);
      logger.info(`History '${historyId}' deleted for scenario '${scenarioId}'`);
    } catch (err) {
      logger.error(`Failed to delete history ${historyId}`, err);
      throw new Error(`Failed to delete history '${historyId}': ${err}`);
    }
  }

  /**
   * 检查对话历史是否存在
   * @param scenarioId - 场景 ID
   * @param historyId - 历史 ID
   * @returns 是否存在
   */
  async historyExists(scenarioId: string, historyId: string): Promise<boolean> {
    this.validateScenarioId(scenarioId);
    this.validateHistoryId(historyId);

    const historyPath = this.getHistoryPath(scenarioId, historyId);

    try {
      await fs.access(historyPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取历史文件路径
   * @param scenarioId - 场景 ID
   * @param historyId - 历史 ID
   * @returns 完整文件路径
   */
  private getHistoryPath(scenarioId: string, historyId: string): string {
    return path.join(wpath.assistantHistoryDir, scenarioId, `${historyId}.json`);
  }

  /**
   * 校验场景 ID，防止路径遍历攻击
   */
  private validateScenarioId(id: string): void {
    if (!id || id.trim().length === 0) {
      throw new Error('Scenario ID cannot be empty');
    }
    if (id.includes('..') || id.includes('/') || id.includes('\\')) {
      throw new Error('Invalid scenario ID');
    }
  }

  /**
   * 校验历史 ID，防止路径遍历攻击
   */
  private validateHistoryId(id: string): void {
    if (!id || id.trim().length === 0) {
      throw new Error('History ID cannot be empty');
    }
    if (id.includes('..') || id.includes('/') || id.includes('\\')) {
      throw new Error('Invalid history ID');
    }
  }
}
