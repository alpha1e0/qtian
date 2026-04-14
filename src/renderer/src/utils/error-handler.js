/**
 * 渲染进程错误处理器和 Console 拦截器
 *
 * 功能：
 * 1. 全局错误捕获
 * 2. Console 输出拦截并转发到主进程（仅在 dev 模式）
 */

// 保存原始 console 方法
const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
};

/**
 * 将 console 输出转发到主进程（仅 dev 模式）
 */
function forwardToMainProcess(level, args) {
  // 只在开发模式下转发
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  try {
    // 通过 preload 脚本暴露的 API 发送到主进程
    if (window.electronAPI && window.electronAPI.sendConsoleMessage) {
      // 将参数转换为可读的字符串
      const message = args
        .map((arg) => {
          if (typeof arg === 'string') return arg;
          if (arg instanceof Error) {
            return `${arg.message}\n${arg.stack}`;
          }
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        })
        .join(' ');

      window.electronAPI.sendConsoleMessage(level, message);
    }
  } catch (err) {
    // 忽略转发错误，避免无限循环
  }
}

/**
 * 增强 console 方法，同时输出到控制台和主进程
 */
function enhanceConsoleMethod(level, originalMethod) {
  return function (...args) {
    // 先调用原始方法，确保在 DevTools 中可见
    originalMethod(...args);

    // 转发到主进程
    forwardToMainProcess(level, args);
  };
}

/**
 * 初始化 Console 拦截器
 */
export function initConsoleInterceptor() {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  console.log = enhanceConsoleMethod('log', originalConsole.log);
  console.warn = enhanceConsoleMethod('warn', originalConsole.warn);
  console.error = enhanceConsoleMethod('error', originalConsole.error);
  console.info = enhanceConsoleMethod('info', originalConsole.info);

  // 标记拦截器已安装
  console.log('%c[Console Interceptor]', 'color: green; font-weight: bold',
    'Dev mode console forwarding enabled');
}

/**
 * 详细的错误日志输出
 * @param {string} context - 错误发生的上下文（例如：组件名、方法名）
 * @param {Error|any} error - 错误对象
 * @param {object} extraInfo - 额外信息
 */
export function logError(context, error, extraInfo = {}) {
  const errorInfo = {
    context,
    timestamp: new Date().toISOString(),
    message: error?.message || String(error),
    stack: error?.stack,
    ...extraInfo,
  };

  // 使用增强的 console.error
  console.error(`[Error] ${context}:`, errorInfo);
}

/**
 * 详细的警告日志输出
 * @param {string} context - 警告发生的上下文
 * @param {string} message - 警告消息
 * @param {object} extraInfo - 额外信息
 */
export function logWarning(context, message, extraInfo = {}) {
  const warningInfo = {
    context,
    timestamp: new Date().toISOString(),
    message,
    ...extraInfo,
  };

  console.warn(`[Warning] ${context}:`, warningInfo);
}

/**
 * 详细的调试日志输出
 * @param {string} context - 调试信息的上下文
 * @param {string} message - 调试消息
 * @param {object} data - 相关数据
 */
export function logDebug(context, message, data = {}) {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  const debugInfo = {
    context,
    timestamp: new Date().toISOString(),
    message,
    data,
  };

  console.log(`[Debug] ${context}:`, debugInfo);
}

/**
 * 全局错误处理器
 */
export function setupGlobalErrorHandler() {
  // 捕获未处理的 Promise rejection
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Unhandled Promise Rejection]', {
      reason: event.reason,
      promise: event.promise,
      timestamp: new Date().toISOString(),
    });
  });

  // 捕获全局错误
  window.addEventListener('error', (event) => {
    console.error('[Global Error]', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error,
      timestamp: new Date().toISOString(),
    });
  });

  console.log('%c[Error Handler]', 'color: blue; font-weight: bold',
    'Global error handlers installed');
}

/**
 * Vue 应用错误处理器
 * @param {Object} app - Vue 应用实例
 */
export function setupVueErrorHandler(app) {
  app.config.errorHandler = (err, instance, info) => {
    console.error('[Vue Error]', {
      error: err,
      componentName: instance?.$options?.name || 'Unknown',
      info,
      timestamp: new Date().toISOString(),
    });
  };

  console.log('%c[Error Handler]', 'color: blue; font-weight: bold',
    'Vue error handler installed');
}
