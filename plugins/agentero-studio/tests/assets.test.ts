import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { LOCAL_ACTOR, type Actor, type Board, type Operation } from '../src/contracts/studio.js';
import { StudioService } from '../src/core/service.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64');
const agent: Actor = { id: 'codex', name: 'Codex', kind: 'agent', role: 'owner' };
let directory: string, service: StudioService, artifactId: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-assets-')); service = new StudioService({ dataRoot: join(directory, 'data') });
  artifactId = (await service.execute('artifact_manage', { action: 'create' })).artifact.id;
});
afterEach(async () => {
  vi.restoreAllMocks(); await service.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory');
  await rm(directory, { recursive: true, force: true });
});
async function upload(filename = 'generated.png', bytes: Buffer = png) {
  const assetPath = join(directory, filename); await writeFile(assetPath, bytes);
  return (await service.execute('artifact_manage', { action: 'asset-import', artifactId, assetPath }, agent)).asset;
}
const remove = (assetId: string) => service.execute('artifact_manage', { action: 'asset-delete', artifactId, assetId }, agent);
async function apply(operations: Operation[]) {
  const board = await service.execute('artifact_read', { artifactId }) as Board;
  return service.execute('artifact_apply', { artifactId, expectedRevision: board.artifact.revision, operations }, agent);
}

