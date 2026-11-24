import { act, createRef, type SubmitEvent, type ReactNode, type Ref } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Button, type ButtonHandle, type ButtonProps } from '../../src/ui/base/index.js';

const host = document.createElement('div');
let root: Root;

beforeEach(() => {
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function getButton(selector = 'button'): HTMLButtonElement {
  const button = host.querySelector(selector);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Expected a mounted native button.');
  }

  return button;
}

function render(content: ReactNode): HTMLButtonElement {
  act(() => root.render(content));

  return getButton();
}

describe('Button', () => {
  it('activates once and defaults to a regular button inside a form', () => {
    const onActivate = vi.fn();
    const onSubmit = vi.fn((event: SubmitEvent<HTMLFormElement>) => event.preventDefault());
    const button = render(
      <form onSubmit={onSubmit}>
        <Button label="打开" onActivate={onActivate} />
      </form>,
    );

    act(() => button.click());

    expect(button.type).toBe('button');
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('lets the form validate, submit and reset through native buttons', () => {
    const onActivate = vi.fn();
    const onSubmit = vi.fn((event: SubmitEvent<HTMLFormElement>) => event.preventDefault());
    const onReset = vi.fn();
    const submit = render(
      <form onSubmit={onSubmit} onReset={onReset}>
        <input name="title" required />
        <Button label="提交" type="submit" onActivate={onActivate} />
        <Button label="重置" type="reset" onActivate={onActivate} />
      </form>,
    );
    const input = host.querySelector('input');
    if (!input) {
      throw new Error('Expected the form field.');
    }

    act(() => submit.click());
    expect(onSubmit).not.toHaveBeenCalled();

    input.value = '草稿';
    act(() => submit.click());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    act(() => getButton('button[type="reset"]').click());
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('');
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('blocks activation while busy and keeps the mounted button focused', () => {
    const onActivate = vi.fn();
    const button = render(<Button label="打开" onActivate={onActivate} />);
    button.focus();

    const busyButton = render(<Button label="打开" busy onActivate={onActivate} />);
    act(() => busyButton.click());

    expect(busyButton).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(onActivate).not.toHaveBeenCalled();

    render(<Button label="打开" onActivate={onActivate} />);
    act(() => button.click());

    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('blocks the native submit default action during busy and permits it after busy', () => {
    const onSubmit = vi.fn((event: SubmitEvent<HTMLFormElement>) => event.preventDefault());
    const button = render(
      <form onSubmit={onSubmit}>
        <Button label="提交" type="submit" busy />
      </form>,
    );

    act(() => button.click());
    expect(onSubmit).not.toHaveBeenCalled();

    render(
      <form onSubmit={onSubmit}>
        <Button label="提交" type="submit" />
      </form>,
    );

    act(() => button.click());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('gives an icon-only button its accessible name and keeps disabled native', () => {
    const onActivate = vi.fn();
    const button = render(
      <Button label="保存" icon={<span>图标</span>} iconOnly disabled onActivate={onActivate} />,
    );

    act(() => button.click());

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('保存');
    expect(button.querySelector('[aria-hidden="true"]')?.textContent).toBe('图标');
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('exposes only focus through the public handle', () => {
    expectTypeOf<ButtonHandle>().toEqualTypeOf<{ focus(): void }>();
    expectTypeOf<ButtonProps['ref']>().toEqualTypeOf<Ref<ButtonHandle> | undefined>();

    const ref = createRef<ButtonHandle>();
    const button = render(<Button label="打开" ref={ref} />);

    expect(Object.keys(ref.current ?? {})).toEqual(['focus']);
    ref.current?.focus();
    expect(document.activeElement).toBe(button);
  });
});
