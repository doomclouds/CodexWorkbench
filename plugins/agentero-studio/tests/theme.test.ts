import { describe, expect, test } from 'vitest';
import { contrastRatio, DARK_THEME, LIGHT_THEME, parseColor, readableText, withTheme } from '../src/core/theme';

describe('Diagram semantic themes', () => {
  for (const [name, theme] of [['light', LIGHT_THEME], ['dark', DARK_THEME]] as const) {
    test(`${name} body and secondary text remain readable on both surfaces`, () => {
      for (const surface of [theme.paper, theme['paper-2']]) {
        expect(contrastRatio(theme.ink, surface)).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(theme.muted, surface)).toBeGreaterThanOrEqual(4.5);
      }
    });
    test(`${name} explicit note fills select readable labels`, () => {
      for (const fill of ['#f6e39c', '#f4c3a4', '#edbdd5', '#bcd6be', '#b8d2ed', '#d0c0e5', theme.accent, theme.paper]) expect(contrastRatio(readableText(fill, theme.paper), fill, theme.paper)).toBeGreaterThanOrEqual(4.5);
    });
  }
  test('composites translucent fill against the actual surface', () => {
    expect(readableText('rgba(240,138,89,.10)', DARK_THEME.paper)).toBe('#f5f5f5');
    expect(readableText('rgba(235,108,54,.08)', LIGHT_THEME.paper)).toBe('#111111');
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21);
    expect(parseColor('#1234')).toEqual([17, 34, 51, 68 / 255]);
  });
  test('theme selection preserves explicit user overrides and leaves presets immutable', () => {
    const style = withTheme('dark', { accent: '#ffcc00', name: '项目配色' });
    expect(style.paper).toBe('#2d3142'); expect(style.accent).toBe('#ffcc00'); expect(style.name).toBe('项目配色'); expect(DARK_THEME.accent).toBe('#f08a59');
  });
});
