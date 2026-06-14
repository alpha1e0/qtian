import { fetch } from 'undici';
import { createLogger } from '@/core/utils/logger';
import { ITool } from '../tool.interface';

const logger = createLogger('WebSearchTool');

/** Tavily 搜索接口地址 */
const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

/** 默认请求超时 (ms) */
const DEFAULT_TIMEOUT_MS = 30000;

/** 默认返回结果数 */
const DEFAULT_MAX_RESULTS = 5;

/** 返回结果数上限 */
const MAX_RESULTS_LIMIT = 10;

/** 单条结果 content 截断长度 (防 token 爆炸) */
const MAX_CONTENT_LENGTH = 500;

/** Tavily 单条搜索结果 */
interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

/** Tavily 接口响应 */
interface TavilyResponse {
  query?: string;
  answer?: string;
  results?: TavilyResult[];
  response_time?: string;
}

/**
 * 内置联网搜索工具 — 通过 Tavily API 搜索互联网
 *
 * 功能:
 * 1. 调用 Tavily Search API，返回 query / answer / results
 * 2. 支持域名过滤 (include_domains / exclude_domains)
 * 3. 支持搜索深度切换 (basic / advanced)
 * 4. 输出 Markdown 格式 (含 sources 超链接列表)
 *
 * 设计:
 * 通过构造函数注入 apiKeyProvider 回调，工具本身不依赖配置模块，
 * 便于单元测试和动态刷新配置。
 */
export class WebSearchTool implements ITool {
  readonly name = 'web_search';
  readonly description =
    'Search the web and use the results to inform your response. '
    + 'Provides up-to-date information for current events and recent data. '
    + 'Returns search results as blocks with Markdown hyperlinks. '
    + 'Use this tool for information beyond your knowledge cutoff.';
  readonly parameters: Record<string, any> = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query string',
      },
      max_results: {
        type: 'number',
        description: `Maximum number of results to return (default: ${DEFAULT_MAX_RESULTS}, max: ${MAX_RESULTS_LIMIT})`,
      },
      search_depth: {
        type: 'string',
        enum: ['basic', 'advanced'],
        description: 'Search depth: "basic" (default) or "advanced" for more thorough results',
      },
      include_domains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only include results from these domains (e.g. ["github.com", "stackoverflow.com"])',
      },
      exclude_domains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Exclude results from these domains',
      },
      include_answer: {
        type: 'boolean',
        description: 'Whether to include a generated answer summary (default: true)',
      },
    },
    required: ['query'],
  };

  /**
   * @param apiKeyProvider - 同步函数，返回最新 Tavily API key
   */
  constructor(private apiKeyProvider: () => string) {}

  /**
   * 执行联网搜索
   * @param args - 工具参数
   * @returns Markdown 格式搜索结果
   */
  async execute(args: Record<string, any>): Promise<string> {
    const validationError = this.validateArgs(args);
    if (validationError) return validationError;

    const query: string = args.query;
    const apiKey = this.apiKeyProvider();
    if (!apiKey) {
      logger.warn('Tavily API key is not configured');
      return 'Error: Tavily API key is not configured';
    }

    const body = this.buildRequestBody(args);
    logger.info(`Web search: query="${query}", max_results=${body.max_results}, depth=${body.search_depth}`);

    try {
      const response = await this.callTavily(apiKey, body);
      return this.formatResults(response, query);
    } catch (err) {
      const msg = (err as Error).message;
      logger.error(`Web search failed for query="${query}": ${msg}`);
      return `Error: ${msg}`;
    }
  }

  /**
   * 校验输入参数
   * @returns 错误描述，校验通过返回 null
   */
  private validateArgs(args: Record<string, any>): string | null {
    const { query, max_results, search_depth, include_domains, exclude_domains } = args;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return 'Error: "query" is required and must be a non-empty string';
    }

    if (max_results !== undefined) {
      if (typeof max_results !== 'number' || !Number.isInteger(max_results)
        || max_results < 1 || max_results > MAX_RESULTS_LIMIT) {
        return `Error: "max_results" must be an integer between 1 and ${MAX_RESULTS_LIMIT}`;
      }
    }

    if (search_depth !== undefined && !['basic', 'advanced'].includes(search_depth)) {
      return 'Error: "search_depth" must be "basic" or "advanced"';
    }

    if (!this.isValidStringArray(include_domains)) {
      return 'Error: "include_domains" must be an array of strings';
    }
    if (!this.isValidStringArray(exclude_domains)) {
      return 'Error: "exclude_domains" must be an array of strings';
    }

    return null;
  }

  /**
   * 判断是否为字符串数组
   */
  private isValidStringArray(value: any): boolean {
    if (value === undefined || value === null) return true;
    if (!Array.isArray(value)) return false;
    return value.every((v) => typeof v === 'string');
  }

  /**
   * 构造 Tavily 请求 body
   */
  private buildRequestBody(args: Record<string, any>): Record<string, any> {
    const maxResults = typeof args.max_results === 'number' ? args.max_results : DEFAULT_MAX_RESULTS;
    const includeAnswer = args.include_answer !== false; // 默认 true

    return {
      query: args.query,
      max_results: maxResults,
      search_depth: args.search_depth ?? 'basic',
      include_domains: args.include_domains ?? [],
      exclude_domains: args.exclude_domains ?? [],
      include_answer: includeAnswer,
      topic: 'general',
    };
  }

  /**
   * 调用 Tavily API
   * @throws HTTP 非 2xx、超时、网络异常时抛出
   */
  private async callTavily(
    apiKey: string,
    body: Record<string, any>,
  ): Promise<TavilyResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(TAVILY_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const statusText = response.statusText || '';
        throw new Error(
          `Tavily API request failed: HTTP ${response.status} ${statusText}`.trim(),
        );
      }

      let json: TavilyResponse;
      try {
        json = (await response.json()) as TavilyResponse;
      } catch {
        throw new Error('Invalid response from Tavily API');
      }
      return json;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`Tavily API request timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`);
      }
      // 已经是 friendly error 的直接抛
      if ((err as Error).message.startsWith('Tavily API')) {
        throw err;
      }
      // 网络错误等
      throw new Error(`Failed to call Tavily API: ${(err as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 格式化搜索结果为 Markdown
   */
  private formatResults(resp: TavilyResponse, query: string): string {
    const results = resp.results ?? [];
    const answer = typeof resp.answer === 'string' ? resp.answer.trim() : '';

    if (results.length === 0 && !answer) {
      return `No results found for: ${query}`;
    }

    const lines: string[] = [];

    if (answer) {
      lines.push(answer);
      lines.push('');
    }

    if (results.length > 0) {
      lines.push('## Sources');
      lines.push('');

      for (const r of results) {
        const title = r.title?.trim() || '(untitled)';
        const url = r.url?.trim() || '';
        if (url) {
          lines.push(`- [${title}](${url})`);
        } else {
          lines.push(`- ${title}`);
        }
        if (r.content) {
          lines.push(`  ${this.truncate(r.content)}`);
        }
      }
      lines.push('');

      const time = resp.response_time ? ` in ${resp.response_time}s` : '';
      lines.push(`Found ${results.length} result${results.length !== 1 ? 's' : ''}${time}`);
    }

    return lines.join('\n').trim();
  }

  /**
   * 截断过长文本，并标记
   */
  private truncate(text: string): string {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= MAX_CONTENT_LENGTH) return cleaned;
    return cleaned.slice(0, MAX_CONTENT_LENGTH) + '...';
  }
}
