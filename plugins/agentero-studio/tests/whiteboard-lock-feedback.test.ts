import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StudioService } from '../src/core/service.js';
import { LOCAL_ACTOR, type Actor, type Board, type BoardElement, type Operation } from '../src/contracts/studio.js';

const agent: Actor = { id: 'codex', name: 'Codex', kind: 'agent', role: 'owner' };
const commenter: Actor = { id: 'commenter', name: 'Commenter', kind: 'human', role: 'commenter' };
const viewer: Actor = { id: 'viewer', name: 'Viewer', kind: 'human', role: 'viewer' };
let directory: string, service: StudioService, artifactId: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-lock-feedback-'));
  service = new StudioService({ dataRoot: directory });
  artifactId = (await service.execute('artifact_manage', { action: 'create' })).artifact.id;
});
afterEach(async () => {
  await service.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory');
  await rm(directory, { recursive: true, force: true });
});
const read = () => service.execute('artifact_read', { artifactId }) as Promise<Board>;
async function apply(operations: Operation[], actor = LOCAL_ACTOR, extra: Record<string, unknown> = {}) {
  const board = await read();
  return service.execute('artifact_apply', { artifactId, operationId: randomUUID(), expectedRevision: board.artifact.revision, operations, ...extra }, actor);
}
const add = (element: Partial<BoardElement>) => apply([{ op: 'add', element }]);
const createFeedback = (anchor: unknown, extra: Record<string, unknown> = {}, actor = commenter) => service.execute('artifact_feedback', { artifactId, action: 'create', text: 'Review this target', anchor, ...extra }, actor);

