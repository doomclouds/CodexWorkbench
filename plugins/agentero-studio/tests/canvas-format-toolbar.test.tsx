// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CanvasFormatToolbar from '../src/app/canvas/CanvasFormatToolbar.js';
import type { BoardElement } from '../src/contracts/studio.js';

type Props = ComponentProps<typeof CanvasFormatToolbar>;
let host: HTMLDivElement, root: Root, sheet: HTMLStyleElement;
const element = (type: BoardElement['type'], extra: Partial<BoardElement> = {}): BoardElement => ({ id: type, type, x: 0, y: 0, w: 200, h: 100, version: 1, ...extra });
const query = <T extends HTMLElement = HTMLElement>(label: string) => host.querySelector<T>(`[aria-label="${label}"]`)!;
async function click(label: string) { await act(async () => query<HTMLButtonElement>(label).click()); }
async function choose(label: string, value: string) {
  await act(async () => { const select = query<HTMLSelectElement>(label); select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function mount(elements: BoardElement[], props: Partial<Props> = {}) {
  const changed = vi.fn();
  function Harness() {
    const [values, setValues] = useState(elements);
    return <CanvasFormatToolbar elements={values} style={{ left: 200, top: 12 }} canEdit canAnnotate saving={false} interactive={false} theme="light" onEditText={() => {}} onTextFormat={() => {}} onAnnotate={() => {}} onToggleInteractive={() => {}} onMore={() => {}} onAlign={() => {}} onChange={changes => { changed(changes); setValues(previous => previous.map(value => ({ ...value, ...changes }))); }} {...props} />;
  }
  await act(async () => root.render(<Harness />));
  return changed;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  sheet = document.createElement('style'); sheet.textContent = readFileSync(resolve('src/app/canvas/canvas.css'), 'utf8'); document.head.append(sheet);
  host = document.createElement('div'); host.className = 'studio-whiteboard'; host.style.width = '400px'; document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); sheet.remove(); vi.unstubAllGlobals(); });

it('changes a document frame fill through the same palette without offering global text formatting', async () => {
  const changed = await mount([element('document', { fill: '#EFEFEF' })]);
  expect(query('文字颜色')).toBeNull(); expect(query('文字大小')).toBeNull();
  await click('填充颜色');
  expect(query('填充色板')).not.toBeNull(); expect(query('无颜色')).toBeNull();
  await click('填充 绿色');
  expect(changed).toHaveBeenLastCalledWith({ fill: '#AEE2AB' });
  expect(query('填充 绿色').getAttribute('aria-pressed')).toBe('true');
  expect(query('填充颜色').style.background).toBe('rgb(174, 226, 171)');
});

it('offers document focus annotation directly while preserving the whole-object annotation action', async () => {
  const focus = vi.fn(), annotate = vi.fn(), edit = vi.fn();
  await mount([element('document')], { onFocusAnnotate: focus, onAnnotate: annotate, onEditDocument: edit });
  const action = query<HTMLButtonElement>('聚焦备注');
  expect(action.textContent).toContain('聚焦备注'); expect(action.closest('[role="dialog"]')).toBeNull();
  await click('聚焦备注'); expect(focus).toHaveBeenCalledOnce(); expect(annotate).not.toHaveBeenCalled(); expect(edit).not.toHaveBeenCalled();
  await click('备注所选元素'); expect(annotate).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalledOnce();
  const style = getComputedStyle(action);
  expect(style.width).toBe('auto'); expect(style.whiteSpace).toBe('nowrap'); expect(style.flexShrink).toBe('0');
});

it('respects edit and annotation permissions for document actions', async () => {
  const focus = vi.fn();
  await mount([element('document')], { canEdit: false, canAnnotate: false, onFocusAnnotate: focus });
  expect(query('填充颜色')).toBeNull(); expect(query('编辑文档')).toBeNull();
  expect(query<HTMLButtonElement>('聚焦备注').disabled).toBe(true);
  await click('聚焦备注'); expect(focus).not.toHaveBeenCalled();
});

it('keeps the existing annotation action for ordinary objects without adding document focus', async () => {
  const annotate = vi.fn(), focus = vi.fn();
  await mount([element('container')], { onAnnotate: annotate, onFocusAnnotate: focus });
  expect(query('聚焦备注')).toBeNull();
  await click('备注所选元素'); expect(annotate).toHaveBeenCalledOnce(); expect(focus).not.toHaveBeenCalled();
});

it('lets a mixed document and container selection share a frame fill', async () => {
  const changed = await mount([element('document'), element('container')]);
  await click('填充颜色'); await click('填充 蓝色');
  expect(changed.mock.lastCall?.[0]).toMatchObject({ fill: '#9DC8F7' });
  expect(query('文字颜色')).toBeNull();
});

it('keeps both native endpoint choices readable and preserves the opposite endpoint when changed', async () => {
  const changed = await mount([element('arrow', { heads: ['circle', 'arrow'] })]);
  for (const label of ['连接线起点', '连接线终点']) {
    const select = query<HTMLSelectElement>(label), style = getComputedStyle(select);
    expect([...select.options].map(option => option.text)).toEqual(['无', '箭头', '圆点']);
    expect(parseFloat(style.width)).toBeGreaterThanOrEqual(80); expect(parseFloat(style.minWidth)).toBeGreaterThanOrEqual(80);
    expect(style.fontSize).toBe('14px'); expect(parseFloat(style.paddingRight)).toBeGreaterThanOrEqual(22); expect(style.flexShrink).toBe('0');
    select.focus(); expect(document.activeElement).toBe(select);
    const key = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    select.dispatchEvent(key); expect(key.defaultPrevented).toBe(false);
  }
  await choose('连接线起点', 'none'); expect(changed).toHaveBeenLastCalledWith({ heads: ['none', 'arrow'] });
  await choose('连接线终点', 'circle'); expect(changed).toHaveBeenLastCalledWith({ heads: ['none', 'circle'] });
  expect(query<HTMLSelectElement>('连接线起点').value).toBe('none'); expect(query<HTMLSelectElement>('连接线终点').value).toBe('circle');
  const scroll = getComputedStyle(host.querySelector('.studio-selection-toolbar-scroll')!);
  expect(scroll.flexWrap).toBe('nowrap'); expect(scroll.overflowX).toBe('auto');
});
