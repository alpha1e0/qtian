import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import { Logger, LogLevel, createLogger } from './logger';
import * as fs from 'fs/promises';

// Mock wpath
vi.mock('../common/context', () => ({
  wpath: {
    logDir: os.tmpdir() + '/test-logs',
  },
}));

describe('Logger', () => {
  let logger: Logger;
  const testLogDir = os.tmpdir() + '/test-logs';

  beforeEach(async () => {
    await fs.mkdir(testLogDir, { recursive: true });
    logger = new Logger('TestCategory', LogLevel.DEBUG, false); // Disable file logging for tests
  });

  afterEach(async () => {
    try {
      await fs.rm(testLogDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should create logger with category', () => {
      const testLogger = new Logger('TestCategory');
      expect(testLogger).toBeDefined();
    });

    it('should accept custom min level', () => {
      const testLogger = new Logger('Test', LogLevel.WARN);
      expect(testLogger).toBeDefined();
    });
  });

  describe('log levels', () => {
    it('should log debug messages', () => {
      const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      logger.debug('Debug message');
      expect(consoleDebugSpy).toHaveBeenCalled();
      consoleDebugSpy.mockRestore();
    });

    it('should log info messages', () => {
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      logger.info('Info message');
      expect(consoleInfoSpy).toHaveBeenCalled();
      consoleInfoSpy.mockRestore();
    });

    it('should log warning messages', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      logger.warn('Warning message');
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('should log error messages', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.error('Error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('should log fatal messages', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.fatal('Fatal message');
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('min level filtering', () => {
    it('should respect min level setting', () => {
      const warnLogger = new Logger('Test', LogLevel.WARN, false);
      const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      warnLogger.debug('Should not log');
      warnLogger.info('Should not log');
      warnLogger.warn('Should log');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleDebugSpy.mockRestore();
      consoleInfoSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });
  });

  describe('error handling', () => {
    it('should extract error information from Error object', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = new Error('Test error');
      logger.error('Error occurred', error);

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('should handle unknown error types', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.error('Error occurred', 'string error');

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('configuration', () => {
    it('should allow changing min level', () => {
      logger.setMinLevel(LogLevel.ERROR);
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      logger.info('Should not log');
      logger.error('Should log');

      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleInfoSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should allow updating config', () => {
      expect(() => {
        logger.updateConfig({ maxFileSize: 5 * 1024 * 1024 });
      }).not.toThrow();
    });
  });

  describe('createLogger factory', () => {
    it('should create logger instance', () => {
      const testLogger = createLogger('FactoryTest');
      expect(testLogger).toBeInstanceOf(Logger);
    });

    it('should create logger with custom level', () => {
      const testLogger = createLogger('FactoryTest', LogLevel.DEBUG);
      expect(testLogger).toBeInstanceOf(Logger);
    });
  });

  describe('LogLevel enum', () => {
    it('should have correct numeric values', () => {
      expect(LogLevel.DEBUG).toBe(0);
      expect(LogLevel.INFO).toBe(1);
      expect(LogLevel.WARN).toBe(2);
      expect(LogLevel.ERROR).toBe(3);
      expect(LogLevel.FATAL).toBe(4);
    });
  });

  describe('log data', () => {
    it('should include data in log output', () => {
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const testData = { key: 'value', number: 123 };
      logger.info('Message with data', testData);

      expect(consoleInfoSpy).toHaveBeenCalled();
      consoleInfoSpy.mockRestore();
    });
  });
});
