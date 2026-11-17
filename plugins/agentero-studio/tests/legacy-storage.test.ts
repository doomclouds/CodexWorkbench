import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCAL_ACTOR, type Actor, type ToolName } from '../src/contracts/studio.js';
import { StudioService } from '../src/core/service.js';
import { listLegacyArtifacts, readLegacyArtifact } from '../src/core/shared/legacy-artifacts.js';
import { startStudioHost } from '../src/server/http.js';

const deletionFailure = vi.hoisted(() => ({ path: '' }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const remove: typeof actual.rm = async (path, options) => {
    if (String(path) === deletionFailure.path) throw Object.assign(new Error('Controlled deletion failure'), { code: 'EACCES' });
    return actual.rm(path, options);
  };
  return { ...actual, rm: remove };
});

let directory: string, service: StudioService;
const id = 'legacy-json-board';
const metadata = { id, type: 'whiteboard', title: '旧版白板', revision: 200, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-11-18T00:00:00.000Z', pinned: true };
const source = () => join(service.dataRoot, 'artifacts', id, 'artifact.json');
const digest = async () => createHash('sha256').update(await readFile(source())).digest('hex');
const unsupportedCases: [ToolName, Record<string, unknown>][] = [
  ['studio_open', {}], ['artifact_read', { mode: 'summary' }], ['artifact_apply', { operations: [] }],
  ['artifact_feedback', { action: 'list' }], ['artifact_share', { action: 'status' }],
  ['artifact_export', { format: 'json' }], ['artifact_activity', { action: 'status' }],
  ...['rename', 'pin', 'restore', 'duplicate', 'asset-import'].map(action => ['artifact_manage' as const, { action }] as [ToolName, Record<string, unknown>]),
  ['artifact_manage', { action: 'asset-delete', assetId: 'legacy-image' }],
];
beforeEach(async () => {
  deletionFailure.path = '';
  directory = await mkdtemp(join(tmpdir(), 'studio-legacy-storage-'));
  service = new StudioService({ dataRoot: directory });
  await mkdir(join(directory, 'artifacts', id), { recursive: true });
  await writeFile(source(), JSON.stringify({ schemaVersion: 2, artifact: metadata, content: { html: 'x'.repeat(2 * 1024 * 1024) }, history: [], feedback: [], operations: [], sources: {}, sharing: { enabled: true, generation: 1, tokens: { viewer: 'old-viewer' } }, assets: {} }));
});
afterEach(async () => { deletionFailure.path = ''; await service.close(); await rm(directory, { recursive: true, force: true }); });

describe('unsupported JSON artifact lifecycle', () => {
  it('lists only legacy metadata and never opens or normalizes legacy content', async () => {
    const original = await digest();
    const listed = (await service.execute('artifact_list')).artifacts;
    expect(listed).toEqual([{ ...metadata, pinned: false, sharing: false, storageStatus: 'unsupported' }]);
    expect(listed[0]).not.toHaveProperty('thumbnail');
    expect(await digest()).toBe(original);
    expect(await readdir(join(directory, 'artifacts', id))).toEqual(['artifact.json']);
  });

  it('can identify an unsupported artifact whose content is incomplete or invalid', async () => {
    await writeFile(source(), JSON.stringify({ artifact: metadata }).slice(0, -1) + ',"content":invalid trailing data');
    expect(await readLegacyArtifact(directory, id)).toMatchObject({ id, title: metadata.title, storageStatus: 'unsupported' });
    await expect(service.execute('artifact_read', { artifactId: id, mode: 'objects' })).rejects.toMatchObject({ code: 'UNSUPPORTED_STORAGE' });
  });

  it.each(unsupportedCases)('rejects the old artifact through %s %j', async (name, args) => {
    const original = await digest();
    await expect(service.execute(name, { artifactId: id, ...args })).rejects.toMatchObject({ code: 'UNSUPPORTED_STORAGE' });
    expect(await digest()).toBe(original);
    expect(await readdir(join(directory, 'artifacts', id))).toEqual(['artifact.json']);
  });

  it('trashes through an independent marker and permanently deletes only a trashed legacy directory', async () => {
    const original = await digest();
    expect(await service.execute('artifact_manage', { action: 'purge', artifactId: id })).toMatchObject({ deletedIds: [], failures: [{ code: 'NOT_TRASHED' }] });
    const trashed = await service.execute('artifact_manage', { action: 'trash', artifactId: id, expectedRevision: metadata.revision });
    expect(trashed.artifact).toMatchObject({ id, storageStatus: 'unsupported', trashedAt: expect.any(String) });
    expect(trashed).not.toHaveProperty('board');
    expect(await digest()).toBe(original);
    expect((await service.execute('artifact_list')).artifacts).toHaveLength(0);
    expect((await service.execute('artifact_list', { trashed: true })).artifacts).toMatchObject([{ id, storageStatus: 'unsupported' }]);
    await expect(service.execute('artifact_manage', { action: 'restore', artifactId: id })).rejects.toMatchObject({ code: 'UNSUPPORTED_STORAGE' });
    expect(await service.execute('artifact_manage', { action: 'purge', artifactIds: [id] })).toEqual({ deletedIds: [id], failures: [] });
    expect(await listLegacyArtifacts(directory)).toEqual([]);
    await expect(readFile(source())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('permits owner agent lifecycle calls without requiring content or a workspace lease', async () => {
    const actor: Actor = { ...LOCAL_ACTOR, id: 'owner-agent', kind: 'agent' };
    expect((await service.execute('artifact_manage', { action: 'trash', artifactId: id }, actor)).artifact.trashedAt).toBeTruthy();
    expect(await service.execute('artifact_manage', { action: 'purge', artifactId: id }, actor)).toEqual({ deletedIds: [id], failures: [] });
  });

  it.each(['artifact.json', 'unsupported-trash.json'])('keeps a failed permanent deletion visible and retryable when %s removal fails', async filename => {
    await service.execute('artifact_manage', { action: 'trash', artifactId: id });
    deletionFailure.path = join(directory, 'artifacts', id, filename);
    const failed = await service.execute('artifact_manage', { action: 'purge', artifactId: id });
    expect(failed).toMatchObject({ deletedIds: [], failures: [{ artifactId: id, code: 'PURGE_FAILED' }] });
    expect((await service.execute('artifact_list', { trashed: true })).artifacts).toMatchObject([{ id, title: metadata.title, storageStatus: 'unsupported', trashedAt: expect.any(String) }]);
    deletionFailure.path = '';
    expect(await service.execute('artifact_manage', { action: 'purge', artifactId: id })).toEqual({ deletedIds: [id], failures: [] });
    expect((await service.execute('artifact_list', { trashed: true })).artifacts).toEqual([]);
  });

  it('requires local owner authority for trash and purge', async () => {
    for (const role of ['editor', 'commenter', 'viewer'] as const) {
      const actor: Actor = { ...LOCAL_ACTOR, id: role, role };
      await expect(service.execute('artifact_manage', { action: 'trash', artifactId: id }, actor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(service.execute('artifact_manage', { action: 'purge', artifactId: id }, actor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(service.execute('artifact_manage', { action: 'trash', artifactId: id }, LOCAL_ACTOR, { owner: false, actorId: LOCAL_ACTOR.id, viaLan: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.execute('artifact_manage', { action: 'trash', artifactId: id }, LOCAL_ACTOR, { owner: true, actorId: LOCAL_ACTOR.id, viaLan: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await readLegacyArtifact(directory, id))?.trashedAt).toBeUndefined();
    expect(await service.accessMode(id, false, true)).toBe('local');
    await expect(service.accessMode(id, true)).rejects.toMatchObject({ code: 'UNSUPPORTED_STORAGE' });
  });

  it('keeps the local owner session usable while HTTP content tools explicitly reject the unsupported format', async () => {
    const host = await startStudioHost({ dataRoot: directory });
    const headers = { Authorization: `Bearer ${host.token}`, 'Content-Type': 'application/json' };
    try {
      const session = await fetch(`${host.origin}/api/session?artifactId=${id}`, { headers });
      expect(session.status).toBe(200); expect(await session.json()).toMatchObject({ owner: true, artifactId: id });
      const read = await fetch(`${host.origin}/api/tools/artifact_read`, { method: 'POST', headers, body: JSON.stringify({ artifactId: id, mode: 'document' }) });
      expect(read.status).toBe(400); expect(await read.json()).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_STORAGE' } });
      const trashed = await fetch(`${host.origin}/api/tools/artifact_manage`, { method: 'POST', headers, body: JSON.stringify({ action: 'trash', artifactId: id }) });
      expect(trashed.status).toBe(200); expect(await trashed.json()).toMatchObject({ ok: true, data: { artifact: { id, storageStatus: 'unsupported', trashedAt: expect.any(String) } } });
    } finally { await host.close(); }
  });
});
