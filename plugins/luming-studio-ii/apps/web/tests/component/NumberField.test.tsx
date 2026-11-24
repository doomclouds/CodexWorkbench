import { act, createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NumberField, type NumberFieldHandle } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

function findInput(host: HTMLElement): HTMLInputElement {
  const input = host.querySelector('input');
  if (!input) {
    throw new Error('NumberField input is missing.');
  }

  return input;
}

function editDraft(input: HTMLInputElement, value: string) {
  const property = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (property?.set === undefined) {
    throw new Error('Native input value setter is missing.');
  }

  act(() => {
    property.set?.call(input, value);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
  });
}

function pressKey(input: HTMLInputElement, key: string, isComposing = false) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    isComposing,
  });

  act(() => {
    input.dispatchEvent(event);
  });

  return event.defaultPrevented;
}

describe('NumberField', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
  });

  afterEach(() => {
    fixture.dispose();
  });

  it('reports raw drafts and uses Field associations for error and unit text', () => {
    const onValueChange = vi.fn();
    fixture.render(
      <NumberField
        label="宽度"
        value="8"
        unit="毫米"
        description="填写实际宽度"
        error="请检查宽度"
        required
        min={1}
        max={10}
        step={0.5}
        onValueChange={onValueChange}
      />,
    );

    const input = findInput(fixture.host);
    const describedBy = input.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(fixture.host.querySelector('label')?.control).toBe(input);
    expect(input.type).toBe('text');
    expect(input.inputMode).toBe('decimal');
    expect(input.required).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy.map((id) => document.getElementById(id)?.textContent)).toEqual([
      '填写实际宽度',
      '请检查宽度',
      '毫米',
    ]);

    editDraft(input, '');
    editDraft(input, '-');
    editDraft(input, '2.');
    editDraft(input, '100.25');

    expect(onValueChange.mock.calls).toEqual([[''], ['-'], ['2.'], ['100.25']]);
  });

  it('steps intentionally, rounds decimal arithmetic and clamps to the configured range', () => {
    const onValueChange = vi.fn();
    const props = { label: '宽度', min: 0.15, max: 0.45, step: 0.2, onValueChange };
    fixture.render(<NumberField {...props} value="0.1" />);

    const input = findInput(fixture.host);
    expect(pressKey(input, 'ArrowUp')).toBe(true);
    expect(onValueChange).toHaveBeenLastCalledWith('0.3');

    fixture.render(<NumberField {...props} value="0.3" />);
    expect(pressKey(input, 'ArrowUp')).toBe(true);
    expect(onValueChange).toHaveBeenLastCalledWith('0.45');

    fixture.render(<NumberField {...props} value="0.45" />);
    expect(pressKey(input, 'ArrowUp')).toBe(false);
    expect(onValueChange).toHaveBeenCalledTimes(2);

    fixture.render(<NumberField {...props} value="0.2" />);
    expect(pressKey(input, 'ArrowDown')).toBe(true);
    expect(onValueChange).toHaveBeenLastCalledWith('0.15');
  });

  it.each(['', '-', '12.', '0x12'])(
    'keeps an incomplete or invalid draft %j untouched',
    (draft) => {
      const onValueChange = vi.fn();
      fixture.render(<NumberField label="宽度" value={draft} onValueChange={onValueChange} />);

      expect(pressKey(findInput(fixture.host), 'ArrowUp')).toBe(false);
      expect(onValueChange).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('ignores invalid step %s', (step) => {
    const onValueChange = vi.fn();
    fixture.render(
      <NumberField label="宽度" value="8" step={step} onValueChange={onValueChange} />,
    );

    expect(pressKey(findInput(fixture.host), 'ArrowDown')).toBe(false);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('leaves IME, disabled, and read-only arrow keys to the browser', () => {
    const onValueChange = vi.fn();
    const props = { label: '宽度', value: '8', onValueChange };
    fixture.render(<NumberField {...props} />);
    expect(pressKey(findInput(fixture.host), 'ArrowUp', true)).toBe(false);

    fixture.render(<NumberField {...props} disabled />);
    expect(pressKey(findInput(fixture.host), 'ArrowUp')).toBe(false);

    fixture.render(<NumberField {...props} readOnly />);
    expect(pressKey(findInput(fixture.host), 'ArrowDown')).toBe(false);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('focuses and selects the native text through the explicit handle', () => {
    const ref = createRef<NumberFieldHandle>();
    fixture.render(<NumberField label="宽度" value="12.5" ref={ref} onValueChange={vi.fn()} />);
    const input = findInput(fixture.host);

    expect(Object.keys(ref.current ?? {}).sort()).toEqual(['focus', 'select']);
    ref.current?.focus();
    ref.current?.select();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
  });
});
