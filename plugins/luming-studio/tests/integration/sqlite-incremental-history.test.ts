import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LOCAL_ACTOR, type BoardElement } from '../../src/contracts/studio.js';
import { initialWhiteboard, type WhiteboardContent } from '../../src/core/products/whiteboard.js';
import { createState, makeHistory } from '../../src/core/shared/history.js';
import type { ArtifactState } from '../../src/core/shared/model.js';
import { SqliteArtifactRepository } from '../../src/infrastructure/sqlite-artifact.js';
import { CHECKPOINT_WORK_KEY } from '../../src/infrastructure/sqlite-checkpoint-work.js';
import { SqliteIncrementalHistory } from '../../src/infrastructure/sqlite-incremental-history.js';
import { whiteboardScene } from '../../src/shared/whiteboard-scene.js';

let directory: string;
let path: string;
let repository: SqliteArtifactRepository;
const time = '2026-11-21T00:00:00.000Z';

function fixture(elements: unknown) {
  const content = initialWhiteboard(elements);

  return createState(
    {
      id: 'board',
      type: 'whiteboard',
      title: 'Inc',
      createdAt: time,
      updatedAt: time,
      revision: 0,
      pinned: false,
    },
    content,
    LOCAL_ACTOR,
    'Create',
    content.elements.map(({ id }) => id),
  );
}

function current() {
  return repository.readState<WhiteboardContent, unknown, unknown>();
}

function maintainOnce() {
  repository.database.exec('BEGIN IMMEDIATE');
  repository.maintainStorage();
  repository.database.exec('COMMIT');
}

function maintainAll() {
  for (let batch = 0; repository.needsMaintenance; batch++) {
    expect(batch).toBeLessThan(30);
    maintainOnce();
  }
}

function measureHistoryWriteBatches() {
  const implementation = SqliteIncrementalHistory.prototype.maintain;
  const batches: { phase: unknown; writes: number }[] = [];
  vi.spyOn(SqliteIncrementalHistory.prototype, 'maintain').mockImplementation(function (
    this: SqliteIncrementalHistory,
    obsolete,
  ) {
    const database = repository.database;
    const changes = database.prepare('SELECT total_changes() AS count');
    const phase = database
      .prepare("SELECT json_extract(value,'$.phase') AS phase FROM storage_meta WHERE key=?")
      .get(CHECKPOINT_WORK_KEY)?.phase;
    const previous = Number(changes.get()?.count);
    implementation.call(this, obsolete);
    const writes = Number(changes.get()?.count) - previous;
    expect(writes).toBeLessThanOrEqual(128);
    batches.push({ phase, writes });
  });

  return batches;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-incremental-history-'));
  path = join(directory, 'artifact.sqlite');
  repository = new SqliteArtifactRepository(path, true);
});

afterEach(async () => {
  vi.restoreAllMocks();
  repository.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) {
    throw new Error('Unexpected incremental history test directory');
  }

  await rm(directory, { recursive: true, force: true });
});

