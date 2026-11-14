import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createRpcTransport } from '../src/app/rpc-transport.js';
import { LOCAL_ACTOR, TOOL_NAMES, type Board, type HistoryEntry, type ToolResponse } from '../src/contracts/studio.js';
import { APP_TOOL_NAME, type UiHttpRequest } from '../src/contracts/transport.js';
import { connectStudio, writeRecord } from '../src/server/client.js';
import { startStudioHost, type StudioHost } from '../src/server/http.js';
import { createStudioServer } from '../src/server/protocol.js';

const nativeFetch = globalThis.fetch.bind(globalThis);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64');
let directory: string;
let host: StudioHost;
let nodeClient: Awaited<ReturnType<typeof connectStudio>>;
let server: ReturnType<typeof createStudioServer>;
let client: Client;
let transport: ReturnType<typeof createRpcTransport>;
let browserFetch: ReturnType<typeof vi.fn>;
let actions: string[];
let activeTransfers: Set<string>;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-first-run-rpc-'));
  host = await startStudioHost({ dataRoot: directory });
  expect(host.service.store.root).toBe(resolve(directory));
  await writeRecord(directory, { origin: host.origin, token: host.token, pid: process.pid, instanceId: randomUUID() });
  nodeClient = await connectStudio(directory);

  // Node and the sandboxed app have separate fetch globals in the real host.
  // Preserve that boundary while sending every backend request to the real HTTP service.
  const requestUi = (request: UiHttpRequest, signal?: AbortSignal) => nativeFetch(`${host.origin}${request.path}`, {
    method: request.method,
    headers: { ...request.headers, Authorization: `Bearer ${host.token}` },
    body: request.body as BodyInit | undefined,
    signal,
  });
  server = createStudioServer({ ...nodeClient, requestUi }, '<!doctype html><html><head></head><body>Studio</body></html>');
  client = new Client({ name: 'studio-first-run-regression', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const opened = await client.callTool({ name: 'studio_open', arguments: {} });
  expect(opened.isError).not.toBe(true);
  expect(opened._meta?.connection).toMatchObject({ baseUrl: host.origin, actor: LOCAL_ACTOR });

  actions = []; activeTransfers = new Set();
  transport = createRpcTransport(host.origin, async (args, signal) => {
    actions.push(String(args.action));
    const result = await client.callTool({ name: APP_TOOL_NAME, arguments: args }, undefined, { signal });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([]);
    // Full app bytes must travel through private metadata, outside model results.
    expect(JSON.stringify(result.structuredContent ?? {}).length).toBeLessThan(1024);
    const response = result._meta?.response as Record<string, unknown> | undefined;
    expect(response).toBeDefined();
    if (typeof response?.transferId === 'string' && args.action === 'upload') activeTransfers.add(response.transferId);
    if (typeof response?.downloadId === 'string') activeTransfers.add(response.downloadId);
    if (args.action === 'release') activeTransfers.delete(String(args.transferId));
    return response;
  });
  browserFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  vi.stubGlobal('fetch', browserFetch);
});

