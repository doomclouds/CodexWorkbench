import { describe, expect, it, vi } from 'vitest';
import type {
  CanvasEditIntent,
  CanvasObject,
  CanvasObjectChange,
} from '../../../src/ui/domain/canvas/contracts.js';
import {
  buildPendingEdits,
  createSceneIndex,
  projectObject,
  queryScene,
} from '../../../src/ui/domain/canvas/scene/index.js';

const visibleBounds = { x: 0, y: 0, width: 30, height: 30 };

function shape(id: string, x: number, y = 0): CanvasObject {
  return {
    id,
    kind: 'shape',
    label: id,
    geometry: { x, y, width: 10, height: 10, rotation: 0 },
    version: 2,
  };
}

function move(
  object: CanvasObject,
  x: number,
  expectedVersion = object.version,
): CanvasObjectChange {
  return { id: object.id, expectedVersion, geometry: { ...object.geometry, x } };
}

function edit(interactionId: string, ...changes: CanvasObjectChange[]): CanvasEditIntent {
  return { interactionId, kind: 'move', delta: { x: 0, y: 0 }, changes };
}

describe('Canvas scene', () => {
  it('retains version-matched edits and lets a later valid intention replace an earlier one', () => {
    const editable = shape('editable', 0);
    const locked = { ...shape('locked', 0), locked: true };
    const removed = shape('removed', 0);
    const latest = move(editable, 20);
    const index = createSceneIndex([editable, locked]);
    const pending = buildPendingEdits(index, [
      edit('first', move(editable, 5), move(locked, 5), move(removed, 5)),
      edit('second', latest),
      edit('stale', move(editable, 40, editable.version - 1)),
    ]);

    expect([...pending]).toEqual([['editable', latest]]);
    expect(projectObject(index, pending, editable.id)).toEqual({
      object: editable,
      geometry: latest.geometry,
    });
    expect(projectObject(index, pending, removed.id)).toBeUndefined();
    expect(projectObject(index, pending, locked.id)?.geometry).toBe(locked.geometry);
  });

  it('leaves authoritative geometry in place when an index changes during a preview', () => {
    const original = shape('updated', 10);
    const removed = shape('removed', 500);
    const previous = createSceneIndex([original, removed]);
    const pending = buildPendingEdits(previous, [
      edit('move', move(original, 700), move(removed, 10)),
    ]);
    const updated = { ...original, version: original.version + 1 };
    const current = createSceneIndex([updated]);

    expect(queryScene(current, visibleBounds, pending)).toEqual([
      { object: updated, geometry: updated.geometry },
    ]);
    expect(projectObject(current, pending, original.id)?.geometry).toBe(updated.geometry);
    expect(projectObject(current, pending, removed.id)).toBeUndefined();
  });

  it('queries sparse edits across viewport boundaries in original visual order', () => {
    const baseFront = shape('base-front', 3);
    const movedOut = shape('moved-out', 5);
    const movedIn = shape('moved-in', 1_000);
    const baseBack = shape('base-back', 1);
    const objects = [baseBack, movedIn, movedOut, baseFront];
    const index = createSceneIndex(objects);
    const expected = move(movedIn, 10);
    const pending = buildPendingEdits(index, [edit('moving', expected, move(movedOut, -1_000))]);
    const visible = queryScene(index, visibleBounds, pending);

    expect(index.objects).toEqual(objects);
    expect(index.get(movedIn.id)).toBe(movedIn);
    expect(visible.map(({ object }) => object.id)).toEqual(['base-back', 'moved-in', 'base-front']);
    expect(visible[1]?.geometry).toBe(expected.geometry);
    expect(movedIn.geometry.x).toBe(1_000);
    expect(projectObject(index, pending, movedOut.id)?.geometry.x).toBe(-1_000);
  });

  it('hits point bounds and point objects at their edges', () => {
    const box = shape('box', 0);
    const point = {
      ...shape('point', 10, 10),
      geometry: { x: 10, y: 10, width: 0, height: 0, rotation: 0 },
    };
    const index = createSceneIndex([box, point]);
    const emptyChanges = new Map<string, CanvasObjectChange>();
    const boundary = { x: 10, y: 10, width: 0, height: 0 };

    expect(queryScene(index, boundary, emptyChanges).map(({ object }) => object.id)).toEqual([
      'box',
      'point',
    ]);
    expect(queryScene(index, { ...boundary, x: 11 }, emptyChanges)).toEqual([]);
    expect(queryScene(createSceneIndex([]), boundary, emptyChanges)).toEqual([]);
  });

  it('queries narrow regions and sparse previews in a scene of twenty thousand objects', () => {
    const total = 20_000;
    const geometryRead = vi.fn();
    const objects = Array.from({ length: total }, (_, number) => {
      const base = shape(String(number), number * 32 - 100, number % 2 ? 0 : 20);

      return {
        ...base,
        get geometry() {
          geometryRead();

          return base.geometry;
        },
      };
    });
    const index = createSceneIndex(objects);
    const distant = objects.at(-1)!;
    const pending = buildPendingEdits(index, [edit('move-distant', move(distant, 1))]);
    geometryRead.mockClear();

    const results = queryScene(index, visibleBounds, pending);

    expect(results.map(({ object }) => object.id)).toEqual(['3', '4', distant.id]);
    expect(geometryRead.mock.calls.length).toBeLessThan(10);
  });
});
