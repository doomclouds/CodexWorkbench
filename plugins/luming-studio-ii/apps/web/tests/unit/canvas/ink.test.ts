import { describe, expect, it } from 'vitest';
import type { CanvasPoint } from '../../../src/ui/domain/canvas/contracts.js';
import {
  appendInkSample,
  hitInk,
  inkBounds,
  inkPathData,
  makeInkDraft,
  maxInkSamples,
  renderedInkWidth,
  scaleInk,
  snapInkPoint,
} from '../../../src/ui/domain/canvas/ink/geometry.js';

function draftFor(samples: readonly CanvasPoint[], width = 4) {
  const draft = makeInkDraft(samples, width, '笔迹');
  if (!draft) {
    throw new Error('Expected the samples to define an ink draft.');
  }

  return draft;
}

describe('Canvas ink', () => {
  it('samples two screen pixels apart and retains the exact release point', () => {
    const samples: CanvasPoint[] = [];
    expect(appendInkSample(samples, { x: NaN, y: 8 }, 2)).toBe(false);
    expect(appendInkSample(samples, { x: 12, y: 8 }, 2)).toBe(true);
    expect(appendInkSample(samples, { x: 12.75, y: 8 }, 2)).toBe(false);
    expect(appendInkSample(samples, { x: 13, y: 8 }, 2)).toBe(true);
    expect(appendInkSample(samples, { x: 13.75, y: 8 }, 2, true)).toBe(true);
    expect(appendInkSample(samples, { x: 13.75, y: 8 }, 2, true)).toBe(false);
    expect(samples.map(({ x }) => x)).toEqual([12, 13, 13.75]);
  });

  it('keeps the complete 20,000-point stroke and refuses to append a release tail', () => {
    const samples: CanvasPoint[] = [];
    const input = Array.from({ length: 20_000 }, (_, index) => ({ x: index * 3, y: index % 4 }));
    for (const point of input) {
      appendInkSample(samples, point, 1);
    }

    expect(maxInkSamples).toBe(20_000);
    expect(appendInkSample(samples, { x: 60_000, y: 0 }, 1, true)).toBe(false);
    expect(samples).toEqual(input);
    expect(draftFor(samples).ink.points).toHaveLength(20_000);
  });

  it('preserves normalized coordinates for both a single dot and a horizontal stroke', () => {
    const dot = draftFor([{ x: 16, y: 24 }]);
    expect(dot.geometry).toEqual({ x: 14, y: 22, width: 4, height: 4, rotation: 0 });
    expect(dot.ink.points).toEqual([{ x: 0.5, y: 0.5 }]);
    expect(hitInk(dot.ink, dot.geometry, { x: 16, y: 24 })).toBe(true);
    expect(hitInk(dot.ink, dot.geometry, { x: 48, y: 24 })).toBe(false);

    const samples = [
      { x: 0, y: 20 },
      { x: 40, y: 20 },
    ];
    const stroke = draftFor(samples);
    samples.push({ x: 60, y: 40 });
    expect(stroke.ink.points).toEqual([
      { x: 2 / 44, y: 0.5 },
      { x: 42 / 44, y: 0.5 },
    ]);
    expect(stroke.geometry).toEqual({ x: -2, y: 18, width: 44, height: 4, rotation: 0 });
    expect(makeInkDraft([], 4, '空笔迹')).toBeUndefined();
  });

  it('snaps a straight segment by 45 degrees while preserving its length', () => {
    const anchor = { x: 10, y: 20 };
    const end = snapInkPoint(anchor, { x: 18, y: 26 });
    expect(end.x - anchor.x).toBeCloseTo(end.y - anchor.y);
    expect(Math.hypot(end.x - anchor.x, end.y - anchor.y)).toBeCloseTo(10);
  });

  it('scales the pen width with two axis factors and keeps the normalized path', () => {
    const { ink, geometry } = draftFor([
      { x: 10, y: 10 },
      { x: 28, y: 10 },
    ]);
    const resized = { ...geometry, width: geometry.width * 2, height: geometry.height * 3 };
    const scaled = scaleInk(ink, geometry, resized);
    expect(scaled.width).toBe(10);
    expect(scaled.points).toBe(ink.points);
    expect(scaleInk(ink, geometry, { ...geometry, rotation: 180 })).toBe(ink);
    expect(scaleInk(ink, geometry, { ...geometry, width: 0, height: 0 }).width).toBe(0.1);
  });

  it('uses the same smoothed curve for painting and geometric hit testing', () => {
    const ink = {
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
      width: 2,
    };
    const geometry = { x: 0, y: 0, width: 40, height: 40, rotation: 0 };
    expect(inkPathData(ink, geometry.width, geometry.height)).toBe('M 0 0 Q 0 40 20 40 L 40 40');
    expect(hitInk(ink, geometry, { x: 5, y: 30 })).toBe(true);
    expect(hitInk(ink, geometry, { x: 15, y: 14 })).toBe(false);
    expect(hitInk(ink, geometry, { x: 41, y: 40 })).toBe(true);
  });

  it('retains a sharp corner when the sampled control point is repeated', () => {
    const geometry = { x: 0, y: 0, width: 40, height: 40, rotation: 0 };
    const corner = {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      width: 2,
    };
    expect(inkPathData(corner, geometry.width, geometry.height)).toContain('Q 40 0 40 0');
    expect(hitInk(corner, geometry, { x: 40, y: 0 })).toBe(true);
  });

  it('measures imported samples and paint beyond the stored frame with rotation', () => {
    const ink = {
      points: [
        { x: -0.025, y: -0.05 },
        { x: 0.175, y: 0.05 },
      ],
      width: 4,
    };
    const geometry = { x: 10, y: 20, width: 200, height: 200, rotation: 0 };
    const bounds = inkBounds(ink, geometry, 1);
    expect(bounds.x).toBeCloseTo(3);
    expect(bounds.y).toBeCloseTo(8);
    expect(bounds.width).toBeCloseTo(44);
    expect(bounds.height).toBeCloseTo(24);

    const rotated = inkBounds(ink, { ...geometry, rotation: 90 }, 1);
    expect(rotated.x).toBeCloseTo(198);
    expect(rotated.y).toBeCloseTo(13);
    expect(rotated.width).toBeCloseTo(24);
    expect(rotated.height).toBeCloseTo(44);
  });

  it('scales the hit margin with viewport zoom and handles rotated or resized geometry', () => {
    const ink = {
      points: [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
      ],
      width: 2,
    };
    const geometry = { x: 30, y: 50, width: 80, height: 20, rotation: 90 };
    expect(hitInk(ink, geometry, { x: 70, y: 66 }, 2)).toBe(true);
    expect(hitInk(ink, geometry, { x: 75, y: 66 }, 0.5)).toBe(true);
    expect(hitInk(ink, geometry, { x: 75, y: 66 }, 2)).toBe(false);
    expect(hitInk(ink, geometry, { x: 70, y: 104 }, 2)).toBe(false);
    const bounds = inkBounds(ink, geometry);
    expect(bounds.x).toBeLessThan(70);
    expect(bounds.y).toBeLessThan(20);
    expect(bounds.y + bounds.height).toBeGreaterThan(100);
    expect(renderedInkWidth(ink, 0.1) * 0.1).toBeCloseTo(0.7);
  });
});
