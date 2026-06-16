/**
 * IPC Channel Definitions
 * All IPC communication channels used in the application
 * Shared between main process and preload script
 */

export const IPC_CHANNELS = {
  // Common channels
  GET_VERSION: 'qtian:get-version',
  GET_CONFIG: 'qtian:get-config',
  READ_CONFIG: 'qtian:read-config',

  // Console forwarding (dev mode only)
  SEND_CONSOLE_MESSAGE: 'qtian:send-console-message',

  // AI Assistant channels - Agent 管理
  AI_LIST_AGENTS: 'qtian:ai:list-agents',
  AI_GET_AGENT: 'qtian:ai:get-agent',
  AI_SAVE_AGENT: 'qtian:ai:save-agent',
  AI_DELETE_AGENT: 'qtian:ai:delete-agent',

  // AI Assistant channels - LLM 配置管理
  AI_LIST_LLM_CONFIGS: 'qtian:ai:list-llm-configs',
  AI_GET_LLM_CONFIG: 'qtian:ai:get-llm-config',
  AI_SAVE_LLM_CONFIG: 'qtian:ai:save-llm-config',
  AI_DELETE_LLM_CONFIG: 'qtian:ai:delete-llm-config',

  // AI Assistant channels - 对话历史管理
  AI_LIST_HISTORIES: 'qtian:ai:list-histories',
  AI_LIST_HISTORY_SUMMARIES: 'qtian:ai:list-history-summaries',
  AI_GET_HISTORY: 'qtian:ai:get-history',
  AI_CREATE_HISTORY: 'qtian:ai:create-history',
  AI_SAVE_HISTORY: 'qtian:ai:save-history',
  AI_DELETE_HISTORY: 'qtian:ai:delete-history',

  // AI Assistant channels - 对话会话
  AI_INIT_CHAT: 'qtian:ai:init-chat',
  AI_CHAT_MESSAGE: 'qtian:ai:chat-message',
  AI_STOP_CHAT: 'qtian:ai:stop-chat',
  AI_REGENERATE: 'qtian:ai:regenerate',
  AI_POP_MESSAGE: 'qtian:ai:pop-message',
  AI_GET_MESSAGES: 'qtian:ai:get-messages',

  // AI Assistant events (Main → Renderer)
  AI_CHAT_CHUNK: 'qtian:ai:chat-chunk',
  AI_CHAT_COMPLETE: 'qtian:ai:chat-complete',
  AI_CHAT_ERROR: 'qtian:ai:chat-error',

  // AI Assistant tool events (Main → Renderer, Agent 模式)
  AI_TOOL_START: 'qtian:ai:tool-start',
  AI_TOOL_RESULT: 'qtian:ai:tool-result',

  // AI Assistant ask tool (双向 IPC: Main → Renderer 发问题, Renderer → Main 返回回答)
  AI_ASK_QUESTION: 'qtian:ai:ask-question',
  AI_ANSWER_QUESTION: 'qtian:ai:answer-question',

  // AI Assistant channels - Skill 管理
  AI_LIST_SKILLS: 'qtian:ai:list-skills',
  AI_GET_SKILL: 'qtian:ai:get-skill',

  // AI Assistant channels - Memory 管理
  AI_LIST_MEMORIES: 'qtian:ai:list-memories',
  AI_ADD_MEMORY: 'qtian:ai:add-memory',
  AI_DELETE_MEMORY: 'qtian:ai:delete-memory',

  // AI Assistant channels - MCP 管理
  MCP_GET_STATUSES: 'qtian:ai:mcp-get-statuses',
  MCP_SAVE_CONFIG: 'qtian:ai:mcp-save-config',
  MCP_RELOAD: 'qtian:ai:mcp-reload',
  MCP_LIST_CONFIGS: 'qtian:ai:mcp-list-configs',
  MCP_DELETE_CONFIG: 'qtian:ai:mcp-delete-config',

  // Task 系统频道（公共任务基础设施）
  TASK_CREATE_AGENT_TASK: 'qtian:task:create-agent-task',
  TASK_RUN: 'qtian:task:run',
  TASK_CANCEL: 'qtian:task:cancel',
  TASK_GET: 'qtian:task:get',
  TASK_LIST_BY_SOURCE: 'qtian:task:list-by-source',
  TASK_LIST: 'qtian:task:list',
  TASK_SUBSCRIBE: 'qtian:task:subscribe',
  TASK_UNSUBSCRIBE: 'qtian:task:unsubscribe',
  TASK_EVENT: 'qtian:task:event',

  // Todo 应用频道（Phase 1-2 范围：数据层 + 文档系统）
  // Category
  TODO_GET_CATEGORY_TREE: 'qtian:todo:get-category-tree',
  TODO_CREATE_CATEGORY: 'qtian:todo:create-category',
  TODO_UPDATE_CATEGORY: 'qtian:todo:update-category',
  TODO_DELETE_CATEGORY: 'qtian:todo:delete-category',
  TODO_RESTORE_CATEGORY: 'qtian:todo:restore-category',

  // TodoList
  TODO_LIST_TODO_LISTS: 'qtian:todo:list-todo-lists',
  TODO_GET_TODO_LIST: 'qtian:todo:get-todo-list',
  TODO_CREATE_TODO_LIST: 'qtian:todo:create-todo-list',
  TODO_UPDATE_TODO_LIST: 'qtian:todo:update-todo-list',
  TODO_DELETE_TODO_LIST: 'qtian:todo:delete-todo-list',
  TODO_RESTORE_TODO_LIST: 'qtian:todo:restore-todo-list',

  // TodoItem
  TODO_GET_TODO_ITEM: 'qtian:todo:get-todo-item',
  TODO_GET_TODO_ITEM_TREE: 'qtian:todo:get-todo-item-tree',
  TODO_CREATE_TODO_ITEM: 'qtian:todo:create-todo-item',
  TODO_UPDATE_TODO_ITEM: 'qtian:todo:update-todo-item',
  TODO_DELETE_TODO_ITEM: 'qtian:todo:delete-todo-item',
  TODO_RESTORE_TODO_ITEM: 'qtian:todo:restore-todo-item',
  TODO_UPDATE_TODO_ITEM_STATUS: 'qtian:todo:update-todo-item-status',

  // Label
  TODO_LIST_LABELS: 'qtian:todo:list-labels',
  TODO_CREATE_LABEL: 'qtian:todo:create-label',
  TODO_UPDATE_LABEL: 'qtian:todo:update-label',
  TODO_DELETE_LABEL: 'qtian:todo:delete-label',
  TODO_LIST_TODO_ITEMS_BY_LABEL: 'qtian:todo:list-todo-items-by-label',

  // Document
  TODO_LIST_DOCS_BY_CATEGORY: 'qtian:todo:list-docs-by-category',
  TODO_LIST_DOCS_BY_ITEM: 'qtian:todo:list-docs-by-item',
  TODO_GET_DOCUMENT: 'qtian:todo:get-document',
  TODO_SAVE_DOCUMENT: 'qtian:todo:save-document',
  TODO_DELETE_DOCUMENT: 'qtian:todo:delete-document',
  TODO_SAVE_ATTACHMENT: 'qtian:todo:save-attachment',

  // Config
  TODO_GET_CONFIG: 'qtian:todo:get-config',
} as const;

/**
 * Type for IPC channel names
 */
export type IPCChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
