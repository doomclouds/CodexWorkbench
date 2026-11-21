import { expect, it } from 'vitest';
import { DEFAULT_REGION_FILL, documentSurface } from '../src/core/products/document-surface.js';
import { contrastRatio, DARK_THEME, LIGHT_THEME } from '../src/core/theme.js';

it('uses the same document paper and readable default ink in either surrounding theme without changing the element', () => {
  const element = {};
  const light = documentSurface(element, LIGHT_THEME);
  const dark = documentSurface(element, DARK_THEME);
  expect(light.paper).toBe(DEFAULT_REGION_FILL);
  const { backdrop: lightBackdrop, ...lightPaper } = light;
  const { backdrop: darkBackdrop, ...darkPaper } = dark;
  expect(darkPaper).toEqual(lightPaper);
  expect(lightBackdrop).toBe('#F5F5F5');
  expect(darkBackdrop).toBe('#2D3142');
  expect(contrastRatio(light.ink, light.paper)).toBeGreaterThanOrEqual(4.5);
  expect(element).toEqual({});
});
it('preserves custom paper and explicit ink while selecting the editor scheme from the paper', () => {
  expect(documentSurface({ fill: '#182232', color: '#E0B070' })).toMatchObject({
    paper: '#182232',
    ink: '#E0B070',
    scheme: 'dark',
  });
  expect(documentSurface({ fill: '#182232', color: 'ink' })).toMatchObject({
    paper: '#182232',
    ink: '#f5f5f5',
    scheme: 'dark',
  });
  expect(documentSurface({ fill: '#FFEFA0' }, DARK_THEME)).toMatchObject({
    paper: '#FFEFA0',
    ink: '#111111',
    scheme: 'light',
  });
  expect(documentSurface({ fill: 'paper', color: 'accent' }, DARK_THEME)).toMatchObject({
    paper: '#2D3142',
    ink: '#F08A59',
    scheme: 'dark',
  });
});
it('returns only valid colors even when an imported paint or style token contains CSS or HTML', () => {
  const surface = documentSurface(
    { fill: 'bad', color: 'accent' },
    { ...LIGHT_THEME, bad: 'red;}</style><script>x</script>', accent: 'url(javascript:x)' },
  );
  expect(surface.paper).toBe(DEFAULT_REGION_FILL);
  expect(surface.ink).toBe('#111111');
  expect(documentSurface({ fill: 'rgba(.,.,.,.)' }).paper).toBe(DEFAULT_REGION_FILL);
  for (const value of [
    surface.paper,
    surface.ink,
    surface.muted,
    surface.rule,
    surface.code,
    surface.link,
  ]) {
    expect(() => contrastRatio(value, surface.paper)).not.toThrow();
  }
});

it('retains transparent paper with a shared opaque backdrop and readable ink without changing the source', () => {
  const element = { fill: 'none', color: 'ink' };
  const style = { ...LIGHT_THEME, paper: '#101010' };
  expect(documentSurface(element, style)).toMatchObject({
    backdrop: '#101010',
    paper: 'rgba(0,0,0,0)',
    ink: '#f5f5f5',
    scheme: 'dark',
  });
  expect(documentSurface({ fill: 'rgba(255,255,255,0.5)', color: 'ink' }, style)).toMatchObject({
    backdrop: '#101010',
    paper: 'rgba(255,255,255,0.5)',
    ink: '#111111',
    scheme: 'light',
  });
  expect(documentSurface(element, { ...style, paper: 'rgba(0,0,0,0.5)' }).backdrop).toBe('#787878');
  expect(element).toEqual({ fill: 'none', color: 'ink' });
  expect(style.paper).toBe('#101010');
});
