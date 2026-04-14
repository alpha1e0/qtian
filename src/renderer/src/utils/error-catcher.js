/**
 * 异常捕获辅助函数
 *
 * 在 Vue 组件的 catch 块中使用，提供统一的详细错误日志输出
 */

/**
 * 捕获并记录异常
 * @param {string} context - 异常发生的上下文（例如：组件名、方法名）
 * @param {Error|any} error - 错误对象
 * @param {object} extraInfo - 额外信息
 * @param {boolean} showMessage - 是否显示错误消息给用户（默认 true）
 */
export function catchError(context, error, extraInfo = {}, showMessage = true) {
  const errorDetails = {
    context,
    timestamp: new Date().toISOString(),
    message: error?.message || String(error),
    stack: error?.stack,
    ...extraInfo,
  };

  // 详细的错误日志输出
  console.error(`[Catch Error] ${context}:`, errorDetails);

  // 可选：显示用户友好的错误消息
  if (showMessage && typeof ElMessage !== 'undefined') {
    ElMessage.error({
      message: `${context}: ${errorDetails.message}`,
      duration: 5000,
      showClose: true,
    });
  }
}

/**
 * Promise catch 包装器
 * 自动添加详细的错误日志
 * @param {string} context - 异常上下文
 * @param {boolean} showMessage - 是否显示错误消息
 * @returns {Function} catch 回调函数
 */
export function createCatcher(context, showMessage = true) {
  return (error) => {
    catchError(context, error, {}, showMessage);
  };
}

/**
 * 异步操作包装器
 * 捕获异步函数中的异常并记录
 * @param {string} context - 异常上下文
 * @param {Function} fn - 异步函数
 * @param {boolean} showMessage - 是否显示错误消息
 * @returns {Function} 包装后的函数
 */
export function withErrorLogging(context, fn, showMessage = true) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      catchError(context, error, { args }, showMessage);
      throw error; // 重新抛出，让调用者处理
    }
  };
}

/**
 * Vue 方法的错误日志装饰器
 * @param {string} context - 异常上下文
 * @returns {Function} 装饰器函数
 */
export function logErrors(context) {
  return function (target, key, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args) {
      try {
        return await originalMethod.apply(this, args);
      } catch (error) {
        catchError(
          `${context}.${key}`,
          error,
          { component: target.$options?.name },
          false // 不显示消息，让组件自己处理
        );
        throw error;
      }
    };

    return descriptor;
  };
}
