import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { connectStudio, writeRecord } from '../src/server/client.js';
import { startStudioHost, type StudioHost } from '../src/server/http.js';
import { createAppTransport } from '../src/server/app-transport.js';
import type { AppResponse } from '../src/contracts/transport.js';

let directory: string, host: StudioHost, client: Awaited<ReturnType<typeof connectStudio>>, transport: ReturnType<typeof createAppTransport>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'agentero-studio-app-http-'));
  host = await startStudioHost({ dataRoot: directory });
  await writeRecord(directory, { origin: host.origin, token: host.token, pid: process.pid, instanceId: randomUUID() });
  client = await connectStudio(directory);
  transport = createAppTransport(client.requestUi);
});
afterEach(async () => {
  transport?.close(); await client?.close(); await host?.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory');
  await rm(directory, { recursive: true, force: true });
});
async function ui(name: string, args: Record<string, unknown>) {
  const reply = await transport.execute({ action: 'request', path: `/api/tools/${name}`, method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(args)).toString('base64') }) as AppResponse;
  expect(reply.status).toBe(200);
  return JSON.parse(Buffer.from(reply.body!, 'base64').toString()).data;
}

describe('UI requests through the real connected authority', () => {
  it('injects the owner token and keeps human UI authors separate from agent tools', async () => {
    const session = await client.requestUi({ path: '/api/session', method: 'GET', headers: {} });
    expect(session.status).toBe(200); expect(await session.json()).toMatchObject({ owner: true, actor: { id: 'local', kind: 'human', role: 'owner' } });
    const created = await ui('artifact_manage', { action: 'create', title: 'Human-created board' });
    const human = await ui('artifact_apply', { artifactId: created.artifact.id, operationId: randomUUID(), operations: [{ op: 'add', element: { id: 'human-object', type: 'text', text: 'Human input' } }] });
    expect(human.board.elements).toHaveLength(1); expect(human.historyEntry.actor).toMatchObject({ id: 'local', kind: 'human', role: 'owner' });
    const agent = await client.execute('artifact_apply', { artifactId: created.artifact.id, operationId: randomUUID(), operations: [{ op: 'add', element: { id: 'agent-object', type: 'text', text: 'Agent input' } }] }) as any;
    expect(agent.historyEntry.actor).toMatchObject({ id: expect.stringMatching(/^agent-/), kind: 'agent', role: 'owner' });
  });

  it('rejects credential and identity injection before contacting HTTP', async () => {
    await expect(client.requestUi({ path: '/api/session', method: 'GET', headers: { Authorization: 'Bearer attacker' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(client.requestUi({ path: '/api/session', method: 'GET', headers: { 'X-Studio-Actor': 'agent' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(client.requestUi({ path: 'https://example.com/api/session', method: 'GET', headers: {} })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const response = await client.requestUi({ path: '/api/session', method: 'GET', headers: {} });
    expect(response.status).toBe(200);
  });

  it('fetches a real listed thumbnail with its revision through the RPC envelope', async () => {
    const created = await ui('artifact_manage', { action: 'create', title: 'Versioned thumbnail' });
    await ui('artifact_apply', { artifactId: created.artifact.id, operationId: randomUUID(), operations: [{ op: 'add', element: { id: 'preview-text', type: 'text', text: 'Thumbnail content' } }] });
    const listed = await ui('artifact_list', {});
    const artifact = listed.artifacts.find((value: { id: string }) => value.id === created.artifact.id);
    expect(artifact.thumbnail).toMatch(/\/api\/thumbnails\/[^?]+\?revision=\d+$/);
    const direct = await client.requestUi({ path: artifact.thumbnail, method: 'GET', headers: {} });
    expect(direct.status).toBe(200);
    const expected = Buffer.from(await direct.arrayBuffer());
    const reply = await transport.execute({ action: 'request', path: artifact.thumbnail, method: 'GET' }) as AppResponse;
    expect(reply.status).toBe(200); expect(reply.headers['content-type']).toBe(direct.headers.get('content-type'));
    expect(reply.headers['content-type']).toMatch(/^image\/(?:svg\+xml|png)/);
    expect(reply.size).toBe(expected.length); expect(reply.size).toBeGreaterThan(0);
    expect(Buffer.from(reply.body!, 'base64')).toEqual(expected);
  });

  it('creates a scoped region reader through the real connected authority', async () => {
    const created = await ui('artifact_manage', { action: 'create', title: 'Reader source', elements: [{ id: 'source-region', type: 'html', html: '<h1>Live region</h1>' }] });
    const reply = await transport.execute({ action: 'request', path: '/api/region-view', method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ artifactId: created.artifact.id, regionId: 'source-region', viewId: 'reader-view' })).toString('base64') }) as AppResponse;
    expect(reply.status).toBe(200);
    const link = JSON.parse(Buffer.from(reply.body!, 'base64').toString()).data.url as string;
    expect(link).not.toContain(host.token);
    const url = new URL(link), capability = new URLSearchParams(url.hash.slice(1)).get('cap');
    const source = await fetch(`${host.origin}/api/region-reader/${created.artifact.id}/source-region`, { headers: { Authorization: `Bearer ${capability}` } });
    expect(source.status).toBe(200); expect((await source.json()).data.element.html).toBe('<h1>Live region</h1>');
  });
});
