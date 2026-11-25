import { describe, expect, it, vi } from 'vitest';
import type {
  CanvasEditIntent,
  CanvasConnection,
  CanvasObject,
  CanvasObjectChange,
  CanvasObjectExtension,
  CanvasObjectGeometryContext,
  CanvasObjectKind,
} from '../../../src/ui/domain/canvas/contracts.js';
import {
  buildPendingEdits,
  createSceneIndex,
  isObjectLocked,
  projectedObjectBounds,
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

function connector(start: CanvasObject, end: CanvasObject): CanvasObject {
  const connection: CanvasConnection = {
    start: {
      point: { x: start.geometry.x + start.geometry.width, y: 5 },
      attachment: { objectId: start.id, port: 'right' },
    },
    end: { point: { x: end.geometry.x, y: 5 }, attachment: { objectId: end.id, port: 'left' } },
  };

  return { ...shape('connector', start.geometry.x), kind: 'connector', connection };
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

  it('indexes custom world bounds and only recalculates an edited object of the same kind', () => {
    const first = { ...shape('first', -100), kind: 'example:offset-card' as const };
    const second = { ...shape('second', 1_000), kind: first.kind };
    const bounds = vi.fn(({ geometry }: CanvasObjectGeometryContext) => ({
      x: geometry.x + 100,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
    }));
    const extension: CanvasObjectExtension = {
      kind: first.kind,
      capabilities: { move: true, resize: true, rotate: false, connect: false, content: 'passive' },
      bounds,
      hitTest: ({ geometry, point }) => point.x === geometry.x + 100 && point.y === geometry.y,
    };
    const get = vi.fn((kind: CanvasObjectKind) =>
      kind === extension.kind ? extension : undefined,
    );
    const index = createSceneIndex([first, second], { get });
    const committed = queryScene(index, visibleBounds, new Map());

    expect(get).toHaveBeenCalledExactlyOnceWith(first.kind);
    expect(committed.map(({ object }) => object.id)).toEqual([first.id]);
    expect(committed.map(projectedObjectBounds)).toEqual([{ x: 0, y: 0, width: 10, height: 10 }]);
    expect(bounds).toHaveBeenCalledTimes(2);

    const pending = buildPendingEdits(index, [edit('move-custom', move(second, -95))]);
    bounds.mockClear();
    const visible = queryScene(index, visibleBounds, pending);

    expect(bounds).toHaveBeenCalledExactlyOnceWith({
      object: second,
      geometry: { ...second.geometry, x: -95 },
    });
    expect(visible.map(({ object }) => object.id)).toEqual([first.id, second.id]);
    expect(visible[0]).toBe(committed[0]);
    expect(visible.map(projectedObjectBounds)[1]).toEqual({ x: 5, y: 0, width: 10, height: 10 });
    expect(visible[1]?.geometryExtension?.hitTest).toBe(extension.hitTest);
    expect(second.geometry.x).toBe(1_000);
  });

  it('keeps default spatial bounds when a custom geometry hook returns a nonfinite rectangle', () => {
    const object = { ...shape('custom', 5), kind: 'example:invalid-card' as const };
    const other = shape('other', 15);
    const extension: CanvasObjectExtension = {
      kind: object.kind,
      capabilities: { move: true, resize: true, rotate: false, connect: false, content: 'passive' },
      bounds: () => ({ x: Number.NaN, y: 0, width: 5, height: 5 }),
    };
    const index = createSceneIndex([object, other], {
      get: (kind) => (kind === object.kind ? extension : undefined),
    });
    const inside = queryScene(index, visibleBounds, new Map());

    expect(inside.map(({ object }) => object.id)).toEqual([object.id, other.id]);
    expect(inside.map(projectedObjectBounds)).toEqual([
      { x: 5, y: 0, width: 10, height: 10 },
      { x: 15, y: 0, width: 10, height: 10 },
    ]);
  });

  it('projects only affected attached routes and queries their updated bounds', () => {
    const anchor = shape('anchor', 100);
    const destination = shape('destination', 160);
    const attached = connector(anchor, destination);
    const distant = shape('distant', 500);
    const untouched = {
      ...connector(destination, distant),
      id: 'untouched',
    };
    const index = createSceneIndex([attached, anchor, destination, distant, untouched]);
    const empty = new Map<string, CanvasObjectChange>();
    const pending = buildPendingEdits(index, [edit('move-anchor', move(anchor, 5))]);

    expect(queryScene(index, visibleBounds, empty)).toEqual([]);
    expect(queryScene(index, visibleBounds, pending).map(({ object }) => object.id)).toEqual([
      'connector',
      'anchor',
    ]);
    expect(projectObject(index, pending, attached.id)?.connectorRoute?.points[0]).toEqual({
      x: 15,
      y: 5,
    });
    expect(projectObject(index, pending, attached.id)?.object).toBe(attached);
    expect(projectObject(index, pending, untouched.id)).toBe(
      projectObject(index, empty, untouched.id),
    );

    const confirmed = {
      ...anchor,
      version: anchor.version + 1,
      geometry: { ...anchor.geometry, x: 5 },
    };
    const revised = createSceneIndex([attached, confirmed, destination]);
    expect(projectObject(revised, pending, attached.id)?.connectorRoute).toEqual(
      projectObject(index, pending, attached.id)?.connectorRoute,
    );
  });

  it('projects an edited connection against the effective geometry of its new anchor', () => {
    const previous = shape('previous', 100);
    const next = shape('next', 120);
    const destination = shape('destination', 160);
    const attached = connector(previous, destination);
    const index = createSceneIndex([attached, previous, destination, next]);
    const connection: CanvasConnection = {
      start: { point: { x: 1, y: 5 }, attachment: { objectId: next.id, port: 'left' } },
      end: { point: { x: 160, y: 5 }, attachment: { objectId: destination.id, port: 'left' } },
    };
    const pending = buildPendingEdits(index, [
      edit('retarget', { ...move(attached, 0), connection }),
      edit('move-new-anchor', move(next, 3)),
    ]);

    expect(projectObject(index, pending, attached.id)?.object).toMatchObject({ connection });
    expect(projectObject(index, pending, attached.id)?.connectorRoute?.points[0]).toEqual({
      x: 3,
      y: 5,
    });
    const withoutTarget = createSceneIndex([attached, previous, destination]);

    expect(projectObject(withoutTarget, pending, attached.id)?.connectorRoute?.points[0]).toEqual({
      x: 1,
      y: 5,
    });
  });

  it('blocks pending edits under a locked ancestor and terminates a parent cycle', () => {
    const locked = { ...shape('locked', 0), kind: 'section' as const, locked: true };
    const section = { ...shape('section', 1), kind: 'section' as const, parentId: locked.id };
    const child = { ...shape('child', 2), parentId: section.id };
    const first = { ...shape('first', 30), parentId: 'second' };
    const second = { ...shape('second', 31), parentId: first.id };
    const index = createSceneIndex([locked, section, child, first, second]);
    const pending = buildPendingEdits(index, [edit('move', move(child, 4), move(first, 32))]);

    expect(isObjectLocked(index, child.id)).toBe(true);
    expect(isObjectLocked(index, first.id)).toBe(false);
    expect(isObjectLocked(index, 'missing')).toBe(false);
    expect(index.childrenOf(section.id)).toEqual([child.id]);
    expect(pending.has(child.id)).toBe(false);
    expect(projectObject(index, pending, child.id)?.geometry).toBe(child.geometry);
    expect(projectObject(index, pending, first.id)?.geometry.x).toBe(32);
  });

  it('indexes the effective stroke width of a pending ink resize', () => {
    const object = {
      ...shape('ink', 60, 10),
      kind: 'ink' as const,
      ink: {
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        width: 2,
      },
    };
    const index = createSceneIndex([object]);
    const pending = buildPendingEdits(index, [
      {
        kind: 'resize',
        interactionId: 'resize-ink',
        changes: [{ ...move(object, 60), ink: { ...object.ink, width: 80 } }],
      },
    ]);

    expect(queryScene(index, visibleBounds, new Map())).toEqual([]);
    expect(queryScene(index, visibleBounds, pending)).toMatchObject([
      { object: { id: object.id, ink: { width: 80 } } },
    ]);
    expect(object.ink.width).toBe(2);
  });

  it('uses the first repeated ID for drawing, indexed lookup, and bound endpoints', () => {
    const first = shape('left', 0);
    const repeated = shape('left', 90);
    const right = shape('right', 20);
    const edge = connector(first, right);
    const index = createSceneIndex([first, repeated, edge, right]);

    expect(index.get('left')).toBe(first);
    expect(index.objects).toEqual([first, edge, right]);
    expect(queryScene(index, visibleBounds, new Map()).map(({ object }) => object.id)).toEqual([
      first.id,
      edge.id,
      right.id,
    ]);
    expect(projectObject(index, new Map(), edge.id)?.connectorRoute?.points[0]).toEqual({
      x: 10,
      y: 5,
    });
  });

  it('keeps free endpoints and explicit turns while unrelated bounds change', () => {
    const first = shape('first', 0);
    const last = shape('last', 100);
    const start = { x: 5, y: 20 };
    const end = { x: 80, y: 20 };
    const bends = [
      { x: 5, y: 40 },
      { x: 80, y: 40 },
    ];
    const edge = {
      ...connector(first, last),
      kind: 'connector' as const,
      connection: { start: { point: start }, end: { point: end }, bends },
    };
    const index = createSceneIndex([first, edge, last]);
    const pending = buildPendingEdits(index, [edit('move-nearby', move(first, 15))]);

    expect(projectObject(index, pending, edge.id)?.connectorRoute?.points).toEqual([
      start,
      ...bends,
      end,
    ]);
  });

  it('reads each scene ID once and resolves each bound end during indexing only', () => {
    const idRead = vi.fn();
    const anchorRead = vi.fn();
    const distantShapes = Array.from({ length: 2_048 }, (_, i) =>
      shape(`distant-${i}`, 1000 + i * 20),
    );
    const left = shape('left', 0);
    const right = shape('right', 20);
    const anchors = [left, right];
    const arrowCount = 128;
    const edges = Array.from({ length: arrowCount }, (_, i) => ({
      ...connector(left, right),
      id: `edge-${i}`,
    }));
    const scene = [...distantShapes, ...anchors, ...edges].map((object) => ({
      ...object,
      get id() {
        idRead();

        return object.id;
      },
      get geometry() {
        if (object === left || object === right) {
          anchorRead();
        }

        return object.geometry;
      },
    }));
    anchorRead.mockClear();
    const index = createSceneIndex(scene);

    expect(idRead).toHaveBeenCalledTimes(scene.length);
    expect(anchorRead).toHaveBeenCalledTimes(2 + 2 * arrowCount);
    anchorRead.mockClear();
    expect(queryScene(index, visibleBounds, new Map())).toHaveLength(anchors.length + edges.length);
    expect(anchorRead).not.toHaveBeenCalled();
  });
});
