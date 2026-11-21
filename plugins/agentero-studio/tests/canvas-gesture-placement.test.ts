import { describe, expect, it } from 'vitest';
import type { BoardElement } from '../src/contracts/studio.js';
import {
  arrowPointOperations,
  creationPlacement,
  finalizeDrawing,
  finalizeGesturePlacement,
  geometryCommit,
  resizeGestureOperations,
  rotateGestureOperations,
  type Gesture,
} from '../src/app/canvas/canvas-gesture-placement.js';

const box = { x: 0, y: 0, w: 40, h: 40 };
const origin = { x: 0, y: 0 };
const element: BoardElement = { ...box, id: 'shape', type: 'shape', version: 4 };
const modifiers = { altKey: true, shiftKey: true };

describe('canvas gesture geometry', () => {
  it('uses the same geometry for centered proportional preview and pointer release', () => {
    const resizing: Extract<Gesture, { kind: 'resize' }> = {
      kind: 'resize',
      start: origin,
      elements: [element],
      ids: [element.id],
      box,
      handle: 'se',
      operations: [],
      operationId: 'resize',
      baseRevision: 5,
    };
    const point = { x: 20, y: 10 };
    const preview = resizeGestureOperations(resizing, point, modifiers);

    expect(preview[0]?.changes).toMatchObject({ x: -20, y: -20, w: 80, h: 80 });
    expect(
      finalizeGesturePlacement(resizing, { point, screen: point, zoom: 1, modifiers }, [element]),
    ).toMatchObject({
      operationId: 'resize',
      baseRevision: 5,
      operations: preview,
    });
  });

  it('reuses the snapped rotation for the confirmed placement', () => {
    const rotating: Extract<Gesture, { kind: 'rotate' }> = {
      kind: 'rotate',
      start: { x: 40, y: 20 },
      elements: [element],
      ids: [element.id],
      box,
      operations: [],
      operationId: 'rotate',
    };
    const point = { x: 40, y: 28 };
    const preview = rotateGestureOperations(rotating, point, true);

    expect(preview[0]?.changes?.rotation).toBe(15);
    expect(
      finalizeGesturePlacement(rotating, { point, screen: point, zoom: 1, modifiers }, [element]),
    ).toMatchObject({ operations: preview });
  });

  it('retains initial click size while preview and release agree on a drawn square', () => {
    const creating: Extract<Gesture, { kind: 'create' }> = {
      kind: 'create',
      start: origin,
      element: { ...element, w: 180, h: 180 },
      initialSize: { w: 208, h: 112 },
    };
    const click = { x: 1, y: 1 };
    const drag = { x: -80, y: 20 };
    const preview = creationPlacement(creating, drag, 1, true, false);

    expect(creationPlacement(creating, click, 1, true, false)).toBe(creating.element);
    expect(
      finalizeGesturePlacement(creating, { point: click, screen: click, zoom: 1, modifiers }, []),
    ).toMatchObject({
      element: { id: element.id, x: 0, y: 0, w: 208, h: 112 },
    });
    expect(preview).toMatchObject({ x: -80, y: 0, w: 80, h: 80 });
    expect(
      finalizeGesturePlacement(creating, { point: drag, screen: drag, zoom: 1, modifiers }, []),
    ).toMatchObject({ element: preview });
  });

  it('previews a free endpoint and binds it to the topmost eligible element at release', () => {
    const arrow = { ...element, id: 'arrow', type: 'arrow' as const };
    const top = { ...element, id: 'top' };
    const selectedPoint: Extract<Gesture, { kind: 'arrow-point' }> = {
      kind: 'arrow-point',
      start: origin,
      element: arrow,
      points: [origin],
      end: 'to',
      bendIndex: -1,
      operations: [],
    };
    const point = { x: 10, y: 20 };
    const preview = arrowPointOperations(selectedPoint, point);
    const commit = geometryCommit(selectedPoint, point, [element, top, arrow]);

    expect(preview).toEqual([{ op: 'update', id: arrow.id, changes: { to: [10, 20] } }]);
    expect(commit).toMatchObject({
      kind: 'arrow',
      operations: [{ changes: { to: top.id } }],
      preview: [{ id: arrow.id, to: top.id }],
    });
  });

  it('keeps Shift drawing snap and ignores an arrow’s source when finding its destination', () => {
    const source = { ...element, id: 'source' };
    const destination = { ...element, x: 86, y: 0, id: 'destination' };
    const arrow = { ...element, id: 'arrow', type: 'arrow' as const };
    const drawing: Extract<Gesture, { kind: 'draw' }> = {
      kind: 'draw',
      start: origin,
      points: [origin],
      element: arrow,
      from: source.id,
    };

    const result = finalizeDrawing(drawing, { x: 90, y: 15 }, true, [destination, source]);

    expect(result.element).toMatchObject({ to: destination.id, h: 1 });
    expect(result.reachedLimit).toBe(false);
  });
});
