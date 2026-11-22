import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { DEFAULT_STYLE, LOCAL_ACTOR } from '../../src/contracts/studio.js';
import { createStudioService } from '../../src/server/studio-composition.js';
import type { ArtifactState } from '../../src/core/ports/studio-repository.js';
import { ArtifactStore } from '../../src/infrastructure/artifact-store.js';
import { FileAssetStore } from '../../src/infrastructure/asset-file-store.js';
import { SqliteArtifactRepository } from '../../src/infrastructure/sqlite-artifact.js';

const id = 'legacy-board';
const assetId = 'attached-image';
const assetBytes = 'asset retained by a frozen comment';
const time = '2026-11-21T00:00:00.000Z';

interface Content {
  elements: { id: string; text: string; version: number }[];
}

type State = ArtifactState<Content>;

function entry(revision: number, content: Content, artifact: State['artifact']) {
  return {
    artifact: { ...artifact, revision },
    content,
    entry: {
      id: 'version-' + revision,
      revision,
      createdAt: time,
      actor: LOCAL_ACTOR,
      summary: 'Fixture edit',
      changedIds: ['note'],
    },
  };
}

function fixture(): State {
  const artifact = {
    id,
    type: 'whiteboard',
    title: 'Current title',
    revision: 3,
    pinned: true,
    createdAt: time,
    updatedAt: time,
  };
  const content = { elements: [{ id: 'note', text: 'Current content', version: 3 }] };
  const old = { elements: [{ id: 'note', text: 'Old history', version: 1 }] };

  return {
    schemaVersion: 2,
    artifact,
    content,
    history: [entry(1, old, artifact), entry(3, content, artifact)],
    feedback: [
      {
        id: 'remark',
        artifactId: id,
        type: 'comment',
        anchor: { elementIds: ['note'] },
        author: LOCAL_ACTOR,
        text: 'Keep the frozen source',
        status: 'open',
        createdAt: time,
        updatedAt: time,
        replies: [],
      },
    ],
    sources: { remark: [{ version: 1, url: '/assets/' + id + '/' + assetId }] },
    assets: {
      [assetId]: {
        id: assetId,
        filename: 'sample.png',
        mimeType: 'image/png',
        size: Buffer.byteLength(assetBytes),
      },
    },
    operations: [
      { id: 'known-operation', fingerprint: 'known-fingerprint', historyId: 'version-1' },
    ],
    unitClocks: { note: { version: 3, incarnationStart: 2 } },
    sharing: {
      enabled: true,
      generation: 5,
      access: 'local',
      tokens: { editor: 'editor-link' },
      roleEnabled: { viewer: false },
    },
    guestNames: { guest: { name: 'Guest', key: 'guest' } },
  };
}

async function localRoot() {
  const parent = resolve(tmpdir());
  const root = resolve(await mkdtemp(join(parent, 'studio-artifact-migration-')));
  if (!root.startsWith(parent + sep)) {
    throw new Error('Unexpected migration fixture location');
  }

  return root;
}

async function seed(store: ArtifactStore<Content>, state: State, withAsset = true) {
  const folder = store.folder(id);
  await mkdir(join(folder, 'assets'), { recursive: true });
  if (withAsset) {
    await writeFile(join(folder, 'assets', assetId), assetBytes);
  }

  const repository = new SqliteArtifactRepository(store.file(id), true, 1);
  try {
    repository.database.exec('BEGIN IMMEDIATE');
    repository.writeState(state);
    repository.database.exec('COMMIT');
  } finally {
    repository.close();
  }
}

function edit(state: State): void {
  const version = ++state.artifact.revision;
  state.content = { elements: [{ id: 'note', text: 'New edit at ' + version, version }] };
  state.history.push(entry(version, state.content, state.artifact));
  state.unitClocks = { note: { version, incarnationStart: 2 } };
}

