import { describe, expect, it } from 'vitest';
import type {
  CanvasConnection,
  CanvasGeometry,
  CanvasRect,
} from '../../../src/ui/domain/canvas/contracts.js';
import {
  getAdjacentGeometry,
  oppositePort,
} from '../../../src/ui/domain/canvas/connectors/adjacent.js';
import {
  connectionHitRadius,
  connectionPortOffset,
  connectionPortRadius,
  findPort,
  hitConnection,
  portPoint,
  resolveConnection,
  rotateConnection,
  translateConnection,
} from '../../../src/ui/domain/canvas/connectors/geometry.js';
import { connectionPathData } from '../../../src/ui/domain/canvas/connectors/path.js';

const target: CanvasGeometry = { x: 10, y: 20, width: 80, height: 40, rotation: 0 };
const line: CanvasConnection = {
  start: { point: { x: 0, y: 0 } },
  end: { point: { x: 100, y: 80 } },
};

function overlap(left: CanvasRect, right: CanvasRect) {
  const horizontal = left.x < right.x + right.width && left.x + left.width > right.x;
  const vertical = left.y < right.y + right.height && left.y + left.height > right.y;

  return horizontal && vertical;
}

describe('adjacent connector placement', () => {
  const source: CanvasGeometry = { x: 100, y: 120, width: 200, height: 100, rotation: 90 };
  const findFree = () => undefined;

  it('uses the existing note and shape gaps, with the same unrotated neighbor footprint', () => {
    const note = getAdjacentGeometry(source, 'right', findFree, 'note');
    const shape = getAdjacentGeometry({ ...source, x: 700 }, 'bottom', findFree);

    expect(note).toEqual({ ...source, x: 324, rotation: 0 });
    expect(shape).toEqual({ ...source, x: 700, y: 268, rotation: 0 });
    expect(oppositePort('right')).toBe('left');
    expect(oppositePort('bottom')).toBe('top');
  });

  it('skips each exact obstacle edge in the original row', () => {
    const obstacles = [
      { x: 340, y: 125, width: 340, height: 40 },
      { x: 730, y: 115, width: 90, height: 50 },
    ];
    const findObstacle = (bounds: CanvasRect) =>
      obstacles.find((obstacle) => overlap(bounds, obstacle));

    expect(getAdjacentGeometry(source, 'right', findObstacle)).toEqual({
      ...source,
      x: 868,
      rotation: 0,
    });
  });

  it('keeps twelve units clear while allowing a blocker on the exact boundary', () => {
    const near = { x: 559, y: 120, width: 20, height: 80 };
    const outside = { ...near, x: 560 };
    const clearNear = (bounds: CanvasRect) => (overlap(bounds, near) ? near : undefined);
    const clearOutside = (bounds: CanvasRect) => (overlap(bounds, outside) ? outside : undefined);

    expect(getAdjacentGeometry(source, 'right', clearNear).x).toBe(627);
    expect(getAdjacentGeometry(source, 'right', clearOutside).x).toBe(348);
  });
});

