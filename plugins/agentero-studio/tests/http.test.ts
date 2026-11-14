import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startStudioHost, type StudioHost } from '../src/server/http.js';

let directory: string, host: StudioHost;
const guestCookies = new Map<string, string>();
const guestHeaders = (token: string): Record<string, string> => guestCookies.has(token) ? { Cookie: guestCookies.get(token)! } : {};
beforeEach(async () => { guestCookies.clear(); directory = await mkdtemp(join(tmpdir(), 'agentero-studio-http-')); host = await startStudioHost({ dataRoot: directory, html: '<!doctype html><html><head><title>Studio</title></head><body><div id="root"></div></body></html>' }); });
afterEach(async () => { await host.close(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory'); await rm(directory, { recursive: true, force: true }); });
async function call(name: string, args: Record<string, unknown>, token = host.token, headers: Record<string, string> = {}) {
  const response = await fetch(`${host.origin}/api/tools/${name}${typeof args.artifactId === 'string' ? `?artifactId=${args.artifactId}` : ''}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...guestHeaders(token), ...headers }, body: JSON.stringify(args) });
  return { response, value: await response.json() };
}
async function work() { return (await call('artifact_manage', { action: 'create', title: 'LAN 设计' })).value.data.artifact; }
async function sharing(id: string) {
  const info = (await call('artifact_share', { artifactId: id, action: 'start' })).value.data;
  for (const role of ['editor', 'commenter', 'viewer']) {
    const token = shareToken(info, role), joined = await fetch(`${host.origin}/api/session?artifactId=${id}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `${role}-${id.slice(0, 8)}` }) });
    expect(joined.status).toBe(200); guestCookies.set(token, joined.headers.get('set-cookie')!.split(';')[0]!);
  }
  return info;
}
function shareToken(share: { links: Record<string, string> }, role: string) { return new URL(share.links[role]!).searchParams.get('share')!; }
async function readSse(reader: ReadableStreamDefaultReader<Uint8Array>, match: string) {
  let text = '';
  const stop = setTimeout(() => { void reader.cancel(); }, 3000);
  try { while (!text.includes(match)) { const next = await reader.read(); if (next.done) break; text += new TextDecoder().decode(next.value); } return text; } finally { clearTimeout(stop); }
}

