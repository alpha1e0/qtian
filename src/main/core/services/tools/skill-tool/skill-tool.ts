import { createLogger } from '@/core/utils/logger';
import { ITool } from '../tool.interface';

const logger = createLogger('SkillTool');

/**
 * 加载 Skill 的回调函数类型
 * @param dirName - Skill 目录名
 * @returns Skill 完整数据 (含 instructions)
 */
export type LoadSkillCallback = (dirName: string) => Promise<{ instructions: string }>;

/**
 * 内置 Skill 工具 — 加载指定 skill 的正文指令到当前对话
 *
 * 功能:
 * 1. LLM 从 system prompt 中看到可用 skill 列表后，调用此工具加载具体 skill
 * 2. execute() 返回简短确认文本
 * 3. afterExecute() 返回 skill 正文，由框架追加为 user message
 *
 * 设计:
 * 通过构造函数注入回调函数加载 skill 数据，工具本身不依赖文件系统，
 * 便于单元测试。
 */
export class SkillTool implements ITool {
  readonly name = 'skill';
  readonly description =
    'Invoke a skill by loading its full instructions into the conversation. '
    + 'Use this tool when you see available skills listed in the system prompt and need to follow a specific skill\'s detailed instructions. '
    + 'The skill\'s full instruction text will be loaded for you to execute.';
  readonly parameters: Record<string, any> = {
    type: 'object',
    properties: {
      skill: {
        type: 'string',
        description: 'The directory name of the skill to invoke (e.g., "project-review", "spec-develop")',
      },
      args: {
        type: 'string',
        description: 'Optional arguments to pass to the skill (e.g., additional context or parameters)',
      },
    },
    required: ['skill'],
  };

  /**
   * @param loadSkill - 回调函数，用于加载 skill 数据
   */
  constructor(private loadSkill: LoadSkillCallback) {}

  /**
   * 执行 skill 工具 — 校验参数并确认加载
   */
  async execute(args: Record<string, any>): Promise<string> {
    const { skill } = args;

    if (!skill || typeof skill !== 'string' || !skill.trim()) {
      return 'Error: "skill" parameter is required and must be a non-empty string';
    }

    return `Skill '${skill.trim()}' loaded successfully`;
  }

  /**
   * 工具执行后钩子 — 加载 skill 正文返回给框架追加为 user message
   * @returns skill 正文内容，加载失败时返回 null
   */
  async afterExecute(args: Record<string, any>, _result: string): Promise<string | null> {
    const { skill, args: skillArgs } = args;
    const dirName = (skill as string)?.trim();

    if (!dirName) {
      return null;
    }

    try {
      const skillData = await this.loadSkill(dirName);

      if (!skillData.instructions) {
        logger.warn(`Skill '${dirName}' has no instructions`);
        return null;
      }

      // 组装追加给 LLM 的消息
      let content = `<skill name="${dirName}">\n${skillData.instructions}\n</skill>`;

      if (skillArgs && typeof skillArgs === 'string' && skillArgs.trim()) {
        content += `\n\nAdditional context from user: ${skillArgs.trim()}`;
      }

      return content;
    } catch (err) {
      const errMsg = (err as Error).message;
      logger.error(`Failed to load skill '${dirName}': ${errMsg}`);
      return `Error: Failed to load skill '${dirName}': ${errMsg}`;
    }
  }
}
