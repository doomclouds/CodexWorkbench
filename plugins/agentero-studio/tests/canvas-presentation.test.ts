import { describe, expect, it } from 'vitest';
import { canReadCanvasText, canvasGridSpacing, mediaControlsFit, overviewStrokeWidth, projectedSize, tableDetail } from '../src/app/canvas/canvas-presentation.js';

describe('canvas presentation', () => {
  it('chooses table detail from full projected space and font at the same zoom', () => {
    expect(tableDetail(projectedSize({ w: 480, h: 180 }, .28), 17, .28)).toBe('preview');
    expect(tableDetail(projectedSize({ w: 260, h: 100 }, .28), 17, .28)).toBe('outline');
    expect(tableDetail(projectedSize({ w: 480, h: 180 }, .63), 17, .63)).toBe('full');
    expect(tableDetail(projectedSize({ w: 480, h: 180 }, .1), 17, .1)).toBe('outline');
  });

  it('keeps labels at reading magnification and adapts line and grid detail in overview', () => {
    expect(canReadCanvasText(projectedSize({ w: 200, h: 54 }, .63), 13, .63)).toBe(true);
    expect(canReadCanvasText(projectedSize({ w: 200, h: 54 }, .28), 13, .28)).toBe(false);
    expect(overviewStrokeWidth(1.25, .1) * .1).toBeCloseTo(.7);
    expect(overviewStrokeWidth(1.25, .63)).toBe(1.25);
    expect(canvasGridSpacing(.1)).toBeCloseTo(9.6);
    expect(canvasGridSpacing(.28)).toBeCloseTo(13.44);
    expect(canvasGridSpacing(1)).toBe(24);
  });

  it('allocates playback controls only to large enough projected areas', () => {
    expect(mediaControlsFit(projectedSize({ w: 360, h: 240 }, .28))).toBe(false);
    expect(mediaControlsFit(projectedSize({ w: 360, h: 240 }, .63))).toBe(true);
  });
});
