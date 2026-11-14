import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_CHUNK_BYTES, APP_MAX_BYTES, type AppResponse, type AppUploadResult, type AppDownloadResult, type UiHttpRequest } from '../src/contracts/transport.js';
import { createAppTransport, validateUiRequest } from '../src/server/app-transport.js';

const transports: ReturnType<typeof createAppTransport>[] = [];
afterEach(() => { for (const transport of transports.splice(0)) transport.close(); vi.useRealTimers(); });
function transport(run: (request: UiHttpRequest) => Promise<Response> = async () => new Response('{}')) {
  const value = createAppTransport(run); transports.push(value); return value;
}
const request = (path = '/api/tools/artifact_list', body = '{}') => ({ action: 'request' as const, path, method: 'POST' as const, headers: { 'content-type': 'application/json' }, body: Buffer.from(body).toString('base64') });

describe('App-only backend transport', () => {
  it('preserves complete UI JSON without the model payload budget', async () => {
    const html = '<p>完整源码😀</p>'.repeat(30000), expected = JSON.stringify({ ok: true, data: { html } });
    const app = transport(async input => { expect(input.path).toBe('/api/tools/artifact_read'); return new Response(expected, { headers: { 'content-type': 'application/json' } }); });
    const response = await app.execute(request('/api/tools/artifact_read')) as AppResponse;
    expect(response.size).toBe(Buffer.byteLength(expected)); expect(response.body).toBeUndefined(); expect(response.downloadId).toBeTruthy();
    const chunks: Buffer[] = []; let offset = 0;
    do {
      const part = await app.execute({ action: 'download', transferId: response.downloadId!, offset }) as AppDownloadResult;
      const bytes = Buffer.from(part.data, 'base64'); expect(bytes.length).toBeLessThanOrEqual(APP_CHUNK_BYTES);
      expect(part.nextOffset).toBe(offset + bytes.length); expect(part.done).toBe(part.nextOffset === response.size);
      chunks.push(bytes); offset = part.nextOffset;
    } while (offset < response.size);
    expect(Buffer.concat(chunks).toString()).toBe(expected);
    await expect(app.execute({ action: 'download', transferId: response.downloadId!, offset: 0 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(await app.execute({ action: 'release', transferId: response.downloadId! })).toEqual({ released: true });
    await expect(app.execute({ action: 'download', transferId: response.downloadId!, offset: 0 })).rejects.toMatchObject({ code: 'TRANSFER_EXPIRED' });
  });

  it('assembles ordered upload chunks and consumes the completed upload exactly once', async () => {
    const expected = Buffer.alloc(APP_CHUNK_BYTES + 19, 0x6a);
    const app = transport(async input => { expect(Buffer.from(input.body!)).toEqual(expected); return new Response('created', { status: 201 }); });
    const first = await app.execute({ action: 'upload', offset: 0, size: expected.length, data: expected.subarray(0, APP_CHUNK_BYTES).toString('base64') }) as AppUploadResult;
    expect(first.nextOffset).toBe(APP_CHUNK_BYTES);
    await expect(app.execute({ ...request('/api/import'), body: undefined, uploadId: first.transferId })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(app.execute({ action: 'upload', transferId: first.transferId, offset: 0, size: expected.length, data: 'YQ==' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const next = await app.execute({ action: 'upload', transferId: first.transferId, offset: APP_CHUNK_BYTES, size: expected.length, data: expected.subarray(APP_CHUNK_BYTES).toString('base64') }) as AppUploadResult;
    expect(next.nextOffset).toBe(expected.length);
    const response = await app.execute({ ...request('/api/import'), body: undefined, uploadId: first.transferId }) as AppResponse;
    expect(response.status).toBe(201); expect(Buffer.from(response.body!, 'base64').toString()).toBe('created');
    await expect(app.execute({ ...request('/api/import'), body: undefined, uploadId: first.transferId })).rejects.toMatchObject({ code: 'TRANSFER_EXPIRED' });
  });

  it('keeps transfer IDs private to each MCP connection and expires idle buffers', async () => {
    vi.useFakeTimers();
    const first = transport(), second = transport();
    const upload = await first.execute({ action: 'upload', offset: 0, size: 2, data: 'YQ==' }) as AppUploadResult;
    await expect(second.execute({ action: 'upload', transferId: upload.transferId, offset: 1, size: 2, data: 'Yg==' })).rejects.toMatchObject({ code: 'TRANSFER_EXPIRED' });
    vi.advanceTimersByTime(120_001);
    await expect(first.execute({ action: 'upload', transferId: upload.transferId, offset: 1, size: 2, data: 'Yg==' })).rejects.toMatchObject({ code: 'TRANSFER_EXPIRED' });
  });

  it('bounds idle transfers, inline bodies and declared response sizes', async () => {
    const app = transport();
    for (let index = 0; index < 8; index++) await app.execute({ action: 'upload', offset: 0, size: 2, data: 'YQ==' });
    await expect(app.execute({ action: 'upload', offset: 0, size: 2, data: 'YQ==' })).rejects.toMatchObject({ code: 'BUSY' });
    await expect(app.execute({ ...request(), body: Buffer.alloc(APP_CHUNK_BYTES + 1).toString('base64') })).rejects.toBeDefined();
    await expect(app.execute({ action: 'upload', offset: 0, size: APP_MAX_BYTES + 1, data: 'YQ==' })).rejects.toBeDefined();
    const oversized = transport(async () => new Response('x', { headers: { 'content-length': String(APP_MAX_BYTES + 1) } }));
    await expect(oversized.execute(request())).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('bounds concurrent requests and rejects requests after teardown', async () => {
    const resolvers: Array<(value: Response) => void> = [];
    const app = transport(() => new Promise(resolve => resolvers.push(resolve)));
    const pending = Array.from({ length: 4 }, () => app.execute(request()));
    await expect(app.execute(request())).rejects.toMatchObject({ code: 'BUSY' });
    for (const resolve of resolvers) resolve(new Response('ok'));
    await Promise.all(pending);
    app.close(); await expect(app.execute(request())).rejects.toMatchObject({ code: 'CLOSED' });
  });

  it.each([
    'https://evil.example/api/session', '//evil.example/api/session', '/api/../api/session', '/api/%2e%2e/api/session', '/api/%252e%252e/api/session', '/api\\session', '/api/events', '/api/tools/not_a_tool', '/api/session?token=secret', '/api/session?share=secret', '/api/session#fragment',
  ])('rejects authority changes, traversal, credentials and unlisted endpoints: %s', path => {
    expect(() => validateUiRequest({ path, method: 'GET', headers: {} })).toThrow();
  });

  it('allows only the eight existing tool endpoints and the UI asset/presence routes', () => {
    const names = ['studio_open', 'artifact_list', 'artifact_manage', 'artifact_read', 'artifact_apply', 'artifact_feedback', 'artifact_share', 'artifact_export'];
    for (const name of names) expect(validateUiRequest({ path: `/api/tools/${name}`, method: 'POST', headers: {} }).path).toBe(`/api/tools/${name}`);
    for (const path of ['/api/session', '/api/presence?artifactId=one', '/assets/one/file.png', '/api/exports/file', '/api/thumbnails/one']) expect(validateUiRequest({ path, method: 'GET', headers: {} }).path).toBe(path);
    for (const path of ['/api/assets?artifactId=one', '/api/import', '/api/presence']) expect(validateUiRequest({ path, method: 'POST', headers: {} }).path).toBe(path);
    for (const header of ['authorization', 'cookie', 'x-studio-actor', 'x-studio-name', 'host']) expect(() => validateUiRequest({ path: '/api/session', method: 'GET', headers: { [header]: 'override' } })).toThrow();
    expect(validateUiRequest({ path: '/api/import', method: 'POST', headers: { 'Content-Type': 'application/zip' } }).headers).toEqual({ 'content-type': 'application/zip' });
  });

  it('allows a single nonnegative integer thumbnail revision only on thumbnail reads', () => {
    for (const value of ['0', '1', String(Number.MAX_SAFE_INTEGER)]) expect(validateUiRequest({ path: `/api/thumbnails/one?revision=${value}`, method: 'GET', headers: {} }).path).toContain(`revision=${value}`);
    for (const query of ['revision=-1', 'revision=1.5', 'revision=NaN', 'revision=01', 'revision=', 'revision=1e2', `revision=${Number.MAX_SAFE_INTEGER + 1}`, 'revision=1&revision=2', 'revision=1&token=secret', 'revision=1&unknown=2', 'revision=1&artifactId=other']) expect(() => validateUiRequest({ path: `/api/thumbnails/one?${query}`, method: 'GET', headers: {} })).toThrow();
    expect(() => validateUiRequest({ path: '/api/session?revision=1', method: 'GET', headers: {} })).toThrow();
    expect(() => validateUiRequest({ path: '/api/presence?artifactId=one&artifactId=two', method: 'GET', headers: {} })).toThrow();
  });
});
