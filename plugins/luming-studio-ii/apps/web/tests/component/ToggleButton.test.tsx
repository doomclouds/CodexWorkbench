import { act, type SubmitEvent } from 'react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { ToggleButton, type ToggleButtonProps } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

let fixture: ReturnType<typeof createControlFixture>;

beforeEach(() => {
  fixture = createControlFixture();
});

afterEach(() => fixture.dispose());

function getButton(): HTMLButtonElement {
  const button = fixture.host.querySelector('button');
  if (!button) {
    throw new Error('Expected a mounted toggle button.');
  }

  return button;
}

describe('ToggleButton', () => {
  it('reports the intended toggle and leaves the pressed state controlled', () => {
    const onPressedChange = vi.fn();
    fixture.render(<ToggleButton label="网格" pressed={false} onPressedChange={onPressedChange} />);
    const button = getButton();

    act(() => button.click());

    expect(button.textContent).toBe('网格');
    expect(onPressedChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(button.getAttribute('aria-pressed')).toBe('false');

    fixture.render(<ToggleButton label="网格" pressed onPressedChange={onPressedChange} />);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    act(() => button.click());
    expect(onPressedChange).toHaveBeenNthCalledWith(2, false);
    expect(onPressedChange).toHaveBeenCalledTimes(2);
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('uses a regular native button inside a form', () => {
    const onPressedChange = vi.fn();
    const onSubmit = vi.fn((event: SubmitEvent<HTMLFormElement>) => event.preventDefault());

    fixture.render(
      <form onSubmit={onSubmit}>
        <ToggleButton label="网格" pressed={false} onPressedChange={onPressedChange} />
      </form>,
    );
    const button = getButton();
    act(() => button.click());

    expect(button.type).toBe('button');
    expect(onPressedChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('preserves native disabled behavior', () => {
    const onPressedChange = vi.fn();
    fixture.render(
      <ToggleButton label="网格" pressed disabled onPressedChange={onPressedChange} />,
    );

    const button = getButton();
    act(() => button.click());

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(onPressedChange).not.toHaveBeenCalled();
  });

  it('exposes only the public toggle contract', () => {
    expectTypeOf<ToggleButtonProps>().toEqualTypeOf<{
      label: string;
      pressed: boolean;
      disabled?: boolean;
      onPressedChange: (next: boolean) => void;
    }>();
  });
});
