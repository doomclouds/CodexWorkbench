import { describe, expect, it } from 'vitest';
import type { BoardElement, Operation } from '../src/contracts/studio.js';
import { arrangeSelection } from '../src/app/canvas/selection-layout.js';

const box = (id: string, x: number, y = 0, extra: Partial<BoardElement> = {}): BoardElement => ({ id, type: 'shape', x, y, w: 100, h: 60, version: 1, text: id, ...extra });
const patch = (elements: BoardElement[], operations: Operation[]) => elements.map(element => ({ ...element, ...operations.find(operation => operation.id === element.id)?.changes }));

describe('explicit geometric selection layout', () => {
  it('distributes unequal rectangles by equal net gaps and leaves both outside bounds fixed', () => {
    const source = [box('a', 0, 0, { w: 80 }), box('b', 175, 30, { w: 140 }), box('c', 420, 90, { w: 60 }), box('outside', 1200)];
    const next = patch(source, arrangeSelection(source, ['a', 'b', 'c'], 'distribute-horizontal').operations);
    expect(next[0]).toEqual(source[0]); expect(next[2]).toEqual(source[2]); expect(next[3]).toEqual(source[3]);
    expect(next[1].x - next[0].x - next[0].w).toBeCloseTo(next[2].x - next[1].x - next[1].w);
    expect(next[1].y).toBe(30);
  });
  it('distributes vertical gaps without changing horizontal positions', () => {
    const source = [box('a', 30, 0, { h: 40 }), box('b', 70, 100, { h: 90 }), box('c', 110, 320, { h: 60 })];
    const next = patch(source, arrangeSelection(source, source.map(item => item.id), 'distribute-vertical').operations);
    expect(next.map(item => item.x)).toEqual([30, 70, 110]);
    expect(next[1].y - next[0].y - next[0].h).toBeCloseTo(next[2].y - next[1].y - next[1].h);
  });
  it('keeps an entire partly-selected group and container contents together when making a row', () => {
    const source = [box('a', 0, 0, { groupId: 'g' }), box('b', 120, 20, { groupId: 'g' }), box('frame', 500, 20, { type: 'container', w: 260, h: 170 }), box('child', 530, 60, { parentId: 'frame', w: 80 }), box('c', 900, 400)];
    const next = patch(source, arrangeSelection(source, ['a', 'frame', 'c'], 'row', 40).operations);
    expect(next[1].x - next[0].x).toBe(120); expect(next[1].y - next[0].y).toBe(20);
    expect(next[3].x - next[2].x).toBe(30); expect(next[3].y - next[2].y).toBe(40);
    expect(next[2].x - (next[1].x + next[1].w)).toBe(40);
    expect(next[4].x - (next[2].x + next[2].w)).toBe(40);
  });
  it('skips a whole group containing a locked member and nodes touching a locked bound arrow', () => {
    const source = [box('a', 0, 0, { groupId: 'g' }), box('locked', 120, 0, { groupId: 'g', locked: true }), box('b', 500), box('c', 900), box('edge', 0, 0, { type: 'arrow', from: 'b', to: 'c', locked: true }), box('d', 1300), box('e', 1600)];
    const result = arrangeSelection(source, ['a', 'b', 'c', 'd', 'e'], 'column', 24);
    expect(result.skippedIds).toEqual(expect.arrayContaining(['a', 'locked', 'b', 'c']));
    const next = patch(source, result.operations);
    for (const id of ['a', 'locked', 'b', 'c', 'edge']) expect(next.find(item => item.id === id)).toEqual(source.find(item => item.id === id));
    expect(next.find(item => item.id === 'e')!.y).toBe(84);
    expect(result.warnings.join('')).toContain('锁定');
  });
  it('only enlarges width, height or both to the largest selected frame, without changing text or source', () => {
    const source = [box('a', 0, 0, { w: 80, h: 50, text: '保留正文', fontSize: 17 }), box('html', 200, 0, { type: 'html', w: 200, h: 120, html: '<h1>HTML</h1>' }), box('media', 500, 0, { type: 'image', w: 160, h: 90, src: 'data:image/png;base64,AA' })];
    const same = patch(source, arrangeSelection(source, source.map(item => item.id), 'same-size').operations);
    expect(same.map(item => [item.w, item.h])).toEqual([[200, 120], [200, 120], [200, 120]]);
    expect(same[0]).toMatchObject({ text: '保留正文', fontSize: 17 }); expect(same[1].html).toBe(source[1].html); expect(same[2].src).toBe(source[2].src);
    const width = patch(source, arrangeSelection(source, ['a', 'html'], 'same-width').operations);
    expect(width[0]).toMatchObject({ w: 200, h: 50 });
    const height = patch(source, arrangeSelection(source, ['a', 'html'], 'same-height').operations);
    expect(height[0]).toMatchObject({ w: 80, h: 120 });
  });
  it('lays out a variable-sized grid with the requested gap and preserves original object order', () => {
    const source = [box('b', 400, 0, { w: 70 }), box('a', 0, 0, { w: 150 }), box('d', 400, 300), box('c', 0, 300, { h: 90 })];
    const next = patch(source, arrangeSelection(source, source.map(item => item.id), 'grid', 36).operations);
    const by = Object.fromEntries(next.map(item => [item.id, item]));
    expect(by.b.x - by.a.x - by.a.w).toBe(36);
    expect(by.c.y - by.a.y - by.a.h).toBe(36);
    expect(by.d.y).toBe(by.c.y);
  });
  it('rejects impossible non-overlapping distribution instead of moving outer anchors or silently overlapping', () => {
    const source = [box('a', 0, 0, { w: 200 }), box('b', 50, 0, { w: 200 }), box('c', 100, 0, { w: 200 })];
    const result = arrangeSelection(source, source.map(item => item.id), 'distribute-horizontal');
    expect(result.operations).toEqual([]); expect(result.warnings.join('')).toContain('空间不足');
  });
  it('does not move a visually outer wide object when overlapping boxes make their order ambiguous', () => {
    const source = [box('a', 0), box('wide', 200, 0, { w: 500 }), box('c', 600, 0, { w: 50 })];
    const result = arrangeSelection(source, source.map(item => item.id), 'distribute-horizontal');
    expect(result.operations).toEqual([]); expect(result.warnings.join('')).toContain('外侧顺序');
  });
  it('bounds large selections and expanded groups before doing layout work', () => {
    const source = Array.from({ length: 201 }, (_, index) => box(`node-${index}`, index * 120, 0, { groupId: 'large' }));
    expect(() => arrangeSelection(source, source.map(item => item.id), 'row')).toThrow('200');
    expect(() => arrangeSelection(source, [source[0].id], 'row')).toThrow('含组内内容');
  });
});
