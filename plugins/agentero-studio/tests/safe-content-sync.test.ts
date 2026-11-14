import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { LOCAL_ACTOR, type Actor, type BoardElement, type Operation } from '../src/contracts/studio.js';
import { initialWhiteboard, whiteboardAdapter, type WhiteboardState } from '../src/core/products/whiteboard.js';
import { applyMutation, createState, initializeVersionClocks, makeHistory } from '../src/core/shared/history.js';
import { mergeJson } from '../src/core/shared/safe-merge.js';
import { ArtifactStore } from '../src/core/shared/store.js';
import { StudioService } from '../src/core/service.js';

const colleague: Actor = { id: 'colleague', name: '另一位编辑', role: 'editor', kind: 'human' };
function state(elements: Partial<BoardElement>[] = [{ id: 'a', type: 'text', text: 'one\ntwo\nthree' }]): WhiteboardState {
  const content = initialWhiteboard(elements), now = new Date().toISOString();
  const result = createState({ id: randomUUID(), type: 'whiteboard', title: 'test', revision: 0, createdAt: now, updatedAt: now, pinned: false }, content, LOCAL_ACTOR, 'create', content.elements.map(element => element.id)) as WhiteboardState;
  initializeVersionClocks(result, whiteboardAdapter); return result;
}
function apply(target: WhiteboardState, operations: Operation[], extra: Record<string, unknown> = {}, actor = LOCAL_ACTOR) {
  return applyMutation(target, { operationId: randomUUID(), operations, expectedRevision: target.artifact.revision, ...extra }, actor, whiteboardAdapter);
}
function stale(target: WhiteboardState, changes: Partial<BoardElement>, version = 1, extra: Record<string, unknown> = {}) {
  return apply(target, [{ op: 'update', id: 'a', changes }], { expectedRevision: 0, expectedVersions: { a: version }, merge: 'safe', ...extra });
}

describe('safe JSON merge', () => {
  it('merges only independent fields and non-overlapping lines', () => {
    expect(mergeJson({ x: 0, text: 'a\nb\nc' }, { x: 1, text: 'A\nb\nc' }, { x: 0, text: 'a\nb\nC' })).toEqual({ result: { x: 1, text: 'A\nb\nC' }, conflicts: [] });
    expect(mergeJson({ text: 'abc' }, { text: 'Abc' }, { text: 'abC' }).conflicts).toEqual(['text@1']);
    expect(mergeJson({ text: 'a\nb' }, { text: 'new\na\nb' }, { text: 'a\nb\nend' })).toEqual({ result: { text: 'new\na\nb\nend' }, conflicts: [] });
  });
  it('rejects scalar/array/structure conflicts and preserves the current result', () => {
    expect(mergeJson({ x: 0 }, { x: 1 }, { x: 2 })).toEqual({ result: { x: 2 }, conflicts: ['x'] });
    expect(mergeJson({ a: [0, 0] }, { a: [1, 0] }, { a: [0, 2] }).conflicts).toEqual(['a']);
    expect(mergeJson({ row: { a: 'A' } }, {}, { row: { a: 'B' } }).conflicts).toEqual(['row']);
  });
  it('fails closed when text diff work exceeds its bound', () => {
    expect(mergeJson('a\n'.repeat(600), 'b\n'.repeat(600), 'c\n'.repeat(600)).conflicts).toEqual(['.']);
  });
});

