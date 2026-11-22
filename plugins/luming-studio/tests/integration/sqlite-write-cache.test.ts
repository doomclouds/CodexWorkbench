import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LOCAL_ACTOR } from '../../src/contracts/studio.js';
import type { ArtifactState } from '../../src/core/shared/model.js';
import { ArtifactStore } from '../../src/infrastructure/artifact-store.js';
import {
  ARTIFACT_DATABASE_VERSION,
  SqliteArtifactRepository,
} from '../../src/infrastructure/sqlite-artifact.js';

type TestContent = { elements: { id: string; html: string }[] };

const retainedHistoryLimit = 200;

function snapshot(
  historyId: string,
  state: Pick<ArtifactState<TestContent>, 'artifact' | 'content'>,
) {
  return {
    artifact: { ...state.artifact },
    content: state.content,
    entry: {
      id: historyId,
      revision: state.artifact.revision,
      actor: LOCAL_ACTOR,
      createdAt: state.artifact.updatedAt,
      summary: 'Write shared content',
      changedIds: ['region'],
    },
  };
}

function fixture(): ArtifactState<TestContent> {
  const time = '2026-11-21T00:00:00.000Z';
  const state: ArtifactState<TestContent> = {
    schemaVersion: 2,
    artifact: {
      id: 'canvas-cache',
      type: 'whiteboard',
      title: 'Cache fixture',
      revision: 2,
      createdAt: time,
      updatedAt: time,
      pinned: false,
    },
    content: { elements: [{ id: 'region', html: '<p>Long archived region</p>'.repeat(90) }] },
    history: [],
    operations: [],
    feedback: [],
    sources: {},
    assets: {},
    sharing: { enabled: false, generation: 0, tokens: {} },
  };
  const firstVersion = { ...state.artifact, revision: 1 };
  state.history.push(
    snapshot('version-1', { ...state, artifact: firstVersion }),
    snapshot('version-2', state),
  );

  return state;
}

async function fixtureDirectory() {
  const prefix = 'studio-sqlite-write-cache-';
  const root = resolve(tmpdir());
  const directory = resolve(await mkdtemp(join(root, prefix)));
  if (!directory.startsWith(root + sep) || !basename(directory).startsWith(prefix)) {
    throw new Error('Unexpected SQLite fixture path');
  }

  return directory;
}

function retainedFixture(revision: number) {
  const state = fixture();
  state.artifact.revision = revision;
  state.history = Array.from({ length: revision }, (_, index) => {
    const number = index + 1;

    return snapshot('version-' + number, {
      ...state,
      artifact: { ...state.artifact, revision: number },
    });
  });

  return state;
}

function appendVersion(state: ArtifactState<TestContent>) {
  const revision = ++state.artifact.revision;
  state.content = { elements: [{ id: 'region', html: '<p>Revision ' + revision + '</p>' }] };
  const saved = snapshot('version-' + revision, state);
  state.history = [...state.history, saved].slice(-retainedHistoryLimit);
  state.operations.push({
    id: 'operation-' + revision,
    fingerprint: 'test-save-' + revision,
    historyId: saved.entry.id,
  });
}

function readCache(database: DatabaseSync) {
  return database.prepare('PRAGMA cache_size').get()?.cache_size;
}

function observeSaveCommands(onExec?: (database: DatabaseSync, sql: string) => void) {
  const original = DatabaseSync.prototype.exec;
  const events: [string, ReturnType<typeof readCache>][] = [];
  const spy = vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (
    this: DatabaseSync,
    sql,
  ) {
    if (sql === 'COMMIT' || sql === 'ROLLBACK' || sql.startsWith('PRAGMA cache_size')) {
      events.push([sql, readCache(this)]);
    }

    onExec?.(this, sql);
    original.call(this, sql);
  });

  return { events, spy };
}

function reclamationFixture() {
  const state = retainedFixture(3);
  const current = { id: 'retained-current', html: '<p>Current</p>' };
  const historical = { id: 'retained-history', html: '<p>Historical</p>' };
  const collection = {
    id: 'retained-asset',
    filename: 'fixture.png',
    mimeType: 'image/png',
    size: 1,
    html: '<p>Collection fixture</p>',
  };
  const sharedText = '<p>Shared external text</p>'.repeat(90);
  const historyParent = { id: 'history-parent', html: sharedText };
  const obsoleteParent = { id: 'obsolete-parent', html: sharedText };
  const unreachable = { id: 'unreachable', html: '<p>Unreferenced external text</p>'.repeat(90) };
  const removedVersion = {
    elements: [current, historical, collection, obsoleteParent, unreachable],
  };
  const savedVersion = { elements: [historical, historyParent] };
  state.content = { elements: [current] };
  state.history = [
    { ...state.history[0]!, content: removedVersion },
    { ...state.history[1]!, content: savedVersion },
    { ...state.history[2]!, content: state.content },
  ];
  state.assets[collection.id] = collection;

  return { state, current, historical, collection, obsoleteParent, unreachable, savedVersion };
}

