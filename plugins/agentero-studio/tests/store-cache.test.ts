import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ArtifactStore } from '../src/core/shared/store.js';
import {
  SqliteArtifactRepository,
  ARTIFACT_DATABASE_APPLICATION_ID,
  ARTIFACT_DATABASE_VERSION,
} from '../src/core/shared/sqlite-artifact.js';
import { createState, makeHistory } from '../src/core/shared/history.js';
import { LOCAL_ACTOR } from '../src/contracts/studio.js';
import { StudioService } from '../src/core/service.js';

type Content = { value: string; nested: { count: number } };

let folder: string;
const services: StudioService[] = [];
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'studio-sqlite-store-'));
});
afterEach(async () => {
  for (const service of services.splice(0)) {
    await service.close();
  }

  vi.restoreAllMocks();
  if (!resolve(folder).startsWith(resolve(tmpdir()) + sep)) {
    throw Error('Unexpected storage fixture');
  }

  await rm(folder, { recursive: true, force: true });
});

function fixture(value = 'AAA') {
  const now = new Date().toISOString();

  return createState(
    {
      id: randomUUID(),
      type: 'test',
      title: 'SQLite',
      revision: 0,
      createdAt: now,
      updatedAt: now,
      pinned: false,
    },
    { value, nested: { count: 1 } } as Content,
    LOCAL_ACTOR,
    'create',
    ['unit'],
  );
}

function stores() {
  return { first: new ArtifactStore<Content>(folder), second: new ArtifactStore<Content>(folder) };
}

