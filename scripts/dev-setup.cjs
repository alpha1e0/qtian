/**
 * Dev 环境初始化脚本
 *
 * 修复 Windows 终端中文乱码：将控制台代码页切换到 UTF-8 (65001)。
 * 必须在 electron-vite dev 之前执行，确保后续所有日志输出正确显示中文。
 */

if (process.platform === 'win32') {
  try {
    require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
  } catch {
    // 静默失败，不影响后续启动
  }
}
