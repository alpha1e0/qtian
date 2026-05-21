import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc-channels';

/**
 * API exposed to renderer process
 */

/**
 * Event listener storage for cleanup
 */
const listeners = new Map();

/**
 * Create the API object
 */
const api = {
  // Common APIs
  getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.GET_VERSION),
  getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CONFIG),
  readConfig: () => ipcRenderer.invoke(IPC_CHANNELS.READ_CONFIG),

  // Console message forwarding (dev mode only)
  sendConsoleMessage: (level, message) => {
    // 只在开发环境下转发
    if (process.env.NODE_ENV === 'development') {
      ipcRenderer.send(IPC_CHANNELS.SEND_CONSOLE_MESSAGE, { level, message });
    }
  },

  // AI Assistant APIs
  ai: {
    // Agent 管理
    listAgents: () => ipcRenderer.invoke(IPC_CHANNELS.AI_LIST_AGENTS),
    getAgent: (name) => ipcRenderer.invoke(IPC_CHANNELS.AI_GET_AGENT, name),
    saveAgent: (name, agent) => ipcRenderer.invoke(IPC_CHANNELS.AI_SAVE_AGENT, name, agent),
    deleteAgent: (name) => ipcRenderer.invoke(IPC_CHANNELS.AI_DELETE_AGENT, name),

    // LLM 配置管理
    listLlmConfigs: () => ipcRenderer.invoke(IPC_CHANNELS.AI_LIST_LLM_CONFIGS),
    getLlmConfig: (name) => ipcRenderer.invoke(IPC_CHANNELS.AI_GET_LLM_CONFIG, name),
    saveLlmConfig: (name, data) => ipcRenderer.invoke(IPC_CHANNELS.AI_SAVE_LLM_CONFIG, name, data),
    deleteLlmConfig: (name) => ipcRenderer.invoke(IPC_CHANNELS.AI_DELETE_LLM_CONFIG, name),

    // 对话历史管理
    listHistories: (scenarioId) => ipcRenderer.invoke(IPC_CHANNELS.AI_LIST_HISTORIES, scenarioId),
    listHistorySummaries: (scenarioId) => ipcRenderer.invoke(IPC_CHANNELS.AI_LIST_HISTORY_SUMMARIES, scenarioId),
    getHistory: (scenarioId, historyId) => ipcRenderer.invoke(IPC_CHANNELS.AI_GET_HISTORY, scenarioId, historyId),
    createHistory: (scenarioId, historyId, data) => ipcRenderer.invoke(IPC_CHANNELS.AI_CREATE_HISTORY, scenarioId, historyId, data),
    saveHistory: (scenarioId, historyId, data) => ipcRenderer.invoke(IPC_CHANNELS.AI_SAVE_HISTORY, scenarioId, historyId, data),
    deleteHistory: (scenarioId, historyId) => ipcRenderer.invoke(IPC_CHANNELS.AI_DELETE_HISTORY, scenarioId, historyId),

    // 对话会话
    initChat: (scenarioId, historyId, configName) => ipcRenderer.invoke(IPC_CHANNELS.AI_INIT_CHAT, scenarioId, historyId, configName),
    chatMessage: (scenarioId, historyId, message) => ipcRenderer.invoke(IPC_CHANNELS.AI_CHAT_MESSAGE, scenarioId, historyId, message),
    stopChat: (scenarioId, historyId) => ipcRenderer.invoke(IPC_CHANNELS.AI_STOP_CHAT, scenarioId, historyId),
    regenerate: (scenarioId, historyId) => ipcRenderer.invoke(IPC_CHANNELS.AI_REGENERATE, scenarioId, historyId),
    popMessage: (scenarioId, historyId) => ipcRenderer.invoke(IPC_CHANNELS.AI_POP_MESSAGE, scenarioId, historyId),
    getMessages: (scenarioId, historyId) => ipcRenderer.invoke(IPC_CHANNELS.AI_GET_MESSAGES, scenarioId, historyId),

    // Skill 管理
    listSkills: () => ipcRenderer.invoke(IPC_CHANNELS.AI_LIST_SKILLS),
    getSkill: (dirName) => ipcRenderer.invoke(IPC_CHANNELS.AI_GET_SKILL, dirName),

    // Memory 管理
    listMemories: (scenarioId) => ipcRenderer.invoke(IPC_CHANNELS.AI_LIST_MEMORIES, scenarioId),
    addMemory: (data) => ipcRenderer.invoke(IPC_CHANNELS.AI_ADD_MEMORY, data),
    deleteMemory: (id, scenarioId) => ipcRenderer.invoke(IPC_CHANNELS.AI_DELETE_MEMORY, id, scenarioId),

    // MCP 管理
    getMcpStatuses: () => ipcRenderer.invoke(IPC_CHANNELS.MCP_GET_STATUSES),
    listMcpConfigs: () => ipcRenderer.invoke(IPC_CHANNELS.MCP_LIST_CONFIGS),
    saveMcpConfig: (name, config) => ipcRenderer.invoke(IPC_CHANNELS.MCP_SAVE_CONFIG, name, config),
    deleteMcpConfig: (name) => ipcRenderer.invoke(IPC_CHANNELS.MCP_DELETE_CONFIG, name),
    reloadMcp: () => ipcRenderer.invoke(IPC_CHANNELS.MCP_RELOAD),

    // 对话事件监听
    onChatChunk: (callback) => {
      const wrapper = (event, data) => callback(data);
      listeners.set(`ai-chat-chunk-${Date.now()}`, {
        channel: IPC_CHANNELS.AI_CHAT_CHUNK,
        callback: wrapper,
      });
      ipcRenderer.on(IPC_CHANNELS.AI_CHAT_CHUNK, wrapper);
    },
    onChatComplete: (callback) => {
      const wrapper = (event, data) => callback(data);
      listeners.set(`ai-chat-complete-${Date.now()}`, {
        channel: IPC_CHANNELS.AI_CHAT_COMPLETE,
        callback: wrapper,
      });
      ipcRenderer.on(IPC_CHANNELS.AI_CHAT_COMPLETE, wrapper);
    },
    onChatError: (callback) => {
      const wrapper = (event, data) => callback(data);
      listeners.set(`ai-chat-error-${Date.now()}`, {
        channel: IPC_CHANNELS.AI_CHAT_ERROR,
        callback: wrapper,
      });
      ipcRenderer.on(IPC_CHANNELS.AI_CHAT_ERROR, wrapper);
    },
    offChatEvents: () => {
      for (const [key, value] of listeners.entries()) {
        if (
          value.channel === IPC_CHANNELS.AI_CHAT_CHUNK ||
          value.channel === IPC_CHANNELS.AI_CHAT_COMPLETE ||
          value.channel === IPC_CHANNELS.AI_CHAT_ERROR ||
          value.channel === IPC_CHANNELS.AI_TOOL_START ||
          value.channel === IPC_CHANNELS.AI_TOOL_RESULT ||
          value.channel === IPC_CHANNELS.AI_ASK_QUESTION
        ) {
          ipcRenderer.removeListener(value.channel, value.callback);
          listeners.delete(key);
        }
      }
    },

    // Agent 模式工具事件监听
    onToolStart: (callback) => {
      const wrapper = (event, data) => callback(data);
      listeners.set(`ai-tool-start-${Date.now()}`, {
        channel: IPC_CHANNELS.AI_TOOL_START,
        callback: wrapper,
      });
      ipcRenderer.on(IPC_CHANNELS.AI_TOOL_START, wrapper);
    },
    onToolResult: (callback) => {
      const wrapper = (event, data) => callback(data);
      listeners.set(`ai-tool-result-${Date.now()}`, {
        channel: IPC_CHANNELS.AI_TOOL_RESULT,
        callback: wrapper,
      });
      ipcRenderer.on(IPC_CHANNELS.AI_TOOL_RESULT, wrapper);
    },

    // AskHumanTool 事件 (Main → Renderer: 发送问题, Renderer → Main: 返回回答)
    onAskQuestion: (callback) => {
      const wrapper = (event, data) => callback(data);
      listeners.set(`ai-ask-question-${Date.now()}`, {
        channel: IPC_CHANNELS.AI_ASK_QUESTION,
        callback: wrapper,
      });
      ipcRenderer.on(IPC_CHANNELS.AI_ASK_QUESTION, wrapper);
    },
    answerQuestion: (toolCallId, answers) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI_ANSWER_QUESTION, toolCallId, answers),
  },

  // Legacy API for backward compatibility
  getServerAddr: () => ipcRenderer.invoke('get-server-addr'),
  getTips: (arg1) => ipcRenderer.invoke('get-tips', arg1),

  // Generic IPC invoke (for channels not covered by namespaced APIs)
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  // Window control APIs (for frameless window)
  minimizeWindow: () => ipcRenderer.invoke('qtian:window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('qtian:window-maximize'),
  closeWindow: () => ipcRenderer.invoke('qtian:window-close'),
  moveWindowBy: (deltaX: number, deltaY: number) => ipcRenderer.send('qtian:window-drag', { deltaX, deltaY }),
  resizeWindow: (width: number, height: number, resizable?: boolean) => ipcRenderer.invoke('qtian:window-resize', { width, height, resizable }),
  isMaximized: () => ipcRenderer.invoke('qtian:window-is-maximized'),
  getNormalWindowSize: () => ipcRenderer.invoke('qtian:window-normal-size'),

  // App lifecycle APIs
  appQuit: () => ipcRenderer.invoke('qtian:app-quit'),
  showAbout: () => ipcRenderer.invoke('qtian:show-about'),

  // Generic IPC event listeners
  ipcRendererOn: (channel, callback) => {
    const wrapper = (event, ...args) => callback(...args);
    const key = `${channel}-${Date.now()}`;
    listeners.set(key, {
      channel,
      callback: wrapper,
    });
    ipcRenderer.on(channel, wrapper);
  },

  ipcRendererOff: (channel, callback) => {
    for (const [key, value] of listeners.entries()) {
      if (value.channel === channel) {
        ipcRenderer.removeListener(channel, value.callback);
        listeners.delete(key);
      }
    }
  },
};

/**
 * Expose the API to the renderer process
 */
contextBridge.exposeInMainWorld('electron', api);
contextBridge.exposeInMainWorld('electronAPI', api);
contextBridge.exposeInMainWorld('api', api);

// Also expose for convenience
contextBridge.exposeInMainWorld('aiAssistant', api.ai);