describe('portable transactional artifact database', () => {
  it('creates a versioned SQLite file without a JSON state file', async () => {
    const state = fixture();
    const { first } = stores();
    await first.write(state);
    expect((await readFile(first.file(state.artifact.id))).subarray(0, 16).toString()).toBe(
      'SQLite format 3\0',
    );
    await expect(
      stat(join(first.folder(state.artifact.id), 'artifact.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const database = new DatabaseSync(first.file(state.artifact.id), { readOnly: true });
    try {
      expect(database.prepare('PRAGMA application_id').get()!.application_id).toBe(
        ARTIFACT_DATABASE_APPLICATION_ID,
      );
      expect(database.prepare('PRAGMA user_version').get()!.user_version).toBe(
        ARTIFACT_DATABASE_VERSION,
      );
      expect(database.prepare('PRAGMA journal_mode').get()!.journal_mode).toBe('delete');
    } finally {
      database.close();
    }
  });
  it('returns mutable isolated copies and protects projection state', async () => {
    const state = fixture();
    const { first } = stores();
    await first.write(state);
    const one = await first.read(state.artifact.id);
    one.content.nested.count = 99;
    one.sharing.enabled = true;
    one.history.length = 0;
    const two = await first.read(state.artifact.id);
    expect(two.content.nested.count).toBe(1);
    expect(two.sharing.enabled).toBe(false);
    expect(two.history).toHaveLength(1);
    const projection = await first.readProjection(state.artifact.id, (current) => {
      expect(Object.isFrozen(current)).toBe(true);
      expect(Object.isFrozen(current.content.nested)).toBe(true);
      expect(Object.isFrozen(current.history[0]!.content.nested)).toBe(true);

      return { content: current.content, sharing: current.sharing };
    });
    projection.content.nested.count = 200;
    expect(
      (await first.readProjection(state.artifact.id, (current) => current.content.nested)).count,
    ).toBe(1);
    await expect(
      first.readProjection(state.artifact.id, (current) => {
        (current.content as Content).value = 'bad';

        return true;
      }),
    ).rejects.toThrow();
    const businessError = new Error('Synthetic selector failure');
    await expect(
      first.readProjection(state.artifact.id, () => {
        throw businessError;
      }),
    ).rejects.toBe(businessError);
    expect((await first.read(state.artifact.id)).content.value).toBe('AAA');
  });
  it('materializes a historical callback result before closing its database', async () => {
    const state = fixture();
    const { first } = stores();
    await first.write(state);
    const saved = await first.transaction(state.artifact.id, (current) => {
      current.content.value = 'new';

      return current.history[0];
    });
    expect(saved?.content.value).toBe('AAA');
    saved!.content.nested.count = 99;
    expect((await first.read(state.artifact.id)).history[0]!.content.nested.count).toBe(1);
  });
  it('rolls back callback failure and commit failure without exposing partial state', async () => {
    const state = fixture();
    const { first } = stores();
    await first.write(state);
    await expect(
      first.transaction(state.artifact.id, (current) => {
        current.content.value = 'CCC';
        throw Error('Rejected transaction');
      }),
    ).rejects.toThrow('Rejected transaction');
    expect((await first.read(state.artifact.id)).content.value).toBe('AAA');
    vi.spyOn(SqliteArtifactRepository.prototype, 'writeState').mockImplementationOnce(() => {
      throw Error('Synthetic database write failure');
    });
    await expect(
      first.transaction(state.artifact.id, (current) => {
        current.content.value = 'BBB';
      }),
    ).rejects.toThrow('Synthetic database write failure');
    expect((await first.read(state.artifact.id)).content.value).toBe('AAA');
  });
  it('never publishes a half-created database when the initial state fails', async () => {
    const state = fixture();
    const { first } = stores();
    vi.spyOn(SqliteArtifactRepository.prototype, 'writeState').mockImplementationOnce(() => {
      throw Error('Synthetic initial write failure');
    });
    await expect(first.write(state)).rejects.toThrow('Synthetic initial write failure');
    await expect(stat(first.file(state.artifact.id))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await first.catalog()).toEqual([]);
  });
  it('observes same-instance and other-instance transactions without stale current state', async () => {
    const state = fixture();
    const { first, second } = stores();
    await first.write(state);
    await first.read(state.artifact.id);
    await second.transaction(state.artifact.id, (current) => {
      current.content.value = 'BBB';
    });
    expect((await first.read(state.artifact.id)).content.value).toBe('BBB');
    const next = await second.read(state.artifact.id);
    next.content.value = 'CCC';
    await second.write(next);
    expect((await first.read(state.artifact.id)).content.value).toBe('CCC');
  });
  it('holds fresh authorization under the same cross-instance write lock', async () => {
    const state = fixture();
    const { first, second } = stores();
    await first.write(state);
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reading = first.withProjectionLock(
      state.artifact.id,
      (current) => ({ artifact: current.artifact, sharing: current.sharing }),
      async (selected) => {
        selected.sharing.enabled = true;
        entered();
        await hold;

        return selected.artifact.id;
      },
    );
    await ready;
    let wrote = false;
    const writing = second.transaction(state.artifact.id, (current) => {
      current.content.value = 'BBB';
      wrote = true;
    });
    await delay(25);
    const held = !wrote;
    release();
    await Promise.all([reading, writing]);
    expect(held).toBe(true);
    expect((await first.read(state.artifact.id)).sharing.enabled).toBe(false);
    expect((await first.read(state.artifact.id)).content.value).toBe('BBB');
  });
  it('deduplicates unchanged large text and reclaims only unreachable retained data', async () => {
    const content = {
      elements: [{ id: 'html', html: 'shared large text '.repeat(500), x: 0 }],
      style: {},
    };
    const state = createState(fixture().artifact, content, LOCAL_ACTOR, 'create', ['html']);
    const first = new ArtifactStore<typeof state.content>(folder);
    await first.write(state);
    for (let index = 0; index < 205; index++) {
      await first.transaction(state.artifact.id, (current) => {
        if (index === 0) {
          current.sources.kept = [{ html: current.content.elements[0]!.html }];
          current.content.elements[0]!.html = 'replacement large text '.repeat(500);
        }

        current.content.elements[0]!.x = index;
        makeHistory(current, LOCAL_ACTOR, 'move', ['html']);
      });
    }

    let database = new DatabaseSync(first.file(state.artifact.id), { readOnly: true });
    try {
      expect(database.prepare('SELECT count(*) AS total FROM history_versions').get()!.total).toBe(
        200,
      );
      expect(
        database.prepare('SELECT count(*) AS total FROM content_manifests').get()!.total,
      ).toBeLessThanOrEqual(201);
      expect(
        database
          .prepare('SELECT count(*) AS total FROM payload_blobs WHERE json=?')
          .get(JSON.stringify('shared large text '.repeat(500)))!.total,
      ).toBe(1);
    } finally {
      database.close();
    }

    await first.transaction(state.artifact.id, (current) => {
      delete current.sources.kept;
    });
    database = new DatabaseSync(first.file(state.artifact.id), { readOnly: true });
    try {
      expect(
        database
          .prepare('SELECT count(*) AS total FROM payload_blobs WHERE json=?')
          .get(JSON.stringify('shared large text '.repeat(500)))!.total,
      ).toBe(0);
    } finally {
      database.close();
    }
  });
  it('rejects logical expansion beyond the import budget before returning history', async () => {
    const state = fixture('x'.repeat(10_000));
    const { first } = stores();
    state.history = Array.from({ length: 100 }, (_, index) => ({
      ...structuredClone(state.history[0]!),
      entry: { ...state.history[0]!.entry, id: randomUUID(), revision: index },
      artifact: { ...state.artifact, revision: index },
    }));
    await first.write(state);
    await expect(
      first.read(state.artifact.id, { maxExpandedBytes: 100_000 }),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect(await first.readProjection(state.artifact.id, (current) => current.history.length)).toBe(
      100,
    );
  });
  it('detects corrupt payloads and rejects future schemas', async () => {
    const state = fixture();
    const { first } = stores();
    await first.write(state);
    let database = new DatabaseSync(first.file(state.artifact.id));
    database.exec(
      'UPDATE payload_blobs SET json=\'"silent corruption"\' WHERE hash=(SELECT payload_hash FROM state_records LIMIT 1)',
    );
    database.close();
    await expect(first.read(state.artifact.id)).rejects.toMatchObject({ code: 'CORRUPT_ARTIFACT' });
    await first.write(state);
    database = new DatabaseSync(first.file(state.artifact.id));
    database.exec('PRAGMA user_version=999');
    database.close();
    await expect(first.read(state.artifact.id)).rejects.toMatchObject({
      code: 'UNSUPPORTED_STORAGE',
    });
  });
  it('keeps healthy catalog entries visible beside corrupt and future databases', async () => {
    const healthy = fixture();
    const corrupt = fixture();
    const future = fixture();
    const { first } = stores();
    for (const state of [healthy, corrupt, future]) {
      await first.write(state);
    }

    await writeFile(first.file(corrupt.artifact.id), 'not a SQLite database');
    const database = new DatabaseSync(first.file(future.artifact.id));
    database.exec('PRAGMA user_version=999');
    database.close();
    const before = await Promise.all([
      readFile(first.file(corrupt.artifact.id)),
      readFile(first.file(future.artifact.id)),
    ]);
    expect((await first.catalog()).map((artifact) => artifact.id)).toEqual([healthy.artifact.id]);
    await expect(first.read(corrupt.artifact.id)).rejects.toMatchObject({
      code: 'CORRUPT_ARTIFACT',
    });
    await expect(first.read(future.artifact.id)).rejects.toMatchObject({
      code: 'UNSUPPORTED_STORAGE',
    });
    expect(await readFile(first.file(corrupt.artifact.id))).toEqual(before[0]);
    expect(await readFile(first.file(future.artifact.id))).toEqual(before[1]);
  });
  it('rejects database symlinks instead of following a different artifact', async () => {
    const state = fixture();
    const next = fixture();
    const { first } = stores();
    await first.write(state);
    await first.write(next);
    await rm(first.file(state.artifact.id));
    try {
      await symlink(first.file(next.artifact.id), first.file(state.artifact.id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        return;
      }

      throw error;
    }

    await expect(first.read(state.artifact.id)).rejects.toMatchObject({ code: 'RESOURCE_SCOPE' });
    await expect(first.write(state)).rejects.toMatchObject({ code: 'RESOURCE_SCOPE' });
    expect((await first.read(next.artifact.id)).content.value).toBe('AAA');
  });
  it('deletes only trashed artifacts and leaves no open database handles', async () => {
    const state = fixture();
    const { first } = stores();
    await first.write(state);
    await expect(first.purge(state.artifact.id, async () => {})).rejects.toMatchObject({
      code: 'NOT_TRASHED',
    });
    await first.transaction(state.artifact.id, (current) => {
      current.artifact.trashedAt = new Date().toISOString();
    });
    await first.purge(state.artifact.id, async () => {});
    await expect(first.read(state.artifact.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('database permission and object CAS', () => {
  it('observes other-instance revocation and derives sharing state for the catalog', async () => {
    const first = new StudioService({ dataRoot: folder });
    const second = new StudioService({ dataRoot: folder });
    services.push(first, second);
    const { artifact } = await first.execute('artifact_manage', { action: 'create' });
    const sharing = await first.execute('artifact_share', {
      artifactId: artifact.id,
      action: 'start',
      access: 'local',
    });
    const token = new URL(sharing.links.editor, 'http://local').searchParams.get('share')!;
    expect(await first.shareRole(artifact.id, token)).toBe('editor');
    expect((await first.store.catalog()).find((value) => value.id === artifact.id)?.sharing).toBe(
      true,
    );
    await second.execute('artifact_share', {
      artifactId: artifact.id,
      action: 'reset',
      role: 'editor',
    });
    expect(await first.shareRole(artifact.id, token)).toBeUndefined();
  });
  it('checks current CAS inside the lock and preserves safe rebasing', async () => {
    const first = new StudioService({ dataRoot: folder });
    const second = new StudioService({ dataRoot: folder });
    services.push(first, second);
    const { artifact } = await first.execute('artifact_manage', {
      action: 'create',
      elements: [{ id: 'a', type: 'text', text: 'old' }],
    });
    await first.execute('artifact_read', { artifactId: artifact.id });
    await second.execute('artifact_read', { artifactId: artifact.id });
    await second.execute('artifact_apply', {
      artifactId: artifact.id,
      expectedVersions: { a: 1 },
      operations: [{ op: 'update', id: 'a', changes: { text: 'remote' } }],
    });
    await expect(
      first.execute('artifact_apply', {
        artifactId: artifact.id,
        expectedVersions: { a: 1 },
        operations: [{ op: 'update', id: 'a', changes: { text: 'stale' } }],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const result = await first.execute('artifact_apply', {
      artifactId: artifact.id,
      merge: 'safe',
      expectedVersions: { a: 1 },
      operations: [{ op: 'update', id: 'a', changes: { x: 42 } }],
    });
    expect(result.board.elements[0]).toMatchObject({ text: 'remote', x: 42, version: 3 });
  });
});
