import { ipcMain } from 'electron';
import { AiScenarioService } from '@/core/services/ai-assistant/ai-scenario.service';
import { AiRoleService } from '@/core/services/ai-assistant/ai-role.service';
import { AiConfigService } from '@/core/services/ai-assistant/ai-config.service';
import { AiHistoryService } from '@/core/services/ai-assistant/ai-history.service';
import { AiSkillService } from '@/core/services/ai-assistant/ai-skill.service';
import { AiMemoryService } from '@/core/services/ai-assistant/ai-memory.service';
import { AiChatService } from '@/core/services/ai-assistant/ai-chat.service';
import { ShellTool } from '@/core/services/ai-assistant/tools/shell-tool';
import { ITool } from '@/core/services/ai-assistant/tools';
import { McpManager } from '@/core/services/ai-assistant/mcp';
import { IPC_CHANNELS } from '../channels';
import { createLogger } from '@/core/utils/logger';

const logger = createLogger('AiAssistantHandler');

// 存储活跃的对话会话 (scenarioId:historyId → ChatService)
const activeChats = new Map<string, AiChatService>();

// 懒加载的服务实例
let scenarioService: AiScenarioService | null = null;
let roleService: AiRoleService | null = null;
let configService: AiConfigService | null = null;
let historyService: AiHistoryService | null = null;
let skillService: AiSkillService | null = null;
let memoryService: AiMemoryService | null = null;
let mcpManager: McpManager | null = null;

/**
 * 生成对话会话 Key
 */
function getChatKey(scenarioId: string, historyId: string): string {
  return `${scenarioId}:${historyId}`;
}

/**
 * 获取或创建场景服务
 */
function getScenarioService(): AiScenarioService {
  if (!scenarioService) {
    scenarioService = new AiScenarioService();
  }
  return scenarioService;
}

/**
 * 获取或创建角色服务
 */
