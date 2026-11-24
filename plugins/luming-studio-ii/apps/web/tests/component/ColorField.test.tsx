import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ColorField } from '../../src/ui/base/index.js';
import { createControlFixture } from '../support/render-control.js';

function findInputs(host: HTMLElement) {
  const hex = host.querySelector<HTMLInputElement>('input[type="text"]');
  const picker = host.querySelector<HTMLInputElement>('input[type="color"]');
  if (!hex || !picker) {
    throw new Error('ColorField inputs are missing.');
  }

  return { hex, picker };
}

function enterDraft(input: HTMLInputElement, value: string) {
  const property = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (property?.set === undefined) {
    throw new Error('Native input value setter is missing.');
  }

  property.set.call(input, value);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
}

function pressKey(input: HTMLInputElement, key: string) {
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('ColorField', () => {
  let fixture: ReturnType<typeof createControlFixture>;

  beforeEach(() => {
    fixture = createControlFixture();
  });

  afterEach(() => fixture.dispose());

  it('keeps invalid drafts editable and commits a valid HEX value once', () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    fixture.render(
      <ColorField
        label="填充色"
        value="#112233"
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );

    const { hex, picker } = findInputs(fixture.host);
    expect(fixture.host.querySelector('label')?.control).toBe(hex);
    expect(picker.getAttribute('aria-label')).toBe('填充色选色');

    act(() => {
      hex.focus();
      enterDraft(hex, '#A');
      pressKey(hex, 'Enter');
    });

    expect(hex.value).toBe('#A');
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onValueCommit).not.toHaveBeenCalled();

    act(() => enterDraft(hex, '#a0b1c2'));
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('#A0B1C2');
    expect(picker.value).toBe('#a0b1c2');

    act(() => {
      pressKey(hex, 'Enter');
      hex.blur();
    });

    expect(onValueCommit).toHaveBeenCalledExactlyOnceWith('#A0B1C2');
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(hex.value).toBe('#112233');
  });

  it('commits a valid draft on blur without waiting for any parent update', () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    fixture.render(
      <ColorField
        label="字体色"
        value="#112233"
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );

    const { hex } = findInputs(fixture.host);
    act(() => {
      hex.focus();
      enterDraft(hex, '#445566');
      hex.blur();
    });

    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('#445566');
    expect(onValueCommit).toHaveBeenCalledExactlyOnceWith('#445566');
  });

  it('rolls back the color preview when the caller echoes the preview and the user cancels', () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    const renderColor = (value: string) =>
      fixture.render(
        <ColorField
          label="填充色"
          value={value}
          onValueChange={onValueChange}
          onValueCommit={onValueCommit}
        />,
      );

    renderColor('#112233');
    const { hex } = findInputs(fixture.host);
    act(() => enterDraft(hex, '#aabbcc'));
    renderColor('#AABBCC');
    act(() => {
      enterDraft(hex, '#A');
      pressKey(hex, 'Escape');
    });

    expect(onValueChange.mock.calls).toEqual([['#AABBCC'], ['#112233']]);
    expect(onValueCommit).not.toHaveBeenCalled();

    renderColor('#112233');
    expect(hex.value).toBe('#112233');
  });

  it('replaces the local draft after receiving a different controlled color', () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    const renderColor = (value: string) =>
      fixture.render(
        <ColorField
          label="背景色"
          value={value}
          onValueChange={onValueChange}
          onValueCommit={onValueCommit}
        />,
      );

    renderColor('#112233');
    const { hex, picker } = findInputs(fixture.host);
    act(() => enterDraft(hex, '#aabbcc'));
    act(() => enterDraft(hex, '#AX'));
    renderColor('#445566');
    expect(hex.value).toBe('#445566');
    expect(picker.value).toBe('#445566');

    act(() => pressKey(hex, 'Enter'));
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('#AABBCC');
    expect(onValueCommit).not.toHaveBeenCalled();
  });

  it('uses picker input for preview and native change for one confirmation', () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    fixture.render(
      <ColorField
        label="背景色"
        value="#112233"
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );

    const { hex, picker } = findInputs(fixture.host);
    act(() => {
      picker.focus();
      picker.value = '#ff227a';
      picker.dispatchEvent(new Event('input', { bubbles: true }));
      expect(hex.value).toBe('#FF227A');
      expect(onValueCommit).not.toHaveBeenCalled();
      picker.dispatchEvent(new Event('change', { bubbles: true }));
      picker.blur();
    });

    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('#FF227A');
    expect(onValueCommit).toHaveBeenCalledExactlyOnceWith('#FF227A');
  });

  it('cancels the picker preview and also accepts a standalone native change', () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    fixture.render(
      <ColorField
        label="填充色"
        value="#112233"
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );

    const { hex, picker } = findInputs(fixture.host);
    act(() => {
      picker.value = '#aabbcc';
      picker.dispatchEvent(new Event('input', { bubbles: true }));
      pressKey(picker, 'Escape');
    });

    expect(onValueChange.mock.calls).toEqual([['#AABBCC'], ['#112233']]);
    expect(onValueCommit).not.toHaveBeenCalled();
    expect(hex.value).toBe('#112233');
    expect(picker.value).toBe('#112233');

    act(() => {
      picker.value = '#445566';
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onValueChange).toHaveBeenLastCalledWith('#445566');
    expect(onValueCommit).toHaveBeenCalledExactlyOnceWith('#445566');
  });

  it('suppresses both the HEX and picker events when disabled', () => {
    const onValueChange = vi.fn();
    const onValueCommit = vi.fn();
    fixture.render(
      <ColorField
        label="边框色"
        value="#112233"
        disabled
        onValueChange={onValueChange}
        onValueCommit={onValueCommit}
      />,
    );

    const { hex, picker } = findInputs(fixture.host);
    expect(hex.disabled).toBe(true);
    expect(picker.disabled).toBe(true);

    act(() => {
      enterDraft(hex, '#445566');
      pressKey(hex, 'Enter');
      picker.value = '#667788';
      picker.dispatchEvent(new Event('input', { bubbles: true }));
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onValueChange).not.toHaveBeenCalled();
    expect(onValueCommit).not.toHaveBeenCalled();
  });
});
