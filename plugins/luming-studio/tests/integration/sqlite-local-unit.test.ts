import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LOCAL_ACTOR } from '../../src/contracts/studio.js';
import type { LocalUnitMutationRequest } from '../../src/core/ports/studio-repository.js';
import {
  initialWhiteboard,
  whiteboardAdapter,
  type WhiteboardContent,
} from '../../src/core/products/whiteboard.js';
import {
  applyMutation,
  createState,
  initializeVersionClocks,
  makeHistory,
} from '../../src/core/shared/history.js';
import { SqliteArtifactRepository } from '../../src/infrastructure/sqlite-artifact.js';
import { whiteboardScene } from '../../src/shared/whiteboard-scene.js';

const date = '2026-11-22T00:00:00.000Z';
const target = 'target';
let directory: string;
let file: string;
let repository: SqliteArtifactRepository;

function fixture(extra: unknown[] = []) {
  const content = initialWhiteboard([{ id: target, type: 'text', text: 'Before' }, ...extra]);
  const state = createState(
    {
      id: 'local',
      type: 'whiteboard',
      title: 'Local',
      revision: 0,
      pinned: false,
      createdAt: date,
      updatedAt: date,
    },
    content,
    LOCAL_ACTOR,
    'Create',
    content.elements.map(({ id }) => id),
  );
  initializeVersionClocks(state, whiteboardAdapter);

  return state;
}

function plan(
  operationId: string,
  changes: { text?: string; x?: number; y?: number },
  maximumBytes = 8 * 1024 * 1024,
) {
  const state = repository.readState<WhiteboardContent, unknown, unknown>();
  const request: LocalUnitMutationRequest = {
    id: target,
    operationId,
    maximumBytes,
    maximumElements: 2000,
  };
  const result = applyMutation(
    state,
    {
      operationId,
      expectedRevision: state.artifact.revision,
      operations: [{ op: 'update', id: target, changes }],
    },
    LOCAL_ACTOR,
    whiteboardAdapter,
  );
  const write = {
    artifact: state.artifact,
    entry: result.historyEntry,
    unit: state.content.elements[0]!,
    clock: state.unitClocks![target]!,
    operation: state.operations.at(-1)!,
  };

  return { request, state: structuredClone(state), write };
}

function persist({ request, write }: ReturnType<typeof plan>) {
  const db = repository.database;
  db.exec('BEGIN IMMEDIATE');
  const basis = repository.readLocalUnitMutation(request);
  expect(basis).toBeDefined();
  expect(repository.writeLocalUnitMutation(basis!, write)).toBe(true);
  db.exec('COMMIT');
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-local-unit-'));
  file = join(directory, 'artifact.sqlite');
  repository = new SqliteArtifactRepository(file, true);
});

afterEach(async () => {
  vi.restoreAllMocks();
  repository.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) {
    throw new Error('Unexpected local unit test directory');
  }

  await rm(directory, { recursive: true, force: true });
});

it('updates the one selected payload, history delta, clock and receipt without loading rich neighbors', () => {
  repository.writeState(fixture([{ id: 'rich', type: 'html', html: 'a'.repeat(700_000) }]));
  const next = plan('text-change', { text: 'After 中文 😺' });
  repository.close();
  repository = new SqliteArtifactRepository(file, true);
  const db = repository.database;
  const select = db.prepare('SELECT payload_hash FROM current_units WHERE id=?');
  const richHash = select.get('rich')?.payload_hash;
  const oldHash = select.get(target)?.payload_hash;
  const loaded: unknown[] = [];
  const prepare = db.prepare.bind(db);
  const spy = vi.spyOn(db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql);
    if (sql === 'SELECT json FROM payload_blobs WHERE hash=?') {
      const get = statement.get.bind(statement);
      vi.spyOn(statement, 'get').mockImplementation((...bindings) => {
        loaded.push(bindings[0]);
        return get(...bindings);
      });
    }

    return statement;
  });

  persist(next);
  expect(loaded).toContain(oldHash);
  expect(loaded).not.toContain(richHash);
  expect(spy.mock.calls.map(([sql]) => sql)).not.toContain(
    'SELECT id,ordinal,payload_hash FROM current_units ORDER BY ordinal',
  );
  spy.mockRestore();
  expect(select.get('rich')?.payload_hash).toBe(richHash);
  expect(db.prepare('SELECT id FROM history_unit_changes WHERE revision=1').all()).toEqual([
    { id: target },
  ]);
  expect(repository.readState()).toEqual(next.state);
  expect(repository.readBoardScene()).toEqual(
    whiteboardScene({ artifact: next.state.artifact, ...next.state.content }),
  );
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

  db.exec('BEGIN IMMEDIATE');
  expect(repository.readLocalUnitMutation(next.request)).toBeUndefined();
  db.exec('ROLLBACK');
  const moved = plan('position-change', { x: 123, y: -96 });
  persist(moved);
  expect(repository.readState()).toEqual(moved.state);
});

