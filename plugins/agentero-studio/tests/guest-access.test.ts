import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { startStudioHost, type StudioHost } from '../src/server/http.js';

let directory: string, host: StudioHost, artifactId: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-guest-access-'));
  host = await startStudioHost({ dataRoot: directory });
  artifactId = (await host.service.execute('artifact_manage', { action: 'create', elements: [{ id: 'html', type: 'html', html: '<h1>Private board source</h1>' }] })).artifact.id;
});
afterEach(async () => {
  vi.restoreAllMocks(); await host.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory');
  await rm(directory, { recursive: true, force: true });
});
const share = (args: Record<string, unknown> = {}) => host.service.execute('artifact_share', { artifactId, ...args });
const tokenFor = (info: any, role = 'editor') => new URL(info.links[role]).searchParams.get('share')!;
function browser(token: string, baseUrl = host.origin) {
  let cookie = '', lastCookie = '';
  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers); headers.set('Authorization', `Bearer ${token}`);
    if (cookie && !headers.has('Cookie')) headers.set('Cookie', cookie);
    const response = await fetch(baseUrl + path, { ...init, headers, redirect: 'manual' });
    const issued = response.headers.get('set-cookie'); if (issued) { lastCookie = issued; cookie = issued.split(';')[0]!; }
    return response;
  }
  return {
    request, get cookie() { return cookie; }, get issuedCookie() { return lastCookie; },
    use(next: string) { token = next; },
    setCookie(value: string) { cookie = value; },
    async session() { const response = await request(`/api/session?artifactId=${artifactId}`); return { response, body: await response.json() }; },
    async name(name: string, form = false) {
      const response = await request(`/api/session?artifactId=${artifactId}`, { method: 'POST', headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }, body: form ? new URLSearchParams({ name }).toString() : JSON.stringify({ name }) });
      return { response, body: form ? await response.text() : await response.json() };
    },
    async tool(name: string, args: Record<string, unknown>) {
      const response = await request(`/api/tools/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId, ...args }) });
      return { response, body: await response.json() };
    },
  };
}
async function until(reader: ReadableStreamDefaultReader<Uint8Array>, marker: string) {
  let value = ''; const timeout = setTimeout(() => { void reader.cancel(); }, 3000);
  try { while (!value.includes(marker)) { const next = await reader.read(); if (next.done) break; value += new TextDecoder().decode(next.value); } return value; }
  finally { clearTimeout(timeout); }
}
async function region(guest: ReturnType<typeof browser>, baseUrl = host.origin) {
  const response = await guest.request('/api/region-view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId, regionId: 'html', viewId: 'source-view' }) });
  expect(response.status).toBe(200); const link = (await response.json()).data.url;
  const capability = new URLSearchParams(new URL(link).hash.slice(1)).get('cap')!;
  return { capability, read: () => fetch(`${baseUrl}/api/region-reader/${artifactId}/html`, { headers: { Authorization: `Bearer ${capability}` } }) };
}

describe('persistent named anonymous guests', () => {
  it.each([['editor', '编辑'], ['commenter', '评论'], ['viewer', '查看']])('shows only the authorized invitation title and %s role before naming', async (role, label) => {
    const title = '产品 <研究> & 规划';
    await host.service.execute('artifact_manage', { artifactId, action: 'rename', title });
    const info = await share({ action: 'start', access: 'local' }), guest = browser(tokenFor(info, role));
    const html = await (await guest.request(`/?artifactId=${artifactId}`)).text();
    expect(html).toContain('<h1>产品 &lt;研究&gt; &amp; 规划</h1>');
    expect(html).toContain(`你被邀请${label}这块白板。`);
    expect(html).toContain('你的名字（别人会在你的评论和编辑上看到它）'); expect(html).toContain('>打开白板</button>');
    expect(html).toContain('这个浏览器会记住你的身份；所有者可以随时移除。');
    expect(html).not.toContain('Private board source'); expect(html).not.toContain(host.token);
    const pending = await guest.session();
    expect(pending.body.error.details.invitation).toEqual({ title, role });
    const invalid = browser('invalid-invitation');
    const rejected = await invalid.session();
    expect(rejected.body.error.details).toEqual({ reason: 'invalid-link' });
    expect(await (await invalid.request(`/?artifactId=${artifactId}`)).text()).not.toContain('产品');
  });

  it('preserves the title, role invitation and escaped input when a form name conflicts', async () => {
    await host.service.execute('artifact_manage', { artifactId, action: 'rename', title: '协作白板' });
    const info = await share({ action: 'start', access: 'local' }), a = browser(tokenFor(info)), b = browser(tokenFor(info, 'commenter'));
    await a.name('Alice');
    const conflict = await b.name('alice', true);
    expect(conflict.response.status).toBe(409);
    expect(conflict.body).toContain('<h1>协作白板</h1>'); expect(conflict.body).toContain('你被邀请评论这块白板。');
    expect(conflict.body).toContain('value="alice"'); expect(conflict.body).toContain('这个名字已有人使用');
    expect(conflict.body).not.toContain(host.token); expect(conflict.body).not.toContain('Private board source');
  });

  it('requires a name before joining, serves a centered form, and remembers the canonical name without trusting headers or presence', async () => {
    const info = await share({ action: 'start', access: 'local' }), guest = browser(tokenFor(info));
    const page = await guest.request(`/?artifactId=${artifactId}`), html = await page.text();
    expect(page.status).toBe(200); expect(html).toContain('<form method="post"'); expect(html).toContain('你的名字');
    expect(html).not.toContain('__STUDIO_BOOT__'); expect(html).not.toContain('Private board source');
    expect(guest.issuedCookie).toContain('HttpOnly; SameSite=Lax; Max-Age=31536000');
    expect((await guest.session()).body).toMatchObject({ ok: false, error: { code: 'NAME_REQUIRED' } });
    expect((await guest.tool('artifact_read', {})).response.status).toBe(428);
    expect((await share()).members).toEqual([]);
    const joined = await guest.name(' Ａlice ', true);
    expect(joined.response.status).toBe(303);
    expect(joined.response.headers.get('location')).toBe(`/?${new URLSearchParams({ artifactId })}`);
    const session = await guest.session(); expect(session.body).toMatchObject({ actor: { name: 'Alice', role: 'editor' }, access: 'local' });
    const renamed = await guest.request(`/api/session?artifactId=${artifactId}`, { headers: { 'X-Studio-Name': 'Attacker' } });
    expect((await renamed.json()).actor.name).toBe('Alice');
    const presence = await guest.request('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId, peerId: 'view-one', name: 'Spoofed' }) });
    expect((await presence.json()).peers[0].actor.name).toBe('Alice');
    const feedback = await guest.tool('artifact_feedback', { action: 'create', text: 'My comment' });
    expect(feedback.body.data.feedback[0].author).toMatchObject({ id: session.body.actor.id, name: 'Alice' });
    expect(await (await guest.request(`/?artifactId=${artifactId}`)).text()).toContain('"name":"Alice"');
    expect((await guest.name('Changed')).body).toMatchObject({ ok: false, error: { code: 'NAME_ALREADY_SET' } });
  });

  it('atomically reserves normalized names across concurrent joins and retains offline, removed and owner names', async () => {
    const info = await share({ action: 'start', access: 'local' }), a = browser(tokenFor(info)), b = browser(tokenFor(info));
    await Promise.all([a.session(), b.session()]);
    const outcomes = await Promise.all([a.name(' Ａlice '), b.name('alice')]);
    expect(outcomes.map(value => value.response.status).sort()).toEqual([200, 409]);
    const winner = outcomes[0]!.response.status === 200 ? a : b, loser = winner === a ? b : a;
    const actor = (await winner.session()).body.actor;
    expect((await loser.name('ALICE')).body).toMatchObject({ ok: false, error: { code: 'NAME_TAKEN' } });
    await share({ action: 'remove', memberId: actor.id });
    expect((await winner.session()).body.error.details.reason).toBe('removed');
    expect((await loser.name('alice')).body.error.code).toBe('NAME_TAKEN');
    expect((await loser.name(` ${host.service.owner.name} `)).body.error.code).toBe('NAME_TAKEN');
    await host.service.store.transaction(artifactId, state => { state.sharing.members ??= {}; state.sharing.members['guest-legacy'] = { id: 'guest-legacy', name: 'Legacy', role: 'viewer', credential: tokenFor(info, 'viewer'), roleToken: tokenFor(info, 'viewer'), joinedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), removed: true }; });
    expect((await loser.name('ＬＥＧＡＣＹ')).body.error.code).toBe('NAME_TAKEN');
    await share({ action: 'stop' }); const next = await share({ action: 'start', access: 'local' });
    loser.use(tokenFor(next)); winner.use(tokenFor(next));
    expect((await loser.name('alice')).body.error.code).toBe('NAME_TAKEN');
    expect((await loser.name('Legacy')).body.error.code).toBe('NAME_TAKEN');
    expect((await winner.session()).body.actor).toMatchObject({ id: actor.id, name: actor.name });
  });

  it('retains identity, name and original comment authorship across restart while old grants stay revoked', async () => {
    let info = await share({ action: 'start', access: 'local' }); const oldToken = tokenFor(info), guest = browser(oldToken);
    const joined = await guest.name('Remember me'), actor = joined.body.actor, cookie = guest.cookie;
    const feedback = await guest.tool('artifact_feedback', { action: 'create', text: 'Original author' }), feedbackId = feedback.body.data.feedback[0].id;
    const keyBefore = await readFile(join(directory, 'guest-auth.json'), 'utf8');
    await host.close(); host = await startStudioHost({ dataRoot: directory });
    info = await share({ action: 'start', access: 'local' });
    const next = browser(oldToken); next.setCookie(cookie);
    expect((await next.session()).body.error.details.reason).toBe('sharing-closed');
    next.use(tokenFor(info));
    expect((await next.session()).body.actor).toEqual(actor);
    expect((await next.tool('artifact_feedback', { action: 'edit', feedbackId, text: 'Still my message' })).response.status).toBe(200);
    expect(await readFile(join(directory, 'guest-auth.json'), 'utf8')).toBe(keyBefore);
    expect(next.issuedCookie).toBe('');
  });

  it('shares one atomically initialized signing key and name reservation across independent concurrent hosts', async () => {
    const root = join(directory, 'concurrent');
    const [first, second] = await Promise.all([startStudioHost({ dataRoot: root }), startStudioHost({ dataRoot: root })]);
    try {
      artifactId = (await first.service.execute('artifact_manage', { action: 'create' })).artifact.id;
      const info = await first.service.execute('artifact_share', { artifactId, action: 'start', access: 'local' });
      const a = browser(tokenFor(info), first.origin), b = browser(tokenFor(info), second.origin);
      await Promise.all([a.session(), b.session()]);
      const joined = await Promise.all([a.name('Concurrent'), b.name('ｃｏｎｃｕｒｒｅｎｔ')]);
      expect(joined.map(value => value.response.status).sort()).toEqual([200, 409]);
      const winner = joined[0]!.response.status === 200 ? a : b, other = winner === a ? b : a;
      other.setCookie(winner.cookie);
      expect((await other.session()).body.actor).toEqual((await winner.session()).body.actor);
    } finally { await first.close(); await second.close(); }
  });

  it('preserves a corrupt persisted signing key instead of silently replacing existing identities', async () => {
    const root = join(directory, 'corrupt-key'); await mkdir(root);
    const file = join(root, 'guest-auth.json'); await writeFile(file, 'null');
    await expect(startStudioHost({ dataRoot: root })).rejects.toMatchObject({ code: 'CORRUPT_IDENTITY' });
    expect(await readFile(file, 'utf8')).toBe('null');
  });
});

describe('access reasons and local/LAN invitation scope', () => {
  it.each([['link', 'link-disabled'], ['reset', 'link-reset'], ['remove', 'removed'], ['stop', 'sharing-closed']] as const)('reports %s loss in HTTP, SSE and a standalone page', async (action, reason) => {
    const info = await share({ action: 'start', access: 'local' }), guest = browser(tokenFor(info));
    const joined = await guest.name('Named visitor'), stream = await guest.request(`/api/events?artifactId=${artifactId}`), reader = stream.body!.getReader();
    await until(reader, 'ready');
    await share({ action, role: 'editor', on: false, memberId: joined.body.actor.id });
    expect(await until(reader, 'access-revoked')).toContain(`"reason":"${reason}"`); await reader.cancel();
    expect((await guest.session()).body).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED', details: { reason } } });
    const page = await guest.request(`/?artifactId=${artifactId}`), html = await page.text();
    expect(page.status).toBe(401); expect(page.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('无权访问'); expect(html).not.toContain('__STUDIO_BOOT__'); expect(html).not.toContain('<form');
  });

  it('keeps role-change notifications recoverable through session revalidation', async () => {
    const info = await share({ action: 'start', access: 'local' }), guest = browser(tokenFor(info));
    const joined = await guest.name('Downgraded'), stream = await guest.request(`/api/events?artifactId=${artifactId}`), reader = stream.body!.getReader(); await until(reader, 'ready');
    await share({ action: 'role', memberId: joined.body.actor.id, role: 'viewer' });
    expect(await until(reader, 'access-revoked')).toContain('"reason":"role-changed"'); await reader.cancel();
    expect((await guest.session()).body.actor.role).toBe('viewer');
    expect((await guest.tool('artifact_apply', { operations: [{ op: 'add', element: { type: 'text' } }] })).response.status).toBe(403);
  });

  it('copies local role invitations without opening a LAN listener and enforces scope on every listener and reader', async () => {
    const listen = vi.spyOn(Server.prototype, 'listen');
    const local = await share({ action: 'start', access: 'local' });
    expect(listen).not.toHaveBeenCalled(); expect(new URL(local.links.editor).origin).toBe(host.origin); expect(local.access).toBe('local'); expect(await host.service.hasShares()).toBe(false);
    listen.mockRestore();
    const localGuest = browser(tokenFor(local)); const actor = (await localGuest.name('Local guest')).body.actor;
    const localSource = await region(localGuest), localStream = await localGuest.request(`/api/events?artifactId=${artifactId}`), localReader = localStream.body!.getReader(); await until(localReader, 'ready');
    const otherId = (await host.service.execute('artifact_manage', { action: 'create' })).artifact.id;
    const other = await host.service.execute('artifact_share', { artifactId: otherId, action: 'start' }), lanOrigin = new URL(other.links.editor).origin;
    const denied = await fetch(`${lanOrigin}/api/session?artifactId=${artifactId}&share=${tokenFor(local)}`);
    expect(denied.status).toBe(401); expect((await denied.json()).error.details.reason).toBe('local-only');
    expect((await fetch(`${lanOrigin}/api/tools/artifact_read`, { method: 'POST', headers: { Authorization: `Bearer ${host.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId }) })).status).toBe(401);
    expect((await fetch(`${lanOrigin}/api/region-reader/${artifactId}/html`, { headers: { Authorization: `Bearer ${localSource.capability}` } })).status).toBe(401);
    const lan = await share({ action: 'start', access: 'lan' });
    expect(tokenFor(lan)).toBe(tokenFor(local)); expect((await localGuest.session()).body).toMatchObject({ actor: { id: actor.id }, access: 'lan' });
    const lanGuest = browser(tokenFor(lan), lanOrigin); await lanGuest.name('LAN guest');
    const lanSource = await region(lanGuest, lanOrigin), lanStream = await lanGuest.request(`/api/events?artifactId=${artifactId}`), lanReader = lanStream.body!.getReader(); await until(lanReader, 'ready');
    const again = await share({ action: 'start', access: 'local' });
    expect(tokenFor(again)).toBe(tokenFor(local)); expect(again.members).toHaveLength(2);
    expect(await until(lanReader, 'access-revoked')).toContain('"reason":"local-only"'); await lanReader.cancel();
    expect(await until(localReader, '"type":"share"')).not.toContain('access-revoked'); await localReader.cancel();
    expect((await localSource.read()).status).toBe(200); expect((await lanSource.read()).status).toBe(401);
    expect((await localGuest.session()).body.access).toBe('local');
    expect((await lanGuest.session()).body.error.details.reason).toBe('local-only');
  });
});
