import { expect, it } from 'vitest';

import type {
  CanvasGeometry,
  CanvasObjectChange,
  CanvasRect,
} from '../../../src/ui/domain/canvas/contracts.js';
import {
  getMoveSnapBounds,
  getTransformBox,
  prepareSnapCandidates,
  previewTransform,
  snapMove as snapPreparedMove,
} from '../../../src/ui/domain/canvas/gestures/index.js';
import type { TransformGesture } from '../../../src/ui/domain/canvas/gestures/index.js';

const initial = { x: 10, y: 20, width: 100, height: 60, rotation: 0 };

function target(id: string, expectedVersion: number, geometry: CanvasGeometry): CanvasObjectChange {
  return { id, expectedVersion, geometry };
}

it('moves all targets by the same world delta and preserves versions', () => {
  const next = { x: -5, y: 8, width: 20, height: 90, rotation: 15 };
  const targets = [target('first', 5, initial), target('next', 12, next)];
  const gesture: TransformGesture = {
    kind: 'move',
    interactionId: 'move-two',
    start: { x: 59, y: 47 },
    targets,
  };

  expect(previewTransform(gesture, { x: 69, y: 27 })).toEqual({
    kind: 'move',
    interactionId: 'move-two',
    delta: { x: 10, y: -20 },
    changes: [
      target('first', 5, { ...initial, x: 20, y: 0 }),
      target('next', 12, { ...next, x: 5, y: -12 }),
    ],
  });
  expect(targets.map((item) => item.geometry)).toEqual([initial, next]);
});

function southwestCorner(geometry: CanvasGeometry) {
  const angle = (geometry.rotation * Math.PI) / 180;
  const centerX = geometry.x + geometry.width / 2;
  const centerY = geometry.y + geometry.height / 2;

  return {
    x: centerX - (geometry.width * Math.cos(angle) + geometry.height * Math.sin(angle)) / 2,
    y: centerY + (geometry.height * Math.cos(angle) - geometry.width * Math.sin(angle)) / 2,
  };
}

it('resizes rotated geometry while preserving the opposite world corner', () => {
  const geometry = { ...initial, rotation: 30 };
  const gesture: TransformGesture = {
    kind: 'resize',
    interactionId: 'rotated-resize',
    start: { x: 50, y: 40 },
    targets: [target('rotated', 4, geometry)],
    handle: 'ne',
  };
  const worldDelta = { x: 10 * Math.sqrt(3) + 5, y: 10 - 5 * Math.sqrt(3) };
  const intent = previewTransform(gesture, { x: 50 + worldDelta.x, y: 40 + worldDelta.y });
  const change = intent?.changes[0];
  if (!change) {
    throw new Error('Missing rotated resize intent.');
  }

  expect(intent.kind).toBe('resize');
  expect(change.expectedVersion).toBe(4);
  expect(change.geometry.width).toBeCloseTo(120);
  expect(change.geometry.height).toBeCloseTo(70);
  expect(change.geometry.rotation).toBe(30);
  const anchor = southwestCorner(change.geometry);
  const originalAnchor = southwestCorner(geometry);
  expect(anchor.x).toBeCloseTo(originalAnchor.x, 9);
  expect(anchor.y).toBeCloseTo(originalAnchor.y, 9);
});

it('clamps a crossed resize at positive minimum dimensions without moving its anchor', () => {
  const gesture: TransformGesture = {
    kind: 'resize',
    interactionId: 'crossed-resize',
    start: { x: 10, y: 20 },
    targets: [target('shape', 7, initial)],
    handle: 'nw',
  };

  expect(previewTransform(gesture, { x: 200, y: 200 })).toEqual({
    kind: 'resize',
    interactionId: 'crossed-resize',
    changes: [target('shape', 7, { x: 86, y: 56, width: 24, height: 24, rotation: 0 })],
  });
});

it('keeps a pre-existing small dimension unchanged when dragging along the other axis', () => {
  const geometry = { ...initial, width: 10 };
  const gesture: TransformGesture = {
    kind: 'resize',
    interactionId: 'small-object',
    start: { x: 20, y: 80 },
    targets: [target('small', 5, geometry)],
    handle: 'se',
  };

  expect(previewTransform(gesture, { x: 20, y: 100 })?.changes[0]?.geometry).toEqual({
    ...geometry,
    height: 80,
  });
});

function pointAt(degrees: number) {
  const radians = (degrees * Math.PI) / 180;

  return { x: 60 + 50 * Math.cos(radians), y: 50 + 50 * Math.sin(radians) };
}

