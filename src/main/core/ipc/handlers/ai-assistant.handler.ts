import { ipcMain } from 'electron';
import { AiAgentMgrService } from '@/core/services/agent';
import { AiAgentService } from '@/core/services/agent';
import { AiMemoryService } from '@/core/services/agent';
import { AiSkillService } from '@/core/services/agent';
import { AiConfigService } from '@/core/services/common';
import { AiHistoryService } from '@/core/services/common';
import { AiChatHistory, AiChatMessage } from '@/core/common/config';
import { ShellTool, ReadTool } from '@/core/services/tools';
import { ITool } from '@/core/services/tools';
import { McpManager } from '@/core/services/tools';
import { IPC_CHANNELS } from '../channels';
import { createLogger } from '@/core/utils/logger';

const logger = createLogger('AiAssistantHandler');

// 存储活跃的对话会话 (agentId:historyId → ChatService)
const activeChats = new Map<string, AiAgentService>();

// 懒加载的服务实例
let agentService: AiAgentMgrService | null = null;
let configService: AiConfigService | null = null;
let historyService: AiHistoryService | null = null;
let skillService: AiSkillService | null = null;
let memoryService: AiMemoryService | null = null;
let mcpManager: McpManager | null = null;

/**
 * 生成对话会话 Key
 */
function getChatKey(agentId: string, historyId: string): string {
  return `${agentId}:${historyId}`;
}

/** 快捷模式使用临时 historyId（`__quick_` 前缀），不持久化历史 */
function isQuickModeHistory(historyId: string): boolean {
  return historyId.startsWith('__quick_');
}

/**
 * 获取或创建 Agent 服务
 */
function getAgentService(): AiAgentMgrService {
  if (!agentService) {
    agentService = new AiAgentMgrService();
  }
  return agentService;
}

/**
 * 获取或创建配置服务
 */
function getConfigService(): AiConfigService {
  if (!configService) {
    configService = new AiConfigService();
  }
  return configService;
}

/**
 * 获取或创建历史服务
 */
function getHistoryService(): AiHistoryService {
  if (!historyService) {
    historyService = new AiHistoryService();
  }
  return historyService;
}

/**
 * 获取或创建 Skill 服务
 */
function getSkillService(): AiSkillService {
  if (!skillService) {
    skillService = new AiSkillService();
  }
  return skillService;
}

/**
 * 获取或创建 Memory 服务
 */
function getMemoryService(): AiMemoryService {
  if (!memoryService) {
    memoryService = new AiMemoryService();
  }
  return memoryService;
}

/**
 * 获取或创建 MCP Manager
 */
function getMcpManager(): McpManager {
  if (!mcpManager) {
    mcpManager = new McpManager();
  }
  return mcpManager;
}

/** 默认对话标题 */
const DEFAULT_HISTORY_TITLE = '新对话';

/** 自动重命名标题最大长度 */
const AUTO_RENAME_TITLE_MAX_LENGTH = 10;

/**
 * 若对话标题为默认值（"新对话"），则用首条用户消息内容替换
 * @param historyData - 即将保存的对话历史数据
 */
function autoRenameIfDefault(historyData: AiChatHistory): void {
  if (historyData.title !== DEFAULT_HISTORY_TITLE) return;
  const firstUserMsg = historyData.messages.find((m) => m.role === 'user');
  if (!firstUserMsg) return;
  const content = firstUserMsg.content.trim();
  historyData.title = content.length > AUTO_RENAME_TITLE_MAX_LENGTH
    ? content.substring(0, AUTO_RENAME_TITLE_MAX_LENGTH) + '...'
    : content;
}

/**
 * 根据 Agent 的工具列表构建工具实例数组
 * @param toolNames - Agent 中配置的工具名称列表
 * @returns 工具实例数组
 */
function buildTools(toolNames: string[]): ITool[] {
  const tools: ITool[] = [];

  for (const name of toolNames) {
    switch (name) {
      case 'shell_execute':
        tools.push(new ShellTool());
        break;
      case 'file_read':
        tools.push(new ReadTool());
        break;
      default:
        logger.warn(`Unknown tool: ${name}, skipping`);
    }
  }

  return tools;
}