describe('whiteboard geometry locks', () => {
  it.each([LOCAL_ACTOR, agent])('allows locked content and style edits for $kind actors while enforcing role and CAS', async actor => {
    await add({ id: 'html-a', type: 'html', html: '<h1>Before</h1>', locked: true, x: 20, y: 30, w: 400, h: 300 });
    const first = await apply([{ op: 'update', id: 'html-a', changes: { html: '<h2>After</h2>', state: { active: true }, text: 'Updated', fill: '#ffeedd', stroke: '#333', fontSize: 28 } }], actor);
    expect(first.board.elements[0]).toMatchObject({ x: 20, y: 30, w: 400, h: 300, locked: true, version: 2, sourceRevision: 2, state: { active: true }, text: 'Updated', fill: '#ffeedd' });
    await expect(apply([{ op: 'update', id: 'html-a', changes: { text: 'Stale' } }], actor, { expectedVersions: { 'html-a': 1 } })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(apply([{ op: 'update', id: 'html-a', changes: { text: 'Viewer' } }], viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(apply([{ op: 'update', id: 'html-a', changes: { text: 'Commenter' } }], commenter)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects all geometry fields, crop, deletion and layout without changing history', async () => {
    await add({ id: 'a', type: 'image', locked: true, x: 20, y: 30, w: 400, h: 300 });
    const before = await read(), changes: Partial<BoardElement>[] = [
      { x: 21 }, { y: 31 }, { w: 401 }, { h: 301 }, { rotation: 45 }, { parentId: 'frame' }, { groupId: 'group' },
      { from: [1, 2] }, { to: [3, 4] }, { fromSide: 'left' }, { toSide: 'right' }, { points: [0, 0, 10, 10] },
      { bends: [20, 30] }, { crop: { zoom: 2, x: .5, y: .5 } }, { type: 'shape' },
    ];
    for (const patch of changes) await expect(apply([{ op: 'update', id: 'a', changes: patch }], agent)).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(apply([{ op: 'delete', id: 'a' }])).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(apply([{ op: 'layout', ids: ['a'] }])).rejects.toMatchObject({ code: 'LOCKED' });
    expect(await read()).toEqual(before);
  });

  it('requires a separate explicit unlock commit and rolls back unlock-and-move batches', async () => {
    await add({ id: 'a', type: 'text', text: 'Keep', locked: true });
    await expect(apply([{ op: 'update', id: 'a', changes: { locked: false, text: 'Implicit' } }])).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(apply([{ op: 'update', id: 'a', changes: { locked: undefined } }])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(apply([{ op: 'update', id: 'a', changes: { locked: false } }, { op: 'update', id: 'a', changes: { x: 500 } }])).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(apply([{ op: 'update', id: 'a', changes: { locked: false } }, { op: 'delete', id: 'a' }])).rejects.toMatchObject({ code: 'LOCKED' });
    expect((await read()).elements[0]).toMatchObject({ locked: true, x: 0, version: 1 });
    await apply([{ op: 'update', id: 'a', changes: { locked: false } }]);
    const moved = await apply([{ op: 'update', id: 'a', changes: { x: 500 } }]);
    expect(moved.board.elements[0]).toMatchObject({ locked: false, x: 500 });
  });

  it('protects a locked attached arrow from indirect movement or deletion, with content edits still available', async () => {
    await apply([
      { op: 'add', element: { id: 'a', type: 'shape', x: 0, y: 0 } },
      { op: 'add', element: { id: 'b', type: 'shape', x: 500, y: 300 } },
      { op: 'add', element: { id: 'edge', type: 'arrow', from: 'a', to: 'b', locked: true } },
    ]);
    await apply([{ op: 'update', id: 'a', changes: { text: 'Allowed', fill: '#abc' } }, { op: 'update', id: 'edge', changes: { label: 'Allowed', stroke: '#123' } }]);
    for (const operation of [{ op: 'update', id: 'a', changes: { x: 50 } }, { op: 'layout', ids: ['a'] }, { op: 'delete', id: 'a' }] as Operation[]) {
      await expect(apply([operation])).rejects.toMatchObject({ code: 'LOCKED', details: { elementId: 'edge' } });
    }
    const current = await read();
    await expect(apply([{ op: 'delete', id: 'a' }], agent, { expectedRevision: undefined, expectedVersions: { a: current.elements[0]!.version } })).rejects.toMatchObject({ code: 'VERSION_REQUIRED' });
    expect(current.elements.find(element => element.id === 'a')!.text).toBe('Allowed');
  });

  it('keeps locked members fixed without making all container children read-only', async () => {
    await apply([
      { op: 'add', element: { id: 'frame', type: 'container', x: 0, y: 0, w: 500, h: 500, locked: true } },
      { op: 'add', element: { id: 'member', type: 'text', parentId: 'frame', x: 30, y: 30, locked: true } },
      { op: 'add', element: { id: 'free', type: 'text', parentId: 'frame', x: 30, y: 100 } },
    ]);
    await apply([{ op: 'update', id: 'frame', changes: { text: 'Frame title' } }, { op: 'update', id: 'member', changes: { text: 'Member content' } }, { op: 'update', id: 'free', changes: { x: 50 } }]);
    await apply([{ op: 'update', id: 'frame', changes: { locked: false } }]);
    await apply([{ op: 'update', id: 'frame', changes: { x: 20 } }]);
    await expect(apply([{ op: 'delete', id: 'frame' }])).rejects.toMatchObject({ code: 'LOCKED', details: { elementId: 'member' } });
    expect((await read()).elements.find(element => element.id === 'member')).toMatchObject({ x: 30, y: 30, locked: true });
  });

  it('preserves explicit history restore and own-transaction undo for locked content', async () => {
    const added = await add({ id: 'a', type: 'html', html: '<h1>Original</h1>', locked: true });
    const edited = await apply([{ op: 'update', id: 'a', changes: { html: '<h2>Changed</h2>' } }]);
    const undone = await apply([{ op: 'restore', versionId: edited.historyEntry.id, data: { mode: 'undo' } }]);
    expect(undone.board.elements[0]).toMatchObject({ locked: true, html: '<h1>Original</h1>', sourceRevision: 3 });
    const restored = await apply([{ op: 'restore', versionId: added.historyEntry.id }]);
    expect(restored.board.elements[0]).toMatchObject({ locked: true, html: '<h1>Original</h1>' });
    expect(restored.board.artifact.revision).toBe(4);
  });

  it('applies the same geometry lock policy to private suggestions and their previews', async () => {
    await add({ id: 'a', type: 'html', html: '<h1>Original</h1>', locked: true });
    const suggest = (operations: Operation[]) => service.execute('artifact_feedback', { artifactId, action: 'suggest', text: 'Improve content', expectedVersions: { a: 1 }, anchor: { regionId: 'a' }, options: [{ id: 'one', label: 'Updated', operations }, { id: 'two', label: 'Alternative', operations: [{ op: 'update', id: 'a', changes: { html: '<p>Alternative</p>' } }] }] }, agent);
    await expect(suggest([{ op: 'update', id: 'a', changes: { locked: false } }, { op: 'update', id: 'a', changes: { x: 20 } }])).rejects.toMatchObject({ code: 'LOCKED' });
    const result = await suggest([{ op: 'update', id: 'a', changes: { html: '<h2>Suggested</h2>' } }]), feedbackId = result.feedback[0].id;
    const preview = await service.execute('artifact_feedback', { artifactId, action: 'preview', feedbackId, optionId: 'one' });
    expect(preview.document.elements[0]).toMatchObject({ locked: true, html: '<h2>Suggested</h2>' });
    await service.execute('artifact_feedback', { artifactId, action: 'choose', feedbackId, optionId: 'one', operationId: randomUUID() });
    expect((await read()).elements[0]).toMatchObject({ locked: true, html: '<h2>Suggested</h2>' });
  });
});

describe('feedback coordinates, frozen sources and retries', () => {
  it('freezes the clicked native versions after collaborators edit each selected object', async () => {
    await apply([
      { op: 'add', element: { id: 'a', type: 'text', text: 'First A', x: 10, y: 20 } },
      { op: 'add', element: { id: 'b', type: 'note', text: 'Clicked B', x: 300, y: 20 } },
    ]);
    await apply([{ op: 'update', id: 'a', changes: { text: 'Clicked A', x: 30 } }]);
    const selected = await read(), versions = Object.fromEntries(selected.elements.map(element => [element.id, element.version]));
    await apply([{ op: 'update', id: 'a', changes: { text: 'Current A', x: 90 } }, { op: 'update', id: 'b', changes: { text: 'Current B', x: 500 } }], agent);
    const operationId = randomUUID(), anchor = { coordinateSpace: 'board', elementIds: ['a', 'b'], x: 30, y: 20, w: 490, h: 120 };
    const result = await createFeedback(anchor, { versions, operationId });
    const context = await service.execute('artifact_read', { artifactId, mode: 'context', contextId: result.contextId });
    expect(context.feedback.versions).toEqual({ a: 2, b: 1 });
    expect(context.sources).toMatchObject([
      { elementId: 'a', version: 2, element: { text: 'Clicked A', x: 30, version: 2 } },
      { elementId: 'b', version: 1, element: { text: 'Clicked B', x: 300, version: 1 } },
    ]);
    expect((await createFeedback(anchor, { versions, operationId })).contextId).toBe(result.contextId);
    await expect(createFeedback(anchor, { versions: { a: 3, b: 2 }, operationId })).rejects.toMatchObject({ code: 'OPERATION_REUSED' });
  });

  it('rejects missing, unavailable or invalid clicked versions and preserves HTML source selection', async () => {
    await apply([
      { op: 'add', element: { id: 'a', type: 'text', text: 'Selected' } },
      { op: 'add', element: { id: 'html', type: 'html', html: '<h1>Selected HTML</h1>' } },
    ]);
    await apply([{ op: 'update', id: 'html', changes: { html: '<h2>Current HTML</h2>' } }], agent);
    const anchor = { coordinateSpace: 'element', elementIds: ['a'], x: .5, y: .5 }, before = await read();
    await expect(createFeedback(anchor, { versions: {} })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(createFeedback(anchor, { versions: { a: '1' } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(createFeedback(anchor, { versions: { a: 0 } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(createFeedback(anchor, { versions: { a: 99 } })).rejects.toMatchObject({ code: 'CONFLICT', details: { elementId: 'a' } });
    const htmlAnchor = { coordinateSpace: 'html', regionId: 'html', sourceRevision: 1, x: 10, y: 20 };
    await expect(createFeedback(htmlAnchor, { versions: { html: 2 } })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await read()).toEqual(before);
    const result = await createFeedback(htmlAnchor, { versions: { html: 1 } });
    expect((await service.execute('artifact_read', { artifactId, mode: 'context', contextId: result.contextId })).sources[0]).toMatchObject({ html: '<h1>Selected HTML</h1>', sourceRevision: 1, element: { version: 1 } });
  });

  it('reports an expired native selection instead of silently freezing its current replacement', async () => {
    await add({ id: 'a', type: 'text', text: 'Expired selection' });
    await apply([{ op: 'update', id: 'a', changes: { text: 'Current content' } }]);
    for (let index = 0; index < 200; index++) await apply([{ op: 'style', style: { name: `History ${index}` } }]);
    const before = await read();
    await expect(createFeedback({ coordinateSpace: 'element', elementIds: ['a'], x: .5, y: .5 }, { versions: { a: 1 } })).rejects.toMatchObject({ code: 'CONFLICT', details: { elementId: 'a', version: 1 } });
    expect(await read()).toEqual(before);
    expect((await service.execute('artifact_feedback', { artifactId, action: 'list' })).feedback).toHaveLength(0);
  }, 15000);

  it('rejects ambiguous versions when a deleted native ID is reused for different content', async () => {
    await add({ id: 'a', type: 'text', text: 'Clicked original' });
    await apply([{ op: 'delete', id: 'a' }]);
    await add({ id: 'a', type: 'text', text: 'Replacement using the same ID' });
    await expect(createFeedback({ coordinateSpace: 'element', elementIds: ['a'], x: .5, y: .5 }, { versions: { a: 1 } })).rejects.toMatchObject({ code: 'CONFLICT', details: { elementId: 'a', version: 1 } });
    expect((await service.execute('artifact_feedback', { artifactId, action: 'list' })).feedback).toHaveLength(0);
  });

  it('freezes native objects and HTML at their original versions without rewriting legacy anchors', async () => {
    await apply([
      { op: 'add', element: { id: 'native', type: 'text', text: 'Original object', x: 20, y: 30, locked: true } },
      { op: 'add', element: { id: 'html', type: 'html', html: '<h1>Original HTML</h1>', locked: true } },
    ]);
    const native = await createFeedback({ coordinateSpace: 'element', elementIds: ['native'], x: .25, y: .75 });
    const html = await createFeedback({ coordinateSpace: 'html', regionId: 'html', sourceRevision: 1, x: 30, y: 40, w: 200, h: 50 });
    const legacy = await createFeedback({ elementIds: ['native'], x: 20, y: 30 });
    const boardArea = await createFeedback({ coordinateSpace: 'board', x: -500, y: 300, w: 500, h: 300 });
    expect(boardArea.feedback.find((entry: { id: string }) => entry.id === boardArea.contextId).anchor.coordinateSpace).toBe('board');
    await apply([{ op: 'update', id: 'native', changes: { text: 'Current object' } }, { op: 'update', id: 'html', changes: { html: '<h2>Current HTML</h2>' } }]);
    const nativeSource = await service.execute('artifact_read', { artifactId, mode: 'context', contextId: native.contextId });
    expect(nativeSource.sources[0]).toMatchObject({ elementId: 'native', version: 1, element: { text: 'Original object', x: 20, y: 30, locked: true } });
    const htmlSource = await service.execute('artifact_read', { artifactId, mode: 'source', feedbackId: html.contextId, regionId: 'html' });
    expect(htmlSource).toMatchObject({ html: '<h1>Original HTML</h1>', sourceRevision: 1, element: { html: '<h1>Original HTML</h1>', version: 1 } });
    expect((await service.execute('artifact_feedback', { artifactId, action: 'get', feedbackId: legacy.contextId })).feedback[0].anchor).toEqual({ elementIds: ['native'], x: 20, y: 30 });
    await expect(createFeedback({ elementIds: ['native'] }, {}, viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('validates new coordinate spaces and target existence before writing feedback', async () => {
    await add({ id: 'a', type: 'text' });
    const invalid = [
      { coordinateSpace: 'screen', x: 0, y: 0 }, { coordinateSpace: 'element', x: .5, y: .5 },
      { coordinateSpace: 'element', elementIds: ['a'], x: 1.1 }, { coordinateSpace: 'element', elementIds: ['a'], y: -.1 },
      { coordinateSpace: 'html', elementIds: ['a'] }, { coordinateSpace: 'html', regionId: 'a' },
      { coordinateSpace: 'board', x: Infinity }, { coordinateSpace: 'board', w: -1 }, { elementIds: ['missing'] },
      { elementIds: ['../a'] }, { regionId: 'missing', sourceRevision: 1 }, { regionId: 'a', sourceRevision: 0 },
    ];
    for (const anchor of invalid) await expect(createFeedback(anchor)).rejects.toHaveProperty('code');
    expect((await service.execute('artifact_feedback', { artifactId, action: 'list' })).feedback).toHaveLength(0);
  });

  it('deduplicates concurrent and restarted create retries with the original frozen source and no extra history', async () => {
    await add({ id: 'a', type: 'html', html: '<h1>Frozen</h1>' });
    const args = { artifactId, action: 'create', operationId: randomUUID(), text: 'One comment', anchor: { coordinateSpace: 'html', regionId: 'a', sourceRevision: 1, x: 10, y: 20 } };
    const other = new StudioService({ dataRoot: directory });
    let first: any;
    try {
      const results = await Promise.all([service.execute('artifact_feedback', args, commenter), other.execute('artifact_feedback', args, commenter)]);
      first = results[0]; expect(results[1].contextId).toBe(first.contextId);
    } finally { await other.close(); }
    await apply([{ op: 'update', id: 'a', changes: { html: '<h2>Current</h2>' } }]);
    const beforeRetry = await read();
    await service.close(); service = new StudioService({ dataRoot: directory });
    const retry = await service.execute('artifact_feedback', args, commenter);
    expect(retry.contextId).toBe(first.contextId); expect(retry.feedback).toHaveLength(1); expect(retry.feedback[0]).not.toHaveProperty('creationReceipt');
    expect(await read()).toEqual(beforeRetry);
    expect((await service.execute('artifact_read', { artifactId, mode: 'context', contextId: first.contextId })).sources[0].html).toBe('<h1>Frozen</h1>');
    await expect(service.execute('artifact_feedback', { ...args, text: 'Different content' }, commenter)).rejects.toMatchObject({ code: 'OPERATION_REUSED' });
    await expect(service.execute('artifact_feedback', args, viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
