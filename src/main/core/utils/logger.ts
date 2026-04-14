import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

// Lazy import to avoid circular dependency with context.ts
let _wpath: typeof import('../common/context').wpath | null = null;

function getWpath() {
  if (!_wpath) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _wpath = require('../common/context').wpath;
  }
  return _wpath;
}

/**
 * Log level enum
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
}

/**
 * Log entry structure
 */
interface LogEntry {
  timestamp: string;
  level: string;
  category: string;
  message: string;
  data?: any;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  maxFileSize?: number; // Maximum file size in bytes (default: 10MB)
  maxFiles?: number; // Maximum number of log files to keep (default: 30)
  retentionDays?: number; // Number of days to keep logs (default: 30)
}

// Default logger configuration
const DEFAULT_CONFIG: Required<LoggerConfig> = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 30,
  retentionDays: 30,
};

/**
 * Structured logger for Qtian application
 */
export class Logger {
  private category: string;
  private minLevel: LogLevel;
  private logToFile: boolean;
  private config: Required<LoggerConfig>;
  private currentFileSize: Map<string, number> = new Map();
  private cleanupScheduled: boolean = false;

  constructor(
    category: string,
    minLevel: LogLevel = LogLevel.INFO,
    logToFile: boolean = true,
    config?: LoggerConfig
  ) {
    this.category = category;
    this.minLevel = minLevel;
    this.logToFile = logToFile;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Schedule periodic cleanup
    if (this.logToFile) {
      this.scheduleCleanup();
    }
  }

  /**
   * Log debug message
   * @param message - Log message
   * @param data - Optional data to include
   */
  debug(message: string, data?: any): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  /**
   * Log info message
   * @param message - Log message
   * @param data - Optional data to include
   */
  info(message: string, data?: any): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * Log warning message
   * @param message - Log message
   * @param data - Optional data to include
   */
  warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * Log error message
   * @param message - Log message
   * @param error - Optional error object
   * @param data - Optional additional data
   */
  error(message: string, error?: Error | unknown, data?: any): void {
    this.log(LogLevel.ERROR, message, data, error);
  }

  /**
   * Log fatal error message
   * @param message - Log message
   * @param error - Optional error object
   * @param data - Optional additional data
   */
  fatal(message: string, error?: Error | unknown, data?: any): void {
    this.log(LogLevel.FATAL, message, data, error);
  }

  /**
   * Core logging method
   */
  private log(level: LogLevel, message: string, data?: any, error?: Error | unknown): void {
    if (level < this.minLevel) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      category: this.category,
      message,
      data,
    };

    if (error) {
      entry.error = this.extractErrorInfo(error);
    }

    // Console output with colors
    this.logToConsole(entry);

