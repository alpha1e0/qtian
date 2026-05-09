/**
 * Console 消息转发处理器
 *
 * 在开发模式下，将渲染进程的 console 消息输出到主进程的 stdout/stderr
 */

import { ipcMain } from 'electron';
import { createLogger, LogLevel } from '@/core/utils/logger';
import { IPC_CHANNELS } from '../channels';

const logger = createLogger('ConsoleHandler', LogLevel.DEBUG);

/**
 * 格式化 console 消息用于输出
 */
function formatConsoleMessage(level: string, message: string): string {
  const timestamp = new Date().toISOString();
  const levelColor = {
    log: '\x1b[36m', // Cyan
    info: '\x1b[36m', // Cyan
    warn: '\x1b[33m', // Yellow
    error: '\x1b[31m', // Red
  }[level] || '\x1b[0m'; // Reset

  const reset = '\x1b[0m';

  return `${levelColor}[Renderer ${level.toUpperCase()}]${reset} ${timestamp} ${message}`;
}

/**
 * 发送 console 消息到主进程输出
 */
function sendConsoleMessage(level: string, message: string) {
  const formattedMessage = formatConsoleMessage(level, message);

  switch (level) {
    case 'error':
      // 使用 console.error 确保输出到 stderr
      console.error(formattedMessage);
      // 同时刷新 stderr
      process.stderr.write('\n');
      break;
    case 'warn':
      console.warn(formattedMessage);
      break;
    case 'info':
    case 'log':
    default:
      console.log(formattedMessage);
      break;
  }
}

/**
 * 注册 Console 相关的 IPC 处理器
 */
export function registerConsoleHandlers(): void {
  // 只在开发模式下注册
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  // 监听渲染进程的 console 消息
  ipcMain.on(IPC_CHANNELS.SEND_CONSOLE_MESSAGE, (_event, { level, message }) => {
    sendConsoleMessage(level, message);

    // 同时记录到 logger
    logger.debug(`[Renderer ${level.toUpperCase()}] ${message}`);
  });

  logger.info('Console message forwarding enabled (dev mode only)');
}
