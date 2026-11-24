import { act } from 'react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  ChoiceGroup,
  type ChoiceGroupOption,
  type ChoiceGroupProps,
} from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

const options: readonly ChoiceGroupOption[] = [
  { id: 'grid', label: '网格' },
  { id: 'list', label: '列表' },
  { id: 'preview', label: '预览', disabled: true },
];

let fixture: ReturnType<typeof createControlFixture>;

beforeEach(() => {
  fixture = createControlFixture();
});

afterEach(() => fixture.dispose());

function getFieldset(index = 0): HTMLFieldSetElement {
  const fieldset = fixture.host.querySelectorAll('fieldset')[index];
  if (!fieldset) {
    throw new Error('Expected a mounted choice group.');
  }

  return fieldset;
}

function getRadio(fieldset: HTMLFieldSetElement, id: string): HTMLInputElement {
  const radio = Array.from(fieldset.querySelectorAll<HTMLInputElement>('input[type="radio"]')).find(
    (input) => input.value === id,
  );

  if (!radio) {
    throw new Error('Expected a mounted radio option.');
  }

  return radio;
}

describe('ChoiceGroup', () => {
  it('gives a native radio group and its options accessible labels', () => {
    fixture.render(
      <ChoiceGroup label="视图" value="grid" options={options} onValueChange={vi.fn()} />,
    );
    const group = getFieldset();
    const grid = getRadio(group, 'grid');
    const list = getRadio(group, 'list');

    expect(group.querySelector('legend')?.textContent).toBe('视图');
    expect(grid.labels?.[0]?.textContent).toBe('网格');
    expect(list.labels?.[0]?.textContent).toBe('列表');
    expect(grid.name).not.toBe('');
    expect(list.name).toBe(grid.name);
    expect(grid.checked).toBe(true);
    expect(list.checked).toBe(false);
  });

  it('emits the chosen id and uses the value supplied by its caller', () => {
    const onValueChange = vi.fn();
    fixture.render(
      <ChoiceGroup label="视图" value="grid" options={options} onValueChange={onValueChange} />,
    );
    const group = getFieldset();
    const grid = getRadio(group, 'grid');
    const list = getRadio(group, 'list');
    const originalName = grid.name;

    act(() => list.click());

    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('list');
    expect(grid.checked).toBe(true);
    expect(list.checked).toBe(false);

    fixture.render(
      <ChoiceGroup label="视图" value="list" options={options} onValueChange={onValueChange} />,
    );
    expect(grid.name).toBe(originalName);
    expect(grid.checked).toBe(false);
    expect(list.checked).toBe(true);
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it('isolates distinct radio groups in one form', () => {
    const firstChange = vi.fn();
    const secondChange = vi.fn();
    fixture.render(
      <form>
        <ChoiceGroup label="前景" value="grid" options={options} onValueChange={firstChange} />
        <ChoiceGroup label="背景" value="list" options={options} onValueChange={secondChange} />
      </form>,
    );
    const first = getFieldset();
    const second = getFieldset(1);
    const firstList = getRadio(first, 'list');
    const secondList = getRadio(second, 'list');

    expect(firstList.name).not.toBe(secondList.name);
    act(() => firstList.click());

    expect(firstChange).toHaveBeenCalledExactlyOnceWith('list');
    expect(secondChange).not.toHaveBeenCalled();
    expect(secondList.checked).toBe(true);
  });

  it('supports per-option and whole-group native disabling', () => {
    const onValueChange = vi.fn();
    fixture.render(
      <ChoiceGroup label="视图" value="grid" options={options} onValueChange={onValueChange} />,
    );
    const group = getFieldset();
    const preview = getRadio(group, 'preview');
    expect(preview.disabled).toBe(true);
    act(() => preview.click());

    fixture.render(
      <ChoiceGroup
        label="视图"
        value="grid"
        options={options}
        disabled
        onValueChange={onValueChange}
      />,
    );
    const list = getRadio(group, 'list');
    expect(group.disabled).toBe(true);
    expect(list.matches(':disabled')).toBe(true);
    act(() => list.click());
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('exposes just the public group and option contracts', () => {
    expectTypeOf<ChoiceGroupOption>().toEqualTypeOf<{
      id: string;
      label: string;
      disabled?: boolean;
    }>();
    expectTypeOf<ChoiceGroupProps>().toEqualTypeOf<{
      label: string;
      value: string;
      options: readonly ChoiceGroupOption[];
      disabled?: boolean;
      onValueChange: (id: string) => void;
    }>();
  });
});