function getRoleService(): AiRoleService {
  if (!roleService) {
    roleService = new AiRoleService();
  }
  return roleService;
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

/**
 * 根据场景的工具列表构建工具实例数组
 * @param toolNames - 场景中配置的工具名称列表
 * @returns 工具实例数组
 */
function buildTools(toolNames: string[]): ITool[] {
  const tools: ITool[] = [];

  for (const name of toolNames) {
    switch (name) {
      case 'shell_execute':
        tools.push(new ShellTool());
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
  // ========== 场景管理 ==========

  ipcMain.handle(IPC_CHANNELS.AI_LIST_SCENARIOS, async () => {
    logger.debug('List AI scenarios');
    try {
      return await getScenarioService().listScenarios();
    } catch (err) {
      logger.error('Failed to list AI scenarios', err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_GET_SCENARIO, async (_event, id: string) => {
    logger.debug(`Get AI scenario ${id}`);
    try {
      return await getScenarioService().getScenario(id);
    } catch (err) {
      logger.error(`Failed to get AI scenario ${id}`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_CREATE_SCENARIO, async (_event, id: string, data: any) => {
    logger.info(`Create AI scenario ${id}`);
    try {
      await getScenarioService().createScenario(id, data);
      return { success: true };
    } catch (err) {
      logger.error(`Failed to create AI scenario ${id}`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_UPDATE_SCENARIO, async (_event, id: string, data: any) => {
    logger.info(`Update AI scenario ${id}`);
    try {
      await getScenarioService().updateScenario(id, data);
      return { success: true };
    } catch (err) {
      logger.error(`Failed to update AI scenario ${id}`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_DELETE_SCENARIO, async (_event, id: string) => {
    logger.info(`Delete AI scenario ${id}`);
    try {
      await getScenarioService().deleteScenario(id);
      return { success: true };
    } catch (err) {
      logger.error(`Failed to delete AI scenario ${id}`, err);
      throw err;
    }
  });

  // ========== 角色管理 ==========

  ipcMain.handle(IPC_CHANNELS.AI_LIST_ROLES, async () => {
    try {
      return await getRoleService().listRoles();
    } catch (err) {
      logger.error('Failed to list AI roles', err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_GET_ROLE, async (_event, name: string) => {
    try {
      return await getRoleService().getRole(name);
    } catch (err) {
      logger.error(`Failed to get AI role ${name}`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_SAVE_ROLE, async (_event, name: string, content: string) => {
    logger.info(`Save AI role ${name}`);
    try {
      await getRoleService().saveRole(name, content);
      return { success: true };
    } catch (err) {
      logger.error(`Failed to save AI role ${name}`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_DELETE_ROLE, async (_event, name: string) => {
    logger.info(`Delete AI role ${name}`);
    try {
      await getRoleService().deleteRole(name);
      return { success: true };
    } catch (err) {
      logger.error(`Failed to delete AI role ${name}`, err);
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

  ipcMain.handle(IPC_CHANNELS.AI_LIST_HISTORIES, async (_event, scenarioId: string) => {
    try {
      return await getHistoryService().listHistories(scenarioId);
    } catch (err) {
      logger.error(`Failed to list histories for ${scenarioId}`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_GET_HISTORY, async (_event, scenarioId: string, historyId: string) => {
    try {
      return await getHistoryService().getHistory(scenarioId, historyId);
    } catch (err) {
      logger.error(`Failed to get history ${historyId}`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_CREATE_HISTORY, async (_event, scenarioId: string, historyId: string, data: any) => {
    logger.info(`Create AI history ${historyId}`);
    try {
      await getHistoryService().createHistory(scenarioId, historyId, data);
      return { success: true };
    } catch (err) {
      logger.error(`Failed to create AI history ${historyId}`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_SAVE_HISTORY, async (_event, scenarioId: string, historyId: string, data: any) => {
    try {
      await getHistoryService().saveHistory(scenarioId, historyId, data);
      return { success: true };
    } catch (err) {
      logger.error(`Failed to save AI history ${historyId}`, err);
      throw err;
    }
  });

  ipcMain.handle(IPC_CHANNELS.AI_DELETE_HISTORY, async (_event, scenarioId: string, historyId: string) => {
    logger.info(`Delete AI history ${historyId}`);
    try {
      await getHistoryService().deleteHistory(scenarioId, historyId);
      return { success: true };
    } catch (err) {
      logger.error(`Failed to delete AI history ${historyId}`, err);
      throw err;
    }
  });

  // ========== 对话会话管理 ==========

  /**
   * 初始化对话会话
   * 加载场景、角色、LLM 配置、Skills、Memory，创建 ChatService 实例
   * Agent 模式下还会根据场景配置的工具列表构建工具实例
   */
  ipcMain.handle(
    IPC_CHANNELS.AI_INIT_CHAT,
    async (_event, scenarioId: string, historyId: string, configName?: string) => {
      try {
        // 获取场景
        const scenario = await getScenarioService().getScenario(scenarioId);

        // 获取 LLM 配置
        const llmConfig = configName
          ? await getConfigService().getConfig(configName)
          : await getConfigService().getDefaultConfig();

        // 获取角色内容
        let roleContent = '';
        try {
          const role = await getRoleService().getRole(scenario.role_id);
          roleContent = role.content;
        } catch {
          logger.warn(`Role '${scenario.role_id}' not found, using empty role`);
        }

        // 构建工具列表 (内置工具 + MCP 工具)
        const builtInTools = scenario.is_agent && scenario.tools.length > 0
          ? buildTools(scenario.tools)
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

        // 加载场景引用的 Skills
        const skills: any[] = [];
        if (scenario.skills.length > 0) {
          for (const skillDirName of scenario.skills) {
            try {
              const skill = await getSkillService().getSkill(skillDirName);
              skills.push(skill);
            } catch {
              logger.warn(`Skill '${skillDirName}' not found, skipping`);
            }
          }
        }

        // 构建记忆文本 (场景记忆 + 全局记忆)
        const memoryPrompt = await getMemoryService().buildMemoryPrompt(scenarioId);

        // 创建对话服务
        const chatService = new AiChatService(llmConfig, scenario, roleContent, {
          tools,
          skills,
          memoryPrompt,
        });

        // 加载历史 (如果存在)
        const historyExists = await getHistoryService().historyExists(scenarioId, historyId);
        if (historyExists) {
          const history = await getHistoryService().getHistory(scenarioId, historyId);
          chatService.loadHistory(history.messages);
        }

        // 存储会话
        const key = getChatKey(scenarioId, historyId);
        activeChats.set(key, chatService);

        return {
          success: true,
          isAgent: chatService.getIsAgent(),
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
   * - text_delta: 文本片段 (兼容 Simple Runner 和 Agent 模式)
   * - tool_start: 工具调用开始 (Agent 模式)
   * - tool_result: 工具调用结果 (Agent 模式)
   * - done: 对话完成
   * - error: 错误
   */
  ipcMain.handle(
    IPC_CHANNELS.AI_CHAT_MESSAGE,
    async (event, scenarioId: string, historyId: string, message: string) => {
      logger.info(`AI chat message: ${scenarioId}/${historyId}`);
      try {
        const key = getChatKey(scenarioId, historyId);
        const chatService = activeChats.get(key);

        if (!chatService) {
          throw new Error('Chat session not initialized');
        }

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
              event.sender.send(IPC_CHANNELS.AI_CHAT_COMPLETE, {
                messages: chatEvent.messages,
              });
              break;
            case 'error':
              event.sender.send(IPC_CHANNELS.AI_CHAT_ERROR, { error: chatEvent.message });
              break;
          }
        }

        // 自动保存历史
        const historyData = chatService.getHistoryData(scenarioId, historyId);
        await getHistoryService().saveHistory(scenarioId, historyId, historyData);

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
  ipcMain.handle(IPC_CHANNELS.AI_STOP_CHAT, async (_event, scenarioId: string, historyId: string) => {
    try {
      const key = getChatKey(scenarioId, historyId);
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
  ipcMain.handle(IPC_CHANNELS.AI_REGENERATE, async (event, scenarioId: string, historyId: string) => {
    logger.info(`AI regenerate: ${scenarioId}/${historyId}`);
    try {
      const key = getChatKey(scenarioId, historyId);
      const chatService = activeChats.get(key);

      if (!chatService) {
        throw new Error('Chat session not initialized');
      }

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
            event.sender.send(IPC_CHANNELS.AI_CHAT_COMPLETE, {
              messages: chatEvent.messages,
            });
            break;
          case 'error':
            event.sender.send(IPC_CHANNELS.AI_CHAT_ERROR, { error: chatEvent.message });
            break;
        }
      }

      // 自动保存历史
      const historyData = chatService.getHistoryData(scenarioId, historyId);
      await getHistoryService().saveHistory(scenarioId, historyId, historyData);

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
  ipcMain.handle(IPC_CHANNELS.AI_POP_MESSAGE, async (_event, scenarioId: string, historyId: string) => {
    try {
      const key = getChatKey(scenarioId, historyId);
      const chatService = activeChats.get(key);

      if (!chatService) {
        throw new Error('Chat session not initialized');
      }

      const popped = chatService.popMessage();

      // 自动保存
      if (popped) {
        const historyData = chatService.getHistoryData(scenarioId, historyId);
        await getHistoryService().saveHistory(scenarioId, historyId, historyData);
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
  ipcMain.handle(IPC_CHANNELS.AI_GET_MESSAGES, async (_event, scenarioId: string, historyId: string) => {
    try {
      const key = getChatKey(scenarioId, historyId);
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

  ipcMain.handle(IPC_CHANNELS.AI_LIST_MEMORIES, async (_event, scenarioId?: string) => {
    try {
      return await getMemoryService().listMemories(scenarioId);
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

  ipcMain.handle(IPC_CHANNELS.AI_DELETE_MEMORY, async (_event, id: string, scenarioId?: string) => {
    logger.info(`Delete AI memory ${id}`);
    try {
      return { success: await getMemoryService().deleteMemory(id, scenarioId) };
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
