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

  // Task 系统公共 API
  task: {
    // 创建 / 运行 / 取消
    createAgentTask: (input) => ipcRenderer.invoke(IPC_CHANNELS.TASK_CREATE_AGENT_TASK, input),
    run: (taskId) => ipcRenderer.invoke(IPC_CHANNELS.TASK_RUN, taskId),
    cancel: (taskId) => ipcRenderer.invoke(IPC_CHANNELS.TASK_CANCEL, taskId),

    // 查询
    get: (taskId) => ipcRenderer.invoke(IPC_CHANNELS.TASK_GET, taskId),
    listBySource: (source, sourceRefId) =>
      ipcRenderer.invoke(IPC_CHANNELS.TASK_LIST_BY_SOURCE, source, sourceRefId),
    list: (filter) => ipcRenderer.invoke(IPC_CHANNELS.TASK_LIST, filter),

    // 订阅 / 取消订阅任务事件
    subscribe: (taskId) => ipcRenderer.invoke(IPC_CHANNELS.TASK_SUBSCRIBE, taskId),
    unsubscribe: (taskId) => ipcRenderer.invoke(IPC_CHANNELS.TASK_UNSUBSCRIBE, taskId),

    // 事件监听（返回取消订阅函数，便于组件卸载时清理）
    onEvent: (callback) => {
      const wrapper = (event, data) => callback(data);
      listeners.set(`task-event-${Date.now()}`, {
        channel: IPC_CHANNELS.TASK_EVENT,
        callback: wrapper,
      });
      ipcRenderer.on(IPC_CHANNELS.TASK_EVENT, wrapper);
      // 返回取消订阅函数
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.TASK_EVENT, wrapper);
        for (const [key, value] of listeners.entries()) {
          if (value.callback === wrapper) {
            listeners.delete(key);
            break;
          }
        }
      };
    },
  },

  // Todo 应用 API（Phase 1-2：数据层 + 文档系统）
  todoApp: {
    // Category
    getCategoryTree: () => ipcRenderer.invoke(IPC_CHANNELS.TODO_GET_CATEGORY_TREE),
    createCategory: (data) => ipcRenderer.invoke(IPC_CHANNELS.TODO_CREATE_CATEGORY, data),
    updateCategory: (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.TODO_UPDATE_CATEGORY, id, patch),
    deleteCategory: (id) => ipcRenderer.invoke(IPC_CHANNELS.TODO_DELETE_CATEGORY, id),
    restoreCategory: (id) => ipcRenderer.invoke(IPC_CHANNELS.TODO_RESTORE_CATEGORY, id),

    // TodoList
    listTodoLists: (categoryId) => ipcRenderer.invoke(IPC_CHANNELS.TODO_LIST_TODO_LISTS, categoryId),
    getTodoList: (id) => ipcRenderer.invoke(IPC_CHANNELS.TODO_GET_TODO_LIST, id),
    createTodoList: (data) => ipcRenderer.invoke(IPC_CHANNELS.TODO_CREATE_TODO_LIST, data),
    updateTodoList: (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.TODO_UPDATE_TODO_LIST, id, patch),
    deleteTodoList: (id) => ipcRenderer.invoke(IPC_CHANNELS.TODO_DELETE_TODO_LIST, id),
    restoreTodoList: (id) => ipcRenderer.invoke(IPC_CHANNELS.TODO_RESTORE_TODO_LIST, id),
    // 导入/导出 JSON（主进程聚合 dialog + fs + exchange service，取消返回 null）
    exportTodoList: (listId) => ipcRenderer.invoke(IPC_CHANNELS.TODO_EXPORT_TODO_LIST, listId),
    importTodoList: (categoryId) => ipcRenderer.invoke(IPC_CHANNELS.TODO_IMPORT_TODO_LIST, categoryId),
    // 收藏（切换收藏态 + 列出收藏项目，sidebar 收藏 tab 数据源）
    toggleFavoriteTodoList: (id) => ipcRenderer.invoke(IPC_CHANNELS.TODO_TOGGLE_FAVORITE, id),
    listFavoriteTodoLists: () => ipcRenderer.invoke(IPC_CHANNELS.TODO_LIST_FAVORITES),

    // TodoItem
    getTodoItem: (id) => ipcRenderer.invoke(IPC_CHANNELS.TODO_GET_TODO_ITEM, id),
    getTodoItemTree: (listId) => ipcRenderer.invoke(IPC_CHANNELS.TODO_GET_TODO_ITEM_TREE, listId),
    createTodoItem: (data) => ipcRenderer.invoke(IPC_CHANNELS.TODO_CREATE_TODO_ITEM, data),
    updateTodoItem: (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.TODO_UPDATE_TODO_ITEM, id, patch),
    deleteTodoItem: (id) => ipcRenderer.invoke(IPC_CHANNELS.TODO_DELETE_TODO_ITEM, id),
    restoreTodoItem: (id) => ipcRenderer.invoke(IPC_CHANNELS.TODO_RESTORE_TODO_ITEM, id),
    updateTodoItemStatus: (id, status) =>
      ipcRenderer.invoke(IPC_CHANNELS.TODO_UPDATE_TODO_ITEM_STATUS, id, status),
    // 快捷创建（中间面板底部输入框：main 侧解析结尾 #N 控制符 + 落库）
    createTodoItemQuick: (raw, listId, parentId) =>
      ipcRenderer.invoke(IPC_CHANNELS.TODO_CREATE_ITEM_QUICK, raw, listId, parentId),
    // 描述字段选中文本批量创建（不解析 #N，整行作为 title；详见 §9.4）
    createTodoItemsFromText: (text, listId, parentId) =>
      ipcRenderer.invoke(IPC_CHANNELS.TODO_CREATE_ITEMS_FROM_TEXT, text, listId, parentId),

    // Label
    listLabels: () => ipcRenderer.invoke(IPC_CHANNELS.TODO_LIST_LABELS),
    createLabel: (data) => ipcRenderer.invoke(IPC_CHANNELS.TODO_CREATE_LABEL, data),
    updateLabel: (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.TODO_UPDATE_LABEL, id, patch),
    deleteLabel: (id) => ipcRenderer.invoke(IPC_CHANNELS.TODO_DELETE_LABEL, id),
    listTodoListsByLabel: (labelId) =>
      ipcRenderer.invoke(IPC_CHANNELS.TODO_LIST_TODO_LISTS_BY_LABEL, labelId),

    // Document
    listDocsByList: (listId) =>
      ipcRenderer.invoke(IPC_CHANNELS.TODO_LIST_DOCS_BY_LIST, listId),
    listDocsByItem: (itemId) => ipcRenderer.invoke(IPC_CHANNELS.TODO_LIST_DOCS_BY_ITEM, itemId),
    getDocument: (id) => ipcRenderer.invoke(IPC_CHANNELS.TODO_GET_DOCUMENT, id),
    saveDocument: (data) => ipcRenderer.invoke(IPC_CHANNELS.TODO_SAVE_DOCUMENT, data),
    deleteDocument: (id) => ipcRenderer.invoke(IPC_CHANNELS.TODO_DELETE_DOCUMENT, id),
    restoreDocument: (id) => ipcRenderer.invoke(IPC_CHANNELS.TODO_RESTORE_DOCUMENT, id),
    saveAttachment: (buffer, ext) =>
      ipcRenderer.invoke(IPC_CHANNELS.TODO_SAVE_ATTACHMENT, buffer, ext),
    saveAttachmentFromPath: (filePath) =>
      ipcRenderer.invoke(IPC_CHANNELS.TODO_SAVE_ATTACHMENT_FROM_PATH, filePath),

    // Config
    getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.TODO_GET_CONFIG),

    // 全文搜索（Phase 3）
    search: (query, limit, scope) =>
      ipcRenderer.invoke(IPC_CHANNELS.TODO_SEARCH, query, limit, scope),
    listSearchHistory: (limit) =>
      ipcRenderer.invoke(IPC_CHANNELS.TODO_LIST_SEARCH_HISTORY, limit),
    deleteSearchHistory: (id) =>
      ipcRenderer.invoke(IPC_CHANNELS.TODO_DELETE_SEARCH_HISTORY, id),
    clearSearchHistory: () => ipcRenderer.invoke(IPC_CHANNELS.TODO_CLEAR_SEARCH_HISTORY),

    // 回收站（Phase 4：跨表聚合 + 物理删除 + 恢复 label）
    listTrash: () => ipcRenderer.invoke(IPC_CHANNELS.TODO_LIST_TRASH),
    purgeTrash: (type, id) => ipcRenderer.invoke(IPC_CHANNELS.TODO_PURGE_TRASH, type, id),
    emptyTrash: () => ipcRenderer.invoke(IPC_CHANNELS.TODO_EMPTY_TRASH),
    restoreLabel: (id) => ipcRenderer.invoke(IPC_CHANNELS.TODO_RESTORE_LABEL, id),

    // Todo 驱动 AI 任务（Phase 5）
    createTaskFromItem: (itemId, options) =>
      ipcRenderer.invoke(IPC_CHANNELS.TODO_CREATE_TASK_FROM_ITEM, itemId, options),
    listTasksByItem: (itemId) =>
      ipcRenderer.invoke(IPC_CHANNELS.TODO_LIST_TASKS_BY_ITEM, itemId),
  },

  // Note 应用 API（Phase 1：数据层 + 搜索 + 回收站）
  noteApp: {
    // Category
    getCategoryTree: () => ipcRenderer.invoke(IPC_CHANNELS.NOTE_GET_CATEGORY_TREE),
    createCategory: (data) => ipcRenderer.invoke(IPC_CHANNELS.NOTE_CREATE_CATEGORY, data),
    updateCategory: (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.NOTE_UPDATE_CATEGORY, id, patch),
    deleteCategory: (id) => ipcRenderer.invoke(IPC_CHANNELS.NOTE_DELETE_CATEGORY, id),
    restoreCategory: (id) => ipcRenderer.invoke(IPC_CHANNELS.NOTE_RESTORE_CATEGORY, id),

    // Doc
    listDocs: (categoryId) => ipcRenderer.invoke(IPC_CHANNELS.NOTE_LIST_DOCS, categoryId),
    getDoc: (id) => ipcRenderer.invoke(IPC_CHANNELS.NOTE_GET_DOC, id),
    createDoc: (data) => ipcRenderer.invoke(IPC_CHANNELS.NOTE_CREATE_DOC, data),
    updateDoc: (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.NOTE_UPDATE_DOC, id, patch),
    deleteDoc: (id) => ipcRenderer.invoke(IPC_CHANNELS.NOTE_DELETE_DOC, id),
    restoreDoc: (id) => ipcRenderer.invoke(IPC_CHANNELS.NOTE_RESTORE_DOC, id),
    toggleFavorite: (id) => ipcRenderer.invoke(IPC_CHANNELS.NOTE_TOGGLE_FAVORITE, id),
    listFavorites: () => ipcRenderer.invoke(IPC_CHANNELS.NOTE_LIST_FAVORITES),
    listDocsByLabel: (labelId) => ipcRenderer.invoke(IPC_CHANNELS.NOTE_LIST_DOCS_BY_LABEL, labelId),
    saveAttachment: (buffer, ext) =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTE_SAVE_ATTACHMENT, buffer, ext),
    saveAttachmentFromPath: (filePath) =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTE_SAVE_ATTACHMENT_FROM_PATH, filePath),

    // Label
    listLabels: () => ipcRenderer.invoke(IPC_CHANNELS.NOTE_LIST_LABELS),
    createLabel: (data) => ipcRenderer.invoke(IPC_CHANNELS.NOTE_CREATE_LABEL, data),
    updateLabel: (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.NOTE_UPDATE_LABEL, id, patch),
    deleteLabel: (id) => ipcRenderer.invoke(IPC_CHANNELS.NOTE_DELETE_LABEL, id),
    restoreLabel: (id) => ipcRenderer.invoke(IPC_CHANNELS.NOTE_RESTORE_LABEL, id),

    // Search
    search: (query, limit) => ipcRenderer.invoke(IPC_CHANNELS.NOTE_SEARCH, query, limit),
    listSearchHistory: (limit) =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTE_LIST_SEARCH_HISTORY, limit),
    deleteSearchHistory: (id) =>
      ipcRenderer.invoke(IPC_CHANNELS.NOTE_DELETE_SEARCH_HISTORY, id),
    clearSearchHistory: () => ipcRenderer.invoke(IPC_CHANNELS.NOTE_CLEAR_SEARCH_HISTORY),

    // Trash
    listTrash: () => ipcRenderer.invoke(IPC_CHANNELS.NOTE_LIST_TRASH),
    purgeTrash: (type, id) => ipcRenderer.invoke(IPC_CHANNELS.NOTE_PURGE_TRASH, type, id),
    emptyTrash: () => ipcRenderer.invoke(IPC_CHANNELS.NOTE_EMPTY_TRASH),

    // Config
    getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.NOTE_GET_CONFIG),
  },

  // 数据同步（WebDAV）API
  sync: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.SYNC_GET_STATUS),
    syncUpload: () => ipcRenderer.invoke(IPC_CHANNELS.SYNC_UPLOAD),
    syncDownload: () => ipcRenderer.invoke(IPC_CHANNELS.SYNC_DOWNLOAD),
    syncAuto: () => ipcRenderer.invoke(IPC_CHANNELS.SYNC_AUTO),
    testConnection: () => ipcRenderer.invoke(IPC_CHANNELS.SYNC_TEST_CONNECTION),
    getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.SYNC_GET_CONFIG),
    saveConfig: (cfg) => ipcRenderer.invoke(IPC_CHANNELS.SYNC_SAVE_CONFIG, cfg),
  },

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

  // 快捷窗口控制（多窗口架构：主窗口与快捷窗口为独立 BrowserWindow）
  openQuickWindow: () => ipcRenderer.invoke('qtian:quick-window-open'),
  showQuickWindow: () => ipcRenderer.invoke('qtian:quick-window-show'),
  hideQuickWindow: () => ipcRenderer.invoke('qtian:quick-window-hide'),
  toggleQuickWindow: () => ipcRenderer.invoke('qtian:quick-window-toggle'),
  /**
   * 跨窗口导航：快捷窗口 → 主进程 → 主窗口
   * payload: { message?, agentId?, llmConfig?, historyId? }
   */
  navigateToNormalMode: (payload: unknown) => ipcRenderer.invoke('qtian:quick-to-normal-navigate', payload),

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
contextBridge.exposeInMainWorld('task', api.task);
contextBridge.exposeInMainWorld('todoApp', api.todoApp);
contextBridge.exposeInMainWorld('noteApp', api.noteApp);
contextBridge.exposeInMainWorld('sync', api.sync);
