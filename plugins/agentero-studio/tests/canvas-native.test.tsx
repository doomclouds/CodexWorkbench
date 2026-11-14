// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WhiteboardCanvas, { type WhiteboardCanvasProps } from '../src/app/canvas/WhiteboardCanvas.js';
import { imageCropRect } from '../src/app/canvas/NativeMedia.js';
import { measureNativeIssues } from '../src/app/canvas/native-issues.js';
import { normalizeElement } from '../src/core/products/whiteboard.js';
import { parseInlineText, parseRichText } from '../src/core/shared/rich-text.js';
import { DEFAULT_STYLE, LOCAL_ACTOR, type Board, type BoardElement, type Feedback, type StudioClient } from '../src/contracts/studio.js';

let host: HTMLDivElement, root: Root;
const element = (id: string, extra: Partial<BoardElement> = {}): BoardElement => ({ id, type: 'shape', x: 20, y: 30, w: 200, h: 100, version: 1, text: 'A', ...extra });
const board = (elements: BoardElement[], revision = 1): Board => ({ artifact: { id: 'board', type: 'whiteboard', title: 'Board', revision, createdAt: '2026-11-14', updatedAt: '2026-11-14', pinned: false }, style: DEFAULT_STYLE, elements });
const client = (call = vi.fn().mockRejectedValue(new Error('CONFLICT'))): StudioClient => ({ embedded: true, call });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.releasePointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = () => false;
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function mount(value: Board, props: Partial<WhiteboardCanvasProps> = {}) {
  await act(async () => root.render(<WhiteboardCanvas board={value} client={client()} actor={LOCAL_ACTOR} onChanged={() => {}} onAnnotate={() => {}} {...props} />));
}
async function event(node: Element, name: string) { await act(async () => { node.dispatchEvent(new MouseEvent(name, { bubbles: true, button: 0 })); }); }
async function input(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function select(id: string) { const node = host.querySelector(`[data-element-id="${id}"]`)!; await event(node, 'pointerdown'); await event(node, 'pointerup'); }

describe('native canvas parity', () => {
  it('renders the supported inline text and list format safely while keeping editable source markers', async () => {
    const text = '**重点**与*说明* `safe()` [资料](https://example.com)\n- 第一点\n2. 第二点\n<img src=x onerror=alert(1)> [危险](javascript:alert)';
    await mount(board([element('rich', { text })]));
    const node = host.querySelector('[data-element-id="rich"]')!;
    expect(node.querySelector('strong')!.textContent).toBe('重点'); expect(node.querySelector('em')!.textContent).toBe('说明'); expect(node.querySelector('code')!.textContent).toBe('safe()');
    expect(node.querySelectorAll('a')).toHaveLength(1); expect(node.querySelector('a')!.href).toBe('https://example.com/');
    expect(node.querySelector('img')).toBeNull(); expect(node.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(node.querySelectorAll('.is-list')).toHaveLength(2);
    expect(parseInlineText('**bold `literal`**')).toEqual([{ type: 'bold', text: 'bold `literal`' }]);
    expect(parseRichText('# literal heading')[0]!.segments[0]!.text).toBe('# literal heading');
    await event(node, 'dblclick');
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="编辑文字"]')!.value).toBe(text);
  });
  it('draws hollow and person shapes, real line style and an explicit unknown-kind fallback', async () => {
    await mount(board([element('hollow', { hollow: true, strokeWidth: 5, dash: true }), element('person', { kind: 'person' }), element('unknown', { kind: 'invented-kind' }), element('pen', { type: 'stroke', points: [0, 0, 20, 20], width: 7, dash: true })]));
    const hollow = host.querySelector('[data-element-id="hollow"] rect')!;
    expect(hollow.getAttribute('fill')).toBe('none'); expect(hollow.getAttribute('stroke-width')).toBe('5'); expect(hollow.getAttribute('stroke-dasharray')).toBe('6 5');
    expect(host.querySelector('[data-element-id="person"] path')!.getAttribute('d')).toContain(' A ');
    expect(host.querySelector('[data-element-id="unknown"] rect')).toBeNull();
    expect(host.querySelector('[data-element-id="unknown"]')!.textContent).toContain('不支持的形状');
    expect(host.querySelector('[data-element-id="pen"] .studio-stroke-svg path')!.getAttribute('stroke-width')).toBe('7');
    expect(() => normalizeElement(element('invalid', { kind: 'invented-kind' }))).toThrow('不支持此原生形状');
  });
  it('gives heads precedence over head and renders circles without inventing an end arrow', async () => {
    await mount(board([element('line', { type: 'arrow', from: [0, 0], to: [200, 100], heads: ['circle', 'none'], head: 'both', dash: true, strokeWidth: 4 })]));
    const line = host.querySelector('[data-element-id="line"] > path[stroke-dasharray]')!;
    expect(line.hasAttribute('marker-start')).toBe(true); expect(line.hasAttribute('marker-end')).toBe(false);
    expect(line.getAttribute('stroke-width')).toBe('4'); expect(host.querySelector('marker circle')).not.toBeNull();
  });
  it('smooths freehand curves and retains repeated points as deliberate corners', async () => {
    await mount(board([element('curve', { type: 'stroke', points: [0, 0, 40, 0, 40, 40] }), element('corner', { type: 'stroke', points: [0, 0, 40, 0, 40, 0, 40, 40] })]));
    const path = (id: string) => host.querySelector(`[data-element-id="${id}"] .studio-stroke-svg path`)!.getAttribute('d');
    expect(path('curve')).toBe('M 0 0 Q 40 0 40 20 L 40 40');
    expect(path('corner')).toContain('Q 40 0 40 0');
  });
  it('opens only safe image links and leaves video interaction with its own controls', async () => {
    const call = vi.fn();
    const src = 'data:image/png;base64,AA';
    await mount(board([element('linked', { type: 'image', src, href: 'https://example.com/image' }), element('unsafe', { type: 'image', src, href: 'javascript:alert(1)' }), element('movie', { type: 'image', src, video: 'data:video/mp4;base64,AA', href: 'https://example.com/movie' })]), { client: client(call) });
    const link = host.querySelector('[data-element-id="linked"] a')!;
    expect(link.getAttribute('href')).toBe('https://example.com/image');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(host.querySelector('[data-element-id="unsafe"] a')).toBeNull();
    expect(host.querySelector('[data-element-id="movie"] a')).toBeNull();
    expect(host.querySelector('[data-element-id="movie"] video')?.hasAttribute('controls')).toBe(true);
    await event(link, 'pointerdown'); await event(link, 'pointerup');
    expect(call).not.toHaveBeenCalled();
  });
  it('uses the native cover and position formula and saves crop metadata without replacing the image source', async () => {
    const image = element('image', { type: 'image', w: 100, h: 100, src: 'data:image/png;base64,AA', crop: { zoom: 2, x: .25, y: 1 }, data: { naturalWidth: 400, naturalHeight: 200 } });
    expect(imageCropRect(image, { w: 400, h: 200 }, image.crop!)).toEqual({ x: -75, y: -100, w: 400, h: 200 });
    const call = vi.fn().mockResolvedValue({ board: board([{ ...image, version: 2 }], 2) });
    await mount(board([image]), { client: client(call) });
    const img = host.querySelector('img')!;
    expect(img.style.left).toBe('-75%'); expect(img.style.top).toBe('-100%'); expect(img.style.width).toBe('400%');
    await event(host.querySelector('[data-element-id="image"]')!, 'dblclick');
    expect(host.querySelector('[aria-label="裁剪图片"]')).not.toBeNull();
    await input(host.querySelector<HTMLInputElement>('[aria-label="裁剪缩放"]')!, '3');
    await event([...host.querySelectorAll('button')].find(node => node.textContent === '保存裁剪')!, 'click');
    const changes = call.mock.calls[0]![1].operations[0].changes;
    expect(changes).toEqual({ crop: { zoom: 3, x: .25, y: 1 }, data: { naturalWidth: 400, naturalHeight: 200 } });
    expect(image.src).toBe('data:image/png;base64,AA');
    expect(() => normalizeElement({ ...image, crop: { zoom: .9, x: .5, y: .5 } })).toThrow('裁剪');
  });
  it('retains inline and property drafts across a concurrent save failure and reports pending activity', async () => {
    let reject!: (error: Error) => void;
    const call = vi.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockRejectedValue(new Error('CONFLICT'));
    const activity = vi.fn(), props = { client: client(call), onActivityChange: activity };
    await mount(board([element('one')]), props);
    await event(host.querySelector('[data-element-id="one"]')!, 'dblclick');
    const editor = host.querySelector<HTMLTextAreaElement>('[aria-label="编辑文字"]')!;
    await input(editor, 'my local draft');
    await act(async () => { editor.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(activity.mock.lastCall?.[0]).toMatchObject({ dirty: true, editingIds: ['one'] });
    await mount(board([element('one', { version: 2, text: 'remote draft' })], 2), props);
    await act(async () => { reject(new Error('CONFLICT')); });
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="编辑文字"]')!.value).toBe('my local draft');
    await event([...host.querySelectorAll('button')].find(node => node.textContent === '重试保存文字')!, 'click');
    expect(call.mock.calls[1]![1].expectedVersions).toEqual({ one: 2 });
    await act(async () => { host.querySelector('[aria-label="编辑文字"]')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })); });
    await select('one');
    const property = host.querySelector<HTMLTextAreaElement>('[aria-label="属性文字"]')!;
    await input(property, 'property draft');
    await act(async () => { property.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    await mount(board([element('one', { version: 3, text: 'newer remote draft' })], 3), props);
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="属性文字"]')!.value).toBe('property draft');
    expect(activity.mock.lastCall?.[0]).toMatchObject({ dirty: true, editingIds: ['one'] });
  });
  it('shows processing ranges from anchors and reports a real move lifecycle without inventing targets', async () => {
    const feedback = (id: string, anchor: Feedback['anchor']): Feedback => ({ id, artifactId: 'board', type: 'request', anchor, author: LOCAL_ACTOR, text: 'Change', status: 'processing', createdAt: '', updatedAt: '', replies: [], processingBy: { ...LOCAL_ACTOR, name: 'Codex Builder', kind: 'agent' } });
    const activity = vi.fn();
    await mount(board([element('one')]), { onActivityChange: activity, activities: [feedback('target', { elementIds: ['one'] }), feedback('region', { x: 500, y: 300, w: 150, h: 100 }), feedback('unanchored', {})] });
    expect(host.querySelectorAll('.studio-processing-frame')).toHaveLength(2);
    expect(host.querySelector('[data-feedback-id="target"]')!.textContent).toContain('Codex Builder');
    await event(host.querySelector('[data-element-id="one"]')!, 'pointerdown');
    expect(activity.mock.lastCall?.[0]).toMatchObject({ movingIds: ['one'], dirty: false });
    await event(host.querySelector('[aria-label="白板画布"]')!, 'pointercancel');
    expect(activity.mock.lastCall?.[0]).toMatchObject({ movingIds: [], dirty: false });
    expect(activity.mock.lastCall?.[0].issues).toEqual([]);
  });
});

it('reports only measured visible overflow, caps five results and emits nothing without layout measurements', () => {
  const viewport = document.createElement('div');
  viewport.innerHTML = Array.from({ length: 7 }, (_, index) => `<div data-element-id="${index}"><div class="studio-element-text">Text</div></div>`).join('');
  expect(measureNativeIssues(viewport)).toEqual([]);
  const rect = { x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100, toJSON() {} };
  viewport.getBoundingClientRect = () => rect;
  for (const text of viewport.querySelectorAll<HTMLElement>('.studio-element-text')) {
    text.getBoundingClientRect = () => rect;
    Object.defineProperties(text, { clientWidth: { value: 100 }, clientHeight: { value: 40 }, scrollWidth: { value: 120 }, scrollHeight: { value: 80 } });
  }
  expect(measureNativeIssues(viewport)).toHaveLength(5);
  expect(measureNativeIssues(viewport)[0]).toMatchObject({ type: 'native-text-overflow', ids: ['0'] });
});