describe('connector geometry', () => {
  it('turns free and manually routed geometry around the selection pivot without changing the attachment', () => {
    const connection: CanvasConnection = {
      ...line,
      start: { point: { x: 3, y: 4 }, attachment: { objectId: 'node', port: 'right' } },
      startHead: 'circle',
      endHead: 'none',
      relativeBends: { firstAxis: 'horizontal', offsets: [8, 15] },
      labelOffset: { x: 12, y: 5 },
    };
    const before = { x: 0, y: 0, width: 100, height: 80, rotation: 0 };
    const after = { ...before, x: 25, y: -20, rotation: 90 };
    const points = [{ x: 10, y: 20 }, { x: 70, y: 40 }, connection.end.point];
    const rotated = rotateConnection(connection, before, after, points);

    expect(rotated.start).toEqual(connection.start);
    expect(rotated.startHead).toBe('circle');
    expect(rotated.endHead).toBe('none');
    expect(rotated.relativeBends).toBeUndefined();
    expect(rotated.end.point.x).toBeCloseTo(35);
    expect(rotated.end.point.y).toBeCloseTo(70);
    expect(rotated.bends).toEqual([{ x: 75, y: 40 }]);
    expect(rotated.labelOffset?.x).toBeCloseTo(-5);
    expect(rotated.labelOffset?.y).toBeCloseTo(12);
    expect(rotateConnection(line, before, after, points).bends).toBeUndefined();
  });

  it('rotates an edge port and its outward handle around the object center', () => {
    const rotated = { ...target, rotation: 90 };
    const edge = portPoint(rotated, 'right');
    const handle = portPoint(rotated, 'right', connectionPortOffset(2));

    expect(edge.x).toBeCloseTo(50);
    expect(edge.y).toBeCloseTo(80);
    expect(handle.x).toBeCloseTo(50);
    expect(handle.y).toBeCloseTo(86);
    expect(portPoint({ ...target, rotation: 360 }, 'right')).toEqual({ x: 90, y: 40 });
  });

  it('uses screen-space port reach and keeps an empty-board endpoint free', () => {
    const candidates = [{ id: 'node', geometry: target }];
    const inReach = { x: 101, y: 40 };
    const outsideReach = { x: 103, y: 40 };

    expect(connectionPortRadius(2)).toBe(12);
    expect(findPort(inReach, candidates, 2)).toEqual({
      point: { x: 90, y: 40 },
      attachment: { objectId: 'node', port: 'right' },
    });
    expect(findPort(outsideReach, candidates, 2)).toEqual({ point: outsideReach });
    expect(findPort(inReach, [], 2)).toEqual({ point: inReach });
  });

  it('attaches on the topmost rotated body and supports excluding the source', () => {
    const point = { x: 50, y: 65 };
    const rotated = { ...target, rotation: 90 };
    const candidates = [
      { id: 'lower', geometry: rotated },
      { id: 'upper', geometry: rotated },
    ];

    expect(findPort(point, candidates, 2)).toEqual({
      point: { x: 50, y: 80 },
      attachment: { objectId: 'upper' },
    });
    expect(findPort(point, candidates, 2, 'upper').attachment).toEqual({
      objectId: 'lower',
    });
  });

  it('resolves attached points against current geometry and falls back when a target disappears', () => {
    const connection: CanvasConnection = {
      ...line,
      start: { point: { x: 3, y: 4 }, attachment: { objectId: 'node', port: 'bottom' } },
    };
    const shifted = { ...target, x: 80, y: 100 };

    expect(resolveConnection(connection, () => target).points[0]).toEqual({ x: 50, y: 60 });
    expect(resolveConnection(connection, () => shifted).points[0]).toEqual({ x: 120, y: 140 });
    expect(resolveConnection(connection, () => undefined).points[0]).toBe(connection.start.point);
  });

  it('follows the rotated start port axis when adding automatic bends', () => {
    const connection: CanvasConnection = {
      start: { point: { x: 0, y: 0 }, attachment: { objectId: 'node', port: 'right' } },
      end: { point: { x: 110, y: 160 } },
    };
    const rotated = { ...target, rotation: 90 };
    const route = resolveConnection(connection, () => rotated);

    expect(route.points).toEqual([
      { x: 50, y: 80 },
      { x: 50, y: 120 },
      { x: 110, y: 120 },
      connection.end.point,
    ]);
  });

  it('selects the facing sides again when attached bodies move', () => {
    const connection: CanvasConnection = {
      start: { point: line.start.point, attachment: { objectId: 'start' } },
      end: { point: line.end.point, attachment: { objectId: 'end' } },
    };
    const positions = new Map([
      ['start', target],
      ['end', { ...target, x: 150 }],
    ]);
    const geometryForId = (id: string) => positions.get(id);

    expect(resolveConnection(connection, geometryForId).points).toEqual([
      { x: 90, y: 40 },
      { x: 150, y: 40 },
    ]);

    positions.set('end', { ...target, y: 150 });

    expect(resolveConnection(connection, geometryForId).points).toEqual([
      { x: 50, y: 60 },
      { x: 50, y: 150 },
    ]);
  });

  it('keeps automatic routes orthogonal after the attached node moves', () => {
    const connection: CanvasConnection = {
      start: { point: line.start.point, attachment: { objectId: 'a' } },
      end: { point: line.end.point, attachment: { objectId: 'b' } },
    };
    const a: CanvasGeometry = { x: 0, y: 0, width: 100, height: 80, rotation: 0 };
    const b = { ...a, x: 400, y: 200 };
    const first = resolveConnection(connection, (id) => (id === 'a' ? a : b));
    const moved = resolveConnection(connection, (id) => (id === 'a' ? a : { ...b, x: 600 }));

    expect(first.points[0]).toEqual({ x: 100, y: 40 });
    expect(first.points.at(-1)).toEqual({ x: 400, y: 240 });
    expect(moved.points.at(-1)).toEqual({ x: 600, y: 240 });
    expect(
      moved.points.slice(1).every((point, index) => {
        const previous = moved.points[index];

        return previous && (previous.x === point.x || previous.y === point.y);
      }),
    ).toBe(true);
  });

  it('preserves relative bend offsets and recomputes their lanes after moving an anchor', () => {
    const connection: CanvasConnection = {
      start: { point: line.start.point, attachment: { objectId: 'a' } },
      end: { point: line.end.point, attachment: { objectId: 'b' } },
      relativeBends: { firstAxis: 'vertical', offsets: [65, -160, -75] },
    };
    const a: CanvasGeometry = { x: 0, y: 0, width: 100, height: 80, rotation: 0 };
    const b = { ...a, x: 400, y: 200 };
    const first = resolveConnection(connection, (id) => (id === 'a' ? a : b));
    const moved = resolveConnection(connection, (id) => (id === 'a' ? a : { ...b, x: 600 }));
    const translated = translateConnection(connection, { x: 20, y: 30 });

    expect(first.points).toEqual([
      { x: 50, y: 80 },
      { x: 50, y: 105 },
      { x: -110, y: 105 },
      { x: -110, y: 165 },
      { x: 450, y: 165 },
      { x: 450, y: 200 },
    ]);
    expect(moved.points[2]?.x).toBe(-110);
    expect(moved.points[4]?.x).toBe(650);
    expect(translated.relativeBends).toBe(connection.relativeBends);
    expect(translated.bends).toBeUndefined();
  });

  it('falls back to automatic routing if a relative lane re-enters its starting node', () => {
    const connection: CanvasConnection = {
      ...line,
      start: { point: line.start.point, attachment: { objectId: 'node', port: 'right' } },
    };
    const relativeBends = { firstAxis: 'horizontal', offsets: [-40] } as const;
    const routed = resolveConnection(connection, () => target);

    expect(resolveConnection({ ...connection, relativeBends }, () => target)).toEqual(routed);
  });

  it('preserves world-coordinate bends and rounds the same path used for hit testing', () => {
    const bend = { x: 100, y: 0 };
    const route = resolveConnection({ ...line, bends: [bend, bend] });

    expect(route.points).toEqual([line.start.point, bend, line.end.point]);
    expect(connectionPathData(route.points)).toContain('Q 100 0 100 8');
    expect(hitConnection(route, { x: 98, y: 2 }, 8)).toBe(true);
    expect(hitConnection(route, { x: 100, y: 0 }, 8)).toBe(false);
    expect(route.geometry).toEqual({ x: -6, y: -6, width: 112, height: 92, rotation: 0 });
  });

  it('positions a moved label from the middle segment and includes it in visibility bounds', () => {
    const route = resolveConnection({ ...line, labelOffset: { x: 120, y: -3 } });

    expect(route.labelPosition).toEqual({ x: 170, y: 37 });
    expect(route.geometry.x + route.geometry.width).toBe(176);
  });

  it('hits within a constant screen distance and passes through unused route bounds', () => {
    const route = resolveConnection(line);
    const point = { x: 10, y: 6 };

    expect(connectionHitRadius(2)).toBe(4);
    expect(hitConnection(route, point, 1)).toBe(true);
    expect(hitConnection(route, point, 2)).toBe(false);
    expect(hitConnection(route, { x: 20, y: 40 }, 1)).toBe(false);
  });

  it('includes the actual stroke width in route bounds and hit testing', () => {
    const wide = resolveConnection(line, undefined, 24);
    const thin = resolveConnection(line, undefined, NaN);
    const point = { x: 10, y: 11 };

    expect(wide.geometry).toEqual({ x: -72, y: -72, width: 244, height: 224, rotation: 0 });
    expect(wide.strokeWidth).toBe(24);
    expect(hitConnection(wide, point, 8)).toBe(true);
    expect(thin.strokeWidth).toBe(2);
    expect(hitConnection(thin, point, 8)).toBe(false);
  });

  it('handles coincident endpoints and ignores invalid coordinates', () => {
    const endpoint = { point: { x: 5, y: 5 } };
    const route = resolveConnection({ start: endpoint, end: endpoint });
    const invalid = resolveConnection({ ...line, end: { point: { x: NaN, y: 0 } } });

    expect(route.points).toEqual([endpoint.point]);
    expect(hitConnection(route, endpoint.point, 1)).toBe(true);
    expect(hitConnection(invalid, endpoint.point, 1)).toBe(false);
  });

  it('moves free endpoints and bends while keeping the attached endpoint stable', () => {
    const connection: CanvasConnection = {
      ...line,
      start: { point: { x: 3, y: 4 }, attachment: { objectId: 'node', port: 'left' } },
      bends: [{ x: 10, y: 40 }],
    };
    const shifted = translateConnection(connection, { x: 8, y: -5 });

    expect(shifted.start).toBe(connection.start);
    expect(shifted.end.point).toEqual({ x: 108, y: 75 });
    expect(shifted.bends).toEqual([{ x: 18, y: 35 }]);
    expect(connection.bends).toEqual([{ x: 10, y: 40 }]);
  });
});
