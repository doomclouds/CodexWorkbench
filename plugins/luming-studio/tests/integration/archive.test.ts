import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdtemp, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { Zip, ZipPassThrough, strToU8, unzipSync, zipSync } from 'fflate';
import { LOCAL_ACTOR, type Actor, type Board } from '../../src/contracts/studio.js';
import {
  createStudioService,
  type ComposedStudioService,
} from '../../src/server/studio-composition.js';
import { startStudioHost, type StudioHost } from '../../src/server/http.js';
import { captureArchive } from '../../src/core/shared/archive.js';
import { FileArchiveStorage } from '../../src/infrastructure/archive-storage.js';
import { FileAssetStore } from '../../src/infrastructure/asset-file-store.js';
import { SqliteArtifactRepository } from '../../src/infrastructure/sqlite-artifact.js';
import {
  archiveState,
  compactArchiveEntries,
  legacyArchiveEntries,
  replaceArchiveState,
} from '../support/archive-state.js';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();

  return { ...actual, rename: vi.fn(actual.rename) };
});
const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

let directory: string;
let service: ComposedStudioService;
const hosts: StudioHost[] = [];
const viewer: Actor = { id: 'guest', name: '访客', role: 'viewer', kind: 'human' };
const deltaState = 'artifact-deltas.ndjson';

