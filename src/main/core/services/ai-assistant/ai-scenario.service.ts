import * as fs from 'fs/promises';
import * as path from 'path';

import { wpath } from '@/core/common/context';
import { createLogger } from '@/core/utils/logger';
import { AiScenario } from '@/core/common/config';

const logger = createLogger('AiScenarioService');

/**
 * AI 助手场景管理服务
 * 负责场景 JSON 文件的 CRUD 操作
 */
export class AiScenarioService {
  /**
   * 列出所有场景
   * @returns 场景 ID 列表 (排序后)
   */
  async listScenarios(): Promise<string[]> {
    try {
      const entries = await fs.readdir(wpath.assistantScenarioDir, { withFileTypes: true });
      const scenarios: string[] = [];

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.json')) {
          scenarios.push(entry.name.replace(/\.json$/, ''));
        }
      }

      return scenarios.sort();
    } catch (err) {
      logger.error('Failed to list scenarios', err);
      throw new Error(`Failed to list scenarios: ${err}`);
    }
  }

  /**
   * 获取场景详情
   * @param id - 场景 ID
   * @returns 场景数据
   */
  async getScenario(id: string): Promise<AiScenario> {
    this.validateScenarioId(id);

    const scenarioPath = path.join(wpath.assistantScenarioDir, `${id}.json`);

    try {
      const data = await fs.readFile(scenarioPath, 'utf-8');
      return JSON.parse(data) as AiScenario;
    } catch (err) {
      logger.error(`Failed to get scenario ${id}`, err);
      throw new Error(`Scenario '${id}' not found`);
    }
  }

  /**
   * 创建新场景
   * @param id - 场景 ID
   * @param data - 场景数据
   */
  async createScenario(id: string, data: AiScenario): Promise<void> {
    this.validateScenarioId(id);

    const scenarioPath = path.join(wpath.assistantScenarioDir, `${id}.json`);

    // 检查是否已存在
    let scenarioExists = false;
    try {
      await fs.access(scenarioPath);
      scenarioExists = true;
    } catch {
      // 文件不存在，继续创建
    }

    if (scenarioExists) {
      throw new Error(`Scenario '${id}' already exists`);
    }

    try {
      // 确保场景对应的历史目录存在
      const historyDir = path.join(wpath.assistantHistoryDir, id);
      await fs.mkdir(historyDir, { recursive: true, mode: 0o755 });

      // 写入场景文件
      await fs.writeFile(scenarioPath, JSON.stringify(data, null, 2), 'utf-8');

      logger.info(`Scenario '${id}' created`);
    } catch (err) {
      logger.error(`Failed to create scenario ${id}`, err);
      throw new Error(`Failed to create scenario '${id}': ${err}`);
    }
  }

  /**
   * 更新场景
   * @param id - 场景 ID
   * @param data - 新的场景数据
   */
  async updateScenario(id: string, data: AiScenario): Promise<void> {
    this.validateScenarioId(id);

    const scenarioPath = path.join(wpath.assistantScenarioDir, `${id}.json`);

    try {
      await fs.writeFile(scenarioPath, JSON.stringify(data, null, 2), 'utf-8');
      logger.info(`Scenario '${id}' updated`);
    } catch (err) {
      logger.error(`Failed to update scenario ${id}`, err);
      throw new Error(`Failed to update scenario '${id}': ${err}`);
    }
  }

  /**
   * 删除场景
   * @param id - 场景 ID
   */
  async deleteScenario(id: string): Promise<void> {
    this.validateScenarioId(id);

    const scenarioPath = path.join(wpath.assistantScenarioDir, `${id}.json`);

    try {
      await fs.unlink(scenarioPath);

      // 同时清理对应的历史目录
      const historyDir = path.join(wpath.assistantHistoryDir, id);
      await fs.rm(historyDir, { recursive: true, force: true });

      logger.info(`Scenario '${id}' deleted`);
    } catch (err) {
      logger.error(`Failed to delete scenario ${id}`, err);
      throw new Error(`Failed to delete scenario '${id}': ${err}`);
    }
  }

  /**
   * 检查场景是否存在
   * @param id - 场景 ID
   * @returns 是否存在
   */
  async scenarioExists(id: string): Promise<boolean> {
    this.validateScenarioId(id);

    const scenarioPath = path.join(wpath.assistantScenarioDir, `${id}.json`);

    try {
      await fs.access(scenarioPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 校验场景 ID，防止路径遍历攻击
   * @param id - 场景 ID
   */
  private validateScenarioId(id: string): void {
    if (!id || id.trim().length === 0) {
      throw new Error('Scenario ID cannot be empty');
    }

    if (id.includes('..') || id.includes('/') || id.includes('\\')) {
      throw new Error('Invalid scenario ID');
    }
  }
}
