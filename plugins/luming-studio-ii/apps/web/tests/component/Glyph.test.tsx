import { afterEach, beforeEach, expect, expectTypeOf, it } from 'vitest';

import { Glyph } from '../../src/ui/base/index.js';
import type { GlyphProps } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

let fixture: ReturnType<typeof createControlFixture>;

beforeEach(() => {
  fixture = createControlFixture();
});

afterEach(() => fixture.dispose());

it('presents a caller glyph as decoration inside an independently named control', () => {
  expectTypeOf<GlyphProps>().not.toHaveProperty('ref');
  fixture.render(
    <button aria-label="Close panel">
      <Glyph>
        <span>×</span>
      </Glyph>
    </button>,
  );

  const button = fixture.host.querySelector('button');
  expect(button?.getAttribute('aria-label')).toBe('Close panel');
  expect(button?.querySelector('[aria-hidden="true"]')?.textContent).toBe('×');
});

it('uses the supplied size and foreground color', () => {
  fixture.render(
    <Glyph size={24} color="rebeccapurple">
      <span>×</span>
    </Glyph>,
  );

  const glyph = fixture.host.querySelector<HTMLElement>('[aria-hidden="true"]');
  expect(glyph?.style.inlineSize).toBe('24px');
  expect(glyph?.style.blockSize).toBe('24px');
  expect(glyph?.style.color).toBe('rebeccapurple');
});
