import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { startStudioHost, type StudioHost } from '../src/server/http';
import { createAppTransport, validateUiRequest } from '../src/server/app-transport';
import { createRegionReaders } from '../src/server/region-reader';
import { LOCAL_ACTOR, type Board } from '../src/contracts/studio';
import type { AppResponse } from '../src/contracts/transport';

let directory: string, host: StudioHost, board: Board;
const viewId = 'reader-source-view';
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-region-reader-'));
  host = await startStudioHost({ dataRoot: directory, html: '<html><head></head><body><div id="root"></div></body></html>' });
  const created = await host.service.execute('artifact_manage', { action: 'create', title: '原白板', elements: [
    { id: 'html-one', type: 'html', w: 1440, h: 1120, text: '原图', html: '<h1>Original source</h1>', state: { count: 3 } },
    { id: 'html-two', type: 'html', text: '私密另一图', html: '<p>Other region secret</p>' },
    { id: 'plain-text', type: 'text', text: 'Native text' },
  ] });
  board = created.board;
});
afterEach(async () => {
  await host?.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory');
  await rm(directory, { recursive: true, force: true });
});
async function create(token = host.token, artifactId = board.artifact.id, regionId = 'html-one') {
  const response = await fetch(`${host.origin}/api/region-view`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId, regionId, viewId }) });
  return { response, result: await response.json() };
}
function readerRequest(link: string, suffix = '', init?: RequestInit) {
  const url = new URL(link), capability = new URLSearchParams(url.hash.slice(1)).get('cap');
  return fetch(`${host.origin}/api/region-reader/${board.artifact.id}/html-one${suffix}`, { ...init, headers: { Authorization: `Bearer ${capability}`, ...init?.headers } });
}