describe('model-side local asset lifecycle', () => {
  it('imports generated media as a stable reference without persisting its absolute path or bytes in tool results', async () => {
    const asset = await upload('generated.data');
    expect(asset).toEqual({ id: expect.any(String), src: `/assets/${artifactId}/${asset.id}`, url: `/assets/${artifactId}/${asset.id}`, filename: 'generated.data', mimeType: 'image/png', size: png.length });
    expect(JSON.stringify(asset)).not.toContain(directory);
    expect(await readFile(service.store.file(artifactId), 'utf8')).not.toContain(directory);
    expect(Buffer.from((await service.getAsset(artifactId, asset.id)).data)).toEqual(png);
    await apply([{ op: 'add', element: { id: 'picture', type: 'image', src: asset.src } }]);
    const exported = await service.execute('artifact_export', { artifactId, format: 'svg' });
    expect(Buffer.from((await service.getExport(exported.exportId)).data).toString()).toContain('data:image/png;base64,');
  });

  it('requires owner authority before reading local paths, listing resource metadata or deleting assets', async () => {
    const asset = await upload();
    for (const role of ['editor', 'commenter', 'viewer'] as const) {
      const visitor: Actor = { ...LOCAL_ACTOR, id: role, role };
      await expect(service.execute('artifact_manage', { action: 'asset-import', artifactId, assetPath: join(directory, 'missing.png') }, visitor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(service.execute('artifact_manage', { action: 'asset-delete', artifactId, assetId: asset.id }, visitor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(service.execute('artifact_read', { artifactId, mode: 'assets' }, visitor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(Buffer.from((await service.getAsset(artifactId, asset.id)).data)).toEqual(png);
  });

  it('rejects disguised secrets, relative paths, aliases and oversized files before registering an asset', async () => {
    await expect(upload('credentials.png', Buffer.from('{"apiKey":"private-secret"}'))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(service.execute('artifact_manage', { action: 'asset-import', artifactId, assetPath: 'generated.png' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const inputs = join(directory, 'inputs'), alias = join(directory, 'alias');
    await mkdir(inputs); await writeFile(join(inputs, 'image.png'), png); await symlink(inputs, alias, 'junction');
    await expect(service.execute('artifact_manage', { action: 'asset-import', artifactId, assetPath: join(alias, 'image.png') })).rejects.toMatchObject({ code: 'RESOURCE_SCOPE' });
    const large = join(directory, 'large.png'); await writeFile(large, png); await truncate(large, 20 * 1024 * 1024 + 1);
    await expect(service.execute('artifact_manage', { action: 'asset-import', artifactId, assetPath: large })).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect((await service.execute('artifact_read', { artifactId, mode: 'assets' })).assets).toEqual([]);
  });

  it('detects the supported media signatures and leaves final MIME acceptance to the product', async () => {
    const samples: [string, Buffer, string][] = [
      ['photo.jpg', Buffer.from('ffd8ffe00010', 'hex'), 'image/jpeg'],
      ['animation.gif', Buffer.from('GIF89a'), 'image/gif'],
      ['picture.webp', Buffer.from('RIFF0000WEBP'), 'image/webp'],
      ['video.mp4', Buffer.concat([Buffer.from('0000001866747970', 'hex'), Buffer.from('isom00000000')]), 'video/mp4'],
      ['video.mov', Buffer.concat([Buffer.from('0000001466747970', 'hex'), Buffer.from('qt  0000')]), 'video/quicktime'],
      ['video.webm', Buffer.concat([Buffer.from('1a45dfa3', 'hex'), Buffer.from('webm')]), 'video/webm'],
      ['vector.svg', Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml'],
    ];
    for (const [filename, bytes, mimeType] of samples) expect((await upload(filename, bytes)).mimeType).toBe(mimeType);
    await expect(upload('document.json', Buffer.from('{"title":"ordinary document"}'))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('pages bounded resource metadata with stable references and no file bytes', async () => {
    const assets = [await upload('one.png'), await upload('two.png'), await upload('three.png')];
    const first = await service.execute('artifact_read', { artifactId, mode: 'assets', limit: 2 });
    expect(first).toEqual({ assets: assets.slice(0, 2), total: 3, offset: 0, limit: 2, nextOffset: 2 });
    expect(await service.execute('artifact_read', { artifactId, mode: 'assets', offset: first.nextOffset, limit: 2 })).toEqual({ assets: assets.slice(2), total: 3, offset: 2, limit: 2 });
    expect((await service.execute('artifact_read', { artifactId, mode: 'assets', offset: 20 })).assets).toEqual([]);
    for (const args of [{ offset: -1 }, { offset: 0.5 }, { limit: 101 }, { limit: 0 }]) await expect(service.execute('artifact_read', { artifactId, mode: 'assets', ...args })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('preserves resources referenced by current content and retained history so restoration still works', async () => {
    const asset = await upload();
    const first = await apply([{ op: 'add', element: { id: 'picture', type: 'image', src: asset.src } }]);
    await expect(remove(asset.id)).rejects.toMatchObject({ code: 'REFERENCE_IN_USE' });
    await apply([{ op: 'delete', id: 'picture' }]);
    await expect(remove(asset.id)).rejects.toMatchObject({ code: 'REFERENCE_IN_USE' });
    await apply([{ op: 'restore', versionId: first.historyEntry.id }]);
    expect((await service.execute('artifact_read', { artifactId })).elements[0].src).toBe(asset.src);
    expect(Buffer.from((await service.getAsset(artifactId, asset.id)).data)).toEqual(png);
  });

  it('retains resources used only by frozen sources, feedback text or unapplied private proposal options', async () => {
    const asset = await upload();
    await service.store.transaction(artifactId, state => { state.sources.frozen = [{ html: `<img src="${asset.src}">` }]; });
    await expect(remove(asset.id)).rejects.toMatchObject({ code: 'REFERENCE_IN_USE' });
    await service.store.transaction(artifactId, state => { delete state.sources.frozen; });
    const ordinary = await service.execute('artifact_feedback', { action: 'create', artifactId, text: `参考 ${asset.src}`, anchor: {} });
    await expect(remove(asset.id)).rejects.toMatchObject({ code: 'REFERENCE_IN_USE' });
    await service.store.transaction(artifactId, state => { state.feedback = []; state.sources = {}; });
    expect(ordinary.feedback).toHaveLength(1);
    await service.execute('artifact_feedback', { action: 'suggest', artifactId, text: '添加备选图片', options: [
      { id: 'image', label: '图片', operations: [{ op: 'add', element: { id: 'proposed-image', type: 'image', src: asset.src } }] },
      { id: 'text', label: '文字', operations: [{ op: 'add', element: { id: 'proposed-text', type: 'text', text: '说明' } }] },
    ] }, agent);
    expect((await service.execute('artifact_read', { artifactId })).elements).toEqual([]);
    await expect(remove(asset.id)).rejects.toMatchObject({ code: 'REFERENCE_IN_USE' });
  });

  it('deletes only unreferenced resources in the requested work and preserves recoverable bytes', async () => {
    const asset = await upload(), other = (await service.execute('artifact_manage', { action: 'duplicate', artifactId })).artifact.id;
    await expect(service.execute('artifact_manage', { action: 'asset-delete', artifactId, assetId: '../escape' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(await remove(asset.id)).toEqual({ assetId: asset.id, removed: true });
    expect((await service.execute('artifact_read', { artifactId, mode: 'assets' })).total).toBe(0);
    await expect(service.getAsset(artifactId, asset.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await readFile(join(service.store.folder(artifactId), 'recycle-assets', asset.id))).toEqual(png);
    expect(Buffer.from((await service.getAsset(other, asset.id)).data)).toEqual(png);
  });

  it('recovers from metadata write failures and deletion interrupted after the file move', async () => {
    const asset = await upload(), write = vi.spyOn(service.store, 'write').mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(remove(asset.id)).rejects.toThrow('disk unavailable'); write.mockRestore();
    expect((await service.execute('artifact_read', { artifactId, mode: 'assets' })).assets[0].id).toBe(asset.id);
    expect(Buffer.from((await service.getAsset(artifactId, asset.id)).data)).toEqual(png);
    const recycled = join(service.store.folder(artifactId), 'recycle-assets'); await mkdir(recycled, { recursive: true });
    await rename(join(service.store.folder(artifactId), 'assets', asset.id), join(recycled, asset.id));
    expect(Buffer.from((await service.getAsset(artifactId, asset.id)).data)).toEqual(png);
    expect(await remove(asset.id)).toEqual({ assetId: asset.id, removed: true });
  });

  it('rejects asset directories and files redirected through links without modifying either work', async () => {
    const asset = await upload(), other = (await service.execute('artifact_manage', { action: 'duplicate', artifactId })).artifact.id;
    const assets = join(service.store.folder(artifactId), 'assets'); await rename(assets, `${assets}-original`);
    await symlink(join(service.store.folder(other), 'assets'), assets, 'junction');
    await expect(remove(asset.id)).rejects.toMatchObject({ code: 'RESOURCE_SCOPE' });
    await expect(upload('another.png')).rejects.toMatchObject({ code: 'RESOURCE_SCOPE' });
    expect((await service.execute('artifact_read', { artifactId, mode: 'assets' })).total).toBe(1);
    expect(Buffer.from((await service.getAsset(other, asset.id)).data)).toEqual(png);
  });
});
