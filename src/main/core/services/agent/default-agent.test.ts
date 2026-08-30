/**
 * 默认 Agent 创建单测
 *
 * 直接操作真实临时文件（不依赖全局 context mock），
 * 验证：创建 / 幂等跳过 / 不覆盖用户修改 / 原子写无残留 / 可被解析为合法 Agent。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { createDefaultAgentFile, DEFAULT_AGENT_MD, DEFAULT_AGENT_FILE_NAME } from './default-agent';
import { AiAgentMgrService } from './ai-agent-mgr.service';
import * as context from '@/core/common/context';

vi.mock('@/core/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe('createDefaultAgentFile', () => {
  let tmpDir: string;
  let service: AiAgentMgrService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtian-default-agent-'));
    service = new AiAgentMgrService();
    // 与 ai-agent-mgr.service.test.ts 相同的方式，将 Agent 目录指向临时目录
    vi.spyOn(context.wpath, 'assistantAgentDir', 'get').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('文件不存在时创建默认 Agent，返回 true', () => {
    const isCreated = createDefaultAgentFile(tmpDir);

    expect(isCreated).toBe(true);
    const agentPath = path.join(tmpDir, DEFAULT_AGENT_FILE_NAME);
    expect(fs.existsSync(agentPath)).toBe(true);
    expect(fs.readFileSync(agentPath, 'utf-8')).toBe(DEFAULT_AGENT_MD);
  });

  it('文件已存在时不覆盖（保护用户修改），返回 false', () => {
    const agentPath = path.join(tmpDir, DEFAULT_AGENT_FILE_NAME);
    const userContent = '---\nname: default\ndescription: 用户自定义\n---\n\n我的定制内容';
    fs.writeFileSync(agentPath, userContent, 'utf-8');

    const isCreated = createDefaultAgentFile(tmpDir);

    expect(isCreated).toBe(false);
    expect(fs.readFileSync(agentPath, 'utf-8')).toBe(userContent);
  });

  it('幂等：重复调用不报错，内容保持一致', () => {
    expect(createDefaultAgentFile(tmpDir)).toBe(true);
    expect(createDefaultAgentFile(tmpDir)).toBe(false);
    expect(createDefaultAgentFile(tmpDir)).toBe(false);

    const agentPath = path.join(tmpDir, DEFAULT_AGENT_FILE_NAME);
    expect(fs.readFileSync(agentPath, 'utf-8')).toBe(DEFAULT_AGENT_MD);
  });

  it('原子写入：目录中不残留 .tmp 文件', () => {
    createDefaultAgentFile(tmpDir);

    const files = fs.readdirSync(tmpDir);
    expect(files).toEqual([DEFAULT_AGENT_FILE_NAME]);
  });

  it('创建的文件可被 AiAgentMgrService 解析为合法 Agent（首次启动对话可用）', async () => {
    createDefaultAgentFile(tmpDir);

    const agent = await service.getAgent('default');
    expect(agent.name).toBe('default');
    expect(agent.alias).toBe('个人AI助理');
    expect(agent.description).toBe('个人综合工作助理，擅长知识问答等场景');
    expect(agent.instructions).toContain('你是一名个人AI助手');
  });

  it('创建后 listAgents 包含 default', async () => {
    createDefaultAgentFile(tmpDir);

    const agents = await service.listAgents();
    expect(agents).toEqual(['default']);
  });
});
