import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LOCAL_ACTOR, TOOL_NAMES, type Actor } from '../src/contracts/studio.js';
import { startStudioHost, type StudioHost } from '../src/server/http.js';
import { createStudioServer } from '../src/server/protocol.js';

let directory: string, host: StudioHost, artifactId: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-sharing-feedback-'));
  host = await startStudioHost({ dataRoot: directory });
  artifactId = (await host.service.execute('artifact_manage', { action: 'create', elements: [{ id: 'html', type: 'html', html: '<h1>Frozen source</h1>' }] })).artifact.id;
});
afterEach(async () => {
  await host.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory');
  await rm(directory, { recursive: true, force: true });
});
const share = (args: Record<string, unknown> = {}) => host.service.execute('artifact_share', { artifactId, ...args });
const tokenFor = (info: any, role: string) => new URL(info.links[role]).searchParams.get('share')!;
let guestSequence = 0;
function browser(token: string, name = `Guest ${++guestSequence}`) {
  let cookie = '', enrolled = false;
  async function request(path: string, init: RequestInit = {}) {
    if (!enrolled) {
      const joined = await fetch(`${host.origin}/api/session?artifactId=${artifactId}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      cookie = joined.headers.get('set-cookie')?.split(';')[0] ?? ''; enrolled = true;
    }
    const headers = new Headers(init.headers); if (token) headers.set('Authorization', `Bearer ${token}`);
    if (cookie) headers.set('Cookie', cookie);
    const response = await fetch(host.origin + path, { ...init, headers });
    const issued = response.headers.get('set-cookie'); if (issued) cookie = issued.split(';')[0]!;
    return response;
  }
  return {
    request, use(nextToken: string) { token = nextToken; },
    async call(tool: string, args: Record<string, unknown>) {
      const response = await request(`/api/tools/${tool}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId, ...args }) });
      return { response, body: await response.json() };
    },
    async session() { const response = await request(`/api/session?artifactId=${artifactId}`); return { response, body: await response.json() }; },
    async page() {
      const response = await request(`/?artifactId=${artifactId}`), html = await response.text(), boot = /window\.__STUDIO_BOOT__=(.*?)<\/script>/.exec(html)?.[1];
      return { response, actor: boot ? JSON.parse(boot.replace(/;\s*$/, '')).actor as Actor : undefined };
    },
  };
}
async function streamUntil(reader: ReadableStreamDefaultReader<Uint8Array>, match: string) {
  let value = ''; const timeout = setTimeout(() => { void reader.cancel(); }, 3000);
  try { while (!value.includes(match)) { const part = await reader.read(); if (part.done) break; value += new TextDecoder().decode(part.value); } return value; }
  finally { clearTimeout(timeout); }
}
describe('shared feedback and invitation permissions through Node HTTP', () => {
  it('edits only own messages, reopens a resolved reply and deletes the thread with its frozen source', async () => {
    const info = await share({ action: 'start' }), author = browser(tokenFor(info, 'commenter'), 'Author'), other = browser(tokenFor(info, 'editor'), 'Other');
    const creation = { action: 'create', operationId: 'deleted-feedback-retry', text: 'Original', anchor: { regionId: 'html', pin: { coordinateSpace: 'board', x: 234.5, y: 107.25 } }, versions: { html: 1 } };
    const created = await author.call('artifact_feedback', creation);
    const item = created.body.data.feedback[0], feedbackId = item.id;
    expect(item.anchor).toEqual(creation.anchor);
    expect((await other.call('artifact_feedback', { action: 'edit', feedbackId, text: 'Forged' })).response.status).toBe(403);
    expect((await other.call('artifact_feedback', { action: 'delete', feedbackId })).response.status).toBe(403);
    expect((await author.call('artifact_feedback', { action: 'edit', feedbackId, text: 'Edited first' })).body.data.feedback[0].text).toBe('Edited first');
    const replied = await other.call('artifact_feedback', { action: 'reply', feedbackId, text: 'Reply' }), replyId = replied.body.data.feedback[0].replies[0].id;
    expect((await author.call('artifact_feedback', { action: 'edit', feedbackId, replyId, text: 'Forged reply' })).response.status).toBe(403);
    expect((await other.call('artifact_feedback', { action: 'edit', feedbackId, replyId, text: 'Edited reply' })).body.data.feedback[0].replies[0].text).toBe('Edited reply');
    await author.call('artifact_feedback', { action: 'resolve', feedbackId });
    expect((await other.call('artifact_feedback', { action: 'reply', feedbackId, text: 'Reopen' })).body.data.feedback[0].status).toBe('open');
    const frozen = await host.service.execute('artifact_read', { artifactId, mode: 'context', contextId: feedbackId });
    expect(JSON.stringify(frozen.sources)).toContain('Frozen source');
    const before = await host.service.execute('artifact_read', { artifactId, mode: 'history' });
    expect((await author.call('artifact_feedback', { action: 'delete', feedbackId })).body.data.feedback).toEqual([]);
    expect((await other.call('artifact_read', { mode: 'context', contextId: feedbackId })).response.status).toBe(404);
    await expect(host.service.execute('artifact_read', { artifactId, mode: 'source', contextId: feedbackId, regionId: 'html' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const state = await host.service.store.read(artifactId);
    expect(state.sources[feedbackId]).toBeUndefined(); expect(state.history.length).toBeGreaterThanOrEqual(before.history.length);
    expect(state.history.at(-1)?.entry.changedIds).toContain(`$feedback:${feedbackId}`);
    expect(Object.keys(state.deletedFeedbackReceipts![0]!).sort()).toEqual(['contextId', 'fingerprint', 'operationId']);
    expect((await author.call('artifact_feedback', creation)).body).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', details: { contextId: feedbackId } } });
    expect((await author.call('artifact_feedback', { ...creation, text: 'Different content' })).body).toMatchObject({ ok: false, error: { code: 'OPERATION_REUSED' } });
    const next = await author.call('artifact_feedback', { action: 'create', text: 'Owner may remove' });
    await host.service.execute('artifact_feedback', { artifactId, action: 'delete', feedbackId: next.body.data.feedback[0].id });
    expect((await author.call('artifact_feedback', { action: 'list' })).body.data.feedback).toEqual([]);
  });

  it('independently disables, enables and resets one role while preserving other invitations', async () => {
    const info = await share({ action: 'start' }), editor = browser(tokenFor(info, 'editor')), viewer = browser(tokenFor(info, 'viewer'));
    const actor = (await editor.session()).body.actor; await viewer.session();
    const disabled = await share({ action: 'link', role: 'editor', on: false });
    expect(disabled.roleEnabled.editor).toBe(false); expect(disabled.links.editor).toBeUndefined();
    expect(disabled.members.find((member: any) => member.id === actor.id)).toMatchObject({ active: false, online: false });
    expect(JSON.stringify(disabled.members)).not.toContain(tokenFor(info, 'editor'));
    expect((await editor.session()).response.status).toBe(401); expect((await viewer.session()).response.status).toBe(200);
    await share({ action: 'link', role: 'editor', on: true });
    expect((await editor.session()).body.actor.role).toBe('editor');
    const reset = await share({ action: 'reset', role: 'editor' });
    expect(reset.members.some((member: any) => member.id === actor.id)).toBe(false);
    expect((await editor.session()).response.status).toBe(401); expect((await viewer.session()).response.status).toBe(200);
    expect((await browser(tokenFor(reset, 'editor')).session()).body.actor.role).toBe('editor');
    await share({ action: 'stop' });
    const restarted = await share({ action: 'start' });
    expect(tokenFor(restarted, 'viewer')).not.toBe(tokenFor(info, 'viewer'));
    expect((await viewer.session()).response.status).toBe(401);
  });

  it('changes member permissions and revokes existing SSE and presence, then removes access', async () => {
    const info = await share({ action: 'start' }), guest = browser(tokenFor(info, 'editor'), 'Joined editor'), viewer = browser(tokenFor(info, 'viewer'));
    const actor = (await guest.session()).body.actor;
    await guest.request(`/api/presence?artifactId=${artifactId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ peerId: 'member-peer' }) });
    expect((await share()).members.find((member: any) => member.id === actor.id)).toMatchObject({ name: 'Joined editor', online: true, active: true });
    expect((await viewer.call('artifact_share', { action: 'remove', memberId: actor.id })).response.status).toBe(403);
    await expect(share({ action: 'remove', memberId: 'toString' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const stream = await guest.request(`/api/events?artifactId=${artifactId}`), streamReader = stream.body!.getReader();
    expect(await streamUntil(streamReader, 'ready')).toContain('ready');
    await share({ action: 'role', memberId: actor.id, role: 'viewer' });
    expect(await streamUntil(streamReader, 'access-revoked')).toContain('access-revoked'); await streamReader.cancel();
    expect(host.service.getPresence(artifactId)).toEqual([]);
    expect((await guest.session()).body.actor).toMatchObject({ id: actor.id, role: 'viewer' });
    expect((await guest.call('artifact_read', {})).response.status).toBe(200);
    expect((await guest.call('artifact_apply', { operations: [{ op: 'add', element: { type: 'text', text: 'Denied' } }] })).response.status).toBe(403);
    expect((await guest.call('artifact_feedback', { action: 'create', text: 'Denied' })).response.status).toBe(403);
    await share({ action: 'link', role: 'commenter', on: false });
    await expect(share({ action: 'role', memberId: actor.id, role: 'commenter' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    // A role change moves the member onto the new role's lifecycle.
    await share({ action: 'reset', role: 'editor' });
    expect((await guest.session()).body.actor.role).toBe('viewer');
    const viewerStream = await guest.request(`/api/events?artifactId=${artifactId}`), viewerStreamReader = viewerStream.body!.getReader();
    await streamUntil(viewerStreamReader, 'ready');
    await share({ action: 'remove', memberId: actor.id });
    expect(await streamUntil(viewerStreamReader, 'access-revoked')).toContain('access-revoked'); await viewerStreamReader.cancel();
    expect((await guest.session()).response.status).toBe(401);
    expect((await share()).members.some((member: any) => member.id === actor.id)).toBe(false);
    expect((await viewer.session()).response.status).toBe(200);
  });

  it('uses each invitation role for an ordinary signed guest that has no owner assignment', async () => {
    const info = await share({ action: 'start' }), guest = browser(tokenFor(info, 'editor'));
    const initial = await guest.page(); expect(initial.actor?.role).toBe('editor');
    for (const role of ['viewer', 'commenter', 'editor']) {
      guest.use(tokenFor(info, role)); const page = await guest.page();
      expect(page.actor).toMatchObject({ id: initial.actor!.id, role });
      const write = await guest.call('artifact_apply', { operations: [{ op: 'add', element: { type: 'text', text: 'Invitation permission' } }] });
      expect(write.response.status).toBe(role === 'editor' ? 200 : 403);
      expect((await guest.session()).body.actor).toMatchObject({ id: initial.actor!.id, role });
    }
    expect((await share()).members).toHaveLength(1);
  });

  it('preserves an owner-assigned role across invitation switches in bootstrap, writes and SSE', async () => {
    const info = await share({ action: 'start' }), guest = browser(tokenFor(info, 'editor'));
    const id = (await guest.session()).body.actor.id;
    const originalStream = await guest.request(`/api/events?artifactId=${artifactId}`), originalStreamReader = originalStream.body!.getReader();
    await streamUntil(originalStreamReader, 'ready');
    await share({ action: 'role', memberId: id, role: 'viewer' });
    expect(await streamUntil(originalStreamReader, 'access-revoked')).toContain('access-revoked'); await originalStreamReader.cancel();
    for (const role of ['viewer', 'commenter', 'editor']) {
      guest.use(tokenFor(info, role));
      expect((await guest.page()).actor).toMatchObject({ id, role: 'viewer' });
      expect((await guest.session()).body.actor).toMatchObject({ id, role: 'viewer' });
      expect((await guest.call('artifact_apply', { operations: [{ op: 'add', element: { type: 'text', text: 'Escalation denied' } }] })).response.status).toBe(403);
      expect((await guest.call('artifact_feedback', { action: 'create', text: 'Comment denied' })).response.status).toBe(403);
      const stream = await guest.request(`/api/events?artifactId=${artifactId}`), streamReader = stream.body!.getReader();
      expect(await streamUntil(streamReader, 'ready')).toContain('"role":"viewer"'); await streamReader.cancel();
    }
    expect((await host.service.store.read(artifactId)).sharing.members![id]).toMatchObject({ ownerAssigned: true, role: 'viewer' });
    expect(JSON.stringify((await share()).members)).not.toContain('ownerAssigned');
    await share({ action: 'link', role: 'viewer', on: false });
    expect((await guest.session()).response.status).toBe(401);
    await share({ action: 'link', role: 'viewer', on: true });
    expect((await guest.session()).body.actor.role).toBe('viewer');
    await share({ action: 'reset', role: 'viewer' });
    // An existing editor invitation cannot bypass revocation of the assigned viewer grant.
    expect((await guest.session()).response.status).toBe(401);
    await share({ action: 'stop' }); const restarted = await share({ action: 'start' });
    expect((await guest.session()).response.status).toBe(401);
    guest.use(tokenFor(restarted, 'editor'));
    expect((await guest.session()).body.actor).toMatchObject({ id, role: 'editor' });
  });

  it('keeps a removed signed identity denied across every existing invitation and revokes its live capabilities', async () => {
    const info = await share({ action: 'start' }), guest = browser(tokenFor(info, 'editor'));
    const id = (await guest.session()).body.actor.id;
    const stream = await guest.request(`/api/events?artifactId=${artifactId}`), streamReader = stream.body!.getReader(); await streamUntil(streamReader, 'ready');
    await share({ action: 'remove', memberId: id });
    expect(await streamUntil(streamReader, 'access-revoked')).toContain('access-revoked'); await streamReader.cancel();
    for (const role of ['viewer', 'commenter', 'editor']) {
      guest.use(tokenFor(info, role));
      expect((await guest.page()).response.status).toBe(401); expect((await guest.session()).response.status).toBe(401);
      expect((await guest.call('artifact_apply', { operations: [{ op: 'add', element: { type: 'text' } }] })).response.status).toBe(401);
      expect((await guest.request(`/api/events?artifactId=${artifactId}`)).status).toBe(401);
    }
    expect((await browser(tokenFor(info, 'editor')).session()).response.status).toBe(200);
  });

  it('lets only the owner restore the original signed identity with an explicit role', async () => {
    const info = await share({ action: 'start', access: 'local' }), guest = browser(tokenFor(info, 'editor'), 'Restored author'), other = browser(tokenFor(info, 'viewer'), 'Other identity');
    const actor = (await guest.session()).body.actor;
    const originalComment = (await guest.call('artifact_feedback', { action: 'create', text: 'Before removal' })).body.data.feedback[0];
    await other.session();
    const removed = await share({ action: 'remove', memberId: actor.id });
    expect(removed.removedMembers).toEqual([expect.objectContaining({ id: actor.id, name: actor.name, active: false, online: false })]);
    const saved = (await host.service.store.read(artifactId)).sharing.members![actor.id]!;
    expect(JSON.stringify(removed)).not.toContain(saved.grantId);
    expect(JSON.stringify(removed.removedMembers)).not.toMatch(/credential|roleToken|ownerAssigned|removed/);
    const projection = (await other.call('artifact_share', { action: 'status' })).body.data;
    expect(projection).not.toHaveProperty('removedMembers'); expect(projection).not.toHaveProperty('members'); expect(projection).not.toHaveProperty('owner');
    expect((await other.call('artifact_share', { action: 'restore', memberId: actor.id, role: 'editor' })).response.status).toBe(403);
    await expect(share({ action: 'restore', memberId: 'guest-unknown', role: 'viewer' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(share({ action: 'restore', memberId: actor.id })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const duplicateName = await fetch(`${host.origin}/api/session?artifactId=${artifactId}&share=${tokenFor(info, 'editor')}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-studio-actor': 'owner', 'x-studio-actor-id': actor.id }, body: JSON.stringify({ name: actor.name, memberId: actor.id }) });
    expect(duplicateName.status).toBe(409); expect((await duplicateName.json()).error.code).toBe('NAME_TAKEN');
    const reset = await share({ action: 'reset', role: 'editor' }); guest.use(tokenFor(reset, 'editor'));
    expect((await guest.session()).body.error.details.reason).toBe('removed');
    await share({ action: 'link', role: 'commenter', on: false });
    await expect(share({ action: 'restore', memberId: actor.id, role: 'commenter' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await share({ action: 'link', role: 'commenter', on: true });
    const restored = await share({ action: 'restore', memberId: actor.id, role: 'commenter' });
    expect(restored.removedMembers).toEqual([]); expect(restored.members.find((member: any) => member.id === actor.id)).toMatchObject({ name: actor.name, role: 'commenter', active: true });
    await expect(share({ action: 'restore', memberId: actor.id, role: 'editor' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    guest.use('');
    expect((await guest.page()).actor).toMatchObject({ id: actor.id, name: actor.name, role: 'commenter' });
    expect((await guest.session()).body.actor).toMatchObject({ id: actor.id, name: actor.name, role: 'commenter' });
    expect((await guest.call('artifact_feedback', { action: 'edit', feedbackId: originalComment.id, text: 'Same author after restoration' })).body.data.feedback[0].author.id).toBe(actor.id);
    guest.use(tokenFor(reset, 'editor')); expect((await guest.session()).body.actor.role).toBe('commenter');
    expect((await guest.call('artifact_apply', { operations: [{ op: 'add', element: { type: 'text' } }] })).response.status).toBe(403);
  });

  it('keeps restored access on its assigned link lifecycle and clears recovery records on stop/start', async () => {
    const info = await share({ action: 'start', access: 'local' }), guest = browser(tokenFor(info, 'editor'));
    const actor = (await guest.session()).body.actor;
    await share({ action: 'remove', memberId: actor.id }); await share({ action: 'reset', role: 'viewer' });
    await share({ action: 'restore', memberId: actor.id, role: 'viewer' }); guest.use('');
    expect((await guest.session()).body.actor.role).toBe('viewer');
    await share({ action: 'link', role: 'viewer', on: false }); expect((await guest.session()).body.error.details.reason).toBe('link-disabled');
    await share({ action: 'link', role: 'viewer', on: true }); expect((await guest.session()).body.actor.role).toBe('viewer');
    await share({ action: 'reset', role: 'viewer' }); expect((await guest.session()).body.error.details.reason).toBe('link-reset');
    guest.use(tokenFor(info, 'editor')); expect((await guest.session()).body.error.details.reason).toBe('link-reset');
    await share({ action: 'stop' }); const restarted = await share({ action: 'start', access: 'local' });
    expect(restarted.removedMembers).toEqual([]);
    await expect(share({ action: 'restore', memberId: actor.id, role: 'viewer' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    guest.use(''); expect((await guest.session()).response.status).toBe(401);
    guest.use(tokenFor(restarted, 'editor')); expect((await guest.session()).body.actor).toMatchObject({ id: actor.id, name: actor.name, role: 'editor' });
  });

  it.each(['link', 'reset', 'stop'])('revokes already-open SSE for %s', async action => {
    const info = await share({ action: 'start' }), guest = browser(tokenFor(info, 'commenter'));
    const stream = await guest.request(`/api/events?artifactId=${artifactId}`), streamReader = stream.body!.getReader();
    await streamUntil(streamReader, 'ready');
    await share({ action, role: 'commenter', ...(action === 'link' ? { on: false } : {}) });
    expect(await streamUntil(streamReader, 'access-revoked')).toContain('access-revoked'); await streamReader.cancel();
    expect((await guest.session()).response.status).toBe(401);
  });

  it('keeps private suggestions inaccessible through edit/delete and frozen-source reads', async () => {
    const proposal = await host.service.execute('artifact_feedback', { artifactId, action: 'suggest', text: 'Owner only', expectedVersions: { html: 1 }, options: [
      { label: 'A', operations: [{ op: 'update', id: 'html', changes: { html: '<h1>Private A</h1>' } }] },
      { label: 'B', operations: [{ op: 'update', id: 'html', changes: { html: '<h1>Private B</h1>' } }] },
    ] });
    const feedbackId = proposal.feedback.find((item: any) => item.proposal).id;
    const info = await share({ action: 'start' }), guest = browser(tokenFor(info, 'editor'));
    for (const action of ['edit', 'delete']) expect((await guest.call('artifact_feedback', { action, feedbackId, text: 'Guess' })).response.status).toBe(404);
    const context = await guest.call('artifact_read', { mode: 'context', contextId: feedbackId });
    expect(context.response.status).toBe(404); expect(JSON.stringify(context.body)).not.toContain('Private A');
  });
});

describe('feedback and sharing schema through the real MCP SDK', () => {
  it('exposes the declared model tools and enforces authorship on parsed edit/delete actions', async () => {
    let actor: Actor = { ...LOCAL_ACTOR };
    const server = createStudioServer({ execute: (name, args) => host.service.execute(name, args, actor), connection: async () => ({ baseUrl: host.origin, token: host.token, actor }) }, '<html></html>');
    const client = new Client({ name: 'studio-sharing-feedback', version: '1.0.0' }), [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport); await client.connect(clientTransport);
    try {
      const listing = await client.listTools();
      const modelTools = listing.tools.filter(tool => { const ui = tool._meta?.ui as { visibility?: string[] } | undefined; return !ui?.visibility || ui.visibility.includes('model'); });
      expect(modelTools.map(tool => tool.name).sort()).toEqual(TOOL_NAMES.filter(name => name !== 'studio_open').sort());
      expect(modelTools.map(tool => tool.name)).not.toContain('studio_app_request');
      expect(listing.tools.find(tool => tool.name === 'studio_app_request')).toMatchObject({ _meta: { ui: { visibility: ['app'] } } });
      const call = async (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: { artifactId, ...args } });
      const anchor = { coordinateSpace: 'html', regionId: 'html', sourceRevision: 1, x: 5, y: 8, w: 140, h: 25, pin: { coordinateSpace: 'board', x: 327.25, y: -118.5 } };
      const created = await call('artifact_feedback', { action: 'create', text: 'SDK message', anchor, versions: { html: 1 } });
      const feedbackId = (created.structuredContent as any).data.feedback[0].id;
      expect((created.structuredContent as any).data.feedback[0].anchor).toEqual(anchor);
      const source = await call('artifact_read', { mode: 'source', feedbackId, regionId: 'html' });
      expect((source.structuredContent as any).data.html).toBe('<h1>Frozen source</h1>');
      const reply = await call('artifact_feedback', { action: 'reply', feedbackId, text: 'SDK reply' });
      const replyId = (reply.structuredContent as any).data.feedback[0].replies[0].id;
      const edited = await call('artifact_feedback', { action: 'edit', feedbackId, replyId, text: 'SDK edited reply' });
      expect((edited.structuredContent as any).data.feedback[0].replies[0].text).toBe('SDK edited reply');
      actor = { id: 'another-editor', name: 'Other', role: 'editor', kind: 'human' };
      expect((await call('artifact_feedback', { action: 'edit', feedbackId, text: 'Forbidden' })).structuredContent).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect((await call('artifact_share', { action: 'link', role: 'editor', on: false })).structuredContent).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      actor = { ...LOCAL_ACTOR };
      expect((await call('artifact_share', { action: 'link', role: 'editor', on: false })).structuredContent).toMatchObject({ ok: true, data: { roleEnabled: { editor: false } } });
      const sharing = (await call('artifact_share', { action: 'start', access: 'local' })).structuredContent as any;
      const visitor = browser(tokenFor(sharing.data, 'viewer'), 'SDK restored visitor'), visitorId = (await visitor.session()).body.actor.id;
      expect((await call('artifact_share', { action: 'remove', memberId: visitorId })).structuredContent).toMatchObject({ ok: true });
      expect((await call('artifact_share', { action: 'restore', memberId: visitorId, role: 'commenter' })).structuredContent).toMatchObject({ ok: true, data: { removedMembers: [] } });
      expect((await visitor.session()).body.actor).toMatchObject({ id: visitorId, role: 'commenter' });
      expect((await call('artifact_share', { action: 'remove', memberId: visitorId })).structuredContent).toMatchObject({ ok: true });
      expect((await call('artifact_share', { action: 'forget', memberId: visitorId })).structuredContent).toMatchObject({ ok: true, data: { removedMembers: [] } });
      expect((await visitor.session()).body.error.code).toBe('NAME_REQUIRED');
      expect((await call('artifact_feedback', { action: 'delete', feedbackId })).structuredContent).toMatchObject({ ok: true, data: { feedback: [] } });
    } finally { await client.close(); await server.close(); }
  });
});
