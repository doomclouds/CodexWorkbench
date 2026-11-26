import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  stickerCatalog,
  stickerExtension,
  StickerObject,
  StickerPalette,
} from '../../../src/ui/domain/objects/sticker/index.js';
import type { StickerPreset } from '../../../src/ui/domain/objects/sticker/index.js';
import { createControlFixture } from '../../support/render-control.js';

let fixture: ReturnType<typeof createControlFixture>;

function showModal(this: HTMLDialogElement) {
  this.open = true;
}

function closeModal(this: HTMLDialogElement) {
  this.open = false;
}

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { value: showModal, configurable: true },
    close: { value: closeModal, configurable: true },
  });
}

beforeEach(() => {
  fixture = createControlFixture();
});

afterEach(() => {
  fixture.dispose();
});

function query<T extends Element>(selector: string): T {
  const result = fixture.host.querySelector<T>(selector);
  if (!result) {
    throw new Error('Expected ' + selector);
  }

  return result;
}

function search(value: string) {
  const input = query<HTMLInputElement>('input[type="search"]');
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  act(() => {
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function choices() {
  return fixture.host.querySelectorAll('[role="group"] button');
}

function SelectedSticker() {
  const [selected, setSelected] = useState<StickerPreset>();

  return (
    <>
      <StickerPalette selectedId={selected?.id} onSelect={setSelected} />
      <div aria-label="已放置贴纸">
        <StickerObject id={selected?.id} />
      </div>
    </>
  );
}

describe('StickerObject', () => {
  it('renders every legacy preset as stable SVG art with no duplicate catalogue entries', () => {
    fixture.render(stickerCatalog.map(({ id }) => <StickerObject key={id} id={id} />));
    expect(new Set(stickerCatalog.map(({ id }) => id)).size).toBe(42);
    const icons = fixture.host.querySelectorAll('svg[data-sticker-icon-id]');
    expect(icons).toHaveLength(42);
    for (const icon of icons) {
      expect(icon.getAttribute('aria-label')).toBeTruthy();
      expect(icon.querySelector('g g path, g g circle, g g rect')).not.toBeNull();
    }
  });

  it('uses the canonical heart geometry on preview and canvas, with a legacy character fallback', () => {
    fixture.render(
      <>
        <StickerObject id="heart" />
        <StickerObject id="unavailable" fallback="★" />
        <StickerPalette onSelect={vi.fn()} />
      </>,
    );
    const heart = query<SVGSVGElement>(':scope > svg[data-sticker-icon-id="heart"]');
    const preview = query<SVGSVGElement>('button svg[data-sticker-icon-id="heart"]');
    const vector = 'M12 21C8 18 3 14 3 9 3 3 9 2 12 7c3-5 9-4 9 2 0 5-5 9-9 12Z';
    const paths = heart.querySelectorAll('path');

    expect(paths).toHaveLength(2);
    expect(paths[0]?.getAttribute('d')).toBe(vector);
    expect(paths[1]?.getAttribute('d')).toBe(vector);
    expect(heart.querySelector('g[stroke="#ffffff"]')?.getAttribute('stroke-width')).toBe('4');
    expect(heart.querySelector('g[stroke="#273443"]')?.getAttribute('stroke-width')).toBe('1.3');
    expect(preview.innerHTML).toBe(heart.innerHTML);
    expect(fixture.host.textContent).toContain('★');
  });

  it('treats a malformed old identifier and its legacy fallback as data', () => {
    fixture.render(<StickerObject id="<script>unsafe</script>" fallback="<b>旧贴纸</b>" />);

    expect(fixture.host.textContent).toBe('<b>旧贴纸</b>');
    expect(fixture.host.querySelector('script, b, svg')).toBeNull();
  });
});

describe('StickerPalette', () => {
  it('searches the original 42 presets in Chinese, commits the choice, and restores the complete list', () => {
    fixture.render(<SelectedSticker />);
    expect(choices()).toHaveLength(42);

    search('合作');
    expect(choices()).toHaveLength(1);
    const handshake = query<HTMLButtonElement>('button[aria-label="贴纸 握手"]');
    act(() => handshake.click());
    expect(handshake.getAttribute('aria-pressed')).toBe('true');
    expect(query('[aria-label="已放置贴纸"] svg').getAttribute('data-sticker-icon-id')).toBe(
      'handshake',
    );

    search('nothing-matches-this');
    expect(choices()).toHaveLength(0);
    expect(query('[role="status"]').textContent).toBe('没有找到贴纸');
    act(() => query<HTMLButtonElement>('button[aria-label="清除贴纸搜索"]').click());
    expect(choices()).toHaveLength(42);
    expect(query('button[aria-label="贴纸 握手"]').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('stickerExtension', () => {
  it('keeps rejection visible with a frozen version and closes after a successful selection', async () => {
    const View = stickerExtension.View;
    const geometry = { x: 0, y: 0, width: 64, height: 64, rotation: 0 };
    const request = vi
      .fn<Parameters<typeof View>[0]['request']>()
      .mockResolvedValueOnce({ ok: false, message: '贴纸版本已变化' })
      .mockResolvedValueOnce({ ok: true, payload: { version: 3, value: { id: 'handshake' } } });
    const onRetentionChange = vi.fn<(retained: boolean) => void>();
    const props = {
      object: { kind: 'sticker' as const, label: '贴纸', geometry },
      geometry,
      zoom: 1,
      selected: true,
      interactive: false,
      readOnly: false,
      editRequest: 1,
      request,
      onRetentionChange,
    };

    fixture.render(
      <View {...props} payload={{ version: 1, value: { id: 'heart' } }} editRequest={undefined} />,
    );
    expect(onRetentionChange).not.toHaveBeenCalled();
    fixture.render(<View {...props} payload={{ version: 1, value: { id: 'heart' } }} />);
    expect(query<HTMLDialogElement>('dialog').open).toBe(true);
    expect(onRetentionChange.mock.calls).toEqual([[true]]);
    fixture.render(<View {...props} payload={{ version: 2, value: { id: 'heart' } }} />);
    const select = query<HTMLButtonElement>('dialog button[aria-label="贴纸 握手"]');
    await act(async () => select.click());

    const operation = { name: 'sticker.select', expectedVersion: 1, value: { id: 'handshake' } };
    expect(request).toHaveBeenNthCalledWith(1, operation);
    expect(query('dialog [role="alert"]').textContent).toBe('贴纸版本已变化');
    expect(query<HTMLDialogElement>('dialog').open).toBe(true);
    expect(onRetentionChange.mock.calls).toEqual([[true]]);

    const close = query<HTMLButtonElement>('dialog button[aria-label="关闭贴纸库"]');
    act(() => close.click());
    expect(fixture.host.querySelector('dialog')).toBeNull();
    expect(onRetentionChange.mock.calls).toEqual([[true], [false]]);
    fixture.render(
      <View {...props} payload={{ version: 2, value: { id: 'heart' } }} editRequest={2} />,
    );
    await act(async () =>
      query<HTMLButtonElement>('dialog button[aria-label="贴纸 握手"]').click(),
    );
    expect(request).toHaveBeenNthCalledWith(2, { ...operation, expectedVersion: 2 });
    expect(fixture.host.querySelector('dialog')).toBeNull();
    expect(onRetentionChange.mock.calls).toEqual([[true], [false], [true], [false]]);
  });
});
