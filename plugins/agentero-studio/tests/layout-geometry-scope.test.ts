import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { StudioService } from '../src/core/service.js';
import { geometryBounds, selectionBounds } from '../src/app/canvas/native-geometry.js';
import { elementBounds, fitViewport } from '../src/app/canvas/canvas-model.js';
import { arrowGeometry } from '../src/core/products/whiteboard-geometry.js';
import type { Actor, AgentActivityScope, AgentTask, Board, BoardElement } from '../src/contracts/studio.js';

const first: Actor = { id: 'layout-scope-first', name: '布局 Agent', kind: 'agent', role: 'owner' };
const second: Actor = { id: 'layout-scope-second', name: '另一 Agent', kind: 'agent', role: 'owner' };
const box = (id: string, x: number): BoardElement => ({ id, type: 'shape', x, y: 20, w: 80, h: 60, version: 1, text: id });
const line = (extra: Partial<BoardElement> = {}): BoardElement => ({ id: 'edge', type: 'arrow', x: 0, y: 0, w: 1, h: 1, version: 1, from: 'a', to: 'b', fromSide: 'right', toSide: 'left', label: '范围标签', ...extra });
let directory = '', service: StudioService;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'studio-label-scope-')); service = new StudioService({ dataRoot: directory }); });
afterEach(async () => { await service.close(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected fixture path'); await rm(directory, { recursive: true, force: true }); });
async function create() { return (await service.execute('artifact_manage', { action: 'create', elements: [box('a', 20), box('b', 260), line()] })).board as Board; }
async function begin(board: Board, taskId: string, scope: AgentActivityScope, actor = first) {
  const result = await service.execute('artifact_activity', { artifactId: board.artifact.id, action: 'begin', taskId, scope }, actor);
  return (result.tasks as AgentTask[]).find(task => task.taskId === taskId)!;
}
const changes = [
  { labelOffset: { x: 0, y: 300 }, labelSize: { w: 180, h: 48 } },
  { labelOffset: { x: 0, y: 300 } },
  { labelSize: { w: 180, h: 600 } },
] satisfies Partial<BoardElement>[];

it.each(changes)('rejects a label outside a rect workspace without persisting any part of the edit: %j', async patch => {
  const board = await create(), task = await begin(board, 'bounded', { rect: { x: 0, y: 0, w: 400, h: 120 } });
  const before = await readFile(service.store.file(board.artifact.id), 'utf8');
  await expect(service.execute('artifact_apply', { artifactId: board.artifact.id, taskId: task.taskId, generation: task.generation, operationId: 'outside-label', expectedVersions: { edge: 1 }, operations: [{ op: 'update', id: 'edge', changes: patch }] }, first)).rejects.toMatchObject({ code: 'TASK_SCOPE' });
  expect(await readFile(service.store.file(board.artifact.id), 'utf8')).toBe(before);
});

it.each(changes)('keeps independent label fields valid when the whole visible arrow fits the declared rect: %j', async patch => {
  const board = await create(), task = await begin(board, 'wide-enough', { rect: { x: -500, y: -500, w: 1600, h: 1600 } });
  const saved = await service.execute('artifact_apply', { artifactId: board.artifact.id, taskId: task.taskId, generation: task.generation, operationId: 'inside-label', expectedVersions: { edge: 1 }, operations: [{ op: 'update', id: 'edge', changes: patch }] }, first);
  expect(saved.board.elements.find((element: BoardElement) => element.id === 'edge')).toMatchObject(patch);
});

it('rejects a label entering another reserved area even when the writer owns the arrow by explicit ID', async () => {
  const board = await create(), own = await begin(board, 'own-arrow', { ids: ['edge'] });
  await begin(board, 'reserved-area', { rect: { x: 80, y: 300, w: 200, h: 100 } }, second);
  const before = await readFile(service.store.file(board.artifact.id), 'utf8');
  await expect(service.execute('artifact_apply', { artifactId: board.artifact.id, taskId: own.taskId, generation: own.generation, operationId: 'into-reservation', expectedVersions: { edge: 1 }, operations: [{ op: 'update', id: 'edge', changes: changes[0] }] }, first)).rejects.toMatchObject({ code: 'TASK_SCOPE_CONFLICT' });
  expect(await readFile(service.store.file(board.artifact.id), 'utf8')).toBe(before);
});

it('preserves explicit ID ownership without inventing endpoint ownership or a rect constraint', async () => {
  const board = await create(), own = await begin(board, 'id-only', { ids: ['edge'] });
  const saved = await service.execute('artifact_apply', { artifactId: board.artifact.id, taskId: own.taskId, generation: own.generation, operationId: 'move-owned-label', expectedVersions: { edge: 1 }, operations: [{ op: 'update', id: 'edge', changes: changes[0] }] }, first);
  expect(saved.board.elements.find((element: BoardElement) => element.id === 'edge')).toMatchObject(changes[0]);
  expect(saved.board.elements.filter((element: BoardElement) => element.type !== 'arrow')).toEqual(board.elements.filter(element => element.type !== 'arrow'));
});

it('includes the same measured label box in native selection, element bounds and both fit inputs', () => {
  const arrow = line(changes[0]), scene = [box('a', 20), box('b', 260), arrow];
  const centre = arrowGeometry(arrow, scene).label;
  const label = { x: centre.x - 90, y: centre.y - 24, w: 180, h: 48 };
  for (const outer of [geometryBounds(arrow, scene), elementBounds(arrow, scene), selectionBounds(scene, ['edge'])!]) {
    expect(outer.x).toBeLessThanOrEqual(label.x); expect(outer.y).toBeLessThanOrEqual(label.y);
    expect(outer.x + outer.w).toBeGreaterThanOrEqual(label.x + label.w); expect(outer.y + outer.h).toBeGreaterThanOrEqual(label.y + label.h);
  }
  const width = 360, height = 280, padding = 30;
  for (const values of [scene, [selectionBounds(scene, ['edge'])!]]) {
    const view = fitViewport(values, width, height, padding);
    expect(view.x + label.x * view.zoom).toBeGreaterThanOrEqual(padding - 1e-6);
    expect(view.y + label.y * view.zoom).toBeGreaterThanOrEqual(padding - 1e-6);
    expect(view.x + (label.x + label.w) * view.zoom).toBeLessThanOrEqual(width - padding + 1e-6);
    expect(view.y + (label.y + label.h) * view.zoom).toBeLessThanOrEqual(height - padding + 1e-6);
  }
});
