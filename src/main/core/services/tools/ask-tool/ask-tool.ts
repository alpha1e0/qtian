import { createLogger } from '@/core/utils/logger';
import { ITool } from '../tool.interface';

const logger = createLogger('AskTool');

/** 单个问题选项 */
export interface AskQuestionOption {
  /** 选项显示文本 */
  label: string;
  /** 选项说明 */
  description: string;
}

/** 单个问题 */
export interface AskQuestion {
  /** 完整问题文本（以"?"结尾） */
  question: string;
  /** 短标签（显示为 chip，最大 12 字符） */
  header: string;
  /** 选项列表（2-4 个） */
  options: AskQuestionOption[];
  /** 是否多选（默认 false） */
  multiSelect?: boolean;
}

/** 向用户提问的回调函数类型 */
export type AskUserCallback = (
  toolCallId: string,
  questions: AskQuestion[],
) => Promise<Record<string, string>>;

/** 问题数量限制 */
const MIN_QUESTIONS = 1;
const MAX_QUESTIONS = 4;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const MAX_HEADER_LENGTH = 12;

/**
 * 内置向用户提问工具 — 允许 AI Agent 向用户提出多选题
 *
 * 功能:
 * 1. 支持 1-4 个问题，每题 2-4 个选项
 * 2. 支持单选和多选模式
 * 3. 用户可通过 "Other" 提供自定义文本
 *
 * 设计:
 * 通过构造函数注入回调函数，回调负责跨 IPC 与渲染器通信，
 * 工具本身不依赖 Electron API，便于单元测试。
 */
export class AskHumanTool implements ITool {
  readonly name = 'ask_human';
  readonly description =
    'Use this tool when you need to ask the user questions to gather information or clarify ambiguous instructions. '
    + 'Present 1-4 questions with 2-4 options each. '
    + 'Users can always select "Other" to provide custom text.';
  readonly parameters: Record<string, any> = {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: 'Array of 1-4 questions to ask the user',
        items: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'The complete question to ask (should end with "?")',
            },
            header: {
              type: 'string',
              description: 'Very short label displayed as a chip/tag (max 12 chars). Examples: "Auth method", "Library", "Approach".',
            },
            options: {
              type: 'array',
              description: '2-4 options for the user to choose from',
              items: {
                type: 'object',
                properties: {
                  label: {
                    type: 'string',
                    description: 'Short display text for the option (1-5 words)',
                  },
                  description: {
                    type: 'string',
                    description: 'Explanation of what this choice means or what will happen',
                  },
                },
                required: ['label', 'description'],
              },
            },
            multiSelect: {
              type: 'boolean',
              description: 'Whether the user can select multiple options (default: false)',
            },
          },
          required: ['question', 'header', 'options'],
        },
      },
    },
    required: ['questions'],
  };

  /**
   * @param askUser - 回调函数，用于向用户提问并等待回答
   */
  constructor(private askUser: AskUserCallback) {}

  /**
   * 执行提问工具
   */
  async execute(args: Record<string, any>): Promise<string> {
    const { questions: rawQuestions } = args;

    // 参数校验
    if (!rawQuestions || !Array.isArray(rawQuestions)) {
      return 'Error: "questions" is required and must be an array';
    }

    if (rawQuestions.length < MIN_QUESTIONS || rawQuestions.length > MAX_QUESTIONS) {
      return `Error: Must provide ${MIN_QUESTIONS}-${MAX_QUESTIONS} questions, got ${rawQuestions.length}`;
    }

    // 校验每个问题
    const questions: AskQuestion[] = [];
    for (let i = 0; i < rawQuestions.length; i++) {
      const q = rawQuestions[i];
      const validationError = this.validateQuestion(q, i);
      if (validationError) return validationError;
      questions.push(q);
    }

    // 检查 header 唯一性
    const headers = questions.map(q => q.header);
    const uniqueHeaders = new Set(headers);
    if (uniqueHeaders.size !== headers.length) {
      return 'Error: All question headers must be unique';
    }

    // 检查同一问题内选项 label 唯一性
    for (const q of questions) {
      const labels = q.options.map((o: AskQuestionOption) => o.label);
      const uniqueLabels = new Set(labels);
      if (uniqueLabels.size !== labels.length) {
        return `Error: Options for question "${q.header}" must have unique labels`;
      }
    }

    try {
      // 生成临时 toolCallId 用于跟踪回答
      const toolCallId = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      logger.info(`Asking user ${questions.length} question(s)`);

      const answers = await this.askUser(toolCallId, questions);
      logger.info(`User answered ${Object.keys(answers).length} question(s)`);

      // 格式化回答为文本返回给 LLM
      return this.formatAnswers(questions, answers);
    } catch (err) {
      const errMsg = (err as Error).message;
      logger.error(`Ask user failed: ${errMsg}`);
      return `Error: Failed to get user response: ${errMsg}`;
    }
  }

  /**
   * 校验单个问题的参数格式
   */
  private validateQuestion(q: any, index: number): string | null {
    if (!q || typeof q !== 'object') {
      return `Error: Question ${index + 1} must be an object`;
    }

    if (!q.question || typeof q.question !== 'string') {
      return `Error: Question ${index + 1} must have a "question" string`;
    }

    if (!q.header || typeof q.header !== 'string') {
      return `Error: Question ${index + 1} must have a "header" string`;
    }

    if (q.header.length > MAX_HEADER_LENGTH) {
      return `Error: Question ${index + 1} header must be at most ${MAX_HEADER_LENGTH} characters, got ${q.header.length}`;
    }

    if (!Array.isArray(q.options)) {
      return `Error: Question ${index + 1} must have an "options" array`;
    }

    if (q.options.length < MIN_OPTIONS || q.options.length > MAX_OPTIONS) {
      return `Error: Question ${index + 1} must have ${MIN_OPTIONS}-${MAX_OPTIONS} options, got ${q.options.length}`;
    }

    for (let j = 0; j < q.options.length; j++) {
      const opt = q.options[j];
      if (!opt || typeof opt !== 'object') {
        return `Error: Question ${index + 1}, option ${j + 1} must be an object`;
      }
      if (!opt.label || typeof opt.label !== 'string') {
        return `Error: Question ${index + 1}, option ${j + 1} must have a "label" string`;
      }
      if (!opt.description || typeof opt.description !== 'string') {
        return `Error: Question ${index + 1}, option ${j + 1} must have a "description" string`;
      }
    }

    return null;
  }

  /**
   * 格式化用户回答为返回给 LLM 的文本
   */
  private formatAnswers(
    questions: AskQuestion[],
    answers: Record<string, string>,
  ): string {
    const lines: string[] = [];

    for (const q of questions) {
      const answer = answers[q.question];
      if (answer !== undefined) {
        lines.push(`[${q.header}] ${q.question}`);
        lines.push(`Answer: ${answer}`);
        lines.push('');
      }
    }

    return lines.join('\n').trim();
  }
}
