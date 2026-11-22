import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APP_CHUNK_BYTES,
  APP_MAX_BYTES,
  type AppResponse,
  type AppTransferSpoolFactory,
  type AppUploadResult,
  type AppDownloadResult,
  type UiRequester,
} from '../../src/contracts/transport.js';
import { createAppTransport, validateUiRequest } from '../../src/server/app-transport.js';

const transports: ReturnType<typeof createAppTransport>[] = [];
afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.close()));
  vi.useRealTimers();
});

function transport(
  run: UiRequester = async () => new Response('{}'),
  spool?: AppTransferSpoolFactory,
) {
  const value = createAppTransport(run, spool);
  transports.push(value);

  return value;
}

const request = (path = '/api/tools/artifact_list', body = '{}') => ({
  action: 'request' as const,
  path,
  method: 'POST' as const,
  headers: { 'content-type': 'application/json' },
  body: Buffer.from(body).toString('base64'),
});

describe('App-only backend transport', () => {
  it('accepts bounded collaboration waits and room writes without exposing credentials or an infinite stream', () => {
    const path =
      '/api/sync?artifactId=one&after=epoch_1:15&wait=20000&peerId=view-one&peerEpoch=page-one';
    expect(validateUiRequest({ path, method: 'GET', headers: {} }).path).toBe(path);
    expect(
      validateUiRequest({
        path: '/api/room?artifactId=one',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }).path,
    ).toBe('/api/room?artifactId=one');

    for (const query of [
      'wait=-1',
      'wait=20001',
      'wait=1e3',
      'after=invalid',
      'after=epoch:1&after=epoch:2',
      'peerId=../x',
      'peerEpoch=',
      'token=private',
      'share=private',
      'unknown=1',
    ]) {
      expect(() =>
        validateUiRequest({
          path: `/api/sync?artifactId=one&${query}`,
          method: 'GET',
          headers: {},
        }),
      ).toThrow();
    }

    expect(() => validateUiRequest({ path: '/api/sync', method: 'POST', headers: {} })).toThrow();
    expect(() => validateUiRequest({ path: '/api/room', method: 'GET', headers: {} })).toThrow();
    expect(() => validateUiRequest({ path: '/api/events', method: 'GET', headers: {} })).toThrow();
  });
  it('preserves complete UI JSON without the model payload budget', async () => {
    const html = '<p>完整源码😀</p>'.repeat(30000);
    const expected = JSON.stringify({ ok: true, data: { html } });
    const app = transport(async (input) => {
      expect(input.path).toBe('/api/tools/artifact_read');

      return new Response(expected, { headers: { 'content-type': 'application/json' } });
    });
    const response = (await app.execute(request('/api/tools/artifact_read'))) as AppResponse;
    expect(response.size).toBe(Buffer.byteLength(expected));
    expect(response.body).toBeUndefined();
    expect(response.downloadId).toBeTruthy();
    const chunks: Buffer[] = [];
    let offset = 0;
    do {
      const part = (await app.execute({
        action: 'download',
        transferId: response.downloadId!,
        offset,
      })) as AppDownloadResult;
      const bytes = Buffer.from(part.data, 'base64');
      expect(bytes.length).toBeLessThanOrEqual(APP_CHUNK_BYTES);
      expect(part.nextOffset).toBe(offset + bytes.length);
      expect(part.done).toBe(part.nextOffset === response.size);
      chunks.push(bytes);
      offset = part.nextOffset;
    } while (offset < response.size);

    expect(Buffer.concat(chunks).toString()).toBe(expected);
    await expect(
      app.execute({ action: 'download', transferId: response.downloadId!, offset: 0 }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(await app.execute({ action: 'release', transferId: response.downloadId! })).toEqual({
      released: true,
    });
    await expect(
      app.execute({ action: 'download', transferId: response.downloadId!, offset: 0 }),
    ).rejects.toMatchObject({ code: 'TRANSFER_EXPIRED' });
  });

  it('assembles ordered upload chunks and consumes the completed upload exactly once', async () => {
    const expected = Buffer.alloc(APP_CHUNK_BYTES + 19, 0x6a);
    const app = transport(async (input) => {
      expect(Buffer.from(input.body!)).toEqual(expected);

      return new Response('created', { status: 201 });
    });
    const first = (await app.execute({
      action: 'upload',
      offset: 0,
      size: expected.length,
      data: expected.subarray(0, APP_CHUNK_BYTES).toString('base64'),
    })) as AppUploadResult;
    expect(first.nextOffset).toBe(APP_CHUNK_BYTES);
    await expect(
      app.execute({ ...request('/api/import'), body: undefined, uploadId: first.transferId }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      app.execute({
        action: 'upload',
        transferId: first.transferId,
        offset: 0,
        size: expected.length,
        data: 'YQ==',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const next = (await app.execute({
      action: 'upload',
      transferId: first.transferId,
      offset: APP_CHUNK_BYTES,
      size: expected.length,
      data: expected.subarray(APP_CHUNK_BYTES).toString('base64'),
    })) as AppUploadResult;
    expect(next.nextOffset).toBe(expected.length);
    const response = (await app.execute({
      ...request('/api/import'),
      body: undefined,
      uploadId: first.transferId,
    })) as AppResponse;
    expect(response.status).toBe(201);
    expect(Buffer.from(response.body!, 'base64').toString()).toBe('created');
    await expect(
      app.execute({ ...request('/api/import'), body: undefined, uploadId: first.transferId }),
    ).rejects.toMatchObject({ code: 'TRANSFER_EXPIRED' });
  });

  it('keeps transfer IDs private to each MCP connection and expires idle buffers', async () => {
    vi.useFakeTimers();
    const first = transport();
    const second = transport();
    const upload = (await first.execute({
      action: 'upload',
      offset: 0,
      size: 2,
      data: 'YQ==',
    })) as AppUploadResult;
    await expect(
      second.execute({
        action: 'upload',
        transferId: upload.transferId,
        offset: 1,
        size: 2,
        data: 'Yg==',
      }),
    ).rejects.toMatchObject({ code: 'TRANSFER_EXPIRED' });
    vi.advanceTimersByTime(120_001);
    await expect(
      first.execute({
        action: 'upload',
        transferId: upload.transferId,
        offset: 1,
        size: 2,
        data: 'Yg==',
      }),
    ).rejects.toMatchObject({ code: 'TRANSFER_EXPIRED' });
  });

  it('cancels and clears a partial ZIP spool while waiting for the next response chunk', async () => {
    const append = vi.fn(async () => undefined);
    const dispose = vi.fn(async () => undefined);
    const cancel = vi.fn();
    const controller = new AbortController();
    const app = transport(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              stream.enqueue(Buffer.alloc(9 * APP_CHUNK_BYTES));
            },
            cancel,
          }),
          { headers: { 'content-type': 'application/zip' } },
        ),
      async () => ({
        append,
        read: async () => new Uint8Array(),
        blob: async () => new Blob(),
        dispose,
      }),
    );
    const pending = app.execute(
      { action: 'request', path: '/api/exports/one', method: 'GET' },
      controller.signal,
    );
    await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(1));
    controller.abort(new Error('Stopped ZIP transfer'));
    await expect(pending).rejects.toThrow('Stopped ZIP transfer');
    expect(cancel).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('disposes an idle partial upload when it expires and closes another pending spool once', async () => {
    vi.useFakeTimers();
    const dispose = vi.fn(async () => undefined);
    const app = transport(undefined, async () => ({
      append: async () => undefined,
      read: async () => new Uint8Array(),
      blob: async () => new Blob(),
      dispose,
    }));
    const input = { action: 'upload', size: 9 * APP_CHUNK_BYTES, offset: 0, data: 'YQ==' } as const;
    const first = (await app.execute(input)) as AppUploadResult;
    vi.advanceTimersByTime(120_001);
    await expect(app.execute({ action: 'release', transferId: first.transferId })).resolves.toEqual(
      { released: false },
    );
    await app.execute(input);
    await Promise.all([app.close(), app.close()]);
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('bounds idle transfers, inline bodies and declared response sizes', async () => {
    const app = transport();
    for (let index = 0; index < 8; index++) {
      await app.execute({ action: 'upload', offset: 0, size: 2, data: 'YQ==' });
    }

    await expect(
      app.execute({ action: 'upload', offset: 0, size: 2, data: 'YQ==' }),
    ).rejects.toMatchObject({ code: 'BUSY' });
    await expect(
      app.execute({ ...request(), body: Buffer.alloc(APP_CHUNK_BYTES + 1).toString('base64') }),
    ).rejects.toBeDefined();
    await expect(
      app.execute({ action: 'upload', offset: 0, size: APP_MAX_BYTES + 1, data: 'YQ==' }),
    ).rejects.toBeDefined();
    const oversized = transport(
      async () => new Response('x', { headers: { 'content-length': String(APP_MAX_BYTES + 1) } }),
    );
    await expect(oversized.execute(request())).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('bounds active requests while queueing another App request and rejects requests after teardown', async () => {
    const resolvers: Array<(value: Response) => void> = [];
    const app = transport(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const pending = Array.from({ length: 5 }, () => app.execute(request()));
    await vi.waitFor(() => expect(resolvers).toHaveLength(4));
    for (const resolve of resolvers.slice(0, 4)) {
      resolve(new Response('ok'));
    }

    await Promise.all(pending.slice(0, 4));
    expect(resolvers).toHaveLength(5);
    resolvers[4]!(new Response('queued'));
    await Promise.all(pending);
    await app.close();
    await expect(app.execute(request())).rejects.toMatchObject({ code: 'CLOSED' });
  });

  it('keeps four parked sync requests out of the business budget shared by App views', async () => {
    const waits: Array<(value: Response) => void> = [];
    const app = transport(async (input) =>
      input.path.startsWith('/api/sync')
        ? new Promise((resolve) => {
            waits.push(resolve);
          })
        : new Response('published'),
    );
    const pending = Array.from({ length: 4 }, (_, index) =>
      app.execute({
        action: 'request',
        path: `/api/sync?artifactId=board&wait=20000&peerId=page-${index}`,
      }),
    );
    await vi.waitFor(() => expect(waits).toHaveLength(4));
    const result = (await app.execute(request('/api/presence'))) as AppResponse;
    expect(Buffer.from(result.body!, 'base64').toString()).toBe('published');
    waits.forEach((resolve) => resolve(new Response('{}')));
    await Promise.all(pending);
  });

  it('cancels queued business requests without starting them and keeps both budgets usable', async () => {
    const resolvers: Array<(value: Response) => void> = [];
    const app = transport(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const active = Array.from({ length: 4 }, () => app.execute(request()));
    await vi.waitFor(() => expect(resolvers).toHaveLength(4));
    const abort = new AbortController();
    const queued = app.execute(request(), abort.signal);
    abort.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    expect(resolvers).toHaveLength(4);
    resolvers.forEach((resolve) => resolve(new Response('{}')));
    await Promise.all(active);
    expect(resolvers).toHaveLength(4);
  });

  it('bounds parked waits and releases their slots when their fetch is aborted', async () => {
    const app = transport(
      (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
        }),
    );
    const abort = new AbortController();
    const input = { action: 'request' as const, path: '/api/sync?artifactId=board&wait=20000' };
    const pending = Array.from({ length: 64 }, () =>
      app.execute(input, abort.signal).catch((error) => error),
    );
    await expect(app.execute(input)).rejects.toMatchObject({ code: 'BUSY' });
    abort.abort();
    expect((await Promise.all(pending)).every((error) => error.name === 'AbortError')).toBe(true);
    const nextAbort = new AbortController();
    const next = app.execute(input, nextAbort.signal);
    await Promise.resolve();
    nextAbort.abort();
    await expect(next).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each([
    'https://evil.example/api/session',
    '//evil.example/api/session',
    '/api/../api/session',
    '/api/%2e%2e/api/session',
    '/api/%252e%252e/api/session',
    '/api\\session',
    '/api/events',
    '/api/tools/not_a_tool',
    '/api/session?token=secret',
    '/api/session?share=secret',
    '/api/session#fragment',
  ])('rejects authority changes, traversal, credentials and unlisted endpoints: %s', (path) => {
    expect(() => validateUiRequest({ path, method: 'GET', headers: {} })).toThrow();
  });

  it('allows only the eight existing tool endpoints and the UI asset/presence routes', () => {
    const names = [
      'studio_open',
      'artifact_list',
      'artifact_manage',
      'artifact_read',
      'artifact_apply',
      'artifact_feedback',
      'artifact_share',
      'artifact_export',
    ];

    for (const name of names) {
      expect(
        validateUiRequest({ path: `/api/tools/${name}`, method: 'POST', headers: {} }).path,
      ).toBe(`/api/tools/${name}`);
    }

    for (const path of [
      '/api/session',
      '/api/presence?artifactId=one',
      '/assets/one/file.png',
      '/api/exports/file',
      '/api/thumbnails/one',
    ]) {
      expect(validateUiRequest({ path, method: 'GET', headers: {} }).path).toBe(path);
    }

    for (const path of ['/api/assets?artifactId=one', '/api/import', '/api/presence']) {
      expect(validateUiRequest({ path, method: 'POST', headers: {} }).path).toBe(path);
    }

    for (const header of ['authorization', 'cookie', 'x-studio-actor', 'x-studio-name', 'host']) {
      expect(() =>
        validateUiRequest({
          path: '/api/session',
          method: 'GET',
          headers: { [header]: 'override' },
        }),
      ).toThrow();
    }

    expect(
      validateUiRequest({
        path: '/api/import',
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
      }).headers,
    ).toEqual({ 'content-type': 'application/zip' });
  });

  it('allows a single nonnegative integer thumbnail revision only on thumbnail reads', () => {
    for (const value of ['0', '1', String(Number.MAX_SAFE_INTEGER)]) {
      expect(
        validateUiRequest({
          path: `/api/thumbnails/one?revision=${value}`,
          method: 'GET',
          headers: {},
        }).path,
      ).toContain(`revision=${value}`);
    }

    for (const query of [
      'revision=-1',
      'revision=1.5',
      'revision=NaN',
      'revision=01',
      'revision=',
      'revision=1e2',
      `revision=${Number.MAX_SAFE_INTEGER + 1}`,
      'revision=1&revision=2',
      'revision=1&token=secret',
      'revision=1&unknown=2',
      'revision=1&artifactId=other',
    ]) {
      expect(() =>
        validateUiRequest({ path: `/api/thumbnails/one?${query}`, method: 'GET', headers: {} }),
      ).toThrow();
    }

    expect(() =>
      validateUiRequest({ path: '/api/session?revision=1', method: 'GET', headers: {} }),
    ).toThrow();
    expect(() =>
      validateUiRequest({
        path: '/api/presence?artifactId=one&artifactId=two',
        method: 'GET',
        headers: {},
      }),
    ).toThrow();
  });
});
