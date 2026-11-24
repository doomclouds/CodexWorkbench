import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Select, type SelectOption } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

const options: readonly SelectOption[] = [
  { id: 'drawing', label: '白板' },
  { id: 'archive', label: '归档' },
  { id: 'reserved', label: '保留', disabled: true },
];

function findSelect(host: HTMLElement): HTMLSelectElement {
  const select = host.querySelector('select');
  if (!select) {
    throw new Error('Select element is missing.');
  }

  return select;
}

function selectOption(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Select', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
  });

  afterEach(() => fixture.dispose());

  it('associates its native select with the label and emits only the chosen ID', () => {
    const onValueChange = vi.fn();
    fixture.render(
      <Select label="项目类型" value="drawing" options={options} onValueChange={onValueChange} />,
    );

    const select = findSelect(fixture.host);
    const label = fixture.host.querySelector('label');
    expect(label?.control).toBe(select);
    expect(label?.textContent).toBe('项目类型');
    expect(select.value).toBe('drawing');
    expect([...select.options].map((option) => option.label)).toEqual(['白板', '归档', '保留']);

    act(() => selectOption(select, 'archive'));
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('archive');
    expect(select.value).toBe('drawing');

    fixture.render(
      <Select label="项目类型" value="archive" options={options} onValueChange={onValueChange} />,
    );
    expect(select.value).toBe('archive');
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it('keeps disabled options unavailable and ignores their change events', () => {
    const onValueChange = vi.fn();
    fixture.render(
      <Select label="项目类型" value="drawing" options={options} onValueChange={onValueChange} />,
    );

    const select = findSelect(fixture.host);
    expect(select.querySelector<HTMLOptionElement>('option[value="reserved"]')?.disabled).toBe(
      true,
    );

    act(() => selectOption(select, 'reserved'));
    expect(onValueChange).not.toHaveBeenCalled();
    expect(select.value).toBe('drawing');
  });

  it('preserves a controlled selection while its option is unavailable', () => {
    const onValueChange = vi.fn();
    fixture.render(
      <Select label="项目类型" value="removed" options={options} onValueChange={onValueChange} />,
    );

    const select = findSelect(fixture.host);
    expect(select.value).toBe('removed');
    expect(onValueChange).not.toHaveBeenCalled();

    act(() => selectOption(select, 'archive'));
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('archive');
  });

  it('uses the native disabled state and suppresses changes when disabled', () => {
    const onValueChange = vi.fn();
    fixture.render(
      <Select
        label="项目类型"
        value="drawing"
        options={options}
        disabled
        onValueChange={onValueChange}
      />,
    );

    const select = findSelect(fixture.host);
    expect(select.disabled).toBe(true);

    act(() => selectOption(select, 'archive'));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
