import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRpcTransport } from '../src/app/rpc-transport';

const ORIGIN = 'http://127.0.0.1:54321';
const CHUNK = 128 * 1024;
const MAX = 128 * 1024 * 1024;
type Args = Record<string, any>;
type Transport = ReturnType<typeof createRpcTransport>;
const transports: Transport[] = [];
function transport(send: (args: Args, signal?: AbortSignal) => Promise<any>) {
  const result = createRpcTransport(ORIGIN, send); transports.push(result); return result;
}
function reply(value: unknown, status = 200) {
  const body = Buffer.from(JSON.stringify(value));
  return { status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: body.toString('base64'), size: body.byteLength };
}
function binary(bytes: Uint8Array) { return { status: 200, headers: { 'content-type': 'application/octet-stream' }, size: bytes.byteLength, body: Buffer.from(bytes).toString('base64') }; }
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Iframe network access is unavailable'); })); });
afterEach(() => { for (const item of transports.splice(0)) item.close(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('MCP App RPC transport', () => {
  it('carries UTF-8 and allowed headers without credentials, preserving business error responses', async () => {
    const send = vi.fn(async (_args: Args) => reply({ ok: false, error: { code: 'CONFLICT', message: '版本已更新' } }, 409));
    const client = transport(send), text = JSON.stringify({ title: '中文设计 🎨', text: 'café' });
    const response = await client.request(`${ORIGIN}/api/tools/artifact_apply?token=secret&revision=9&share=guest`, {
      method: 'POST', credentials: 'include', headers: { Authorization: 'Bearer secret', Cookie: 'credential=private', 'X-Studio-Actor': 'agent', 'Content-Type': 'application/json', 'X-Filename': '%E5%9B%BE.png', 'X-Content-Type': 'image/png', 'X-Studio-Name': 'name' }, body: text,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: { code: 'CONFLICT', message: '版本已更新' } });
    expect(send.mock.calls[0]?.[0]).toEqual({ action: 'request', path: '/api/tools/artifact_apply?revision=9', method: 'POST', headers: { 'content-type': 'application/json', 'x-filename': '%E5%9B%BE.png', 'x-content-type': 'image/png' }, body: Buffer.from(text).toString('base64') });
  });

  it('keeps the exact chunk boundary inline and uploads larger Unicode documents in bounded consecutive chunks', async () => {
    const chunks: Buffer[] = [], uploads: Args[] = [], requests: Args[] = [], releases: string[] = [];
    const send = vi.fn(async (args: Args) => {
      if (args.action === 'upload') {
        uploads.push(args); const data = Buffer.from(args.data, 'base64'); chunks.push(data);
        expect(data.byteLength).toBeLessThanOrEqual(CHUNK);
        return { transferId: 'upload-doc', nextOffset: args.offset + data.length };
      }
      if (args.action === 'release') { releases.push(args.transferId); return {}; }
      requests.push(args); return reply({ ok: true, data: { saved: true } });
    });
    const client = transport(send);
    await client.request('/api/tools/artifact_apply', { method: 'POST', body: new Uint8Array(CHUNK) });
    expect(uploads).toHaveLength(0); expect(Buffer.from(requests[0]!.body, 'base64')).toHaveLength(CHUNK);
    const text = JSON.stringify({ html: `<p>${'作品🎨'.repeat(30000)}</p>` });
    await client.request('/api/tools/artifact_apply', { method: 'POST', body: text });
    expect(uploads.length).toBeGreaterThan(1);
    expect(uploads[0]).not.toHaveProperty('transferId');
    expect(uploads.slice(1).every(part => part.transferId === 'upload-doc')).toBe(true);
    expect(uploads.map(part => part.offset)).toEqual(uploads.map((_, index) => index * CHUNK));
    expect(uploads.every(part => part.size === Buffer.byteLength(text))).toBe(true);
    expect(Buffer.concat(chunks).toString('utf8')).toBe(text);
    expect(requests[1]).toMatchObject({ uploadId: 'upload-doc' }); expect(requests[1]).not.toHaveProperty('body');
    expect(releases).toEqual(['upload-doc']);
  });

  it('preserves binary typed-array offsets and reconstructs segmented archive downloads', async () => {
    const bytes = Uint8Array.from({ length: CHUNK * 2 + 17 }, (_, index) => (index * 17) % 256);
    const source = new Uint8Array(bytes.length + 10); source.set(bytes, 5);
    const uploaded: Buffer[] = [], offsets: number[] = [], released: string[] = [];
    const client = transport(async args => {
      if (args.action === 'upload') { const data = Buffer.from(args.data, 'base64'); uploaded.push(data); return { transferId: 'upload-zip', nextOffset: args.offset + data.length }; }
      if (args.action === 'request') return { status: 200, headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="backup.zip"' }, downloadId: 'download-zip', size: bytes.length };
      if (args.action === 'release') { released.push(args.transferId); return {}; }
      offsets.push(args.offset); const part = bytes.slice(args.offset, args.offset + CHUNK), nextOffset = args.offset + part.length;
      return { data: Buffer.from(part).toString('base64'), nextOffset, done: nextOffset === bytes.length };
    });
    const response = await client.request('/api/import', { method: 'POST', body: source.subarray(5, -5) });
    expect(Buffer.concat(uploaded)).toEqual(Buffer.from(bytes));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get('content-disposition')).toContain('backup.zip');
    expect(offsets).toEqual([0, CHUNK, CHUNK * 2]); expect(released.sort()).toEqual(['download-zip', 'upload-zip']);
  });

  it('reads Blob bytes and rejects oversized bodies and invalid response sizes before allocating them', async () => {
    const send = vi.fn(async (_args: Args) => binary(new Uint8Array([0, 255]))), client = transport(send);
    await client.request('/api/assets?artifactId=a', { method: 'POST', body: new Blob([new Uint8Array([0, 255])], { type: 'image/png' }) });
    expect(send.mock.calls[0]?.[0]).toMatchObject({ headers: { 'content-type': 'image/png' }, body: 'AP8=' });
    const huge = new Blob(); Object.defineProperty(huge, 'size', { value: MAX + 1 });
    await expect(client.request('/api/import', { method: 'POST', body: huge })).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect(send).toHaveBeenCalledTimes(1);
    const oversized = transport(async () => ({ status: 200, headers: {}, size: MAX + 1, downloadId: 'oversized' }));
    await expect(oversized.request('/api/export')).rejects.toMatchObject({ code: 'TOO_LARGE' });
    const invalid = transport(async () => ({ status: 200, headers: {}, size: 3, body: 'AA==' }));
    await expect(invalid.request('/api/session')).rejects.toThrow('大小');
  });

  it('cleans up upload transfers on failure and on cancellation without passing the aborted cleanup signal', async () => {
    const releases: Array<{ id: string; signal?: AbortSignal }> = [];
    let fail = true;
    const controller = new AbortController();
    const client = transport(async (args, signal) => {
      if (args.action === 'release') { releases.push({ id: args.transferId, signal }); return {}; }
      if (args.action === 'upload') {
        if (fail && args.offset > 0) throw new Error('Connection lost');
        return { transferId: fail ? 'failed-upload' : 'cancelled-upload', nextOffset: args.offset + Buffer.from(args.data, 'base64').length };
      }
      controller.abort(); return new Promise(() => {});
    });
    await expect(client.request('/api/import', { method: 'POST', body: new Uint8Array(CHUNK + 1) })).rejects.toThrow('Connection lost');
    fail = false;
    await expect(client.request('/api/import', { method: 'POST', body: new Uint8Array(CHUNK + 1), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(releases.map(item => item.id)).toEqual(['failed-upload', 'cancelled-upload']);
    expect(releases.every(item => item.signal instanceof AbortSignal && !item.signal.aborted && item.signal !== controller.signal)).toBe(true);
  });

  it('releases a transfer acknowledged after cancellation, and malformed downloads', async () => {
    let acknowledge!: (value: unknown) => void;
    const releases: string[] = [], controller = new AbortController();
    const client = transport(async args => {
      if (args.action === 'release') { releases.push(args.transferId); return {}; }
      return new Promise(resolve => { acknowledge = resolve; });
    });
    const pending = client.request('/api/import', { method: 'POST', body: new Uint8Array(CHUNK + 1), signal: controller.signal });
    await vi.waitFor(() => expect(acknowledge).toBeTypeOf('function'));
    controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    acknowledge({ transferId: 'late-upload', nextOffset: CHUNK });
    await vi.waitFor(() => expect(releases).toEqual(['late-upload']));
    const malformed = transport(async args => {
      if (args.action === 'release') { releases.push(args.transferId); return {}; }
      if (args.action === 'request') return { status: 200, headers: {}, size: CHUNK + 1, downloadId: 'bad-download' };
      return { data: 'AA==', nextOffset: 2, done: false };
    });
    await expect(malformed.request('/api/export')).rejects.toThrow('不完整');
    expect(releases).toContain('bad-download');
  });

  it('bounds concurrent requests and cancels queued and in-flight work on close', async () => {
    const acknowledgements: Array<() => void> = [];
    let live = 0, maximum = 0;
    const send = vi.fn(async () => {
      live++; maximum = Math.max(maximum, live);
      return new Promise(resolve => { acknowledgements.push(() => { live--; resolve(reply({ ok: true })); }); });
    });
    const client = transport(send);
    const pending = Array.from({ length: 7 }, () => client.request('/api/session'));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(4));
    for (const ack of acknowledgements.splice(0)) ack();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(7));
    for (const ack of acknowledgements.splice(0)) ack();
    await Promise.all(pending); expect(maximum).toBe(4);
    const closing = Array.from({ length: 7 }, () => client.request('/api/session').catch(error => error));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(11));
    client.close();
    expect((await Promise.all(closing)).every(error => error.code === 'CLOSED')).toBe(true);
    await expect(client.request('/api/session')).rejects.toMatchObject({ code: 'CLOSED' });
    expect(send).toHaveBeenCalledTimes(11);
  });

  it('prepares internal resource blobs while retaining canonical references and original HTML in the response', async () => {
    const create = vi.spyOn(URL, 'createObjectURL'), revoke = vi.spyOn(URL, 'revokeObjectURL');
    const document = { ok: true, data: { elements: [{ src: '/assets/image.png?token=secret', nested: { src: `${ORIGIN}/assets/image.png` } }, { src: '/api/assets/movie.mp4' }], thumbnail: '/api/thumbnails/board?revision=7', missing: '/assets/missing.png', external: 'https://other.example/assets/a.png', html: '<img src="/assets/inline.png">' } };
    const paths: string[] = [];
    const client = transport(async args => {
      paths.push(args.path);
      if (args.path.startsWith('/api/tools/')) return reply(document);
      if (args.path === '/assets/missing.png') return reply({ ok: false }, 404);
      return { ...binary(new Uint8Array([0, 1, 255])), headers: { 'content-type': 'image/png' } };
    });
    const response = await client.request('/api/tools/artifact_read', { method: 'POST' });
    expect(await response.json()).toEqual(document);
    expect(paths.filter(path => path === '/assets/image.png')).toHaveLength(1);
    expect(paths).not.toContain('/assets/inline.png'); expect(paths.some(path => path?.includes('other.example'))).toBe(false);
    expect(create).toHaveBeenCalledTimes(3);
    expect(client.assetUrl('/assets/image.png?token=another')).toMatch(/^blob:/);
    expect(client.assetUrl(`${ORIGIN}/assets/image.png`)).toBe(client.assetUrl('/assets/image.png'));
    expect(client.assetUrl('/api/thumbnails/board?revision=7')).toMatch(/^blob:/);
    expect(client.assetUrl('/api/thumbnails/board?revision=8')).toBeUndefined();
    expect(client.assetUrl('https://other.example/assets/a.png')).toBeUndefined();
    expect(client.assetUrl('/assets/missing.png')).toBeUndefined();
    const blob = create.mock.calls[0]![0] as Blob;
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([0, 1, 255]));
    await client.request('/api/tools/artifact_read', { method: 'POST' });
    expect(create).toHaveBeenCalledTimes(3);
    client.close(); expect(revoke).toHaveBeenCalledTimes(3); expect(client.assetUrl('/assets/image.png')).toBeUndefined();
  });

  it('limits preview preparation to four concurrent resources and 64 cached object URLs', async () => {
    let sequence = 0, live = 0, maximum = 0, second = false;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:preview-${++sequence}`);
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const client = transport(async args => {
      if (args.path.startsWith('/api/tools/')) return reply({ ok: true, data: second ? { src: '/assets/new.png' } : Array.from({ length: 65 }, (_, index) => `/assets/${index}.png`) });
      live++; maximum = Math.max(maximum, live);
      await new Promise(resolve => setTimeout(resolve, 1)); live--;
      return binary(new Uint8Array([1]));
    });
    await client.request('/api/tools/artifact_list', { method: 'POST' });
    expect(maximum).toBe(4); expect(sequence).toBe(64);
    second = true; await client.request('/api/tools/artifact_read', { method: 'POST' });
    expect(sequence).toBe(65); expect(revoke).toHaveBeenCalledTimes(1);
    expect(client.assetUrl('/assets/new.png')).toBe('blob:preview-65');
    client.close(); expect(revoke).toHaveBeenCalledTimes(65);
  });

  it('rejects external origins, unsupported methods, credentials and arbitrary paths without sending', async () => {
    const send = vi.fn(async () => reply({ ok: true })), client = transport(send);
    for (const url of ['https://other.example/api/tools/artifact_list', '//other.example/assets/image.png', 'file:///tmp/a', 'data:text/plain,private', `http://user:pass@127.0.0.1:54321/api/session`, '/private/file', '/api/../private/file']) {
      await expect(client.request(url)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    await expect(client.request('/api/session', { method: 'DELETE' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const controller = new AbortController(); controller.abort();
    await expect(client.request('/api/session', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(send).not.toHaveBeenCalled();
  });
});
