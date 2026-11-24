import { afterEach, beforeEach, expect, expectTypeOf, it } from 'vitest';

import { AvatarGlyph } from '../../src/ui/base/index.js';
import type { AvatarGlyphProps } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

let fixture: ReturnType<typeof createControlFixture>;

beforeEach(() => {
  fixture = createControlFixture();
});

afterEach(() => fixture.dispose());

it('presents the named fallback as an image and applies the caller size and color', () => {
  expectTypeOf<AvatarGlyphProps>().not.toHaveProperty('ref');
  fixture.render(<AvatarGlyph label="Chen Rui" fallback="CR" size={40} color="lightblue" />);

  const avatar = fixture.host.querySelector<HTMLElement>('[role="img"]');
  expect(avatar?.getAttribute('aria-label')).toBe('Chen Rui');
  expect(avatar?.getAttribute('aria-hidden')).toBeNull();
  expect(avatar?.textContent).toBe('CR');
  expect(avatar?.style.inlineSize).toBe('40px');
  expect(avatar?.style.blockSize).toBe('40px');
  expect(avatar?.style.backgroundColor).toBe('lightblue');
});

it('renders caller-provided face and badge slots', () => {
  fixture.render(
    <AvatarGlyph label="Chen Rui, online" fallback="CR" badge={<span>Online</span>}>
      <img alt="Caller portrait" />
    </AvatarGlyph>,
  );

  const avatar = fixture.host.querySelector('[role="img"]');
  expect(avatar?.getAttribute('aria-label')).toBe('Chen Rui, online');
  expect(avatar?.querySelector('img')?.closest('[aria-hidden="true"]')).not.toBeNull();
  expect(avatar?.textContent).toBe('Online');
});

it('renders an empty face slot as fallback and hides unlabelled avatars from accessibility', () => {
  fixture.render(
    <AvatarGlyph label=" " fallback="CR" badge={0}>
      {false}
    </AvatarGlyph>,
  );

  expect(fixture.host.querySelector('[role="img"]')).toBeNull();

  const avatar = fixture.host.querySelector('[aria-hidden="true"]');
  expect(avatar?.textContent).toBe('CR0');
});
