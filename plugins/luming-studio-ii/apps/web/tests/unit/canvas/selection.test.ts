import { describe, expect, it } from 'vitest';
import type { CanvasGeometry } from '../../../src/ui/domain/canvas/contracts.js';
import {
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

describe('canvas selection', () => {
  it('hits the topmost object in drawing order', () => {
    const objects = [projectedObject('behind'), projectedObject('in-front')];
    expect(hitTest(objects, { x: 10, y: 10 })).toBe('in-front');
    expect(hitTest(objects, { x: 150, y: 10 })).toBeUndefined();
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
});
