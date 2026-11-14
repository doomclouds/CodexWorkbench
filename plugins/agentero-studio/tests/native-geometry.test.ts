import { describe, expect, it } from 'vitest';
import type { BoardElement, Operation } from '../src/contracts/studio.js';
import { alignSelection, geometryBounds, resizeBox, resizeElement, resizeSelection, rotateSelection, selectionBounds, snapMove, tidySelection } from '../src/app/canvas/native-geometry.js';

const box = (id: string, x = 0, y = 0, changes: Partial<BoardElement> = {}): BoardElement => ({ id, type: 'shape', x, y, w: 100, h: 80, version: 2, text: id, ...changes });
const patch = (elements: BoardElement[], operations: Operation[]) => elements.map(element => ({ ...element, ...operations.find(operation => operation.id === element.id)?.changes }));

describe('native selection geometry', () => {
  it('measures rotated boxes and real arrow endpoints rather than their stored frame metadata', () => {
    const rotated = box('rotated', 0, 0, { w: 100, h: 40, rotation: 90 });
    expect(geometryBounds(rotated, [rotated]).x).toBeCloseTo(30);
    expect(geometryBounds(rotated, [rotated]).y).toBeCloseTo(-30);
    expect(geometryBounds(rotated, [rotated]).w).toBeCloseTo(40);
    expect(geometryBounds(rotated, [rotated]).h).toBeCloseTo(100);
    const arrow = box('arrow', -500, -500, { type: 'arrow', from: [20, 30], to: [220, 130] });
    expect(selectionBounds([arrow], ['arrow'])).toEqual({ x: 20, y: 30, w: 200, h: 100 });
    expect(selectionBounds([arrow], ['missing'])).toBeNull();
  });

  it('supports all corner and edge handles while keeping opposite anchors and minimum sizes', () => {
    const start = { x: 100, y: 200, w: 100, h: 80 };
    expect(resizeBox(start, 'nw', { x: -20, y: -10 })).toEqual({ x: 80, y: 190, w: 120, h: 90 });
    expect(resizeBox(start, 'ne', { x: 20, y: -10 })).toEqual({ x: 100, y: 190, w: 120, h: 90 });
    expect(resizeBox(start, 'sw', { x: -20, y: 10 })).toEqual({ x: 80, y: 200, w: 120, h: 90 });
    expect(resizeBox(start, 'se', { x: 20, y: 10 })).toEqual({ x: 100, y: 200, w: 120, h: 90 });
    expect(resizeBox(start, 'w', { x: 200, y: 999 })).toEqual({ x: 176, y: 200, w: 24, h: 80 });
    expect(resizeBox(start, 'e', { x: 20, y: 999 })).toEqual({ x: 100, y: 200, w: 120, h: 80 });
    expect(resizeBox(start, 'n', { x: 999, y: -10 })).toEqual({ x: 100, y: 190, w: 100, h: 90 });
    expect(resizeBox(start, 's', { x: 999, y: 10 })).toEqual({ x: 100, y: 200, w: 100, h: 90 });
  });
  it('measures freehand samples and paint beyond an imported stroke frame', () => {
    const stroke = box('pen', 10, 20, { type: 'stroke', w: 200, h: 200, points: [-5, -10, 35, 10], strokeWidth: 4 });
    expect(geometryBounds(stroke, [stroke])).toEqual({ x: 3, y: 8, w: 44, h: 24 });
    const rotated = geometryBounds({ ...stroke, rotation: 90 }, [stroke]);
    expect(rotated.x).toBeCloseTo(198); expect(rotated.y).toBeCloseTo(13); expect(rotated.w).toBeCloseTo(24); expect(rotated.h).toBeCloseTo(44);
  });

  it('constrains aspect ratio and supports resize around the center', () => {
    const start = { x: 10, y: 20, w: 100, h: 50 };
    expect(resizeBox(start, 'se', { x: 50, y: 5 }, { aspect: true })).toEqual({ x: 10, y: 20, w: 150, h: 75 });
    expect(resizeBox(start, 'e', { x: 20, y: 0 }, { aspect: true, center: true })).toEqual({ x: -10, y: 10, w: 140, h: 70 });
  });

  it('resizes a rotated object in local axes and retains the opposite corner in world coordinates', () => {
    const element = box('rotated', 0, 0, { w: 100, h: 40, rotation: 90 });
    const resized = patch([element], resizeElement(element, 'e', { x: 0, y: 50 }))[0]!;
    expect(resized.w).toBeCloseTo(150); expect(resized.h).toBeCloseTo(40);
    expect(resized.x).toBeCloseTo(-25); expect(resized.y).toBeCloseTo(25);
    expect(resized.x + resized.w / 2).toBeCloseTo(50);
    expect(resized.y + resized.h / 2 - resized.w / 2).toBeCloseTo(-30);
    expect(resizeElement({ ...element, locked: true }, 'se', { x: 50, y: 50 })).toEqual([]);
  });

  it('scales selected positions, freehand samples and free arrow geometry without changing source or locked items', () => {
    const elements = [box('shape'), box('stroke', 200, 20, { type: 'stroke', w: 40, h: 20, points: [0, 0, 40, 20], strokeWidth: 4 }), box('arrow', 0, 0, { type: 'arrow', w: 300, h: 100, from: [0, 0], to: [300, 100], bends: [50, 0, 50, 100] }), box('html', 30, 30, { type: 'html', html: '<p>Preserved</p>' }), box('locked', 10, 10, { locked: true })];
    const operations = resizeSelection(elements, elements.map(element => element.id), { x: 0, y: 0, w: 300, h: 100 }, { x: 100, y: 50, w: 600, h: 300 });
    const next = patch(elements, operations);
    expect(next[0]).toMatchObject({ x: 100, y: 50, w: 200, h: 240 });
    expect(next[1]).toMatchObject({ x: 500, y: 110, w: 80, h: 60, points: [0, 0, 80, 60], strokeWidth: 10 });
    expect(next[2]).toMatchObject({ from: [100, 50], to: [700, 350], bends: [200, 50, 200, 350] });
    expect(next[3]!.html).toBe('<p>Preserved</p>'); expect(next[4]).toEqual(elements[4]);
    expect(operations.some(operation => operation.id === 'locked')).toBe(false);
  });

  it('preserves bound arrow IDs and native relative bend representation while scaling offsets', () => {
    const arrow = box('arrow', 0, 0, { type: 'arrow', from: 'a', to: 'b', bends: ['h', 20, 30, 40] });
    const changes = resizeSelection([arrow], ['arrow'], { x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 50, w: 200, h: 300 })[0]!.changes!;
    expect(changes.bends).toEqual(['h', 40, 90, 80]);
    expect(changes).not.toHaveProperty('from'); expect(changes).not.toHaveProperty('to');
  });

  it('rotates object centers and explicit arrow coordinates around one pivot, leaving locked objects untouched', () => {
    const elements = [box('shape', 50, 0, { w: 100, h: 40, rotation: 5 }), box('arrow', 0, 0, { type: 'arrow', from: [0, 0], to: [100, 0], bends: [50, 0] }), box('locked', 500, 500, { locked: true })];
    const operations = rotateSelection(elements, elements.map(element => element.id), 90, { x: 0, y: 0 });
    const next = patch(elements, operations);
    expect(next[0]!.x).toBeCloseTo(-70); expect(next[0]!.y).toBeCloseTo(80); expect(next[0]!.rotation).toBe(95);
    expect((next[1]!.to as number[])[0]).toBeCloseTo(0); expect((next[1]!.to as number[])[1]).toBeCloseTo(100);
    expect(Number(next[1]!.bends![0])).toBeCloseTo(0); expect(Number(next[1]!.bends![1])).toBeCloseTo(50);
    expect(next[2]).toEqual(elements[2]);
  });
});

