import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { LOCAL_ACTOR, type Actor, type StudioEvent } from '../src/contracts/studio.js';
import { StudioService } from '../src/core/service.js';
import { studioProducts } from '../src/core/products/index.js';
import { ProductRegistry } from '../src/core/shared/products.js';

let directory: string, service: StudioService;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'studio-trash-purge-')); service = new StudioService({ dataRoot: join(directory, 'data') }); });
afterEach(async () => {
  await service.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory');
  await rm(directory, { recursive: true, force: true });
});
const create = async (title = '永久删除测试') => (await service.execute('artifact_manage', { action: 'create', title })).artifact.id as string;
const trash = (artifactId: string) => service.execute('artifact_manage', { action: 'trash', artifactId });
const purge = (artifactId: string) => service.execute('artifact_manage', { action: 'purge', artifactId });

describe('shared artifact permanent deletion', () => {
  it('requires owner authority and refuses to delete an active artifact', async () => {
    const id = await create();
    for (const role of ['editor', 'commenter', 'viewer'] as const) {
      const actor: Actor = { ...LOCAL_ACTOR, id: role, role };
      await expect(service.execute('artifact_manage', { action: 'purge', artifactId: id }, actor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(await purge(id)).toEqual({ deletedIds: [], failures: [{ artifactId: id, code: 'NOT_TRASHED', message: expect.any(String) }] });
    expect((await service.store.read(id)).artifact.trashedAt).toBeUndefined();
  });

  it('permanently removes content, history, feedback, resources and only its own export copies', async () => {
    const id = await create(), other = await create('保留作品');
    const source = join(directory, 'source.png'), bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64');
    await writeFile(source, bytes);
    const { asset } = await service.execute('artifact_manage', { action: 'asset-import', artifactId: id, assetPath: source });
    const kept = await service.putAsset(other, bytes, { filename: 'keep.png', mimeType: 'image/png' }, LOCAL_ACTOR);
    await service.execute('artifact_feedback', { action: 'create', artifactId: id, text: '所属反馈', anchor: {} });
    const ownedExport = await service.execute('artifact_export', { artifactId: id, format: 'json' }), otherExport = await service.execute('artifact_export', { artifactId: other, format: 'json' });
    await mkdir(join(service.store.folder(id), 'recycle-assets')); await writeFile(join(service.store.folder(id), 'recycle-assets', 'recycled'), bytes);
    await trash(id);
    expect((await service.store.read(id)).history.length).toBeGreaterThan(1);
    expect(await purge(id)).toEqual({ deletedIds: [id], failures: [] });
    await expect(service.execute('artifact_read', { artifactId: id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.getAsset(id, asset.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.getExport(ownedExport.exportId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(readFile(join(service.store.folder(id), 'recycle-assets', 'recycled'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(source)).toEqual(bytes);
    expect((await service.store.read(other)).artifact.title).toBe('保留作品');
    expect(Buffer.from((await service.getAsset(other, kept.id)).data)).toEqual(bytes);
    expect((await service.getExport(otherExport.exportId)).artifactId).toBe(other);
    expect((await service.execute('artifact_list', { trashed: true })).artifacts).toEqual([]);
  });

  it('reports mixed batch results and deduplicates targets without deleting active or missing works', async () => {
    const id = await create(), second = await create(), active = await create(); await trash(id); await trash(second);
    const result = await service.execute('artifact_manage', { action: 'purge', artifactIds: [id, 'missing', active, second, id] });
    expect(result.deletedIds).toEqual([id, second]);
    expect(result.failures).toEqual([{ artifactId: 'missing', code: 'NOT_FOUND', message: expect.any(String) }, { artifactId: active, code: 'NOT_TRASHED', message: expect.any(String) }]);
    expect((await service.store.read(active)).artifact.id).toBe(active);
    expect(await purge(id)).toMatchObject({ deletedIds: [], failures: [{ artifactId: id, code: 'NOT_FOUND' }] });
  });

  it('validates the complete request before deleting its first target', async () => {
    const id = await create(); await trash(id);
    for (const args of [{}, { artifactId: id, artifactIds: [id] }, { artifactIds: [] }, { artifactIds: Array(101).fill(id) }, { artifactIds: [id, '../escape'] }, { artifactIds: [id, 2] }]) {
      await expect(service.execute('artifact_manage', { action: 'purge', ...args })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      expect((await service.store.read(id)).artifact.trashedAt).toBeTruthy();
    }
  });

  it('keeps content intact when export cleanup fails and permits a later retry', async () => {
    const id = await create(); await service.execute('artifact_export', { artifactId: id, format: 'json' }); await trash(id);
    const exports = join(service.dataRoot, 'exports'), original = join(service.dataRoot, 'exports-original');
    await rename(exports, original); await symlink(original, exports, 'junction');
    expect(await purge(id)).toMatchObject({ deletedIds: [], failures: [{ artifactId: id, code: 'RESOURCE_SCOPE' }] });
    expect((await service.store.read(id)).artifact.trashedAt).toBeTruthy();
    expect(await readdir(original)).toHaveLength(2);
    await rm(exports); await rename(original, exports);
    expect(await purge(id)).toEqual({ deletedIds: [id], failures: [] });
  });

  it('rejects redirected artifact folders or nested assets without touching the external namespace', async () => {
    const id = await create(), other = await create(); await trash(id);
    const folder = service.store.folder(id), original = `${folder}-original`;
    await rename(folder, original); await symlink(original, folder, 'junction');
    expect(await purge(id)).toMatchObject({ failures: [{ code: 'RESOURCE_SCOPE' }] });
    expect(await readFile(join(original, 'artifact.json'), 'utf8')).toContain(id);
    await rm(folder); await rename(original, folder);
    await symlink(service.store.folder(other), join(folder, 'assets'), 'junction');
    expect(await purge(id)).toMatchObject({ failures: [{ code: 'RESOURCE_SCOPE' }] });
    expect((await service.store.read(id)).artifact.id).toBe(id);
    expect((await service.store.read(other)).artifact.id).toBe(other);
  });

  it('revokes shared eligibility and clears ephemeral participants and timers after deletion', async () => {
    const id = await create(), events: StudioEvent[] = [];
    const sharing = await service.execute('artifact_share', { artifactId: id, action: 'start' });
    const token = new URL(sharing.links.viewer, 'http://localhost').searchParams.get('share')!;
    await service.updatePresence(id, { peerId: 'peer', timer: { action: 'start', durationSeconds: 60 } }, LOCAL_ACTOR);
    expect(await service.shareRole(id, token)).toBe('viewer'); await trash(id);
    const unsubscribe = service.subscribe(id, event => events.push(event));
    expect(await purge(id)).toEqual({ deletedIds: [id], failures: [] }); unsubscribe();
    expect(await service.shareRole(id, token)).toBeUndefined(); expect(service.getPresence(id)).toEqual([]); expect(service.getTimer(id)).toBeNull();
    expect(events.map(event => event.type)).toEqual(['share', 'purged']);
    await expect(service.updatePresence(id, { peerId: 'late' }, LOCAL_ACTOR)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('serializes restore and purge across service instances without resurrecting deleted content', async () => {
    const other = new StudioService({ dataRoot: service.dataRoot });
    try {
      const id = await create(); await trash(id);
      const [deleted, restored] = await Promise.allSettled([purge(id), other.execute('artifact_manage', { action: 'restore', artifactId: id })]);
      expect(deleted.status).toBe('fulfilled');
      if (deleted.status !== 'fulfilled') throw new Error('Unexpected purge rejection');
      if (deleted.value.deletedIds.length) {
        expect(restored).toMatchObject({ status: 'rejected', reason: { code: 'NOT_FOUND' } });
        await expect(service.store.read(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      } else {
        expect(restored.status).toBe('fulfilled'); expect(deleted.value.failures).toMatchObject([{ code: 'NOT_TRASHED' }]);
        expect((await service.store.read(id)).artifact.trashedAt).toBeUndefined();
      }
    } finally { await other.close(); }
  });

  it('does not save an in-flight export after its artifact is permanently deleted', async () => {
    let entered!: () => void, resume!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), paused = new Promise<void>(resolve => { resume = resolve; });
    const product = studioProducts().get('whiteboard');
    await service.close(); service = new StudioService({ dataRoot: join(directory, 'data'), products: new ProductRegistry().register({ ...product, export: async () => { entered(); await paused; return { filename: 'late.json', mimeType: 'application/json', data: '{}' }; } }) });
    const id = await create(), pending = service.execute('artifact_export', { artifactId: id, format: 'json' });
    const result = expect(pending).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await started; await trash(id); expect(await purge(id)).toEqual({ deletedIds: [id], failures: [] }); resume(); await result;
    await expect(readdir(join(service.dataRoot, 'exports'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
