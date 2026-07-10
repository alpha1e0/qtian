import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { createLogger } from '@/core/utils/logger';

const logger = createLogger('Context');

/**
 * Application paths and directories management
 */
export class WPath {
  readonly currentDirectory: string;
  readonly userDirectory: string;
  readonly workspace: string;
  readonly logDirectory: string;
  readonly tempDirectory: string;
  readonly assistantDir: string;
  readonly assistantAgentDir: string;
  readonly assistantLlmDir: string;
  readonly assistantSkillDir: string;
  readonly assistantToolDir: string;
  readonly assistantHistoryDir: string;
  readonly assistantMemoryDir: string;
  /** 任务系统工作目录（公共基础设施，独立于 app_modules） */
  readonly taskDir: string;
  /** 任务系统数据库文件路径（独立 task.db） */
  readonly taskDbPath: string;
  /** 扩展 APP 模块根目录（workspace/app_modules） */
  readonly appModulesDir: string;
  /** todo-app 工作目录（workspace/app_modules/todo_app） */
  readonly appModulesTodoDir: string;
  /** todo-app 附件目录（workspace/app_modules/todo_app/attach） */
  readonly appModulesTodoAttachDir: string;
  /** todo-app 数据库文件路径（独立 todo.db） */
  readonly todoDbPath: string;
  /** note-app 工作目录（workspace/app_modules/note_app） */
  readonly appModulesNoteDir: string;
  /** note-app 附件目录（workspace/app_modules/note_app/attach） */
  readonly appModulesNoteAttachDir: string;
  /** note-app 数据库文件路径（独立 note.db） */
  readonly noteDbPath: string;
  readonly configPath: string;

  // Legacy property aliases for backward compatibility
  /** @deprecated Use currentDirectory instead */
  get curDir(): string {
    return this.currentDirectory;
  }

  /** @deprecated Use userDirectory instead */
  get userDir(): string {
    return this.userDirectory;
  }

  /** @deprecated Use logDirectory instead */
  get logDir(): string {
    return this.logDirectory;
  }

  /** @deprecated Use tempDirectory instead */
  get tmpDir(): string {
    return this.tempDirectory;
  }

  /** @deprecated Use configPath instead */
  get cfg(): string {
    return this.configPath;
  }

  constructor() {
    this.currentDirectory = process.cwd();

    // Get user home directory
    this.userDirectory = os.homedir();
    try {
      fsSync.accessSync(this.userDirectory);
    } catch {
      this.userDirectory = this.currentDirectory;
    }

    // Get workspace from environment variable or use default
    const envWorkspace = process.env.QTIAN_WORKSPACE;
    // Windows: %LOCALAPPDATA%/Qtian/workspace; fallback to home/.qtian on other platforms
    const localAppData = process.env.LOCALAPPDATA;
    const defaultWorkspace = localAppData
      ? path.join(localAppData, 'Qtian', 'workspace')
      : path.join(this.userDirectory, '.qtian');

    if (envWorkspace) {
      // Try to use QTIAN_WORKSPACE, fall back to default if directory can't be opened
      try {
        fsSync.mkdirSync(envWorkspace, { recursive: true });
        fsSync.accessSync(envWorkspace, fsSync.constants.R_OK | fsSync.constants.W_OK);
        this.workspace = envWorkspace;
      } catch (err) {
        logger.warn(`QTIAN_WORKSPACE '${envWorkspace}' is not accessible, falling back to '${defaultWorkspace}'`);
        this.workspace = defaultWorkspace;
        this.ensureDirectory(this.workspace);
      }
    } else {
      this.workspace = defaultWorkspace;
      this.ensureDirectory(this.workspace);
    }

    logger.info(`Workspace initialized: '${this.workspace}'`);

    // Setup subdirectories
    this.logDirectory = path.join(this.workspace, 'log');
    this.ensureDirectory(this.logDirectory);

    this.tempDirectory = path.join(this.workspace, 'tmp');
    this.ensureDirectory(this.tempDirectory);

    // AI Assistant directories
    this.assistantDir = path.join(this.workspace, 'assistant');
    this.ensureDirectory(this.assistantDir);

    this.assistantAgentDir = path.join(this.assistantDir, 'agent');
    this.ensureDirectory(this.assistantAgentDir);

    this.assistantLlmDir = path.join(this.assistantDir, 'llm');
    this.ensureDirectory(this.assistantLlmDir);

    this.assistantSkillDir = path.join(this.assistantDir, 'skill');
    this.ensureDirectory(this.assistantSkillDir);

    this.assistantToolDir = path.join(this.assistantDir, 'tool');
    this.ensureDirectory(this.assistantToolDir);

    this.assistantHistoryDir = path.join(this.assistantDir, 'history');
    this.ensureDirectory(this.assistantHistoryDir);

    this.assistantMemoryDir = path.join(this.assistantDir, 'memory');
    this.ensureDirectory(this.assistantMemoryDir);

    // Task system directories (公共基础设施，独立数据库 task.db)
    this.taskDir = path.join(this.workspace, 'task');
    this.ensureDirectory(this.taskDir);
    this.taskDbPath = path.join(this.taskDir, 'task.db');

    // 扩展 APP 模块目录
    this.appModulesDir = path.join(this.workspace, 'app_modules');
    this.ensureDirectory(this.appModulesDir);
    this.appModulesTodoDir = path.join(this.appModulesDir, 'todo_app');
    this.ensureDirectory(this.appModulesTodoDir);
    this.appModulesTodoAttachDir = path.join(this.appModulesTodoDir, 'attach');
    this.ensureDirectory(this.appModulesTodoAttachDir);
    this.todoDbPath = path.join(this.appModulesTodoDir, 'todo.db');

    // note-app 工作目录
    this.appModulesNoteDir = path.join(this.appModulesDir, 'note_app');
    this.ensureDirectory(this.appModulesNoteDir);
    this.appModulesNoteAttachDir = path.join(this.appModulesNoteDir, 'attach');
    this.ensureDirectory(this.appModulesNoteAttachDir);
    this.noteDbPath = path.join(this.appModulesNoteDir, 'note.db');

    // Configuration and data files
    // Configuration file: qtian.json (unified config file name)
    this.configPath = path.join(this.workspace, 'qtian.json');
  }

