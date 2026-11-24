import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Checkbox } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

function findInput(host: HTMLElement): HTMLInputElement {
  const input = host.querySelector('input');
  if (!input) {
    throw new Error('Checkbox input is missing.');
  }

  return input;
}

describe('Checkbox', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
  });

  afterEach(() => fixture.dispose());

  it('uses a native checkbox with its label and reports one controlled change', () => {
    const onCheckedChange = vi.fn();
    fixture.render(<Checkbox label="添加批注" checked={false} onCheckedChange={onCheckedChange} />);

    const input = findInput(fixture.host);
    const label = fixture.host.querySelector('label');
    expect(input.type).toBe('checkbox');
    expect(label?.control).toBe(input);
    expect(label?.textContent).toBe('添加批注');
    expect(input.checked).toBe(false);

    act(() => label?.click());
    expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(input.checked).toBe(false);

    fixture.render(<Checkbox label="添加批注" checked onCheckedChange={onCheckedChange} />);
    expect(input.checked).toBe(true);
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
  });

  it('keeps the real indeterminate property controlled across activation and rendering', () => {
    const onCheckedChange = vi.fn();
    fixture.render(
      <Checkbox label="全选" checked={false} indeterminate onCheckedChange={onCheckedChange} />,
    );

    const input = findInput(fixture.host);
    expect(input.indeterminate).toBe(true);
    expect(input.checked).toBe(false);

    act(() => input.click());
    expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(input.indeterminate).toBe(true);
    expect(input.checked).toBe(false);

    fixture.render(<Checkbox label="全选" checked onCheckedChange={onCheckedChange} />);
    expect(input.indeterminate).toBe(false);
    expect(input.checked).toBe(true);
  });

  it('blocks activation when disabled', () => {
    const onCheckedChange = vi.fn();
    fixture.render(
      <Checkbox label="允许修改" checked={false} disabled onCheckedChange={onCheckedChange} />,
    );

    const input = findInput(fixture.host);
    expect(input.disabled).toBe(true);

    act(() => input.click());
    expect(input.checked).toBe(false);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
