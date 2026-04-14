import { exec } from 'child_process';
import * as path from 'path';
import { createLogger } from '@/core/utils/logger';
import { ITool } from './tool.interface';

const logger = createLogger('ShellTool');

/** 默认命令超时时间 (ms) */
const DEFAULT_TIMEOUT = 30000;

/** 默认最大输出长度 (字符) */
const MAX_OUTPUT_LENGTH = 100000;

/**
 * 危险命令模式列表 — 前置拦截，防止破坏性操作
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?-\s*r/,       // rm -rf / 或 rm -fr 等
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?-\s*f/,       // rm -fr /
  /\bdel\s+\/[fFsS].*\\\*/,                        // del /f /s C:\*
  /\brd\s+\/[sSqQ].*\\/,                           // rd /s /q C:\
  /\bformat\b/,                                     // format
  /\bmkfs\b/,                                      // mkfs
  /\bdd\s+.*of=\/dev\//,                           // dd 写入设备
  />\s*\/dev\//,                                   // 重定向到设备
  /\bshutdown\b/,                                  // shutdown
  /\breboot\b/,                                    // reboot
  /\bchmod\s+(-R\s+)?777\s+\//,                   // chmod 777 /
  /\bchown\s+(-R\s+)?/,                            // chown -R /
  /\btaskkill\b.*\/[fF]/,                          // taskkill /f
];

/**
 * 内置 Shell 工具 — 安全地执行 Shell 命令
 *
 * 安全措施:
 * 1. 危险命令前置拦截
 * 2. 可选工作目录限制
 * 3. 默认超时 30s
 * 4. 输出长度限制
 */
export class ShellTool implements ITool {
  readonly name = 'shell_execute';
  readonly description =
    'Execute shell commands (bash/git/etc) and return the output. The command runs in the system shell.';
  readonly parameters: Record<string, any> = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      timeout: {
        type: 'number',
        description: `Timeout in milliseconds (default: ${DEFAULT_TIMEOUT})`,
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command execution',
      },
    },
    required: ['command'],
  };

  private allowedCwd: string | null = null;
  private timeoutMs: number;

  /**
   * @param options - Shell 工具配置
   * @param options.allowedCwd - 限制命令执行的工作目录 (null 表示不限制)
   * @param options.timeoutMs - 默认超时时间 (ms)
   */
  constructor(options?: { allowedCwd?: string | null; timeoutMs?: number }) {
    this.allowedCwd = options?.allowedCwd ?? null;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT;
  }

  /**
   * 执行 Shell 命令
   * @param args - 工具参数
   * @param args.command - 要执行的命令
   * @param args.timeout - 超时时间 (ms)
   * @param args.cwd - 工作目录
   * @returns 命令输出文本
   */
  async execute(args: Record<string, any>): Promise<string> {
    const { command, timeout, cwd } = args;

    if (!command || typeof command !== 'string') {
      return 'Error: "command" is required and must be a string';
    }

    const trimmedCommand = command.trim();
    logger.info(`Executing shell command: ${trimmedCommand}`);

    // 前置安全检查
    const dangerResult = this.checkDangerousCommand(trimmedCommand);
    if (dangerResult) {
      logger.warn(`Dangerous command blocked: ${trimmedCommand}`);
      return `Error: ${dangerResult}`;
    }

    // 工作目录检查
    const resolvedCwd = this.resolveCwd(cwd);
    if (this.allowedCwd && resolvedCwd && !resolvedCwd.startsWith(this.allowedCwd)) {
      logger.warn(`Working directory outside allowed scope: ${resolvedCwd}`);
      return `Error: Working directory "${resolvedCwd}" is outside the allowed scope`;
    }

    const timeoutMs = typeof timeout === 'number' ? timeout : this.timeoutMs;

    return new Promise<string>((resolve) => {
      exec(
        trimmedCommand,
        {
          cwd: resolvedCwd,
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024, // 1MB
        },
        (error, stdout, stderr) => {
          let output = '';

          if (stdout) {
            output += stdout;
          }
          if (stderr) {
            if (output) output += '\n';
            output += stderr;
          }

          // 截断过长输出
          if (output.length > MAX_OUTPUT_LENGTH) {
            output = output.substring(0, MAX_OUTPUT_LENGTH) + '\n... (output truncated)';
          }

          if (error) {
            if (error.killed) {
              output = `Command timed out after ${timeoutMs}ms\n${output}`;
              logger.warn(`Command timed out: ${trimmedCommand}`);
            } else {
              // 命令有 stderr 输出但仍可能正常，保留输出
              if (!output) {
                output = `Error: ${error.message}`;
              }
            }
          }

          resolve(output || '(no output)');
          logger.debug(`Shell command completed: ${trimmedCommand}`);
        }
      );
    });
  }

  /**
   * 检查是否为危险命令
   * @param command - 待检查的命令
   * @returns 危险原因描述，安全时返回 null
   */
  private checkDangerousCommand(command: string): string | null {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return `Dangerous command detected (pattern: ${pattern.toString()}). Execution blocked for safety.`;
      }
    }
    return null;
  }

  /**
   * 解析工作目录
   * @param cwd - 用户指定的工作目录
   * @returns 解析后的绝对路径，未指定时返回 undefined
   */
  private resolveCwd(cwd?: string): string | undefined {
    if (!cwd || typeof cwd !== 'string') {
      return undefined;
    }
    return path.resolve(cwd);
  }
}
