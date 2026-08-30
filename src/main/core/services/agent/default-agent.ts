import * as fs from 'fs';
import * as path from 'path';

import { createLogger } from '@/core/utils/logger';

const logger = createLogger('DefaultAgent');

/** 默认 Agent 文件名（与 qtian.json 的 default_llm_config/default_agent 配置值对应） */
export const DEFAULT_AGENT_FILE_NAME = 'default.md';

/** 临时文件后缀，配合 fs.rename 实现原子写入 */
const TMP_SUFFIX = '.tmp';

/**
 * 默认 Agent 文件内容（assistant/agent/default.md）
 *
 * 必须满足 AiAgentMgrService.parseAgentMd 的解析要求：
 * front-matter 必含 name、description 字段。
 */
export const DEFAULT_AGENT_MD = `---
name: default
alias: 个人AI助理
description: 个人综合工作助理，擅长知识问答等场景
---

## Role

你是一名个人AI助手
`;

/**
 * 首次启动时创建默认 Agent 文件。
 *
 * 与 `createDefaultConfigFile()` 行为一致：
 * - 文件已存在：不覆盖，仅记录 info 日志（保护用户已有修改）
 * - 文件不存在：基于 {@link DEFAULT_AGENT_MD} 原子写入（`.tmp` + `fs.rename`），
 *   保证中途崩溃不会留下半写的 Agent 文件
 *
 * 前置条件：父目录（assistant/agent）必须已存在（由 `WPath` 构造函数保证）。
 *
 * @param agentDir - Agent 目录完整路径（wpath.assistantAgentDir）
 * @returns `true` 表示创建了文件；`false` 表示文件已存在未创建
 */
export function createDefaultAgentFile(agentDir: string): boolean {
  const agentPath = path.join(agentDir, DEFAULT_AGENT_FILE_NAME);

  // 防御式：文件已存在则不覆盖，避免破坏用户已有 Agent 定义
  if (fs.existsSync(agentPath)) {
    logger.info(`Default agent already exists at '${agentPath}', skip creating`);
    return false;
  }

  // 原子写：先写 .tmp，再 rename，避免崩溃留下半写文件
  const tmpPath = agentPath + TMP_SUFFIX;
  fs.writeFileSync(tmpPath, DEFAULT_AGENT_MD, 'utf-8');
  fs.renameSync(tmpPath, agentPath);

  logger.info(`Default agent created at '${agentPath}'`);
  return true;
}