  /**
   * Get SQL file path for database initialization
   * In development or test mode, uses project root. In production, uses resources path.
   */
  getSqlFile(): string {
    // In development or test mode, process.cwd() returns project root
    // In production, process.resourcesPath points to the resources directory
    const isDevOrTest = process.env.NODE_ENV === 'development' || process.env.IS_TEST === 'true';
    const basePath = isDevOrTest
      ? process.cwd()
      : (process.resourcesPath || process.cwd());
    return path.join(basePath, 'data', 'qtian.sql');
  }

  /**
   * Get task system SQL file path (data/task.sql)
   * 与 getSqlFile() 采用相同的环境判定逻辑
   */
  getTaskSqlFile(): string {
    const isDevOrTest = process.env.NODE_ENV === 'development' || process.env.IS_TEST === 'true';
    const basePath = isDevOrTest
      ? process.cwd()
      : (process.resourcesPath || process.cwd());
    return path.join(basePath, 'data', 'task.sql');
  }

  /**
   * Get todo-app SQL file path (data/todo-app.sql)
   * 与 getTaskSqlFile() 采用相同的环境判定逻辑
   */
  getTodoAppSqlFile(): string {
    const isDevOrTest = process.env.NODE_ENV === 'development' || process.env.IS_TEST === 'true';
    const basePath = isDevOrTest
      ? process.cwd()
      : (process.resourcesPath || process.cwd());
    return path.join(basePath, 'data', 'todo-app.sql');
  }

  /**
   * Get note-app SQL file path (data/note-app.sql)
   * 与 getTodoAppSqlFile() 采用相同的环境判定逻辑
   */
  getNoteAppSqlFile(): string {
    const isDevOrTest = process.env.NODE_ENV === 'development' || process.env.IS_TEST === 'true';
    const basePath = isDevOrTest
      ? process.cwd()
      : (process.resourcesPath || process.cwd());
    return path.join(basePath, 'data', 'note-app.sql');
  }

  /**
   * Get SQL file path for database initialization
   * @deprecated Use getSqlFile() instead
   */
  getSqlFilePath(): string {
    return this.getSqlFile();
  }

  /**
   * Ensure a directory exists, create it if not
   */
  private ensureDirectory(dirPath: string): void {
    try {
      fsSync.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    } catch (err) {
      logger.error(`Failed to ensure directory ${dirPath}`, err);
    }
  }
}

/**
 * AI Assistant configuration
 */
export interface AiAssistantConfig {
  default_agent?: string;
  default_llm_config?: string;
  /** Agent 模式最大工具调用轮数 */
  max_tool_rounds?: number;
  /** 工具执行默认超时时间 (ms) */
  tool_timeout_ms?: number;
}

/**
 * Todo 应用配置（对应 qtian.json 的 todo_app 段）
 */
