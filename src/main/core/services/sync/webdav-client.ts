import * as fs from 'fs';
import * as path from 'path';

import { createLogger } from '@/core/utils/logger';
import type { WebdavClientConfig, WebdavResource } from './sync-types';
import { REMOTE_SYNC_ROOT } from './sync-types';

const logger = createLogger('WebdavClient');

/**
 * 传输层函数签名（便于单元测试注入桩）。
 *
 * 生产实现使用 Node 内置的 https/http 模块；测试注入返回固定响应的桩。
 */
export type TransportFn = (
  method: string,
  url: string,
  opts: { headers: Record<string, string>; body?: string | Buffer },
) => Promise<{ statusCode: number; body: string | Buffer; headers: Record<string, string> }>;

/**
 * WebDAV 错误（非 2xx 响应抛出）。
 */
export class WebdavError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'WebdavError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, WebdavError.prototype);
  }
}

/** 认为成功的 HTTP 状态码区间（2xx） */
function isSuccess(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

/** 基本认证头（RFC 7617 Basic） */
function buildAuthHeader(cfg: WebdavClientConfig): string {
  const raw = `${cfg.accountName}:${cfg.accountPassword}`;
  return 'Basic ' + Buffer.from(raw, 'utf-8').toString('base64');
}

/**
 * WebDAV 客户端。
 *
 * 设计：
 * - 构造时接受可注入的 transport 函数；不传则使用基于 Node https/http 的默认实现
 * - URL 拼接：远端根 = `<url>/<folder>/<REMOTE_SYNC_ROOT>/`，relPath 相对该根
 * - PROPFIND 解析用最小正则提取 href 与 collection 标记，解析失败降级为空 + 告警
 * - MKCOL 的 405/409 视为目录已存在（幂等）
 */
export class WebdavClient {
  private readonly cfg: WebdavClientConfig;
  private readonly transport: TransportFn;

  constructor(cfg: WebdavClientConfig, transport?: TransportFn) {
    this.cfg = cfg;
    this.transport = transport ?? defaultTransport;
  }

  /** 远端根 URL（带尾斜杠）：<url>/<folder>/qtian-sync/ */
  getRootUrl(): string {
    return joinUrl(this.cfg.url, this.cfg.folder, REMOTE_SYNC_ROOT) + '/';
  }

  /** 拼接远端资源完整 URL */
  private resolve(relPath: string): string {
    return this.getRootUrl() + relPath.split(path.sep).join('/');
  }

  /** 构造带认证的请求头（可附加额外头） */
  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: buildAuthHeader(this.cfg),
      ...extra,
    };
  }

  /**
   * 测试连接（PROPFIND depth 0）。
   *
   * @returns true 表示连接成功；false 表示认证失败/不可达
   */
  async testConnection(): Promise<boolean> {
    try {
      const resp = await this.transport('PROPFIND', this.getRootUrl(), {
        headers: this.buildHeaders({ Depth: '0' }),
        body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>',
      });
      // 207 Multi-Status 为 PROPFIND 标准成功响应；部分服务端返回 200
      return isSuccess(resp.statusCode) || resp.statusCode === 207;
    } catch (err) {
      logger.error('WebDAV testConnection failed', err);
      return false;
    }
  }

  /**
   * 确保远端目录存在（MKCOL，幂等）。
   * 405（Method Not Allowed，目录已存在）/ 409（部分服务端语义）视为已存在。
   *
   * 会递归创建中间目录（按 '/' 分段逐段 MKCOL）。
   */
  async ensureDir(relPath: string): Promise<void> {
    const segments = relPath.split('/').filter(Boolean);
    let acc = '';
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      const url = this.getRootUrl() + acc + '/';
      try {
        const resp = await this.transport('MKCOL', url, { headers: this.buildHeaders() });
        if (isSuccess(resp.statusCode)) {
          continue;
        }
        // 405/409 视为已存在
        if (resp.statusCode === 405 || resp.statusCode === 409) {
          continue;
        }
        throw new WebdavError(`MKCOL ${acc} failed: ${resp.statusCode}`, resp.statusCode);
      } catch (err) {
        // 已存在时 transport 可能也返回非 2xx，按状态码判定
        if (err instanceof WebdavError) {
          throw err;
        }
        logger.warn(`ensureDir segment '${acc}' error`, err);
      }
    }
  }

  /**
   * 列出目录下的资源（PROPFIND depth 1）。
   *
   * 解析 multistatus XML 用最小正则，失败降级为空列表 + 告警。
   *
   * @returns 资源列表（不含目录本身）
   */
  async listDir(relPath: string): Promise<WebdavResource[]> {
    const url = this.getRootUrl() + relPath.split(path.sep).join('/') + '/';
    const resp = await this.transport('PROPFIND', url, {
      headers: this.buildHeaders({ Depth: '1', 'Content-Type': 'application/xml' }),
      body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/><getcontentlength/></prop></propfind>',
    });
    if (!isSuccess(resp.statusCode) && resp.statusCode !== 207) {
      throw new WebdavError(`PROPFIND ${relPath} failed: ${resp.statusCode}`, resp.statusCode);
    }
    const bodyStr = typeof resp.body === 'string' ? resp.body : resp.body.toString('utf-8');
    return parseMultistatus(bodyStr, this.getRootUrl());
  }

  /**
   * 下载远端文件到本地（GET）。
   *
   * @param relPath - 相对远端根的路径
   * @param destPath - 本地目标文件完整路径（父目录需已存在）
   */
  async getFile(relPath: string, destPath: string): Promise<void> {
    const url = this.resolve(relPath);
    const resp = await this.transport('GET', url, { headers: this.buildHeaders() });
    if (!isSuccess(resp.statusCode)) {
      throw new WebdavError(`GET ${relPath} failed: ${resp.statusCode}`, resp.statusCode);
    }
    const buf = typeof resp.body === 'string' ? Buffer.from(resp.body, 'utf-8') : Buffer.from(resp.body);
    fs.writeFileSync(destPath, buf);
  }

  /**
   * 上传本地文件到远端（PUT）。
   *
   * @param relPath - 相对远端根的路径（父目录需已 ensureDir）
   * @param srcPath - 本地源文件完整路径
   */
  async putFile(relPath: string, srcPath: string): Promise<void> {
    const url = this.resolve(relPath);
    const body = fs.readFileSync(srcPath);
    const resp = await this.transport('PUT', url, { headers: this.buildHeaders(), body });
    if (!isSuccess(resp.statusCode)) {
      throw new WebdavError(`PUT ${relPath} failed: ${resp.statusCode}`, resp.statusCode);
    }
  }

  /**
   * 删除远端资源（DELETE）。
   * 404 视为已不存在（幂等），不抛错。
   */
  async deleteResource(relPath: string): Promise<void> {
    const url = this.resolve(relPath);
    const resp = await this.transport('DELETE', url, { headers: this.buildHeaders() });
    if (!isSuccess(resp.statusCode) && resp.statusCode !== 404) {
      throw new WebdavError(`DELETE ${relPath} failed: ${resp.statusCode}`, resp.statusCode);
    }
  }

  /**
   * 检查远端资源是否存在（HEAD）。
   */
  async exists(relPath: string): Promise<boolean> {
    const url = this.resolve(relPath);
    try {
      const resp = await this.transport('HEAD', url, { headers: this.buildHeaders() });
      return isSuccess(resp.statusCode);
    } catch {
      return false;
    }
  }
}

