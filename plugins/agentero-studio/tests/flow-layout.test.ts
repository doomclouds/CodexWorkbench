import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { StudioService } from '../src/core/service.js';
import type { Board, BoardElement, Operation } from '../src/contracts/studio.js';
import type { FlowLayoutPreview } from '../src/contracts/layout.js';
import { prepareFlowLayout, finishFlowLayout } from '../src/core/products/flow-layout.js';
import { FlowLayoutJobs } from '../src/core/products/flow-layout-jobs.js';
import { arrowGeometry } from '../src/core/products/whiteboard-geometry.js';

const box = (id: string, x = 0, y = 0, extra: Partial<BoardElement> = {}): BoardElement => ({ id, type: 'shape', x, y, w: 140, h: 80, text: id, version: 1, ...extra });
const edge = (id: string, from: string, to: string, extra: Partial<BoardElement> = {}) => box(id, 0, 0, { type: 'arrow', from, to, ...extra });
const patch = (elements: BoardElement[], operations: Operation[]) => elements.map(item => ({ ...item, ...operations.find(operation => operation.id === item.id)?.changes }));
let service: StudioService | undefined, directory = '';
afterEach(async () => { await service?.close(); service = undefined; if (directory) { if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected fixture path'); await rm(directory, { recursive: true, force: true }); directory = ''; } });
async function fixture(elements: BoardElement[]) {
  directory = await mkdtemp(join(tmpdir(), 'studio-flow-layout-'));
  service = new StudioService({ dataRoot: directory });
  return (await service.execute('artifact_manage', { action: 'create', elements })).board as Board;
}

it.each(['right', 'down'] as const)('runs real layered %s layout with branch, merge, return edge, self-loop, fixed ports and measured labels', async direction => {
  const elements = [box('a', 200, 200, { w: 200, h: 100 }), box('b', 60, 10), box('c', 80, 15, { w: 100, h: 140 }), box('d', 20, 20), box('isolated', 10, 40), edge('ab', 'a', 'b', { label: '较长的标签，参与路由测量' }), edge('ac', 'a', 'c'), edge('bd', 'b', 'd'), edge('cd', 'c', 'd'), edge('return', 'd', 'a', { fromSide: 'bottom', toSide: 'top' }), edge('self', 'd', 'd', { fromSide: 'right', toSide: 'bottom' })];
  const prepared = prepareFlowLayout(elements, { ids: elements.map(item => item.id), direction, requestId: 'real-layout', labelSizes: { ab: { w: 180, h: 48 } } });
  const jobs = new FlowLayoutJobs();
  try {
    const result = await jobs.run('board', 'owner', 'real-layout', prepared.graph!);
    expect(result.threadId).toBeGreaterThan(0);
    const preview = finishFlowLayout(prepared, result.graph);
    expect(preview.skipped).toEqual([]); expect(preview.operations).toHaveLength(elements.length);
    const next = patch(elements, preview.operations), a = next.find(item => item.id === 'a')!, b = next.find(item => item.id === 'b')!, d = next.find(item => item.id === 'd')!;
    expect(direction === 'right' ? b.x > a.x && d.x > b.x : b.y > a.y && d.y > b.y).toBe(true);
    expect(next.find(item => item.id === 'return')).toMatchObject({ from: 'd', to: 'a', fromSide: 'bottom', toSide: 'top' });
    expect(next.find(item => item.id === 'ab')).toMatchObject({ label: elements[5].label, labelSize: { w: 180, h: 48 }, labelOffset: { x: expect.any(Number), y: expect.any(Number) } });
    for (const arrow of next.filter(item => item.type === 'arrow')) {
      const points = arrowGeometry(arrow, next).points;
      expect(points.length).toBeGreaterThanOrEqual(2);
      expect(points.every((point, index) => !index || Math.abs(point.x - points[index - 1].x) < .001 || Math.abs(point.y - points[index - 1].y) < .001)).toBe(true);
      expect((arrow.bends?.length ?? 0)).toBeLessThanOrEqual(24);
    }
    expect(jobs.activeCount).toBe(0);
  } finally { await jobs.close(); }
}, 15_000);

it('does not write during preview, returns external dependency versions, and applies once through normal CAS/history', async () => {
  const board = await fixture([box('a'), box('b', 10, 10), box('outside', 900), edge('ab', 'a', 'b'), edge('cross', 'b', 'outside')]);
  const id = board.artifact.id, original = await service!.store.read(id);
  const preview = await service!.execute('artifact_read', { artifactId: id, mode: 'layout-preview', ids: ['a', 'b'], requestId: 'service-preview', direction: 'right' }) as FlowLayoutPreview;
  expect((await service!.store.read(id))).toEqual(original);
  expect(preview.boundaryIds).toEqual(['cross']); expect(preview.expectedVersions).toMatchObject({ a: 1, b: 1, ab: 1, outside: 1, cross: 1 });
  expect(preview.operations.some(item => ['outside', 'cross'].includes(item.id!))).toBe(false);
  const saved = await service!.execute('artifact_apply', { artifactId: id, operationId: 'apply-preview', expectedVersions: preview.expectedVersions, operations: preview.operations });
  expect(saved.board.artifact.revision).toBe(board.artifact.revision + 1);
  expect(saved.board.elements.find((item: BoardElement) => item.id === 'outside')).toEqual(board.elements[2]);
  const undone = await service!.execute('artifact_apply', { artifactId: id, operationId: 'undo-preview', expectedRevision: saved.board.artifact.revision, operations: [{ op: 'restore', versionId: saved.historyEntry.id, data: { mode: 'undo' } }] });
  for (const item of board.elements) {
    const { version: _beforeVersion, ...before } = item;
    const { version: _afterVersion, ...after } = undone.board.elements.find((next: BoardElement) => next.id === item.id);
    expect(after).toEqual(before);
  }
});

it('rejects a stale preview if even an external bound endpoint changed', async () => {
  const board = await fixture([box('a'), box('b', 10, 10), box('outside', 900), edge('ab', 'a', 'b'), edge('cross', 'b', 'outside')]);
  const id = board.artifact.id;
  const preview = await service!.execute('artifact_read', { artifactId: id, mode: 'layout-preview', ids: ['a', 'b'], requestId: 'stale-preview' }) as FlowLayoutPreview;
  await service!.execute('artifact_apply', { artifactId: id, expectedVersions: { outside: 1 }, operations: [{ op: 'update', id: 'outside', changes: { x: 1100 } }] });
  await expect(service!.execute('artifact_apply', { artifactId: id, expectedVersions: preview.expectedVersions, operations: preview.operations })).rejects.toMatchObject({ code: 'CONFLICT' });
});

it('invalidates a preview when a new relationship is added without changing existing node versions', async () => {
  const board = await fixture([box('a'), box('b'), edge('ab', 'a', 'b')]);
  const id = board.artifact.id;
  const preview = await service!.execute('artifact_read', { artifactId: id, mode: 'layout-preview', ids: ['a', 'b'], requestId: 'new-relationship' }) as FlowLayoutPreview;
  expect(preview.expectedVersions.$order).toBe(board.orderVersion);
  await service!.execute('artifact_apply', { artifactId: id, operations: [{ op: 'add', element: edge('ba', 'b', 'a') }] });
  await expect(service!.execute('artifact_apply', { artifactId: id, expectedVersions: preview.expectedVersions, operations: preview.operations })).rejects.toMatchObject({ code: 'CONFLICT', details: { elementId: '$order' } });
});

it.each(['rebind', 'become-arrow'] as const)('rejects a stale real worker preview after an existing outside object changes topology via %s', async change => {
  const board = await fixture([box('a'), box('b', 10, 10), edge('ab', 'a', 'b'), box('outside-a', 900), box('outside-b', 1200), edge('outside-edge', 'outside-a', 'outside-b'), box('outside-shape', 1500)]);
  const id = board.artifact.id;
  const preview = await service!.execute('artifact_read', { artifactId: id, mode: 'layout-preview', ids: ['a', 'b'], requestId: `outside-${change}` }) as FlowLayoutPreview;
  expect(preview.operations.length).toBeGreaterThan(0);
  const target = change === 'rebind' ? 'outside-edge' : 'outside-shape';
  const update = await service!.execute('artifact_apply', { artifactId: id, expectedVersions: { [target]: 1 }, operations: [{ op: 'update', id: target, changes: change === 'rebind' ? { from: 'a' } : { type: 'arrow', from: 'b', to: 'outside-a' } }] });
  const changed = await service!.store.read(id);
  expect(update.board.orderVersion).toBe(board.orderVersion);
  await expect(service!.execute('artifact_apply', { artifactId: id, expectedVersions: preview.expectedVersions, operations: preview.operations })).rejects.toMatchObject({ code: 'CONFLICT', details: { elementId: target } });
  expect(await service!.store.read(id)).toEqual(changed);
});

it('skips locked components including cross-boundary locked arrows, without moving an independent component', async () => {
  const elements = [box('a'), box('b', 20, 20), box('c', 40, 40), box('d', 60, 60), box('outside', 900), edge('ab', 'a', 'b'), edge('cross', 'a', 'outside', { locked: true }), edge('cd', 'c', 'd')];
  const prepared = prepareFlowLayout(elements, { ids: ['a', 'b', 'c', 'd'], requestId: 'locked-component' });
  expect(prepared.skipped.flatMap(item => item.ids)).toEqual(expect.arrayContaining(['a', 'b']));
  const jobs = new FlowLayoutJobs();
  try {
    const result = await jobs.run('board', 'owner', 'locked-component', prepared.graph!);
    const preview = finishFlowLayout(prepared, result.graph);
    expect(preview.operations.map(item => item.id)).toEqual(expect.arrayContaining(['c', 'd', 'cd']));
    expect(preview.operations.some(item => ['a', 'b', 'ab', 'cross', 'outside'].includes(item.id!))).toBe(false);
  } finally { await jobs.close(); }
});

it('rejects unsupported route conversion instead of truncating bends or silently using a different route', () => {
  const prepared = prepareFlowLayout([box('a'), box('b'), edge('ab', 'a', 'b')], { ids: ['a', 'b'], requestId: 'long-route' });
  const graph = structuredClone(prepared.graph!);
  graph.children!.forEach((item, index) => { item.x = index * 300; item.y = index * 80; });
  let cursor = { x: 140, y: 40 };
  const bends = Array.from({ length: 16 }, (_, index) => cursor = { x: cursor.x + (index % 2 ? 0 : 10), y: cursor.y + (index % 2 ? 10 : 0) });
  graph.edges![0].sections = [{ id: 's', startPoint: { x: 140, y: 40 }, endPoint: { x: 300, y: 120 }, bendPoints: bends }];
  const preview = finishFlowLayout(prepared, graph);
  expect(preview.operations).toEqual([]); expect(preview.skipped[0].reason).toMatch(/路径/);
});

it('really terminates requested workers, namespaces cancellation, bounds capacity and stops active jobs on close', async () => {
  const graph = prepareFlowLayout([box('a'), box('b'), edge('ab', 'a', 'b')], { ids: ['a', 'b'], requestId: 'jobs' }).graph!;
  const jobs = new FlowLayoutJobs();
  const first = jobs.run('board', 'owner', 'one', graph), second = jobs.run('board', 'owner', 'two', graph);
  const firstError = expect(first).rejects.toMatchObject({ code: 'LAYOUT_CANCELLED' }), secondError = expect(second).rejects.toMatchObject({ code: 'LAYOUT_CANCELLED' });
  expect(jobs.activeCount).toBe(2);
  await expect(jobs.run('board', 'owner', 'three', graph)).rejects.toMatchObject({ code: 'BUSY' });
  expect(await jobs.cancel('board', 'other-owner', 'one')).toBe(false);
  expect(await jobs.cancel('board', 'owner', 'one')).toBe(true); await firstError;
  await jobs.close(); await secondError; expect(jobs.activeCount).toBe(0);
  await expect(jobs.run('board', 'owner', 'after-close', graph)).rejects.toMatchObject({ code: 'CLOSED' });
});

it('retains HTML data as an opaque outer box, reports unsupported nested groups and validates preview inputs', () => {
  const html = box('html', 0, 0, { type: 'html', html: '<p>Preserved source</p>' });
  const prepared = prepareFlowLayout([html, box('b'), box('nested', 0, 0, { groupId: 'g' }), edge('html-b', 'html', 'b')], { ids: ['html', 'b', 'nested'], requestId: 'opaque' });
  expect(prepared.graph!.children!.some(item => item.id === 'n:html')).toBe(true);
  expect(JSON.stringify(prepared.graph)).not.toContain('Preserved source');
  expect(prepared.skipped.flatMap(item => item.ids)).toContain('nested');
  for (const args of [{ ids: [], requestId: 'invalid' }, { ids: ['html'], requestId: 'invalid', direction: 'up' }, { ids: ['html'], requestId: 'invalid', gap: -1 }, { ids: ['html'], requestId: 'invalid', labelSizes: { a: { w: NaN, h: 10 } } }]) expect(() => prepareFlowLayout([html], args)).toThrow();
  const empty = finishFlowLayout(prepareFlowLayout([edge('line', 'a', 'b')], { ids: ['line'], requestId: 'no-nodes' }));
  expect(empty.operations).toEqual([]); expect(empty.skipped[0].reason).toContain('不单独排布');
});

it('cancels through the service API even if cancellation overtakes snapshot preparation, and enforces editor authority', async () => {
  const board = await fixture([box('a'), box('b'), edge('ab', 'a', 'b')]);
  const args = { artifactId: board.artifact.id, mode: 'layout-preview', ids: ['a', 'b'], requestId: 'cancel-via-service' };
  const pending = service!.execute('artifact_read', args);
  const rejected = expect(pending).rejects.toMatchObject({ code: 'LAYOUT_CANCELLED' });
  await service!.execute('artifact_read', { artifactId: board.artifact.id, mode: 'layout-cancel', requestId: args.requestId });
  await rejected;
  await expect(service!.execute('artifact_read', { ...args, requestId: 'viewer' }, { ...service!.owner, role: 'viewer' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('keeps the service event loop responsive during a nontrivial real worker layout', async () => {
  const nodes = Array.from({ length: 80 }, (_, index) => box(`node-${index}`, index % 5 * 10, Math.floor(index / 5) * 10));
  const edges = nodes.slice(1).map((node, index) => edge(`edge-${index}`, nodes[index].id, node.id));
  const prepared = prepareFlowLayout([...nodes, ...edges], { ids: nodes.map(item => item.id), requestId: 'responsiveness' });
  const jobs = new FlowLayoutJobs(); let ticks = 0;
  const timer = setInterval(() => ticks++, 2);
  try {
    const result = await jobs.run('board', 'owner', 'responsiveness', prepared.graph!);
    expect(result.threadId).toBeGreaterThan(0);
    const preview = finishFlowLayout(prepared, result.graph);
    const laidOut = patch([...nodes, ...edges], preview.operations);
    expect(laidOut.find(item => item.id === 'node-79')!.x).toBeGreaterThan(laidOut.find(item => item.id === 'node-0')!.x + 79 * 140);
    expect(preview.operations.some(operation => !Object.entries(operation.changes ?? {}).some(([field, value]) => JSON.stringify(prepared.elements.find(item => item.id === operation.id)?.[field]) !== JSON.stringify(value)))).toBe(false);
    expect(ticks).toBeGreaterThan(2);
  } finally { clearInterval(timer); await jobs.close(); }
}, 15_000);
