import { expect, test } from 'vitest';
import type { ReaderMark } from '../src/contracts/reader';
import { layoutMarkPins, placeMarkPopover } from '../src/app/pdf/mark-pins';
import { usefulRects, type PageGeometry } from '../src/app/pdf/geometry';

const geometry = { width: 600, height: 800, view: [0, 0, 600, 800], viewport: { width: 600, height: 800, convertToViewportPoint: (x: number, y: number) => [x, 800 - y] } } as unknown as PageGeometry;
const mark = (id: string, fields: Partial<ReaderMark> = {}): ReaderMark => ({ id, page: 1, kind: 'highlight', space: 'pt', rects: [{ x: 40, y: 100, w: 80, h: 12 }, { x: 40, y: 120, w: 300, h: 12 }], quote: 'synthetic', note: '', ...fields });

test('saved geometry removes duplicate, contained and crossing areas without filling column or line gaps', () => {
  const rects = usefulRects([{ x: 10, y: 20, w: 100, h: 12 }, { x: 15, y: 22, w: 20, h: 8 }, { x: 80, y: 22, w: 60, h: 12 }, { x: 200, y: 20, w: 100, h: 12 }, { x: 10, y: 45, w: 100, h: 12 }]);
  const area = rects.reduce((total, rect) => total + rect.w * rect.h, 0);
  expect(area).toBe(4020);
  for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
    const width = Math.min(rects[a].x + rects[a].w, rects[b].x + rects[b].w) - Math.max(rects[a].x, rects[b].x);
    const height = Math.min(rects[a].y + rects[a].h, rects[b].y + rects[b].h) - Math.max(rects[a].y, rects[b].y);
    expect(width <= 0 || height <= 0).toBe(true);
  }
  expect(rects.some(rect => rect.x < 200 && rect.x + rect.w > 140)).toBe(false);
  expect(rects.some(rect => rect.y < 45 && rect.y + rect.h > 34)).toBe(false);
});
test('pins require real comment/question/result/reply/asset content and anchor to full selection envelope', () => {
  const groups = layoutMarkPins([mark('plain'), mark('with-comment', { comment: 'read this' })], geometry);
  expect(groups).toHaveLength(1); expect(groups[0].marks[0].id).toBe('with-comment');
  expect(groups[0].x).toBe(346); expect(groups[0].y).toBe(74);
  expect(layoutMarkPins([mark('reply', { messages: [{ id: 'r', role: 'user', content: 'reply', createdAt: '' }] }), mark('asset', { asset: 'mark.png' })], geometry)[0].marks).toHaveLength(2);
});
test('text collisions move pins into the reserved page margin and colliding pins form selectable groups', () => {
  const groups = layoutMarkPins([mark('one', { comment: 'a' }), mark('two', { question: 'b' }), mark('far', { comment: 'c', rects: [{ x: 40, y: 500, w: 100, h: 12 }] })], geometry, [{ x: 300, y: 70, w: 200, h: 30 }]);
  expect(groups).toHaveLength(2); expect(groups[0].x).toBe(604); expect(groups[0].marks.map(item => item.id)).toEqual(['one', 'two']);
  expect(groups[1].y).toBe(474);
});
test('popover flips to available space and dense pages keep an inline preview away from the active source', () => {
  const boundary = { left: 10, top: 20, right: 610, bottom: 800 };
  const source = { left: 50, top: 300, right: 500, bottom: 400 };
  const placed = placeMarkPopover({ left: 510, top: 274, right: 532, bottom: 296 }, boundary, 280, 200, source);
  expect(placed).toEqual({ left: 252, top: 66 });
  const dense = placeMarkPopover({ left: 510, top: 274, right: 532, bottom: 296 }, boundary, 280, 200, source, [boundary]);
  expect(dense.left).toBeGreaterThanOrEqual(boundary.left); expect(dense.left + 280).toBeLessThanOrEqual(boundary.right);
  expect(dense.top + 200 <= source.top || dense.top >= source.bottom).toBe(true);
  const fullSource = placeMarkPopover({ left: 500, top: 300, right: 522, bottom: 322 }, boundary, 300, 400, boundary);
  expect(fullSource.top).toBeGreaterThanOrEqual(boundary.top); expect(fullSource.top + 400).toBeLessThanOrEqual(boundary.bottom);
});

test('popover uses nearby free space beyond adjacent lines', () => {
  const boundary = { left: 10, top: 20, right: 610, bottom: 800 };
  const source = { left: 50, top: 300, right: 500, bottom: 350 };
  const text = [{ left: 10, top: 20, right: 610, bottom: 290 }, { left: 10, top: 300, right: 610, bottom: 420 }];
  const placed = placeMarkPopover({ left: 510, top: 274, right: 532, bottom: 296 }, boundary, 280, 210, source, text);
  expect(placed).not.toBeNull();
  expect(placed!.top).toBeGreaterThanOrEqual(428);
  expect(placed!.top + 210).toBeLessThanOrEqual(boundary.bottom);
});

test('narrow viewports clamp popup geometry even when no empty text area exists', () => {
  const boundary = { left: 50, top: 100, right: 260, bottom: 310 };
  expect(placeMarkPopover({ left: 230, top: 190, right: 252, bottom: 212 }, boundary, 310, 400, boundary, [boundary])).toEqual({ left: 50, top: 100 });
});