it.each([
  [170, -170, 170, -170],
  [-5, 5, -5, 5],
  [5, -5, 5, -5],
])(
  'rotates from %d to %d around the centre without jumping at angle boundaries',
  (from, to, before, after) => {
    const geometry = { ...initial, rotation: before };
    const gesture: TransformGesture = {
      kind: 'rotate',
      interactionId: 'rotation',
      start: pointAt(from),
      targets: [target('shape', 4, geometry)],
    };
    const intent = previewTransform(gesture, pointAt(to));
    const result = intent?.changes[0]?.geometry;
    expect(intent?.kind).toBe('rotate');
    expect(result).toMatchObject({ x: 10, y: 20, width: 100, height: 60 });
    expect(result?.rotation).toBeCloseTo(after, 9);
    expect(intent?.changes[0]?.expectedVersion).toBe(4);
  },
);

it('returns no intent for unchanged geometry or an undefined angle at the centre', () => {
  const shape = target('shape', 8, initial);
  const move: TransformGesture = {
    kind: 'move',
    interactionId: 'move',
    start: { x: 0, y: 0 },
    targets: [shape],
  };
  expect(previewTransform(move, { x: 0, y: 0 })).toBeUndefined();
  expect(previewTransform({ ...move, targets: [] }, { x: 1, y: 1 })).toBeUndefined();

  const rotate: TransformGesture = {
    ...move,
    kind: 'rotate',
    start: { x: 110, y: 50 },
  };
  expect(previewTransform(rotate, { x: 160, y: 50 })).toBeUndefined();
  expect(previewTransform(rotate, { x: 60, y: 50 })).toBeUndefined();
});

it('returns no intent when both dimensions are already at the resize limit', () => {
  const gesture: TransformGesture = {
    kind: 'resize',
    interactionId: 'already-small',
    start: { x: 34, y: 44 },
    targets: [target('shape', 8, { ...initial, width: 24, height: 24 })],
    handle: 'se',
  };

  expect(previewTransform(gesture, { x: 10, y: 20 })).toBeUndefined();
});

it('rejects non-finite deltas and does not return a partial multi-target edit on overflow', () => {
  const targetWithLargePosition = target('overflow', 3, {
    ...initial,
    x: Number.MAX_VALUE,
  });
  const move: TransformGesture = {
    kind: 'move',
    interactionId: 'invalid-delta',
    start: { x: 0, y: 0 },
    targets: [target('normal', 4, initial), targetWithLargePosition],
  };

  expect(previewTransform(move, { x: Infinity, y: 1 })).toBeUndefined();
  expect(previewTransform(move, { x: Number.MAX_VALUE, y: 0 })).toBeUndefined();
});

it('requires a resize handle and valid dimensions for every transformed target', () => {
  const shape = target('shape', 6, initial);
  const gesture: TransformGesture = {
    kind: 'resize',
    interactionId: 'invalid-shape',
    start: { x: 110, y: 20 },
    targets: [shape],
  };
  const point = { x: 120, y: 15 };
  expect(previewTransform(gesture, point)).toBeUndefined();
  expect(previewTransform({ ...gesture, handle: 'ne', targets: [] }, point)).toBeUndefined();

  const targets = [shape, target('other', 5, { ...initial, x: 170, width: 0 })];
  expect(getTransformBox(targets.map(({ geometry }) => geometry))).toBeUndefined();
  expect(previewTransform({ ...gesture, handle: 'ne', targets }, point)).toBeUndefined();
  expect(previewTransform({ ...gesture, kind: 'rotate', targets }, point)).toBeUndefined();
});

it.each([
  ['nw', { x: -20, y: -10 }, { x: 80, y: 190, width: 120, height: 90 }],
  ['ne', { x: 20, y: -10 }, { x: 100, y: 190, width: 120, height: 90 }],
  ['sw', { x: -20, y: 10 }, { x: 80, y: 200, width: 120, height: 90 }],
  ['se', { x: 20, y: 10 }, { x: 100, y: 200, width: 120, height: 90 }],
  ['w', { x: 200, y: 999 }, { x: 176, y: 200, width: 24, height: 80 }],
  ['e', { x: 20, y: 999 }, { x: 100, y: 200, width: 120, height: 80 }],
  ['n', { x: 999, y: -10 }, { x: 100, y: 190, width: 100, height: 90 }],
  ['s', { x: 999, y: 10 }, { x: 100, y: 200, width: 100, height: 90 }],
] as const)('preserves the opposite anchor and minimum sizes at %s', (handle, point, bounds) => {
  const geometry = { x: 100, y: 200, width: 100, height: 80, rotation: 0 };
  const gesture: TransformGesture = {
    kind: 'resize',
    interactionId: `resize-${handle}`,
    start: { x: 0, y: 0 },
    targets: [target('shape', 5, geometry)],
    handle,
  };

  expect(previewTransform(gesture, point)?.changes[0]?.geometry).toEqual({
    ...bounds,
    rotation: 0,
  });
});

