import { createLogger } from '@/core/utils/logger';
import {
  AskHumanTool,
  AskQuestion,
  EditTool,
  GlobTool,
  GrepTool,
  ReadTool,
  ShellTool,
  WebSearchTool,
  WriteTool,
} from '.';
import { ITool } from './tool.interface';

const logger = createLogger('BuildTools');

/**
 * 内置工具构建所需的依赖提供者
 *
 * - ask_human 工具需要 IPC 回调与渲染器交互（弹问题、收回答）
 * - web_search 工具需要 Tavily API Key 提供者
 *
 * 未提供对应提供者时，声明该工具会被跳过并告警，避免运行期崩溃。
 */
export interface BuildToolsProviders {
  /** AskHumanTool 向用户提问的回调 */
  askUserViaIpc?: (toolCallId: string, questions: AskQuestion[]) => Promise<Record<string, string>>;
  /** WebSearchTool 的 API Key 提供者 */
  getTavilyApiKey?: () => string;
}

/**
 * 根据 Agent 声明的工具名列表构建内置工具实例
 *
 * @param toolNames - Agent 中配置的工具名称列表
 * @param providers - 工具依赖提供者
 * @returns 工具实例数组
 */
export function buildBuiltInTools(toolNames: string[], providers: BuildToolsProviders = {}): ITool[] {
  const tools: ITool[] = [];

  for (const name of toolNames) {
    switch (name) {
      case 'shell_execute':
        tools.push(new ShellTool());
        break;
      case 'file_read':
        tools.push(new ReadTool());
        break;
      case 'file_write':
        tools.push(new WriteTool());
        break;
      case 'file_edit':
        tools.push(new EditTool());
        break;
      case 'glob':
        tools.push(new GlobTool());
        break;
      case 'grep':
        tools.push(new GrepTool());
        break;
      case 'ask_human':
        if (providers.askUserViaIpc) {
          tools.push(new AskHumanTool(providers.askUserViaIpc));
        } else {
          logger.warn("Agent declares 'ask_human' but no askUserViaIpc provider given, skipping");
        }
        break;
      case 'web_search':
        if (providers.getTavilyApiKey) {
          tools.push(new WebSearchTool(providers.getTavilyApiKey));
        } else {
          logger.warn("Agent declares 'web_search' but no getTavilyApiKey provider given, skipping");
        }
        break;
      default:
        logger.warn(`Unknown tool: ${name}, skipping`);
    }
  }

  return tools;
}
