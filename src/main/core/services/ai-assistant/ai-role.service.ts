import * as fs from 'fs/promises';
import * as path from 'path';

import { wpath } from '@/core/common/context';
import { createLogger } from '@/core/utils/logger';
import { AiRole } from '@/core/common/config';

const logger = createLogger('AiRoleService');

/**
 * AI 助手角色管理服务
 * 负责角色 Markdown 文件的 CRUD 操作
 */
export class AiRoleService {
  /**
   * 列出所有角色
   * @returns 角色名称列表 (不含 .md 后缀，排序后)
   */
  async listRoles(): Promise<string[]> {
    try {
      const entries = await fs.readdir(wpath.assistantRoleDir);
      return entries
        .filter((file) => file.endsWith('.md'))
        .map((file) => file.replace(/\.md$/, ''))
        .sort();
    } catch (err) {
      logger.error('Failed to list roles', err);
      return [];
    }
  }

  /**
   * 获取角色内容
   * @param name - 角色名称 (不含 .md 后缀)
   * @returns 角色数据
   */
  async getRole(name: string): Promise<AiRole> {
    this.validateRoleName(name);

    const rolePath = path.join(wpath.assistantRoleDir, `${name}.md`);

    try {
      const content = await fs.readFile(rolePath, 'utf-8');
      return { name, content };
    } catch (err) {
      logger.error(`Failed to get role ${name}`, err);
      throw new Error(`Role '${name}' not found`);
    }
  }

  /**
   * 保存角色
   * @param name - 角色名称
   * @param content - Markdown 内容
   */
  async saveRole(name: string, content: string): Promise<void> {
    this.validateRoleName(name);

    const rolePath = path.join(wpath.assistantRoleDir, `${name}.md`);

    try {
      await fs.writeFile(rolePath, content, 'utf-8');
      logger.info(`Role '${name}' saved`);
    } catch (err) {
      logger.error(`Failed to save role ${name}`, err);
      throw new Error(`Failed to save role '${name}': ${err}`);
    }
  }

  /**
   * 删除角色
   * @param name - 角色名称
   */
  async deleteRole(name: string): Promise<void> {
    this.validateRoleName(name);

    const rolePath = path.join(wpath.assistantRoleDir, `${name}.md`);

    try {
      await fs.unlink(rolePath);
      logger.info(`Role '${name}' deleted`);
    } catch (err) {
      logger.error(`Failed to delete role ${name}`, err);
      throw new Error(`Failed to delete role '${name}': ${err}`);
    }
  }

  /**
   * 检查角色是否存在
   * @param name - 角色名称
   * @returns 是否存在
   */
  async roleExists(name: string): Promise<boolean> {
    this.validateRoleName(name);

    const rolePath = path.join(wpath.assistantRoleDir, `${name}.md`);

    try {
      await fs.access(rolePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 校验角色名称，防止路径遍历攻击
   * @param name - 角色名称
   */
  private validateRoleName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new Error('Role name cannot be empty');
    }

    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      throw new Error('Invalid role name');
    }
  }
}