it('rejects growth beyond the exact multibyte board budget without any writes', () => {
  const original = fixture([{ id: 'rich', type: 'html', html: '文\n'.repeat(5_000) }]);
  repository.writeState(original);
  const originalBytes = Buffer.byteLength(JSON.stringify(original.content));
  const rejected = plan('too-large', { text: '内容 😺 \n"'.repeat(100) }, originalBytes);
  const db = repository.database;
  const meter = db.prepare('SELECT total_changes() AS count');
  const before = meter.get();
  db.exec('BEGIN IMMEDIATE');
  const basis = repository.readLocalUnitMutation(rejected.request);
  expect(basis).toBeDefined();
  expect(repository.writeLocalUnitMutation(basis!, rejected.write)).toBe(false);
  expect(meter.get()).toEqual(before);
  db.exec('COMMIT');
  expect(repository.readState()).toEqual(original);

  const maximumBytes = Buffer.byteLength(JSON.stringify(rejected.state.content));
  persist({ ...rejected, request: { ...rejected.request, maximumBytes } });
  expect(repository.readState()).toEqual(rejected.state);
});

it('preserves unavailable receipts and prunes receipt and history windows as the full mutation does', () => {
  const original = fixture();
  original.operations = Array.from({ length: 301 }, (_, index) => ({
    id: 'unavailable-' + String(index),
    fingerprint: 'unknown',
    historyId: 'missing',
    receiptUnavailable: true,
  }));

  for (let revision = 1; revision < 200; revision++) {
    const entry = makeHistory(original, LOCAL_ACTOR, 'Fixture edit', [target]);
    original.operations.push({
      id: 'old-' + String(revision),
      fingerprint: 'old',
      historyId: entry.id,
    });
  }
  repository.writeState(original);
  const first = plan('window-200', { text: 'new' });
  persist(first);
  expect(repository.readState()).toEqual(first.state);
  expect(first.state.operations[0]?.id).toBe('unavailable-1');
  const second = plan('window-201', { text: 'next' });
  persist(second);
  expect(repository.readState()).toEqual(second.state);
  expect(second.state.history).toHaveLength(200);
  expect(second.state.history[0]?.entry.revision).toBe(2);
  expect(second.state.operations.some(({ id }) => id === 'old-1')).toBe(false);
  expect(repository.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it('requires an active transaction and proof, and defers movement involving locked geometry', () => {
  repository.writeState(
    fixture([{ id: 'locked', type: 'arrow', from: target, to: [50, 50], locked: true }]),
  );
  const next = plan('safe-text', { text: 'New' });
  expect(repository.readLocalUnitMutation(next.request)).toBeUndefined();
  const db = repository.database;
  const invalidate = db.prepare(
    "UPDATE storage_meta SET value='unknown' WHERE key='local_unit_budget'",
  );
  db.exec('BEGIN IMMEDIATE');
  invalidate.run();
  expect(repository.readLocalUnitMutation(next.request)).toBeUndefined();
  db.exec('ROLLBACK');

  db.exec('BEGIN IMMEDIATE');
  const basis = repository.readLocalUnitMutation(next.request);
  expect(basis?.hasLockedArrow).toBe(true);
  expect(
    repository.writeLocalUnitMutation(basis!, {
      ...next.write,
      unit: { ...next.write.unit, x: 55 },
    }),
  ).toBe(false);
  expect(repository.writeLocalUnitMutation(basis!, next.write)).toBe(true);
  db.exec('COMMIT');
  expect(repository.readState()).toEqual(next.state);
});

it('rolls back the unit, version and clock together when its operation receipt cannot be stored', () => {
  const original = fixture();
  repository.writeState(original);
  const next = plan('retry', { text: 'Retry me' });
  const db = repository.database;
  db.exec(`
    CREATE TEMP TRIGGER reject_local_receipt BEFORE INSERT ON state_records
    WHEN NEW.collection='operations'
    BEGIN SELECT RAISE(ABORT, 'Operation storage refused'); END
  `);
  db.exec('BEGIN IMMEDIATE');
  const basis = repository.readLocalUnitMutation(next.request);
  expect(basis).toBeDefined();
  expect(() => repository.writeLocalUnitMutation(basis!, next.write)).toThrow(
    'Operation storage refused',
  );
  db.exec('ROLLBACK');
  expect(repository.readState()).toEqual(original);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

  db.exec('DROP TRIGGER reject_local_receipt');
  persist(next);
  expect(repository.readState()).toEqual(next.state);
});
