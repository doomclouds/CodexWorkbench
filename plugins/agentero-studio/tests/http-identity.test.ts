import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { startStudioHost, type StudioHost } from '../src/server/http.js';

let directory: string, host: StudioHost;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'studio-http-identity-')); host = await startStudioHost({ dataRoot: directory }); });
afterEach(async () => { await host.close(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory'); await rm(directory, { recursive: true, force: true }); });
async function sharedWork() {
  const { artifact } = await host.service.execute('artifact_manage', { action: 'create' });
  const share = await host.service.execute('artifact_share', { artifactId: artifact.id, action: 'start' });
  const token = (role: string) => new URL(share.links[role]).searchParams.get('share')!;
  return { artifactId: artifact.id as string, token };
}
// Node fetch has no cookie jar; retain Set-Cookie as a same-origin browser does.
function browser(token: string) {
  let cookie = '';
  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers); headers.set('Authorization', `Bearer ${token}`);
    if (cookie && !headers.has('Cookie')) headers.set('Cookie', cookie);
    const response = await fetch(`${host.origin}${path}`, { ...init, headers });
    const issued = response.headers.get('set-cookie'); if (issued) cookie = issued.split(';')[0]!;
    return response;
  }
  return {
    request, get cookie() { return cookie; },
    async call(name: string, args: Record<string, unknown>, headers: Record<string, string> = {}) {
      const response = await request(`/api/tools/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(args) });
      return { response, value: await response.json() };
    },
  };
}
async function readSse(reader: ReadableStreamDefaultReader<Uint8Array>, match: string) {
  let text = ''; const stop = setTimeout(() => { void reader.cancel(); }, 3000);
  try { while (!text.includes(match)) { const next = await reader.read(); if (next.done) break; text += new TextDecoder().decode(next.value); } return text; } finally { clearTimeout(stop); }
}

describe('signed anonymous HTTP identity', () => {
  it('rejects public actor IDs, view headers and unsigned or forged cookies as comment authorship', async () => {
    const { artifactId, token } = await sharedWork(), a = browser(token('commenter')), b = browser(token('commenter'));
    const created = await a.call('artifact_feedback', { artifactId, action: 'create', text: 'A 的备注' });
    expect(created.response.status).toBe(200); expect(created.response.headers.get('set-cookie')).toContain('HttpOnly');
    const feedback = created.value.data.feedback[0], aId = feedback.author.id as string, sid = aId.slice('guest-'.length);
    const session = await b.request(`/api/session?artifactId=${artifactId}`), bActor = (await session.json()).actor;
    expect(bActor.id).not.toBe(aId); expect(bActor.name).not.toBe(feedback.author.name);
    const presence = await a.request(`/api/presence?artifactId=${artifactId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Peer-Id': 'a-view' }, body: JSON.stringify({ peerId: 'a-view' }) });
    expect(presence.status).toBe(200);
    const peers = await (await b.request(`/api/presence?artifactId=${artifactId}`)).json();
    expect(peers.peers[0]).toMatchObject({ peerId: 'a-view', actor: { id: aId } });
    const cookieName = a.cookie.split('=')[0]!, bSignature = b.cookie.split('.')[1]!;
    const attempts: Record<string, string>[] = [
      { 'X-Studio-Peer-Id': sid },
      { 'X-Studio-Peer-Id': aId },
      { Cookie: `studio-peer=${sid}` },
      { Cookie: `${cookieName}=${sid}` },
      { Cookie: `${cookieName}=${sid}.${bSignature}` },
    ];
    for (const headers of attempts) {
      const denied = await b.call('artifact_feedback', { artifactId, action: 'resolve', feedbackId: feedback.id }, headers);
      expect(denied.response.status).toBe(403); expect(denied.value.error.code).toBe('FORBIDDEN');
    }
    const resolved = await a.call('artifact_feedback', { artifactId, action: 'resolve', feedbackId: feedback.id });
    expect(resolved.response.status).toBe(200); expect(resolved.value.data.feedback[0].status).toBe('resolved');
    expect((await b.call('artifact_feedback', { artifactId, action: 'reopen', feedbackId: feedback.id }, { 'X-Studio-Peer-Id': sid })).response.status).toBe(403);
    expect((await a.call('artifact_feedback', { artifactId, action: 'reopen', feedbackId: feedback.id })).value.data.feedback[0].status).toBe('open');
    expect(JSON.stringify(peers)).not.toContain(a.cookie.split('.')[1]!);
  });

  it('keeps one signed identity across bootstrap, API calls and independent view IDs', async () => {
    const { artifactId, token } = await sharedWork(), guest = browser(token('editor'));
    const page = await guest.request(`/?artifactId=${artifactId}`), html = await page.text(), issued = page.headers.get('set-cookie')!;
    expect(issued).toMatch(/^studio-guest-[a-f0-9]+=.+; Path=\/; HttpOnly; SameSite=Lax$/); expect(issued).not.toContain('Secure');
    const cookie = guest.cookie, actor = (await (await guest.request(`/api/session?artifactId=${artifactId}`)).json()).actor;
    expect(html).toContain(`"id":"${actor.id}"`); expect(html).not.toContain(cookie.split('.')[1]!);
    for (const peerId of ['first-view', 'second-view']) {
      const response = await guest.request(`/api/presence?artifactId=${artifactId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Peer-Id': peerId }, body: JSON.stringify({ peerId }) });
      expect(response.status).toBe(200); expect((await response.json()).peers.every((peer: { actor: { id: string } }) => peer.actor.id === actor.id)).toBe(true);
    }
    expect(guest.cookie).toBe(cookie);
    const again = await guest.request(`/?artifactId=${artifactId}`);
    expect(again.headers.get('set-cookie')).toBeNull(); expect(await again.text()).toContain(`"id":"${actor.id}"`);
  });

  it('protects editor undo authorship while allowing the signed author to undo', async () => {
    const { artifactId, token } = await sharedWork(), a = browser(token('editor')), b = browser(token('editor'));
    const edited = await a.call('artifact_apply', { artifactId, operations: [{ op: 'add', element: { id: 'owned-element', type: 'text' } }] });
    expect(edited.response.status).toBe(200);
    const entry = edited.value.data.historyEntry, undo = { artifactId, expectedRevision: entry.revision, operations: [{ op: 'restore', versionId: entry.id, data: { mode: 'undo' } }] };
    expect((await b.call('artifact_apply', undo, { 'X-Studio-Peer-Id': entry.actor.id.slice('guest-'.length) })).response.status).toBe(403);
    const undone = await a.call('artifact_apply', undo);
    expect(undone.response.status).toBe(200); expect(undone.value.data.board.elements).toEqual([]);
  });

  it('issues a signed cookie on direct guest SSE and retains role scope and immediate revocation', async () => {
    const { artifactId, token } = await sharedWork(), guest = browser(token('viewer'));
    const stream = await guest.request(`/api/events?artifactId=${artifactId}`), reader = stream.body!.getReader();
    expect(stream.status).toBe(200); expect(stream.headers.get('set-cookie')).toContain('HttpOnly');
    const ready = await readSse(reader, 'ready'), session = await guest.request(`/api/session?artifactId=${artifactId}`), actor = (await session.json()).actor;
    expect(ready).toContain(`"id":"${actor.id}"`); expect(actor.role).toBe('viewer');
    expect((await guest.call('artifact_feedback', { artifactId, action: 'create', text: '禁止修改' })).response.status).toBe(403);
    const other = await host.service.execute('artifact_manage', { action: 'create' });
    expect((await guest.call('artifact_read', { artifactId: other.artifact.id })).response.status).toBe(401);
    await host.service.execute('artifact_share', { artifactId, action: 'reset', role: 'viewer' });
    expect(await readSse(reader, 'access-revoked')).toContain('access-revoked');
    expect((await guest.request(`/api/session?artifactId=${artifactId}`)).status).toBe(401);
    await reader.cancel();
  });

  it('isolates cookies from a previous server instance using the same data root', async () => {
    const { artifactId, token } = await sharedWork(), guest = browser(token('commenter'));
    const actor = (await (await guest.request(`/api/session?artifactId=${artifactId}`)).json()).actor, oldCookie = guest.cookie;
    await host.close(); host = await startStudioHost({ dataRoot: directory });
    const share = await host.service.execute('artifact_share', { artifactId, action: 'start' }), renewedToken = new URL(share.links.commenter).searchParams.get('share')!;
    const next = browser(renewedToken), response = await next.request(`/api/session?artifactId=${artifactId}`, { headers: { Cookie: oldCookie, 'X-Studio-Peer-Id': actor.id.slice('guest-'.length) } });
    expect(response.status).toBe(200); expect((await response.json()).actor.id).not.toBe(actor.id);
    expect(next.cookie.split('=')[0]).not.toBe(oldCookie.split('=')[0]);
  });
});
