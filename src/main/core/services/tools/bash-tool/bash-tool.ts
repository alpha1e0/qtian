/**
 * BashTool — 基于 PortableGit bash 的 spawn 执行工具
 *
 * 与 ShellTool 并存：
 * - ShellTool 使用系统默认 shell (cmd) + child_process.exec()
 * - BashTool 使用 PortableGit bash + child_process.spawn()
 *
 * 设计参考 Claude Code 源码的 BashTool，但剥离 React/UI 依赖。
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { createLogger } from '@/core/utils/logger';
import { ITool } from '../tool.interface';
import { resolveBashPath } from './bash-tool-path';
import { validateCommandSafety, isCwdAllowed } from './bash-tool-security';

const logger = createLogger('BashTool');

/** 默认命令超时时间 (ms) */
const DEFAULT_TIMEOUT = 30000;

/** 超时后 SIGKILL 前的等待时间 (ms) */
const SIGKILL_DELAY = 5000;

/** 默认最大输出长度 (字符) */
const MAX_OUTPUT_LENGTH = 100000;

/**
 * 内置 Bash 工具 — 使用 PortableGit bash 环境执行命令
 *
 * 特性：
 * 1. spawn-based 进程控制（非 exec）
 * 2. 可选后台执行模式
 * 3. 进程管理（可取消正在运行的进程）
 * 4. 危险命令前置拦截
 * 5. 工作目录范围限制
 * 6. 超时 SIGTERM → SIGKILL 双阶段终止
 */
export class BashTool implements ITool {
  readonly name = 'bash_execute';
  readonly description =
    'Execute commands in a bash environment (PortableGit) using spawn for better process control. Supports background execution.';
  readonly parameters: Record<string, any> = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute',
      },
      timeout: {
        type: 'number',
        description: `Timeout in milliseconds (default: ${DEFAULT_TIMEOUT})`,
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command execution',
      },
      background: {
        type: 'boolean',
        description: 'Run command in background and return PID immediately (default: false)',
      },
    },
    required: ['command'],
  };

  private allowedCwd: string | null = null;
  private timeoutMs: number;
  private activeProcesses: Map<string, ChildProcess> = new Map();

  /**
   * @param options - Bash 工具配置
   * @param options.allowedCwd - 限制命令执行的工作目录 (null 表示不限制)
   * @param options.timeoutMs - 默认超时时间 (ms)
   */
  constructor(options?: { allowedCwd?: string | null; timeoutMs?: number }) {
    this.allowedCwd = options?.allowedCwd ?? null;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT;
  }

  /**
   * 执行 Bash 命令
   *
   * @param args - 工具参数
   * @param args.command - 要执行的命令
   * @param args.timeout - 超时时间 (ms)
   * @param args.cwd - 工作目录
   * @param args.background - 是否后台执行
   * @returns 命令输出文本
   */
  async execute(args: Record<string, any>): Promise<string> {
    const { command, timeout, cwd, background } = args;

    if (!command || typeof command !== 'string') {
      return 'Error: "command" is required and must be a string';
    }

    const trimmedCommand = command.trim();
    logger.info(`Executing bash command: ${trimmedCommand}`);

    // 前置安全检查
    const dangerResult = validateCommandSafety(trimmedCommand);
    if (dangerResult) {
      logger.warn(`Dangerous command blocked: ${trimmedCommand}`);
      return `Error: ${dangerResult}`;
    }

    // 工作目录检查
    const resolvedCwd = this.resolveCwd(cwd);
    if (!isCwdAllowed(resolvedCwd || process.cwd(), this.allowedCwd)) {
      logger.warn(`Working directory outside allowed scope: ${resolvedCwd}`);
      return `Error: Working directory "${resolvedCwd}" is outside the allowed scope`;
    }

    // 解析 bash 路径
    let bashPath: string;
    try {
      bashPath = await resolveBashPath();
    } catch (err: any) {
      return `Error: ${err.message}`;
    }

    // 后台模式
    if (background) {
      return this.executeBackground(bashPath, trimmedCommand, resolvedCwd);
    }

    // 前台模式
    const timeoutMs = typeof timeout === 'number' ? timeout : this.timeoutMs;
    return this.executeForeground(bashPath, trimmedCommand, resolvedCwd, timeoutMs);
  }

  /**
   * 取消指定进程
   * @param pid - 进程 ID
   */
  cancelProcess(pid: string): boolean {
    const proc = this.activeProcesses.get(pid);
    if (proc) {
      proc.kill('SIGTERM');
      this.activeProcesses.delete(pid);
      logger.info(`Process cancelled: PID ${pid}`);
      return true;
    }
    return false;
  }

  /**
   * 获取当前活跃进程数
   */
  get activeProcessCount(): number {
    return this.activeProcesses.size;
  }

  /**
   * 前台执行命令 — 等待完成，收集输出
   */
  private executeForeground(
    bashPath: string,
    command: string,
    cwd: string | undefined,
    timeoutMs: number
  ): Promise<string> {
    return new Promise<string>((resolve) => {
      const proc = spawn(bashPath, ['-c', command], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const pid = String(proc.pid);
      this.activeProcesses.set(pid, proc);

      let stdout = '';
      let stderr = '';
      let isTimedOut = false;

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // 超时处理：SIGTERM → 延迟 → SIGKILL
      const timeoutTimer = setTimeout(() => {
        isTimedOut = true;
        proc.kill('SIGTERM');

        // 给进程 SIGKILL_DELAY 时间自行退出，否则强制 SIGKILL
        setTimeout(() => {
          if (this.activeProcesses.has(pid)) {
            proc.kill('SIGKILL');
          }
        }, SIGKILL_DELAY);
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timeoutTimer);
        this.activeProcesses.delete(pid);

        let output = '';
        if (stdout) output += stdout;
        if (stderr) {
          if (output) output += '\n';
          output += stderr;
        }

        // 截断过长输出
        if (output.length > MAX_OUTPUT_LENGTH) {
          output = output.substring(0, MAX_OUTPUT_LENGTH) + '\n... (output truncated)';
        }

        if (isTimedOut) {
          output = `Command timed out after ${timeoutMs}ms\n${output}`;
          logger.warn(`Command timed out: ${command}`);
        } else if (code !== 0 && !output) {
          output = `Process exited with code ${code}`;
        }

        resolve(output || '(no output)');
        logger.debug(`Bash command completed: ${command}`);
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutTimer);
        this.activeProcesses.delete(pid);
        resolve(`Error: ${err.message}`);
      });
    });
  }

  /**
   * 后台执行命令 — detached 模式，立即返回 PID
   */
  private executeBackground(
    bashPath: string,
    command: string,
    cwd: string | undefined
  ): string {
    const proc = spawn(bashPath, ['-c', command], {
      cwd,
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });

    const pid = proc.pid;
    if (pid) {
      // detached 进程不应随父进程退出
      proc.unref();
      logger.info(`Background process started: PID ${pid}`);
      return `Background process started with PID ${pid}`;
    }

    return 'Error: Failed to start background process';
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
