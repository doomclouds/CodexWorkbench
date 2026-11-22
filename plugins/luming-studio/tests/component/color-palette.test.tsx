import { act, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ColorPalette from '../../src/app/features/whiteboard/canvas/controls/ColorPalette.js';

type Props = ComponentProps<typeof ColorPalette>;

let host: HTMLDivElement;
let root: Root;
const query = <T extends HTMLElement = HTMLElement>(label: string) =>
  host.querySelector<T>(`[aria-label="${label}"]`)!;

async function click(label: string) {
  await act(async () => query<HTMLButtonElement>(label).click());
}

async function input(label: string, value: string) {
  await act(async () => {
    const field = query<HTMLInputElement>(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function mount(props: Partial<Props> = {}) {
  const changed = vi.fn();
  const colorsChanged = vi.fn();
  function Harness() {
    const [value, setValue] = useState(props.value ?? '#D97757');
    const [custom, setCustom] = useState(props.custom ?? []);

    return (
      <ColorPalette
        theme="dark"
        {...props}
        value={value}
        custom={custom}
        onChange={(next, nextColors) => {
          changed(next, nextColors);
          setValue(next);
          if (nextColors) {
            setCustom(nextColors);
          }
        }}
        onCustomChange={(next) => {
          colorsChanged(next);
          setCustom(next);
        }}
      />
    );
  }

  await act(async () => root.render(<Harness />));

  return { changed, colorsChanged };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('keeps native picker samples in a draft and commits only the final color once', async () => {
  const { changed, colorsChanged } = await mount({ custom: ['#557799'] });
  await click('添加自定义颜色');
  for (const value of ['#334455', '#223344', '#112233']) {
    await input('取色器', value);
  }

  expect(changed).not.toHaveBeenCalled();
  expect(colorsChanged).not.toHaveBeenCalled();
  expect(
    host.querySelectorAll('.studio-native-colors > button[aria-label^="自定义颜色 "]'),
  ).toHaveLength(1);
  await act(async () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  expect(changed).toHaveBeenCalledExactlyOnceWith('#112233', ['#557799', '#112233']);
  expect(colorsChanged).not.toHaveBeenCalled();
  expect(query('自定义颜色 #112233').getAttribute('aria-pressed')).toBe('true');
  expect(query('自定义颜色 #112233').querySelector('svg')).not.toBeNull();
  expect(query('添加自定义颜色').getAttribute('aria-expanded')).toBe('false');
});

it.each(['cancel', 'escape'] as const)(
  'discards draft color samples on %s without changing the object or saved palette',
  async (action) => {
    const { changed, colorsChanged } = await mount({ custom: ['#557799'] });
    await click('添加自定义颜色');
    await input('颜色值', '#112233');
    if (action === 'cancel') {
      await act(async () =>
        host
          .querySelector<HTMLButtonElement>('.studio-custom-color-actions button[type="button"]')!
          .click(),
      );
    } else {
      await act(async () =>
        query('颜色值').dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        ),
      );
    }

    expect(changed).not.toHaveBeenCalled();
    expect(colorsChanged).not.toHaveBeenCalled();
    expect(query('添加自定义颜色').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(query('添加自定义颜色'));
  },
);

it('accepts hex text, validates drafts and avoids case-only duplicate colors', async () => {
  const { changed, colorsChanged } = await mount({ custom: ['#aabbcc'] });
  await click('添加自定义颜色');
  await input('颜色值', 'no color');
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  expect(query('颜色值').getAttribute('aria-invalid')).toBe('true');
  await input('颜色值', 'AABBCC');
  await act(async () =>
    host
      .querySelector<HTMLFormElement>('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(changed).toHaveBeenCalledExactlyOnceWith('#AABBCC', undefined);
  expect(colorsChanged).not.toHaveBeenCalled();
  expect(query('自定义颜色 #aabbcc').getAttribute('aria-pressed')).toBe('true');
});

it('reselects saved custom colors and keeps other saved entries when one is removed', async () => {
  const { changed, colorsChanged } = await mount({
    value: '#AABBCC',
    custom: ['#aabbcc', '#112233'],
  });
  await click('自定义颜色 #112233');
  expect(changed).toHaveBeenCalledExactlyOnceWith('#112233', undefined);
  expect(query('自定义颜色 #112233').getAttribute('aria-pressed')).toBe('true');
  await act(async () =>
    query('自定义颜色 #aabbcc').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    ),
  );
  expect(colorsChanged).toHaveBeenCalledExactlyOnceWith(['#112233']);
});

it('keeps the preset-only drawing palette free of a custom editor', async () => {
  await mount({ presetOnly: true });
  expect(query('添加自定义颜色')).toBeNull();
  expect(host.querySelector('form,input')).toBeNull();
});