async function stagingEntries(root: string): Promise<string[]> {
  try {
    return await readdir(join(root, 'staging'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

beforeEach(async () => {
  vi.mocked(rename).mockReset().mockImplementation(actualFs.rename);
  directory = await mkdtemp(join(tmpdir(), 'studio-archive-'));
  service = createStudioService({ dataRoot: directory });
});
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await service.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) {
    throw new Error('Unexpected test directory');
  }

  await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const { artifact } = await service.execute('artifact_manage', {
    action: 'create',
    title: '完整作品',
  });
  const asset = await service.putAsset(
    artifact.id,
    Buffer.from('89504e470d0a1a0a', 'hex'),
    { filename: '历史图片.png', mimeType: 'image/png' },
    LOCAL_ACTOR,
  );
  await service.execute('artifact_apply', {
    artifactId: artifact.id,
    expectedRevision: 0,
    operations: [
      {
        op: 'add',
        element: { id: 'html', type: 'html', html: `<img src="${asset.url}"><h1>原始源码</h1>` },
      },
      { op: 'add', element: { id: 'image', type: 'image', src: asset.url } },
    ],
  });
  const { feedback } = await service.execute('artifact_feedback', {
    artifactId: artifact.id,
    action: 'create',
    type: 'request',
    text: '保留这份上下文',
    anchor: { regionId: 'html', sourceRevision: 1 },
  });
  await service.execute('artifact_apply', {
    artifactId: artifact.id,
    expectedRevision: 2,
    operations: [
      { op: 'update', id: 'html', changes: { html: `<img src="${asset.url}"><h1>当前源码</h1>` } },
    ],
  });
  await service.store.transaction(artifact.id, (state) => {
    state.sharing = { enabled: true, generation: 3, tokens: { viewer: 'private-share-secret' } };
    state.feedback[0]!.status = 'processing';
    state.feedback[0]!.targetViewId = 'live-tab';
  });
  const exported = await service.execute('artifact_export', {
    artifactId: artifact.id,
    format: 'zip',
  });
  const { data } = await service.getExport(exported.exportId);

  return { artifact, asset, feedback: feedback[0], exported, data };
}

describe('portable artifact archives', () => {
  it.each([
    { coordinateSpace: 'board', x: 10_000_001, y: 4 },
    { coordinateSpace: 'document', x: 0.2, y: 0.3 },
  ])('rejects an invalid imported feedback pin before publishing (%j)', async (pin) => {
    const source = await fixture();
    const entries = unzipSync(source.data);
    const state = await archiveState(entries, directory);
    (state.feedback[0]!.anchor as Record<string, unknown>).pin = pin;
    await replaceArchiveState(entries, state, directory);
    await expect(service.importArchive(zipSync(entries))).rejects.toMatchObject({
      code: 'INVALID_ARCHIVE',
    });
    expect((await service.execute('artifact_list')).artifacts).toHaveLength(1);
    expect(await stagingEntries(directory)).toEqual([]);
  });
  it('rejects legacy JSON backups without publishing or modifying any artifact', async () => {
    const source = await fixture();
    const id = source.artifact.id;
    const file = service.store.file(id);
    await service.store.withSnapshotLock(id, async (state) => {
      const previous = await readFile(file);
      const legacy = zipSync({ 'artifact.json': strToU8(JSON.stringify(state)) });
      await expect(service.importArchive(legacy)).rejects.toMatchObject({
        code: 'UNSUPPORTED_STORAGE',
      });
      expect(await readFile(file)).toEqual(previous);
    });
    expect((await service.execute('artifact_list')).artifacts).toHaveLength(1);
  });

  it('rejects unknown archive versions, conflicting entries and mismatched identities', async () => {
    const source = await fixture();
    const files = unzipSync(source.data);
    const metadata = JSON.parse(Buffer.from(files['manifest.json']!).toString());
    const legacy = await legacyArchiveEntries(
      files,
      await archiveState(files, directory),
      directory,
    );
    await expect(
      service.importArchive(
        zipSync({
          ...files,
          'manifest.json': strToU8(JSON.stringify({ ...metadata, version: 99 })),
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_STORAGE' });
    const invalidEntries = [
      { ...legacy, 'artifact.sqlite': strToU8('invalid database') },
      { ...files, [deltaState]: strToU8('invalid JSON') },
      { ...files, 'artifact.sqlite': legacy['artifact.sqlite']! },
      { ...legacy, 'manifest.json': files['manifest.json']! },
      { ...files, 'manifest.json': legacy['manifest.json']! },
      {
        ...files,
        'manifest.json': strToU8(JSON.stringify({ ...metadata, artifactId: 'other-board' })),
      },
      {
        ...files,
        'manifest.json': strToU8(JSON.stringify({ ...metadata, database: 'artifact.sqlite' })),
      },
    ];

    for (const entries of invalidEntries) {
      await expect(service.importArchive(zipSync(entries))).rejects.toMatchObject({
        code: 'INVALID_ARCHIVE',
      });
    }

    expect((await service.execute('artifact_list')).artifacts).toHaveLength(1);
    expect(await stagingEntries(directory)).toEqual([]);
  });

  it.each(['v2', 'v3'])(
    'imports a %s archive and re-exports its full history in v4',
    async (version) => {
      const source = await fixture();
      const files = unzipSync(source.data);
      const state = await archiveState(files, directory);
      const legacy =
        version === 'v2'
          ? await legacyArchiveEntries(files, state, directory)
          : compactArchiveEntries(files, state);
      const imported = await service.importArchive(zipSync(legacy));
      const id = imported.artifact.id;
      expect(id).not.toBe(source.artifact.id);
      expect(imported.artifact.importedFrom?.artifactId).toBe(source.artifact.id);
      expect(imported.artifact.revision).toBe(state.artifact.revision);
      expect(Buffer.from((await service.getAsset(id, source.asset.id)).data)).toEqual(
        Buffer.from(files[`assets/${source.asset.id}`]!),
      );

      const exported = await service.execute('artifact_export', { artifactId: id, format: 'zip' });
      const compact = unzipSync((await service.getExport(exported.exportId)).data);
      expect(compact[deltaState]).toBeDefined();
      expect(compact['artifact.sqlite']).toBeUndefined();
      const snapshot = await archiveState(compact, directory);
      expect(snapshot.history.map((version) => version.entry)).toEqual(
        state.history.map((version) => version.entry),
      );
      expect(snapshot.feedback).toHaveLength(state.feedback.length);
      expect(Object.keys(snapshot.sources)).toEqual(Object.keys(state.sources));
      expect(await stagingEntries(directory)).toEqual([]);
    },
  );

  it('retains all 200 distinct v4 histories while keeping the legacy expansion budget', async () => {
    const source = await fixture();
    const files = unzipSync(source.data);
    const state = await archiveState(files, directory);
    const board = state.content as Board;
    const [region, ...otherElements] = board.elements;
    const html = '<p>' + 'bounded history '.repeat(27_000) + '</p>';
    const base = state.history[0]!;
    state.history = Array.from({ length: 200 }, (_, revision) => ({
      entry: { ...base.entry, id: `expanded-${revision}`, revision },
      artifact: { ...state.artifact, revision },
      content: { ...board, elements: [{ ...region!, html, y: revision }, ...otherElements] },
    }));
    const latest = state.history.at(-1)!;
    state.artifact.revision = latest.entry.revision;
    state.content = latest.content;
    const legacy = await legacyArchiveEntries(files, state, directory);
    expect(legacy['artifact.sqlite']!.length).toBeLessThan(2 * 1024 * 1024);
    await expect(service.importArchive(zipSync(legacy))).rejects.toMatchObject({
      code: 'TOO_LARGE',
      message: '作品展开内容超过导入容量。',
    });
    expect((await service.execute('artifact_list')).artifacts).toHaveLength(1);

    const storage = new FileArchiveStorage(service.store, new FileAssetStore(service.store));
    const captured = await captureArchive(storage, state, LOCAL_ACTOR);
    const result = await storage.writeSnapshot(captured);
    let imported;
    try {
      imported = await service.importArchive(result.chunks());
    } finally {
      await result.dispose();
    }
    const id = imported.artifact.id;
    expect(id).not.toBe(state.artifact.id);
    const restored = await service.store.readProjection(id, (saved) => {
      const history = saved.history.map(({ entry, content }) => ({
        revision: entry.revision,
        position: (content as Board).elements[0]!.y,
      }));

      return { history, content: saved.content as Board };
    });
    expect(restored.history).toEqual(
      state.history.map(({ entry }) => ({ revision: entry.revision, position: entry.revision })),
    );
    expect(restored.content.elements[0]!.html).toBe(html);
    expect(Buffer.from((await service.getAsset(id, source.asset.id)).data)).toEqual(
      Buffer.from(files[`assets/${source.asset.id}`]!),
    );
    expect(await stagingEntries(directory)).toEqual([]);
  });

  it('holds the work lock for capture and encodes the captured version after concurrent writes', async () => {
    const source = await fixture();
    const id = source.artifact.id;
    const media = Buffer.from('89504e470d0a1a0a', 'hex');
    const unreferenced = await service.putAsset(
      id,
      media,
      { filename: 'unreferenced.png', mimeType: 'image/png' },
      LOCAL_ACTOR,
    );
    const before = await service.store.read(id);
    const encodingStarted = deferred();
    const resumeEncoding = deferred();
    const capture = FileArchiveStorage.prototype.captureSnapshot;
    const encode = FileArchiveStorage.prototype.writeSnapshot;
    const lockedCapture = vi
      .spyOn(FileArchiveStorage.prototype, 'captureSnapshot')
      .mockImplementationOnce(async function (this: FileArchiveStorage, state) {
        expect((await lstat(join(service.store.folder(id), 'write.lock'))).isDirectory()).toBe(
          true,
        );

        return await capture.call(this, state);
      });
    const pausedEncoding = vi
      .spyOn(FileArchiveStorage.prototype, 'writeSnapshot')
      .mockImplementationOnce(async function (this: FileArchiveStorage, snapshot) {
        encodingStarted.resolve();
        await resumeEncoding.promise;

        return await encode.call(this, snapshot);
      });
    const other = createStudioService({ dataRoot: directory });
    const pending = service.execute('artifact_export', { artifactId: id, format: 'zip' });
    try {
      await Promise.race([
        encodingStarted.promise,
        pending.then(() => {
          throw new Error('Expected the archive to pause before encoding');
        }),
      ]);
      await other.execute('artifact_apply', {
        artifactId: id,
        expectedRevision: before.artifact.revision,
        operations: [{ op: 'update', id: 'html', changes: { html: '<h1>新写入</h1>' } }],
      });
      await other.execute('artifact_manage', {
        action: 'asset-delete',
        artifactId: id,
        assetId: unreferenced.id,
      });
      const assetPath = join(directory, 'concurrent-import.png');
      await writeFile(assetPath, media);
      const { asset: importedAsset } = await other.execute('artifact_manage', {
        action: 'asset-import',
        artifactId: id,
        assetPath,
      });
      resumeEncoding.resolve();
      const exported = await pending;
      const { data } = await service.getExport(exported.exportId);
      const files = unzipSync(data);
      const snapshot = await archiveState(files, directory);
      expect(snapshot.artifact.revision).toBe(before.artifact.revision);
      expect(snapshot.content).toEqual(before.content);
      expect(snapshot.history.map((version) => version.content)).toEqual(
        before.history.map((version) => version.content),
      );
      expect(snapshot.sources).toEqual(before.sources);
      expect(Buffer.from(files[`assets/${source.asset.id}`]!)).toEqual(media);
      expect(Buffer.from(files[`assets/${unreferenced.id}`]!)).toEqual(media);
      expect(files).not.toHaveProperty(`assets/${importedAsset.id}`);
      const current = await other.store.read(id);
      expect(current.artifact.revision).toBeGreaterThan(snapshot.artifact.revision);
      expect(current.assets).not.toHaveProperty(unreferenced.id);
      expect(current.assets).toHaveProperty(importedAsset.id);
      const restored = await other.importArchive(data);
      expect(restored.artifact.id).not.toBe(id);
      expect(
        Buffer.from((await other.getAsset(restored.artifact.id, unreferenced.id)).data),
      ).toEqual(media);
    } finally {
      resumeEncoding.resolve();
      await Promise.allSettled([pending]);
      lockedCapture.mockRestore();
      pausedEncoding.mockRestore();
      await other.close();
    }
  });

  it('backs up catalog bytes recovered after interruption between recycling and metadata commit', async () => {
    const { artifact } = await service.execute('artifact_manage', { action: 'create' });
    const media = Buffer.from('89504e470d0a1a0a', 'hex');
    const asset = await service.putAsset(
      artifact.id,
      media,
      { filename: 'recovered.png', mimeType: 'image/png' },
      LOCAL_ACTOR,
    );
    await new FileAssetStore(service.store).recycle(artifact.id, asset.id);
    await service.close();
    service = createStudioService({ dataRoot: directory });

    const exported = await service.execute('artifact_export', {
      artifactId: artifact.id,
      format: 'zip',
    });
    const { data } = await service.getExport(exported.exportId);
    const files = unzipSync(data);
    const snapshot = await archiveState(files, directory);
    expect(snapshot.assets).toHaveProperty(asset.id);
    expect(Buffer.from(files[`assets/${asset.id}`]!)).toEqual(media);
    const restored = await service.importArchive(data);
    expect(Buffer.from((await service.getAsset(restored.artifact.id, asset.id)).data)).toEqual(
      media,
    );
  });

  it('publishes no backup when a captured asset is missing and releases the work lock', async () => {
    const source = await fixture();
    const id = source.artifact.id;
    const path = join(service.store.folder(id), 'assets', source.asset.id);
    const bytes = await readFile(path);
    const before = await readdir(join(directory, 'exports'));
    await unlink(path);
    try {
      await expect(
        service.execute('artifact_export', { artifactId: id, format: 'zip' }),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readdir(join(directory, 'exports'))).toEqual(before);
    } finally {
      await writeFile(path, bytes);
    }

    const exported = await service.execute('artifact_export', { artifactId: id, format: 'zip' });
    const { data } = await service.getExport(exported.exportId);
    expect(Buffer.from(unzipSync(data)[`assets/${source.asset.id}`]!)).toEqual(bytes);
  });

  it.runIf(process.platform === 'win32')(
    'retries only a temporarily blocked Windows import publication and retains complete assets',
    async () => {
      const source = await fixture();
      const sourceId = source.artifact.id;
      const sourceFile = service.store.file(sourceId);
      const accepted = await service.store.withSnapshotLock(sourceId, async () => {
        const original = await readFile(sourceFile);
        const imported = await service.importArchive(source.data);
        expect(await readFile(sourceFile)).toEqual(original);

        return imported;
      });
      const acceptedId = accepted.artifact.id;
      const acceptedFile = service.store.file(acceptedId);
      const before = (await readdir(join(directory, 'artifacts'))).sort();
      const attempts: { from: string; to: string }[] = [];
      vi.mocked(rename).mockImplementation(async (from, to) => {
        if (basename(String(from)).startsWith('import-')) {
          attempts.push({ from: String(from), to: String(to) });
          expect((await readdir(join(directory, 'artifacts'))).sort()).toEqual(before);
          if (attempts.length <= 3) {
            throw Object.assign(new Error('Synthetic Windows publish sharing violation'), {
              code: ['EPERM', 'EBUSY', 'EACCES'][attempts.length - 1],
            });
          }
        }

        return actualFs.rename(from, to);
      });
      const [firstId, secondId] = [sourceId, acceptedId].sort();
      const imported = await service.store.withSnapshotLock(firstId!, () =>
        service.store.withSnapshotLock(secondId!, async () => {
          const original = await readFile(sourceFile);
          const acceptedContent = await readFile(acceptedFile);
          const imported = await service.importArchive(source.data);
          expect(await readFile(sourceFile)).toEqual(original);
          expect(await readFile(acceptedFile)).toEqual(acceptedContent);

          return imported;
        }),
      );
      const id = imported.artifact.id;
      expect(attempts).toHaveLength(4);
      expect(new Set(attempts.map((value) => value.from)).size).toBe(1);
      expect(new Set(attempts.map((value) => value.to)).size).toBe(1);
      expect(id).not.toBe(source.artifact.id);
      expect((await service.execute('artifact_read', { artifactId: id })).elements[1].src).toBe(
        `/assets/${id}/${source.asset.id}`,
      );
      expect(Buffer.from((await service.getAsset(id, source.asset.id)).data)).toEqual(
        Buffer.from('89504e470d0a1a0a', 'hex'),
      );
      expect(await readdir(join(directory, 'staging'))).toEqual([]);
    },
  );

  it.runIf(process.platform === 'win32')(
    'reports a persistent Windows publish failure and removes staging without changing existing work',
    async () => {
      const source = await fixture();
      const sourceId = source.artifact.id;
      const sourceFile = service.store.file(sourceId);
      const accepted = await service.store.withSnapshotLock(sourceId, async () => {
        const original = await readFile(sourceFile);
        const imported = await service.importArchive(source.data);
        expect(await readFile(sourceFile)).toEqual(original);

        return imported;
      });
      const acceptedId = accepted.artifact.id;
      const acceptedFile = service.store.file(acceptedId);
      const before = (await readdir(join(directory, 'artifacts'))).sort();
      const error = Object.assign(new Error('Persistent Windows publication lock'), {
        code: 'EPERM',
      });
      let attempts = 0;
      vi.mocked(rename).mockImplementation(async (from, to) => {
        if (basename(String(from)).startsWith('import-')) {
          attempts++;
          throw error;
        }

        return actualFs.rename(from, to);
      });
      const [firstId, secondId] = [sourceId, acceptedId].sort();
      await service.store.withSnapshotLock(firstId!, () =>
        service.store.withSnapshotLock(secondId!, async () => {
          const original = await readFile(sourceFile);
          const acceptedContent = await readFile(acceptedFile);
          await expect(service.importArchive(source.data)).rejects.toBe(error);
          expect(await readFile(sourceFile)).toEqual(original);
          expect(await readFile(acceptedFile)).toEqual(acceptedContent);
        }),
      );
      expect(attempts).toBe(6);
      expect((await readdir(join(directory, 'artifacts'))).sort()).toEqual(before);
      expect(await readdir(join(directory, 'staging'))).toEqual([]);
      expect(
        Buffer.from((await service.getAsset(source.artifact.id, source.asset.id)).data),
      ).toEqual(Buffer.from('89504e470d0a1a0a', 'hex'));
    },
  );

  it('does not retry import publication on another platform', async () => {
    const source = await fixture();
    const error = Object.assign(new Error('Non-Windows publication denied'), { code: 'EACCES' });
    let attempts = 0;
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (basename(String(from)).startsWith('import-')) {
        attempts++;
        throw error;
      }

      return actualFs.rename(from, to);
    });
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    try {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      await expect(service.importArchive(source.data)).rejects.toBe(error);
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }

    expect(attempts).toBe(1);
    expect(await readdir(join(directory, 'staging'))).toEqual([]);
  });

  it('cleans the staged assets and database after the SQLite import write fails', async () => {
    const source = await fixture();
    const id = source.artifact.id;
    const file = service.store.file(id);
    const error = new Error('Synthetic SQLite import write failure');
    await service.store.withSnapshotLock(id, async () => {
      const original = await readFile(file);
      const write = vi.spyOn(SqliteArtifactRepository.prototype, 'writeImportedState');
      write.mockImplementationOnce(() => {
        throw error;
      });

      try {
        await expect(service.importArchive(source.data)).rejects.toBe(error);
      } finally {
        write.mockRestore();
      }

      expect(await readFile(file)).toEqual(original);
    });

    expect(await stagingEntries(directory)).toEqual([]);
    expect((await service.execute('artifact_list')).artifacts).toHaveLength(1);
    const imported = await service.importArchive(source.data);
    expect(imported.artifact.id).not.toBe(source.artifact.id);
  });

  it('retains attachment receipts across export and import and rejects malformed ones before publishing', async () => {
    const { artifact } = await service.execute('artifact_manage', {
      action: 'create',
      title: '附加回执备份',
    });
    const created = await service.execute('artifact_feedback', {
      artifactId: artifact.id,
      action: 'create',
      text: '需要保存的讨论',
    });
    const requested = await service.execute('artifact_feedback', {
      artifactId: artifact.id,
      feedbackId: created.contextId,
      action: 'send',
    });
    const requestId = requested.feedback[0].attachment.requestId;
    const attached = await service.execute('artifact_feedback', {
      artifactId: artifact.id,
      feedbackId: created.contextId,
      action: 'attached',
      requestId,
    });
    const exported = await service.execute('artifact_export', {
      artifactId: artifact.id,
      format: 'zip',
    });
    const { data } = await service.getExport(exported.exportId);
    const imported = await service.importArchive(data);
    expect((await service.store.read(imported.artifact.id)).feedback[0]!.attachment).toEqual(
      attached.feedback[0].attachment,
    );
    const originalEntries = unzipSync(data);
    const before = (await service.execute('artifact_list')).artifacts.map(
      (item: { id: string }) => item.id,
    );

    for (const changed of [
      { state: 'broken' },
      { contentKey: '<not-a-content-key>' },
      { attachedAt: undefined },
      { attachedBy: { ...LOCAL_ACTOR, kind: 'agent' } },
      { requestedBy: null },
    ]) {
      const entries = { ...originalEntries };
      const snapshot = await archiveState(entries, directory);
      Object.assign(snapshot.feedback[0]!.attachment!, changed);
      await replaceArchiveState(entries, snapshot, directory);
      await expect(service.importArchive(zipSync(entries))).rejects.toMatchObject({
        code: 'INVALID_ARCHIVE',
      });
    }

    expect(
      (await service.execute('artifact_list')).artifacts.map((item: { id: string }) => item.id),
    ).toEqual(before);
  });

  it('retains the document clock but drops foreign child identity evidence on import', async () => {
    const { artifact } = await service.execute('artifact_manage', { action: 'create' });
    await service.execute('artifact_apply', {
      artifactId: artifact.id,
      operations: [
        {
          op: 'add',
          element: {
            id: 'doc',
            type: 'document',
            document: {
              schemaVersion: 1,
              blocks: [
                {
                  id: 'local-block',
                  type: 'paragraph',
                  props: {},
                  content: [{ type: 'text', text: '归档正文', styles: {} }],
                  children: [],
                },
              ],
            },
          },
        },
      ],
    });
    await service.execute('artifact_apply', {
      artifactId: artifact.id,
      expectedVersions: { doc: 1 },
      operations: [
        {
          op: 'document',
          id: 'doc',
          data: {
            operations: [
              {
                op: 'insert',
                afterId: 'local-block',
                block: {
                  id: 'late-block',
                  type: 'paragraph',
                  props: {},
                  content: [{ type: 'text', text: '后续正文', styles: {} }],
                  children: [],
                },
              },
            ],
          },
        },
      ],
    });
    await service.store.transaction(artifact.id, (state) => {
      const clock = state.unitClocks?.doc;
      if (!clock) {
        throw new Error('Expected a saved document clock');
      }

      clock.children = {
        sinceVersion: 1,
        throughVersion: clock.version,
        inserted: { 'late-block': clock.version },
      };
    });
    const before = await service.store.read(artifact.id);
    const docClock = before.unitClocks!.doc!;
    const { children, ...restoredClock } = docClock;
    expect(children).toBeDefined();
    const exported = await service.execute('artifact_export', {
      artifactId: artifact.id,
      format: 'zip',
    });
    const { data } = await service.getExport(exported.exportId);
    const snapshot = await archiveState(unzipSync(data), directory);
    expect(snapshot.unitClocks?.doc).toEqual(docClock);

    const imported = await service.importArchive(data);
    const restored = await service.store.read(imported.artifact.id);
    expect(imported.artifact.id).not.toBe(artifact.id);
    expect(restored.content).toEqual(before.content);
    expect(restored.unitClocks?.doc).toEqual(restoredClock);
    expect((await service.store.read(artifact.id)).unitClocks?.doc).toEqual(docClock);
  });

  it('preserves deleted object version clocks through archive and history retention', async () => {
    const { artifact } = await service.execute('artifact_manage', {
      action: 'create',
      title: 'Version clocks',
    });
    await service.execute('artifact_apply', {
      artifactId: artifact.id,
      operations: [{ op: 'add', element: { id: 'reused', type: 'note', text: 'Old generation' } }],
    });
    await service.execute('artifact_apply', {
      artifactId: artifact.id,
      expectedVersions: { reused: 1 },
      operations: [{ op: 'delete', id: 'reused' }],
    });
    await service.store.transaction(artifact.id, (state) => {
      state.history = state.history.slice(-1);
      state.operations = [];
    });
    const exported = await service.execute('artifact_export', {
      artifactId: artifact.id,
      format: 'zip',
    });
    const { data } = await service.getExport(exported.exportId);
    const target = createStudioService({ dataRoot: join(directory, 'clock-import') });
    try {
      const imported = await target.importArchive(data);
      const id = imported.artifact.id;
      expect((await target.store.read(id)).unitClocks?.reused).toMatchObject({ version: 1 });
      const result = await target.execute('artifact_apply', {
        artifactId: id,
        operations: [
          { op: 'add', element: { id: 'reused', type: 'note', text: 'New generation' } },
        ],
      });
      expect(result.board.elements[0].version).toBeGreaterThan(1);
      await expect(
        target.execute('artifact_apply', {
          artifactId: id,
          expectedVersions: { reused: 1 },
          merge: 'safe',
          operations: [{ op: 'update', id: 'reused', changes: { text: 'Stale generation' } }],
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    } finally {
      await target.close();
    }
  });

  it('rejects malformed imported clocks before publishing a work', async () => {
    const source = await fixture();
    const entries = unzipSync(source.data);
    const snapshot = await archiveState(entries, directory);
    snapshot.unitClocks = { reused: { version: 1, incarnationStart: 2 } };
    await replaceArchiveState(entries, snapshot, directory);
    const before = (await service.execute('artifact_list', {})).artifacts.length;
    await expect(service.importArchive(zipSync(entries))).rejects.toMatchObject({
      code: 'INVALID_ARCHIVE',
    });
    expect((await service.execute('artifact_list', {})).artifacts).toHaveLength(before);
  });

  it('moves the full work to a new data root with history, feedback, sources and all assets', async () => {
    const source = await fixture();
    const packed = unzipSync(source.data);
    const snapshot = await archiveState(packed, directory);
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.sharing).toEqual({ enabled: false, generation: 0, tokens: {} });
    expect(snapshot.operations).toEqual([]);
    expect(packed).not.toHaveProperty('artifact.json');
    expect(JSON.parse(Buffer.from(packed['manifest.json']!).toString())).toMatchObject({
      format: 'luming-studio-archive',
      version: 4,
      state: deltaState,
    });
    expect(packed['artifact.sqlite']).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain('private-share-secret');
    expect(Buffer.from(packed[deltaState]!).includes(Buffer.from('private-share-secret'))).toBe(
      false,
    );
    const target = createStudioService({ dataRoot: join(directory, 'another-machine') });
    try {
      const imported = await target.importArchive(source.data);
      const id = imported.artifact.id;
      expect(id).not.toBe(source.artifact.id);
      expect(imported.artifact).toMatchObject({
        title: '完整作品',
        revision: 3,
        importedFrom: { artifactId: source.artifact.id },
      });
      const saved = await target.store.read(id);
      const previous = await service.store.read(source.artifact.id);
      expect(saved.history).toHaveLength(previous.history.length);
      expect(saved.history.map((version) => version.entry)).toEqual(
        previous.history.map((version) => version.entry),
      );
      expect(saved.history.every((version) => version.artifact.id === id)).toBe(true);
      expect(saved.feedback[0]).toMatchObject({
        artifactId: id,
        text: '保留这份上下文',
        status: 'pending',
      });
      expect(saved.feedback[0]).not.toHaveProperty('targetViewId');
      const frozen = await target.execute('artifact_read', {
        artifactId: id,
        mode: 'source',
        feedbackId: source.feedback.id,
      });
      expect(frozen).toMatchObject({
        artifactId: id,
        html: `<img src="/assets/${id}/${source.asset.id}"><h1>原始源码</h1>`,
      });
      const old = await target.execute('artifact_read', {
        artifactId: id,
        mode: 'version',
        revision: 1,
      });
      expect(old.board.elements[1].src).toBe(`/assets/${id}/${source.asset.id}`);
      expect(Buffer.from((await target.getAsset(id, source.asset.id)).data)).toEqual(
        Buffer.from('89504e470d0a1a0a', 'hex'),
      );
      expect((await service.store.read(source.artifact.id)).sharing.tokens.viewer).toBe(
        'private-share-secret',
      );
      await target.execute('artifact_apply', {
        artifactId: id,
        expectedRevision: 3,
        operations: [{ op: 'restore', versionId: saved.history[1]!.entry.id }],
      });
      expect(
        (await target.execute('artifact_read', { artifactId: id })).elements[0].html,
      ).toContain('原始源码');
    } finally {
      await target.close();
    }
  });

  it('reopens a copied database and assets after its original data root is removed', async () => {
    const source = await fixture();
    const transfer = join(directory, 'transfer');
    const relocated = join(directory, 'relocated');
    const target = createStudioService({ dataRoot: transfer });
    const imported = await target.importArchive(source.data);
    await target.close();
    await actualFs.rename(transfer, relocated);
    const reopened = createStudioService({ dataRoot: relocated });
    try {
      const current = await reopened.execute('artifact_read', { artifactId: imported.artifact.id });
      expect(current.elements[0].html).toContain('当前源码');
      const frozen = await reopened.execute('artifact_read', {
        artifactId: imported.artifact.id,
        mode: 'source',
        feedbackId: source.feedback.id,
      });
      expect(frozen.html).toContain('原始源码');
      expect(
        Buffer.from((await reopened.getAsset(imported.artifact.id, source.asset.id)).data),
      ).toEqual(Buffer.from('89504e470d0a1a0a', 'hex'));
      expect((await reopened.store.read(imported.artifact.id)).sharing).toEqual({
        enabled: false,
        generation: 0,
        tokens: {},
      });
    } finally {
      await reopened.close();
    }
  });

  it('imports into a deep Unicode data root without nesting an additional artifact store inside staging', async () => {
    const source = await fixture();
    let targetRoot = join(directory, 'portable 中文');
    while (targetRoot.length < 132) {
      targetRoot = join(targetRoot, 'deep-path-123456789');
    }

    const target = createStudioService({ dataRoot: targetRoot });
    try {
      const imported = await target.importArchive(source.data);
      const current = await target.execute('artifact_read', { artifactId: imported.artifact.id });
      expect(current.elements[0].html).toContain('当前源码');
      const frozen = await target.execute('artifact_read', {
        artifactId: imported.artifact.id,
        mode: 'source',
        feedbackId: source.feedback.id,
      });
      expect(frozen.html).toContain('原始源码');
      expect(
        Buffer.from((await target.getAsset(imported.artifact.id, source.asset.id)).data),
      ).toEqual(Buffer.from('89504e470d0a1a0a', 'hex'));
      expect(await readdir(join(targetRoot, 'staging'))).toEqual([]);
    } finally {
      await target.close();
    }
  });

  it('imports explicit file paths and rejects incomplete or unregistered content without publishing a partial work', async () => {
    const source = await fixture();
    const path = join(directory, 'selected.studio.zip');
    await writeFile(path, source.data);
    const imported = await service.execute('artifact_manage', {
      action: 'import',
      archivePath: path,
      title: '导入副本',
    });
    expect(imported.artifact.title).toBe('导入副本');
    const internal = await service.execute('artifact_manage', {
      action: 'import',
      archiveBase64: Buffer.from(source.data).toString('base64'),
    });
    expect(internal.artifact.id).not.toBe(imported.artifact.id);
    const before = (await service.execute('artifact_list')).artifacts.map(
      (item: { id: string }) => item.id,
    );
    const entries = unzipSync(source.data);
    delete entries[`assets/${source.asset.id}`];
    await expect(service.importArchive(zipSync(entries))).rejects.toMatchObject({
      code: 'INVALID_ARCHIVE',
    });
    const snapshot = await archiveState(entries, directory);
    snapshot.artifact.type = 'missing-product';
    await replaceArchiveState(entries, snapshot, directory);
    await expect(service.importArchive(zipSync(entries))).rejects.toMatchObject({
      code: 'UNSUPPORTED_PRODUCT',
    });
    expect(
      (await service.execute('artifact_list')).artifacts.map((item: { id: string }) => item.id),
    ).toEqual(before);
    expect(await readdir(join(directory, 'staging'))).toEqual([]);
    expect((await service.store.read(source.artifact.id)).sharing.tokens.viewer).toBe(
      'private-share-secret',
    );
  });

  it('rejects traversal, duplicate paths and expansion bombs before writing', async () => {
    const source = await fixture();
    const entries = unzipSync(source.data);
    await expect(
      service.importArchive(zipSync({ ...entries, '../escape': strToU8('bad') })),
    ).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' });
    const chunks: Uint8Array[] = [];
    const zip = new Zip((error, chunk) => {
      if (error) {
        throw error;
      }

      chunks.push(chunk);
    });

    for (const [name, bytes] of Object.entries(entries)) {
      const entry = new ZipPassThrough(name);
      zip.add(entry);
      entry.push(bytes, true);
    }

    const duplicate = new ZipPassThrough(deltaState);
    zip.add(duplicate);
    duplicate.push(entries[deltaState]!, true);
    zip.end();
    await expect(service.importArchive(Buffer.concat(chunks))).rejects.toMatchObject({
      code: 'INVALID_ARCHIVE',
    });

    await expect(
      service.importArchive(
        zipSync({ ...entries, 'assets/bomb': new Uint8Array(21 * 1024 * 1024) }),
      ),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });

    const dishonest = Buffer.from(
      zipSync({
        [deltaState]: strToU8('x'.repeat(3 * 1024 * 1024)),
        'manifest.json': entries['manifest.json']!,
      }),
    );
    dishonest.writeUInt32LE(1, 22);
    dishonest.writeUInt32LE(1, dishonest.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
    await expect(service.importArchive(dishonest)).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect((await service.execute('artifact_list')).artifacts).toHaveLength(1);
  });

  it('rejects corrupted resource checksums and cleans interrupted archive streams', async () => {
    const source = await fixture();
    const damaged = Buffer.from(source.data);
    const recordedAsset = Buffer.from(
      (await service.getAsset(source.artifact.id, source.asset.id)).data,
    );
    const offset = damaged.indexOf(recordedAsset);
    expect(offset).toBeGreaterThan(0);
    damaged[offset] = damaged[offset]! ^ 1;
    await expect(service.importArchive(damaged)).rejects.toMatchObject({
      code: 'INVALID_ARCHIVE',
    });

    const interrupted = new Error('The archive upload disconnected');
    async function* incomplete() {
      yield damaged.subarray(0, 16);
      throw interrupted;
    }

    await expect(service.importArchive(incomplete())).rejects.toBe(interrupted);
    expect((await service.execute('artifact_list')).artifacts).toHaveLength(1);
    expect(await stagingEntries(directory)).toEqual([]);
  });

  it('requires owner authority for ZIP creation, import, binary upload and archive download', async () => {
    const source = await fixture();
    await expect(
      service.execute('artifact_export', { artifactId: source.artifact.id, format: 'zip' }, viewer),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.importArchive(source.data, viewer)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const host = await startStudioHost({ dataRoot: directory });
    hosts.push(host);
    const upload = await fetch(`${host.origin}/api/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${host.token}`, 'Content-Type': 'application/zip' },
      body: Buffer.from(source.data),
    });
    expect(upload.status).toBe(200);
    expect(await upload.json()).toMatchObject({
      ok: true,
      data: { artifact: { title: '完整作品' }, board: { elements: expect.any(Array) } },
    });
    expect(
      (
        await fetch(`${host.origin}/api/import?token=${host.token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/zip' },
          body: Buffer.from(source.data),
        })
      ).status,
    ).toBe(401);
    const sharing = await host.service.execute('artifact_share', {
      artifactId: source.artifact.id,
      action: 'start',
    });
    const shared = new URL(sharing.links.viewer);
    const share = shared.searchParams.get('share')!;
    const joined = await fetch(`${host.origin}/api/session?artifactId=${source.artifact.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${share}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Archive viewer' }),
    });
    expect(joined.status).toBe(200);
    const cookie = joined.headers.get('set-cookie')!.split(';')[0]!;
    expect(
      (
        await fetch(`${host.origin}${source.exported.downloadPath}&token=${share}`, {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${host.origin}/api/import?artifactId=${source.artifact.id}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${share}`,
            Cookie: cookie,
            'Content-Type': 'application/zip',
          },
          body: Buffer.from(source.data),
        })
      ).status,
    ).toBe(403);
  });
});