describe('trusted-base content transactions', () => {
  it('keeps old calls strict while safe calls preserve unrelated edits and remain idempotent', () => {
    const s = state(); apply(s, [{ op: 'update', id: 'a', changes: { x: 90 } }], {}, colleague);
    expect(() => stale(s, { text: 'changed' }, 1, { merge: undefined })).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
    const operationId = randomUUID(), first = stale(s, { text: 'changed' }, 1, { operationId });
    expect(first.snapshot.content.elements[0]).toMatchObject({ x: 90, text: 'changed', version: 3 });
    const second = stale(s, { text: 'changed' }, 1, { operationId });
    expect(second.snapshot).toEqual(first.snapshot); expect(s.history).toHaveLength(3);
    expect(() => stale(s, { text: 'different' }, 1, { operationId })).toThrowError(expect.objectContaining({ code: 'OPERATION_REUSED' }));
  });
  it('merges disjoint text lines but returns bounded base/local/current on a true conflict', () => {
    const s = state(); apply(s, [{ op: 'update', id: 'a', changes: { text: 'one\ntwo\nTHREE' } }], {}, colleague);
    expect(stale(s, { text: 'ONE\ntwo\nthree' }).snapshot.content.elements[0]!.text).toBe('ONE\ntwo\nTHREE');
    const before = structuredClone(s);
    expect(() => stale(s, { text: 'other\ntwo\nthree' })).toThrowError(expect.objectContaining({ code: 'CONFLICT', details: expect.objectContaining({ elementId: 'a', currentVersion: 3, paths: ['text@1'], base: expect.any(Object), local: expect.any(Object), current: expect.any(Object) }) }));
    expect(s).toEqual(before);
    const large = state([{ id: 'a', type: 'html', html: 'a'.repeat(80_000) }]);
    apply(large, [{ op: 'update', id: 'a', changes: { html: 'b'.repeat(80_000) } }]);
    try { stale(large, { html: 'c'.repeat(80_000) }); throw Error('expected conflict'); }
    catch (error) { const details = (error as { details: unknown }).details; expect(JSON.stringify(details).length).toBeLessThan(14_000); expect(details).toMatchObject({ truncated: true }); }
  });
  it('rejects missing/pruned bases, structural type changes and non-update replay', () => {
    const s = state(); apply(s, [{ op: 'update', id: 'a', changes: { x: 10 } }]);
    expect(() => stale(s, { type: 'shape' })).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
    expect(() => apply(s, [{ op: 'delete', id: 'a' }], { expectedVersions: { a: 1 }, merge: 'safe' })).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
    s.history.splice(0, 1);
    expect(() => stale(s, { text: 'local' })).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
  });
  it('rejects every partial mutation on conflict or validation failure', () => {
    const s = state([{ id: 'a', type: 'text', text: 'old' }, { id: 'b', type: 'text', text: 'B' }]);
    apply(s, [{ op: 'update', id: 'a', changes: { text: 'remote' } }], {}, colleague); const before = structuredClone(s);
    expect(() => apply(s, [{ op: 'update', id: 'b', changes: { text: 'partial' } }, { op: 'update', id: 'a', changes: { text: 'local' } }], { expectedRevision: 0, expectedVersions: { a: 1, b: 1 }, merge: 'safe' })).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
    expect(s).toEqual(before);
    expect(() => apply(s, [{ op: 'add', element: { id: 'c', type: 'text' } }, { op: 'update', id: 'missing', changes: { text: 'bad' } }])).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(s).toEqual(before);
  });
  it('preserves explicit locks and never permits stale unlock plus move', () => {
    const s = state([{ id: 'a', type: 'text', text: 'old', locked: true }]);
    apply(s, [{ op: 'update', id: 'a', changes: { text: 'remote' } }], {}, colleague);
    expect(() => stale(s, { x: 100 })).toThrowError(expect.objectContaining({ code: 'LOCKED' }));
    expect(() => stale(s, { locked: false, x: 100 })).toThrowError(expect.objectContaining({ code: 'LOCKED' }));
    expect(s.content.elements[0]).toMatchObject({ locked: true, x: 0 });
  });
  it('serializes safe updates from separate stores without weakening strict CAS', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studio-safe-stores-'));
    try {
      const s = state(), one = new ArtifactStore(directory), two = new ArtifactStore(directory); await one.write(s);
      const results = await Promise.all([one, two].map((store, index) => store.transaction(s.artifact.id, loaded => stale(loaded as WhiteboardState, index === 0 ? { x: 42 } : { text: 'from another editor' }))));
      expect(results).toHaveLength(2);
      const final = await one.read(s.artifact.id) as WhiteboardState;
      expect(final.content.elements[0]).toMatchObject({ x: 42, text: 'from another editor', version: 3 });
      expect(final.artifact.revision).toBe(2);
      await expect(two.transaction(s.artifact.id, loaded => stale(loaded as WhiteboardState, { x: 99 }, 1, { merge: undefined }))).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await one.read(s.artifact.id)).artifact.revision).toBe(2);
    } finally { if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw Error('Unexpected directory'); await rm(directory, { recursive: true, force: true }); }
  });
  it('passes safe mode through the real service and persists clock state for another instance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studio-safe-service-')), service = new StudioService({ dataRoot: directory });
    try {
      const { board } = await service.execute('artifact_manage', { action: 'create', elements: [{ id: 'a', type: 'text', text: 'original' }] });
      const artifactId = board.artifact.id;
      await service.execute('artifact_apply', { artifactId, expectedVersions: { a: 1 }, operations: [{ op: 'update', id: 'a', changes: { x: 50 } }] });
      const result = await service.execute('artifact_apply', { artifactId, merge: 'safe', expectedVersions: { a: 1 }, operations: [{ op: 'update', id: 'a', changes: { text: 'safe local' } }] });
      expect(result.board.elements[0]).toMatchObject({ x: 50, text: 'safe local', version: 3 });
      expect((await service.store.read(artifactId)).unitClocks!.a!.version).toBe(3);
      await service.execute('artifact_apply', { artifactId, expectedVersions: { a: 3 }, operations: [{ op: 'delete', id: 'a' }] });
      const other = new StudioService({ dataRoot: directory });
      try {
        const readded = await other.execute('artifact_apply', { artifactId, operations: [{ op: 'add', element: { id: 'a', type: 'text', text: 'new lifetime' } }] });
        expect(readded.board.elements[0]!.version).toBe(4);
        await expect(other.execute('artifact_apply', { artifactId, merge: 'safe', expectedVersions: { a: 1 }, operations: [{ op: 'update', id: 'a', changes: { y: 50 } }] })).rejects.toMatchObject({ code: 'CONFLICT' });
      } finally { await other.close(); }
    } finally { await service.close(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw Error('Unexpected directory'); await rm(directory, { recursive: true, force: true }); }
  });
  it('merges stable table cells and rejects row identity changes even with identical dimensions', () => {
    const s = state([{ id: 'a', type: 'table', data: { rows: [['A', 'B'], ['C', 'D']] } }]), original = structuredClone(s.content.elements[0]!.data!);
    apply(s, [{ op: 'update', id: 'a', changes: { data: { ...original, rows: [['AA', 'B'], ['C', 'D']] } } }], {}, colleague);
    expect(stale(s, { data: { ...original, rows: [['A', 'B'], ['C', 'DD']] } }).snapshot.content.elements[0]!.data!.rows).toEqual([['AA', 'B'], ['C', 'DD']]);
    const b = state([{ id: 'a', type: 'table', data: { rows: [['A', 'B'], ['C', 'D']] } }]), data = structuredClone(b.content.elements[0]!.data!);
    apply(b, [{ op: 'update', id: 'a', changes: { data: { ...data, rowIds: ['new-row', (data.rowIds as string[])[1]], rows: [['N', 'B'], ['C', 'D']] } } }]);
    expect(() => stale(b, { data: { ...data, rows: [['A', 'B'], ['C', 'local']] } })).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
    expect(() => stale(b, { data: { rows: [['A', 'B'], ['C', 'local']] } })).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
  });
});