/**
 * 注册所有 AI 助手 IPC handlers
 */
export function registerAiAssistantHandlers(): void {
  // ========== Agent 管理 ==========

  ipcMain.handle(IPC_CHANNELS.AI_LIST_AGENTS, async () => {
    logger.debug('List AI agents');
    try {
      return await getAgentService().listAgents();
    } catch (err) {
      logger.error('Failed to list AI agents', err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_GET_AGENT, async (_event, name: string) => {
    logger.debug(`Get AI agent ${name}`);
    try {
      return await getAgentService().getAgent(name);
    } catch (err) {
      logger.error(`Failed to get AI agent ${name}`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_SAVE_AGENT, async (_event, name: string, agent: any) => {
    logger.info(`Save AI agent ${name}`);
    try {
      await getAgentService().saveAgent(name, agent);
      return { success: true };
    } catch (err) {
      logger.error(`Failed to save AI agent ${name}`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_DELETE_AGENT, async (_event, name: string) => {
    logger.info(`Delete AI agent ${name}`);
    try {
      await getAgentService().deleteAgent(name);
      return { success: true };
    } catch (err) {
      logger.error(`Failed to delete AI agent ${name}`, err);
      throw err;
    }
  });

  // ========== LLM 配置管理 ==========

  ipcMain.handle(IPC_CHANNELS.AI_LIST_LLM_CONFIGS, async () => {
    try {
      return await getConfigService().listConfigs();
    } catch (err) {
      logger.error('Failed to list AI LLM configs', err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_GET_LLM_CONFIG, async (_event, name: string) => {
    try {
      return await getConfigService().getConfig(name);
    } catch (err) {
      logger.error(`Failed to get AI LLM config ${name}`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_SAVE_LLM_CONFIG, async (_event, name: string, data: any) => {
    logger.info(`Save AI LLM config ${name}`);
    try {
      await getConfigService().saveConfig(name, data);
      return { success: true };
    } catch (err) {
      logger.error(`Failed to save AI LLM config ${name}`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_DELETE_LLM_CONFIG, async (_event, name: string) => {
    logger.info(`Delete AI LLM config ${name}`);
    try {
      await getConfigService().deleteConfig(name);
      return { success: true };
    } catch (err) {
      logger.error(`Failed to delete AI LLM config ${name}`, err);
      throw err;
    }
  });

  // ========== 对话历史管理 ==========

  ipcMain.handle(IPC_CHANNELS.AI_LIST_HISTORIES, async (_event, agentId: string) => {
    try {
      return await getHistoryService().listHistories(agentId);
    } catch (err) {
      logger.error(`Failed to list histories for ${agentId}`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_LIST_HISTORY_SUMMARIES, async (_event, agentId: string) => {
    try {
      return await getHistoryService().listHistorySummaries(agentId);
    } catch (err) {
      logger.error(`Failed to list history summaries for ${agentId}`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_GET_HISTORY, async (_event, agentId: string, historyId: string) => {
    try {
      return await getHistoryService().getHistory(agentId, historyId);
    } catch (err) {
      logger.error(`Failed to get history ${historyId}`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_CREATE_HISTORY, async (_event, agentId: string, historyId: string, data: any) => {
    logger.info(`Create AI history ${historyId}`);
    try {
      await getHistoryService().createHistory(agentId, historyId, data);
      return { success: true };
    } catch (err) {
      logger.error(`Failed to create AI history ${historyId}`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_SAVE_HISTORY, async (_event, agentId: string, historyId: string, data: any) => {
    try {
      await getHistoryService().saveHistory(agentId, historyId, data);
      return { success: true };
    } catch (err) {
      logger.error(`Failed to save AI history ${historyId}`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_DELETE_HISTORY, async (_event, agentId: string, historyId: string) => {
    logger.info(`Delete AI history ${historyId}`);
    try {
      await getHistoryService().deleteHistory(agentId, historyId);
      return { success: true };
    } catch (err) {
      logger.error(`Failed to delete AI history ${historyId}`, err);
      throw err;
    }
  });

  // ========== 对话会话管理 ==========

  /**
   * 初始化对话会话
   * 加载 Agent、LLM 配置、Skills、Memory，创建 ChatService 实例
   * Agent 模式下还会根据 Agent 配置的工具列表构建工具实例
   */
  ipcMain.handle(
    IPC_CHANNELS.AI_INIT_CHAT,
    async (_event, agentId: string, historyId: string, configName?: string) => {
      try {
        // 获取 Agent
        const agent = await getAgentService().getAgent(agentId);

        // 获取 LLM 配置
        const llmConfig = configName
          ? await getConfigService().getConfig(configName)
          : await getConfigService().getDefaultConfig();

        // 构建工具列表 (内置工具 + MCP 工具)
        const builtInTools = agent.tools.length > 0
          ? buildTools(agent.tools)
          : [];

        // 加载 MCP 工具
        let mcpTools: ITool[] = [];
        try {
          await getMcpManager().loadFromConfig();
          mcpTools = getMcpManager().getAllTools();
          if (mcpTools.length > 0) {
            logger.info(`MCP tools loaded: ${mcpTools.length}`);
          }
        } catch (err) {
          logger.error('Failed to load MCP tools', err);
        }

        const tools = [...builtInTools, ...mcpTools];

        // 加载 Agent 引用的 Skills
        const skills: any[] = [];
        if (agent.skills && agent.skills.length > 0) {
          for (const skillDirName of agent.skills) {
            try {
              const skill = await getSkillService().getSkill(skillDirName);
              skills.push(skill);
            } catch {
              logger.warn(`Skill '${skillDirName}' not found, skipping`);
            }
          }
        }

        // 构建记忆文本 (Agent 记忆 + 全局记忆)
        const memoryPrompt = await getMemoryService().buildMemoryPrompt(agentId);

        // 创建对话服务
        const chatService = new AiAgentService(llmConfig, agent, {
          tools,
          skills,
          memoryPrompt,
        });

        // 加载历史 (如果存在)
        const historyExists = await getHistoryService().historyExists(agentId, historyId);
        if (historyExists) {
          const history = await getHistoryService().getHistory(agentId, historyId);
          chatService.loadHistory(history);
        }

        // 存储会话
        const key = getChatKey(agentId, historyId);
        activeChats.set(key, chatService);

        return {
          success: true,
        };
      } catch (err) {
        logger.error('Failed to initialize AI chat', err);
        throw err;
      }
    }
  );

  /**
   * 发送对话消息 (事件流推送)
   *
   * 事件类型:
   * - text_delta: 文本片段 (逐 chunk 流式)
   * - tool_start: 工具调用开始
   * - tool_result: 工具调用结果
   * - done: 对话完成
   * - error: 错误
   */
  ipcMain.handle(
    IPC_CHANNELS.AI_CHAT_MESSAGE,
    async (event, agentId: string, historyId: string, message: string) => {
      logger.info(`AI chat message: ${agentId}/${historyId}`);
      try {
        const key = getChatKey(agentId, historyId);
        const chatService = activeChats.get(key);

        if (!chatService) {
          throw new Error('Chat session not initialized');
        }

        // 收集最后一条 done 事件的消息，延迟发送 chat-complete（先保存再通知前端）
        let doneMessages: AiChatMessage[] | null = null;

        // 消费 AiChatEvent 事件流
        for await (const chatEvent of chatService.sendMessage(message)) {
          switch (chatEvent.type) {
            case 'text_delta':
              event.sender.send(IPC_CHANNELS.AI_CHAT_CHUNK, { chunk: chatEvent.content });
              break;
            case 'tool_start':
              event.sender.send(IPC_CHANNELS.AI_TOOL_START, {
                toolCallId: chatEvent.toolCallId,
                name: chatEvent.name,
                arguments: chatEvent.arguments,
              });
              break;
            case 'tool_result':
              event.sender.send(IPC_CHANNELS.AI_TOOL_RESULT, {
                toolCallId: chatEvent.toolCallId,
                result: chatEvent.result,
                isError: chatEvent.isError,
              });
              break;
            case 'done':
              doneMessages = chatEvent.messages;
              break;
            case 'error':
              event.sender.send(IPC_CHANNELS.AI_CHAT_ERROR, { error: chatEvent.message });
              break;
          }
        }

        // 先保存历史（含自动重命名），再通知前端（快捷模式不持久化）
        const historyData = chatService.getHistoryData(agentId, historyId);
        if (!isQuickModeHistory(historyId)) {
          autoRenameIfDefault(historyData);
          await getHistoryService().saveHistory(agentId, historyId, historyData);
        }

        // 保存完成后再发送 chat-complete，确保前端刷新时能读到最新标题
        if (doneMessages) {
          event.sender.send(IPC_CHANNELS.AI_CHAT_COMPLETE, {
            messages: doneMessages,
          });
        }

        return { success: true };
      } catch (err) {
        logger.error('AI chat failed', err);
        event.sender.send(IPC_CHANNELS.AI_CHAT_ERROR, { error: (err as Error).message });
        throw err;
      }
    }
  );

  /**
   * 停止当前对话
   */
  ipcMain.handle(IPC_CHANNELS.AI_STOP_CHAT, async (_event, agentId: string, historyId: string) => {
    try {
      const key = getChatKey(agentId, historyId);
      const chatService = activeChats.get(key);
      if (chatService) {
        chatService.abort();
      }
      return { success: true };
    } catch (err) {
      logger.error('Failed to stop AI chat', err);
      throw err;
    }
  });

  /**
   * 重新生成最后一条回复
   */
  ipcMain.handle(IPC_CHANNELS.AI_REGENERATE, async (event, agentId: string, historyId: string) => {
    logger.info(`AI regenerate: ${agentId}/${historyId}`);
    try {
      const key = getChatKey(agentId, historyId);
      const chatService = activeChats.get(key);

      if (!chatService) {
        throw new Error('Chat session not initialized');
      }

      // 收集最后一条 done 事件的消息，延迟发送 chat-complete
      let doneMessages: AiChatMessage[] | null = null;

      // 消费 AiChatEvent 事件流
      for await (const chatEvent of chatService.regenerate()) {
        switch (chatEvent.type) {
          case 'text_delta':
            event.sender.send(IPC_CHANNELS.AI_CHAT_CHUNK, { chunk: chatEvent.content });
            break;
          case 'tool_start':
            event.sender.send(IPC_CHANNELS.AI_TOOL_START, {
              toolCallId: chatEvent.toolCallId,
              name: chatEvent.name,
              arguments: chatEvent.arguments,
            });
            break;
          case 'tool_result':
            event.sender.send(IPC_CHANNELS.AI_TOOL_RESULT, {
              toolCallId: chatEvent.toolCallId,
              result: chatEvent.result,
              isError: chatEvent.isError,
            });
            break;
          case 'done':
            doneMessages = chatEvent.messages;
            break;
          case 'error':
            event.sender.send(IPC_CHANNELS.AI_CHAT_ERROR, { error: chatEvent.message });
            break;
        }
      }

      // 先保存历史（含自动重命名），再通知前端（快捷模式不持久化）
      const historyData = chatService.getHistoryData(agentId, historyId);
      if (!isQuickModeHistory(historyId)) {
        autoRenameIfDefault(historyData);
        await getHistoryService().saveHistory(agentId, historyId, historyData);
      }

      if (doneMessages) {
        event.sender.send(IPC_CHANNELS.AI_CHAT_COMPLETE, {
          messages: doneMessages,
        });
      }

      return { success: true };
    } catch (err) {
      logger.error('AI regenerate failed', err);
      event.sender.send(IPC_CHANNELS.AI_CHAT_ERROR, { error: (err as Error).message });
      throw err;
    }
  });

  /**
   * 回退最后一条消息
   */
  ipcMain.handle(IPC_CHANNELS.AI_POP_MESSAGE, async (_event, agentId: string, historyId: string) => {
    try {
      const key = getChatKey(agentId, historyId);
      const chatService = activeChats.get(key);

      if (!chatService) {
        throw new Error('Chat session not initialized');
      }

      const popped = chatService.popMessage();

      // 自动保存（快捷模式不持久化）
      if (popped && !isQuickModeHistory(historyId)) {
        const historyData = chatService.getHistoryData(agentId, historyId);
        await getHistoryService().saveHistory(agentId, historyId, historyData);
      }

      return { success: true, popped };
    } catch (err) {
      logger.error('AI pop message failed', err);
      throw err;
    }
  });

  /**
   * 获取当前消息列表
   */
  ipcMain.handle(IPC_CHANNELS.AI_GET_MESSAGES, async (_event, agentId: string, historyId: string) => {
    try {
      const key = getChatKey(agentId, historyId);
      const chatService = activeChats.get(key);

      if (!chatService) {
        throw new Error('Chat session not initialized');
      }

      return chatService.getMessages();
    } catch (err) {
      logger.error('Failed to get AI messages', err);
      throw err;
    }
  });

  // ========== Skill 管理 ==========

  ipcMain.handle(IPC_CHANNELS.AI_LIST_SKILLS, async () => {
    try {
      return await getSkillService().listSkills();
    } catch (err) {
      logger.error('Failed to list AI skills', err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_GET_SKILL, async (_event, dirName: string) => {
    try {
      return await getSkillService().getSkill(dirName);
    } catch (err) {
      logger.error(`Failed to get AI skill '${dirName}'`, err);
      throw err;
    }
  });

  // ========== Memory 管理 ==========

  ipcMain.handle(IPC_CHANNELS.AI_LIST_MEMORIES, async (_event, agentId?: string) => {
    try {
      return await getMemoryService().listMemories(agentId);
    } catch (err) {
      logger.error('Failed to list AI memories', err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_ADD_MEMORY, async (_event, data: any) => {
    logger.info('Add AI memory');
    try {
      return await getMemoryService().addMemory(data);
    } catch (err) {
      logger.error('Failed to add AI memory', err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_DELETE_MEMORY, async (_event, id: string, agentId?: string) => {
    logger.info(`Delete AI memory ${id}`);
    try {
      return { success: await getMemoryService().deleteMemory(id, agentId) };
    } catch (err) {
      logger.error(`Failed to delete AI memory ${id}`, err);
      throw err;
    }
  });

  // ========== MCP 管理 ==========

  ipcMain.handle(IPC_CHANNELS.MCP_GET_STATUSES, async () => {
    try {
      return getMcpManager().getStatuses();
    } catch (err) {
      logger.error('Failed to get MCP statuses', err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.MCP_LIST_CONFIGS, async () => {
    try {
      return await getMcpManager().getConfigService().listServers();
    } catch (err) {
      logger.error('Failed to list MCP configs', err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.MCP_SAVE_CONFIG, async (_event, server: any) => {
    logger.info('Save MCP server config');
    try {
      await getMcpManager().getConfigService().saveServer(server);
      return { success: true };
    } catch (err) {
      logger.error('Failed to save MCP config', err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.MCP_DELETE_CONFIG, async (_event, name: string) => {
    logger.info(`Delete MCP server config: ${name}`);
    try {
      const deleted = await getMcpManager().getConfigService().deleteServer(name);
      return { success: true, deleted };
    } catch (err) {
      logger.error(`Failed to delete MCP server '${name}'`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.MCP_RELOAD, async () => {
    logger.info('MCP reload requested');
    try {
      await getMcpManager().reload();
      return { success: true };
    } catch (err) {
      logger.error('Failed to reload MCP', err);
      throw err;
    }
  });

  logger.info('AI Assistant IPC handlers registered');
}