it('publishes the current board, fences an already opened v1 writer and keeps the old backup', async () => {
  const root = await localRoot();
  const store = new ArtifactStore<Content>(root);
  const original = fixture();
  let waiter: SqliteArtifactRepository | undefined;
  try {
    await seed(store, original);
    waiter = new SqliteArtifactRepository(store.file(id), true, 1);
    const oldRead = waiter.database.prepare("SELECT value FROM storage_meta WHERE key='artifact'");
    expect(oldRead.get()).toBeDefined();
    await store.transaction(id, edit);

    const state = await store.read(id);
    expect(state.artifact.revision).toBe(4);
    expect(state.history.map(({ entry }) => entry.revision)).toEqual([3, 4]);
    expect(state.history[0]?.content).toEqual(original.content);
    expect(state.feedback).toEqual(original.feedback);
    expect(state.sources).toEqual(original.sources);
    expect(state.assets).toEqual(original.assets);
    expect(state.sharing).toEqual(original.sharing);
    expect(state.guestNames).toEqual(original.guestNames);
    expect(state.unitClocks).toEqual({ note: { version: 4, incarnationStart: 2 } });
    expect(state.operations).toEqual([{ ...original.operations[0], receiptUnavailable: true }]);
    const assets = new FileAssetStore(store);
    expect(await assets.read(id, assetId, 1024)).toEqual({
      kind: 'data',
      data: Buffer.from(assetBytes),
    });

    waiter.database.exec('BEGIN IMMEDIATE');
    expect(() => oldRead.get()).toThrow();
    waiter.database.exec('ROLLBACK');
    waiter.close();
    waiter = undefined;

    const active = await store.activeAssetFolder(id);
    expect(active).not.toBe(store.folder(id));
    const generation = dirname(active);
    const copied = new SqliteArtifactRepository(
      join(generation, 'previous-v1', 'artifacts', id, 'artifact.sqlite'),
    );

    try {
      expect(copied.storageVersion).toBe(1);
      expect(
        copied.readState<Content, unknown, unknown>().history.map(({ entry }) => entry.revision),
      ).toEqual([1, 3]);
    } finally {
      copied.close();
    }

    const activeMarker = join(dirname(generation), 'active.json');
    await rename(activeMarker, join(dirname(generation), 'unpublished-marker.json'));
    const reopened = new ArtifactStore<Content>(root);
    expect((await reopened.read(id)).content).toEqual(state.content);
    await reopened.transaction(id, edit);
    const rollback = await reopened.createLegacyRollback(id);
    expect(await readFile(join(rollback, 'artifacts', id, 'assets', assetId), 'utf8')).toBe(
      assetBytes,
    );
    const legacy = new SqliteArtifactRepository(
      join(rollback, 'artifacts', id, 'artifact.sqlite'),
      true,
      1,
    );

    try {
      expect(legacy.storageVersion).toBe(1);
      const current = legacy.readState<Content, unknown, unknown>();
      expect(current.artifact.revision).toBe(5);
      expect(current.history.map(({ entry }) => entry.revision)).toEqual([5]);
      legacy.database.exec('BEGIN IMMEDIATE');
      edit(current);
      legacy.writeState(current);
      legacy.database.exec('COMMIT');
    } finally {
      legacy.close();
    }

    expect((await reopened.read(id)).artifact.revision).toBe(5);
  } finally {
    waiter?.close();
    await store.drainBackground();
    await rm(root, { recursive: true, force: true });
  }
});

