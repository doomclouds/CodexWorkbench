import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Zip, ZipPassThrough, strToU8, unzipSync, zipSync } from 'fflate';
import { LOCAL_ACTOR, type Actor } from '../src/contracts/studio.js';
import { StudioService } from '../src/core/service.js';
import { startStudioHost, type StudioHost } from '../src/server/http.js';

let directory: string, service: StudioService; const hosts: StudioHost[] = [];
const viewer: Actor = { id: 'guest', name: '访客', role: 'viewer', kind: 'human' };
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'studio-archive-')); service = new StudioService({ dataRoot: directory }); });
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.close())); await service.close(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory'); await rm(directory, { recursive: true, force: true }); });
async function fixture() {
  const { artifact } = await service.execute('artifact_manage', { action: 'create', title: '完整作品' });
  const asset = await service.putAsset(artifact.id, Buffer.from('89504e470d0a1a0a', 'hex'), { filename: '历史图片.png', mimeType: 'image/png' }, LOCAL_ACTOR);
  await service.execute('artifact_apply', { artifactId: artifact.id, expectedRevision: 0, operations: [{ op: 'add', element: { id: 'html', type: 'html', html: `<img src="${asset.url}"><h1>原始源码</h1>` } }, { op: 'add', element: { id: 'image', type: 'image', src: asset.url } }] });
  const { feedback } = await service.execute('artifact_feedback', { artifactId: artifact.id, action: 'create', type: 'request', text: '保留这份上下文', anchor: { regionId: 'html', sourceRevision: 1 } });
  await service.execute('artifact_apply', { artifactId: artifact.id, expectedRevision: 2, operations: [{ op: 'update', id: 'html', changes: { html: `<img src="${asset.url}"><h1>当前源码</h1>` } }] });
  await service.store.transaction(artifact.id, state => { state.sharing = { enabled: true, generation: 3, tokens: { viewer: 'private-share-secret' } }; state.feedback[0]!.status = 'processing'; state.feedback[0]!.targetViewId = 'live-tab'; });
  const exported = await service.execute('artifact_export', { artifactId: artifact.id, format: 'zip' });
  const { data } = await service.getExport(exported.exportId);
  return { artifact, asset, feedback: feedback[0], exported, data };
}

describe('portable artifact archives', () => {
  it('moves the full work to a new data root with history, feedback, sources and all assets', async () => {
    const source = await fixture(), packed = unzipSync(source.data), snapshot = JSON.parse(Buffer.from(packed['artifact.json']!).toString());
    expect(snapshot.schemaVersion).toBe(2); expect(snapshot.sharing).toEqual({ enabled: false, generation: 0, tokens: {} }); expect(snapshot.operations).toEqual([]);
    expect(Buffer.from(packed['artifact.json']!).toString()).not.toContain('private-share-secret');
    const target = new StudioService({ dataRoot: join(directory, 'another-machine') });
    try {
      const imported = await target.importArchive(source.data), id = imported.artifact.id;
      expect(id).not.toBe(source.artifact.id); expect(imported.artifact).toMatchObject({ title: '完整作品', revision: 3, importedFrom: { artifactId: source.artifact.id } });
      const saved = await target.store.read(id), previous = await service.store.read(source.artifact.id);
      expect(saved.history).toHaveLength(previous.history.length); expect(saved.history.map(version => version.entry)).toEqual(previous.history.map(version => version.entry));
      expect(saved.history.every(version => version.artifact.id === id)).toBe(true);
      expect(saved.feedback[0]).toMatchObject({ artifactId: id, text: '保留这份上下文', status: 'pending' }); expect(saved.feedback[0]).not.toHaveProperty('targetViewId');
      const frozen = await target.execute('artifact_read', { artifactId: id, mode: 'source', feedbackId: source.feedback.id });
      expect(frozen).toMatchObject({ artifactId: id, html: `<img src="/assets/${id}/${source.asset.id}"><h1>原始源码</h1>` });
      const old = await target.execute('artifact_read', { artifactId: id, mode: 'version', revision: 1 });
      expect(old.board.elements[1].src).toBe(`/assets/${id}/${source.asset.id}`);
      expect(Buffer.from((await target.getAsset(id, source.asset.id)).data)).toEqual(Buffer.from('89504e470d0a1a0a', 'hex'));
      expect((await service.store.read(source.artifact.id)).sharing.tokens.viewer).toBe('private-share-secret');
      await target.execute('artifact_apply', { artifactId: id, expectedRevision: 3, operations: [{ op: 'restore', versionId: saved.history[1]!.entry.id }] });
      expect((await target.execute('artifact_read', { artifactId: id })).elements[0].html).toContain('原始源码');
    } finally { await target.close(); }
  });

  it('imports explicit file paths and rejects incomplete or unregistered content without publishing a partial work', async () => {
    const source = await fixture(), path = join(directory, 'selected.studio.zip'); await writeFile(path, source.data);
    const imported = await service.execute('artifact_manage', { action: 'import', archivePath: path, title: '导入副本' });
    expect(imported.artifact.title).toBe('导入副本');
    const internal = await service.execute('artifact_manage', { action: 'import', archiveBase64: Buffer.from(source.data).toString('base64') }); expect(internal.artifact.id).not.toBe(imported.artifact.id);
    const before = (await service.execute('artifact_list')).artifacts.map((item: { id: string }) => item.id);
    const entries = unzipSync(source.data); delete entries[`assets/${source.asset.id}`];
    await expect(service.importArchive(zipSync(entries))).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' });
    const snapshot = JSON.parse(Buffer.from(entries['artifact.json']!).toString()); snapshot.artifact.type = 'missing-product'; entries['artifact.json'] = strToU8(JSON.stringify(snapshot));
    await expect(service.importArchive(zipSync(entries))).rejects.toMatchObject({ code: 'UNSUPPORTED_PRODUCT' });
    expect((await service.execute('artifact_list')).artifacts.map((item: { id: string }) => item.id)).toEqual(before);
    expect(await readdir(join(directory, 'staging'))).toEqual([]);
    expect(await readFile(service.store.file(source.artifact.id), 'utf8')).toContain('private-share-secret');
  });

  it('rejects traversal, duplicate paths and expansion bombs before writing', async () => {
    const source = await fixture(), entries = unzipSync(source.data);
    await expect(service.importArchive(zipSync({ ...entries, '../escape': strToU8('bad') }))).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' });
    const chunks: Uint8Array[] = [], zip = new Zip((error, chunk) => { if (error) throw error; chunks.push(chunk); });
    for (let index = 0; index < 2; index++) { const entry = new ZipPassThrough('artifact.json'); zip.add(entry); entry.push(entries['artifact.json']!, true); } zip.end();
    await expect(service.importArchive(Buffer.concat(chunks))).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' });
    // The central directory advertises a forbidden resource size even though it compresses tiny.
    await expect(service.importArchive(zipSync({ ...entries, 'assets/bomb': new Uint8Array(21 * 1024 * 1024) }))).rejects.toMatchObject({ code: 'TOO_LARGE' });
    // A forged size also cannot hide a stream's actual expanded output.
    const dishonest = Buffer.from(zipSync({ 'artifact.json': strToU8('x'.repeat(3 * 1024 * 1024)) }));
    dishonest.writeUInt32LE(1, 22); dishonest.writeUInt32LE(1, dishonest.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
    await expect(service.importArchive(dishonest)).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect((await service.execute('artifact_list')).artifacts).toHaveLength(1);
  });

  it('requires owner authority for ZIP creation, import, binary upload and archive download', async () => {
    const source = await fixture();
    await expect(service.execute('artifact_export', { artifactId: source.artifact.id, format: 'zip' }, viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.importArchive(source.data, viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const host = await startStudioHost({ dataRoot: directory }); hosts.push(host);
    const upload = await fetch(`${host.origin}/api/import`, { method: 'POST', headers: { Authorization: `Bearer ${host.token}`, 'Content-Type': 'application/zip' }, body: Buffer.from(source.data) });
    expect(upload.status).toBe(200); expect(await upload.json()).toMatchObject({ ok: true, data: { artifact: { title: '完整作品' }, board: { elements: expect.any(Array) } } });
    expect((await fetch(`${host.origin}/api/import?token=${host.token}`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: Buffer.from(source.data) })).status).toBe(401);
    const sharing = await host.service.execute('artifact_share', { artifactId: source.artifact.id, action: 'start' }), shared = new URL(sharing.links.viewer), share = shared.searchParams.get('share')!;
    expect((await fetch(`${host.origin}${source.exported.downloadPath}&token=${share}`)).status).toBe(403);
    expect((await fetch(`${host.origin}/api/import?artifactId=${source.artifact.id}`, { method: 'POST', headers: { Authorization: `Bearer ${share}`, 'Content-Type': 'application/zip' }, body: Buffer.from(source.data) })).status).toBe(403);
  });
});