/**
 * 拼接 URL 片段（忽略空段，规范化多余斜杠）。
 */
export function joinUrl(...parts: string[]): string {
  return parts
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

/**
 * 解析 PROPFIND multistatus XML 响应（最小正则实现）。
 *
 * 不引入 XML 库：提取 <response> 块，从中抓 <href> 与 <collection> 标记。
 * 解析失败降级返回空列表（调用方按需告警）。
 *
 * @param xml - multistatus XML 字符串
 * @param rootUrl - 远端根 URL，用于剥离前缀得到相对 href
 */
export function parseMultistatus(xml: string, rootUrl: string): WebdavResource[] {
  const results: WebdavResource[] = [];
  // 按 <response> 分块（非贪婪匹配，兼容命名空间前缀）
  const responseRegex = /<(?:\w+:)?response>([\s\S]*?)<\/(?:\w+:)?response>/gi;
  let match: RegExpExecArray | null;
  while ((match = responseRegex.exec(xml)) !== null) {
    const block = match[1];
    const hrefMatch = block.match(/<(?:\w+:)?href>([\s\S]*?)<\/(?:\w+:)?href>/i);
    if (!hrefMatch) {
      continue;
    }
    let href = hrefMatch[1].trim();
    try {
      href = decodeURIComponent(href);
    } catch {
      // 解码失败保留原值
    }
    // 剥离 host 前缀（部分服务端返回完整 URL）与 root 前缀
    if (href.includes('://')) {
      try {
        const u = new URL(href);
        href = u.pathname;
      } catch {
        // 保留原值
      }
    }
    const rootPath = pathPartOfUrl(rootUrl);
    if (rootPath && href.startsWith(rootPath)) {
      href = href.slice(rootPath.length);
    }
    href = href.replace(/^\/+/, '');
    // 跳过目录本身（href 与请求路径一致）
    const isCollection = /<(?:\w+:)?collection\s*\/>/i.test(block);
    // size
    let size: number | undefined;
    const sizeMatch = block.match(/<(?:\w+:)?getcontentlength>(\d+)<\/(?:\w+:)?getcontentlength>/i);
    if (sizeMatch) {
      size = parseInt(sizeMatch[1], 10);
    }
    // 忽略空 href（目录自身的 propstat）
    if (href) {
      results.push({ href, isCollection, size });
    }
  }
  if (results.length === 0 && xml.length > 0) {
    logger.warn('parseMultistatus produced no entries; possible XML schema mismatch');
  }
  return results;
}

/** 取 URL 的 path 部分（去 query/hash），末尾去斜杠 */
function pathPartOfUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/+$/, '');
  } catch {
    // 非绝对 URL，按字符串处理
    return url.replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

/**
 * 默认传输实现：基于 Node https/http 模块。
 *
 * 生产环境使用；单元测试通过构造参数注入桩绕过网络。
 */
function defaultTransport(
  method: string,
  url: string,
  opts: { headers: Record<string, string>; body?: string | Buffer },
): Promise<{ statusCode: number; body: string | Buffer; headers: Record<string, string> }> {
  // 动态 require 避免 electron 测试环境加载问题
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const http = require('http');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const https = require('https');
  const lib = url.startsWith('https://') ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method,
        headers: opts.headers,
      },
      (res: any) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode ?? 0,
            body: buf,
            headers: res.headers as Record<string, string>,
          });
        });
      },
    );
    req.on('error', reject);
    if (opts.body !== undefined) {
      req.write(opts.body);
    }
    req.end();
  });
}