afterEach(async () => {
  try {
    transport?.close();
    await client?.close();
    await server?.close();
    await nodeClient?.close();
    await host?.close();
    expect(browserFetch).not.toHaveBeenCalled();
    expect(await readdir(join(directory, 'leases'))).toEqual([]);
  } finally {
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory');
    await rm(directory, { recursive: true, force: true });
  }
});

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await transport.request(`/api/tools/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  expect(response.status).toBe(200);
  const value = await response.json() as ToolResponse<T>;
  expect(value.ok).toBe(true);
  return value.data!;
}
async function create() {
  return (await call<{ board: Board }>('artifact_manage', { action: 'create', title: '首次打开 🎨' })).board;
}

describe('first-run MCP App with unavailable browser networking', () => {
  it('loads the empty library through the actual MCP server while keeping eight model-visible tools', async () => {
    const { tools } = await client.listTools();
    const visible = tools.filter(tool => {
      const ui = tool._meta?.ui as { visibility?: string[] } | undefined;
      return !ui?.visibility || ui.visibility.includes('model');
    });
    expect(visible.map(tool => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools).toHaveLength(TOOL_NAMES.length + 1);
    expect(tools.find(tool => tool.name === APP_TOOL_NAME)?._meta).toMatchObject({ ui: { visibility: ['app'] } });
    expect(await call('artifact_list', {})).toMatchObject({ artifacts: [] });
    expect(actions).toEqual(['request']);
  });

  it('creates, changes and reads full large Unicode documents and preserves human authorship', async () => {
    const board = await create(), artifactId = board.artifact.id;
    const html = `<section><h1>完整文档</h1><p>${'作品🎨'.repeat(70_000)}</p></section>`;
    expect(html.length).toBeGreaterThan(240_000);
    const first = await call<{ board: Board; historyEntry: HistoryEntry }>('artifact_apply', {
      artifactId, expectedRevision: 0, operationId: randomUUID(),
      operations: [{ op: 'add', element: { id: 'html-region', type: 'html', html } }],
    });
    expect(first.board.elements[0]?.html).toBe(html);
    expect(first.historyEntry.actor).toEqual(LOCAL_ACTOR);
    const changedHtml = `${html}\n<!-- 用户保存的修订 🎨 -->`;
    const changed = await call<{ board: Board; historyEntry: HistoryEntry }>('artifact_apply', {
      artifactId, expectedRevision: 1, expectedVersions: { 'html-region': 1 }, operationId: randomUUID(),
      operations: [{ op: 'update', id: 'html-region', changes: { html: changedHtml } }],
    });
    expect(changed.board.elements[0]?.html).toBe(changedHtml);
    expect(changed.historyEntry.actor).toEqual(LOCAL_ACTOR);
    const reread = await call<Board>('artifact_read', { artifactId, mode: 'document' });
    expect(reread.artifact.revision).toBe(2);
    expect(reread.elements[0]?.html).toBe(changedHtml);
    expect(JSON.stringify(reread).length).toBeGreaterThan(240_000);
    const { history } = await call<{ history: HistoryEntry[] }>('artifact_read', { artifactId, mode: 'history' });
    expect(history).toHaveLength(3);
    expect(history.every(entry => entry.actor.kind === 'human' && entry.actor.role === 'owner')).toBe(true);
    expect(actions.filter(action => action === 'upload').length).toBeGreaterThan(2);
    expect(actions.filter(action => action === 'download').length).toBeGreaterThan(2);
    expect(activeTransfers.size).toBe(0);
  });

  it('loads saved image bytes through RPC into an object URL and releases it on close', async () => {
    const objectUrl = vi.spyOn(URL, 'createObjectURL');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const board = await create(), artifactId = board.artifact.id;
    const uploaded = await transport.request(`/api/assets?artifactId=${artifactId}`, {
      method: 'POST', headers: { 'Content-Type': 'image/png', 'X-Filename': encodeURIComponent('首张图片.png') }, body: png,
    });
    expect(uploaded.status).toBe(200);
    const asset = await uploaded.json() as { url: string };
    await call('artifact_apply', { artifactId, expectedRevision: 0, operations: [{ op: 'add', element: { id: 'picture', type: 'image', src: asset.url } }] });
    const reread = await call<Board>('artifact_read', { artifactId, mode: 'document' });
    expect(reread.elements[0]?.src).toBe(asset.url);
    expect(transport.assetUrl(asset.url)).toMatch(/^blob:/);
    expect(objectUrl).toHaveBeenCalledTimes(1);
    const blob = objectUrl.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('image/png');
    expect(Buffer.from(await blob.arrayBuffer())).toEqual(png);
    transport.close();
    expect(revoke).toHaveBeenCalledWith(objectUrl.mock.results[0]!.value);
    expect(transport.assetUrl(asset.url)).toBeUndefined();
    await expect(transport.request('/api/session')).rejects.toMatchObject({ code: 'CLOSED' });
    expect(activeTransfers.size).toBe(0);
  });
});
