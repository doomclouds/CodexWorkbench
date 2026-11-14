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
import { contrastRatio, DARK_THEME, LIGHT_THEME } from '../src/core/theme.js';

let host: HTMLDivElement, root: Root;
const element = (id: string, extra: Partial<BoardElement> = {}): BoardElement => ({ id, type: 'shape', x: 20, y: 30, w: 200, h: 100, version: 1, text: 'A', ...extra });
const board = (elements: BoardElement[], revision = 1): Board => ({ artifact: { id: 'board', type: 'whiteboard', title: 'Board', revision, createdAt: '2026-11-14', updatedAt: '2026-11-14', pinned: false }, style: DEFAULT_STYLE, elements });
const client = (call = vi.fn().mockRejectedValue(new Error('CONFLICT'))): StudioClient => ({ embedded: true, call });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  localStorage.clear();
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.releasePointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = () => false;
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function mount(value: Board, props: Partial<WhiteboardCanvasProps> = {}) {
  await act(async () => root.render(<WhiteboardCanvas board={value} client={client()} actor={LOCAL_ACTOR} onChanged={() => {}} onAnnotate={() => {}} {...props} />));
}
async function event(node: Element, name: string) { await act(async () => { node.dispatchEvent(new MouseEvent(name, { bubbles: true, button: 0 })); }); }
async function input(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    if(node.getAttribute('contenteditable')!==null)node.textContent=value;else Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function select(id: string) { const node = host.querySelector(`[data-element-id="${id}"]`)!; await event(node, 'pointerdown'); await event(node, 'pointerup'); }

describe('native canvas parity', () => {
  it.each((['light', 'dark'] as const).flatMap(theme => [
    { theme, paint: 'default', values: {} },
    { theme, paint: 'existing white fill', values: { fill: '#ffffff', color: '#2d3142' } },
    { theme, paint: 'custom paint', values: { fill: '#1d4266', color: '#eacb67' } },
    { theme, paint: 'projected palette fill', values: { fill: '#F9E56F', color: '#f5f5f5' } },
  ]))('keeps table header and body readable in $theme with $paint', async ({ theme, paint, values }) => {
    host.dataset.studioTheme = theme;
    const value = element('table', { type: 'table', data: { rows: [['Header', 'Value'], ['Body', 'Cell']] }, ...values });
    const original = structuredClone(value);
    await mount(board([value]));
    const rendered = host.querySelector<HTMLTableElement>('table')!, header = rendered.querySelector('th')!, body = rendered.querySelector('td')!;
    const bodyStyle = getComputedStyle(rendered), headerStyle = getComputedStyle(header), cellStyle = getComputedStyle(body);
    const paper = (theme === 'dark' ? DARK_THEME : LIGHT_THEME).paper;
    expect(contrastRatio(bodyStyle.backgroundColor, paper)).toBe(1);
    expect(contrastRatio(cellStyle.color, bodyStyle.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(headerStyle.color, headerStyle.backgroundColor, bodyStyle.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    if (paint === 'custom paint') expect(contrastRatio(headerStyle.color, '#eacb67')).toBe(1);
    if (paint === 'default') expect(contrastRatio(headerStyle.backgroundColor, (theme === 'dark' ? DARK_THEME : LIGHT_THEME)['paper-2']!)).toBe(1);
    if (paint === 'projected palette fill') expect(contrastRatio(headerStyle.backgroundColor, theme === 'dark' ? '#F5D515' : '#F9E56F')).toBe(1);
    expect(value).toEqual(original);
  });
  it('renders the supported inline text and list format safely while keeping editable source markers', async () => {
    const text = '**重点**与*说明* `safe()` [资料](https://example.com)\n- 第一点\n2. 第二点\n<img src=x onerror=alert(1)> [危险](javascript:alert)';
    await mount(board([element('rich', { text })]));
    const node = host.querySelector('[data-element-id="rich"]')!;
    expect(node.querySelector('strong')!.textContent).toBe('重点'); expect(node.querySelector('em')!.textContent).toBe('说明'); expect(node.querySelector('code')!.textContent).toBe('safe()');
    expect(node.querySelectorAll('a')).toHaveLength(1); expect(node.querySelector('a')!.href).toBe('https://example.com/');
    expect(node.querySelector('img')).toBeNull(); expect(node.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(node.querySelectorAll('.is-list')).toHaveLength(2);
    expect(parseInlineText('**bold `literal`**')).toEqual([{ type: 'bold', text: 'bold ' }, { type: 'code', text: 'literal', bold: true }]);
    expect(parseRichText('# literal heading')[0]!.segments[0]!.text).toBe('# literal heading');
    await event(node, 'dblclick');
    expect(host.querySelector('[aria-label="编辑文字"] strong')!.textContent).toBe('重点');
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
    expect(host.querySelector('[aria-label="编辑文字"]')!.textContent).toBe('my local draft');
    await event([...host.querySelectorAll('button')].find(node => node.textContent === '重试原操作')!, 'click');
    expect(call.mock.calls[1]![1].expectedVersions).toEqual({ one: 1 });
    expect(call.mock.calls[1]![1].operationId).toBe(call.mock.calls[0]![1].operationId);
    await event([...host.querySelectorAll('button')].find(node => node.textContent === '比较双方内容')!, 'click');
    expect([...host.querySelectorAll('textarea')].map(node => node.value)).toContain('remote draft');
    expect([...host.querySelectorAll('textarea')].map(node => node.value)).toContain('my local draft');
    call.mockResolvedValueOnce({ board: board([element('one', { version: 3, text: 'my local draft' })], 3) });
    await event([...host.querySelectorAll('button')].find(node => node.textContent === '明确用我的草稿覆盖此处')!, 'click');
    expect(call.mock.calls[2]![1].expectedVersions).toEqual({ one: 2 });
    expect(call.mock.calls[2]![1].operationId).not.toBe(call.mock.calls[0]![1].operationId);
    await select('one');
    await event(host.querySelector('[aria-label="文字颜色"]')!, 'click');
    await event(host.querySelector('[aria-label="墨色 蓝色"]')!, 'click');
    await mount(board([element('one', { version: 3, text: 'newer remote draft' })], 3), props);
    expect(host.querySelector('[aria-label="墨色 蓝色"]')!.getAttribute('aria-pressed')).toBe('true');
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
  it('publishes live text before blur and drains newer input after an older ACK', async () => {
    vi.useFakeTimers();
    let resolveFirst!: (value: { board: Board }) => void;
    const call = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; })).mockResolvedValue({ board: board([element('one', { version: 3, text: 'second draft' })], 3) });
    const props = { client: client(call) };
    await mount(board([element('one')]), props); await event(host.querySelector('[data-element-id="one"]')!, 'dblclick');
    await input(host.querySelector<HTMLTextAreaElement>('[aria-label="编辑文字"]')!, 'first draft');
    await act(async () => vi.advanceTimersByTime(251)); expect(call).toHaveBeenCalledTimes(1);
    await input(host.querySelector<HTMLTextAreaElement>('[aria-label="编辑文字"]')!, 'second draft');
    await act(async () => vi.advanceTimersByTime(251)); expect(call).toHaveBeenCalledTimes(1);
    await act(async () => { resolveFirst({ board: board([element('one', { version: 2, text: 'first draft' })], 2) }); });
    expect(call).toHaveBeenCalledTimes(2); expect(call.mock.calls[1]![1]).toMatchObject({ expectedVersions: { one: 2 }, operations: [{ changes: { text: 'second draft' } }] });
    expect(host.querySelector('[aria-label="编辑文字"]')!.textContent).toBe('second draft');
  });
  it('shows remote live text in a clean open editor and retains that observed source for the next edit', async () => {
    const call = vi.fn().mockRejectedValue(new Error('network')), props = { client: client(call) };
    await mount(board([element('one')]), props); await event(host.querySelector('[data-element-id="one"]')!, 'dblclick');
    await mount(board([element('one', { text: 'remote live', version: 2 })], 2), props);
    expect(host.querySelector('[aria-label="编辑文字"]')!.textContent).toBe('remote live');
    await input(host.querySelector<HTMLTextAreaElement>('[aria-label="编辑文字"]')!, 'remote live and mine');
    await act(async () => host.querySelector('[aria-label="编辑文字"]')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(call.mock.calls[0]![1].expectedVersions).toEqual({ one: 2 });
  });
  it('automatically drains fast property changes while the first save is in flight', async () => {
    let resolveFirst!: (value: { board: Board }) => void;
    let current = board([element('one')]);
    const call = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; })).mockImplementation(async (_name, args) => { const op = args.operations[0]; current = board([{ ...current.elements[0]!, ...op.changes, version: current.elements[0]!.version + 1 }], current.artifact.revision + 1); return { board: current }; });
    await mount(current, { client: client(call) }); await select('one'); await event(host.querySelector('[aria-label="文字颜色"]')!, 'click');
    for (const color of ['蓝色', '绿色', '紫色']) await event(host.querySelector(`[aria-label="墨色 ${color}"]`)!, 'click');
    expect(call).toHaveBeenCalledTimes(1);
    current = board([element('one', { version: 2, color: '#2F7CC4' })], 2);
    await act(async () => { resolveFirst({ board: current }); });
    expect(call).toHaveBeenCalledTimes(3); expect(call.mock.calls[2]![1]).toMatchObject({ expectedVersions: { one: 3 }, operations: [{ changes: { color: '#7C5CBF' } }] });
    expect(current.elements[0]!.color).toBe('#7C5CBF');
  });
  it('keeps deleted text visible in a persisted recovery dialog and restores under a new id', async () => {
    const call = vi.fn(async (_name, args) => ({ board: board([{ ...args.operations[0].element, version: 1 }], 3) })), props = { client: client(call) };
    await mount(board([element('one')]), props); await event(host.querySelector('[data-element-id="one"]')!, 'dblclick');
    await input(host.querySelector<HTMLTextAreaElement>('[aria-label="编辑文字"]')!, 'recover this text');
    await mount(board([], 2), props);
    expect(localStorage.getItem('studio-draft:embedded:local:board')).toContain('recover this text');
    await event([...host.querySelectorAll('button')].find(node => node.textContent === '查看并恢复文字草稿')!, 'click');
    expect([...host.querySelectorAll('textarea')].map(node => node.value)).toContain('recover this text');
    await event([...host.querySelectorAll('button')].find(node => node.textContent === '另存为新对象')!, 'click');
    expect(call.mock.calls[0]![1].operations[0]).toMatchObject({ op: 'add', element: { text: 'recover this text' } });
    expect(call.mock.calls[0]![1].operations[0].element.id).not.toBe('one');
  });
  it('retains deleted table cells outside the unmounted table component', async () => {
    const props = { client: client(vi.fn()) };
    await mount(board([element('table', { type: 'table', data: { rows: [['A', 'B']] } })]), props);
    await event(host.querySelector('[data-cell="0:0"]')!, 'dblclick');
    await input(host.querySelector<HTMLTextAreaElement>('[aria-label="表格第1行第1列"]')!, 'lost table cell');
    await mount(board([], 2), props);
    expect(localStorage.getItem('studio-draft:embedded:local:board')).toContain('lost table cell');
    await event([...host.querySelectorAll('button')].find(node => node.textContent === '查看并恢复表格草稿')!, 'click');
    expect([...host.querySelectorAll('textarea')].some(node => node.value.includes('lost table cell'))).toBe(true);
  });
  it('reports table activity separately from unsaved content and clears a reverted clean draft', async () => {
    const activity = vi.fn();
    await mount(board([element('table', { type: 'table', data: { rows: [['A', 'B']] } })]), { onActivityChange: activity });
    await event(host.querySelector('[data-cell="0:0"]')!, 'dblclick');
    expect(activity.mock.lastCall?.[0]).toMatchObject({ editingIds: ['table'], dirty: false, saving: false });
    expect(localStorage.getItem('studio-draft:embedded:local:board')).toBeNull();
    await input(host.querySelector<HTMLTextAreaElement>('[aria-label="表格第1行第1列"]')!, 'changed');
    expect(activity.mock.lastCall?.[0]).toMatchObject({ editingIds: ['table'], dirty: true });
    expect(localStorage.getItem('studio-draft:embedded:local:board')).toContain('changed');
    await input(host.querySelector<HTMLTextAreaElement>('[aria-label="表格第1行第1列"]')!, 'A');
    expect(activity.mock.lastCall?.[0]).toMatchObject({ editingIds: ['table'], dirty: false, saving: false });
    expect(host.querySelector('[aria-label="表格第1行第1列"]')).not.toBeNull();
    expect(localStorage.getItem('studio-draft:embedded:local:board')).toBeNull();
  });
  it('uploads a cookie-authenticated guest video without an empty bearer header', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ src: '/assets/video.mp4' }));
    const call = vi.fn(async (_name, args) => ({ board: board([{ ...args.operations[0].element, version: 1 }], 2) }));
    await mount(board([]), { actor: { ...LOCAL_ACTOR, id: 'cookie-guest', role: 'editor' }, client: { embedded: false, baseUrl: 'http://studio.local', token: '', call: call as StudioClient['call'], request } });
    await act(async () => { const event = new Event('drop', { bubbles: true, cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: { files: [new File(['video'], 'clip.mp4', { type: 'video/mp4' })], types: ['Files'] } }); host.querySelector('[aria-label="白板画布"]')!.dispatchEvent(event); });
    expect(request).toHaveBeenCalledTimes(1); expect(new Headers(request.mock.calls[0]![1].headers).has('Authorization')).toBe(false);
    expect(call.mock.calls[0]![1].operations[0].element.video).toBe('/assets/video.mp4');
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
