import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  LOCAL_ACTOR,
  type Actor,
  type BoardElement,
  type Operation,
} from '../src/contracts/studio.js';
import {
  initialWhiteboard,
  whiteboardAdapter,
  type WhiteboardState,
} from '../src/core/products/whiteboard.js';
import {
  applyMutation,
  createState,
  initializeVersionClocks,
  makeHistory,
} from '../src/core/shared/history.js';
import { mergeJson } from '../src/core/shared/safe-merge.js';
import { ArtifactStore } from '../src/core/shared/store.js';
import { StudioService } from '../src/core/service.js';

const colleague: Actor = { id: 'colleague', name: '另一位编辑', role: 'editor', kind: 'human' };

async function createFixtureDirectory(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) {
    throw Error('Unexpected directory');
  }

  return directory;
}

function state(
  elements: Partial<BoardElement>[] = [{ id: 'a', type: 'text', text: 'one\ntwo\nthree' }],
): WhiteboardState {
  const content = initialWhiteboard(elements);
  const now = new Date().toISOString();
  const result = createState(
    {
      id: randomUUID(),
      type: 'whiteboard',
      title: 'test',
      revision: 0,
      createdAt: now,
      updatedAt: now,
      pinned: false,
    },
    content,
    LOCAL_ACTOR,
    'create',
    content.elements.map((element) => element.id),
  ) as WhiteboardState;
  initializeVersionClocks(result, whiteboardAdapter);

  return result;
}

function apply(
  target: WhiteboardState,
  operations: Operation[],
  extra: Record<string, unknown> = {},
  actor = LOCAL_ACTOR,
) {
  return applyMutation(
    target,
    { operationId: randomUUID(), operations, expectedRevision: target.artifact.revision, ...extra },
    actor,
    whiteboardAdapter,
  );
}

function stale(
  target: WhiteboardState,
  changes: Partial<BoardElement>,
  version = 1,
  extra: Record<string, unknown> = {},
) {
  return apply(target, [{ op: 'update', id: 'a', changes }], {
    expectedRevision: 0,
    expectedVersions: { a: version },
    merge: 'safe',
    ...extra,
  });
}

it('keeps an embedded state retry tied to the source revision that created it', () => {
  const original = { id: 'a', type: 'html' as const, html: '<p>original</p>', state: null };
  const moved = state([original]);
  apply(moved, [{ op: 'update', id: 'a', changes: { x: 30 } }], {}, colleague);
  stale(moved, { state: { count: 1 } });
  expect(moved.content.elements[0]).toMatchObject({ x: 30, state: { count: 1 } });

  const replaced = state([original]);
  apply(
    replaced,
    [{ op: 'update', id: 'a', changes: { html: '<p>replacement</p>' } }],
    {},
    colleague,
  );
  const committed = structuredClone(replaced);
  expect(() => stale(replaced, { state: { count: 1 } })).toThrow(/HTML 源码已有变化/);
  expect(replaced).toEqual(committed);
});

describe('anchored section insertion', () => {
  const wrap: Operation = {
    op: 'add',
    element: { id: 'new-section', type: 'container', x: 40, y: 40, w: 720, h: 320 },
    data: { beforeId: 'a' },
  };
  it('layers the section between the enclosing frame and existing objects, including after undo and redo', () => {
    const s = state([
      { id: 'outer', type: 'container', locked: true, w: 900, h: 440 },
      { id: 'a', type: 'text', x: 60, y: 80, locked: true },
      { id: 'b', type: 'shape', x: 360, y: 90 },
    ]);
    const original = structuredClone(s.content.elements);
    const order = () => s.content.elements.map((element) => element.id);
    const added = apply(s, [wrap]);
    expect(order()).toEqual(['outer', 'new-section', 'a', 'b']);
    expect(added.historyEntry.changedIds).toEqual(['new-section']);
    expect(s.content.elements.filter((element) => element.id !== 'new-section')).toEqual(original);
    const undone = apply(s, [
      { op: 'restore', versionId: added.historyEntry.id, data: { mode: 'undo' } },
    ]);
    expect(s.content.elements).toEqual(original);
    apply(s, [{ op: 'restore', versionId: undone.historyEntry.id, data: { mode: 'undo' } }]);
    expect(order()).toEqual(['outer', 'new-section', 'a', 'b']);
    expect(s.content.elements.filter((element) => element.id !== 'new-section')).toEqual(original);
  });
  it('rejects moved selections, missing anchors and unsupported shapes without creating objects', () => {
    const s = state();
    apply(s, [{ op: 'update', id: 'a', changes: { x: 120 } }], {}, colleague);
    const current = structuredClone(s);
    expect(() =>
      apply(s, [wrap], { expectedRevision: 0, expectedVersions: { $order: 0 } }),
    ).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    expect(() => apply(s, [{ ...wrap, data: { beforeId: 'gone' } }])).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    expect(() => apply(s, [{ ...wrap, element: { ...wrap.element, type: 'shape' } }])).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(s).toEqual(current);
  });
});

