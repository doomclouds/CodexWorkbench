import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { JSDOM } from 'jsdom';
import {
  createStudioService,
  type ComposedStudioService,
} from '../../src/server/studio-composition.js';
import { normalizeElement, whiteboardAdapter } from '../../src/core/products/whiteboard.js';
import { arrowGeometry } from '../../src/shared/whiteboard-geometry.js';
import { moveOperations } from '../../src/app/features/whiteboard/canvas/scene/canvas-model.js';
import {
  resizeSelection,
  rotateSelection,
} from '../../src/app/features/whiteboard/canvas/scene/native-geometry.js';
import { buildBoardSvg, buildBoardHtml } from '../../src/shared/serialization.js';
import { exportArtifact } from '../support/rendering.js';
import {
  DEFAULT_STYLE,
  type Board,
  type BoardElement,
  type Operation,
} from '../../src/contracts/studio.js';

const node = (id: string, x: number): BoardElement => ({
  id,
  type: 'shape',
  x,
  y: 0,
  w: 100,
  h: 60,
  version: 1,
  text: id,
});
const arrow: BoardElement = {
  id: 'arrow',
  type: 'arrow',
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  version: 1,
  from: 'a',
  to: 'b',
  bends: [160, 30, 160, 80, 260, 80, 260, 30],
  label: '布局标签',
  labelOffset: { x: 17, y: -23 },
  labelSize: { w: 180, h: 48 },
};
const patch = (elements: BoardElement[], operations: Operation[]) =>
  elements.map((element) => ({
    ...element,
    ...operations.find((operation) => operation.id === element.id)?.changes,
  }));
let directory = '';
let service: ComposedStudioService;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-layout-labels-'));
  service = createStudioService({ dataRoot: directory });
});
afterEach(async () => {
  await service.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) {
    throw new Error('Unexpected test directory');
  }

  await rm(directory, { recursive: true, force: true });
});

it('keeps the computed label with its line when the whole connected group moves', () => {
  const elements = [node('a', 0), node('b', 300), arrow];
  const before = arrowGeometry(arrow, elements).label;
  const moved = patch(
    elements,
    moveOperations(
      elements,
      elements.map((item) => item.id),
      { x: 50, y: 70 },
    ),
  );
  expect(moved[2].labelOffset).toEqual(arrow.labelOffset);
  expect(arrowGeometry(moved[2], moved).label).toEqual({ x: before.x + 50, y: before.y + 70 });
  const resized = resizeSelection(
    elements,
    elements.map((item) => item.id),
    { x: 0, y: 0, w: 400, h: 100 },
    { x: 0, y: 0, w: 800, h: 300 },
  ).find((item) => item.id === arrow.id)!;
  expect(resized.changes?.labelOffset).toEqual({ x: 34, y: -69 });
  const rotated = rotateSelection(
    elements,
    elements.map((item) => item.id),
    90,
  ).find((item) => item.id === arrow.id)!;
  expect(rotated.changes?.labelOffset?.x).toBeCloseTo(23);
  expect(rotated.changes?.labelOffset?.y).toBeCloseTo(17);
});

it('resets layout label placement on a later manual route or text edit, without changing its message', async () => {
  const created = (
    await service.execute('artifact_manage', {
      action: 'create',
      elements: [node('a', 0), node('b', 300), arrow],
    })
  ).board as Board;
  const saved = await service.execute('artifact_apply', {
    artifactId: created.artifact.id,
    operationId: 'manual-route',
    expectedRevision: created.artifact.revision,
    operations: [
      { op: 'update', id: 'arrow', changes: { bends: [150, 30, 150, 90, 250, 90, 250, 30] } },
    ],
  });
  const changed = saved.board.elements.find((item: BoardElement) => item.id === 'arrow');
  expect(changed.label).toBe('布局标签');
  expect(changed.labelOffset).toBeUndefined();
  expect(changed.labelSize).toBeUndefined();
  const locked = { ...arrow, locked: true };
  const other = (
    await service.execute('artifact_manage', {
      action: 'create',
      elements: [node('a', 0), node('b', 300), locked],
    })
  ).board as Board;
  const textEdit = await service.execute('artifact_apply', {
    artifactId: other.artifact.id,
    operationId: 'locked-label-text',
    expectedRevision: other.artifact.revision,
    operations: [{ op: 'update', id: 'arrow', changes: { label: '锁定后仍可修改文字' } }],
  });
  expect(textEdit.board.elements.find((item: BoardElement) => item.id === 'arrow')).toMatchObject({
    label: '锁定后仍可修改文字',
    labelOffset: arrow.labelOffset,
    labelSize: arrow.labelSize,
  });
  await expect(
    service.execute('artifact_apply', {
      artifactId: other.artifact.id,
      operationId: 'locked-label',
      expectedRevision: textEdit.board.artifact.revision,
      operations: [{ op: 'update', id: 'arrow', changes: { labelOffset: { x: 0, y: 0 } } }],
    }),
  ).rejects.toMatchObject({ code: 'LOCKED' });
});