it('uses the local east edge and retains the opposite edge of a 90-degree shape', () => {
  const geometry = { x: 0, y: 0, width: 100, height: 40, rotation: 90 };
  const gesture: TransformGesture = {
    kind: 'resize',
    interactionId: 'resize-rotated-east',
    start: { x: 0, y: 0 },
    targets: [target('shape', 2, geometry)],
    handle: 'e',
  };
  const resized = previewTransform(gesture, { x: 0, y: 50 })?.changes[0]?.geometry;
  if (!resized) {
    throw new Error('Missing local edge resize.');
  }

  expect(resized.width).toBeCloseTo(150);
  expect(resized.height).toBeCloseTo(40);
  expect(resized.x).toBeCloseTo(-25);
  expect(resized.y).toBeCloseTo(25);
  expect(resized.x + resized.width / 2).toBeCloseTo(50);
  expect(resized.y + resized.height / 2 - resized.width / 2).toBeCloseTo(-30);
});

it('combines Shift aspect locking and Alt centre anchoring', () => {
  const gesture: TransformGesture = {
    kind: 'resize',
    interactionId: 'resize-centre',
    start: { x: 110, y: 80 },
    targets: [target('shape', 5, initial)],
    handle: 'se',
  };
  const end = { x: 160, y: 90 };

  expect(previewTransform(gesture, end, { altKey: true })?.changes[0]?.geometry).toEqual({
    ...initial,
    x: -40,
    y: 10,
    width: 200,
    height: 80,
  });
  expect(previewTransform(gesture, end, { shiftKey: true })?.changes[0]?.geometry).toEqual({
    ...initial,
    width: 150,
    height: 90,
  });
  const centered = previewTransform(gesture, end, { altKey: true, shiftKey: true });
  expect(centered?.changes[0]?.geometry).toEqual({
    ...initial,
    x: -40,
    y: -10,
    width: 200,
    height: 120,
  });
});

it('snaps the rotation delta in increments of 15 degrees and preserves the starting rotation', () => {
  const gesture: TransformGesture = {
    kind: 'rotate',
    interactionId: 'rotate-snap',
    start: pointAt(170),
    targets: [target('shape', 5, { ...initial, rotation: 7 })],
  };

  expect(
    previewTransform(gesture, pointAt(-170), { shiftKey: true })?.changes[0]?.geometry,
  ).toEqual({
    ...initial,
    rotation: 22,
  });
  expect(previewTransform(gesture, pointAt(176), { shiftKey: true })).toBeUndefined();
});

it('keeps the ratio when dragging a corner or resizing an edge from the centre', () => {
  const geometry = { ...initial, height: 50 };
  const gesture: TransformGesture = {
    kind: 'resize',
    interactionId: 'resize-with-ratio',
    start: { x: 0, y: 0 },
    targets: [target('shape', 2, geometry)],
    handle: 'se',
  };
  const corner = previewTransform(gesture, { x: 50, y: 5 }, { shiftKey: true });
  const edge = previewTransform(
    { ...gesture, handle: 'e' },
    { x: 20, y: 0 },
    { shiftKey: true, altKey: true },
  );

  expect(corner?.changes[0]?.geometry).toEqual({ ...geometry, width: 150, height: 75 });
  expect(edge?.changes[0]?.geometry).toEqual({
    ...geometry,
    x: -10,
    y: 10,
    width: 140,
    height: 70,
  });
});

it('keeps the operation identity and base version in a centred proportional resize', () => {
  const geometry = { x: 0, y: 0, width: 40, height: 40, rotation: 0 };
  const gesture: TransformGesture = {
    kind: 'resize',
    interactionId: 'resize',
    start: { x: 0, y: 0 },
    targets: [target('shape', 4, geometry)],
    handle: 'se',
  };

  expect(previewTransform(gesture, { x: 20, y: 10 }, { altKey: true, shiftKey: true })).toEqual({
    kind: 'resize',
    interactionId: 'resize',
    changes: [target('shape', 4, { ...geometry, x: -20, y: -20, width: 80, height: 80 })],
  });
});