describe('safe JSON merge', () => {
  it('merges only independent fields and non-overlapping lines', () => {
    expect(
      mergeJson({ x: 0, text: 'a\nb\nc' }, { x: 1, text: 'A\nb\nc' }, { x: 0, text: 'a\nb\nC' }),
    ).toEqual({ result: { x: 1, text: 'A\nb\nC' }, conflicts: [] });
    expect(mergeJson({ text: 'abc' }, { text: 'Abc' }, { text: 'abC' }).conflicts).toEqual([
      'text@1',
    ]);
    expect(mergeJson({ text: 'a\nb' }, { text: 'new\na\nb' }, { text: 'a\nb\nend' })).toEqual({
      result: { text: 'new\na\nb\nend' },
      conflicts: [],
    });
  });
  it('rejects scalar/array/structure conflicts and preserves the current result', () => {
    expect(mergeJson({ x: 0 }, { x: 1 }, { x: 2 })).toEqual({ result: { x: 2 }, conflicts: ['x'] });
    expect(mergeJson({ a: [0, 0] }, { a: [1, 0] }, { a: [0, 2] }).conflicts).toEqual(['a']);
    expect(mergeJson({ row: { a: 'A' } }, {}, { row: { a: 'B' } }).conflicts).toEqual(['row']);
  });
  it('fails closed when text diff work exceeds its bound', () => {
    expect(mergeJson('a\n'.repeat(600), 'b\n'.repeat(600), 'c\n'.repeat(600)).conflicts).toEqual([
      '.',
    ]);
  });
});