describe('selection arrangement and snapping', () => {
  it('snaps edges within six screen pixels and returns the actual guide span', () => {
    const elements = [box('a'), box('b', 200, 30)];
    const result = snapMove(elements, ['a'], { x: 96, y: 0 }, 1);
    expect(result.delta).toEqual({ x: 100, y: 0 });
    expect(result.guides).toEqual([{ axis: 'x', at: 200, from: 0, to: 110 }]);
    expect(snapMove(elements, ['a'], { x: 96, y: 0 }, 2).delta.x).toBe(96);
    expect(snapMove(elements, ['a'], { x: 90, y: 0 }, .5).delta.x).toBe(100);
    const lockedFrame = box('frame', -20, -20, { type: 'container', w: 400, h: 400, locked: true });
    expect(snapMove([...elements, lockedFrame], ['frame'], { x: 96, y: 0 }, 1)).toEqual({ delta: { x: 96, y: 0 }, guides: [] });
  });

  it('aligns groups as units and respects a locked alignment anchor', () => {
    const elements = [box('a', 0, 0, { groupId: 'g' }), box('b', 200, 30, { groupId: 'g' }), box('c', 500, 200)];
    const next = patch(elements, alignSelection(elements, ['a', 'b', 'c'], 'hcenter'));
    expect(next[0]!.x).toBe(150); expect(next[1]!.x).toBe(350); expect(next[2]!.x).toBe(250);
    const locked = [...elements, box('locked', -100, -100, { locked: true })];
    const aligned = patch(locked, alignSelection(locked, ['a', 'b', 'c', 'locked'], 'left'));
    expect(aligned[0]!.x).toBe(-100); expect(aligned[1]!.x).toBe(100); expect(aligned[2]!.x).toBe(-100); expect(aligned[3]).toEqual(locked[3]);
    for (const edge of ['right', 'top', 'vcenter', 'bottom'] as const) expect(alignSelection(elements, ['a', 'b', 'c'], edge).length).toBeGreaterThan(0);
  });

  it('tidies three object units into a grid while keeping group spacing and excluding lines and locked objects', () => {
    const elements = [box('a', 0, 0, { groupId: 'g' }), box('b', 200, 30, { groupId: 'g' }), box('c', 500, 200), box('d', 900, 400), box('locked', -100, -100, { locked: true }), box('stroke', 10, 20, { type: 'stroke' })];
    const operations = tidySelection(elements, elements.map(element => element.id));
    const next = patch(elements, operations);
    expect(next[1]!.x - next[0]!.x).toBe(200); expect(next[1]!.y - next[0]!.y).toBe(30);
    expect(next[2]).toMatchObject({ x: 424, y: 0 }); expect(next[3]).toMatchObject({ x: 100, y: 134 });
    expect(next[4]).toEqual(elements[4]); expect(next[5]).toEqual(elements[5]);
    expect(new Set(operations.map(operation => operation.id)).size).toBe(operations.length);
  });
});
