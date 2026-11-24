import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { OperationNotice } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

let fixture: ReturnType<typeof createControlFixture>;

beforeEach(() => {
  fixture = createControlFixture();
});

afterEach(() => {
  fixture.dispose();
});

it('announces the message and dispatches the independent action and dismissal callbacks', () => {
  const retry = vi.fn();
  const unavailable = vi.fn();
  const dismiss = vi.fn();
  fixture.render(
    <OperationNotice
      id="save-1"
      level="error"
      message="Save failed"
      actions={[
        { id: 'retry', label: 'Retry', onActivate: retry },
        { id: 'export', label: 'Export', onActivate: unavailable, disabled: true },
      ]}
      dismissible
      dismissLabel="Dismiss notice"
      onDismiss={dismiss}
    />,
  );

  const notice = document.getElementById('save-1');
  const message = notice?.querySelector('[role="alert"]');
  expect(message?.textContent).toBe('Save failed');
  expect(message?.querySelector('button')).toBeNull();

  const [retryButton, unavailableButton, dismissButton] = fixture.host.querySelectorAll('button');
  expect(
    Array.from(fixture.host.querySelectorAll('button'), (button) => button.textContent),
  ).toEqual(['Retry', 'Export', 'Dismiss notice']);
  expect(unavailableButton?.disabled).toBe(true);

  act(() => {
    retryButton?.click();
    unavailableButton?.click();
    dismissButton?.click();
  });
  expect(retry).toHaveBeenCalledTimes(1);
  expect(unavailable).not.toHaveBeenCalled();
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(document.getElementById('save-1')).toBe(notice);

  fixture.render(<OperationNotice id="save-2" level="info" message="Save failed" />);
  expect(document.getElementById('save-2')?.querySelector('[role="status"]')?.textContent).toBe(
    'Save failed',
  );
  expect(document.getElementById('save-1')).toBeNull();
});

it('offers a dismissal action only when both requested and handled', () => {
  const dismiss = vi.fn();
  fixture.render(<OperationNotice id="task" level="warning" message="Unavailable" dismissible />);
  expect(fixture.host.querySelector('button')).toBeNull();

  fixture.render(
    <OperationNotice id="task" level="warning" message="Unavailable" onDismiss={dismiss} />,
  );
  expect(fixture.host.querySelector('button')).toBeNull();

  fixture.render(
    <OperationNotice
      id="task"
      level="warning"
      message="Unavailable"
      dismissible
      onDismiss={dismiss}
    />,
  );
  expect(fixture.host.querySelector('button')?.textContent).toBe('关闭通知');
});