describe('Studio authenticated local and LAN host', () => {
  it('rejects a requested browser-blocked port before starting a service', async () => {
    await expect(startStudioHost({ dataRoot: directory, port: 6000 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect((await fetch(`${host.origin}/api/session?token=${host.token}`)).status).toBe(200);
  });
  it('rebinds an automatically assigned browser-blocked port and serves a real response', async () => {
    await host.close();
    const original = Server.prototype.address;
    let assigned = false;
    const address = vi.spyOn(Server.prototype, 'address').mockImplementation(function (this: Server) {
      if (!assigned) { assigned = true; return { address: '127.0.0.1', family: 'IPv4', port: 6000 }; }
      return original.call(this);
    });
    try {
      host = await startStudioHost({ dataRoot: directory });
      expect(address.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(new URL(host.origin).port).not.toBe('6000');
      expect((await fetch(`${host.origin}/api/session?token=${host.token}`)).status).toBe(200);
    } finally { address.mockRestore(); }
  });
  it('requires authentication and injects only the authenticated web session', async () => {
    expect((await fetch(`${host.origin}/api/session`)).status).toBe(401);
    const page = await fetch(`${host.origin}/?token=${host.token}`), html = await page.text();
    expect(page.status).toBe(200); expect(html).toContain('window.__STUDIO_BOOT__'); expect(html).toContain('"role":"owner"');
    expect((await call('studio_open', {})).value).toMatchObject({ ok: true, data: { view: 'library' } });
  });
  it('injects bootstrap before the bundle without rewriting HTML literals inside JavaScript', async () => {
    await host.close();
    const bundle = '<script type="module">const exportTemplate = "<html><head></head><body>export</body></html>";</script>';
    const source = `<!doctype html><html><head data-test="real-head">${bundle}</head><body><div id="root"></div></body></html>`;
    host = await startStudioHost({ dataRoot: directory, html: source });
    const html = await (await fetch(`${host.origin}/?token=${host.token}`)).text();
    expect(html).toContain('<head data-test="real-head"><script>window.__STUDIO_BOOT__=');
    expect(html).toContain(bundle);
    expect(html.replace(/<script>window\.__STUDIO_BOOT__=.*?<\/script>/, '')).toBe(source);
  });
  it('shares a real LAN web entry and restricts editor/commenter/viewer roles', async () => {
    const artifact = await work(), shared = await sharing(artifact.id);
    expect(shared.enabled).toBe(true); expect(new URL(shared.links.editor).hostname).not.toBe('127.0.0.1');
    const page = await fetch(shared.links.editor, { headers: guestHeaders(shareToken(shared, 'editor')) }); expect(page.status).toBe(200); expect(await page.text()).toContain('"role":"editor"');
    const operation = { artifactId: artifact.id, operationId: randomUUID(), operations: [{ op: 'add', element: { id: 'node-a', type: 'text', text: '共同编辑' } }] };
    const edited = await call('artifact_apply', operation, shareToken(shared, 'editor'), { 'X-Studio-Actor': 'agent' });
    expect(edited.response.status).toBe(200); expect(edited.value.data.historyEntry.actor).toMatchObject({ role: 'editor', kind: 'human' });
    expect((await call('artifact_apply', { ...operation, operationId: randomUUID() }, shareToken(shared, 'commenter'))).response.status).toBe(403);
    expect((await call('artifact_feedback', { artifactId: artifact.id, action: 'create', text: '请检查这里' }, shareToken(shared, 'commenter'))).response.status).toBe(200);
    expect((await call('artifact_feedback', { artifactId: artifact.id, action: 'create', text: '不能评论' }, shareToken(shared, 'viewer'))).response.status).toBe(403);
    expect((await call('artifact_share', { artifactId: artifact.id, action: 'stop' }, shareToken(shared, 'editor'))).response.status).toBe(403);
    expect((await call('artifact_list', { artifactId: artifact.id }, shareToken(shared, 'editor'))).response.status).toBe(403);
    const other = await work(); expect((await call('artifact_read', { artifactId: other.id }, shareToken(shared, 'viewer'))).response.status).toBe(401);
  });
  it('records agent authorship only for an authenticated local owner', async () => {
    const artifact = await work();
    const result = await call('artifact_apply', { artifactId: artifact.id, operationId: randomUUID(), operations: [{ op: 'add', element: { type: 'text' } }] }, host.token, { 'X-Studio-Actor': 'agent' });
    expect(result.value.data.historyEntry.actor).toMatchObject({ id: 'codex', kind: 'agent', role: 'owner' });
  });
  it('keeps recycle bin thumbnail previews owner-only without restoring the work', async () => {
    const artifact = await work(), shared = await sharing(artifact.id), viewer = shareToken(shared, 'viewer');
    await call('artifact_apply', { artifactId: artifact.id, operationId: randomUUID(), operations: [{ op: 'add', element: { type: 'text', text: '回收站预览保留内容' } }] });
    const path = `${host.origin}/api/thumbnails/${artifact.id}`;
    expect((await fetch(`${path}?token=${viewer}`, { headers: guestHeaders(viewer) })).status).toBe(200);
    await call('artifact_manage', { action: 'trash', artifactId: artifact.id });
    const preview = await fetch(`${path}?token=${host.token}`);
    expect(preview.status).toBe(200); expect(preview.headers.get('content-type')).toBe('image/svg+xml');
    expect(await preview.text()).toContain('回收站预览保留内容');
    expect((await fetch(path)).status).toBe(401);
    expect((await fetch(`${path}?token=${viewer}`, { headers: guestHeaders(viewer) })).status).toBe(401);
    await expect(host.service.getThumbnail(artifact.id, { id: 'viewer', name: 'Viewer', kind: 'human', role: 'viewer' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await call('artifact_read', { artifactId: artifact.id })).value.data.artifact.trashedAt).toEqual(expect.any(String));
    expect((await call('artifact_list', { trashed: true })).value.data.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ id: artifact.id, trashedAt: expect.any(String) })]));
  });
  it('streams shared edits and terminates old live connections on link reset', async () => {
    const artifact = await work(), shared = await sharing(artifact.id), token = shareToken(shared, 'viewer');
    const response = await fetch(`${host.origin}/api/events?artifactId=${artifact.id}&token=${token}`, { headers: guestHeaders(token) }), reader = response.body!.getReader();
    expect(await readSse(reader, 'ready')).toContain('ready');
    await call('artifact_apply', { artifactId: artifact.id, operationId: randomUUID(), operations: [{ op: 'add', element: { type: 'text' } }] });
    expect(await readSse(reader, '"type":"board"')).toContain('"type":"board"');
    await call('artifact_share', { artifactId: artifact.id, action: 'reset', role: 'viewer' });
    expect(await readSse(reader, 'access-revoked')).toContain('access-revoked');
    expect((await fetch(`${host.origin}/api/session?artifactId=${artifact.id}&token=${token}`)).status).toBe(401);
    await reader.cancel();
  });
  it('preserves committed content after closing sharing and revokes guest reads', async () => {
    const artifact = await work(), shared = await sharing(artifact.id), token = shareToken(shared, 'editor');
    await call('artifact_apply', { artifactId: artifact.id, operationId: randomUUID(), operations: [{ op: 'add', element: { type: 'text', text: '仍然保存' } }] }, token);
    await call('artifact_share', { artifactId: artifact.id, action: 'stop' });
    expect((await call('artifact_read', { artifactId: artifact.id }, token)).response.status).toBe(401);
    expect((await call('artifact_read', { artifactId: artifact.id })).value.data.elements[0].text).toBe('仍然保存');
  });
  it('authenticates asset reads, enforces artifact boundaries and sends presence', async () => {
    const artifact = await work(), shared = await sharing(artifact.id), editor = shareToken(shared, 'editor'), viewer = shareToken(shared, 'viewer');
    const upload = await fetch(`${host.origin}/api/assets?artifactId=${artifact.id}`, { method: 'POST', headers: { Authorization: `Bearer ${editor}`, ...guestHeaders(editor), 'Content-Type': 'image/png', 'X-Filename': encodeURIComponent('截图.png') }, body: Buffer.from('89504e470d0a1a0a', 'hex') });
    expect(upload.status).toBe(200); const asset = await upload.json();
    expect((await fetch(`${host.origin}${asset.url}`)).status).toBe(401);
    expect((await fetch(`${host.origin}${asset.url}?token=${viewer}`, { headers: guestHeaders(viewer) })).status).toBe(200);
    const presence = await fetch(`${host.origin}/api/presence?artifactId=${artifact.id}`, { method: 'POST', headers: { Authorization: `Bearer ${editor}`, ...guestHeaders(editor), 'Content-Type': 'application/json', 'X-Studio-Peer-Id': 'peer-test' }, body: JSON.stringify({ peerId: 'peer-test', context: { viewId: 'view-test', artifactId: artifact.id, selectedIds: [] }, cursor: { x: 10, y: 40 } }) });
    expect(presence.status).toBe(200); expect((await presence.json()).peers[0]).toMatchObject({ peerId: 'peer-test', cursor: { x: 10, y: 40 }, actor: { role: 'editor' } });
  });
  it('exports to authenticated downloads without putting large bytes in tool results', async () => {
    const artifact = await work();
    await call('artifact_apply', { artifactId: artifact.id, operationId: randomUUID(), operations: [{ op: 'add', element: { id: 'region', type: 'html', html: '<section><h1>完整源码</h1></section>' } }] });
    const exported = await call('artifact_export', { artifactId: artifact.id, format: 'html', options: { regionId: 'region' } });
    expect(exported.value.ok).toBe(true); expect(exported.value.data.data).toBeUndefined();
    const downloadPath = exported.value.data.downloadPath;
    expect((await fetch(`${host.origin}${downloadPath}`)).status).toBe(401);
    const downloaded = await fetch(`${host.origin}${downloadPath}&token=${host.token}`);
    expect(downloaded.status).toBe(200); expect(downloaded.headers.get('content-type')).toBe('text/html; charset=utf-8'); expect(await downloaded.text()).toContain('完整源码');
    const png = await call('artifact_export', { artifactId: artifact.id, format: 'png', options: { regionId: 'region' } });
    expect(png.value.error.code).toBe('EXPORT_BROWSER_REQUIRED');
  });
  it.each([['html', 'text/html'], ['svg', 'image/svg+xml'], ['json', 'application/json']])('declares UTF-8 for Chinese %s downloads without changing canonical source', async (format, mimeType) => {
    const artifact = await work();
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><text x="10" y="30">中文图解与备注</text></svg>';
    await call('artifact_apply', { artifactId: artifact.id, operationId: randomUUID(), operations: [{ op: 'add', element: { id: 'chinese-region', type: 'html', html: source } }] });
    const exported = await call('artifact_export', { artifactId: artifact.id, format, options: { regionId: 'chinese-region' } });
    expect(exported.value.ok).toBe(true);
    const response = await fetch(`${host.origin}${exported.value.data.downloadPath}&token=${host.token}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(`${mimeType}; charset=utf-8`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const charset = /charset=([^;\s]+)/.exec(response.headers.get('content-type')!)![1];
    expect(new TextDecoder(charset, { fatal: true }).decode(bytes)).toContain('中文图解与备注');
    const original = await call('artifact_read', { artifactId: artifact.id, mode: 'source', regionId: 'chinese-region' });
    expect(original.value.data.html).toBe(source);
  });
  it.each([['png', 'image/png'], ['zip', 'application/zip']])('preserves the binary %s download media type', async (format, mimeType) => {
    const artifact = await work();
    const exported = await call('artifact_export', { artifactId: artifact.id, format });
    expect(exported.value.ok).toBe(true);
    const response = await fetch(`${host.origin}${exported.value.data.downloadPath}&token=${host.token}`);
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe(mimeType);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.from(bytes.subarray(0, format === 'png' ? 8 : 4)).toString('hex')).toBe(format === 'png' ? '89504e470d0a1a0a' : '504b0304');
  });
  it('copies uploaded resources with duplicated works', async () => {
    const artifact = await work();
    const upload = await fetch(`${host.origin}/api/assets?artifactId=${artifact.id}`, { method: 'POST', headers: { Authorization: `Bearer ${host.token}`, 'Content-Type': 'image/png' }, body: Buffer.from('89504e470d0a1a0a', 'hex') });
    const asset = await upload.json();
    await call('artifact_apply', { artifactId: artifact.id, operationId: randomUUID(), operations: [{ op: 'add', element: { id: 'picture', type: 'image', src: asset.url } }] });
    const duplicated = (await call('artifact_manage', { action: 'duplicate', artifactId: artifact.id })).value.data;
    const src = duplicated.board.elements[0].src;
    expect(src).toContain(duplicated.artifact.id); expect(src).not.toContain(artifact.id);
    expect((await fetch(`${host.origin}${src}?token=${host.token}`)).status).toBe(200);
  });
  it('does not silently resume a previous share after the owning service exits', async () => {
    const artifact = await work(), shared = await sharing(artifact.id), oldToken = shareToken(shared, 'viewer');
    await host.close();
    host = await startStudioHost({ dataRoot: directory });
    const status = await call('artifact_share', { artifactId: artifact.id, action: 'status' });
    expect(status.value.data.enabled).toBe(false);
    expect((await call('artifact_read', { artifactId: artifact.id }, oldToken)).response.status).toBe(401);
    expect((await call('artifact_read', { artifactId: artifact.id })).value.data.artifact.id).toBe(artifact.id);
  });
});
