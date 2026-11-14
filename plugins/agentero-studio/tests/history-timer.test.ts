import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StudioService } from '../src/core/service.js';
import { historyBatches } from '../src/core/shared/history.js';
import { LOCAL_ACTOR, type Actor, type Board, type HistoryEntry, type Operation, type StudioEvent } from '../src/contracts/studio.js';

const editor: Actor = { id: 'editor', name: '同事', kind: 'human', role: 'editor' };
const agent: Actor = { id: 'agent', name: 'Agent', kind: 'agent', role: 'owner' };
const viewer: Actor = { id: 'viewer', name: '查看者', kind: 'human', role: 'viewer' };
let directory: string, service: StudioService;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'studio-history-timer-')); service = new StudioService({ dataRoot: directory }); });
afterEach(async () => { vi.restoreAllMocks(); await service.close(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory'); await rm(directory, { recursive: true, force: true }); });
async function create(elements: Record<string, unknown>[] = [{ id: 'a', type: 'text', text: 'A' }, { id: 'b', type: 'text', text: 'B' }]): Promise<Board> { return (await service.execute('artifact_manage', { action: 'create', title: '原标题', elements })).board; }
const read = (artifactId: string) => service.execute('artifact_read', { artifactId }) as Promise<Board>;
async function apply(board: Board, operations: Operation[], extra: Record<string, unknown> = {}, actor = LOCAL_ACTOR) { return service.execute('artifact_apply', { artifactId: board.artifact.id, operationId: randomUUID(), expectedRevision: board.artifact.revision, operations, ...extra }, actor); }

describe('immutable history display batches and selected-unit restore', () => {
  it('groups adjacent same actors by the reference idle/span boundaries and isolates restores', () => {
    const at = new Date('2026-11-14T00:00:00Z').getTime();
    const entry = (revision: number, seconds: number, actor = LOCAL_ACTOR, restoredFrom?: string): HistoryEntry => ({ id: `v-${revision}`, revision, createdAt: new Date(at + seconds * 1000).toISOString(), actor, summary: `修改${revision}`, changedIds: [revision % 2 ? 'a' : 'b'], ...(restoredFrom ? { restoredFrom } : {}) });
    const history = [entry(0, 0), entry(1, 1), entry(2, 30), entry(3, 60), entry(4, 61, editor), entry(5, 62, editor, 'v-1'), entry(6, 63, editor), entry(7, 64)];
    const frozen = structuredClone(history), batches = historyBatches(history);
    expect(batches.map(batch => batch.versionIds)).toEqual([['v-0'], ['v-1', 'v-2'], ['v-3'], ['v-4'], ['v-5'], ['v-6'], ['v-7']]);
    expect(batches[1]).toMatchObject({ id: 'v-2', revision: 2, firstVersionId: 'v-1', firstRevision: 1, firstCreatedAt: history[1]!.createdAt, beforeVersionId: 'v-0', changedIds: ['a', 'b'] });
    const spanning = Array.from({ length: 12 }, (_, index) => entry(index + 1, index * 29));
    expect(historyBatches(spanning).map(batch => batch.versionIds.length)).toEqual([11, 1]);
    expect(history).toEqual(frozen);
  });

  it('reads selected adjacent versions, initial additions, deletion and global units without comparing to head', async () => {
    const initial = await create(), artifactId = initial.artifact.id;
    const first = await apply(initial, [{ op: 'update', id: 'a', changes: { text: 'A1' } }]);
    const second = await apply(first.board, [{ op: 'update', id: 'a', changes: { text: 'A2' } }, { op: 'delete', id: 'b' }, { op: 'style', style: { paper: '#123456' } }]);
    const history = await service.execute('artifact_read', { artifactId, mode: 'history' });
    expect(history.history).toHaveLength(3); expect(history.batches.at(-1).versionIds).toEqual([first.historyEntry.id, second.historyEntry.id]);
    const diff = await service.execute('artifact_read', { artifactId, mode: 'diff', versionId: first.historyEntry.id, adjacent: true, ids: ['a'] });
    expect(diff).toMatchObject({ fromRevision: 0, toRevision: 1, units: [{ id: 'a', before: { text: 'A' }, after: { text: 'A1' } }] });
    const deleted = await service.execute('artifact_read', { artifactId, mode: 'diff', fromVersionId: first.historyEntry.id, toVersionId: second.historyEntry.id, ids: ['b', '$style'] });
    expect(deleted.units).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'b', before: expect.objectContaining({ text: 'B' }), after: null }), expect.objectContaining({ id: '$style', after: expect.objectContaining({ paper: '#123456' }) })]));
    const initialDiff = await service.execute('artifact_read', { artifactId, mode: 'diff', versionId: history.history[0].id, adjacent: true });
    expect(initialDiff.fromRevision).toBeNull(); expect(initialDiff.units[0]).toMatchObject({ id: 'a', before: null, after: { text: 'A' } });
  });

  it('restores only requested units while preserving title, styles, unrelated content and frozen feedback', async () => {
    const initial = await create([{ id: 'a', type: 'html', html: '<h1>旧稿</h1>' }, { id: 'b', type: 'text', text: 'B' }]), artifactId = initial.artifact.id;
    const originalVersion = (await service.execute('artifact_read', { artifactId, mode: 'history' })).history[0].id;
    const feedback = await service.execute('artifact_feedback', { artifactId, action: 'create', text: '保存原稿', anchor: { elementIds: ['a'] }, versions: { a: 1 } });
    const edited = await apply(await read(artifactId), [{ op: 'update', id: 'a', changes: { html: '<h2>新稿</h2>' } }, { op: 'update', id: 'b', changes: { text: '新的 B' } }, { op: 'style', style: { paper: '#123456' } }]);
    await service.execute('artifact_manage', { artifactId, action: 'rename', title: '保留新标题' });
    const current = await read(artifactId), restored = await apply(current, [{ op: 'restore', versionId: originalVersion, id: 'a' }], {}, editor);
    expect(restored.board).toMatchObject({ artifact: { title: '保留新标题', revision: edited.board.artifact.revision + 2 }, style: { paper: '#123456' } });
    expect(restored.board.elements).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'a', html: '<h1>旧稿</h1>', version: 3, sourceRevision: 3 }), expect.objectContaining({ id: 'b', text: '新的 B', version: 2 })]));
    expect(restored.historyEntry).toMatchObject({ changedIds: ['a'], restoredFrom: originalVersion, actor: editor });
    const frozen = await service.execute('artifact_read', { artifactId, mode: 'source', feedbackId: feedback.contextId, elementId: 'a' });
    expect(frozen).toMatchObject({ html: '<h1>旧稿</h1>', sourceRevision: 1 });
  });

  it('enforces all selected CAS targets, accepts independent stale edits, and restores additions/deletions', async () => {
    const initial = await create(), artifactId = initial.artifact.id;
    const savedId = (await service.execute('artifact_read', { artifactId, mode: 'history' })).history[0].id;
    const modified = await apply(initial, [{ op: 'update', id: 'a', changes: { text: 'A1' } }]);
    const unrelated = await apply(modified.board, [{ op: 'update', id: 'b', changes: { text: 'B1' } }]);
    const restored = await apply(modified.board, [{ op: 'restore', versionId: savedId, ids: ['a'] }], { expectedVersions: { a: 2 } });
    expect(restored.board.elements.map((element: { text: string }) => element.text)).toEqual(['A', 'B1']);
    await expect(apply(modified.board, [{ op: 'restore', versionId: savedId, id: 'a' }], { expectedVersions: { a: 2 } })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(apply(unrelated.board, [{ op: 'restore', versionId: savedId, ids: ['a', 'b'] }], { expectedVersions: { a: 3 } })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(apply(restored.board, [{ op: 'restore', versionId: savedId, id: 'a' }], { expectedRevision: undefined })).rejects.toMatchObject({ code: 'VERSION_REQUIRED' });
    const deleted = await apply(restored.board, [{ op: 'delete', id: 'b' }, { op: 'add', element: { id: 'c', type: 'text' } }]);
    const recovered = await apply(deleted.board, [{ op: 'restore', versionId: savedId, ids: ['b', 'c'] }], { expectedRevision: undefined, expectedVersions: { b: 0, c: 1 } });
    expect(recovered.board.elements.map((element: { id: string }) => element.id)).toEqual(['a', 'b']);
    await expect(apply(recovered.board, [{ op: 'restore', versionId: savedId, id: 'missing' }])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(apply(recovered.board, [{ op: 'restore', versionId: savedId, id: 'a', ids: ['b'] }])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(apply(recovered.board, [{ op: 'restore', versionId: savedId, id: 'a' }], {}, viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it.each(['unit', 'whole'] as const)('never reuses deleted object/source versions during %s restore', async scope => {
    const initial = await create([{ id: 'a', type: 'html', html: '<h1>第一稿</h1>' }]), artifactId = initial.artifact.id;
    const savedId = (await service.execute('artifact_read', { artifactId, mode: 'history' })).history[0].id;
    const second = await apply(initial, [{ op: 'update', id: 'a', changes: { html: '<h1>第二稿</h1>' } }]);
    const frozen = await service.execute('artifact_feedback', { artifactId, action: 'create', text: '保留第二稿', anchor: { elementIds: ['a'] }, versions: { a: 2 } });
    const third = await apply(await read(artifactId), [{ op: 'update', id: 'a', changes: { html: '<h1>第三稿</h1>' } }]);
    const deleted = await apply(third.board, [{ op: 'delete', id: 'a' }]);
    const args = { artifactId, operationId: randomUUID(), expectedRevision: deleted.board.artifact.revision, operations: [{ op: 'restore', versionId: savedId, ...(scope === 'unit' ? { id: 'a' } : {}) }] };
    const restored = await service.execute('artifact_apply', args, editor);
    expect(restored.board.elements[0]).toMatchObject({ html: '<h1>第一稿</h1>', version: 4, sourceRevision: 4 });
    expect(await service.execute('artifact_apply', args, editor)).toEqual(restored);
    expect((await service.execute('artifact_read', { artifactId, mode: 'source', feedbackId: frozen.contextId, elementId: 'a' })).html).toBe('<h1>第二稿</h1>');
    expect((await service.execute('artifact_read', { artifactId, mode: 'source', regionId: 'a', sourceRevision: 2 })).html).toBe('<h1>第二稿</h1>');
    const recaptured = await service.execute('artifact_feedback', { artifactId, action: 'create', text: '仍可引用第二稿', anchor: { elementIds: ['a'] }, versions: { a: second.board.elements[0].version } });
    expect((await service.execute('artifact_read', { artifactId, mode: 'source', feedbackId: recaptured.contextId, elementId: 'a' })).html).toBe('<h1>第二稿</h1>');
  });

  it('requires current revision for global units and respects live editing plus locked geometry for every restore form', async () => {
    const initial = await create(), artifactId = initial.artifact.id, savedId = (await service.execute('artifact_read', { artifactId, mode: 'history' })).history[0].id;
    const moved = await apply(initial, [{ op: 'update', id: 'a', changes: { x: 300, locked: true } }]);
    for (const operation of [{ op: 'restore', versionId: savedId, id: 'a' }, { op: 'restore', versionId: savedId }]) await expect(apply(moved.board, [operation as Operation])).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(apply(moved.board, [{ op: 'update', id: 'a', changes: { locked: false } }, { op: 'restore', versionId: savedId, id: 'a' }])).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(apply(moved.board, [{ op: 'restore', versionId: savedId, ids: ['$style'] }], { expectedRevision: undefined, expectedVersions: { $style: 0 } })).rejects.toMatchObject({ code: 'VERSION_REQUIRED' });
    await service.updatePresence(artifactId, { peerId: 'view-b', context: { artifactId, viewId: 'view-b', selectedIds: [], editingIds: ['b'] } }, editor);
    await expect(apply(moved.board, [{ op: 'restore', versionId: savedId, id: 'b' }], {}, agent)).rejects.toMatchObject({ code: 'EDIT_IN_PROGRESS' });
    const independent = await apply(moved.board, [{ op: 'restore', versionId: savedId, id: 'a' }], {}, agent).catch(error => error);
    expect(independent).toMatchObject({ code: 'LOCKED' });
    expect((await read(artifactId)).elements[0]).toMatchObject({ x: 300, locked: true });
  });
});

describe('shared duration-preserving timer actions', () => {
  it('broadcasts running adjustments, pauses exact remaining time, edits paused duration, resets and restarts after zero', async () => {
    const board = await create(), artifactId = board.artifact.id, now = Date.now(), time = vi.spyOn(Date, 'now').mockReturnValue(now);
    const events: StudioEvent[] = [], unsubscribe = service.subscribe(artifactId, event => events.push(event));
    const action = (timer: Record<string, unknown>, actor = editor) => service.updatePresence(artifactId, { timer }, actor);
    await action({ action: 'start', durationSeconds: 125 });
    time.mockReturnValue(now + 10_000);
    expect((await action({ action: 'adjust', deltaSeconds: 60 })).timer).toMatchObject({ durationMs: 125_000, remainingMs: 175_000, deadline: now + 185_000 });
    expect((await action({ action: 'adjust', deltaSeconds: -60 })).timer).toMatchObject({ durationMs: 125_000, remainingMs: 115_000 });
    time.mockReturnValue(now + 20_000);
    expect((await action({ action: 'pause' })).timer).toMatchObject({ durationMs: 125_000, remainingMs: 105_000, deadline: null, paused: true });
    expect((await action({ action: 'set-duration', durationSeconds: 91 })).timer).toMatchObject({ durationMs: 91_000, remainingMs: 91_000, deadline: null, paused: false });
    expect((await action({ action: 'reset' }, LOCAL_ACTOR)).timer).toMatchObject({ durationMs: 91_000, remainingMs: 91_000, deadline: null, paused: false });
    expect((await action({ action: 'start' })).timer).toMatchObject({ deadline: now + 111_000, remainingMs: 91_000 });
    time.mockReturnValue(now + 112_000);
    expect(service.getTimer(artifactId)).toMatchObject({ durationMs: 91_000, remainingMs: 0 });
    expect((await action({ action: 'resume' })).timer).toMatchObject({ durationMs: 91_000, remainingMs: 91_000, deadline: now + 203_000, paused: false });
    const broadcasts = events.filter(event => event.type === 'presence');
    expect(broadcasts).toHaveLength(8); expect(broadcasts.at(-1)).toMatchObject({ timer: { durationMs: 91_000, deadline: now + 203_000 } });
    expect((await service.execute('artifact_read', { artifactId, mode: 'context' })).timer).toMatchObject({ durationMs: 91_000 });
    expect((await service.execute('artifact_read', { artifactId, mode: 'history' })).history).toHaveLength(1);
    unsubscribe();
  });

  it('checks bounds, permissions and invalid transitions without replacing shared state', async () => {
    const artifactId = (await create()).artifact.id, now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now);
    const action = (timer: Record<string, unknown>, actor = editor) => service.updatePresence(artifactId, { timer }, actor);
    for (const durationSeconds of [0, 6000, 1.5, Infinity]) await expect(action({ action: 'start', durationSeconds })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await action({ action: 'start', durationSeconds: 5900 });
    await expect(action({ action: 'adjust', deltaSeconds: 60 }, viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(action({ action: 'adjust', deltaSeconds: 1 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(action({ action: 'set-duration', durationSeconds: 60 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect((await action({ action: 'adjust', deltaSeconds: 60 })).timer).toMatchObject({ durationMs: 5_900_000, remainingMs: 5_960_000 });
    await expect(action({ action: 'adjust', deltaSeconds: 60 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await action({ action: 'pause' });
    await expect(action({ action: 'adjust', deltaSeconds: -60 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(action({ action: 'set-duration', durationSeconds: 0 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(service.getTimer(artifactId)).toMatchObject({ durationMs: 5_900_000, remainingMs: 5_960_000, paused: true });
    await action({ action: 'reset' });
    expect(service.getTimer(artifactId)).toMatchObject({ remainingMs: 5_900_000, paused: false });
    expect((await action({ action: 'set-duration', durationSeconds: 5999 })).timer).toMatchObject({ durationMs: 5_999_000, remainingMs: 5_999_000 });
    await action({ action: 'start', durationSeconds: 1 });
    await expect(action({ action: 'adjust', deltaSeconds: -60 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(service.getTimer(artifactId)).toMatchObject({ durationMs: 1000, remainingMs: 1000 });
  });
});

describe('native layer ordering', () => {
  it('undoes and redoes only the order transaction while preserving unrelated edits, style and HTML source versions', async () => {
    const initial = await create([{ id: 'a', type: 'text', text: 'A' }, { id: 'b', type: 'html', html: '<h1>B</h1>' }, { id: 'c', type: 'text', text: 'C' }]), artifactId = initial.artifact.id;
    const reordered = await apply(initial, [{ op: 'layout', preset: 'front', ids: ['a'] }], { expectedVersions: { a: 1, $order: 0 } });
    expect(reordered.board.elements.map((element: { id: string }) => element.id)).toEqual(['b', 'c', 'a']);
    expect(reordered).toMatchObject({ board: { orderVersion: 1 }, historyEntry: { changedIds: ['a', '$order'] } });
    const concurrent = await apply(reordered.board, [{ op: 'update', id: 'c', changes: { text: '并行编辑' } }, { op: 'style', style: { paper: '#123456' } }], {}, editor);
    await service.execute('artifact_manage', { artifactId, action: 'rename', title: '保留并行标题' });
    const current = await read(artifactId), undo = await apply(current, [{ op: 'restore', versionId: reordered.historyEntry.id, data: { mode: 'undo' } }]);
    expect(undo.board).toMatchObject({ artifact: { title: '保留并行标题' }, orderVersion: 2, style: { paper: '#123456' } });
    expect(undo.board.elements.map((element: { id: string }) => element.id)).toEqual(['a', 'b', 'c']);
    expect(undo.board.elements).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'a', version: 3 }), expect.objectContaining({ id: 'b', version: 1, sourceRevision: 1, html: '<h1>B</h1>' }), expect.objectContaining({ id: 'c', version: 2, text: '并行编辑' })]));
    expect(undo.historyEntry.changedIds).toEqual(['a', '$order']);
    const redo = await apply(undo.board, [{ op: 'restore', versionId: undo.historyEntry.id, data: { mode: 'undo' } }]);
    expect(redo.board.orderVersion).toBe(3); expect(redo.board.elements.map((element: { id: string }) => element.id)).toEqual(['b', 'c', 'a']);
    const undoAgain = await apply(redo.board, [{ op: 'restore', versionId: redo.historyEntry.id, data: { mode: 'undo' } }]);
    expect(undoAgain.board.orderVersion).toBe(4); expect(undoAgain.board.elements.map((element: { id: string }) => element.id)).toEqual(['a', 'b', 'c']);
    expect(undoAgain.board.elements.find((element: { id: string }) => element.id === 'b')).toEqual(initial.elements[1]);
    const diff = await service.execute('artifact_read', { artifactId, mode: 'diff', versionId: reordered.historyEntry.id, adjacent: true, ids: ['$order'] });
    expect(diff.units).toEqual([{ id: '$order', before: { version: 0, ids: ['a', 'b', 'c'] }, after: { version: 1, ids: ['b', 'c', 'a'] } }]);
    expect((await service.execute('artifact_read', { artifactId, mode: 'version', versionId: concurrent.historyEntry.id })).board.orderVersion).toBe(1);
  });

  it('rejects concurrent order edits and order ABA even when the selected object itself is unchanged', async () => {
    const initial = await create(['a', 'b', 'c'].map(id => ({ id, type: 'text', text: id })));
    const original = await apply(initial, [{ op: 'layout', preset: 'front', ids: ['a'] }]);
    const changed = await apply(original.board, [{ op: 'layout', preset: 'forward', ids: ['c'] }], {}, editor);
    expect(changed.board.elements.find((element: { id: string }) => element.id === 'a').version).toBe(2);
    await expect(apply(changed.board, [{ op: 'restore', versionId: original.historyEntry.id, data: { mode: 'undo' } }])).rejects.toMatchObject({ code: 'CONFLICT', details: { elementId: '$order' } });
    const returned = await apply(changed.board, [{ op: 'layout', preset: 'backward', ids: ['c'] }], {}, editor);
    expect(returned.board.elements.map((element: { id: string }) => element.id)).toEqual(['b', 'c', 'a']);
    expect(returned.board.orderVersion).toBe(3);
    await expect(apply(returned.board, [{ op: 'restore', versionId: original.historyEntry.id, data: { mode: 'undo' } }])).rejects.toMatchObject({ code: 'CONFLICT', details: { elementId: '$order' } });
  });

  it('requires the real order clock for stale layer CAS and reads it without changing other units', async () => {
    const initial = await create(['a', 'b', 'c'].map(id => ({ id, type: 'text', text: id }))), artifactId = initial.artifact.id;
    const reordered = await apply(initial, [{ op: 'layout', preset: 'front', ids: ['a'] }]);
    const independent = await apply(reordered.board, [{ op: 'update', id: 'c', changes: { text: '并行内容' } }], {}, editor);
    await expect(apply(reordered.board, [{ op: 'layout', preset: 'back', ids: ['a'] }], { expectedVersions: { a: 2 } })).rejects.toMatchObject({ code: 'CONFLICT' });
    const accepted = await apply(reordered.board, [{ op: 'layout', preset: 'back', ids: ['a'] }], { expectedVersions: { a: 2, $order: 1 } });
    expect(accepted.board.elements.map((element: { id: string }) => element.id)).toEqual(['a', 'b', 'c']);
    expect(accepted.board.elements.find((element: { id: string }) => element.id === 'c')).toEqual(independent.board.elements.find((element: { id: string }) => element.id === 'c'));
    await expect(apply(accepted.board, [{ op: 'layout', preset: 'front', ids: ['b'] }], { expectedRevision: undefined, expectedVersions: { b: 1, $order: 1 } })).rejects.toMatchObject({ code: 'CONFLICT', details: { elementId: '$order' } });
    const objects = await service.execute('artifact_read', { artifactId, mode: 'objects', ids: ['$order'] });
    expect(objects).toMatchObject({ orderVersion: 2, elements: [], units: [{ id: '$order', value: { version: 2, ids: ['a', 'b', 'c'] } }] });
    const restored = await apply(accepted.board, [{ op: 'restore', versionId: reordered.historyEntry.id, id: '$order' }], { expectedRevision: undefined, expectedVersions: { $order: 2 } });
    expect(restored.board.elements.map((element: { id: string }) => element.id)).toEqual(['b', 'c', 'a']);
    expect(restored.board.elements.find((element: { id: string }) => element.id === 'a').version).toBe(3);
    expect(restored.board.orderVersion).toBe(3);
  });

  it('supports old snapshots without an order clock and preserves new order clocks through previews and portable exports', async () => {
    const initial = await create(['a', 'b', 'c'].map(id => ({ id, type: 'text', text: id }))), artifactId = initial.artifact.id;
    await service.store.transaction(artifactId, state => {
      delete (state.content as { orderVersion?: number }).orderVersion;
      for (const snapshot of state.history) delete (snapshot.content as { orderVersion?: number }).orderVersion;
    });
    const legacy = await read(artifactId), legacyVersion = (await service.execute('artifact_read', { artifactId, mode: 'history' })).history[0].id;
    expect(legacy.orderVersion).toBeUndefined();
    expect((await service.execute('artifact_read', { artifactId, mode: 'summary' })).orderVersion).toBe(0);
    const reordered = await apply(legacy, [{ op: 'layout', preset: 'front', ids: ['a'] }], { expectedRevision: undefined, expectedVersions: { a: 1, $order: 0 } });
    expect(reordered.board.orderVersion).toBe(1);
    expect((await service.execute('artifact_read', { artifactId, mode: 'version', versionId: legacyVersion })).board.orderVersion).toBeUndefined();
    const json = await service.execute('artifact_export', { artifactId, format: 'json' });
    const exported = JSON.parse(Buffer.from((await service.getExport(json.exportId)).data).toString('utf8'));
    expect(exported.orderVersion).toBe(1); expect(exported.elements.map((element: { id: string }) => element.id)).toEqual(['b', 'c', 'a']);
    const zip = await service.execute('artifact_export', { artifactId, format: 'zip' }), target = new StudioService({ dataRoot: join(directory, 'portable') });
    try {
      const imported = await target.importArchive((await service.getExport(zip.exportId)).data) as { artifact: Board['artifact']; board: Board }, id = imported.artifact.id;
      expect(imported.board.orderVersion).toBe(1);
      expect((await target.execute('artifact_read', { artifactId: id, mode: 'version', versionId: legacyVersion })).board.orderVersion).toBeUndefined();
      const undo = await target.execute('artifact_apply', { artifactId: id, expectedRevision: imported.board.artifact.revision, operations: [{ op: 'restore', versionId: reordered.historyEntry.id, data: { mode: 'undo' } }] });
      expect(undo.board.orderVersion).toBe(2); expect(undo.board.elements.map((element: { id: string }) => element.id)).toEqual(['a', 'b', 'c']);
    } finally { await target.close(); }
  });

  it('restores deleted middle units in place and treats selected order plus objects as an unordered set', async () => {
    const initial = await create(['a', 'b', 'c'].map(id => ({ id, type: 'text', text: id }))), artifactId = initial.artifact.id;
    const savedId = (await service.execute('artifact_read', { artifactId, mode: 'history' })).history[0].id;
    const deleted = await apply(initial, [{ op: 'delete', id: 'b' }]);
    const undo = await apply(deleted.board, [{ op: 'restore', versionId: deleted.historyEntry.id, data: { mode: 'undo' } }]);
    expect(undo.board.elements.map((element: { id: string }) => element.id)).toEqual(['a', 'b', 'c']);
    const first = await apply(undo.board, [{ op: 'layout', preset: 'back', ids: ['c'] }]);
    const second = await apply(first.board, [{ op: 'layout', preset: 'back', ids: ['b'] }]);
    const removed = await apply(second.board, [{ op: 'delete', id: 'a' }]);
    const restored = await apply(removed.board, [{ op: 'restore', versionId: savedId, ids: ['$order', 'a'] }]);
    expect(restored.board.elements.map((element: { id: string }) => element.id)).toEqual(['a', 'b', 'c']);
  });

  it('reorders the canonical scene, retains group order and enforces versions and locked targets', async () => {
    const initial = await create(['a', 'b', 'c', 'd'].map(id => ({ id, type: 'text', text: id }))), artifactId = initial.artifact.id;
    const forward = await apply(initial, [{ op: 'layout', preset: 'forward', ids: ['a', 'b'] }]);
    expect(forward.board.elements.map((element: { id: string }) => element.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(forward.board.elements.filter((element: { id: string }) => ['a', 'b'].includes(element.id)).map((element: { version: number }) => element.version)).toEqual([2, 2]);
    const front = await apply(forward.board, [{ op: 'layout', preset: 'front', ids: ['b', 'a'] }]);
    expect(front.board.elements.map((element: { id: string }) => element.id)).toEqual(['c', 'd', 'a', 'b']);
    const back = await apply(front.board, [{ op: 'layout', preset: 'back', ids: ['a', 'b'] }]);
    expect(back.board.elements.map((element: { id: string }) => element.id)).toEqual(['a', 'b', 'c', 'd']);
    const backward = await apply(back.board, [{ op: 'layout', preset: 'backward', ids: ['c', 'd'] }]);
    expect(backward.board.elements.map((element: { id: string }) => element.id)).toEqual(['a', 'c', 'd', 'b']);
    await expect(apply(initial, [{ op: 'layout', preset: 'front', ids: ['a'] }], { expectedVersions: { a: 1 } })).rejects.toMatchObject({ code: 'CONFLICT' });
    const locked = await apply(backward.board, [{ op: 'update', id: 'a', changes: { locked: true } }]);
    await expect(apply(locked.board, [{ op: 'layout', preset: 'front', ids: ['a'] }])).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(apply(locked.board, [{ op: 'update', id: 'a', changes: { locked: false } }, { op: 'layout', preset: 'front', ids: ['a'] }])).rejects.toMatchObject({ code: 'LOCKED' });
    expect((await read(artifactId)).elements.map(element => element.id)).toEqual(['a', 'c', 'd', 'b']);
  });
});
