/**
 * 启动日志 - 确保在 PowerShell 终端可见
 */

export function logStartup(): void {
  // 只在测试环境输出
  if (process.env.IS_TEST !== 'true') {
    return;
  }

  // 使用 console.error 确保输出到 stderr（不被缓冲）
  const prefix = '[MAIN]';
  console.error(``);
  console.error(`${prefix} =======================================`);
  console.error(`${prefix} Qtian 主进程启动`);
  console.error(`${prefix} NODE_ENV: ${process.env.NODE_ENV}`);
  console.error(`${prefix} IS_TEST: ${process.env.IS_TEST}`);
  console.error(`${prefix} =======================================`);
  console.error(``);
}

// 立即执行（模块加载时）
logStartup();
