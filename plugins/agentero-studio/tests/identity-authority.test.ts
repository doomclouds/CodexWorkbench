import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LOCAL_ACTOR, type Actor, type Presence, type StudioEvent } from '../src/contracts/studio.js';
import { startStudioHost, type StudioHost } from '../src/server/http.js';
import { connectStudio, writeRecord } from '../src/server/client.js';
import { createStudioServer } from '../src/server/protocol.js';
import { StudioService } from '../src/core/service.js';
import { SERVICE_PROTOCOL_VERSION } from '../src/server/service-protocol.js';
import { PLUGIN_VERSION } from '../src/contracts/version.js';

let directory: string, host: StudioHost, artifactId: string;
const closers: (() => Promise<unknown>)[] = [];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-authority-'));
  host = await startStudioHost({ dataRoot: directory });
  artifactId = (await host.service.execute('artifact_manage', { action: 'create', elements: [{ id: 'node', type: 'text', text: 'base' }] })).artifact.id;
});
afterEach(async () => {
  vi.restoreAllMocks(); for (const close of closers.splice(0).reverse()) await close(); await host.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected authority directory');
  await rm(directory, { recursive: true, force: true });
});
const share = (args: Record<string, unknown> = {}) => host.service.execute('artifact_share', { artifactId, ...args });
const tokenFor = (info: any, role = 'editor') => new URL(info.links[role]).searchParams.get('share')!;
function guest(token?: string, origin = host.origin) {
  let cookie = '';
  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (cookie) headers.set('Cookie', cookie);
    const response = await fetch(origin + path, { ...init, headers, redirect: 'manual' });
    const issued = response.headers.get('set-cookie'); if (issued) cookie = issued.split(';')[0]!;
    return response;
  }
  const call = async (name: string, args: Record<string, unknown> = {}, headers: Record<string, string> = {}) => {
    const response = await request(`/api/tools/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ artifactId, ...args }) });
    return { response, value: await response.json() };
  };
  return {
    request, call, use(next?: string) { token = next; },
    async join(name: string) {
      const response = await request(`/api/session?artifactId=${artifactId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      expect(response.status).toBe(200); return (await response.json()).actor as Actor;
    },
    async session() { const response = await request(`/api/session?artifactId=${artifactId}`); return { response, value: await response.json() }; },
  };
}
async function agentConnection(name: string) {
  await writeRecord(directory, { origin: host.origin, token: host.token, pid: process.pid, instanceId: randomUUID() });
  const bridge = await connectStudio(directory), server = createStudioServer(bridge, '<html></html>'), client = new Client({ name, version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  closers.push(async () => { await client.close(); await server.close(); await bridge.close(); });
  return {
    bridge, client,
    async call(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({ name, arguments: { artifactId, ...args } });
      return { error: result.isError === true, value: result.structuredContent as any, content: result.content, meta: result._meta };
    },
  };
}

describe('host owner and viewer-safe sharing identity', () => {
  it('uses the host OS username consistently while preserving stable IDs and old author snapshots', async () => {
    const owner = { ...LOCAL_ACTOR, name: userInfo().username.trim() };
    expect(host.service.owner).toEqual(owner);
    const session = await fetch(`${host.origin}/api/session`, { headers: { Authorization: `Bearer ${host.token}` } });
    expect(await session.json()).toMatchObject({ actor: owner, serviceProtocol: SERVICE_PROTOCOL_VERSION, pluginVersion: PLUGIN_VERSION });
    const connection = await agentConnection('Owner profile check'); expect((await connection.bridge.connection()).actor).toEqual(owner);
    const old = await host.service.execute('artifact_manage', { action: 'create', elements: [{ id: 'old', type: 'text' }] }, { ...LOCAL_ACTOR, name: 'Historical owner label' });
    const updated = await host.service.execute('artifact_apply', { artifactId: old.artifact.id, expectedRevision: 0, operations: [{ op: 'update', id: 'old', changes: { text: 'new' } }] });
    expect(updated.historyEntry.actor).toEqual(owner);
    const saved = await host.service.store.read(old.artifact.id); expect(saved.history[0]!.entry.actor).toEqual({ ...LOCAL_ACTOR, name: 'Historical owner label' });
    const info = await share({ action: 'start', access: 'local' }); expect(info.owner).toEqual(owner);
    const deniedName = guest(tokenFor(info));
    const response = await deniedName.request(`/api/session?artifactId=${artifactId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: ` ${owner.name.normalize('NFKC').toUpperCase()} ` }) });
    expect(response.status).toBe(409); expect((await response.json()).error.code).toBe('NAME_TAKEN');
  });

  it('rejects a healthy incompatible daemon before creating a lease or starting another writer', async () => {
    let probes = 0;
    const old = createServer((_request, response) => { probes++; response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ owner: true, actor: { ...LOCAL_ACTOR, name: 'Old host' } })); });
    await new Promise<void>(resolve => old.listen(0, '127.0.0.1', resolve));
    closers.push(async () => { old.closeAllConnections(); await new Promise<void>(resolve => old.close(() => resolve())); });
    const origin = `http://127.0.0.1:${(old.address() as AddressInfo).port}`, root = join(directory, 'legacy-daemon');
    await writeRecord(root, { origin, token: 'synthetic-old-token', pid: process.pid, instanceId: 'old-service-instance' });
    const before = await readFile(join(root, 'service.json'), 'utf8');
    await expect(connectStudio(root, 'must-not-start-a-second-writer.mjs')).rejects.toMatchObject({ code: 'SERVICE_PROTOCOL_MISMATCH', message: expect.stringContaining('关闭旧版本白板窗口'), details: { expected: SERVICE_PROTOCOL_VERSION, actual: null } });
    expect(probes).toBe(1); expect(await readdir(root)).toEqual(['service.json']); expect(await readFile(join(root, 'service.json'), 'utf8')).toBe(before);
    expect((await fetch(`${origin}/still-alive`)).status).toBe(200);
  });

  it('rejects a stale release even when its service protocol still matches', async () => {
    let probes = 0;
    const old = createServer((_request, response) => { probes++; response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ owner: true, actor: host.service.owner, serviceProtocol: SERVICE_PROTOCOL_VERSION, pluginVersion: '0.0.0-legacy' })); });
    await new Promise<void>(resolve => old.listen(0, '127.0.0.1', resolve));
    closers.push(async () => { old.closeAllConnections(); await new Promise<void>(resolve => old.close(() => resolve())); });
    const origin = `http://127.0.0.1:${(old.address() as AddressInfo).port}`, root = join(directory, 'stale-release');
    await writeRecord(root, { origin, token: 'synthetic-stale-release-token', pid: process.pid, instanceId: 'stale-release-instance' });
    const before = await readFile(join(root, 'service.json'), 'utf8');
    await expect(connectStudio(root, 'must-not-start-a-second-writer.mjs')).rejects.toMatchObject({ code: 'SERVICE_PROTOCOL_MISMATCH', details: { expected: SERVICE_PROTOCOL_VERSION, actual: SERVICE_PROTOCOL_VERSION, expectedVersion: PLUGIN_VERSION, actualVersion: '0.0.0-legacy' } });
    expect(probes).toBe(1); expect(await readdir(root)).toEqual(['service.json']); expect(await readFile(join(root, 'service.json'), 'utf8')).toBe(before); expect(old.listening).toBe(true);
  });

  it.each(['editor', 'commenter', 'viewer'])('projects only %s and lower enabled invitations, with no member or owner secrets', async role => {
    const info = await share({ action: 'start', access: 'local' }), viewer = guest(tokenFor(info, role)); await viewer.join(`Guest ${role}`);
    const result = await viewer.call('artifact_share', { action: 'status' }); expect(result.response.status).toBe(200);
    const allowed = ['editor', 'commenter', 'viewer'].slice(['editor', 'commenter', 'viewer'].indexOf(role));
    expect(result.value.data).toEqual({ enabled: true, access: 'local', role, roles: allowed, links: Object.fromEntries(allowed.map(key => [key, info.links[key]])), canonicalPath: `/?artifactId=${artifactId}` });
    for (const action of ['start', 'stop', 'reset', 'link', 'role', 'remove']) expect((await viewer.call('artifact_share', { action, role: 'viewer', on: false, memberId: 'any' })).response.status).toBe(403);
    expect((await viewer.call('artifact_manage', { action: 'create' })).response.status).toBe(403);
    if (role !== 'viewer') {
      await share({ action: 'link', role: 'viewer', on: false });
      const restricted = (await viewer.call('artifact_share', { action: 'status' })).value.data;
      expect(restricted.roles).not.toContain('viewer'); expect(restricted.links.viewer).toBeUndefined();
    }
  });

  it('uses the effective owner-assigned role even when a higher invitation is presented', async () => {
    const info = await share({ action: 'start', access: 'local' }), viewer = guest(tokenFor(info)); const actor = await viewer.join('Downgraded');
    await share({ action: 'role', memberId: actor.id, role: 'viewer' });
    const projected = (await viewer.call('artifact_share', { action: 'status' })).value.data;
    expect(projected.role).toBe('viewer'); expect(projected.roles).toEqual(['viewer']); expect(projected.links).toEqual({ viewer: info.links.viewer });
  });

  it('refreshes the same identity across invitation-role changes and revokes its old stream and reader', async () => {
    await host.service.execute('artifact_apply', { artifactId, operations: [{ op: 'add', element: { id: 'html', type: 'html', html: '<h1>Reader</h1>' } }] });
    const info = await share({ action: 'start', access: 'local' }), viewer = guest(tokenFor(info)); const actor = await viewer.join('Switching role');
    const region = await viewer.request('/api/region-view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId, regionId: 'html', viewId: 'old-editor-view' }) });
    const cap = new URLSearchParams(new URL((await region.json()).data.url).hash.slice(1)).get('cap');
    const stream = await viewer.request(`/api/events?artifactId=${artifactId}`), reader = stream.body!.getReader();
    await reader.read();
    viewer.use(tokenFor(info, 'viewer')); expect((await viewer.session()).value.actor).toMatchObject({ id: actor.id, role: 'viewer' });
    let text = ''; while (!text.includes('access-revoked')) { const part = await reader.read(); if (part.done) break; text += new TextDecoder().decode(part.value); }
    expect(text).toContain('"reason":"role-changed"'); await reader.cancel();
    expect((await fetch(`${host.origin}/api/region-reader/${artifactId}/html`, { headers: { Authorization: `Bearer ${cap}` } })).status).toBe(401);
    viewer.use(); expect((await viewer.session()).value.actor.role).toBe('viewer');
  });

  it('allows only existing cookie grants on canonical URLs and refuses anonymous or merely remembered identities', async () => {
    const info = await share({ action: 'start', access: 'local' }), unknown = guest();
    const denied = await unknown.request(`/?artifactId=${artifactId}`); expect(denied.status).toBe(401); expect(denied.headers.get('set-cookie')).toBeNull();
    expect(await denied.text()).not.toContain('<form');
    const viewer = guest(tokenFor(info)), actor = await viewer.join('Canonical editor'); viewer.use();
    const page = await viewer.request(`/?artifactId=${artifactId}`), html = await page.text();
    expect(page.status).toBe(200); expect(html).toContain('"token":""'); expect(html).not.toContain(tokenFor(info)); expect(html).not.toContain(host.token);
    expect((await viewer.session()).value.actor.id).toBe(actor.id);
    expect((await viewer.call('artifact_apply', { expectedVersions: { node: 1 }, operations: [{ op: 'update', id: 'node', changes: { text: 'cookie write' } }] })).response.status).toBe(200);
    expect((await viewer.call('artifact_apply', { expectedVersions: { node: 2 }, operations: [{ op: 'update', id: 'node', changes: { text: 'csrf' } }] }, { Origin: 'https://attacker.example' })).response.status).toBe(403);
    await share({ action: 'reset', role: 'editor' }); expect((await viewer.session()).value.error.details.reason).toBe('link-reset');
    await share({ action: 'stop' }); const next = await share({ action: 'start', access: 'local' });
    expect((await viewer.session()).response.status).toBe(401);
    viewer.use(tokenFor(next)); expect((await viewer.session()).value.actor).toMatchObject({ id: actor.id, name: actor.name }); viewer.use();
    await share({ action: 'remove', memberId: actor.id }); expect((await viewer.session()).value.error.details.reason).toBe('removed');
  });

  it('binds canonical reader return intents to the signed author rather than the shared empty token or public view ID', async () => {
    await host.service.execute('artifact_apply', { artifactId, operations: [{ op: 'add', element: { id: 'reader-html', type: 'html', html: '<h1>Reader</h1>' } }] });
    const info = await share({ action: 'start', access: 'local' }), a = guest(tokenFor(info)), b = guest(tokenFor(info));
    await a.join('Reader owner'); await b.join('Other reader'); a.use(); b.use();
    const created = await a.request('/api/region-view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId, regionId: 'reader-html', viewId: 'public-origin-view' }) });
    const cap = new URLSearchParams(new URL((await created.json()).data.url).hash.slice(1)).get('cap');
    expect((await fetch(`${host.origin}/api/region-reader/${artifactId}/reader-html/return`, { method: 'POST', headers: { Authorization: `Bearer ${cap}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ annotate: true }) })).status).toBe(200);
    const path = `/api/region-view?artifactId=${artifactId}&viewId=public-origin-view`;
    expect((await (await b.request(path)).json()).data).toEqual({});
    expect((await (await a.request(path)).json()).data.navigation).toMatchObject({ artifactId, regionId: 'reader-html', viewId: 'public-origin-view', annotate: true });
    expect((await (await a.request(path)).json()).data).toEqual({});
  });
});

describe('fresh authority at the artifact transaction', () => {
  it('keeps hot authorization/context projections fresh when another service changes the grant', async () => {
    const info = await share({ action: 'start', access: 'local' }), viewer = guest(tokenFor(info)); const actor = await viewer.join('Projection freshness');
    await share({ action: 'role', memberId: actor.id, role: 'editor' });
    viewer.use();
    const fullRead = vi.spyOn(host.service.store, 'read');
    expect((await viewer.session()).value.actor.role).toBe('editor');
    expect((await viewer.call('artifact_share', { action: 'status' })).response.status).toBe(200);
    expect((await viewer.call('artifact_read', { mode: 'context', viewId: 'no-selected-view' })).response.status).toBe(200);
    expect((await viewer.request(`/api/sync?artifactId=${artifactId}`)).status).toBe(200);
    expect((await viewer.request('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId, peerId: 'projection-view', context: { artifactId, viewId: 'projection-view', selectedIds: [] } }) })).status).toBe(200);
    expect(fullRead).not.toHaveBeenCalled();
    const other = new StudioService({ dataRoot: directory }); closers.push(() => other.close());
    await other.execute('artifact_share', { artifactId, action: 'role', memberId: actor.id, role: 'viewer' });
    expect((await viewer.session()).value.actor.role).toBe('viewer');
    expect((await viewer.call('artifact_share', { action: 'status' })).value.data.roles).toEqual(['viewer']);
    await other.execute('artifact_share', { artifactId, action: 'remove', memberId: actor.id });
    expect((await viewer.session()).value.error.details.reason).toBe('removed');
    expect((await viewer.call('artifact_read', { mode: 'context' })).response.status).toBe(401);
    expect(fullRead).not.toHaveBeenCalled();
  });

  it('publishes the fresh role if authority changes before the stream registers, then revokes the correct role', async () => {
    const info = await share({ action: 'start', access: 'local' }), viewer = guest(tokenFor(info)); const actor = await viewer.join('Ready race');
    let release!: () => void, admitted!: () => void, block = true;
    const gate = new Promise<void>(resolve => { release = resolve; }), accepted = new Promise<void>(resolve => { admitted = resolve; });
    const original = host.service.guestActor.bind(host.service);
    vi.spyOn(host.service, 'guestActor').mockImplementation(async (...input: Parameters<StudioService['guestActor']>) => { const result = await original(...input); if (block) { block = false; admitted(); await gate; } return result; });
    const pending = viewer.request(`/api/events?artifactId=${artifactId}`);
    await accepted; try { await share({ action: 'role', memberId: actor.id, role: 'viewer' }); } finally { release(); }
    const stream = await pending, reader = stream.body!.getReader();
    const ready = new TextDecoder().decode((await reader.read()).value); expect(ready).toContain('"role":"viewer"');
    await share({ action: 'link', role: 'viewer', on: false });
    let text = ''; const timeout = setTimeout(() => { void reader.cancel(); }, 2000);
    try { while (!text.includes('access-revoked')) { const part = await reader.read(); if (part.done) break; text += new TextDecoder().decode(part.value); } }
    finally { clearTimeout(timeout); await reader.cancel(); }
    expect(text).toContain('"type":"access-revoked"'); expect(text).toContain('"reason":"link-disabled"');
  });

  it.each(['remove', 'canonical-remove', 'downgrade', 'reset', 'off', 'stop', 'local-only'])('rejects an already-authorized queued content write after %s commits first', async action => {
    const info = await share({ action: 'start', access: action === 'local-only' ? 'lan' : 'local' });
    if (action === 'local-only') {
      const other = (await host.service.execute('artifact_manage', { action: 'create' })).artifact.id;
      await host.service.execute('artifact_share', { artifactId: other, action: 'start' });
    }
    const viewer = guest(tokenFor(info), action === 'local-only' ? new URL(info.links.editor).origin : host.origin), actor = await viewer.join('Queued editor');
    if (action === 'canonical-remove') viewer.use();
    let release!: () => void, admitted!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), accepted = new Promise<void>(resolve => { admitted = resolve; });
    const original = host.service.execute.bind(host.service);
    vi.spyOn(host.service, 'execute').mockImplementation(async (...input: Parameters<StudioService['execute']>) => {
      if (input[0] === 'artifact_apply' && input[3]?.owner === false) { expect(input[2]?.role).toBe('editor'); admitted(); await gate; }
      return original(...input);
    });
    const pending = viewer.call('artifact_apply', { operationId: 'queued-mutation', expectedVersions: { node: 1 }, operations: [{ op: 'update', id: 'node', changes: { text: 'must not commit' } }] });
    await accepted;
    try {
      if (action === 'downgrade') await share({ action: 'role', memberId: actor.id, role: 'viewer' });
      else if (action === 'off') await share({ action: 'link', role: 'editor', on: false });
      else if (action === 'local-only') await share({ action: 'start', access: 'local' });
      else await share({ action: action === 'canonical-remove' ? 'remove' : action, role: 'editor', memberId: actor.id });
    } finally { release(); }
    const response = await pending;
    expect(response.response.status).toBe(action === 'downgrade' ? 403 : 401);
    const state = await host.service.store.read(artifactId);
    expect((state.content as { elements: { text?: string }[] }).elements[0]!.text).toBe('base'); expect(state.artifact.revision).toBe(0); expect(state.operations).toEqual([]);
    expect(JSON.stringify(state.history)).not.toContain(tokenFor(info));
  });

  it('rechecks queued feedback before creating frozen context', async () => {
    const info = await share({ action: 'start', access: 'local' }), viewer = guest(tokenFor(info)); const actor = await viewer.join('Comment queue');
    let release!: () => void, admitted!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), accepted = new Promise<void>(resolve => { admitted = resolve; });
    const original = host.service.execute.bind(host.service);
    vi.spyOn(host.service, 'execute').mockImplementation(async (...input: Parameters<StudioService['execute']>) => { if (input[0] === 'artifact_feedback' && input[3]?.owner === false) { admitted(); await gate; } return original(...input); });
    const pending = viewer.call('artifact_feedback', { action: 'create', operationId: 'queued-feedback', text: 'Must not freeze', anchor: { elementIds: ['node'] }, versions: { node: 1 } });
    await accepted; try { await share({ action: 'remove', memberId: actor.id }); } finally { release(); }
    expect((await pending).response.status).toBe(401); const state = await host.service.store.read(artifactId); expect(state.feedback).toEqual([]); expect(state.sources).toEqual({});
  });

  it('rechecks queued timer authority before the persisted room action', async () => {
    const info = await share({ action: 'start', access: 'local' }), viewer = guest(tokenFor(info)); const actor = await viewer.join('Timer queue');
    let release!: () => void, admitted!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), accepted = new Promise<void>(resolve => { admitted = resolve; });
    const original = host.service.updatePresence.bind(host.service);
    vi.spyOn(host.service, 'updatePresence').mockImplementation(async (...input: Parameters<StudioService['updatePresence']>) => { if (input[1].timer && input[3]?.owner === false) { admitted(); await gate; } return original(...input); });
    const pending = viewer.request('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId, peerId: 'timer-view', timer: { action: 'start', durationSeconds: 60 } }) });
    await accepted; try { await share({ action: 'role', memberId: actor.id, role: 'viewer' }); } finally { release(); }
    expect((await pending).status).toBe(403); expect(host.service.getTimer(artifactId)).toBeNull();
  });

  it('rechecks queued binary asset writes inside their owning transaction', async () => {
    const info = await share({ action: 'start', access: 'local' }), viewer = guest(tokenFor(info)); const actor = await viewer.join('Asset queue');
    let release!: () => void, admitted!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), accepted = new Promise<void>(resolve => { admitted = resolve; });
    const original = host.service.putAsset.bind(host.service);
    vi.spyOn(host.service, 'putAsset').mockImplementation(async (...input: Parameters<StudioService['putAsset']>) => { if (input[4]?.owner === false) { admitted(); await gate; } return original(...input); });
    const pending = viewer.request(`/api/assets?artifactId=${artifactId}`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.from('89504e470d0a1a0a', 'hex') });
    await accepted; try { await share({ action: 'remove', memberId: actor.id }); } finally { release(); }
    expect((await pending).status).toBe(401); expect((await host.service.store.read(artifactId)).assets).toEqual({});
  });

  it('commits a room timer under fresh artifact authorization without rewriting unchanged artifact JSON', async () => {
    const before = await readFile(host.service.store.file(artifactId), 'utf8');
    const write = vi.spyOn(host.service.store, 'write').mockRejectedValue(Object.assign(new Error('Unrelated artifact write must not run'), { code: 'EIO' }));
    const result = await host.service.updatePresence(artifactId, { peerId: 'timer-owner', timer: { action: 'start', durationSeconds: 60 } }, host.service.owner);
    expect(write).not.toHaveBeenCalled(); expect(result.timer?.deadline).toBeGreaterThan(Date.now()); expect(host.service.getTimer(artifactId)?.deadline).toBe(result.timer?.deadline);
    expect(await readFile(host.service.store.file(artifactId), 'utf8')).toBe(before);
  });
});

describe('real MCP connection and explicit participant identity', () => {
  it('keeps per-connection identities stable, namespaces explicit participants, publishes activity and prevents guest spoofing', async () => {
    const a = await agentConnection('Planner MCP'), b = await agentConnection('Worker MCP'), events: StudioEvent[] = [];
    const stop = host.service.subscribe(artifactId, event => events.push(event)); closers.push(async () => stop());
    const mutate = async (connection: typeof a, version: number, participant?: { id: string; name: string }) => {
      const result = await connection.call('artifact_apply', { expectedVersions: { node: version }, operations: [{ op: 'update', id: 'node', changes: { text: `version ${version + 1}` } }], ...(participant ? { participant } : {}) });
      expect(result.error, JSON.stringify(result.value ?? result.content)).toBe(false); return result;
    };
    const first = await mutate(a, 1), again = await mutate(a, 2), second = await mutate(b, 3);
    expect(first.error).toBe(false); const baseActor = first.value.data.historyEntry.actor;
    expect(baseActor.id).toMatch(/^agent-/); expect(baseActor.name).toContain('Planner MCP'); expect(again.value.data.historyEntry.actor).toEqual(baseActor);
    expect(second.value.data.historyEntry.actor.id).not.toBe(baseActor.id); expect(second.value.data.historyEntry.actor.name).toContain('Worker MCP');
    const main = await mutate(a, 4, { id: 'main', name: '主 Agent' }), mainAgain = await mutate(a, 5, { id: 'main', name: '主 Agent' }), child = await mutate(a, 6, { id: '/root/child', name: '子 Agent' });
    expect(main.value.data.historyEntry.actor.id).not.toBe(baseActor.id); expect(mainAgain.value.data.historyEntry.actor).toEqual(main.value.data.historyEntry.actor); expect(child.value.data.historyEntry.actor.id).not.toBe(main.value.data.historyEntry.actor.id);
    await a.call('artifact_read', { mode: 'objects', ids: ['node'] });
    const appearances = events.flatMap(event => event.type === 'presence' && Array.isArray(event.peers) ? event.peers as Presence[] : []);
    expect(appearances.some(peer => peer.actor.id === baseActor.id && peer.context?.activity === 'reading')).toBe(true);
    expect(appearances.some(peer => peer.actor.id === baseActor.id && peer.context?.activity === 'writing' && peer.context.editingIds?.includes('node'))).toBe(true);
    const idle = host.service.getPresence(artifactId).filter(peer => peer.actor.kind === 'agent');
    expect(idle.some(peer => peer.actor.id === baseActor.id)).toBe(true); expect(idle.every(peer => peer.context?.activity === 'idle' && !peer.context.editingIds?.length)).toBe(true);
    const info = await share({ action: 'start', access: 'local' }), viewer = guest(tokenFor(info)); const signed = await viewer.join('Human guest');
    const spoof = await viewer.call('artifact_feedback', { action: 'create', text: 'Still human', participant: { id: 'main', name: 'forged' } }, { 'X-Studio-Actor': 'agent', 'X-Studio-Agent-Id': baseActor.id, 'X-Studio-Agent-Name': 'forged' });
    expect(spoof.value.data.feedback[0].author).toMatchObject({ id: signed.id, kind: 'human', role: 'editor', name: 'Human guest' });
    const peer = await viewer.request('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId, peerId: `agent-${baseActor.id}` }) }); expect(peer.status).toBe(403);
    expect((await a.call('artifact_read', { participant: { id: '   ', name: 'Invalid' } })).error).toBe(true);
  });

  it('protects human editing without letting the agent viewId hide it or the agent activity block itself', async () => {
    const a = await agentConnection('Editing guard');
    await host.service.updatePresence(artifactId, { peerId: 'human-view', context: { artifactId, viewId: 'human-view', selectedIds: ['node'], editingIds: ['node'] } }, host.service.owner);
    const contexts = await a.call('artifact_read', { mode: 'context', viewId: 'human-view' });
    expect(contexts.value.data.contexts).toHaveLength(1); expect(contexts.value.data.contexts[0]).toMatchObject({ viewId: 'human-view', actor: { id: host.service.owner.id, kind: 'human' } });
    const blocked = await a.call('artifact_apply', { viewId: 'human-view', expectedVersions: { node: 1 }, operations: [{ op: 'update', id: 'node', changes: { text: 'blocked' } }] });
    expect(blocked.value).toMatchObject({ ok: false, error: { code: 'EDIT_IN_PROGRESS' } });
    await host.service.updatePresence(artifactId, { peerId: 'human-view', leave: true }, host.service.owner);
    expect((await a.call('artifact_apply', { expectedVersions: { node: 1 }, operations: [{ op: 'update', id: 'node', changes: { text: 'self activity allowed' } }] })).error).toBe(false);
  });

  it('allows reads but rejects another Agent writing an actively edited target', async () => {
    const a = await agentConnection('Active writer'), b = await agentConnection('Second agent');
    let release!: () => void, admitted!: () => void, block = true;
    const gate = new Promise<void>(resolve => { release = resolve; }), accepted = new Promise<void>(resolve => { admitted = resolve; });
    const original = host.service.store.transaction.bind(host.service.store);
    vi.spyOn(host.service.store, 'transaction').mockImplementation(async (id, run) => { if (block) { block = false; admitted(); await gate; } return original(id, run); });
    const pending = a.call('artifact_apply', { expectedVersions: { node: 1 }, operations: [{ op: 'update', id: 'node', changes: { text: 'first agent' } }] });
    await accepted;
    try {
      expect((await b.call('artifact_read', { mode: 'objects', ids: ['node'] })).error).toBe(false);
      const blocked = await b.call('artifact_apply', { expectedVersions: { node: 1 }, operations: [{ op: 'update', id: 'node', changes: { text: 'must wait' } }] });
      expect(blocked.value).toMatchObject({ ok: false, error: { code: 'EDIT_IN_PROGRESS' } });
    } finally { release(); }
    expect((await pending).error).toBe(false); expect(host.service.getPresence(artifactId).filter(peer => peer.actor.kind === 'agent').every(peer => peer.context?.activity === 'idle' && !peer.context.editingIds?.length)).toBe(true);
  });

  it('does not scope owner create to an irrelevant stale artifactId', async () => {
    const a = await agentConnection('Create scope');
    const created = await a.call('artifact_manage', { action: 'create', artifactId: 'missing-old-artifact', title: 'Fresh board' });
    expect(created.error).toBe(false); expect(created.value.data.artifact.title).toBe('Fresh board');
    const response = await fetch(`${host.origin}/api/tools/artifact_manage?artifactId=another-missing-artifact`, { method: 'POST', headers: { Authorization: `Bearer ${host.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId: 'missing-old-artifact', action: 'create', title: 'HTTP fresh board' }) });
    expect(response.status).toBe(200);
  });
});
