import { describe, expect, it, vi } from 'vitest';
import type {
  CanvasGeometry,
  CanvasObjectHitContext,
} from '../../../src/ui/domain/canvas/contracts.js';
import {
  canvasHitBounds,
  hitTest,
  marqueeSelection,
  selectObject,
} from '../../../src/ui/domain/canvas/selection/index.js';

const geometry: CanvasGeometry = { x: 0, y: 0, width: 100, height: 40, rotation: 0 };

function projectedObject(id: string, transform: Partial<CanvasGeometry> = {}) {
  return {
    object: { id, kind: 'shape' as const, label: id, geometry, version: 1 },
    geometry: { ...geometry, ...transform },
  };
}

function projectedSection(transparent: boolean, rotation = 0) {
  const { object, geometry: bounds } = projectedObject('section', { rotation });

  return { object: { ...object, kind: 'section' as const, transparent }, geometry: bounds };
}

describe('canvas selection', () => {
  it('hits the topmost object in drawing order', () => {
    const objects = [projectedObject('behind'), projectedObject('in-front')];
    expect(hitTest(objects, { x: 10, y: 10 })).toBe('in-front');
    expect(hitTest(objects, { x: 150, y: 10 })).toBeUndefined();
  });

  it('uses each confirmed layer order for the current hit without changing earlier projections', () => {
    const first = projectedObject('first');
    const second = projectedObject('second');
    const before = [first, second];
    const reordered = [second, first];
    const overlap = { x: 20, y: 20 };

    expect(hitTest(before, overlap)).toBe('second');
    expect(hitTest(reordered, overlap)).toBe('first');
    expect(hitTest(before, overlap)).toBe('second');
  });

  it('uses a custom pure hit in visual order and passes through the part it rejects', () => {
    const behind = projectedObject('behind');
    const projected = projectedObject('custom', { x: 20 });
    const extensionHit = vi.fn(({ geometry, point, zoom }: CanvasObjectHitContext) => {
      const reachesX = Math.abs(point.x - geometry.x) * zoom <= 20;

      return reachesX && point.y === geometry.y + geometry.height / 2;
    });
    const custom = {
      ...projected,
      object: { ...projected.object, kind: 'example:precise-card' as const },
      geometryExtension: { hitTest: extensionHit },
    };
    const near = { x: 35, y: 20 };
    const far = { x: 85, y: 20 };

    expect(hitTest([behind, custom], near)).toBe(custom.object.id);
    expect(extensionHit).toHaveBeenCalledExactlyOnceWith({
      object: custom.object,
      geometry: custom.geometry,
      point: near,
      zoom: 1,
    });
    expect(hitTest([behind, custom], near, 2)).toBe(behind.object.id);
    expect(hitTest([behind, custom], far)).toBe(behind.object.id);
    extensionHit.mockClear();
    expect(hitTest([custom, behind], near)).toBe(behind.object.id);
    expect(extensionHit).not.toHaveBeenCalled();
  });

  it('hits projected geometry after rotation and translation', () => {
    const objects = [projectedObject('turned', { x: 100, rotation: 90 })];
    expect(hitTest(objects, { x: 150, y: -20 })).toBe('turned');
    expect(hitTest(objects, { x: 110, y: 20 })).toBeUndefined();
    expect(hitTest(objects, { x: 50, y: 20 })).toBeUndefined();
  });

  it('uses projected bounds for marquee hits and preserves stable selection order', () => {
    const objects = [
      projectedObject('turned', { rotation: 90 }),
      projectedObject('selected', { y: -40 }),
      projectedObject('turned', { rotation: 90 }),
      projectedObject('outside', { x: 200 }),
    ];
    const marquee = { x: 40, y: -25, width: 20, height: 10 };
    const initialSelection = ['selected', 'existing', 'selected'];

    expect(marqueeSelection(objects, marquee)).toEqual(['turned', 'selected']);
    expect(marqueeSelection(objects, marquee, initialSelection)).toEqual([
      'selected',
      'existing',
      'turned',
    ]);
    expect(initialSelection).toEqual(['selected', 'existing', 'selected']);
  });

  it('replaces, appends, and removes selected ids without mutating the input', () => {
    const selection = ['first', 'second'];
    expect(selectObject(selection, 'third', false)).toEqual(['third']);
    expect(selectObject(selection, 'third', true)).toEqual(['first', 'second', 'third']);
    expect(selectObject(selection, 'first', true)).toEqual(['second']);
    expect(selection).toEqual(['first', 'second']);
  });

  it('lets a topmost transparent section pass interior hits through to lower objects', () => {
    const behind = projectedObject('behind');
    const transparent = projectedSection(true);
    const opaque = projectedSection(false);
    const interior = { x: 35, y: 20 };

    expect(hitTest([behind, transparent], interior)).toBe('behind');
    expect(hitTest([behind, opaque], interior)).toBe('section');
    expect(hitTest([transparent], interior)).toBeUndefined();
    expect(hitTest([behind, transparent], { x: 1, y: 20 })).toBe('section');
    expect(hitTest([transparent, behind], { x: 1, y: 20 })).toBe('behind');
  });

  it('hits rotated section borders with screen-space tolerance', () => {
    const rotated = projectedSection(true, 90);
    const point = { x: 27, y: 20 };

    expect(hitTest([rotated], point, 1)).toBe('section');
    expect(hitTest([rotated], point, 2)).toBeUndefined();
    expect(hitTest([rotated], { x: 68, y: 20 }, 1)).toBe('section');
    expect(canvasHitBounds(point, 2)).toEqual({ x: 23, y: 16, width: 8, height: 8 });
  });

  it('marquee selects transparent sections only where the rectangle crosses their edges', () => {
    const behind = projectedObject('behind');
    const transparent = projectedSection(true, 90);
    const interior = { x: 40, y: 10, width: 10, height: 10 };
    const crossing = { x: 65, y: 10, width: 10, height: 10 };

    expect(marqueeSelection([behind, transparent], interior)).toEqual(['behind']);
    expect(marqueeSelection([behind, transparent], crossing)).toEqual(['behind', 'section']);
  });
});
