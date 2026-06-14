/**
 * WebSearchTool 单元测试
 *
 * 通过 vi.mock 替换 undici 的 fetch，覆盖：
 * 1. 参数校验
 * 2. API key 缺失
 * 3. 正常调用
 * 4. HTTP 错误
 * 5. 网络异常
 * 6. 超时
 * 7. JSON 解析失败
 * 8. 空结果
 * 9. 域名过滤透传
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSearchTool } from '@/core/services/tools/web-search-tool/web-search-tool';

// fetch 函数引用，供测试中控制行为
let mockFetch: ReturnType<typeof vi.fn>;

vi.mock('undici', () => ({
  fetch: (...args: any[]) => mockFetch(...args),
}));

vi.mock('@/core/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

/** 构造 fetch 成功响应 */
function jsonResponse(data: any, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
  } as Response;
}

/** 构造典型 Tavily 响应 */
function makeTavilyResponse(overrides: Partial<any> = {}): any {
  return {
    query: 'test query',
    answer: 'Test answer summary',
    results: [
      {
        title: 'Result One',
        url: 'https://example.com/1',
        content: 'Content of result one',
        score: 0.95,
      },
      {
        title: 'Result Two',
        url: 'https://example.com/2',
        content: 'Content of result two',
        score: 0.85,
      },
    ],
    response_time: '1.23',
    ...overrides,
  };
}