describe('single-region reader capabilities', () => {
  it('opens the same live source without exposing owner credentials or other regions', async () => {
    const { response, result } = await create();
    expect(response.status).toBe(200); expect(result.data.url).not.toContain(host.token);
    const page = await fetch(result.data.url), html = await page.text();
    expect(html).toContain('__STUDIO_READER_BOOT__'); expect(html).not.toContain('__STUDIO_BOOT__'); expect(html).not.toContain(host.token);
    const source = await (await readerRequest(result.data.url)).json();
    expect(source.data).toMatchObject({ artifactId: board.artifact.id, regionId: 'html-one', title: '原图', element: { html: '<h1>Original source</h1>', state: { count: 3 } } });
    expect(JSON.stringify(source)).not.toContain('Other region secret');
    const capability = new URLSearchParams(new URL(result.data.url).hash.slice(1)).get('cap');
    expect((await fetch(`${host.origin}/api/region-reader/${board.artifact.id}/html-two`, { headers: { Authorization: `Bearer ${capability}` } })).status).toBe(403);
    expect((await fetch(`${host.origin}/api/tools/artifact_read`, { method: 'POST', headers: { Authorization: `Bearer ${capability}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId: board.artifact.id }) })).status).toBe(401);
    expect((await fetch(`${host.origin}/api/tools/artifact_apply`, { method: 'POST', headers: { Authorization: `Bearer ${capability}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId: board.artifact.id, operationId: randomUUID(), operations: [] }) })).status).toBe(401);
    await host.service.execute('artifact_apply', { artifactId: board.artifact.id, expectedRevision: board.artifact.revision, operationId: randomUUID(), operations: [{ op: 'update', id: 'html-one', changes: { html: '<h1>Updated source</h1>' } }] });
    const metadata = (await (await readerRequest(result.data.url, '?metadata=1')).json()).data;
    expect(metadata.sourceRevision).toBeGreaterThan(source.data.sourceRevision); expect(metadata).not.toHaveProperty('element'); expect(JSON.stringify(metadata)).not.toContain('Updated source');
    expect((await (await readerRequest(result.data.url)).json()).data.element.html).toBe('<h1>Updated source</h1>');
    expect((await host.service.execute('artifact_list')).artifacts).toHaveLength(1);
    expect((await host.service.execute('artifact_share', { artifactId: board.artifact.id, action: 'status' })).enabled).toBe(false);
  });

  it('fixes return intents to the original target and consumes them once through authorized UI RPC', async () => {
    const { result } = await create();
    const bad = await readerRequest(result.data.url, '/return', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ annotate: true, regionId: 'html-two' }) });
    expect(bad.status).toBe(400);
    expect((await readerRequest(result.data.url, '/return', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ annotate: true }) })).status).toBe(200);
    const transport = createAppTransport(async request => fetch(host.origin + request.path, { method: request.method, headers: { ...request.headers, Authorization: `Bearer ${host.token}` }, body: request.body ? Buffer.from(request.body) : undefined }));
    try {
      const input = { action: 'request' as const, path: `/api/region-view?artifactId=${board.artifact.id}&viewId=${viewId}` };
      const reply = await transport.execute(input) as AppResponse;
      expect(JSON.parse(Buffer.from(reply.body!, 'base64').toString()).data.navigation).toEqual({ artifactId: board.artifact.id, regionId: 'html-one', viewId, annotate: true });
      const second = await transport.execute(input) as AppResponse;
      expect(JSON.parse(Buffer.from(second.body!, 'base64').toString()).data).toEqual({});
    } finally { transport.close(); }
  });

  it('creates through the UI-only RPC whitelist and rejects scope, credential and endpoint injection', async () => {
    const transport = createAppTransport(async request => fetch(host.origin + request.path, { method: request.method, headers: { ...request.headers, Authorization: `Bearer ${host.token}` }, body: request.body ? Buffer.from(request.body) : undefined }));
    try {
      const reply = await transport.execute({ action: 'request', path: '/api/region-view', method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ artifactId: board.artifact.id, regionId: 'html-one', viewId })).toString('base64') }) as AppResponse;
      expect(reply.status).toBe(200); expect(JSON.parse(Buffer.from(reply.body!, 'base64').toString()).data.url).toContain('/region/');
      expect(() => validateUiRequest({ path: '/api/region-view?token=owner', method: 'GET', headers: {} })).toThrow();
      expect(() => validateUiRequest({ path: `/api/region-reader/${board.artifact.id}/html-one`, method: 'GET', headers: {} })).toThrow();
      expect((await create(host.token, board.artifact.id, 'plain-text')).response.status).toBe(404);
    } finally { transport.close(); }
  });

  it('retains viewer read-only permissions and revokes capabilities when their source share is reset', async () => {
    const shared = await host.service.execute('artifact_share', { artifactId: board.artifact.id, action: 'start' });
    const viewerToken = new URL(shared.links.viewer).searchParams.get('share')!;
    const { response, result } = await create(viewerToken);
    expect(response.status).toBe(200);
    expect((await (await readerRequest(result.data.url)).json()).data.canAnnotate).toBe(false);
    expect(host.hasActiveReaders()).toBe(true);
    expect((await readerRequest(result.data.url, '/return', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ annotate: true }) })).status).toBe(403);
    const other = await host.service.execute('artifact_manage', { action: 'create' });
    expect((await create(viewerToken, other.artifact.id)).response.status).toBe(401);
    await host.service.execute('artifact_share', { artifactId: board.artifact.id, action: 'reset', role: 'viewer' });
    expect(host.hasActiveReaders()).toBe(false);
    expect((await readerRequest(result.data.url)).status).toBe(401);
    expect((await readerRequest(result.data.url, '/return', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ annotate: false }) })).status).toBe(401);
  });

  it('expires independent capabilities and refuses removed original regions', async () => {
    let now = 1000;
    const readers = createRegionReaders(host.service, () => now);
    const link = await readers.create({ actor: LOCAL_ACTOR, token: host.token, owner: true }, { artifactId: board.artifact.id, regionId: 'html-one', viewId }, host.origin);
    const capability = new URLSearchParams(new URL(link.url).hash.slice(1)).get('cap')!;
    now = link.expiresAt;
    await expect(readers.source(capability, board.artifact.id, 'html-one', false)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const expiring = await create();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(expiring.result.data.expiresAt);
    try { expect((await readerRequest(expiring.result.data.url)).status).toBe(401); }
    finally { clock.mockRestore(); }
    const live = await create();
    await host.service.execute('artifact_apply', { artifactId: board.artifact.id, expectedRevision: board.artifact.revision, operationId: randomUUID(), operations: [{ op: 'delete', id: 'html-one' }] });
    expect((await readerRequest(live.result.data.url)).status).toBe(404);
    readers.close();
  });

  it('keeps the managed host alive only for recently read, unexpired capabilities', async () => {
    expect(host.hasActiveReaders()).toBe(false);
    const { result } = await create();
    expect(host.hasActiveReaders()).toBe(false);
    await fetch(result.data.url);
    expect(host.hasActiveReaders()).toBe(false);
    const startedAt = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(startedAt);
    try {
      expect((await readerRequest(result.data.url)).status).toBe(200);
      expect(host.hasActiveReaders()).toBe(true);
      clock.mockReturnValue(startedAt + 30_000);
      expect((await readerRequest(result.data.url, '?metadata=1')).status).toBe(200);
      clock.mockReturnValue(startedAt + 46_000);
      expect(host.hasActiveReaders()).toBe(true);
      clock.mockReturnValue(startedAt + 75_001);
      expect(host.hasActiveReaders()).toBe(false);
      clock.mockReturnValue(result.data.expiresAt - 1);
      expect((await readerRequest(result.data.url)).status).toBe(200);
      expect(host.hasActiveReaders()).toBe(true);
      clock.mockReturnValue(result.data.expiresAt);
      expect(host.hasActiveReaders()).toBe(false);
      expect((await readerRequest(result.data.url)).status).toBe(401);
      expect(host.hasActiveReaders()).toBe(false);
    } finally { clock.mockRestore(); }
  });

  it('invalidates owner capabilities, pending returns and managed activity immediately on permanent deletion', async () => {
    let listener!: (event: { type: string; artifactId: string }) => void;
    const subscribe = vi.spyOn(host.service, 'subscribe').mockImplementation((_artifactId, callback) => { listener = callback; return () => {}; });
    const readers = createRegionReaders(host.service);
    subscribe.mockRestore();
    try {
      const link = await readers.create({ actor: LOCAL_ACTOR, token: host.token, owner: true }, { artifactId: board.artifact.id, regionId: 'html-one', viewId }, host.origin);
      const capability = new URLSearchParams(new URL(link.url).hash.slice(1)).get('cap')!;
      await readers.source(capability, board.artifact.id, 'html-one', false);
      await readers.returnToBoard(capability, board.artifact.id, 'html-one', true);
      expect(readers.hasActiveReaders()).toBe(true);
      listener({ type: 'purged', artifactId: board.artifact.id });
      expect(readers.hasActiveReaders()).toBe(false);
      expect(await readers.takeReturn({ actor: LOCAL_ACTOR, token: host.token, owner: true }, board.artifact.id, viewId)).toEqual({});
      await expect(readers.source(capability, board.artifact.id, 'html-one', false)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    } finally { readers.close(); }
  });

  it('revokes a live owner reader and pending return through the real trash and purge HTTP flow', async () => {
    const { result } = await create();
    expect((await readerRequest(result.data.url)).status).toBe(200);
    expect((await readerRequest(result.data.url, '/return', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ annotate: true }) })).status).toBe(200);
    expect(host.hasActiveReaders()).toBe(true);
    const manage = (action: string) => fetch(`${host.origin}/api/tools/artifact_manage`, { method: 'POST', headers: { Authorization: `Bearer ${host.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, artifactId: board.artifact.id }) });
    expect((await manage('trash')).status).toBe(200);
    const purged = await manage('purge');
    expect(purged.status).toBe(200); expect((await purged.json()).data).toEqual({ deletedIds: [board.artifact.id], failures: [] });
    expect(host.hasActiveReaders()).toBe(false);
    expect((await readerRequest(result.data.url)).status).toBe(401);
    const returned = await fetch(`${host.origin}/api/region-view?artifactId=${board.artifact.id}&viewId=${viewId}`, { headers: { Authorization: `Bearer ${host.token}` } });
    expect(returned.status).toBe(200); expect((await returned.json()).data).toEqual({});
  });
});
