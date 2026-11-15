import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectStudio, writeRecord } from '../src/server/client.js';
import { startStudioHost, type StudioHost } from '../src/server/http.js';
import { PLUGIN_VERSION } from '../src/contracts/version.js';
import { SERVICE_PROTOCOL_VERSION } from '../src/server/service-protocol.js';

const child = vi.hoisted(() => ({ spawn: vi.fn(() => { throw new Error('Unexpected authority spawn'); }) }));
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: child.spawn }));

let directory: string, host: StudioHost, client: Awaited<ReturnType<typeof connectStudio>>;
const nativeFetch = globalThis.fetch.bind(globalThis);
beforeEach(async () => {
  child.spawn.mockClear();
  directory = await mkdtemp(join(await realpath(tmpdir()), 'studio-record-refresh-'));
  host = await startStudioHost({ dataRoot: directory, ownerName: 'First synthetic owner' });
  await writeRecord(directory, { origin: host.origin, token: host.token, pid: process.pid, instanceId: randomUUID() });
  client = await connectStudio(directory);
  expect((await client.connection()).actor.name).toBe('First synthetic owner');
});

it('refuses a missing record while its known authority PID lives and resumes after record recovery', async () => {
  const recordPath = join(directory, 'service.json'), record = JSON.parse(await readFile(recordPath, 'utf8'));
  await unlink(recordPath); const dispatch = vi.spyOn(globalThis, 'fetch');
  try { await expect(client.execute('studio_open', { view: 'library' })).rejects.toMatchObject({ code: 'SERVICE_RECORD_UNAVAILABLE' }); }
  finally { await writeRecord(directory, record); }
  expect(child.spawn).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
  expect(await client.execute('studio_open', { view: 'library' })).toMatchObject({ view: 'library' });
  expect(child.spawn).not.toHaveBeenCalled(); expect(await readdir(join(directory, 'leases'))).toHaveLength(1);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await client?.close(); await host?.close();
  expect(await readdir(join(directory, 'leases'))).toEqual([]);
  const target = await realpath(directory); expect(dirname(target)).toBe(await realpath(tmpdir())); expect(basename(target)).toMatch(/^studio-record-refresh-/);
  await rm(target, { recursive: true, force: true });
});
async function restart() {
  await host.close(); host = await startStudioHost({ dataRoot: directory, ownerName: 'Restarted synthetic owner' });
  await writeRecord(directory, { origin: host.origin, token: host.token, pid: process.pid, instanceId: randomUUID() });
}

it.each(['execute', 'requestUi', 'connection'] as const)('refreshes %s and its cached owner after a same-version authority restart', async entry => {
  const old = await client.connection(); await restart(); expect(host.origin).not.toBe(old.baseUrl); expect(host.token).not.toBe(old.token);
  if (entry === 'execute') expect(await client.execute('studio_open', { view: 'library' })).toMatchObject({ view: 'library' });
  else if (entry === 'requestUi') {
    const response = await client.requestUi({ path: '/api/session', method: 'GET', headers: {} }); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ owner: true, actor: { name: 'Restarted synthetic owner' } });
  }
  const current = await client.connection(); expect(current).toMatchObject({ baseUrl: host.origin, token: host.token, actor: { name: 'Restarted synthetic owner' } });
  expect(await readdir(join(directory, 'leases'))).toHaveLength(1);
});

it.each(['execute', 'requestUi'] as const)('does not replay a committed %s POST when its response is lost and the record changes', async entry => {
  const original = host.origin, originalToken = host.token, writes: { origin: string; authorization: string | null }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/tools/artifact_manage') {
      writes.push({ origin: url.origin, authorization: new Headers(init?.headers).get('authorization') });
      const response = await nativeFetch(input, init); expect(response.status).toBe(200); await response.arrayBuffer();
      await restart(); throw new TypeError('Synthetic response lost after commit');
    }
    return nativeFetch(input, init);
  });
  const args = { action: 'create', title: 'Exactly one synthetic write' };
  const pending = entry === 'execute' ? client.execute('artifact_manage', args) : client.requestUi({ path: '/api/tools/artifact_manage', method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(args)) });
  await expect(pending).rejects.toThrow('Synthetic response lost after commit');
  expect(writes).toHaveLength(1); expect(writes[0]).toEqual({ origin: original, authorization: `Bearer ${originalToken}` });
  const result = await client.execute('artifact_list', {}) as { artifacts: unknown[] }; expect(result.artifacts).toHaveLength(1);
  expect((await client.connection()).baseUrl).toBe(host.origin); expect(writes).toHaveLength(1);
});

it('keeps the MCP participant namespace and one lease without pretending to resume expired activity', async () => {
  const participant = { id: 'stable-participant', name: 'Stable synthetic Agent' };
  const created = await client.execute('artifact_manage', { action: 'create', title: 'Namespace fixture', participant }) as { artifact: { id: string } };
  const artifactId = created.artifact.id;
  await client.execute('artifact_activity', { artifactId, action: 'begin', taskId: 'before-restart', scope: { rect: { x: 0, y: 0, w: 200, h: 100 } }, participant });
  const beforeActor = host.service.getPresence(artifactId).find(peer => peer.context?.agentTasks?.length)!.actor.id;
  await restart();
  await expect(client.execute('artifact_activity', { artifactId, action: 'update', taskId: 'before-restart', participant })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const changed = await client.execute('artifact_apply', { artifactId, operationId: randomUUID(), expectedRevision: 0, operations: [{ op: 'add', element: { id: 'after-restart', type: 'text', text: 'Synthetic change' } }], participant }) as { historyEntry: { actor: { id: string } } };
  expect(changed.historyEntry.actor.id).toBe(beforeActor); expect(await readdir(join(directory, 'leases'))).toHaveLength(1);
  const begun = await client.execute('artifact_activity', { artifactId, action: 'begin', taskId: 'before-restart', scope: { ids: ['after-restart'] }, participant }) as { tasks: unknown[] };
  expect(begun.tasks).toHaveLength(1);
});

it.each(['pluginVersion', 'serviceProtocol'] as const)('validates %s before using a replacement record', async field => {
  await restart();
  const business = vi.fn();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === host.origin && url.pathname === '/api/session') return Response.json({ owner: true, serviceProtocol: SERVICE_PROTOCOL_VERSION, pluginVersion: PLUGIN_VERSION, [field]: field === 'serviceProtocol' ? SERVICE_PROTOCOL_VERSION + 1 : 'incompatible-version' });
    if (url.pathname.startsWith('/api/tools/')) business();
    return nativeFetch(input, init);
  });
  await expect(client.execute('artifact_list', {})).rejects.toMatchObject({ code: 'SERVICE_PROTOCOL_MISMATCH' });
  expect(business).not.toHaveBeenCalled();
});
