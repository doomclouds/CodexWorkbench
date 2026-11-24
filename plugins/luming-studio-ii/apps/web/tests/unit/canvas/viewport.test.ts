import { describe, expect, it } from 'vitest';

import {
  boardToScreen,
  containsPoint,
  defaultViewport,
  fitViewport,
  getObjectBounds,
  getViewportBounds,
  mergeRects,
  normalizeViewport,
  panViewport,
  rectsIntersect,
  screenToBoard,
  zoomViewport,
} from '../../../src/ui/domain/canvas/viewport/index.js';

describe('canvas viewport', () => {
  it('converts board and screen coordinates using screen-pixel offsets', () => {
    const view = { x: 100, y: -30, zoom: 2 };
    const point = { x: -15, y: 8 };
    const screen = boardToScreen(point, view);

    expect(screen).toEqual({ x: 70, y: -14 });
    expect(screenToBoard(screen, view)).toEqual(point);
    expect(panViewport(view, { x: 30, y: -10 })).toEqual({ x: 130, y: -40, zoom: 2 });
  });

  it('expands visible bounds from screen-pixel overscan', () => {
    const view = { x: 50, y: -20, zoom: 2 };
    const size = { width: 300, height: 160 };

    expect(getViewportBounds(view, size, 20)).toEqual({ x: -35, y: 0, width: 170, height: 100 });
    expect(getViewportBounds(view, size, -8)).toEqual({ x: -25, y: 10, width: 150, height: 80 });
  });

  it('keeps the same board point under the zoom anchor at both limits', () => {
    const view = { x: 50, y: 100, zoom: 2 };
    const anchor = { x: 150, y: 50 };
    const point = screenToBoard(anchor, view);
    const larger = zoomViewport(view, anchor, 100);
    const smaller = zoomViewport(view, anchor, 0.001);

    expect(larger.zoom).toBe(8);
    expect(smaller.zoom).toBe(0.05);
    expect(boardToScreen(point, larger)).toEqual(anchor);
    expect(boardToScreen(point, smaller)).toEqual(anchor);
  });

  it('fits the bounds around the center of the viewport', () => {
    const rect = { x: 50, y: -50, width: 200, height: 100 };
    const size = { width: 400, height: 300 };
    const view = fitViewport(rect, size);

    expect(view.zoom).toBe(2);
    expect(boardToScreen(rect, view)).toEqual({ x: 0, y: 50 });
    expect(boardToScreen({ x: 250, y: 50 }, view)).toEqual({ x: 400, y: 250 });
    expect(fitViewport({ ...rect, width: 0, height: 0 }, size).zoom).toBe(8);
  });

  it('normalizes invalid viewport data and empty measurements', () => {
    const invalidView = { x: Infinity, y: NaN, zoom: -5 };
    const size = { width: -30, height: Infinity };
    const rect = { x: 20, y: 20, width: 80, height: 40 };

    expect(normalizeViewport(invalidView)).toEqual(defaultViewport);
    expect(normalizeViewport({ x: 0, y: 0, zoom: 12 }).zoom).toBe(8);
    expect(getViewportBounds(invalidView, size, NaN).width).toBe(0);
    expect(getViewportBounds(invalidView, size, NaN).height).toBe(0);
    expect(fitViewport(rect, size)).toEqual(defaultViewport);
    expect(fitViewport(undefined, { width: 300, height: 200 })).toEqual(defaultViewport);
    expect(zoomViewport(invalidView, { x: 10, y: 15 }, NaN)).toEqual(defaultViewport);
  });

  it('computes rotated bounds around the object center and hits the rotated geometry', () => {
    const original = { x: 10, y: 20, width: 80, height: 20, rotation: 90 };
    const bounds = getObjectBounds(original);

    expect(bounds.x).toBeCloseTo(40);
    expect(bounds.y).toBeCloseTo(-10);
    expect(bounds.width).toBeCloseTo(20);
    expect(bounds.height).toBeCloseTo(80);
    expect(containsPoint({ x: 50, y: -10 }, original)).toBe(true);
    expect(containsPoint({ x: 30, y: 30 }, original)).toBe(false);
  });

  it('rejects points in the bounds outside a rotated object', () => {
    const rotated = { x: 0, y: 0, width: 100, height: 20, rotation: 45 };
    const point = { x: 15, y: 45 };

    expect(rectsIntersect({ ...point, width: 0, height: 0 }, getObjectBounds(rotated))).toBe(true);
    expect(containsPoint(point, rotated)).toBe(false);
    expect(containsPoint({ x: 75, y: 35 }, rotated)).toBe(true);
  });

  it('counts shared edges and merges valid rectangles across the origin', () => {
    const left = { x: -20, y: 8, width: 40, height: 12 };
    const right = { x: 20, y: -6, width: 15, height: 20 };
    const apart = { x: 30, y: 25, width: 10, height: 2 };
    const invalid = { ...apart, width: -1 };

    expect(rectsIntersect(left, right)).toBe(true);
    expect(rectsIntersect(left, apart)).toBe(false);
    expect(rectsIntersect(right, invalid)).toBe(false);
    expect(mergeRects([left, right, invalid])).toEqual({ x: -20, y: -6, width: 55, height: 26 });
    expect(mergeRects([invalid])).toBeUndefined();
  });
});
