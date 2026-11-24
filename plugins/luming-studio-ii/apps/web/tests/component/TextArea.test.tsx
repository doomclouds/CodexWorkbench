import { act, createRef, type Ref } from 'react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { TextArea, type TextAreaHandle, type TextAreaProps } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

function findArea(host: HTMLElement): HTMLTextAreaElement {
  const area = host.querySelector('textarea');
  if (!area) {
    throw new Error('Expected the native text area.');
  }

  return area;
}

function enterText(area: HTMLTextAreaElement, value: string) {
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  if (!nativeValue?.set) {
    throw new Error('Native text area value setter is missing.');
  }

  nativeValue.set.call(area, value);
  area.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
}

describe('TextArea', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
  });

  afterEach(() => fixture.dispose());

  it('reports multiline text and leaves Enter to the native text area', () => {
    const onValueChange = vi.fn();
    const onSubmit = vi.fn();

    fixture.render(
      <form onSubmit={onSubmit}>
        <TextArea
          label="备注"
          value="第一行"
          id="remarks"
          name="remarks"
          rows={4}
          required
          onValueChange={onValueChange}
        />
      </form>,
    );

    const area = findArea(fixture.host);
    expect(area.value).toBe('第一行');
    expect(area.id).toBe('remarks');
    expect(area.name).toBe('remarks');
    expect(area.rows).toBe(4);
    expect(area.required).toBe(true);
    expect(fixture.host.querySelector('label')?.control).toBe(area);

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => {
      area.dispatchEvent(enter);
    });

    expect(enter.defaultPrevented).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();

    act(() => enterText(area, '第一行\n第二行'));

    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('第一行\n第二行');

    fixture.render(
      <form onSubmit={onSubmit}>
        <TextArea label="备注" value={'第一行\n第二行'} onValueChange={onValueChange} />
      </form>,
    );

    expect(area.value).toBe('第一行\n第二行');
  });

  it('updates its error association and keeps the generated field ID stable', () => {
    const onValueChange = vi.fn();
    fixture.render(
      <TextArea
        label="备注"
        value=""
        description="请输入备注"
        error="备注不能为空"
        onValueChange={onValueChange}
      />,
    );

    const area = findArea(fixture.host);
    const fieldId = area.id;
    const descriptions = area.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(fieldId).not.toBe('');
    expect(fixture.host.querySelector('label')?.control).toBe(area);
    expect(area.getAttribute('aria-invalid')).toBe('true');
    expect(descriptions.map((id) => document.getElementById(id)?.textContent)).toEqual([
      '请输入备注',
      '备注不能为空',
    ]);

    fixture.render(
      <TextArea label="备注" value="完成" description="请输入备注" onValueChange={onValueChange} />,
    );

    expect(area.id).toBe(fieldId);
    expect(area.getAttribute('aria-invalid')).toBeNull();
    expect(area.getAttribute('aria-describedby')).toBe(descriptions[0]);
    expect(document.getElementById(descriptions[1] ?? '')).toBeNull();
  });

  it('exposes focus and select for read-only text and preserves focus when disabled', () => {
    expectTypeOf<TextAreaHandle>().toEqualTypeOf<{ focus(): void; select(): void }>();
    expectTypeOf<TextAreaProps['ref']>().toEqualTypeOf<Ref<TextAreaHandle> | undefined>();

    const ref = createRef<TextAreaHandle>();
    const onValueChange = vi.fn();

    fixture.render(
      <>
        <button type="button">其他操作</button>
        <TextArea label="备注" value="已归档" readOnly ref={ref} onValueChange={onValueChange} />
      </>,
    );

    const area = findArea(fixture.host);
    expect(area.readOnly).toBe(true);
    expect(Object.keys(ref.current ?? {}).sort()).toEqual(['focus', 'select']);

    ref.current?.focus();
    ref.current?.select();

    expect(document.activeElement).toBe(area);
    expect([area.selectionStart, area.selectionEnd]).toEqual([0, area.value.length]);

    fixture.render(
      <>
        <button type="button">其他操作</button>
        <TextArea label="备注" value="已归档" disabled ref={ref} onValueChange={onValueChange} />
      </>,
    );

    const other = fixture.host.querySelector('button');
    other?.focus();
    ref.current?.focus();
    ref.current?.select();

    expect(area.disabled).toBe(true);
    expect(document.activeElement).toBe(other);
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