export interface TodoAppConfigData {
  /** 默认选中的 category id（null 表示根） */
  default_category_id?: number | null;
  /** 默认排序：created_at | updated_at | due_date | priority */
  default_sort?: string;
  /** 是否在侧栏显示已完成 todo */
  show_completed?: boolean;
  /** 递归层级上限 */
  max_category_depth?: number;
  max_todo_item_depth?: number;
}

/**
 * Note 应用配置（对应 qtian.json 的 note_app 段）
 */
export interface NoteAppConfigData {
  /** 默认选中的 category id（null 表示根） */
  default_category_id?: number | null;
  /** 默认排序：created_at | updated_at */
  default_sort?: string;
  /** 递归层级上限 */
  max_category_depth?: number;
}

/**
 * Application configuration
 */
export interface ConfigData {
  ai_assistant?: AiAssistantConfig;
  /** Tavily 搜索 API Key (供 WebSearchTool 使用) */
  tavily_api_key?: string;
  /** Todo 应用配置 */
  todo_app?: TodoAppConfigData;
  /** Note 应用配置 */
  note_app?: NoteAppConfigData;
}

export class Config {
  // AI Assistant config
  aiAssistant: {
    defaultAgent: string;
    defaultLlmConfig: string;
    maxToolRounds: number;
    toolTimeoutMs: number;
  };
  /** Tavily 搜索 API Key (供 WebSearchTool 使用) */
  tavilyApiKey: string;
  /** Todo 应用配置 */
  todoApp: {
    defaultCategoryId: number | null;
    defaultSort: string;
    showCompleted: boolean;
    maxCategoryDepth: number;
    maxTodoItemDepth: number;
  };
  /** Note 应用配置 */
  noteApp: {
    defaultCategoryId: number | null;
    defaultSort: string;
    maxCategoryDepth: number;
  };

  constructor() {
    this.aiAssistant = {
      defaultAgent: 'default',
      defaultLlmConfig: 'default',
      maxToolRounds: 10,
      toolTimeoutMs: 30000,
    };
    this.tavilyApiKey = '';
    this.todoApp = {
      defaultCategoryId: null,
      defaultSort: 'created_at',
      showCompleted: true,
      maxCategoryDepth: 4,
      maxTodoItemDepth: 4,
    };
    this.noteApp = {
      defaultCategoryId: null,
      defaultSort: 'updated_at',
      maxCategoryDepth: 4,
    };
  }

  /**
   * Initialize configuration from JSON file
   */
  async initConfig(cfgPath: string): Promise<void> {
    try {
      const data = await fs.readFile(cfgPath, 'utf-8');
      const cfgObj: ConfigData = JSON.parse(data);

      // Initialize ai_assistant config
      if (cfgObj.ai_assistant) {
        this.aiAssistant.defaultAgent = cfgObj.ai_assistant.default_agent ?? 'default';
        this.aiAssistant.defaultLlmConfig = cfgObj.ai_assistant.default_llm_config ?? 'default';
        this.aiAssistant.maxToolRounds = cfgObj.ai_assistant.max_tool_rounds ?? 10;
        this.aiAssistant.toolTimeoutMs = cfgObj.ai_assistant.tool_timeout_ms ?? 30000;
      }

      // Tavily API key
      this.tavilyApiKey = cfgObj.tavily_api_key ?? '';

      // Todo app config
      if (cfgObj.todo_app) {
        this.todoApp.defaultCategoryId = cfgObj.todo_app.default_category_id ?? null;
        this.todoApp.defaultSort = cfgObj.todo_app.default_sort ?? 'created_at';
        this.todoApp.showCompleted = cfgObj.todo_app.show_completed ?? true;
        this.todoApp.maxCategoryDepth = cfgObj.todo_app.max_category_depth ?? 4;
        this.todoApp.maxTodoItemDepth = cfgObj.todo_app.max_todo_item_depth ?? 4;
      }

      // Note app config
      if (cfgObj.note_app) {
        this.noteApp.defaultCategoryId = cfgObj.note_app.default_category_id ?? null;
        this.noteApp.defaultSort = cfgObj.note_app.default_sort ?? 'updated_at';
        this.noteApp.maxCategoryDepth = cfgObj.note_app.max_category_depth ?? 4;
      }
    } catch (err) {
      throw new Error(`Cannot read config file '${cfgPath}': ${err}`);
    }
  }
}

// Global instances
export const wpath = new WPath();
export const config = new Config();

// Global references (will be set at runtime)
export let websocket: any = null;

/**
 * Set the global websocket instance
 */
export function setWebsocket(ws: any): void {
  websocket = ws;
}