describe('persistent ABA clocks and guarded undo', () => {
  it('migrates a retained legacy ID reuse to a fresh version/source incarnation', () => {
    const s = state([{ id: 'a', type: 'html', html: '<p>same</p>' }]);
    apply(s, [{ op: 'delete', id: 'a' }]); apply(s, [{ op: 'add', element: { id: 'a', type: 'html', html: '<p>same</p>' } }]);
    delete s.unitClocks;
    s.content.elements[0]!.version = 1; s.content.elements[0]!.sourceRevision = 1;
    s.history.at(-1)!.content.elements[0]!.version = 1; s.history.at(-1)!.content.elements[0]!.sourceRevision = 1;
    initializeVersionClocks(s, whiteboardAdapter);
    expect(s.content.elements[0]).toMatchObject({ version: 2, sourceRevision: 2 });
    expect(s.unitClocks!.a).toEqual({ version: 2, incarnationStart: 2, sourceRevision: 2 });
    expect(() => stale(s, { x: 90 })).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
  });
  it('never reuses element/source versions after deletion, pruning, restart or historical restore', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studio-safe-clocks-'));
    try {
      const s = state([{ id: 'a', type: 'html', html: '<p>one</p>' }]), initial = s.history[0]!.entry.id;
      apply(s, [{ op: 'update', id: 'a', changes: { html: '<p>two</p>' } }]);
      apply(s, [{ op: 'delete', id: 'a' }]);
      for (let i = 0; i < 205; i++) makeHistory(s, colleague, 'unrelated history', ['$feedback']);
      expect(s.history.some(saved => saved.content.elements.some(element => element.id === 'a'))).toBe(false);
      const store = new ArtifactStore(directory); await store.write(s);
      const reloaded = await new ArtifactStore(directory).read(s.artifact.id) as WhiteboardState;
      apply(reloaded, [{ op: 'add', element: { id: 'a', type: 'html', html: '<p>one</p>' } }]);
      expect(reloaded.content.elements[0]).toMatchObject({ version: 3, sourceRevision: 3 });
      expect(() => stale(reloaded, { x: 90 })).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
      const kept = reloaded.history.at(-1)!.entry.id;
      apply(reloaded, [{ op: 'delete', id: 'a' }]);
      apply(reloaded, [{ op: 'restore', versionId: kept }]);
      expect(reloaded.content.elements[0]).toMatchObject({ version: 4, sourceRevision: 4 });
      expect(() => apply(reloaded, [{ op: 'restore', versionId: initial }])).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    } finally { if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw Error('Unexpected directory'); await rm(directory, { recursive: true, force: true }); }
  });
  it('undoes only changed fields while keeping unrelated same-object edits and redoes safely', () => {
    const s = state(), own = apply(s, [{ op: 'update', id: 'a', changes: { text: 'own' } }]);
    apply(s, [{ op: 'update', id: 'a', changes: { x: 90 } }], {}, colleague);
    const undo = apply(s, [{ op: 'restore', versionId: own.historyEntry.id, data: { mode: 'undo' } }]);
    expect(s.content.elements[0]).toMatchObject({ text: 'one\ntwo\nthree', x: 90, version: 4 });
    apply(s, [{ op: 'restore', versionId: undo.historyEntry.id, data: { mode: 'undo' } }]);
    expect(s.content.elements[0]).toMatchObject({ text: 'own', x: 90, version: 5 });
  });
  it('refuses undo after later same-field edits or ID reincarnation', () => {
    const s = state(), own = apply(s, [{ op: 'update', id: 'a', changes: { text: 'own' } }]);
    apply(s, [{ op: 'update', id: 'a', changes: { text: 'later' } }], {}, colleague);
    expect(() => apply(s, [{ op: 'restore', versionId: own.historyEntry.id, data: { mode: 'undo' } }])).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
    apply(s, [{ op: 'delete', id: 'a' }]); apply(s, [{ op: 'add', element: { id: 'a', type: 'text', text: 'own' } }]);
    expect(() => apply(s, [{ op: 'restore', versionId: own.historyEntry.id, data: { mode: 'undo' } }])).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
  });
  it('removes a field introduced by the undone edit without removing concurrent fields', () => {
    const s = state(), own = apply(s, [{ op: 'update', id: 'a', changes: { bold: true } }]);
    apply(s, [{ op: 'update', id: 'a', changes: { italic: true } }], {}, colleague);
    apply(s, [{ op: 'restore', versionId: own.historyEntry.id, data: { mode: 'undo' } }]);
    expect(s.content.elements[0]).not.toHaveProperty('bold'); expect(s.content.elements[0]!.italic).toBe(true);
  });
  it('undoes only the changed global style fields and rejects a later same-field edit', () => {
    const s = state(), paper = s.content.style.paper, own = apply(s, [{ op: 'style', style: { paper: '#aaaaaa' } }]);
    apply(s, [{ op: 'style', style: { ink: '#123456' } }], {}, colleague);
    apply(s, [{ op: 'restore', versionId: own.historyEntry.id, data: { mode: 'undo' } }]);
    expect(s.content.style).toMatchObject({ paper, ink: '#123456' });
    const second = apply(s, [{ op: 'style', style: { paper: '#aaaaaa' } }]);
    apply(s, [{ op: 'style', style: { paper: '#bbbbbb' } }], {}, colleague);
    expect(() => apply(s, [{ op: 'restore', versionId: second.historyEntry.id, data: { mode: 'undo' } }])).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
  });
});