    // File output
    if (this.logToFile) {
      // 在测试环境下使用同步写入，确保日志被记录
      if (process.env.IS_TEST === 'true') {
        this.logToFileSync(entry);
      } else {
        // 正常环境使用异步写入（非阻塞）
        this.logToFileAsync(entry).catch((err) => {
          // 静默失败，避免日志错误导致无限循环
        });
      }
    }
  }

  /**
   * Log to console with appropriate formatting
   */
  private logToConsole(entry: LogEntry): void {
    const prefix = `[${entry.timestamp}] [${entry.level}] [${entry.category}]`;
    const message = `${prefix} ${entry.message}`;

    // 在测试环境下，强制所有日志输出到 stderr
    if (process.env.IS_TEST === 'true') {
      console.error(message, entry.data || '', entry.error || '');
      try {
        process.stderr.write('\n');
      } catch {
        // 忽略错误
      }
      return;
    }

    // 正常环境：使用对应的 console 方法
    switch (entry.level) {
      case 'DEBUG':
        console.debug(message, entry.data || '');
        break;
      case 'INFO':
        console.info(message, entry.data || '');
        break;
      case 'WARN':
        console.warn(message, entry.data || '');
        break;
      case 'ERROR':
      case 'FATAL':
        console.error(message, entry.data || '', entry.error || '');
        break;
    }
  }

  /**
   * Log to file asynchronously with rotation
   */
  private async logToFileAsync(entry: LogEntry): Promise<void> {
    try {
      const logLine = JSON.stringify(entry) + '\n';
      const logFileName = this.getLogFileName();
      const logFile = path.join(getWpath().logDirectory, logFileName);

      // Check if rotation is needed
      await this.rotateIfNeeded(logFile, logLine.length);

      // Append log entry
      await fs.appendFile(logFile, logLine, 'utf-8');
    } catch (err) {
      // 静默失败，避免日志错误导致无限循环
    }
  }

  /**
   * Log to file synchronously (for test environment)
   * 确保在测试结束时日志已完全写入
   */
  private logToFileSync(entry: LogEntry): void {
    try {
      const logLine = JSON.stringify(entry) + '\n';

      // 在测试环境下，直接从环境变量获取工作目录
      // 避免使用 getWpath() 可能导致的循环依赖问题
      let logFile: string;
      if (process.env.IS_TEST === 'true' && process.env.QTIAN_WORKSPACE) {
        const logDir = path.join(process.env.QTIAN_WORKSPACE, 'log');
        const date = new Date().toISOString().split('T')[0];
        logFile = path.join(logDir, `qtian-${date}.log`);

        // 确保目录存在
        try {
          fsSync.mkdirSync(logDir, { recursive: true });
        } catch (err) {
          // 忽略目录创建错误
        }
      } else {
        // 正常环境：使用 wpath
        const wpath = getWpath();
        const logDir = wpath.logDirectory;
        const logFileName = this.getLogFileName();
        logFile = path.join(logDir, logFileName);

        // 确保日志目录存在
        try {
          fsSync.accessSync(logDir);
        } catch {
          fsSync.mkdirSync(logDir, { recursive: true, mode: 0o700 });
        }
      }

      // 直接同步写入
      fsSync.appendFileSync(logFile, logLine, 'utf-8');
    } catch (err) {
      // 静默失败，避免日志错误导致无限循环
    }
  }

  // 标记是否已输出同步初始化信息
  private _logSyncInit: boolean = false;

  /**
   * Rotate log file if it exceeds max size
   */
  private async rotateIfNeeded(logFile: string, newEntrySize: number): Promise<void> {
    try {
      // Get current file size
      const currentSize = this.currentFileSize.get(logFile) || (await this.getFileSize(logFile));

      // Check if rotation is needed
      if (currentSize + newEntrySize > this.config.maxFileSize) {
        await this.rotateLogFile(logFile);
        this.currentFileSize.set(logFile, 0); // Reset size for new file
      } else {
        this.currentFileSize.set(logFile, currentSize + newEntrySize);
      }
    } catch (err) {
      // File might not exist yet, which is fine
    }
  }

  /**
   * Get file size
   */
  private async getFileSize(filePath: string): Promise<number> {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  /**
   * Rotate log file by renaming with timestamp
   */
  private async rotateLogFile(logFile: string): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedFile = logFile.replace('.log', `.${timestamp}.log`);

      await fs.rename(logFile, rotatedFile);

      // Clean up old rotated files
      await this.cleanOldRotatedFiles(logFile);
    } catch (err) {
      // Ignore rotation errors
    }
  }

  /**
   * Clean up old rotated log files
   */
  private async cleanOldRotatedFiles(baseLogFile: string): Promise<void> {
    try {
      const logDir = path.dirname(baseLogFile);
      const baseName = path.basename(baseLogFile, '.log');
      const files = await fs.readdir(logDir);

      // Get all rotated files for this log
      const rotatedFiles = files
        .filter((f) => f.startsWith(`${baseName}.`) && f.endsWith('.log'))
        .map((f) => path.join(logDir, f));

      // Sort by modification time (oldest first)
      const fileStats = await Promise.all(
        rotatedFiles.map(async (f) => ({
          path: f,
          mtime: (await fs.stat(f)).mtime.getTime(),
        }))
      );
      fileStats.sort((a, b) => a.mtime - b.mtime);

      // Remove excess files
      while (fileStats.length > this.config.maxFiles) {
        const toRemove = fileStats.shift();
        if (toRemove) {
          await fs.unlink(toRemove.path).catch(() => {
            // Ignore deletion errors
          });
        }
      }
    } catch (err) {
      // Ignore cleanup errors
    }
  }

  /**
   * Schedule periodic cleanup of old log files
   */
  private scheduleCleanup(): void {
    if (this.cleanupScheduled) return;

    this.cleanupScheduled = true;

    // Run cleanup every hour
    setInterval(
      () => {
        this.cleanOldLogs().catch((err) => {
          // Silent failure
        });
      },
      60 * 60 * 1000
    );

    // Run initial cleanup after a delay
    setTimeout(() => {
      this.cleanOldLogs().catch(() => {
        // Silent failure
      });
    }, 5000);
  }

  /**
   * Clean up logs older than retention period
   */
  private async cleanOldLogs(): Promise<void> {
    try {
      const logDir = getWpath().logDirectory;
      const files = await fs.readdir(logDir);
      const now = Date.now();
      const retentionMs = this.config.retentionDays * 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (!file.endsWith('.log')) continue;

        const filePath = path.join(logDir, file);
        const stats = await fs.stat(filePath);
        const age = now - stats.mtime.getTime();

        if (age > retentionMs) {
          await fs.unlink(filePath).catch(() => {
            // Ignore deletion errors
          });
        }
      }
    } catch (err) {
      // Ignore cleanup errors
    }
  }

  /**
   * Get log file name based on date
   */
  private getLogFileName(): string {
    const date = new Date().toISOString().split('T')[0];
    return `qtian-${date}.log`;
  }

  /**
   * Extract error information from Error object or unknown type
   */
  private extractErrorInfo(error: Error | unknown): {
    name: string;
    message: string;
    stack?: string;
  } {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    return {
      name: 'UnknownError',
      message: String(error),
    };
  }

  /**
   * Set minimum log level
   */
  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Update logger configuration
   */
  updateConfig(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Create a logger instance for a category
 * @param category - Logger category (usually module or service name)
 * @param minLevel - Minimum log level (default: INFO)
 * @param config - Optional logger configuration
 * @returns Logger instance
 */
export function createLogger(
  category: string,
  minLevel: LogLevel = LogLevel.INFO,
  config?: LoggerConfig
): Logger {
  return new Logger(category, minLevel, true, config);
}

/**
 * Default logger instance
 */
export const logger = new Logger('qtian', LogLevel.INFO);
