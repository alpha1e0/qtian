/**
 * BashTool 安全验证 — 危险命令检测、路径范围检查
 *
 * 继承 ShellTool 的 DANGEROUS_PATTERNS 并扩展 bash 特有的危险模式。
 */

import * as path from 'path';

/**
 * 危险命令模式列表 — 前置拦截，防止破坏性操作
 *
 * 包含 ShellTool 的基础模式 + bash 环境下的扩展模式
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  // === 继承自 ShellTool ===
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

  // === bash 环境扩展 ===
  /\bcurl\b.*\|\s*\bsh\b/,                         // curl | sh (远程脚本执行)
  /\bwget\b.*\|\s*\bsh\b/,                         // wget | sh
  /\bcurl\b.*\|\s*\bbash\b/,                       // curl | bash
  /\bwget\b.*\|\s*\bbash\b/,                       // wget | bash
  /:\s*\(\)\s*\{.*\}\s*;\s*:/,                     // fork bomb ( :(){ :|:& };: )
  />\s*\/dev\/(sda|hda|nvme|sd[a-z])/i,           // 直接写入磁盘设备
  /\bmv\s+.*\s+\/dev\/null/,                       // mv to /dev/null
  /\bchattr\s+-i\b/,                               // 移除 immutable 属性
  />\s*\/etc\/(passwd|shadow|sudoers)/i,           // 覆写关键系统文件
  />\s*\/boot\//i,                                  // 覆写 boot 分区文件
];

/**
 * 检测命令中是否包含危险模式
 *
 * @param command - 待执行的命令字符串
 * @returns 危险原因描述，安全时返回 null
 */
export function validateCommandSafety(command: string): string | null {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return `Dangerous command detected (pattern: ${pattern.toString()}). Execution blocked for safety.`;
    }
  }
  return null;
}

/**
 * 检查工作目录是否在允许范围内
 *
 * Windows 下不区分大小写比较路径。
 *
 * @param resolvedCwd - 用户指定的解析后工作目录
 * @param allowedCwd - 允许的根目录，null 表示不限制
 * @returns 是否允许执行
 */
export function isCwdAllowed(resolvedCwd: string, allowedCwd: string | null): boolean {
  if (!allowedCwd) {
    return true;
  }

  const normalizedCwd = path.normalize(resolvedCwd);
  const normalizedAllowed = path.normalize(allowedCwd);

  // 完全匹配
  if (normalizedCwd === normalizedAllowed) {
    return true;
  }

  // 前缀匹配：必须以路径分隔符结尾，防止 /project 匹配 /project2
  const allowedPrefix = normalizedAllowed.endsWith(path.sep)
    ? normalizedAllowed
    : normalizedAllowed + path.sep;

  if (process.platform === 'win32') {
    return normalizedCwd.toLowerCase().startsWith(allowedPrefix.toLowerCase());
  }

  return normalizedCwd.startsWith(allowedPrefix);
}