it('snaps the legacy square rotation gesture to 15 degrees', () => {
  const geometry = { x: 0, y: 0, width: 40, height: 40, rotation: 0 };
  const gesture: TransformGesture = {
    kind: 'rotate',
    interactionId: 'rotate',
    start: { x: 40, y: 20 },
    targets: [target('shape', 4, geometry)],
  };

  expect(previewTransform(gesture, { x: 40, y: 28 }, { shiftKey: true })).toEqual({
    kind: 'rotate',
    interactionId: 'rotate',
    changes: [target('shape', 4, { ...geometry, rotation: 15 })],
  });
});

it('resizes an unrotated selection as a single box while preserving versions', () => {
  const second = { ...initial, x: 170 };
  const gesture: TransformGesture = {
    kind: 'resize',
    interactionId: 'resize-group',
    start: { x: 270, y: 50 },
    targets: [target('first', 3, initial), target('second', 5, second)],
    handle: 'e',
  };

  expect(previewTransform(gesture, { x: 530, y: 80 })?.changes).toEqual([
    target('first', 3, { ...initial, width: 200 }),
    target('second', 5, { ...second, x: 330, width: 200 }),
  ]);
});

it('scales all selected geometry on both axes and leaves its source values intact', () => {
  const shape = Object.freeze({ x: 0, y: 0, width: 100, height: 80, rotation: 0 });
  const ink = Object.freeze({ x: 200, y: 20, width: 40, height: 20, rotation: 0 });
  const content = Object.freeze({ x: 30, y: 30, width: 100, height: 80, rotation: 0 });
  const gesture: TransformGesture = {
    kind: 'resize',
    interactionId: 'resize-mixed-selection',
    start: { x: 0, y: 0 },
    targets: [target('shape', 2, shape), target('ink', 2, ink), target('html', 2, content)],
    handle: 'se',
  };

  expect(previewTransform(gesture, { x: 240, y: 220 })?.changes).toEqual([
    target('shape', 2, { ...shape, width: 200, height: 240 }),
    target('ink', 2, { ...ink, x: 400, y: 60, width: 80, height: 60 }),
    target('html', 2, { ...content, x: 60, y: 90, width: 200, height: 240 }),
  ]);
});

it('uses world AABBs and uniform scaling for a selection containing a rotated object', () => {
  const first = { ...initial, rotation: 90 };
  const second = { ...initial, x: 170 };
  expect(getTransformBox([first])).toEqual(first);
  const box = getTransformBox([first, second]);
  expect(box?.x).toBeCloseTo(30);
  expect(box?.y).toBeCloseTo(0);
  expect(box?.width).toBeCloseTo(240);
  expect(box?.height).toBeCloseTo(100);
  expect(box?.rotation).toBe(0);

  const gesture: TransformGesture = {
    kind: 'resize',
    interactionId: 'resize-rotated-group',
    start: { x: 270, y: 100 },
    targets: [target('first', 3, first), target('second', 5, second)],
    handle: 'se',
  };
  const geometry = previewTransform(gesture, { x: 330, y: 100 })?.changes[0]?.geometry;
  expect(geometry?.x).toBeCloseTo(5);
  expect(geometry?.y).toBeCloseTo(25);
  expect(geometry?.width).toBeCloseTo(125);
  expect(geometry?.height).toBeCloseTo(75);
  expect(geometry?.rotation).toBe(90);
});

it('rotates the centres and angles of a selection around its world bounds', () => {
  const second = { ...initial, x: 170 };
  const gesture: TransformGesture = {
    kind: 'rotate',
    interactionId: 'rotate-group',
    start: { x: 240, y: 50 },
    targets: [target('first', 3, initial), target('second', 5, second)],
  };
  const intent = previewTransform(gesture, { x: 140, y: 150 });
  const [firstResult, secondResult] = intent?.changes ?? [];

  expect(firstResult?.expectedVersion).toBe(3);
  expect(firstResult?.geometry.x).toBeCloseTo(90);
  expect(firstResult?.geometry.y).toBeCloseTo(-60);
  expect(firstResult?.geometry.rotation).toBe(90);
  expect(secondResult?.expectedVersion).toBe(5);
  expect(secondResult?.geometry.x).toBeCloseTo(90);
  expect(secondResult?.geometry.y).toBeCloseTo(100);
  expect(secondResult?.geometry.rotation).toBe(90);
});

it('rotates a member with an existing rotation around the shared centre', () => {
  const first = { x: 50, y: 0, width: 100, height: 40, rotation: 5 };
  const second = { ...first, x: -150, y: -40 };
  const gesture: TransformGesture = {
    kind: 'rotate',
    interactionId: 'rotate-group-member',
    start: { x: 100, y: 0 },
    targets: [target('first', 2, first), target('second', 2, second)],
  };
  const rotated = previewTransform(gesture, { x: 0, y: 100 })?.changes[0]?.geometry;

  expect(rotated?.x).toBeCloseTo(-70);
  expect(rotated?.y).toBeCloseTo(80);
  expect(rotated?.rotation).toBe(95);
});

