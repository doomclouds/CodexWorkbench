import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TextField, type TextFieldHandle } from '../../src/ui/base/index.js';

function findInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input');
  if (!input) {
    throw new Error('TextField input is missing.');
  }

  return input;
}

function setNativeInputValue(input: HTMLInputElement, value: string, isComposing = false) {
  const valueProperty = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (valueProperty?.set === undefined) {
    throw new Error('Native input value setter is missing.');
  }

  valueProperty.set.call(input, value);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, isComposing }));
}

describe('TextField', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('uses the input value from the caller and reports the raw next value', () => {
    const onValueChange = vi.fn();

    act(() =>
      root.render(
        <TextField
          label="项目名称"
          value="初始名称"
          name="project"
          required
          onValueChange={onValueChange}
        />,
      ),
    );

    const input = findInput(container);
    expect(input.value).toBe('初始名称');
    expect(input.name).toBe('project');
    expect(input.required).toBe(true);

    act(() => setNativeInputValue(input, ' 改过的名称 '));
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith(' 改过的名称 ');

    act(() =>
      root.render(<TextField label="项目名称" value="回填名称" onValueChange={onValueChange} />),
    );
    expect(input.value).toBe('回填名称');
  });

  it('keeps the generated label association stable and updates the error description', () => {
    const onValueChange = vi.fn();

    act(() =>
      root.render(
        <TextField
          label="邮箱"
          type="email"
          value="draft"
          description="请输入联系邮箱"
          error="邮箱格式无效"
          onValueChange={onValueChange}
        />,
      ),
    );

    const input = findInput(container);
    const initialId = input.id;
    const describedBy = input.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(initialId).not.toBe('');
    expect(input.type).toBe('email');
    expect(container.querySelector('label')?.control).toBe(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy.map((id) => document.getElementById(id)?.textContent)).toEqual([
      '请输入联系邮箱',
      '邮箱格式无效',
    ]);

    act(() =>
      root.render(
        <TextField
          label="邮箱"
          type="email"
          value="studio@example.test"
          description="请输入联系邮箱"
          onValueChange={onValueChange}
        />,
      ),
    );

    expect(input.id).toBe(initialId);
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBe(describedBy[0]);
    expect(document.getElementById(describedBy[1] ?? '')).toBeNull();
  });

  it('exposes focus and select for an explicitly identified read-only input', () => {
    const ref = createRef<TextFieldHandle>();
    const onValueChange = vi.fn();

    act(() =>
      root.render(
        <TextField
          ref={ref}
          id="project-title"
          label="归档名称"
          value="历史版本"
          readOnly
          onValueChange={onValueChange}
        />,
      ),
    );

    const input = findInput(container);
    expect(input.id).toBe('project-title');
    expect(container.querySelector('label')?.control).toBe(input);
    expect(input.readOnly).toBe(true);
    expect(Object.keys(ref.current ?? {}).sort()).toEqual(['focus', 'select']);

    ref.current?.focus();
    expect(document.activeElement).toBe(input);
    ref.current?.select();
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('preserves focus when a handle is called on a disabled field', () => {
    const ref = createRef<TextFieldHandle>();
    const onValueChange = vi.fn();

    act(() =>
      root.render(
        <>
          <button type="button">其他操作</button>
          <TextField ref={ref} value="归档" label="名称" disabled onValueChange={onValueChange} />
        </>,
      ),
    );

    const button = container.querySelector('button');
    button?.focus();
    ref.current?.focus();
    ref.current?.select();

    expect(findInput(container).disabled).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it('preserves composition value changes and leaves the IME Enter key to the browser', () => {
    const onValueChange = vi.fn();
    const onSubmit = vi.fn();

    act(() =>
      root.render(
        <form onSubmit={onSubmit}>
          <TextField value="" label="白板名称" onValueChange={onValueChange} />
          <button type="submit">保存</button>
        </form>,
      ),
    );

    const input = findInput(container);
    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });

    act(() => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      setNativeInputValue(input, 'zhong', true);
      input.dispatchEvent(enter);
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' }));
      setNativeInputValue(input, '中');
    });

    expect(onValueChange.mock.calls).toEqual([['zhong'], ['中']]);
    expect(enter.defaultPrevented).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