function obsoleteVersionHashes(database: DatabaseSync) {
  const row = database
    .prepare(
      'SELECT manifest.hash,manifest.json FROM content_manifests AS manifest JOIN history_versions AS history ON history.content_hash=manifest.hash WHERE history.revision=1',
    )
    .get();
  const parsed = JSON.parse(String(row?.json)) as { units: { id: string; hash: string }[] };

  return {
    manifest: String(row?.hash),
    units: new Map(parsed.units.map(({ id, hash }) => [id, hash])),
  };
}

function observeReferenceChecks(database: DatabaseSync) {
  const candidates: string[] = [];
  const prepare = database.prepare.bind(database);
  const spy = vi.spyOn(database, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql);
    if (sql.startsWith('SELECT 1 AS present WHERE EXISTS(')) {
      const get = statement.get.bind(statement);
      vi.spyOn(statement, 'get').mockImplementation((...bindings) => {
        candidates.push(String(bindings[0]));

        return get(...bindings);
      });
    }

    return statement;
  });

  return { candidates, spy };
}

it('skips current payload checks while protecting retained history, collections, and shared child blobs', async () => {
  const directory = await fixtureDirectory();
  let repository: SqliteArtifactRepository | undefined;
  const input = reclamationFixture();
  try {
    const connection = new SqliteArtifactRepository(join(directory, 'artifact.sqlite'), true, 1);
    repository = connection;
    const { database } = connection;
    database.exec('BEGIN IMMEDIATE');
    connection.writeState(input.state);
    database.exec('COMMIT');

    const { manifest, units } = obsoleteVersionHashes(database);
    const currentHash = units.get(input.current.id)!;
    const historicalHash = units.get(input.historical.id)!;
    const collectionHash = units.get(input.collection.id)!;
    const obsoleteParentHash = units.get(input.obsoleteParent.id)!;
    const unreachableHash = units.get(input.unreachable.id)!;
    const child = database.prepare('SELECT child_hash FROM payload_links WHERE parent_hash=?');
    const sharedText = String(child.get(obsoleteParentHash)?.child_hash);
    const unreachableText = String(child.get(unreachableHash)?.child_hash);
    const state = connection.readState<TestContent, unknown, unknown>();
    state.history = state.history.slice(1);

    const { candidates, spy } = observeReferenceChecks(database);
    try {
      database.exec('BEGIN IMMEDIATE');
      connection.writeState(state);
      database.exec('COMMIT');
    } finally {
      spy.mockRestore();
    }

    expect(candidates).not.toContain(currentHash);
    expect(new Set(candidates)).toEqual(
      new Set([
        historicalHash,
        collectionHash,
        obsoleteParentHash,
        unreachableHash,
        sharedText,
        unreachableText,
      ]),
    );
    const payload = database.prepare('SELECT 1 AS kept FROM payload_blobs WHERE hash=?');
    expect(
      [currentHash, historicalHash, collectionHash, sharedText].map(
        (hash) => payload.get(hash)?.kept,
      ),
    ).toEqual([1, 1, 1, 1]);
    expect(
      [obsoleteParentHash, unreachableHash, unreachableText].map((hash) => payload.get(hash)),
    ).toEqual([undefined, undefined, undefined]);
    expect(
      database
        .prepare('SELECT payload_hash FROM content_payloads WHERE manifest_hash=?')
        .all(manifest),
    ).toEqual([]);
    expect(
      database.prepare('SELECT hash FROM content_manifests WHERE hash=?').get(manifest),
    ).toBeUndefined();
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    const saved = connection.readState<TestContent, unknown, unknown>();
    expect(saved.content).toEqual(input.state.content);
    expect(saved.history.map((version) => version.content)).toEqual([
      input.savedVersion,
      input.state.content,
    ]);
    expect(saved.assets[input.collection.id]).toEqual(input.collection);
  } finally {
    repository?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('rebuilds the original lookup indexes before publishing an empty archive database', async () => {
  const directory = await fixtureDirectory();
  let regular: SqliteArtifactRepository | undefined;
  let imported: SqliteArtifactRepository | undefined;
  try {
    const baseline = new SqliteArtifactRepository(join(directory, 'regular.sqlite'), true);
    regular = baseline;
    const staging = new SqliteArtifactRepository(join(directory, 'staging.sqlite'), true);
    imported = staging;
    const state = fixture();
    baseline.database.exec('BEGIN IMMEDIATE');
    baseline.writeState(state);
    baseline.database.exec('COMMIT');

    const originalWrite = staging.writeState.bind(staging);
    const indexes = staging.database.prepare(
      "SELECT name FROM sqlite_schema WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const write = vi.spyOn(staging, 'writeState').mockImplementation((value) => {
      expect(indexes.all()).toEqual([]);
      originalWrite(value);
    });
    staging.database.exec('BEGIN IMMEDIATE');
    staging.writeImportedState(state);
    staging.database.exec('COMMIT');
    write.mockRestore();

    const schema = 'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name';
    expect(staging.database.prepare(schema).all()).toEqual(baseline.database.prepare(schema).all());
    expect(staging.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(staging.readState<TestContent, unknown, unknown>()).toEqual(
      baseline.readState<TestContent, unknown, unknown>(),
    );

    staging.database.exec('BEGIN IMMEDIATE');
    expect(() => staging.writeImportedState(state)).toThrow('empty database');
    staging.database.exec('ROLLBACK');
  } finally {
    imported?.close();
    regular?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('only writes current unit rows with a changed payload or ordinal', async () => {
  const directory = await fixtureDirectory();
  let repository: SqliteArtifactRepository | undefined;
  try {
    const connection = new SqliteArtifactRepository(join(directory, 'artifact.sqlite'), true);
    repository = connection;
    const { database } = connection;
    const initial = fixture();
    initial.content.elements.push({ id: 'shared', html: '<p>Unchanged</p>' });
    connection.writeState(initial);
    database.exec('CREATE TEMP TABLE observed_unit_writes(id TEXT, ordinal INTEGER)');
    database.exec(`CREATE TEMP TRIGGER observe_unit_writes AFTER INSERT ON current_units
      BEGIN INSERT INTO observed_unit_writes VALUES(NEW.id, NEW.ordinal); END`);
    database.exec(`CREATE TEMP TRIGGER observe_unit_reorder AFTER UPDATE ON current_units
      BEGIN INSERT INTO observed_unit_writes VALUES(NEW.id, NEW.ordinal); END`);
    const selectWrites = database.prepare(
      'SELECT id,ordinal FROM observed_unit_writes ORDER BY id',
    );
    const state = connection.readState<TestContent, unknown, unknown>();
    const first = state.content.elements[0]!;
    const second = state.content.elements[1]!;
    const edited = { ...first, html: '<p>Edited</p>' };
    state.content = { elements: [edited, second] };
    connection.writeState(state);
    expect(selectWrites.all().map(({ id }) => id)).toEqual(['region']);

    database.exec('DELETE FROM observed_unit_writes');
    state.content = { elements: [second, edited] };
    connection.writeState(state);
    expect(selectWrites.all().map(({ id }) => id)).toEqual(['shared']);
    expect(connection.readState<TestContent, unknown, unknown>().content).toEqual(state.content);
  } finally {
    repository?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('reuses shared data within a write and clears the write cache on rollback and later writes', async () => {
  const directory = await fixtureDirectory();
  let repository: SqliteArtifactRepository | undefined;
  const state = fixture();

  try {
    const connection = new SqliteArtifactRepository(join(directory, 'artifact.sqlite'), true);
    repository = connection;
    const { database } = connection;
    const cacheSize = () => database.prepare('PRAGMA cache_size').get()?.cache_size;
    const originalCache = cacheSize();
    const exec = vi.spyOn(database, 'exec');
    database.exec(`CREATE TRIGGER reject_state BEFORE INSERT ON state_records
      BEGIN SELECT RAISE(ABORT, 'Simulated state write failure'); END`);
    database.exec('BEGIN IMMEDIATE');
    expect(() => connection.writeState(state)).toThrow('Simulated state write failure');
    expect(exec).toHaveBeenCalledWith('PRAGMA cache_size = -32768');
    expect(cacheSize()).toBe(originalCache);
    database.exec('ROLLBACK');
    expect(database.prepare('SELECT count(*) AS count FROM payload_blobs').get()?.count).toBe(0);
    expect(database.prepare('SELECT count(*) AS count FROM history_versions').get()?.count).toBe(0);

    database.exec('DROP TRIGGER reject_state');
    database.exec('BEGIN IMMEDIATE');
    exec.mockClear();
    connection.writeState(state);
    expect(exec.mock.calls).toEqual([
      ['PRAGMA cache_size = -32768'],
      ['PRAGMA cache_size = ' + String(originalCache)],
    ]);
    expect(cacheSize()).toBe(originalCache);
    database.exec('COMMIT');
    const before = connection.readState<TestContent, unknown, unknown>();
    expect(before.content).toEqual(state.content);
    expect(before.history[0]?.content).toEqual(state.content);

    state.content.elements[0]!.html = '<p>Different content after commit</p>'.repeat(90);
    state.artifact.revision = 3;
    state.history = [...before.history, snapshot('version-3', state)];

    database.exec('BEGIN IMMEDIATE');
    exec.mockClear();
    connection.writeState(state);
    expect(exec).not.toHaveBeenCalled();
    expect(cacheSize()).toBe(originalCache);
    database.exec('COMMIT');
    const after = connection.readState<TestContent, unknown, unknown>();
    expect(after.content).toEqual(state.content);
    expect(after.history.map((item) => item.content)).toEqual([
      before.content,
      before.content,
      state.content,
    ]);
    expect(database.prepare('PRAGMA user_version').get()?.user_version).toBe(
      ARTIFACT_DATABASE_VERSION,
    );
  } finally {
    repository?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps the ordinary v2 write cache at retained capacity', async () => {
  const directory = await fixtureDirectory();
  const store = new ArtifactStore<TestContent>(directory);
  const initial = retainedFixture(retainedHistoryLimit - 2);
  const id = initial.artifact.id;
  try {
    await store.write(initial);
    await store.drainBackground();
    const { events, spy } = observeSaveCommands();
    try {
      await store.transaction(id, appendVersion);
      await store.transaction(id, appendVersion);
      await store.transaction(id, appendVersion);
      await store.transaction(id, (state) => state.artifact.revision);
      expect(events).toEqual([
        ['COMMIT', -2000],
        ['COMMIT', -2000],
        ['COMMIT', -2000],
        ['COMMIT', -2000],
      ]);
    } finally {
      spy.mockRestore();
    }

    const connection = new SqliteArtifactRepository(store.file(id), true);
    try {
      const { database } = connection;
      const saved = connection.readState<TestContent, unknown, unknown>();
      expect(saved.artifact.revision).toBe(retainedHistoryLimit + 1);
      expect(saved.history).toHaveLength(retainedHistoryLimit);
      expect(saved.history[0]?.entry.revision).toBe(2);
      expect(readCache(database)).toBe(-2000);
      expect(database.prepare('PRAGMA user_version').get()?.user_version).toBe(
        ARTIFACT_DATABASE_VERSION,
      );
      expect(database.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('delete');
      expect(database.prepare('PRAGMA synchronous').get()?.synchronous).toBe(2);
      expect(database.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
    } finally {
      connection.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('rolls back both the v2 history and receipt after a late SQLite write failure', async () => {
  const directory = await fixtureDirectory();
  const store = new ArtifactStore<TestContent>(directory);
  const initial = retainedFixture(retainedHistoryLimit);
  const id = initial.artifact.id;
  try {
    await store.write(initial);
    await store.drainBackground();
    let revisionBeforeRollback;
    const originalExec = DatabaseSync.prototype.exec;
    const { events, spy } = observeSaveCommands((database, sql) => {
      if (sql === 'BEGIN IMMEDIATE') {
        originalExec.call(
          database,
          `CREATE TEMP TRIGGER reject_operation
          BEFORE INSERT ON state_records WHEN NEW.collection = 'operations'
          BEGIN SELECT RAISE(ABORT, 'Simulated late write failure'); END`,
        );
      }
      if (sql === 'ROLLBACK') {
        revisionBeforeRollback = database
          .prepare('SELECT max(revision) AS revision FROM history_versions')
          .get()?.revision;
      }
    });

    try {
      await expect(store.transaction(id, appendVersion)).rejects.toThrow(
        'Simulated late write failure',
      );
      expect(events).toEqual([['ROLLBACK', -2000]]);
      expect(revisionBeforeRollback).toBe(retainedHistoryLimit + 1);
    } finally {
      spy.mockRestore();
    }

    const connection = new SqliteArtifactRepository(store.file(id), true);
    try {
      const saved = connection.readState<TestContent, unknown, unknown>();
      expect(saved.artifact.revision).toBe(retainedHistoryLimit);
      expect(saved.history).toHaveLength(retainedHistoryLimit);
      expect(saved.history[0]?.entry.revision).toBe(1);
      expect(saved.content).toEqual(initial.content);
      expect(saved.operations).toEqual([]);
      expect(readCache(connection.database)).toBe(-2000);
      expect(connection.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      connection.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