describe('WebSearchTool', () => {
  let tool: WebSearchTool;

  beforeEach(() => {
    mockFetch = vi.fn();
    tool = new WebSearchTool(() => 'test-api-key');
  });

  // ==================== 属性测试 ====================

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('web_search');
    });

    it('should have non-empty description', () => {
      expect(tool.description).toBeTruthy();
      expect(tool.description.toLowerCase()).toContain('search');
    });

    it('should have valid parameters schema', () => {
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.required).toContain('query');
      expect(tool.parameters.properties.query.type).toBe('string');
    });
  });

  // ==================== 参数校验 ====================

  describe('input validation', () => {
    it('should reject missing query', async () => {
      const result = await tool.execute({});
      expect(result).toContain('Error');
      expect(result).toContain('"query"');
    });

    it('should reject empty query', async () => {
      const result = await tool.execute({ query: '   ' });
      expect(result).toContain('Error');
      expect(result).toContain('"query"');
    });

    it('should reject non-string query', async () => {
      const result = await tool.execute({ query: 123 });
      expect(result).toContain('Error');
    });

    it('should reject max_results out of range', async () => {
      mockFetch.mockResolvedValue(jsonResponse(makeTavilyResponse()));

      const tooSmall = await tool.execute({ query: 'q', max_results: 0 });
      expect(tooSmall).toContain('max_results');
      expect(tooSmall).toContain('Error');

      const tooBig = await tool.execute({ query: 'q', max_results: 11 });
      expect(tooBig).toContain('max_results');
      expect(tooBig).toContain('Error');
    });

    it('should reject non-integer max_results', async () => {
      const result = await tool.execute({ query: 'q', max_results: 2.5 });
      expect(result).toContain('max_results');
      expect(result).toContain('Error');
    });

    it('should reject invalid search_depth', async () => {
      const result = await tool.execute({ query: 'q', search_depth: 'deep' });
      expect(result).toContain('search_depth');
      expect(result).toContain('Error');
    });

    it('should reject non-array include_domains', async () => {
      const result = await tool.execute({ query: 'q', include_domains: 'github.com' });
      expect(result).toContain('include_domains');
      expect(result).toContain('Error');
    });

    it('should reject non-string entries in include_domains', async () => {
      const result = await tool.execute({ query: 'q', include_domains: ['a.com', 123] });
      expect(result).toContain('include_domains');
      expect(result).toContain('Error');
    });

    it('should reject non-array exclude_domains', async () => {
      const result = await tool.execute({ query: 'q', exclude_domains: 'x.com' });
      expect(result).toContain('exclude_domains');
      expect(result).toContain('Error');
    });
  });

  // ==================== API Key 校验 ====================

  describe('API key handling', () => {
    it('should return error when API key is empty', async () => {
      const emptyKeyTool = new WebSearchTool(() => '');
      const result = await emptyKeyTool.execute({ query: 'test' });
      expect(result).toContain('Error');
      expect(result).toContain('API key');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should call apiKeyProvider each execute', async () => {
      const provider = vi.fn(() => 'dynamic-key');
      const dynamicTool = new WebSearchTool(provider);
      mockFetch.mockResolvedValue(jsonResponse(makeTavilyResponse()));

      await dynamicTool.execute({ query: 'a' });
      await dynamicTool.execute({ query: 'b' });

      expect(provider).toHaveBeenCalledTimes(2);
    });
  });

  // ==================== 正常调用 ====================

  describe('successful execution', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue(jsonResponse(makeTavilyResponse()));
    });

    it('should call Tavily endpoint with POST and Bearer auth', async () => {
      await tool.execute({ query: 'hello world' });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.tavily.com/search');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('Bearer test-api-key');
      expect(options.headers['Content-Type']).toBe('application/json');
    });

    it('should include query in request body', async () => {
      await tool.execute({ query: 'what is react' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.query).toBe('what is react');
      expect(body.topic).toBe('general');
    });

    it('should use default max_results = 5', async () => {
      await tool.execute({ query: 'q' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_results).toBe(5);
    });

    it('should pass through custom max_results', async () => {
      await tool.execute({ query: 'q', max_results: 3 });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_results).toBe(3);
    });

    it('should use default search_depth = basic', async () => {
      await tool.execute({ query: 'q' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.search_depth).toBe('basic');
    });

    it('should pass through search_depth = advanced', async () => {
      await tool.execute({ query: 'q', search_depth: 'advanced' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.search_depth).toBe('advanced');
    });

    it('should default include_answer to true', async () => {
      await tool.execute({ query: 'q' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.include_answer).toBe(true);
    });

    it('should respect include_answer = false', async () => {
      await tool.execute({ query: 'q', include_answer: false });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.include_answer).toBe(false);
    });

    it('should pass through include_domains / exclude_domains', async () => {
      await tool.execute({
        query: 'q',
        include_domains: ['a.com'],
        exclude_domains: ['b.com'],
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.include_domains).toEqual(['a.com']);
      expect(body.exclude_domains).toEqual(['b.com']);
    });

    it('should return formatted Markdown with answer and sources', async () => {
      const result = await tool.execute({ query: 'q' });
      expect(result).toContain('Test answer summary');
      expect(result).toContain('## Sources');
      expect(result).toContain('[Result One](https://example.com/1)');
      expect(result).toContain('[Result Two](https://example.com/2)');
      expect(result).toContain('Content of result one');
      expect(result).toContain('Found 2 results');
      expect(result).toContain('1.23s');
    });

    it('should omit answer section when answer is empty', async () => {
      mockFetch.mockResolvedValue(jsonResponse(makeTavilyResponse({ answer: '' })));
      const result = await tool.execute({ query: 'q' });
      // 无 answer 时直接以 Sources 章节开头
      expect(result.startsWith('## Sources')).toBe(true);
      // 原 answer 内容不应出现
      expect(result).not.toContain('Test answer summary');
    });

    it('should truncate long content to 500 chars', async () => {
      const longContent = 'a'.repeat(800);
      mockFetch.mockResolvedValue(jsonResponse(makeTavilyResponse({
        results: [
          { title: 'T', url: 'https://x.com', content: longContent },
        ],
        answer: '',
      })));
      const result = await tool.execute({ query: 'q' });
      // 原始 800 字符被截断为 500 + '...'
      expect(result).toContain('a'.repeat(500) + '...');
      expect(result).not.toContain('a'.repeat(800));
    });

    it('should handle missing url gracefully', async () => {
      mockFetch.mockResolvedValue(jsonResponse(makeTavilyResponse({
        results: [
          { title: 'NoUrl', content: 'content' },
        ],
        answer: '',
      })));
      const result = await tool.execute({ query: 'q' });
      expect(result).toContain('- NoUrl');
      expect(result).not.toContain('[NoUrl]');
    });

    it('should handle missing title with fallback', async () => {
      mockFetch.mockResolvedValue(jsonResponse(makeTavilyResponse({
        results: [
          { url: 'https://x.com', content: 'content' },
        ],
        answer: '',
      })));
      const result = await tool.execute({ query: 'q' });
      expect(result).toContain('(untitled)');
    });

    it('should report singular "Found 1 result"', async () => {
      mockFetch.mockResolvedValue(jsonResponse(makeTavilyResponse({
        results: [{ title: 'A', url: 'https://a.com', content: 'c' }],
        answer: '',
      })));
      const result = await tool.execute({ query: 'q' });
      expect(result).toContain('Found 1 result');
      expect(result).not.toContain('Found 1 results');
    });
  });

  // ==================== HTTP 错误 ====================

  describe('HTTP error handling', () => {
    it('should return error on 401 unauthorized', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response);

      const result = await tool.execute({ query: 'q' });
      expect(result).toContain('Error');
      expect(result).toContain('401');
    });

    it('should return error on 429 rate limit', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      } as Response);

      const result = await tool.execute({ query: 'q' });
      expect(result).toContain('Error');
      expect(result).toContain('429');
    });

    it('should return error on 500 server error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      const result = await tool.execute({ query: 'q' });
      expect(result).toContain('Error');
      expect(result).toContain('500');
    });

    it('should handle empty statusText', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: '',
      } as Response);

      const result = await tool.execute({ query: 'q' });
      expect(result).toContain('503');
      expect(result).not.toContain('HTTP 503  ');
    });
  });

  // ==================== 网络错误 ====================

  describe('network error handling', () => {
    it('should wrap generic network errors', async () => {
      mockFetch.mockRejectedValue(new Error('connection refused'));

      const result = await tool.execute({ query: 'q' });
      expect(result).toContain('Error');
      expect(result).toContain('connection refused');
      expect(result).toContain('Failed to call Tavily API');
    });

    it('should handle AbortError as timeout', async () => {
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      mockFetch.mockRejectedValue(abortErr);

      const result = await tool.execute({ query: 'q' });
      expect(result).toContain('Error');
      expect(result).toContain('timed out');
    });

    it('should propagate friendly errors unchanged', async () => {
      // 模拟 HTTP 错误已经包装后的 message
      mockFetch.mockRejectedValue(new Error('Tavily API request failed: HTTP 503'));

      const result = await tool.execute({ query: 'q' });
      expect(result).toContain('Tavily API request failed');
      expect(result).not.toContain('Failed to call Tavily API');
    });
  });

  // ==================== JSON 异常 ====================

  describe('JSON parse failure', () => {
    it('should return error when response.json() throws', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError('Unexpected token'); },
      } as Response);

      const result = await tool.execute({ query: 'q' });
      expect(result).toContain('Error');
      expect(result).toContain('Invalid response');
    });
  });

  // ==================== 空结果 ====================

  describe('empty results', () => {
    it('should report "No results found" when both results and answer are empty', async () => {
      mockFetch.mockResolvedValue(jsonResponse(makeTavilyResponse({
        results: [],
        answer: '',
      })));

      const result = await tool.execute({ query: 'nothing' });
      expect(result).toContain('No results found');
      expect(result).toContain('nothing');
    });

    it('should return only answer when results empty but answer present', async () => {
      mockFetch.mockResolvedValue(jsonResponse(makeTavilyResponse({
        results: [],
        answer: 'Just an answer',
      })));

      const result = await tool.execute({ query: 'q' });
      expect(result).toContain('Just an answer');
      expect(result).not.toContain('## Sources');
    });

    it('should handle missing results field', async () => {
      mockFetch.mockResolvedValue(jsonResponse({
        query: 'q',
        answer: 'ok',
        // 没有 results 字段
      }));

      const result = await tool.execute({ query: 'q' });
      expect(result).toContain('ok');
      expect(result).not.toContain('## Sources');
    });
  });
});
