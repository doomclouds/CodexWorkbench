import { describe, expect, test } from 'vitest';
import { fitPageScale, markVisualLayers, pointsRectToViewport, safePdfUrl, screenRectToPoints, subtractRects, usefulRects, viewportRectToPoints, type PageGeometry } from '../src/app/pdf/geometry';
import type { MarkRect, ReaderMark } from '../src/contracts/reader';

function geometry(rotation: number, scale = 1.75): PageGeometry {
  const width = 600; const height = 800; const view = [20, 30, 620, 830];
  const toViewport = (x: number, y: number): [number, number] => {
    const left = x - view[0]; const top = view[3] - y;
    if (rotation === 90) return [(height - top) * scale, left * scale];
    if (rotation === 180) return [(width - left) * scale, (height - top) * scale];
    if (rotation === 270) return [top * scale, (width - left) * scale];
    return [left * scale, top * scale];
  };
  const toPdf = (x: number, y: number): [number, number] => {
    const a = x / scale; const b = y / scale;
    const [left, top] = rotation === 90 ? [b, height - a] : rotation === 180 ? [width - a, height - b] : rotation === 270 ? [width - b, a] : [a, b];
    return [view[0] + left, view[3] - top];
  };
  return { width, height, view, viewport: { width: (rotation % 180 ? height : width) * scale, height: (rotation % 180 ? width : height) * scale, convertToViewportPoint: toViewport, convertToPdfPoint: toPdf } as unknown as PageGeometry['viewport'] };
}

describe('PDF selection geometry', () => {
  for (const rotation of [0, 90, 180, 270]) test(`round-trips crop-box coordinates after ${rotation}° rotation and zoom`, () => {
    const page = geometry(rotation); const original = { x: 42.5, y: 130.25, w: 185.125, h: 14.75 };
    const displayed = pointsRectToViewport(original, page);
    const restored = viewportRectToPoints(displayed, page);
    for (const key of ['x', 'y', 'w', 'h'] as const) expect(restored[key]).toBeCloseTo(original[key], 8);
  });
  test('normalized persisted marks and point marks draw at the same location', () => {
    const page = geometry(90); const points = { x: 60, y: 80, w: 120, h: 16 };
    expect(pointsRectToViewport({ x: .1, y: .1, w: .2, h: .02 }, page, true)).toEqual(pointsRectToViewport(points, page));
  });
  test('fit width is computed independently for portrait and rotated landscape pages including the comment gutter', () => {
    const readerContentWidth = 1080; const gutter = 226; const available = readerContentWidth - gutter;
    const portrait = geometry(0, 1); const rotated = geometry(90, 1);
    const portraitScale = fitPageScale(portrait.viewport.width, available);
    const rotatedScale = fitPageScale(rotated.viewport.width, available);
    expect(portraitScale).not.toBe(rotatedScale);
    expect(portrait.viewport.width * portraitScale + gutter).toBeCloseTo(readerContentWidth);
    expect(rotated.viewport.width * rotatedScale + gutter).toBeCloseTo(readerContentWidth);
  });
  test('fit does not impose the manual zoom minimum on a very wide page in a narrow pane', () => {
    const scale = fitPageScale(2400, 420);
    expect(scale).toBeLessThan(.35);
    expect(2400 * scale).toBeLessThanOrEqual(420);
  });
  test('screen bounds account for CSS scaling independently of canvas device pixels', () => {
    const page = geometry(270, 2); const original = { x: 100, y: 200, w: 50, h: 12 }; const displayed = pointsRectToViewport(original, page);
    const bounds = { left: 55, top: 90, width: page.viewport.width / 2, height: page.viewport.height / 2 };
    const restored = screenRectToPoints({ left: bounds.left + displayed.x / 2, top: bounds.top + displayed.y / 2, width: displayed.w / 2, height: displayed.h / 2 }, bounds, page);
    expect(restored).toEqual(original);
  });
  test('drops empty/invalid and duplicate DOM selection rectangles', () => {
    expect(usefulRects([{ x: 1, y: 2, w: 30, h: 9 }, { x: 1.1, y: 2.1, w: 30, h: 9 }, { x: 0, y: 0, w: 0, h: 5 }, { x: NaN, y: 0, w: 1, h: 1 }])).toEqual([{ x: 1, y: 2, w: 30, h: 9 }]);
  });
  test('overlapping saved records paint each area once and retain real line and column gaps', () => {
    const rects = [{ x: 10, y: 20, w: 100, h: 12 }, { x: 200, y: 20, w: 100, h: 12 }, { x: 10, y: 45, w: 100, h: 12 }];
    const mark = (id: string, color: ReaderMark['color'], areas = rects): ReaderMark => ({ id, color, kind: 'highlight', page: 1, space: 'pt', rects: areas, quote: '', note: '' });
    const layers = markVisualLayers([mark('original', 'yellow'), mark('duplicate', 'yellow'), mark('overlap', 'blue', [{ x: 80, y: 22, w: 60, h: 12 }])], geometry(0));
    const painted = layers.fills.flatMap(layer => layer.rects); const area = (items: MarkRect[]) => items.reduce((sum, rect) => sum + rect.w * rect.h, 0);
    expect(area(painted)).toBe(4020); expect(area(usefulRects(painted))).toBe(area(painted));
    expect(painted.some(rect => rect.x < 200 && rect.x + rect.w > 140)).toBe(false);
    expect(painted.some(rect => rect.y < 45 && rect.y + rect.h > 34)).toBe(false);
    expect(layers.fills.find(layer => layer.color === '#7dd3fc')?.rects).toEqual([{ x: 80, y: 22, w: 60, h: 12 }]);
  });
  test('live selection fill excludes saved highlight areas without bridging surrounding gaps', () => {
    const selected = [{ x: 10, y: 20, w: 100, h: 12 }, { x: 200, y: 20, w: 100, h: 12 }, { x: 10, y: 45, w: 100, h: 12 }];
    expect(subtractRects(selected, [{ x: 50, y: 20, w: 100, h: 12 }, selected[1]])).toEqual([{ x: 10, y: 20, w: 40, h: 12 }, selected[2]]);
  });
  test('PDF external links accept web/mail destinations and reject file/script actions', () => {
    expect(safePdfUrl('https://example.org/paper#section')).toBe('https://example.org/paper#section');
    expect(safePdfUrl('mailto:reader@example.org')).toBe('mailto:reader@example.org');
    for (const value of ['javascript:alert(1)', 'file:///C:/private.txt', 'data:text/html,test', '../paper.pdf']) expect(safePdfUrl(value)).toBeNull();
  });
});
