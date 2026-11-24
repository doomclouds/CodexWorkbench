import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { Button, StatePanel } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

let fixture: ReturnType<typeof createControlFixture>;

beforeEach(() => {
  fixture = createControlFixture();
});

afterEach(() => {
  fixture.dispose();
});

it('renders initial loading as status and ordinary empty content without a live region', () => {
  fixture.render(
    <StatePanel kind="initial-loading" title="Loading boards" detail="Fetching the board list" />,
  );

  const status = fixture.host.querySelector('[role="status"]');
  expect(status?.textContent).toContain('Loading boards');
  expect(status?.textContent).toContain('Fetching the board list');
  expect(fixture.host.querySelector('[data-kind="initial-loading"]')).not.toBeNull();

  fixture.render(<StatePanel kind="empty" title="No boards yet" />);
  expect(fixture.host.textContent).toBe('No boards yet');
  expect(fixture.host.querySelector('[role]')).toBeNull();
  expect(fixture.host.querySelector('[data-kind="empty"]')).not.toBeNull();
});

it('announces an error without including the caller supplied recovery control', () => {
  const retry = vi.fn();
  fixture.render(
    <StatePanel
      kind="error"
      title="Board list unavailable"
      detail="Try again later"
      action={<Button label="Retry" onActivate={retry} />}
    />,
  );

  const error = fixture.host.querySelector('[role="alert"]');
  expect(error?.textContent).toContain('Board list unavailable');
  expect(error?.textContent).toContain('Try again later');
  expect(error?.querySelector('button')).toBeNull();

  act(() => fixture.host.querySelector('button')?.click());
  expect(retry).toHaveBeenCalledTimes(1);
  expect(fixture.host.querySelector('[role="alert"]')).toBe(error);
});
