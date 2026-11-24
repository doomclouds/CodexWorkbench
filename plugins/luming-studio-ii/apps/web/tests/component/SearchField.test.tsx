import { act, createRef, type Ref } from 'react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  SearchField,
  type SearchFieldHandle,
  type SearchFieldProps,
} from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

function findSearchInput(host: HTMLElement): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('input[type="search"]');
  if (!input) {
    throw new Error('Expected the native search input.');
  }

  return input;
}

function findButton(host: HTMLElement): HTMLButtonElement {
  const button = host.querySelector('button');
  if (!button) {
    throw new Error('Expected a mounted button.');
  }

  return button;
}

function enterSearch(input: HTMLInputElement, value: string) {
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (!nativeValue?.set) {
    throw new Error('Native search input value setter is missing.');
  }

  nativeValue.set.call(input, value);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
}

describe('SearchField', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
  });

  afterEach(() => fixture.dispose());

  it('provides a labelled native search control and reports the next controlled value', () => {
    const onValueChange = vi.fn();
    fixture.render(
      <SearchField
        label="搜索白板"
        clearLabel="清空搜索"
        value="图层"
        onValueChange={onValueChange}
      />,
    );

    const input = findSearchInput(fixture.host);
    expect(input.value).toBe('图层');
    expect(fixture.host.querySelector('label')?.control).toBe(input);

    act(() => enterSearch(input, ' 目录 '));

    expect(onValueChange).toHaveBeenCalledExactlyOnceWith(' 目录 ');
  });

  it('requests clearing once and restores focus without submitting its form', () => {
    const onValueChange = vi.fn();
    const onSubmit = vi.fn();
    fixture.render(
      <form onSubmit={onSubmit}>
        <SearchField
          label="搜索白板"
          clearLabel="清空搜索"
          value="图层"
          onValueChange={onValueChange}
        />
      </form>,
    );

    const input = findSearchInput(fixture.host);
    const clear = findButton(fixture.host);
    expect(clear.getAttribute('aria-label')).toBe('清空搜索');
    clear.focus();

    act(() => clear.click());

    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('');
    expect(input.value).toBe('图层');
    expect(document.activeElement).toBe(input);
    expect(onSubmit).not.toHaveBeenCalled();

    fixture.render(
      <form onSubmit={onSubmit}>
        <SearchField
          label="搜索白板"
          clearLabel="清空搜索"
          value=""
          onValueChange={onValueChange}
        />
      </form>,
    );

    expect(input.value).toBe('');
    expect(fixture.host.querySelector('button')).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('honours clearable and disabled when rendering the clear action', () => {
    const onValueChange = vi.fn();
    fixture.render(
      <SearchField
        label="搜索白板"
        clearLabel="清空搜索"
        value="图层"
        clearable={false}
        onValueChange={onValueChange}
      />,
    );

    expect(fixture.host.querySelector('button')).toBeNull();

    fixture.render(
      <SearchField
        label="搜索白板"
        clearLabel="清空搜索"
        value="图层"
        disabled
        onValueChange={onValueChange}
      />,
    );

    const clear = findButton(fixture.host);
    expect(findSearchInput(fixture.host).disabled).toBe(true);
    expect(clear.disabled).toBe(true);

    act(() => clear.click());

    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('exposes only the public focus capability', () => {
    expectTypeOf<SearchFieldHandle>().toEqualTypeOf<{ focus(): void }>();
    expectTypeOf<SearchFieldProps['ref']>().toEqualTypeOf<Ref<SearchFieldHandle> | undefined>();

    const ref = createRef<SearchFieldHandle>();
    fixture.render(
      <SearchField
        label="搜索白板"
        clearLabel="清空搜索"
        value=""
        ref={ref}
        onValueChange={vi.fn()}
      />,
    );

    expect(Object.keys(ref.current ?? {})).toEqual(['focus']);

    ref.current?.focus();
    expect(document.activeElement).toBe(findSearchInput(fixture.host));
  });
});
