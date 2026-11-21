import { describe, expect, it } from 'vitest';
import {
  canReadCanvasText,
  canvasGridSpacing,
  mediaControlsFit,
  overviewStrokeWidth,
  projectedSize,
  sectionTitleDetails,
  tableDetail,
} from '../src/app/canvas/canvas-presentation.js';
import type { BoardElement } from '../src/contracts/studio.js';

describe('canvas presentation', () => {
  it('chooses table detail from full projected space and font at the same zoom', () => {
    expect(tableDetail(projectedSize({ w: 480, h: 180 }, 0.28), 17, 0.28)).toBe('preview');
    expect(tableDetail(projectedSize({ w: 260, h: 100 }, 0.28), 17, 0.28)).toBe('outline');
    expect(tableDetail(projectedSize({ w: 480, h: 180 }, 0.63), 17, 0.63)).toBe('full');
    expect(tableDetail(projectedSize({ w: 480, h: 180 }, 0.1), 17, 0.1)).toBe('outline');
  });

  it('keeps labels at reading magnification and adapts line and grid detail in overview', () => {
    expect(canReadCanvasText(projectedSize({ w: 200, h: 54 }, 0.63), 13, 0.63)).toBe(true);
    expect(canReadCanvasText(projectedSize({ w: 200, h: 54 }, 0.28), 13, 0.28)).toBe(false);
    expect(overviewStrokeWidth(1.25, 0.1) * 0.1).toBeCloseTo(0.7);
    expect(overviewStrokeWidth(1.25, 0.63)).toBe(1.25);
    expect(canvasGridSpacing(0.1)).toBeCloseTo(9.6);
    expect(canvasGridSpacing(0.28)).toBeCloseTo(13.44);
    expect(canvasGridSpacing(1)).toBe(24);
  });

  it('allocates playback controls only to large enough projected areas', () => {
    expect(mediaControlsFit(projectedSize({ w: 360, h: 240 }, 0.28))).toBe(false);
    expect(mediaControlsFit(projectedSize({ w: 360, h: 240 }, 0.63))).toBe(true);
  });

  it('reserves compact section captions within projected width and clear space', () => {
    const section = (id: string, overrides: Partial<BoardElement> = {}): BoardElement => ({
      id,
      type: 'container',
      x: 0,
      y: 400,
      w: 600,
      h: 200,
      text: '架构',
      version: 1,
      ...overrides,
    });
    const first = section('first');
    const beside = section('beside', { x: 600 });
    const below = section('below', { y: 630 });
    const tooNarrow = section('narrow', { x: 1200, w: 40 });
    const html = section('html', { type: 'html', x: 1800, y: 0, h: 390 });
    const underHtml = section('under-html', { x: 1800 });
    const sameTopHtml = section('same-top-html', { type: 'html', x: 2500 });
    const nearHtml = section('near-html', { x: 2400 });
    const shortcuts = [first, beside, below, tooNarrow, html, underHtml];
    for (const zoom of [0.1, 0.25, 0.5]) {
      const titles = sectionTitleDetails(shortcuts, zoom);
      expect(titles.get('first')).toEqual({ mode: 'overview', width: 600 });
      expect(titles.get('beside')).toEqual({ mode: 'overview', width: 600 });
      expect(titles.has('below')).toBe(false);
      expect(titles.has('narrow')).toBe(false);
      expect(titles.has('under-html')).toBe(false);
    }

    expect(sectionTitleDetails([nearHtml, sameTopHtml], 0.5).get('near-html')).toEqual({
      mode: 'overview',
      width: 92,
    });
    expect(sectionTitleDetails(shortcuts, 2).get('below')).toEqual({ mode: 'full' });
    const parent = section('parent', { x: -100, y: 180, w: 800, h: 700 });
    expect(sectionTitleDetails([parent, first], 0.1).get('first')).toEqual({
      mode: 'overview',
      width: 600,
    });
  });

  it('preserves a low-zoom caption when a raised neighbor snaps flush to its left edge', () => {
    const left: BoardElement = {
      id: 'left',
      type: 'container',
      x: 130,
      y: 146.5,
      w: 820,
      h: 445,
      text: '作品与历史',
      fontSize: 17,
      version: 1,
    };
    const middle: BoardElement = {
      ...left,
      id: 'middle',
      x: 950,
      y: 170,
      text: '界面呈现和交互规则的长期维护与复核清单说明',
    };

    for (const zoom of [0.25, 0.5]) {
      expect(sectionTitleDetails([left, middle], zoom).get(middle.id)).toEqual({
        mode: 'overview',
        width: 820,
      });
      expect(sectionTitleDetails([{ ...left, x: 131 }, middle], zoom).has(middle.id)).toBe(false);
    }
  });
});
