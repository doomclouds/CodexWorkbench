import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { StudioService } from '../src/core/service.js';
import { normalizeElement, whiteboardAdapter } from '../src/core/products/whiteboard.js';
import { arrowGeometry } from '../src/core/products/whiteboard-geometry.js';
import { moveOperations } from '../src/app/canvas/canvas-model.js';
import { resizeSelection, rotateSelection } from '../src/app/canvas/native-geometry.js';
import { buildBoardSvg } from '../src/core/serialization.js';
import { DEFAULT_STYLE, type Board, type BoardElement, type Operation } from '../src/contracts/studio.js';
const node = (id: string, x: number): BoardElement => ({ id, type: 'shape', x, y: 0, w: 100, h: 60, version: 1, text: id });
const arrow: BoardElement = { id: 'arrow', type: 'arrow', x: 0, y: 0, w: 1, h: 1, version: 1, from: 'a', to: 'b', bends: [160, 30, 160, 80, 260, 80, 260, 30], label: '布局标签', labelOffset: { x: 17, y: -23 }, labelSize: { w: 180, h: 48 } };
const patch = (elements: BoardElement[], operations: Operation[]) => elements.map(element => ({ ...element, ...operations.find(operation => operation.id === element.id)?.changes }));
let directory = '', service: StudioService;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'studio-layout-labels-')); service = new StudioService({ dataRoot: directory }); });
afterEach(async () => { await service.close(); if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory'); await rm(directory, { recursive: true, force: true }); });

it('keeps the computed label with its line when the whole connected group moves', () => {
  const elements = [node('a', 0), node('b', 300), arrow];
  const before = arrowGeometry(arrow, elements).label;
  const moved = patch(elements, moveOperations(elements, elements.map(item => item.id), { x: 50, y: 70 }));
  expect(moved[2].labelOffset).toEqual(arrow.labelOffset);
  expect(arrowGeometry(moved[2], moved).label).toEqual({ x: before.x + 50, y: before.y + 70 });
  const resized = resizeSelection(elements, elements.map(item => item.id), { x: 0, y: 0, w: 400, h: 100 }, { x: 0, y: 0, w: 800, h: 300 }).find(item => item.id === arrow.id)!;
  expect(resized.changes?.labelOffset).toEqual({ x: 34, y: -69 });
  const rotated = rotateSelection(elements, elements.map(item => item.id), 90).find(item => item.id === arrow.id)!;
  expect(rotated.changes?.labelOffset?.x).toBeCloseTo(23); expect(rotated.changes?.labelOffset?.y).toBeCloseTo(17);
});

it('resets layout label placement on a later manual route or text edit, without changing its message', async () => {
  const created = (await service.execute('artifact_manage', { action: 'create', elements: [node('a', 0), node('b', 300), arrow] })).board as Board;
  const saved = await service.execute('artifact_apply', { artifactId: created.artifact.id, operationId: 'manual-route', expectedRevision: created.artifact.revision, operations: [{ op: 'update', id: 'arrow', changes: { bends: [150, 30, 150, 90, 250, 90, 250, 30] } }] });
  const changed = saved.board.elements.find((item: BoardElement) => item.id === 'arrow');
  expect(changed.label).toBe('布局标签'); expect(changed.labelOffset).toBeUndefined(); expect(changed.labelSize).toBeUndefined();
  const locked = { ...arrow, locked: true };
  const other = (await service.execute('artifact_manage', { action: 'create', elements: [node('a', 0), node('b', 300), locked] })).board as Board;
  const textEdit = await service.execute('artifact_apply', { artifactId: other.artifact.id, operationId: 'locked-label-text', expectedRevision: other.artifact.revision, operations: [{ op: 'update', id: 'arrow', changes: { label: '锁定后仍可修改文字' } }] });
  expect(textEdit.board.elements.find((item: BoardElement) => item.id === 'arrow')).toMatchObject({ label: '锁定后仍可修改文字', labelOffset: arrow.labelOffset, labelSize: arrow.labelSize });
  await expect(service.execute('artifact_apply', { artifactId: other.artifact.id, operationId: 'locked-label', expectedRevision: textEdit.board.artifact.revision, operations: [{ op: 'update', id: 'arrow', changes: { labelOffset: { x: 0, y: 0 } } }] })).rejects.toMatchObject({ code: 'LOCKED' });
});

it('validates layout label geometry and exports the full measured label frame', () => {
  expect(() => normalizeElement({ ...arrow, labelOffset: { x: Infinity, y: 0 } })).toThrow('偏移');
  expect(() => normalizeElement({ ...arrow, labelSize: { w: -1, h: 30 } })).toThrow('尺寸');
  expect(() => whiteboardAdapter.validate({ elements: [{ ...arrow, labelOffset: { x: 0, y: NaN } }], style: DEFAULT_STYLE })).toThrow('偏移');
  const elements = [node('a', 0), node('b', 300), arrow];
  const board: Board = { artifact: { id: 'labels', type: 'whiteboard', title: 'Labels', revision: 1, createdAt: '', updatedAt: '', pinned: false }, elements, style: DEFAULT_STYLE };
  const svg = buildBoardSvg(board), at = arrowGeometry(arrow, elements).label;
  expect(svg).toContain(`x="${at.x - 90}" y="${at.y - 24}" width="180" height="48"`);
  expect(svg).toContain('布局标签');
});
