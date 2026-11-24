import { afterEach, beforeEach, expect, it } from 'vitest';

import { StatusText } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

let fixture: ReturnType<typeof createControlFixture>;

beforeEach(() => {
  fixture = createControlFixture();
});

afterEach(() => {
  fixture.dispose();
});

it('keeps the announcement disabled by default independently of the tone', () => {
  fixture.render(<StatusText message="Disconnected" tone="error" />);

  const status = fixture.host.querySelector('[data-tone="error"]');
  expect(status?.textContent).toBe('Disconnected');
  expect(status?.getAttribute('aria-live')).toBe('off');
  expect(status?.getAttribute('role')).toBeNull();
});

it('exposes polite and assertive status while keeping the busy indicator decorative', () => {
  fixture.render(<StatusText message="Saving" busy announcement="polite" />);

  const pending = fixture.host.querySelector('[role="status"]');
  expect(pending?.textContent).toBe('Saving');
  expect(pending?.getAttribute('aria-busy')).toBe('true');
  expect(pending?.querySelector('[aria-hidden="true"]')).not.toBeNull();

  fixture.render(<StatusText message="Save failed" tone="error" announcement="assertive" />);

  const failed = fixture.host.querySelector('[role="alert"]');
  expect(failed?.textContent).toBe('Save failed');
  expect(failed?.hasAttribute('aria-busy')).toBe(false);
  expect(failed?.querySelector('.studio-ui-status-text__busy')).toBeNull();
});