const moving = { x: 100, y: 100, width: 40, height: 20 };

function snapMove(bounds: CanvasRect, targets: readonly CanvasRect[], zoom: number) {
  return snapPreparedMove(bounds, prepareSnapCandidates(targets), zoom);
}

it('keeps scene order when distinct anchors tie and when anchors share a coordinate', () => {
  const first = { x: 124, y: 330, width: 40, height: 20 };
  const opposite = { x: 56, y: 400, width: 40, height: 20 };
  const duplicate = { ...first, y: 500 };
  const candidates = prepareSnapCandidates([first, opposite, duplicate]);

  expect(snapPreparedMove(moving, candidates, 1)).toEqual({
    offset: { x: 4, y: 0 },
    guides: [{ axis: 'x', at: 124, from: 100, to: 350 }],
  });
});

it('snaps the nearest edge or centre independently in both axes and spans the snapped bounds', () => {
  const right = { x: 144, y: 300, width: 20, height: 20 };
  const below = { x: 300, y: 96, width: 20, height: 20 };
  const farther = { ...right, x: 145 };

  expect(snapMove(moving, [farther, right, below], 1)).toEqual({
    offset: { x: 4, y: -4 },
    guides: [
      { axis: 'x', at: 144, from: 96, to: 320 },
      { axis: 'y', at: 96, from: 104, to: 320 },
    ],
  });
});

it('compares distance in screen pixels using the current zoom', () => {
  const target = { x: 145, y: 300, width: 20, height: 20 };
  const unsnapped = { offset: { x: 0, y: 0 }, guides: [] };

  expect(snapMove(moving, [target], 1).offset.x).toBe(5);
  expect(snapMove(moving, [target], 2)).toEqual(unsnapped);
  expect(snapMove(moving, [target], 0)).toEqual(unsnapped);
});

it('retains the six-pixel snap distance and board-space guide at half, normal and double zoom', () => {
  const current = { x: 96, y: 0, width: 100, height: 80 };
  const candidates = [{ x: 200, y: 30, width: 100, height: 80 }];
  const guides = [{ axis: 'x', at: 200, from: 0, to: 110 }];

  expect(snapMove(current, candidates, 1)).toEqual({ offset: { x: 4, y: 0 }, guides });
  expect(snapMove(current, candidates, 2)).toEqual({ offset: { x: 0, y: 0 }, guides: [] });
  expect(snapMove({ ...current, x: 90 }, candidates, 0.5)).toEqual({
    offset: { x: 10, y: -10 },
    guides: [
      { axis: 'x', at: 200, from: -10, to: 110 },
      { axis: 'y', at: 30, from: 100, to: 300 },
    ],
  });
});

it('keeps an alignment guide when the moving anchor is already on the target', () => {
  const target = { x: 105, y: 300, width: 30, height: 20 };

  expect(snapMove(moving, [target], 1)).toEqual({
    offset: { x: 0, y: 0 },
    guides: [{ axis: 'x', at: 120, from: 100, to: 320 }],
  });
});

it('uses the moved world AABB of the entire selection and maps the snap back to a single edit', () => {
  const first = { ...moving, rotation: 90 };
  const second = { ...moving, x: 200, rotation: 0 };
  const gesture: TransformGesture = {
    kind: 'move',
    interactionId: 'aligned-move',
    start: { x: 0, y: 0 },
    targets: [
      { id: 'first', expectedVersion: 1, geometry: first },
      { id: 'second', expectedVersion: 2, geometry: second },
    ],
  };
  const point = { x: 10, y: 15 };
  const bounds = getMoveSnapBounds(gesture, point);
  if (!bounds) {
    throw new Error('Missing move bounds.');
  }

  expect(bounds).toEqual({ x: 120, y: 105, width: 130, height: 40 });
  const { offset } = snapMove(bounds, [{ x: 255, y: 400, width: 20, height: 20 }], 1);
  const snappedPoint = { x: point.x + offset.x, y: point.y + offset.y };

  expect(previewTransform(gesture, snappedPoint)).toEqual({
    kind: 'move',
    interactionId: 'aligned-move',
    delta: { x: 15, y: 15 },
    changes: [
      { id: 'first', expectedVersion: 1, geometry: { ...first, x: 115, y: 115 } },
      { id: 'second', expectedVersion: 2, geometry: { ...second, x: 215, y: 115 } },
    ],
  });
});
