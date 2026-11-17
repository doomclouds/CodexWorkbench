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
async function mount(elements: BoardElement[], props: Partial<Props> = {}, withViewControls = false) {
  const changed = vi.fn();
  function Harness() {
    const [values, setValues] = useState(elements);
    return <>{withViewControls && <div className="studio-canvas-top-tools" />}<CanvasFormatToolbar elements={values} style={{ left: 200, top: 12 }} canEdit canAnnotate saving={false} interactive={false} theme="light" onEditText={() => {}} onTextFormat={() => {}} onAnnotate={() => {}} onToggleInteractive={() => {}} onMore={() => {}} onAlign={() => {}} onChange={changes => { changed(changes); setValues(previous => previous.map(value => ({ ...value, ...changes }))); }} {...props} /></>;
  }
  await act(async () => root.render(<Harness />));
  return changed;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  sheet = document.createElement('style'); sheet.textContent = readFileSync(resolve('src/app/canvas/canvas.css'), 'utf8'); document.head.append(sheet);
  host = document.createElement('div'); host.className = 'studio-whiteboard'; host.style.width = '400px'; document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); sheet.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([800, 300])('measures the real view controls and keeps selection actions clear in a %spx canvas', async width => {
  const rect = (x: number, y: number, w: number, h: number) => ({ x, y, left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, toJSON() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === host) return rect(100, 50, width, 600);
    if (this.classList.contains('studio-canvas-top-tools')) return rect(100 + width - 140, 62, 126, 38);
    if (this.classList.contains('studio-selection-toolbar')) return rect(0, 0, 264, 42);
    return rect(0, 0, 0, 0);
  });
  await mount([element('document')], { style: { left: 1600, top: 12 } }, true);
  const toolbar = query('选区格式'), left = parseFloat(toolbar.style.left) - 132, top = parseFloat(toolbar.style.top);
  expect(left + 264 <= width - 148 || top >= 58).toBe(true);
  expect(left).toBeGreaterThanOrEqual(12); expect(left + 264).toBeLessThanOrEqual(width - 12);
});

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

it('keeps document operations in its header instead of duplicating interaction, edit and focus-note actions', async () => {
  const annotate = vi.fn();
  await mount([element('document')], { onAnnotate: annotate });
  expect(query('与文档内容交互')).toBeNull();
  expect(query('编辑文档')).toBeNull();
  expect(query('聚焦备注')).toBeNull();
  await click('备注所选元素'); expect(annotate).toHaveBeenCalledOnce();
});

it('respects edit and annotation permissions for document object actions', async () => {
  await mount([element('document')], { canEdit: false, canAnnotate: false });
  expect(query('填充颜色')).toBeNull(); expect(query('编辑文档')).toBeNull();
  expect(query('聚焦备注')).toBeNull(); expect(query('备注所选元素')).toBeNull();
});

it('keeps the existing annotation action for ordinary objects', async () => {
  const annotate = vi.fn();
  await mount([element('container')], { onAnnotate: annotate });
  expect(query('聚焦备注')).toBeNull();
  await click('备注所选元素'); expect(annotate).toHaveBeenCalledOnce();
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
