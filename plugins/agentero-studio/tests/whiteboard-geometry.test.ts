import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { arrowEnd, arrowGeometry, type Point } from '../src/core/products/whiteboard-geometry.js';
import { arrowGeometry as canvasArrowGeometry } from '../src/app/canvas/canvas-model.js';
import { buildBoardSvg } from '../src/core/serialization.js';
import { StudioService } from '../src/core/service.js';
import { DEFAULT_STYLE, type Board, type BoardElement } from '../src/contracts/studio.js';

const node: BoardElement = { id: 'node', type: 'shape', x: 10, y: 20, w: 100, h: 60, version: 1 };
const pointClose = (actual: Point, expected: Point) => { expect(actual.x).toBeCloseTo(expected.x, 9); expect(actual.y).toBeCloseTo(expected.y, 9); };

it('rotates explicit local side ports around the object centre at 90 degrees', () => {
  const rotated = { ...node, rotation: 90 }, other = { x: 400, y: 50 };
  for (const [side, expected] of Object.entries({ left: { x: 60, y: 0 }, right: { x: 60, y: 100 }, top: { x: 90, y: 50 }, bottom: { x: 30, y: 50 } })) pointClose(arrowEnd(rotated, side, other, other), expected);
});

it('keeps explicit oblique ports on their transformed object boundary', () => {
  const diagonal = Math.SQRT1_2, rotated = { ...node, rotation: 45 }, other = { x: 400, y: 400 };
  pointClose(arrowEnd(rotated, 'right', other, other), { x: 60 + 50 * diagonal, y: 50 + 50 * diagonal });
  pointClose(arrowEnd(rotated, 'top', other, other), { x: 60 + 30 * diagonal, y: 50 - 30 * diagonal });
});

it('chooses automatic ports in local space before projecting them into world coordinates', () => {
  const other = { x: 400, y: 50 };
  pointClose(arrowEnd({ ...node, rotation: 90 }, undefined, other, other), { x: 90, y: 50 });
  pointClose(arrowEnd({ ...node, rotation: 90 }, undefined, { x: 60, y: -400 }, other), { x: 60, y: 0 });
  pointClose(arrowEnd({ ...node, rotation: 45 }, undefined, { x: 300, y: 290 }, other), { x: 60 + 50 * Math.SQRT1_2, y: 50 + 50 * Math.SQRT1_2 });
});

it('preserves unrotated side, automatic, free-endpoint and native-bend behaviour', () => {
  const other = { x: 400, y: 50 };
  expect(arrowEnd(node, 'right', other, other)).toEqual({ x: 110, y: 50 });
  expect(arrowEnd(node, undefined, other, other)).toEqual({ x: 110, y: 50 });
  expect(arrowEnd({ ...node, rotation: 360 }, 'right', other, other)).toEqual({ x: 110, y: 50 });
  expect(arrowEnd(undefined, 'right', other, { x: -20, y: -30 })).toEqual({ x: -20, y: -30 });
  const a = { ...node, id: 'a', x: 0, y: 0, h: 80 }, b = { ...a, id: 'b', x: 400, y: 200 };
  const edge: BoardElement = { ...node, id: 'edge', type: 'arrow', from: 'a', to: 'b', bends: ['v', 65, -160, -75] };
  expect(arrowGeometry(edge, [a, b]).points).toEqual([{ x: 50, y: 80 }, { x: 50, y: 105 }, { x: -110, y: 105 }, { x: -110, y: 165 }, { x: 450, y: 165 }, { x: 450, y: 200 }]);
});

it('shares rotated connector endpoints and paths between Canvas and SVG export, including isolated arrows', () => {
  const a = { ...node, id: 'a', rotation: 90 }, b = { ...node, id: 'b', x: 400, y: 200, rotation: 45 };
  const edge: BoardElement = { ...node, id: 'edge', type: 'arrow', from: 'a', to: 'b', fromSide: 'right', toSide: 'left', bends: ['h', 150, 50] };
  const geometry = canvasArrowGeometry(edge, [a, b]);
  pointClose(geometry.points[0]!, { x: 60, y: 100 });
  pointClose(geometry.points.at(-1)!, { x: 450 - 50 * Math.SQRT1_2, y: 230 - 50 * Math.SQRT1_2 });
  const board: Board = { artifact: { id: 'board', type: 'whiteboard', title: 'Rotated ports', revision: 1, createdAt: '', updatedAt: '', pinned: false }, style: DEFAULT_STYLE, elements: [a, b, edge] };
  const xml = new JSDOM(buildBoardSvg(board, { ids: ['edge'] }), { contentType: 'image/svg+xml' }).window.document;
  expect(xml.querySelector('[data-studio-id="edge"] path')?.getAttribute('d')).toBe(geometry.path);
  expect(geometry).toEqual(arrowGeometry(edge, [a, b]));
});

it('rejects rotating a node when that would move an attached locked arrow and leaves the transaction unchanged', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'studio-rotated-arrow-lock-')), service = new StudioService({ dataRoot: folder });
  try {
    const a = { ...node, id: 'a' }, b = { ...node, id: 'b', x: 400, y: 200 };
    const edge = { ...node, id: 'edge', type: 'arrow', from: 'a', to: 'b', fromSide: 'right', locked: true };
    const created = await service.execute('artifact_manage', { action: 'create', elements: [a, b, edge] });
    await expect(service.execute('artifact_apply', { artifactId: created.artifact.id, expectedVersions: { a: 1 }, operations: [{ op: 'update', id: 'a', changes: { rotation: 90 } }] })).rejects.toMatchObject({ code: 'LOCKED', details: { elementId: 'edge' } });
    expect(await service.execute('artifact_read', { artifactId: created.artifact.id, mode: 'board' })).toEqual(created.board);
  } finally {
    await service.close(); expect(resolve(folder).startsWith(resolve(tmpdir()) + sep)).toBe(true); await rm(folder, { recursive: true, force: true });
  }
});
