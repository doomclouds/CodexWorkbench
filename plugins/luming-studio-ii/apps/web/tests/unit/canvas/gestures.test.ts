import { expect, it } from 'vitest';

import type {
  CanvasGeometry,
  CanvasObjectChange,
} from '../../../src/ui/domain/canvas/contracts.js';
import { previewTransform } from '../../../src/ui/domain/canvas/gestures/index.js';
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

it('requires a resize handle and exactly one target for a resize or rotation', () => {
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

  const targets = [shape, target('other', 5, { ...initial, x: 170 })];
  expect(previewTransform({ ...gesture, handle: 'ne', targets }, point)).toBeUndefined();
  expect(previewTransform({ ...gesture, kind: 'rotate', targets }, point)).toBeUndefined();
});
