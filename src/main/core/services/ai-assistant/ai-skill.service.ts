import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { createLogger } from '@/core/utils/logger';
import { wpath } from '@/core/common/context';
import { AiSkillMeta, AiSkill } from '@/core/common/config';

const logger = createLogger('AiSkillService');

/** SKILL.md 文件名 */
const SKILL_MD_FILE = 'SKILL.md';

/**
 * Skill 管理服务
 *
 * Skill 以目录形式存储在 assistant/skill/ 下，每个 Skill 是一个子目录，
 * 核心文件为 SKILL.md (YAML front-matter + Markdown)。
 *
 * 目录结构:
 *   skill/
 *     translator/
 *       SKILL.md
 *       scripts/        # 可选
 *       templates/      # 可选
 */
export class AiSkillService {
  private skillDir: string;

  constructor() {
    this.skillDir = wpath.assistantSkillDir;
  }

  /**
   * 列出所有可用 Skill 的元数据
   * 扫描 skill/ 目录下的子目录，解析每个 SKILL.md 的 YAML front-matter
   * @returns Skill 元数据列表
   */
  async listSkills(): Promise<AiSkillMeta[]> {
    const skills: AiSkillMeta[] = [];

    try {
      const entries = await fs.readdir(this.skillDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        this.validateSkillDirName(entry.name);

        const skillMdPath = path.join(this.skillDir, entry.name, SKILL_MD_FILE);
        try {
          const content = await fs.readFile(skillMdPath, 'utf-8');
          const meta = this.parseSkillMeta(content);
          skills.push(meta);
        } catch {
          logger.warn(`Skill '${entry.name}' has no valid SKILL.md, skipping`);
        }
      }
    } catch (err) {
      logger.error('Failed to list skills', err);
    }

    return skills;
  }

  /**
   * 获取完整的 Skill 数据
   * @param dirName - Skill 目录名
   * @returns 完整 Skill 数据
   */
  async getSkill(dirName: string): Promise<AiSkill> {
    this.validateSkillDirName(dirName);

    const skillPath = path.join(this.skillDir, dirName);
    const skillMdPath = path.join(skillPath, SKILL_MD_FILE);

    const content = await fs.readFile(skillMdPath, 'utf-8');
    const { meta, instructions } = this.parseSkillMd(content);

    // 检查可选目录
    let hasScripts = false;
    let hasTemplates = false;
    try {
      await fs.access(path.join(skillPath, 'scripts'));
      hasScripts = true;
    } catch { /* not found */ }

    try {
      await fs.access(path.join(skillPath, 'templates'));
      hasTemplates = true;
    } catch { /* not found */ }

    return {
      ...meta,
      dir_name: dirName,
      instructions,
      has_scripts: hasScripts,
      has_templates: hasTemplates,
    };
  }

  /**
   * 判断 Skill 是否存在
   * @param dirName - Skill 目录名
   */
  async skillExists(dirName: string): Promise<boolean> {
    this.validateSkillDirName(dirName);
    const skillMdPath = path.join(this.skillDir, dirName, SKILL_MD_FILE);
    try {
      await fs.access(skillMdPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 解析 SKILL.md 内容，提取元数据和指令
   * @param content - SKILL.md 的完整文本
   * @returns 元数据 + 指令文本
   */
  parseSkillMd(content: string): { meta: AiSkillMeta; instructions: string } {
    return {
      meta: this.parseSkillMeta(content),
      instructions: this.extractInstructions(content),
    };
  }

  /**
   * 解析 YAML front-matter 中的元数据
   * @param content - SKILL.md 内容
   * @returns Skill 元数据
   */
  private parseSkillMeta(content: string): AiSkillMeta {
    const frontMatter = this.extractFrontMatter(content);

    if (!frontMatter) {
      return {
        name: 'Unknown',
        description: '',
        version: '0.0.0',
      };
    }

    // 简单解析 YAML 键值对 (不引入 yaml 库，仅支持简单的 key: "value" 格式)
    const name = this.extractYamlValue(frontMatter, 'name') || 'Unknown';
    const description = this.extractYamlValue(frontMatter, 'description') || '';
    const version = this.extractYamlValue(frontMatter, 'version') || '0.0.0';

    return { name, description, version };
  }

  /**
   * 提取 YAML front-matter (--- ... --- 之间的内容)
   */
  private extractFrontMatter(content: string): string | null {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    return match ? match[1].trim() : null;
  }

  /**
   * 从 YAML 文本中提取指定 key 的值
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
   * 提取 instructions 部分 (front-matter 之后的 Markdown 内容)
   */
  private extractInstructions(content: string): string {
    // 移除 front-matter
    const withoutFrontMatter = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
    return withoutFrontMatter.trim();
  }

  /**
   * 校验 Skill 目录名安全性 (防止路径穿越)
   * @param dirName - 目录名
   */
  validateSkillDirName(dirName: string): void {
    if (!dirName || typeof dirName !== 'string') {
      throw new Error('Skill directory name must be a non-empty string');
    }
    // 禁止路径分隔符和特殊字符
    if (dirName.includes('..') || dirName.includes('/') || dirName.includes('\\') || dirName.includes('\0')) {
      throw new Error(`Invalid skill directory name: '${dirName}'`);
    }
  }
}