it('reconstructs exactly the newest 200 revisions after background anchoring and reopening', () => {
  const first = fixture([
    { id: 'a', type: 'text', text: 'Alpha' },
    { id: 'b', type: 'text', text: 'Bravo' },
    { id: 'c', type: 'text', text: 'Charlie' },
  ]);
  repository.writeState(first);
  const expected = new Map([[first.artifact.revision, first.content]]);
  const original = structuredClone(first.content.elements[0]!);

  for (let sequence = 1; sequence <= 225; sequence++) {
    const state = current();
    const elements = state.content.elements
      .filter((item) => sequence % 11 !== 1 || item.id !== original.id)
      .map((item) => (item.id === 'b' ? { ...item, text: String(sequence) } : item));

    if (sequence % 11 === 2) {
      elements.unshift({ ...original, text: 'Replacement ' + String(sequence) });
    }
    if (sequence % 7 === 0) {
      elements.unshift(elements.pop()!);
    }

    state.content = { ...state.content, orderVersion: sequence, elements };
    makeHistory(state, LOCAL_ACTOR, 'Update', ['a', 'b']);
    repository.writeState(state);
    expected.set(state.artifact.revision, state.content);
    if (sequence % 20 === 0) {
      maintainAll();
    }
  }

  maintainAll();
  repository.close();
  repository = new SqliteArtifactRepository(path);
  const reopened = current();
  expect(reopened.history).toHaveLength(200);
  expect(reopened.history[0]?.entry.revision).toBe(26);
  for (const saved of reopened.history) {
    expect(saved.content).toEqual(expected.get(saved.entry.revision));
  }
  expect(reopened.content).toEqual(expected.get(reopened.artifact.revision));
  expect(repository.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  const schema = repository.database.prepare('SELECT name FROM sqlite_schema').all();
  expect(schema).not.toContainEqual({ name: 'content_payloads' });
});

it('resumes a hidden checkpoint after a failed batch and allows saves between batches', () => {
  const first = fixture(
    Array.from({ length: 260 }, (_, index) => ({
      id: 'unit-' + String(index).padStart(3, '0'),
      type: 'text',
      text: 'Unit ' + String(index),
    })),
  );
  repository.writeState(first);
  const target = current();
  target.artifact.revision = 19;
  target.content.elements.reverse();
  makeHistory(target, LOCAL_ACTOR, 'Reorder', ['$order']);
  repository.writeState(target);

  const db = repository.database;
  maintainOnce();
  maintainOnce();
  db.exec(`
    CREATE TEMP TRIGGER reject_checkpoint_unit BEFORE INSERT ON history_checkpoint_units
    WHEN new.revision=20 AND new.id='unit-127'
    BEGIN SELECT RAISE(ABORT, 'Checkpoint unit refused'); END
  `);
  const count = db.prepare(
    'SELECT count(*) AS total FROM history_checkpoint_units WHERE revision=20',
  );
  const work = db.prepare('SELECT value FROM storage_meta WHERE key=?');
  const cursor = work.get(CHECKPOINT_WORK_KEY);
  expect(count.get()?.total).toBe(127);
  expect(current().history.at(-1)?.content).toEqual(target.content);

  db.exec('BEGIN IMMEDIATE');
  db.prepare('UPDATE storage_meta SET value=? WHERE key=?').run('{}', CHECKPOINT_WORK_KEY);
  expect(() => current().history.at(-1)?.content).toThrow(
    expect.objectContaining({ code: 'CORRUPT_ARTIFACT' }),
  );
  db.exec('ROLLBACK');

  db.exec('BEGIN IMMEDIATE');
  expect(() => repository.maintainStorage()).toThrow('Checkpoint unit refused');
  db.exec('ROLLBACK');
  expect(count.get()?.total).toBe(127);
  expect(work.get(CHECKPOINT_WORK_KEY)).toEqual(cursor);
  expect(current().history.at(-1)?.content).toEqual(target.content);

  repository.close();
  repository = new SqliteArtifactRepository(path, true);
  const foreground = current();
  foreground.history.shift();
  foreground.content.elements[0] = {
    ...foreground.content.elements[0]!,
    text: 'Saved during checkpoint preparation',
  };
  makeHistory(foreground, LOCAL_ACTOR, 'Edit before checkpoint publication', ['unit-259']);
  repository.writeState(foreground);
  expect(
    repository.database.prepare('SELECT revision FROM history_checkpoints WHERE revision=0').get(),
  ).toBeDefined();
  expect(current().history.at(-2)?.content).toEqual(target.content);
  expect(current().content).toEqual(foreground.content);

  const batches = measureHistoryWriteBatches();
  maintainAll();
  expect(batches.filter(({ phase, writes }) => phase === 'replay' && writes === 128)).toHaveLength(
    2,
  );
  expect(
    repository.database
      .prepare('SELECT count(*) AS total FROM history_checkpoint_units WHERE revision=20')
      .get()?.total,
  ).toBe(260);
  expect(
    repository.database
      .prepare('SELECT value FROM storage_meta WHERE key=?')
      .get(CHECKPOINT_WORK_KEY),
  ).toBeUndefined();
  expect(current().history.at(-2)?.content).toEqual(target.content);
  expect(current().history.at(-1)?.content).toEqual(foreground.content);
  expect(repository.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it('checks and retires old checkpoint references while skipping hashes in the retained anchor', () => {
  const first = fixture([
    { id: 'keep', type: 'text', text: 'Retained anchor' },
    { id: 'expire', type: 'text', text: 'Expired only' },
    { id: 'return', type: 'text', text: 'Later delta' },
  ]);
  repository.writeState(first);
  const target = current();
  target.artifact.revision = 19;
  target.content.elements = target.content.elements.slice(0, 1);
  makeHistory(target, LOCAL_ACTOR, 'Remove', ['expire', 'return']);
  repository.writeState(target);
  maintainAll();

  const retained = current();
  retained.history.shift();
  retained.content.elements.push(first.content.elements[2]!);
  makeHistory(retained, LOCAL_ACTOR, 'Return', ['return']);
  repository.writeState(retained);
  const db = repository.database;
  const old = db.prepare(
    'SELECT payload_hash FROM history_checkpoint_units WHERE revision=0 AND id=?',
  );
  const sharedHash = old.get('keep')?.payload_hash;
  const expiredHash = old.get('expire')?.payload_hash;
  const returnedHash = old.get('return')?.payload_hash;

  db.exec('BEGIN IMMEDIATE');
  db.exec("UPDATE history_checkpoint_units SET ordinal='invalid' WHERE revision=0 AND id='keep'");
  repository.maintainStorage();
  expect(() => repository.maintainStorage()).toThrow(
    expect.objectContaining({ code: 'CORRUPT_ARTIFACT' }),
  );
  db.exec('ROLLBACK');

  const probed: unknown[] = [];
  const prepare = db.prepare.bind(db);
  vi.spyOn(db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql);
    if (sql.includes('EXISTS(SELECT 1 FROM history_checkpoint_units WHERE payload_hash=?1)')) {
      const get = statement.get.bind(statement);
      vi.spyOn(statement, 'get').mockImplementation((...bindings) => {
        probed.push(bindings[0]);
        return get(...bindings);
      });
    }

    return statement;
  });

  maintainAll();
  expect(probed).not.toContain(sharedHash);
  expect(probed).toContain(expiredHash);
  expect(probed).toContain(returnedHash);
  expect(db.prepare('SELECT revision FROM history_checkpoints').all()).toEqual([{ revision: 20 }]);
  const lookup = db.prepare('SELECT hash FROM payload_blobs WHERE hash=?');
  expect(lookup.get(expiredHash ?? null)).toBeUndefined();
  expect(lookup.get(sharedHash ?? null)).toBeDefined();
  expect(lookup.get(returnedHash ?? null)).toBeDefined();
  expect(current().history.map(({ content }) => content)).toEqual([
    target.content,
    retained.content,
  ]);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it('clears the pending checkpoint when complete history is replaced', () => {
  const first = fixture([
    { id: 'before', type: 'text', text: 'Old object' },
    { id: 'stable', type: 'text', text: 'Unchanged until replacement' },
  ]);
  repository.writeState(first);
  const target = current();
  target.artifact.revision = 19;
  target.content.elements[0] = { ...target.content.elements[0]!, text: 'Partially copied' };
  makeHistory(target, LOCAL_ACTOR, 'New checkpoint needed', ['before']);
  repository.writeState(target);
  maintainOnce();
  maintainOnce();
  const db = repository.database;
  const work = db.prepare('SELECT value FROM storage_meta WHERE key=?');
  expect(work.get(CHECKPOINT_WORK_KEY)).toBeDefined();

  const replacement = fixture([{ id: 'replacement', type: 'text', text: 'Replacement content' }]);
  repository.writeState(replacement);
  expect(work.get(CHECKPOINT_WORK_KEY)).toBeUndefined();
  expect(db.prepare('SELECT revision FROM history_checkpoints').all()).toEqual([{ revision: 0 }]);
  maintainAll();
  expect(current().history.map(({ content }) => content)).toEqual([replacement.content]);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

function documentWithBlocks(): Partial<BoardElement> {
  const blocks = Array.from({ length: 80 }, (_, index) => ({
    id: 'row-' + String(index),
    type: 'paragraph' as const,
    props: {},
    content: [{ type: 'text', text: 'A document block ' + String(index), styles: {} }],
  }));

  return { id: 'document', type: 'document', document: { schemaVersion: 1, blocks } };
}

function updateFirstBlock(state: ArtifactState<WhiteboardContent>, index: number): void {
  const [unit] = state.content.elements;
  const document = unit!.document!;
  document.blocks[index] = { ...document.blocks[index]!, content: 'Changed once' };
  makeHistory(state, LOCAL_ACTOR, 'One block', ['document']);
}

it('reuses unchanged block payloads and touches one historical unit for a block edit', () => {
  repository.writeState(fixture([documentWithBlocks()]));
  const db = repository.database;
  const payloads = db.prepare('SELECT count(*) AS total FROM payload_blobs');
  const before = Number(payloads.get()?.total);
  const state = current();
  updateFirstBlock(state, 35);
  repository.writeState(state);

  expect(Number(payloads.get()?.total) - before).toBe(3);
  expect(db.prepare('SELECT id FROM history_unit_changes').all()).toEqual([{ id: 'document' }]);
  expect(db.prepare('SELECT revision FROM history_checkpoints').all()).toEqual([{ revision: 0 }]);
  expect(current().content).toEqual(state.content);
  expect(current().history[0]?.content.elements[0]?.document?.blocks[35]?.content).not.toBe(
    'Changed once',
  );
});

it('opens a current lightweight scene without reading the selected board bodies', () => {
  const state = fixture([
    { id: 'large', type: 'html', html: 'a'.repeat(600_000) },
    { id: 'caption', type: 'text', text: 'Small' },
  ]);
  repository.writeState(state);
  repository.close();
  repository = new SqliteArtifactRepository(path, true);
  const loaded: unknown[] = [];
  const prepare = DatabaseSync.prototype.prepare;
  vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    const statement = prepare.call(this, sql);
    if (sql === 'SELECT json FROM payload_blobs WHERE hash=?') {
      const get = statement.get.bind(statement);
      vi.spyOn(statement, 'get').mockImplementation((...bindings) => {
        loaded.push(bindings[0]);
        return get(...bindings);
      });
    }

    return statement;
  });
  const scene = repository.readBoardScene(1_000_000);
  expect(scene).toEqual(whiteboardScene({ artifact: state.artifact, ...state.content }));
  const root = repository.database
    .prepare("SELECT value FROM storage_meta WHERE key='content'")
    .get();
  expect(loaded).toEqual([root?.value]);
  expect(repository.readBoardScene(1024)).toBeUndefined();
  repository.database.exec("UPDATE current_units SET scene_hash='' WHERE id='large'");
  expect(repository.readBoardScene()).toBeUndefined();
});

it('reuses exact verified references in the opt-in transaction and still persists a new unit at the same version', () => {
  const first = fixture([
    { id: 'touch', type: 'text', text: 'Before' },
    { id: 'keep', type: 'html', html: 'a'.repeat(600_000), state: { visible: true } },
  ]);
  repository.writeState(first);
  repository.close();
  repository = new SqliteArtifactRepository(path, true);
  const ordinary = repository.readState<WhiteboardContent, unknown, unknown>({
    shareContentUnits: true,
  });
  expect(Object.isFrozen(ordinary.content.elements[1])).toBe(false);
  const db = repository.database;
  const select = db.prepare('SELECT payload_hash FROM current_units WHERE id=?');
  const sameHash = select.get('keep')?.payload_hash;
  const oldHash = select.get('touch')?.payload_hash;
  const searched: unknown[] = [];
  const prepare = db.prepare.bind(db);
  vi.spyOn(db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql);
    if (sql === 'SELECT 1 AS present FROM payload_blobs WHERE hash=?') {
      const get = statement.get.bind(statement);
      vi.spyOn(statement, 'get').mockImplementation((...bindings) => {
        searched.push(bindings[0]);
        return get(...bindings);
      });
    }

    return statement;
  });

  db.exec('BEGIN IMMEDIATE');
  const currentShared = repository.readState<WhiteboardContent, unknown, unknown>({
    shareContentUnits: true,
  });
  const [changed, stable] = currentShared.content.elements;
  expect(Object.isFrozen(currentShared.content.elements)).toBe(false);
  expect(Object.isFrozen(changed)).toBe(true);
  expect(Object.isFrozen(stable?.state)).toBe(true);
  currentShared.content.elements[0] = { ...changed!, text: 'After' };
  makeHistory(currentShared, LOCAL_ACTOR, 'Edit one unit', ['touch'], {}, (content) => ({
    ...content,
    elements: [...content.elements],
  }));
  repository.writeState(currentShared);
  db.exec('COMMIT');

  const newHash = select.get('touch')?.payload_hash;
  expect(newHash).not.toBe(oldHash);
  expect(searched).toContain(newHash);
  expect(searched).not.toContain(sameHash);
  expect(select.get('keep')?.payload_hash).toBe(sameHash);
  const after = current();
  expect(after.content.elements[0]).toMatchObject({ text: 'After', version: changed?.version });
  expect(after.history[0]?.content.elements[0]?.text).toBe('Before');
  expect(after.history[1]?.content.elements[0]?.text).toBe('After');
  expect(Object.isFrozen(after.content.elements[1])).toBe(false);
});

it('opens an explicitly created v1 database and projects just its current state for migration', () => {
  repository.close();
  path = join(directory, 'legacy.sqlite');
  repository = new SqliteArtifactRepository(path, true, 1);
  const source = fixture([{ id: 'a', type: 'text', text: 'Legacy' }]);
  source.guestNames = { guest: { name: 'Guest', key: 'guest' } };
  repository.writeState(source);
  repository.close();
  repository = new SqliteArtifactRepository(path);
  expect(repository.storageVersion).toBe(1);
  expect(repository.readState({ currentOnly: true })).toEqual({ ...source, history: [] });
  repository.database.exec('BEGIN');
  const candidate = repository.readState<WhiteboardContent, unknown, unknown>({
    currentOnly: true,
    shareContentUnits: true,
  });
  expect(Object.isFrozen(candidate.content.elements[0])).toBe(false);
  repository.database.exec('COMMIT');
  expect(repository.readBoardScene()).toBeUndefined();
});