describe('trusted-base content transactions', () => {
  it('keeps old calls strict while safe calls preserve unrelated edits and remain idempotent', () => {
    const s = state();
    apply(s, [{ op: 'update', id: 'a', changes: { x: 90 } }], {}, colleague);
    expect(() => stale(s, { text: 'changed' }, 1, { merge: undefined })).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
    const operationId = randomUUID();
    const first = stale(s, { text: 'changed' }, 1, { operationId });
    expect(first.snapshot.content.elements[0]).toMatchObject({
      x: 90,
      text: 'changed',
      version: 3,
    });
    const second = stale(s, { text: 'changed' }, 1, { operationId });
    expect(second.snapshot).toEqual(first.snapshot);
    expect(s.history).toHaveLength(3);
    expect(() => stale(s, { text: 'different' }, 1, { operationId })).toThrow(
      expect.objectContaining({ code: 'OPERATION_REUSED' }),
    );
  });
  it('merges disjoint text lines but returns bounded base/local/current on a true conflict', () => {
    const s = state();
    apply(s, [{ op: 'update', id: 'a', changes: { text: 'one\ntwo\nTHREE' } }], {}, colleague);
    expect(stale(s, { text: 'ONE\ntwo\nthree' }).snapshot.content.elements[0]!.text).toBe(
      'ONE\ntwo\nTHREE',
    );
    const before = structuredClone(s);
    expect(() => stale(s, { text: 'other\ntwo\nthree' })).toThrow(
      expect.objectContaining({
        code: 'CONFLICT',
        details: expect.objectContaining({
          elementId: 'a',
          currentVersion: 3,
          paths: ['text@1'],
          base: expect.any(Object),
          local: expect.any(Object),
          current: expect.any(Object),
        }),
      }),
    );
    expect(s).toEqual(before);
    const large = state([{ id: 'a', type: 'html', html: 'a'.repeat(80_000) }]);
    apply(large, [{ op: 'update', id: 'a', changes: { html: 'b'.repeat(80_000) } }]);
    try {
      stale(large, { html: 'c'.repeat(80_000) });
      throw Error('expected conflict');
    } catch (error) {
      const details = (error as { details: unknown }).details;
      expect(JSON.stringify(details).length).toBeLessThan(14_000);
      expect(details).toMatchObject({ truncated: true });
    }
  });
  it('rejects missing/pruned bases, structural type changes and non-update replay', () => {
    const s = state();
    apply(s, [{ op: 'update', id: 'a', changes: { x: 10 } }]);
    expect(() => stale(s, { type: 'shape' })).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
    expect(() =>
      apply(s, [{ op: 'delete', id: 'a' }], { expectedVersions: { a: 1 }, merge: 'safe' }),
    ).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    s.history.splice(0, 1);
    expect(() => stale(s, { text: 'local' })).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
  });
  it('rejects every partial mutation on conflict or validation failure', () => {
    const s = state([
      { id: 'a', type: 'text', text: 'old' },
      { id: 'b', type: 'text', text: 'B' },
    ]);
    apply(s, [{ op: 'update', id: 'a', changes: { text: 'remote' } }], {}, colleague);
    const before = structuredClone(s);
    expect(() =>
      apply(
        s,
        [
          { op: 'update', id: 'b', changes: { text: 'partial' } },
          { op: 'update', id: 'a', changes: { text: 'local' } },
        ],
        { expectedRevision: 0, expectedVersions: { a: 1, b: 1 }, merge: 'safe' },
      ),
    ).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    expect(s).toEqual(before);
    expect(() =>
      apply(s, [
        { op: 'add', element: { id: 'c', type: 'text' } },
        { op: 'update', id: 'missing', changes: { text: 'bad' } },
      ]),
    ).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(s).toEqual(before);
  });
  it('preserves explicit locks and never permits stale unlock plus move', () => {
    const s = state([{ id: 'a', type: 'text', text: 'old', locked: true }]);
    apply(s, [{ op: 'update', id: 'a', changes: { text: 'remote' } }], {}, colleague);
    expect(() => stale(s, { x: 100 })).toThrow(expect.objectContaining({ code: 'LOCKED' }));
    expect(() => stale(s, { locked: false, x: 100 })).toThrow(
      expect.objectContaining({ code: 'LOCKED' }),
    );
    expect(s.content.elements[0]).toMatchObject({ locked: true, x: 0 });
  });
  it('serializes safe updates from separate stores without weakening strict CAS', async () => {
    const directory = await createFixtureDirectory('studio-safe-stores-');
    try {
      const s = state();
      const one = new ArtifactStore(directory);
      const two = new ArtifactStore(directory);
      await one.write(s);
      const results = await Promise.all(
        [one, two].map((store, index) =>
          store.transaction(s.artifact.id, (loaded) =>
            stale(
              loaded as WhiteboardState,
              index === 0 ? { x: 42 } : { text: 'from another editor' },
            ),
          ),
        ),
      );
      expect(results).toHaveLength(2);
      const final = (await one.read(s.artifact.id)) as WhiteboardState;
      expect(final.content.elements[0]).toMatchObject({
        x: 42,
        text: 'from another editor',
        version: 3,
      });
      expect(final.artifact.revision).toBe(2);
      await expect(
        two.transaction(s.artifact.id, (loaded) =>
          stale(loaded as WhiteboardState, { x: 99 }, 1, { merge: undefined }),
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await one.read(s.artifact.id)).artifact.revision).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('passes safe mode through the real service and persists clock state for another instance', async () => {
    const directory = await createFixtureDirectory('studio-safe-service-');
    const service = new StudioService({ dataRoot: directory });
    try {
      const { board } = await service.execute('artifact_manage', {
        action: 'create',
        elements: [{ id: 'a', type: 'text', text: 'original' }],
      });
      const artifactId = board.artifact.id;
      await service.execute('artifact_apply', {
        artifactId,
        expectedVersions: { a: 1 },
        operations: [{ op: 'update', id: 'a', changes: { x: 50 } }],
      });
      const result = await service.execute('artifact_apply', {
        artifactId,
        merge: 'safe',
        expectedVersions: { a: 1 },
        operations: [{ op: 'update', id: 'a', changes: { text: 'safe local' } }],
      });
      expect(result.board.elements[0]).toMatchObject({ x: 50, text: 'safe local', version: 3 });
      expect((await service.store.read(artifactId)).unitClocks!.a!.version).toBe(3);
      await service.execute('artifact_apply', {
        artifactId,
        expectedVersions: { a: 3 },
        operations: [{ op: 'delete', id: 'a' }],
      });
      const other = new StudioService({ dataRoot: directory });
      try {
        const readded = await other.execute('artifact_apply', {
          artifactId,
          operations: [{ op: 'add', element: { id: 'a', type: 'text', text: 'new lifetime' } }],
        });
        expect(readded.board.elements[0]!.version).toBe(4);
        await expect(
          other.execute('artifact_apply', {
            artifactId,
            merge: 'safe',
            expectedVersions: { a: 1 },
            operations: [{ op: 'update', id: 'a', changes: { y: 50 } }],
          }),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
      } finally {
        await other.close();
      }
    } finally {
      await service.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('merges stable table cells and rejects row identity changes even with identical dimensions', () => {
    const s = state([
      {
        id: 'a',
        type: 'table',
        data: {
          rows: [
            ['A', 'B'],
            ['C', 'D'],
          ],
        },
      },
    ]);
    const original = structuredClone(s.content.elements[0]!.data!);
    apply(
      s,
      [
        {
          op: 'update',
          id: 'a',
          changes: {
            data: {
              ...original,
              rows: [
                ['AA', 'B'],
                ['C', 'D'],
              ],
            },
          },
        },
      ],
      {},
      colleague,
    );
    expect(
      stale(s, {
        data: {
          ...original,
          rows: [
            ['A', 'B'],
            ['C', 'DD'],
          ],
        },
      }).snapshot.content.elements[0]!.data!.rows,
    ).toEqual([
      ['AA', 'B'],
      ['C', 'DD'],
    ]);
    const b = state([
      {
        id: 'a',
        type: 'table',
        data: {
          rows: [
            ['A', 'B'],
            ['C', 'D'],
          ],
        },
      },
    ]);
    const data = structuredClone(b.content.elements[0]!.data!);
    apply(b, [
      {
        op: 'update',
        id: 'a',
        changes: {
          data: {
            ...data,
            rowIds: ['new-row', (data.rowIds as string[])[1]],
            rows: [
              ['N', 'B'],
              ['C', 'D'],
            ],
          },
        },
      },
    ]);
    expect(() =>
      stale(b, {
        data: {
          ...data,
          rows: [
            ['A', 'B'],
            ['C', 'local'],
          ],
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    expect(() =>
      stale(b, {
        data: {
          rows: [
            ['A', 'B'],
            ['C', 'local'],
          ],
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
  });
});

describe('persistent ABA clocks and guarded undo', () => {
  it('migrates a retained legacy ID reuse to a fresh version/source incarnation', () => {
    const s = state([{ id: 'a', type: 'html', html: '<p>same</p>' }]);
    apply(s, [{ op: 'delete', id: 'a' }]);
    apply(s, [{ op: 'add', element: { id: 'a', type: 'html', html: '<p>same</p>' } }]);
    delete s.unitClocks;
    s.content.elements[0]!.version = 1;
    s.content.elements[0]!.sourceRevision = 1;
    s.history.at(-1)!.content.elements[0]!.version = 1;
    s.history.at(-1)!.content.elements[0]!.sourceRevision = 1;
    initializeVersionClocks(s, whiteboardAdapter);
    expect(s.content.elements[0]).toMatchObject({ version: 2, sourceRevision: 2 });
    expect(s.unitClocks!.a).toEqual({ version: 2, incarnationStart: 2, sourceRevision: 2 });
    expect(() => stale(s, { x: 90 })).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
  });
  it('never reuses element/source versions after deletion, pruning, restart or historical restore', async () => {
    const directory = await createFixtureDirectory('studio-safe-clocks-');
    try {
      const s = state([{ id: 'a', type: 'html', html: '<p>one</p>' }]);
      const initial = s.history[0]!.entry.id;
      apply(s, [{ op: 'update', id: 'a', changes: { html: '<p>two</p>' } }]);
      apply(s, [{ op: 'delete', id: 'a' }]);
      for (let i = 0; i < 205; i++) {
        makeHistory(s, colleague, 'unrelated history', ['$feedback']);
      }

      expect(
        s.history.some((saved) => saved.content.elements.some((element) => element.id === 'a')),
      ).toBe(false);
      const store = new ArtifactStore(directory);
      await store.write(s);
      const reloaded = (await new ArtifactStore(directory).read(s.artifact.id)) as WhiteboardState;
      apply(reloaded, [{ op: 'add', element: { id: 'a', type: 'html', html: '<p>one</p>' } }]);
      expect(reloaded.content.elements[0]).toMatchObject({ version: 3, sourceRevision: 3 });
      expect(() => stale(reloaded, { x: 90 })).toThrow(
        expect.objectContaining({ code: 'CONFLICT' }),
      );
      const kept = reloaded.history.at(-1)!.entry.id;
      apply(reloaded, [{ op: 'delete', id: 'a' }]);
      apply(reloaded, [{ op: 'restore', versionId: kept }]);
      expect(reloaded.content.elements[0]).toMatchObject({ version: 4, sourceRevision: 4 });
      expect(() => apply(reloaded, [{ op: 'restore', versionId: initial }])).toThrow(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('undoes only changed fields while keeping unrelated same-object edits and redoes safely', () => {
    const s = state();
    const own = apply(s, [{ op: 'update', id: 'a', changes: { text: 'own' } }]);
    apply(s, [{ op: 'update', id: 'a', changes: { x: 90 } }], {}, colleague);
    const undo = apply(s, [
      { op: 'restore', versionId: own.historyEntry.id, data: { mode: 'undo' } },
    ]);
    expect(s.content.elements[0]).toMatchObject({ text: 'one\ntwo\nthree', x: 90, version: 4 });
    apply(s, [{ op: 'restore', versionId: undo.historyEntry.id, data: { mode: 'undo' } }]);
    expect(s.content.elements[0]).toMatchObject({ text: 'own', x: 90, version: 5 });
  });
  it.each(['edit', 'delete'] as const)(
    'undoes and redoes an addition after reversing the later %s of that object',
    (action) => {
      const s = state();
      const added = apply(s, [{ op: 'add', element: { id: 'b', type: 'text', text: 'new' } }]);
      const later = apply(
        s,
        action === 'edit'
          ? [{ op: 'update', id: 'b', changes: { text: 'edited' } }]
          : [{ op: 'delete', id: 'b' }],
      );
      const reverse = (versionId: string) =>
        apply(s, [{ op: 'restore', versionId, data: { mode: 'undo' } }]);
      const undoneLater = reverse(later.historyEntry.id);
      expect(undoneLater.historyEntry).toMatchObject({
        restoredFrom: later.historyEntry.id,
        restoreMode: 'undo',
      });
      expect(s.content.elements[1]).toMatchObject({ text: 'new' });
      const restoredVersion = s.content.elements[1]!.version;
      if (action === 'delete') {
        expect(() =>
          apply(s, [{ op: 'update', id: 'b', changes: { x: 20 } }], {
            expectedVersions: { b: 1 },
            merge: 'safe',
          }),
        ).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
      }

      const undoneAdd = reverse(added.historyEntry.id);
      expect(s.content.elements.map((element) => element.id)).toEqual(['a']);
      reverse(undoneAdd.historyEntry.id);
      expect(s.content.elements[1]).toMatchObject({ text: 'new' });
      expect(s.content.elements[1]!.version).toBeGreaterThan(restoredVersion);
      reverse(undoneLater.historyEntry.id);
      expect(s.content.elements.find((element) => element.id === 'b')?.text).toBe(
        action === 'edit' ? 'edited' : undefined,
      );
    },
  );
  it('requires explicit own inverse lineage to cross a restored incarnation', () => {
    for (const mode of ['normal restore', 'legacy inverse'] as const) {
      const s = state();
      const added = apply(s, [{ op: 'add', element: { id: 'b', type: 'text', text: 'new' } }]);
      const deleted = apply(s, [{ op: 'delete', id: 'b' }]);
      if (mode === 'normal restore') {
        const restored = apply(s, [{ op: 'restore', versionId: added.historyEntry.id, id: 'b' }]);
        expect(restored.historyEntry).not.toHaveProperty('restoreMode');
      } else {
        apply(s, [{ op: 'restore', versionId: deleted.historyEntry.id, data: { mode: 'undo' } }]);
        delete s.history.at(-1)!.entry.restoreMode;
      }

      const before = structuredClone(s);
      expect(() =>
        apply(s, [{ op: 'restore', versionId: added.historyEntry.id, data: { mode: 'undo' } }]),
      ).toThrow(
        expect.objectContaining({
          code: 'CONFLICT',
          details: expect.objectContaining({ elementId: 'b' }),
        }),
      );
      expect(s).toEqual(before);
    }
  });
  it('rejects undo across a collaborator replacing the same ID within one transaction', () => {
    const s = state([{ id: 'a', type: 'text', text: 'original' }]);
    const own = apply(s, [{ op: 'update', id: 'a', changes: { text: 'mine' } }]);
    apply(
      s,
      [
        { op: 'delete', id: 'a' },
        { op: 'add', element: { id: 'a', type: 'text', text: 'mine' } },
      ],
      {},
      colleague,
    );
    const deleted = apply(s, [{ op: 'delete', id: 'a' }]);
    apply(s, [{ op: 'restore', versionId: deleted.historyEntry.id, data: { mode: 'undo' } }]);
    const before = structuredClone(s);
    expect(s.content.elements[0]).toMatchObject({ id: 'a', text: 'mine' });
    expect(() =>
      apply(s, [{ op: 'restore', versionId: own.historyEntry.id, data: { mode: 'undo' } }]),
    ).toThrow(
      expect.objectContaining({
        code: 'CONFLICT',
        details: expect.objectContaining({ elementId: 'a' }),
      }),
    );
    expect(s).toEqual(before);
  });
  it('allows a stale board revision only for the same eligible undo and preserves idempotency', () => {
    const s = state([
      { id: 'a', type: 'text', text: 'first' },
      { id: 'b', type: 'text', text: 'second' },
    ]);
    const own = apply(s, [{ op: 'update', id: 'a', changes: { text: 'own' } }]);
    apply(
      s,
      [
        { op: 'update', id: 'a', changes: { x: 30 } },
        { op: 'update', id: 'b', changes: { text: 'remote' } },
      ],
      {},
      colleague,
    );
    const revision = own.historyEntry.revision;
    const undo: Operation = {
      op: 'restore',
      versionId: own.historyEntry.id,
      data: { mode: 'undo' },
    };
    const before = structuredClone(s);
    for (const invalid of [
      { operations: [undo], expectedRevision: revision - 1, code: 'CONFLICT' },
      { operations: [undo], expectedRevision: s.artifact.revision + 1, code: 'CONFLICT' },
      { operations: [undo], expectedRevision: undefined, code: 'VERSION_REQUIRED' },
      {
        operations: [{ op: 'restore', versionId: own.historyEntry.id } as Operation],
        expectedRevision: revision,
        code: 'CONFLICT',
      },
      {
        operations: [undo, { op: 'update', id: 'b', changes: { text: 'mixed' } } as Operation],
        expectedRevision: revision,
        code: 'CONFLICT',
      },
    ]) {
      expect(() =>
        apply(s, invalid.operations, { expectedRevision: invalid.expectedRevision }),
      ).toThrow(expect.objectContaining({ code: invalid.code }));
    }

    expect(() => apply(s, [undo], { expectedRevision: revision }, colleague)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
    expect(s).toEqual(before);
    const operationId = randomUUID();
    const result = apply(s, [undo], { expectedRevision: revision, operationId });
    expect(result.snapshot.content.elements).toMatchObject([
      { text: 'first', x: 30 },
      { text: 'remote' },
    ]);
    expect(apply(s, [undo], { expectedRevision: revision, operationId })).toEqual({
      ...result,
      changed: false,
    });
  });
  it('rejects a stale inverse atomically when any targeted field changed', () => {
    const s = state([
      { id: 'a', type: 'text', text: 'A' },
      { id: 'b', type: 'text', text: 'B' },
    ]);
    const own = apply(s, [
      { op: 'update', id: 'a', changes: { text: 'one' } },
      { op: 'update', id: 'b', changes: { text: 'two' } },
    ]);
    apply(s, [{ op: 'update', id: 'b', changes: { text: 'remote' } }], {}, colleague);
    const before = structuredClone(s);
    expect(() =>
      apply(s, [{ op: 'restore', versionId: own.historyEntry.id, data: { mode: 'undo' } }], {
        expectedRevision: own.historyEntry.revision,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONFLICT',
        details: expect.objectContaining({ elementId: 'b' }),
      }),
    );
    expect(s).toEqual(before);
  });
  it('refuses undo after later same-field edits or ID reincarnation', () => {
    const s = state();
    const own = apply(s, [{ op: 'update', id: 'a', changes: { text: 'own' } }]);
    apply(s, [{ op: 'update', id: 'a', changes: { text: 'later' } }], {}, colleague);
    expect(() =>
      apply(s, [{ op: 'restore', versionId: own.historyEntry.id, data: { mode: 'undo' } }]),
    ).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    apply(s, [{ op: 'delete', id: 'a' }]);
    apply(s, [{ op: 'add', element: { id: 'a', type: 'text', text: 'own' } }]);
    expect(() =>
      apply(s, [{ op: 'restore', versionId: own.historyEntry.id, data: { mode: 'undo' } }]),
    ).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
  });
  it('removes a field introduced by the undone edit without removing concurrent fields', () => {
    const s = state();
    const own = apply(s, [{ op: 'update', id: 'a', changes: { bold: true } }]);
    apply(s, [{ op: 'update', id: 'a', changes: { italic: true } }], {}, colleague);
    apply(s, [{ op: 'restore', versionId: own.historyEntry.id, data: { mode: 'undo' } }]);
    expect(s.content.elements[0]).not.toHaveProperty('bold');
    expect(s.content.elements[0]!.italic).toBe(true);
  });
  it('undoes only the changed global style fields and rejects a later same-field edit', () => {
    const s = state();
    const paper = s.content.style.paper;
    const own = apply(s, [{ op: 'style', style: { paper: '#aaaaaa' } }]);
    apply(s, [{ op: 'style', style: { ink: '#123456' } }], {}, colleague);
    apply(s, [{ op: 'restore', versionId: own.historyEntry.id, data: { mode: 'undo' } }]);
    expect(s.content.style).toMatchObject({ paper, ink: '#123456' });
    const second = apply(s, [{ op: 'style', style: { paper: '#aaaaaa' } }]);
    apply(s, [{ op: 'style', style: { paper: '#bbbbbb' } }], {}, colleague);
    expect(() =>
      apply(s, [{ op: 'restore', versionId: second.historyEntry.id, data: { mode: 'undo' } }]),
    ).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
  });
});
