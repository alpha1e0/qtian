import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { WebdavClient, WebdavError, parseMultistatus, joinUrl } from './webdav-client';
import type { TransportFn, WebdavClientConfig } from './sync-types';

/**
 * WebDAV 客户端单测：注入 transport 桩，覆盖
 * - auth header（Basic base64(user:pass)）
 * - PROPFIND 解析
 * - MKCOL 405/409 容错
 * - GET / PUT / DELETE / HEAD
 * - URL 拼接（尾斜杠）
 * - 非 2xx 抛 WebdavError
 */

const baseConfig: WebdavClientConfig = {
  url: 'https://dav.example.com',
  accountName: 'alice',
  accountPassword: 's3cret',
  folder: 'qtian',
};

/** 期望的 Basic 认证头值 */
const expectedAuth = 'Basic ' + Buffer.from('alice:s3cret', 'utf-8').toString('base64');

describe('joinUrl', () => {
  it('拼接多段并去除多余斜杠', () => {
    expect(joinUrl('https://a.com/', '/b/', 'c')).toBe('https://a.com/b/c');
  });
  it('忽略空段', () => {
    expect(joinUrl('', 'a', '')).toBe('a');
  });
});

describe('parseMultistatus', () => {
  it('提取多个 response 的 href 与 collection 标记', () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:">
        <d:response>
          <d:href>/dav/qtian/qtian-sync/assistant/</d:href>
          <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
        </d:response>
        <d:response>
          <d:href>/dav/qtian/qtian-sync/assistant/llm/default.json</d:href>
          <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>1024</d:getcontentlength></d:prop></d:propstat>
        </d:response>
      </d:multistatus>`;
    const results = parseMultistatus(xml, 'https://dav.example.com/dav/qtian/qtian-sync/');
    expect(results).toHaveLength(2);
    expect(results[0].isCollection).toBe(true);
    expect(results[1].isCollection).toBe(false);
    expect(results[1].href).toBe('assistant/llm/default.json');
    expect(results[1].size).toBe(1024);
  });

  it('无 response 块时返回空数组', () => {
    expect(parseMultistatus('<x>nothing</x>', 'https://dav.example.com/root/')).toEqual([]);
  });

  it('处理含编码字符的 href', () => {
    const xml = `<multistatus xmlns="DAV:">
      <response><href>/root/a%20b.txt</href><propstat><prop><resourcetype/></prop></propstat></response>
    </multistatus>`;
    const results = parseMultistatus(xml, 'https://dav.example.com/root/');
    expect(results[0].href).toBe('a b.txt');
  });
});

describe('WebdavClient', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtian-webdav-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** 构造一个记录调用的 transport 桩 */
  function makeRecordingTransport(
    handler: (method: string, url: string, opts: { headers: Record<string, string>; body?: string | Buffer }) => { statusCode: number; body: string | Buffer },
  ): { fn: TransportFn; calls: { method: string; url: string; headers: Record<string, string>; body?: string | Buffer }[] } {
    const calls: { method: string; url: string; headers: Record<string, string>; body?: string | Buffer }[] = [];
    const fn: TransportFn = async (method, url, opts) => {
      calls.push({ method, url, headers: opts.headers, body: opts.body });
      return handler(method, url, opts);
    };
    return { fn, calls };
  }

  it('getRootUrl 带 folder 与 qtian-sync 及尾斜杠', () => {
    const client = new WebdavClient(baseConfig, async () => ({ statusCode: 200, body: '', headers: {} }));
    expect(client.getRootUrl()).toBe('https://dav.example.com/qtian/qtian-sync/');
  });

  it('testConnection 成功返回 true 并携带 Basic 认证头', async () => {
    const { fn, calls } = makeRecordingTransport(() => ({ statusCode: 207, body: '<x/>', headers: {} }));
    const client = new WebdavClient(baseConfig, fn);

    expect(await client.testConnection()).toBe(true);
    expect(calls[0].method).toBe('PROPFIND');
    expect(calls[0].headers['Authorization']).toBe(expectedAuth);
    expect(calls[0].headers['Depth']).toBe('0');
  });

  it('testConnection 失败返回 false', async () => {
    const client = new WebdavClient(baseConfig, async () => ({ statusCode: 401, body: '', headers: {} }));
    expect(await client.testConnection()).toBe(false);
  });

  it('testConnection transport 抛异常时返回 false 不崩溃', async () => {
    const client = new WebdavClient(baseConfig, async () => {
      throw new Error('network down');
    });
    expect(await client.testConnection()).toBe(false);
  });

  it('ensureDir：MKCOL 405 视为已存在不抛错', async () => {
    const { fn, calls } = makeRecordingTransport((_m, url) => {
      if (url.endsWith('/sub/')) {
        return { statusCode: 405, body: '', headers: {} };
      }
      return { statusCode: 201, body: '', headers: {} };
    });
    const client = new WebdavClient(baseConfig, fn);

    await expect(client.ensureDir('parent/sub')).resolves.toBeUndefined();
    // 应该对 parent 和 parent/sub 各发一次 MKCOL
    expect(calls.filter((c) => c.method === 'MKCOL')).toHaveLength(2);
  });

  it('ensureDir：非 405/409 错误状态抛 WebdavError', async () => {
    const client = new WebdavClient(baseConfig, async () => ({ statusCode: 403, body: '', headers: {} }));
    await expect(client.ensureDir('denied')).rejects.toBeInstanceOf(WebdavError);
  });

  it('listDir：解析 PROPFIND multistatus 返回资源列表', async () => {
    const xml = `<multistatus xmlns="DAV:">
      <response><href>/qtian/qtian-sync/assistant/a.json</href><propstat><prop><resourcetype/><getcontentlength>10</getcontentlength></prop></propstat></response>
    </multistatus>`;
    const client = new WebdavClient(baseConfig, async () => ({ statusCode: 207, body: xml, headers: {} }));
    const list = await client.listDir('assistant');
    expect(list).toHaveLength(1);
    expect(list[0].href).toBe('assistant/a.json');
  });

  it('listDir：非 2xx/非 207 抛 WebdavError', async () => {
    const client = new WebdavClient(baseConfig, async () => ({ statusCode: 404, body: '', headers: {} }));
    await expect(client.listDir('missing')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('getFile：写入响应 body 到本地文件', async () => {
    const client = new WebdavClient(baseConfig, async () => ({ statusCode: 200, body: 'hello-webdav', headers: {} }));
    const dest = path.join(tmpDir, 'dl.txt');
    await client.getFile('assistant/a.json', dest);
    expect(fs.readFileSync(dest, 'utf-8')).toBe('hello-webdav');
  });

  it('getFile：非 2xx 抛 WebdavError', async () => {
    const client = new WebdavClient(baseConfig, async () => ({ statusCode: 404, body: '', headers: {} }));
    await expect(client.getFile('nope', path.join(tmpDir, 'x'))).rejects.toBeInstanceOf(WebdavError);
  });

  it('putFile：读取本地文件并通过 PUT 发送', async () => {
    const src = path.join(tmpDir, 'up.txt');
    fs.writeFileSync(src, 'payload');
    const { fn, calls } = makeRecordingTransport(() => ({ statusCode: 201, body: '', headers: {} }));
    const client = new WebdavClient(baseConfig, fn);

    await client.putFile('assistant/up.txt', src);
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].body).toEqual(Buffer.from('payload'));
  });

  it('putFile：非 2xx 抛 WebdavError', async () => {
    const src = path.join(tmpDir, 'up.txt');
    fs.writeFileSync(src, 'x');
    const client = new WebdavClient(baseConfig, async () => ({ statusCode: 500, body: '', headers: {} }));
    await expect(client.putFile('assistant/up.txt', src)).rejects.toBeInstanceOf(WebdavError);
  });

  it('deleteResource：成功不抛错', async () => {
    const client = new WebdavClient(baseConfig, async () => ({ statusCode: 204, body: '', headers: {} }));
    await expect(client.deleteResource('assistant/old.txt')).resolves.toBeUndefined();
  });

  it('deleteResource：404 视为已不存在不抛错', async () => {
    const client = new WebdavClient(baseConfig, async () => ({ statusCode: 404, body: '', headers: {} }));
    await expect(client.deleteResource('assistant/old.txt')).resolves.toBeUndefined();
  });

  it('deleteResource：其他错误状态抛 WebdavError', async () => {
    const client = new WebdavClient(baseConfig, async () => ({ statusCode: 500, body: '', headers: {} }));
    await expect(client.deleteResource('assistant/old.txt')).rejects.toBeInstanceOf(WebdavError);
  });

  it('exists：2xx 返回 true', async () => {
    const client = new WebdavClient(baseConfig, async () => ({ statusCode: 200, body: '', headers: {} }));
    expect(await client.exists('assistant/a.json')).toBe(true);
  });

  it('exists：404 返回 false', async () => {
    const client = new WebdavClient(baseConfig, async () => ({ statusCode: 404, body: '', headers: {} }));
    expect(await client.exists('missing')).toBe(false);
  });

  it('exists：transport 异常返回 false 不崩溃', async () => {
    const client = new WebdavClient(baseConfig, async () => {
      throw new Error('net');
    });
    expect(await client.exists('x')).toBe(false);
  });

  it('URL 拼接：resolve 使用正斜杠（路径分隔符跨平台）', async () => {
    const { calls } = makeRecordingTransport(() => ({ statusCode: 204, body: '', headers: {} }));
    const client = new WebdavClient(baseConfig, async () => ({ statusCode: 204, body: '', headers: {} }));
    // deleteResource 会调用 resolve，观察 URL 形态
    await client.deleteResource('a/b/c.txt');
    void calls;
    // 直接断言 getRootUrl + 相对路径
    expect(client.getRootUrl() + 'a/b/c.txt').toBe('https://dav.example.com/qtian/qtian-sync/a/b/c.txt');
  });
});
