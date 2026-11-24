import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FilePickerTrigger, type FilePickerTriggerOptions } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

function findTrigger(host: HTMLElement): HTMLButtonElement {
  const trigger = host.querySelector('button');
  if (!trigger) {
    throw new Error('Expected a native file picker trigger.');
  }

  return trigger;
}

describe('FilePickerTrigger', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
  });

  afterEach(() => fixture.dispose());

  it('hands off the selection options synchronously for every native activation', () => {
    const onRequestPick = vi.fn<(options: FilePickerTriggerOptions) => void>();
    const onSubmit = vi.fn();
    fixture.render(
      <form onSubmit={onSubmit}>
        <FilePickerTrigger
          label="选择文件"
          accept=".json,image/*"
          multiple
          onRequestPick={onRequestPick}
        />
      </form>,
    );

    const trigger = findTrigger(fixture.host);
    expect(trigger.textContent).toBe('选择文件');
    expect(trigger.type).toBe('button');

    act(() => {
      trigger.click();
      expect(onRequestPick).toHaveBeenCalledExactlyOnceWith({
        accept: '.json,image/*',
        multiple: true,
      });
      trigger.click();
    });

    expect(onRequestPick).toHaveBeenCalledTimes(2);
    expect(fixture.host.querySelector('input[type="file"]')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('defaults to a single-file intent', () => {
    const onRequestPick = vi.fn();
    fixture.render(<FilePickerTrigger label="选择文件" onRequestPick={onRequestPick} />);

    act(() => findTrigger(fixture.host).click());

    expect(onRequestPick).toHaveBeenCalledExactlyOnceWith({ multiple: false });
  });

  it('keeps focus while busy and suppresses requests while busy or disabled', () => {
    const onRequestPick = vi.fn();
    fixture.render(<FilePickerTrigger label="选择文件" onRequestPick={onRequestPick} />);
    const trigger = findTrigger(fixture.host);
    trigger.focus();

    fixture.render(<FilePickerTrigger label="选择文件" busy onRequestPick={onRequestPick} />);
    act(() => trigger.click());

    expect(trigger.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(trigger);
    expect(onRequestPick).not.toHaveBeenCalled();

    fixture.render(<FilePickerTrigger label="选择文件" disabled onRequestPick={onRequestPick} />);
    act(() => trigger.click());

    expect(trigger.disabled).toBe(true);
    expect(onRequestPick).not.toHaveBeenCalled();
  });
});
