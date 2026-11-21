import { describe, expect, it } from 'vitest';
import {
  arrowGeometry,
  assetDisplayUrl,
  canvasStyle,
  duplicateElements,
  expandMoveIds,
  fitViewport,
  makeElement,
  moveOperations,
  placeFormatToolbar,
  zoomAt,
} from '../src/app/canvas/canvas-model.js';
import { DEFAULT_STYLE, type BoardElement, type StudioClient } from '../src/contracts/studio.js';
import { contrastRatio } from '../src/core/theme.js';

const shape = (id: string, x = 0, y = 0, extra: Partial<BoardElement> = {}): BoardElement => ({
  id,
  type: 'shape',
  x,
  y,
  w: 100,
  h: 80,
  version: 3,
  text: id,
  ...extra,
});

describe('whiteboard geometry', () => {
  it('keeps offscreen selection actions beside the view controls with a usable gap', () => {
    const size = { w: 264, h: 42 };
    const viewport = { w: 800, h: 600 };
    const hud = { x: 660, y: 12, w: 126, h: 38 };
    const position = placeFormatToolbar({ x: 1590, y: -200, w: 20, h: 10 }, size, viewport, [hud])!;
    expect(position.x + size.w / 2).toBeLessThanOrEqual(hud.x - 8);
    expect(position.x - size.w / 2).toBeGreaterThanOrEqual(12);
    expect(position.y).toBe(12);
  });
  it('moves selection actions below the view controls when a narrow canvas cannot fit them beside it', () => {
    const size = { w: 264, h: 42 };
    const viewport = { w: 300, h: 400 };
    const hud = { x: 160, y: 12, w: 126, h: 38 };
    const position = placeFormatToolbar({ x: 1590, y: 12, w: 20, h: 10 }, size, viewport, [hud])!;
    expect(position.y).toBeGreaterThanOrEqual(hud.y + hud.h + 8);
    expect(position.x - size.w / 2).toBeGreaterThanOrEqual(12);
    expect(position.x + size.w / 2).toBeLessThanOrEqual(viewport.w - 12);
  });
  it('keeps nonconflicting selection actions at their original position', () => {
    const anchor = { x: 140, y: 200, w: 200, h: 80 };
    const size = { w: 264, h: 42 };
    const viewport = { w: 800, h: 600 };
    expect(placeFormatToolbar(anchor, size, viewport, [{ x: 660, y: 12, w: 126, h: 38 }])).toEqual({
      x: 240,
      y: 150,
      w: 264,
    });
    expect(placeFormatToolbar({ x: 1590, y: -200, w: 20, h: 10 }, size, viewport)).toEqual({
      x: 656,
      y: 12,
      w: 264,
    });
  });
  it('uses the expanded title and handle bounds, preferring a clear row above or below', () => {
    const size = { w: 264, h: 42 };
    const viewport = { w: 800, h: 600 };
    const anchor = { x: 260, y: 160, w: 240, h: 220 };
    const neighbor = { x: 400, y: 110, w: 300, h: 24 };
    expect(placeFormatToolbar(anchor, size, viewport, [neighbor])).toEqual({
      x: 260,
      y: 110,
      w: 264,
    });
    expect(placeFormatToolbar({ ...anchor, y: 4 }, size, viewport, [neighbor])?.y).toBe(232);
  });
  it('narrows the existing scrolling toolbar when neither side of an obstacle fits its full width', () => {
    const position = placeFormatToolbar(
      { x: 70, y: 120, w: 120, h: 80 },
      { w: 340, h: 42 },
      { w: 400, h: 300 },
      [{ x: 185, y: 0, w: 30, h: 300 }],
    );
    expect(position).toEqual({ x: 94.5, y: 70, w: 165 });
  });
  it('projects an uncustomized theme with matching paper and ink without mutating shared content', () => {
    const original = structuredClone(DEFAULT_STYLE);
    const dark = canvasStyle(original, 'dark');
    expect(dark.paper).toBe('#2d3142');
    expect(contrastRatio(dark.ink, dark.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dark.muted, dark.paper)).toBeGreaterThanOrEqual(4.5);
    expect(original).toEqual(DEFAULT_STYLE);
    const customized = { ...original, name: 'My palette', paper: '#fff0b5' };
    expect(canvasStyle(customized, 'dark')).toBe(customized);
  });
  it('keeps the board point underneath a pinch stationary', () => {
    const viewport = { x: 33, y: -80, zoom: 0.8 };
    const point = { x: 220, y: 140 };
    const next = zoomAt(viewport, point, 1.6);
    expect((point.x - next.x) / next.zoom).toBeCloseTo((point.x - viewport.x) / viewport.zoom);
    expect((point.y - next.y) / next.zoom).toBeCloseTo((point.y - viewport.y) / viewport.zoom);
  });

  it('fits a large canvas into a narrow panel with visible padding', () => {
    const items = [shape('left', -1000, -600), shape('right', 1000, 700)];
    const view = fitViewport(items, 550, 600, 40);
    for (const item of items) {
      expect(item.x * view.zoom + view.x).toBeGreaterThanOrEqual(39.9);
      expect(item.y * view.zoom + view.y).toBeGreaterThanOrEqual(39.9);
      expect((item.x + item.w) * view.zoom + view.x).toBeLessThanOrEqual(510.1);
      expect((item.y + item.h) * view.zoom + view.y).toBeLessThanOrEqual(560.1);
    }
  });

  it('moves grouped and contained content without rewriting its text or source', () => {
    const frame = shape('frame', 0, 0, { type: 'container', w: 600, h: 500 });
    const html = shape('html', 50, 80, { type: 'html', html: '<p>untouched</p>' });
    const member = shape('member', 700, 100, { groupId: 'group' });
    const peer = shape('peer', 900, 100, { groupId: 'group' });
    const locked = shape('locked', 50, 250, { locked: true });
    const elements = [frame, html, member, peer, locked];
    const ids = expandMoveIds(elements, ['frame', 'member']);
    expect(ids.sort()).toEqual(['frame', 'html', 'member', 'peer']);
    const operations = moveOperations(elements, ids, { x: 35, y: -20 });
    expect(operations.find((operation) => operation.id === 'html')?.changes).toEqual({
      x: 85,
      y: 60,
    });
    expect(html.html).toBe('<p>untouched</p>');
  });

  it('routes bound arrows to the current edges of moving objects', () => {
    const a = shape('a', 0, 0);
    const b = shape('b', 400, 200);
    const arrow = shape('edge', 0, 0, { type: 'arrow', from: 'a', to: 'b' });
    const first = arrowGeometry(arrow, [a, b]);
    expect(first.points[0]).toEqual({ x: 100, y: 40 });
    expect(first.points.at(-1)).toEqual({ x: 400, y: 240 });
    const moved = arrowGeometry(arrow, [a, { ...b, x: 600 }]);
    expect(moved.points.at(-1)).toEqual({ x: 600, y: 240 });
    for (let index = 1; index < moved.points.length; index++) {
      const previous = moved.points[index - 1]!;
      const next = moved.points[index]!;
      expect(previous.x === next.x || previous.y === next.y).toBe(true);
    }
  });

  it('routes native relative bends and keeps them relative when moving a line', () => {
    const a = shape('a', 0, 0);
    const b = shape('b', 400, 200);
    const arrow = shape('edge', 0, 0, {
      type: 'arrow',
      from: 'a',
      to: 'b',
      bends: ['v', 65, -160, -75],
    });
    const geometry = arrowGeometry(arrow, [a, b]);
    expect(geometry.points).toEqual([
      { x: 50, y: 80 },
      { x: 50, y: 105 },
      { x: -110, y: 105 },
      { x: -110, y: 165 },
      { x: 450, y: 165 },
      { x: 450, y: 200 },
    ]);
    expect(moveOperations([arrow], ['edge'], { x: 20, y: 30 })[0]!.changes).not.toHaveProperty(
      'bends',
    );
    const moved = arrowGeometry(arrow, [a, { ...b, x: 600 }]);
    expect(moved.points[2]!.x).toBe(-110);
    expect(moved.points[4]!.x).toBe(650);
    const points = shape('points', 0, 0, {
      type: 'arrow',
      from: [0, 0],
      to: [200, 0],
      bends: [50, 0, 50, 80, 200, 80],
    });
    expect(arrowGeometry(points, []).points).toHaveLength(5);
    expect(moveOperations([points], ['points'], { x: 20, y: 30 })[0]!.changes?.bends).toEqual([
      70, 30, 70, 110, 220, 110,
    ]);
  });

  it('copies internal relationships without pointing copied arrows back into the original group', () => {
    const elements = [
      shape('a', 0, 0, { groupId: 'g' }),
      shape('b', 200, 0, { groupId: 'g' }),
      shape('edge', 0, 0, { type: 'arrow', groupId: 'g', from: 'a', to: 'b' }),
    ];
    const copy = duplicateElements(elements, ['a']);
    expect(copy).toHaveLength(3);
    expect(copy.every((element) => !elements.some((original) => original.id === element.id))).toBe(
      true,
    );
    const arrow = copy.find((element) => element.type === 'arrow')!;
    expect(copy.some((element) => element.id === arrow.from)).toBe(true);
    expect(copy.some((element) => element.id === arrow.to)).toBe(true);
    expect(copy[0]!.groupId).not.toBe('g');
    expect(new Set(copy.map((element) => element.groupId)).size).toBe(1);
  });
});

describe('media references', () => {
  const client = {
    baseUrl: 'http://127.0.0.1:4771',
    token: 'local-secret',
    embedded: false,
  } as StudioClient;
  it('adds the authorization token only to the rendering URL of local assets', () => {
    const stored = '/assets/board/image';
    const displayed = new URL(assetDisplayUrl(stored, client)!);
    expect(displayed.searchParams.get('token')).toBe('local-secret');
    expect(stored).toBe('/assets/board/image');
    expect(
      new URL(assetDisplayUrl('https://example.com/image.png', client)!).searchParams.has('token'),
    ).toBe(false);
    expect(assetDisplayUrl('javascript:alert(1)', client)).toBeUndefined();
  });
});

it('creates an editable object with a stable identity instead of a bitmap', () => {
  const element = makeElement('shape', { x: 40, y: 80 }, { text: '统一网关', kind: 'database' });
  expect(element).toMatchObject({
    type: 'shape',
    x: 40,
    y: 80,
    text: '统一网关',
    kind: 'database',
    version: 0,
  });
  expect(element.id).not.toBe(makeElement('shape', { x: 40, y: 80 }).id);
});