it('validates layout label geometry and exports the full measured label frame', () => {
  expect(() => normalizeElement({ ...arrow, labelOffset: { x: Infinity, y: 0 } })).toThrow('偏移');
  expect(() => normalizeElement({ ...arrow, labelSize: { w: -1, h: 30 } })).toThrow('尺寸');
  expect(() =>
    whiteboardAdapter.validate({
      elements: [{ ...arrow, labelOffset: { x: 0, y: NaN } }],
      style: DEFAULT_STYLE,
    }),
  ).toThrow('偏移');
  const elements = [node('a', 0), node('b', 300), arrow];
  const board: Board = {
    artifact: {
      id: 'labels',
      type: 'whiteboard',
      title: 'Labels',
      revision: 1,
      createdAt: '',
      updatedAt: '',
      pinned: false,
    },
    elements,
    style: DEFAULT_STYLE,
  };
  const svg = buildBoardSvg(board);
  const at = arrowGeometry(arrow, elements).label;
  expect(svg).toContain(`x="${at.x - 90}" y="${at.y - 24}" width="180" height="48"`);
  expect(svg).toContain('布局标签');
});

it.each([
  { offset: { x: 17, y: 300 }, size: { w: 180, h: 48 } },
  { offset: { x: -480, y: -180 }, size: { w: 320, h: 96 } },
  { offset: { x: 500, y: 150 }, size: undefined },
])(
  'keeps the actual offset label box inside SVG, HTML and PNG export surfaces: $offset',
  async ({ offset, size }) => {
    const elements = [
      node('a', 0),
      node('b', 300),
      { ...arrow, labelOffset: offset, labelSize: size },
    ];
    const board: Board = {
      artifact: {
        id: 'label-bounds',
        type: 'whiteboard',
        title: 'Offset label',
        revision: 1,
        createdAt: '',
        updatedAt: '',
        pinned: false,
      },
      elements,
      style: DEFAULT_STYLE,
    };
    const assertLabelInside = (svg: Element) => {
      const [x, y, width, height] = svg.getAttribute('viewBox')!.split(/\s+/).map(Number);
      const rect = svg.querySelector('[data-studio-id="arrow"] > rect')!;
      expect(rect).not.toBeNull();
      const label = Object.fromEntries(
        ['x', 'y', 'width', 'height'].map((key) => [key, Number(rect.getAttribute(key))]),
      );
      expect(label.x).toBeGreaterThanOrEqual(x);
      expect(label.y).toBeGreaterThanOrEqual(y);
      expect(label.x + label.width).toBeLessThanOrEqual(x + width);
      expect(label.y + label.height).toBeLessThanOrEqual(y + height);

      return { width, height };
    };

    for (const ids of [undefined, ['arrow']]) {
      const svg = new JSDOM(buildBoardSvg(board, { ids, padding: 0 }), {
        contentType: 'image/svg+xml',
      }).window.document.documentElement;
      const bounds = assertLabelInside(svg);
      const html = new JSDOM(buildBoardHtml(board, { ids })).window.document;
      const layer = html.querySelector('svg:has([data-studio-id="arrow"])')!;
      assertLabelInside(layer);
      const png = await exportArtifact(board, 'png', { ids, padding: 0 });
      const image = Buffer.from(png.data, 'base64');
      expect(image.readUInt32BE(16)).toBe(bounds.width);
      expect(image.readUInt32BE(20)).toBe(bounds.height);
    }
  },
);