it('relocks and saves to v1 when the asset closure cannot be prepared', async () => {
  const root = await localRoot();
  const store = new ArtifactStore<Content>(root);
  try {
    await seed(store, fixture(), false);
    await store.transaction(id, edit);
    expect((await store.read(id)).artifact.revision).toBe(4);
    const database = new DatabaseSync(store.file(id), { readOnly: true });
    try {
      expect(database.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
      expect(database.prepare('SELECT 1 FROM storage_meta LIMIT 1').get()).toBeDefined();
    } finally {
      database.close();
    }
  } finally {
    await store.drainBackground();
    await rm(root, { recursive: true, force: true });
  }
});

it.runIf(process.platform === 'win32')(
  'keeps a readable v1 backup when a full UUID generation would exceed SQLite path capacity',
  async () => {
    const root = await localRoot();
    const formerRelativeBackup = join(
      'artifact-generations',
      id,
      'x'.repeat(36),
      'previous-v1',
      'artifacts',
      id,
      'artifact.sqlite',
    );
    const padding = Math.max(1, 252 - join(root, formerRelativeBackup).length - 1);
    const dataRoot = join(root, 'data'.padEnd(padding, 'x'));
    const store = new ArtifactStore<Content>(dataRoot);
    try {
      expect(join(dataRoot, formerRelativeBackup).length).toBeGreaterThanOrEqual(252);
      await seed(store, fixture());
      store.scheduleUpgrade(id);
      await store.transaction(id, edit);
      const active = await store.activeAssetFolder(id);
      expect(active).not.toBe(store.folder(id));
      const backupPath = join(dirname(active), 'previous-v1', 'artifacts', id, 'artifact.sqlite');
      const backup = new SqliteArtifactRepository(backupPath);
      try {
        expect(backup.storageVersion).toBe(1);
        expect(backup.readAuthorization().artifact.revision).toBe(3);
      } finally {
        backup.close();
      }
      expect((await store.read(id)).history.map(({ entry }) => entry.revision)).toEqual([3, 4]);
    } finally {
      await store.drainBackground();
      await rm(root, { recursive: true, force: true });
    }
  },
);

it('upgrades on an owner board read and rejects replay of an operation without its old receipt', async () => {
  const root = await localRoot();
  const service = createStudioService({ dataRoot: root });
  const store = new ArtifactStore<Content>(root);
  const prior = [{ op: 'update', id: 'note', changes: { text: 'Older operation' } }];
  const original = fixture();
  const boardContent = (content: Content) => ({
    style: DEFAULT_STYLE,
    elements: content.elements.map((element) => ({
      ...element,
      type: 'text',
      x: 0,
      y: 0,
      w: 300,
      h: 80,
    })),
  });
  original.content = boardContent(original.content);
  original.history = original.history.map((saved) => ({
    ...saved,
    content: boardContent(saved.content),
  }));
  original.operations[0]!.fingerprint = createHash('sha256')
    .update(JSON.stringify({ operations: prior, actor: LOCAL_ACTOR.id }))
    .digest('hex');

  try {
    await seed(store, original);
    const authorizeLegacy = vi.fn();
    expect(await store.readBoardScene(id, authorizeLegacy)).toBeUndefined();
    expect(authorizeLegacy).toHaveBeenCalledOnce();
    const opened = await service.execute('artifact_read', { artifactId: id, mode: 'board' });
    expect(opened.artifact).toMatchObject({ id, revision: 3 });
    await service.store.drainBackground();
    expect(await service.store.activeAssetFolder(id)).not.toBe(store.folder(id));

    const wholeRead = vi.spyOn(SqliteArtifactRepository.prototype, 'readState');
    try {
      const authorizeScene = vi.fn();
      const scene = await store.readBoardScene(id, authorizeScene);
      expect(scene?.artifact).toMatchObject({ id, revision: 3 });
      expect(authorizeScene).toHaveBeenCalledOnce();
      expect(wholeRead).not.toHaveBeenCalled();
    } finally {
      wholeRead.mockRestore();
    }

    await service.execute('artifact_apply', {
      artifactId: id,
      expectedRevision: 3,
      operationId: 'new-operation',
      operations: [{ op: 'update', id: 'note', changes: { text: 'After upgrade' } }],
    });
    const duplicate = {
      artifactId: id,
      operationId: original.operations[0]!.id,
      operations: prior,
    };
    await expect(service.execute('artifact_apply', duplicate)).rejects.toMatchObject({
      code: 'COMMIT_RESULT_UNKNOWN',
    });
    expect((await store.read(id)).content.elements[0]).toMatchObject({
      text: 'After upgrade',
      version: 4,
    });
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
