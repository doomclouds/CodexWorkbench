import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Range } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

const initial = { label: '音量', value: 40, min: 0, max: 100 };

function findRange(host: HTMLElement): HTMLInputElement {
  const input = host.querySelector('input');
  if (!input) {
    throw new Error('Expected the native range input.');
  }

  return input;
}

function changeValue(input: HTMLInputElement, next: number, event = 'input') {
  input.valueAsNumber = next;
  input.dispatchEvent(new Event(event, { bubbles: true }));
}

function pointer(input: HTMLInputElement, type: string) {
  input.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7 }));
}

function key(input: HTMLInputElement, type: string, repeat = false) {
  input.dispatchEvent(new KeyboardEvent(type, { bubbles: true, key: 'ArrowRight', repeat }));
}

describe('Range', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
  });

  afterEach(() => fixture.dispose());

  it('exposes native slider semantics and the controlled value with its unit', () => {
    fixture.render(<Range {...initial} step={5} unit="%" onValueChange={vi.fn()} />);

    const input = findRange(fixture.host);
    expect(input.type).toBe('range');
    expect(input.min).toBe('0');
    expect(input.max).toBe('100');
    expect(input.step).toBe('5');
    expect(input.valueAsNumber).toBe(40);
    expect(input.getAttribute('aria-valuetext')).toBe('40 %');
    expect(fixture.host.querySelector('label')?.control).toBe(input);

    fixture.render(<Range {...initial} value={70} step={5} unit="%" onValueChange={vi.fn()} />);

    expect(input.valueAsNumber).toBe(70);
    expect(input.getAttribute('aria-valuetext')).toBe('70 %');
  });

  it('previews pointer changes and commits once on release around native change', () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    fixture.render(
      <Range {...initial} onValueChange={onValueChange} onValueCommit={onValueCommit} />,
    );

    const input = findRange(fixture.host);
    act(() => {
      pointer(input, 'pointerdown');
      changeValue(input, 45);
      changeValue(input, 60);
      changeValue(input, 60, 'change');
    });

    expect(onValueChange.mock.calls).toEqual([[45], [60]]);
    expect(onValueCommit).not.toHaveBeenCalled();

    act(() => {
      pointer(input, 'pointerup');
      changeValue(input, 60, 'change');
      pointer(input, 'lostpointercapture');
    });

    expect(onValueCommit).toHaveBeenCalledExactlyOnceWith(60);
    expect(onValueChange).toHaveBeenCalledTimes(2);
  });

  it('commits a held adjustment key once after its final preview', () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    fixture.render(
      <Range {...initial} onValueChange={onValueChange} onValueCommit={onValueCommit} />,
    );

    const input = findRange(fixture.host);
    act(() => {
      key(input, 'keydown');
      changeValue(input, 41);
      changeValue(input, 41, 'change');
      key(input, 'keydown', true);
      changeValue(input, 42);
      changeValue(input, 42, 'change');
    });

    expect(onValueChange.mock.calls).toEqual([[41], [42]]);
    expect(onValueCommit).not.toHaveBeenCalled();

    act(() => {
      key(input, 'keyup');
      changeValue(input, 42, 'change');
    });

    expect(onValueCommit).toHaveBeenCalledExactlyOnceWith(42);
  });

  it('accepts an independent change and avoids repeating the associated preview', () => {
    const effects: [string, number][] = [];
    fixture.render(
      <Range
        {...initial}
        onValueChange={(next) => effects.push(['preview', next])}
        onValueCommit={(next) => effects.push(['commit', next])}
      />,
    );

    const input = findRange(fixture.host);
    act(() => {
      changeValue(input, 50, 'change');
      changeValue(input, 60);
      changeValue(input, 60, 'change');
    });

    expect(effects).toEqual([
      ['preview', 50],
      ['commit', 50],
      ['preview', 60],
      ['commit', 60],
    ]);
  });

  it('cancels a pending preview and lets a fresh adjustment commit', () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    const onValueCancel = vi.fn();
    fixture.render(
      <Range
        {...initial}
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
        onValueCancel={onValueCancel}
      />,
    );

    const input = findRange(fixture.host);
    act(() => {
      pointer(input, 'pointerdown');
      changeValue(input, 55);
      pointer(input, 'pointercancel');
      pointer(input, 'lostpointercapture');
      changeValue(input, 55, 'change');
    });

    expect(onValueChange).toHaveBeenCalledExactlyOnceWith(55);
    expect(onValueCommit).not.toHaveBeenCalled();
    expect(onValueCancel).toHaveBeenCalledTimes(1);

    act(() => {
      pointer(input, 'pointerdown');
      changeValue(input, 47);
      pointer(input, 'pointerup');
      changeValue(input, 47, 'change');
    });

    expect(onValueCommit).toHaveBeenCalledExactlyOnceWith(47);
  });

  it('keeps the native disabled state and suppresses preview and commit', () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    fixture.render(
      <Range {...initial} disabled onValueChange={onValueChange} onValueCommit={onValueCommit} />,
    );

    const input = findRange(fixture.host);
    act(() => {
      changeValue(input, 50);
      changeValue(input, 50, 'change');
    });

    expect(input.disabled).toBe(true);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onValueCommit).not.toHaveBeenCalled();
  });
});
