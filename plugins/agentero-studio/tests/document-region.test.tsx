// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BoardElement } from '../src/contracts/studio.js';
import { documentPlainText, normalizeDocument, type DocumentContent } from '../src/contracts/document.js';
import { documentHtml } from '../src/core/products/document-serialization.js';
import { registerEscapeLayer } from '../src/app/shared/escape.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { NativeContentQueue } from '../src/app/canvas/content-queue.js';
import { StudioService } from '../src/core/service.js';
import { documentOperations } from '../src/contracts/document.js';
import type { Board, Operation } from '../src/contracts/studio.js';
import { LIGHT_THEME } from '../src/core/theme.js';

const imageRequests = vi.hoisted(() => ({ values: [] as Promise<string>[] }));
vi.mock('../src/app/canvas/DocumentEditor.js', () => ({ default: ({ value, editable, theme, onChange, onCompositionChange, resolveFileUrl }: { value: DocumentContent; editable: boolean; theme: string; onChange: (value: DocumentContent) => void; onCompositionChange?: (active: boolean) => void; resolveFileUrl: (source: string) => Promise<string> }) => <><textarea aria-label="测试块编辑器" data-editor-theme={theme} readOnly={!editable} value={documentPlainText(value)} onCompositionStart={() => onCompositionChange?.(true)} onCompositionEnd={() => onCompositionChange?.(false)} onChange={event => onChange({ schemaVersion: 1, blocks: [{ id: 'paragraph', type: 'paragraph', props: {}, content: event.target.value, children: [] }] })} /><button type="button" aria-label="测试读取图片" onClick={() => { const request = resolveFileUrl('/assets/artifact-one/picture'); imageRequests.values.push(request); void request.catch(() => undefined); }}>读取图片</button></> }));
import DocumentRegion from '../src/app/canvas/DocumentRegion.js';
import DocumentReadView from '../src/app/canvas/DocumentReadView.js';

type Props = ComponentProps<typeof DocumentRegion>;
const documentValue = (text: string): DocumentContent => ({ schemaVersion: 1, blocks: [{ id: 'paragraph', type: 'paragraph', props: {}, content: text, children: [] }] });
const elementValue = (text = '已保存正文', version = 1): BoardElement => ({ id: 'document-one', type: 'document', text: '方案说明', x: 20, y: 30, w: 600, h: 350, version, document: documentValue(text) });
let host: HTMLDivElement, portal: HTMLDivElement, root: Root, props: Props;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  imageRequests.values = [];
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  host = document.createElement('div'); host.className = 'studio'; portal = document.createElement('div'); portal.className = 'studio'; document.body.append(host, portal); root = createRoot(host);
  props = { element: elementValue(), artifactId: 'artifact-one', actor: { id: 'owner', name: '房主', kind: 'human', role: 'owner' }, client: { embedded: false, call: vi.fn() }, canEdit: true, canAnnotate: true, interactive: true, expanded: false, focusHost: portal, theme: 'light', onInteract: vi.fn(), onExpand: vi.fn(), onExit: vi.fn(), onActivity: vi.fn(), onAnnotate: vi.fn(), onSave: vi.fn(async (document, title, base) => ({ ...base, version: base.version + 1, document: structuredClone(document), text: title })) };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); portal.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function render() { await act(async () => root.render(<DocumentRegion {...props} />)); }
function button(label: string): HTMLButtonElement { const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label); if (!found) throw new Error(`Missing button: ${label}; ${document.body.textContent}`); return found; }
async function click(label: string) { await act(async () => button(label).click()); }
async function edit() { await click('编辑文档'); for (let i = 0; i < 25 && !document.querySelector('[aria-label="测试块编辑器"]'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); expect(document.querySelector('[aria-label="测试块编辑器"]')).toBeTruthy(); }
async function change(value: string, label = '测试块编辑器') { await act(async () => { const input = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(`[aria-label="${label}"]`)!; const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
const storedDraft = () => localStorage.getItem('studio-document-draft:owner:artifact-one:document-one');

it('keeps document paper independent from UI theme in reading, editing and expansion', async () => {
  props = { ...props, theme: 'dark' }; await render();
  const shell = host.querySelector<HTMLElement>('.studio-document-region')!;
  expect(shell.style.getPropertyValue('--document-paper')).toBe('#EFEFEF');
  await edit(); expect(host.querySelector('[data-editor-theme]')!.getAttribute('data-editor-theme')).toBe('light');
  props = { ...props, expanded: true, element: { ...props.element, fill: '#182232', color: '#E0B070' } }; await render();
  expect(portal.querySelector<HTMLElement>('.studio-document-focus')!.style.getPropertyValue('--document-paper')).toBe('#182232');
  expect(portal.querySelector('[data-editor-theme]')!.getAttribute('data-editor-theme')).toBe('dark');
  expect(props.onSave).not.toHaveBeenCalled();
});

it('uses the same opaque backdrop beneath transparent paper in inline and expanded document surfaces', async () => {
  props = { ...props, element: { ...props.element, fill: 'none' }, styleProfile: { ...LIGHT_THEME, paper: '#101010' }, theme: 'light' };
  await render(); const shell = host.querySelector<HTMLElement>('.studio-document-region')!;
  expect(shell.style.getPropertyValue('--document-backdrop')).toBe('#101010'); expect(shell.style.getPropertyValue('--document-paper')).toBe('rgba(0,0,0,0)');
  props = { ...props, expanded: true, theme: 'dark' }; await render();
  expect(portal.querySelector<HTMLElement>('.studio-document-focus')!.style.getPropertyValue('--document-backdrop')).toBe('#101010');
  expect(props.element.fill).toBe('none'); expect(props.onSave).not.toHaveBeenCalled();
});

it('provides a title drag handle without assigning body text the move action', async () => {
  const move = vi.fn(); props = { ...props, onMoveStart: move }; await render();
  const handle = button('移动文档');
  await act(async () => handle.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true, cancelable: true })));
  expect(move).toHaveBeenCalledTimes(1);
  props = { ...props, annotationMode: true }; await render(); expect(button('移动文档').disabled).toBe(false);
  await act(async () => button('移动文档').dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true, cancelable: true })));
  expect(move).toHaveBeenCalledTimes(2); expect(props.onAnnotate).not.toHaveBeenCalled();
  await act(async () => host.querySelector('[data-document-block-id]')!.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true })));
  expect(move).toHaveBeenCalledTimes(2);
  props = { ...props, element: { ...props.element, locked: true } }; await render(); expect(button('移动文档').disabled).toBe(true);
  props = { ...props, expanded: true }; await render(); expect(portal.querySelector('[aria-label="移动文档"]')).toBeNull();
});

it('opens a precise paragraph note directly in focused annotation mode and blocks link navigation', async () => {
  props = { ...props, annotationMode: true, annotationActive: true, element: { ...props.element, document: { schemaVersion: 1, blocks: [{ id: 'paragraph', type: 'paragraph', props: {}, content: [{ type: 'link', href: 'https://example.com', content: [{ type: 'text', text: '需要备注的段落', styles: {} }] }], children: [] }] } } }; await render();
  window.getSelection()?.removeAllRanges(); const paragraph = host.querySelector<HTMLElement>('[data-document-block-id="paragraph"]')!;
  await act(async () => paragraph.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true, cancelable: true })));
  expect(props.onAnnotate).toHaveBeenCalledWith(expect.objectContaining({ coordinateSpace: 'document', elementIds: ['document-one'], blockIds: ['paragraph'], quote: '需要备注的段落', sourceVersion: 1 }), 1, expect.any(Object));
  expect(paragraph.classList.contains('is-anchored')).toBe(true);
  const follow = new MouseEvent('click', { bubbles: true, cancelable: true }); await act(async () => paragraph.querySelector('a')!.dispatchEvent(follow)); expect(follow.defaultPrevented).toBe(true);
  expect(host.textContent).toContain('选择段落或文字'); expect(props.onInteract).not.toHaveBeenCalled(); expect(props.onExpand).not.toHaveBeenCalled();
});

it('keeps the composing editor mounted when interaction stops and saves the final input against its original base', async () => {
  await render(); await edit(); vi.useFakeTimers();
  const editor = host.querySelector<HTMLTextAreaElement>('[aria-label="测试块编辑器"]')!;
  await act(async () => editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '中' })));
  props = { ...props, interactive: false, element: elementValue('他人更新', 2) }; await render();
  expect(host.querySelector('[aria-label="测试块编辑器"]')).toBe(editor);
  expect(host.querySelector('[data-native-interactive="true"]')).toBeNull();
  await change('输入法尚在组合'); await tick(1000); expect(props.onSave).not.toHaveBeenCalled();
  await change('输入法最终文字');
  await act(async () => editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '文字' })));
  expect(host.querySelector('[aria-label="测试块编辑器"]')).toBeNull();
  expect(storedDraft()).toContain('输入法最终文字');
  await tick(650);
  expect(props.onSave).toHaveBeenLastCalledWith(documentValue('输入法最终文字'), '方案说明', expect.objectContaining({ version: 1 }), false);
});

it('keeps an in-flight save and its draft when pointer interaction ends, then accepts its acknowledgement once', async () => {
  let acknowledge!: (element: BoardElement) => void;
  props.onSave = vi.fn(() => new Promise<BoardElement>(resolve => { acknowledge = resolve; }));
  await render(); await edit(); vi.useFakeTimers(); await change('切换对象前的正文'); await tick(650);
  props = { ...props, interactive: false }; await render();
  expect(host.querySelector('[aria-label="测试块编辑器"]')).toBeNull();
  expect(storedDraft()).toContain('切换对象前的正文');
  expect(props.onActivity).toHaveBeenLastCalledWith(expect.objectContaining({ editing: false, dirty: true, saving: true }));
  await act(async () => acknowledge(elementValue('切换对象前的正文', 2))); await tick(1500);
  expect(props.onSave).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-document-block-id="paragraph"]')!.textContent).toBe('切换对象前的正文');
  expect(props.onActivity).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: false, saving: false }));
});

it('saves dirty text after its own geometry ACK when the confirmed body and title still match its source', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-document-move-')), service = new StudioService({ dataRoot: directory });
  let latest: Board;
  const queue = new NativeContentQueue({ send: args => service.execute('artifact_apply', args), changed: () => {}, accepted: (_task, receipt) => { latest = receipt.board; } });
  try {
    const created = await service.execute('artifact_manage', { action: 'create', elements: [props.element] }); latest = created.board;
    props = { ...props, artifactId: created.artifact.id, element: latest.elements[0]!, onSave: vi.fn(async (document, title, base) => {
      const operations: Operation[] = [{ op: 'document', id: base.id, data: { operations: documentOperations(base.document!, document) } }];
      if (title !== base.text) operations.push({ op: 'update', id: base.id, changes: { text: title } });
      return (await queue.enqueue(latest, operations, '编辑文档', [base]))?.board.elements[0] ?? false;
    }) };
    await render(); await edit(); await change('移动前还未发送的正文');
    await act(async () => { await queue.enqueue(latest, [{ op: 'update', id: props.element.id, changes: { x: 250 } }], '移动元素', [props.element]); });
    props = { ...props, element: latest!.elements[0]! }; await render();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 720)); });
    expect(props.onSave).toHaveBeenCalledTimes(1); expect(vi.mocked(props.onSave).mock.calls[0]![2].version).toBe(2);
    expect(queue.tasks).toEqual([]);
    const saved = await service.execute('artifact_read', { artifactId: created.artifact.id, mode: 'objects', ids: [props.element.id] });
    expect(saved.elements[0]).toMatchObject({ x: 250, version: 3 }); expect(documentPlainText(saved.elements[0].document)).toBe('移动前还未发送的正文');
  } finally {
    queue.setEnabled(false); await service.close();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected document move fixture');
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps the original text base when a newer canonical version changed only the title', async () => {
  props.onSave = vi.fn().mockRejectedValue(new Error('版本冲突'));
  await render(); await edit(); vi.useFakeTimers(); await change('本机尚未保存的段落');
  props = { ...props, element: { ...elementValue('已保存正文', 2), text: '协作者的新标题' } }; await render(); await tick(650);
  expect(props.onSave).toHaveBeenLastCalledWith(documentValue('本机尚未保存的段落'), '方案说明', expect.objectContaining({ version: 1 }), false);
  await click('比较最新内容'); expect(host.querySelector('[aria-label="比较文档草稿"]')!.textContent).toContain('协作者的新标题');
});

it.each([false, true])('does not open a late focused note after saving when interaction remains %s and focus-note mode ended', async interactive => {
  let acknowledge!: (element: BoardElement) => void;
  props.onSave = vi.fn(() => new Promise<BoardElement>(resolve => { acknowledge = resolve; }));
  await render(); await edit(); await change('备注前需要保存的正文');
  props = { ...props, annotationMode: true }; await render();
  window.getSelection()?.removeAllRanges();
  await act(async () => host.querySelector('[data-document-block-id="paragraph"]')!.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true })));
  expect(props.onSave).toHaveBeenCalledTimes(1);
  props = { ...props, interactive, annotationMode: false }; await render();
  await act(async () => acknowledge({ ...elementValue('备注前需要保存的正文', 2) }));
  expect(props.onAnnotate).not.toHaveBeenCalled();
  expect(host.querySelector('[data-document-block-id="paragraph"]')!.textContent).toBe('备注前需要保存的正文');
});

it('keeps only the latest focused text range when a prior note is waiting for a save', async () => {
  let acknowledge!: (element: BoardElement) => void;
  props.onSave = vi.fn(() => new Promise<BoardElement>(resolve => { acknowledge = resolve; }));
  await render(); await edit(); await change('先前选文，最新选文'); props = { ...props, annotationMode: true }; await render();
  const text = host.querySelector('[data-document-block-id="paragraph"] p')!.firstChild!;
  for (const [start, end] of [[0, 4], [5, 9]]) {
    const range = document.createRange(); range.setStart(text, start); range.setEnd(text, end); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    await act(async () => text.parentElement!.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true })));
  }
  await act(async () => acknowledge(elementValue('先前选文，最新选文', 2)));
  expect(props.onAnnotate).toHaveBeenCalledTimes(1);
  expect(props.onAnnotate).toHaveBeenCalledWith(expect.objectContaining({ quote: '最新选文', sourceVersion: 2, blockIds: ['paragraph'] }), 2, expect.any(Object));
});

it('lets the canvas end focused annotation after local menus are closed', async () => {
  props = { ...props, annotationMode: true }; await render(); const exitFocus = vi.fn();
  const remove = registerEscapeLayer(host, exitFocus, 10);
  try {
    await click('导出文档');
    await act(async () => button('导出文档').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(exitFocus).not.toHaveBeenCalled();
    await act(async () => button('导出文档').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(exitFocus).toHaveBeenCalledTimes(1); expect(props.onInteract).not.toHaveBeenCalled();
  } finally { remove(); }
});

it.each(['#EFEFEF', '#182232'])('preserves explicit inline colors and rejects unsafe paints on paper %s', async fill => {
  props = { ...props, element: { ...props.element, fill, document: { schemaVersion: 1, blocks: [{ id: 'paragraph', type: 'paragraph', props: {}, content: [
    { type: 'text', text: '显式颜色', styles: { textColor: '#E0B070', backgroundColor: 'rgb(12,24,36)', bold: true } },
    { type: 'text', text: '预设颜色', styles: { textColor: 'red' } },
    { type: 'text', text: '<script>unsafe</script>', styles: { textColor: 'red; background:url(javascript:x)', backgroundColor: 'url(javascript:x)' } },
  ], children: [] }] } } }; await render();
  const block = host.querySelector('[data-document-block-id="paragraph"]')!, spans = block.querySelectorAll<HTMLSpanElement>('span[style]');
  expect(spans[0]!.style.color).toBe('rgb(224, 176, 112)'); expect(spans[0]!.style.backgroundColor).toBe('rgb(12, 24, 36)'); expect(spans[0]!.querySelector('strong')!.textContent).toBe('显式颜色');
  expect(spans[1]!.style.color).toBe(fill === '#EFEFEF' ? 'rgb(224, 62, 62)' : 'rgb(236, 64, 64)');
  expect(block.querySelector('script')).toBeNull(); expect(block.innerHTML).not.toContain('javascript:'); expect(block.textContent).toContain('<script>unsafe</script>');
});

it('does not promote an ACK containing foreign paragraphs underneath new local typing', async () => {
  let acknowledge!: (element: BoardElement) => void;
  props.onSave = vi.fn(() => new Promise<BoardElement>(resolve => { acknowledge = resolve; }));
  await render(); await edit(); vi.useFakeTimers();
  await change('本机标题', '文档标题'); await tick(650);
  await change('保存标题期间的新输入');
  const merged = { ...elementValue('协作者的新正文', 3), text: '本机标题' };
  props = { ...props, element: merged }; await render();
  await act(async () => acknowledge(structuredClone(merged))); await tick(1500);
  expect(props.onSave).toHaveBeenCalledTimes(1);
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="测试块编辑器"]')!.value).toBe('保存标题期间的新输入');
  expect(host.textContent).toContain('比较');
  expect(JSON.parse(storedDraft()!).base.version).toBe(1);
});

it('applies only the compared local block intent and keeps remote additions and an untouched remote title', async () => {
  let calls = 0;
  props.onSave = vi.fn(async (document, title, base) => { if (!calls++) throw new Error('CONFLICT'); return { ...base, version: base.version + 1, document: structuredClone(document), text: title }; });
  await render(); await edit(); vi.useFakeTimers(); await change('本机要修改的段落'); await tick(650);
  const canonical = { ...elementValue('协作者修改的段落', 3), text: '协作者新标题' };
  canonical.document!.blocks[0]!.props.backgroundColor = 'red';
  canonical.document!.blocks.push({ id: 'remote-added', type: 'paragraph', props: {}, content: '协作者新增的未涉及段落', children: [] });
  props = { ...props, element: canonical }; await render(); await click('比较最新内容'); await click('保存已比较的草稿');
  expect(props.onSave).toHaveBeenCalledTimes(2);
  const saved = vi.mocked(props.onSave).mock.calls[1]!;
  expect(saved[0].blocks.map(block => block.id)).toEqual(['paragraph', 'remote-added']);
  expect(saved[0].blocks[0]!.props.backgroundColor).toBe('red');
  expect(documentPlainText(saved[0])).toContain('本机要修改的段落'); expect(documentPlainText(saved[0])).toContain('协作者新增的未涉及段落');
  expect(saved[1]).toBe('协作者新标题'); expect(saved[2].version).toBe(3); expect(saved[3]).toBe(true);
});

it('renders legal string table cells consistently with canonical text and full HTML export', () => {
  const value = normalizeDocument({ schemaVersion: 1, blocks: [{ id: 'table', type: 'table', props: {}, content: { type: 'tableContent', rows: [{ cells: ['字符串 A', [{ type: 'text', text: '片段 B', styles: { bold: true } }], { type: 'tableCell', props: {}, content: '对象 C' }] }] } }] });
  const read = renderToStaticMarkup(<DocumentReadView document={value} client={props.client} />), exported = documentHtml(value, '表格');
  for (const text of ['字符串 A', '片段 B', '对象 C']) { expect(documentPlainText(value)).toContain(text); expect(read).toContain(text); expect(exported).toContain(text); }
});

it('focuses inline reading and isolates document copy, paste and destructive keys without blocking canvas navigation', async () => {
  await render(); const scroll = host.querySelector<HTMLElement>('.studio-document-scroll')!;
  expect(document.activeElement).toBe(scroll);
  const keys = vi.fn(), copy = vi.fn(), cut = vi.fn(), paste = vi.fn();
  window.addEventListener('keydown', keys); window.addEventListener('copy', copy); window.addEventListener('cut', cut); window.addEventListener('paste', paste);
  try {
    for (const key of ['Delete', 'Backspace', '7', 'ArrowDown']) await act(async () => scroll.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    expect(keys).not.toHaveBeenCalled();
    const copied = new Event('copy', { bubbles: true, cancelable: true }), removed = new Event('cut', { bubbles: true, cancelable: true }), pasted = new Event('paste', { bubbles: true, cancelable: true });
    await act(async () => { scroll.dispatchEvent(copied); scroll.dispatchEvent(removed); scroll.dispatchEvent(pasted); });
    expect(copy).not.toHaveBeenCalled(); expect(cut).not.toHaveBeenCalled(); expect(paste).not.toHaveBeenCalled(); expect(copied.defaultPrevented).toBe(false); expect(removed.defaultPrevented).toBe(false); expect(pasted.defaultPrevented).toBe(false);
    await act(async () => scroll.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })));
    expect(keys).toHaveBeenCalledTimes(1);
  } finally { window.removeEventListener('keydown', keys); window.removeEventListener('copy', copy); window.removeEventListener('cut', cut); window.removeEventListener('paste', paste); }
});

it('exits editing before a vendor editor can swallow an otherwise unclaimed Escape', async () => {
  await render(); await edit(); const input = host.querySelector<HTMLElement>('[aria-label="测试块编辑器"]')!;
  const swallowed = vi.fn((event: Event) => { event.preventDefault(); event.stopPropagation(); });
  input.addEventListener('keydown', swallowed);
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(host.querySelector('[aria-label="测试块编辑器"]')).toBeNull();
  expect(swallowed).not.toHaveBeenCalled();
  expect(props.onInteract).toHaveBeenCalledWith(false);
});

it('lets the vendor dismiss its open menu before leaving editing', async () => {
  await render(); await edit(); const input = host.querySelector<HTMLElement>('[aria-label="测试块编辑器"]')!;
  const menu = window.document.createElement('div'); menu.setAttribute('role', 'listbox'); menu.textContent = '编辑器菜单'; host.querySelector('.studio-document-region')!.append(menu);
  const dismiss = vi.fn((event: Event) => { event.preventDefault(); event.stopPropagation(); menu.remove(); }); input.addEventListener('keydown', dismiss);
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(dismiss).toHaveBeenCalledTimes(1); expect(host.querySelector('[aria-label="测试块编辑器"]')).not.toBeNull();
});

it('keeps attempting the server save when the local draft cache is full', async () => {
  await render(); await edit(); vi.useFakeTimers();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
  await change('需要保存到服务的正文');
  expect(host.textContent).toContain('仍会尝试保存到白板');
  await tick(650);
  expect(props.onSave).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('已保存');
});

it('preserves an unreadable persisted draft instead of restoring an invalid document', async () => {
  const raw = JSON.stringify({ base: elementValue(), title: '旧草稿', document: { schemaVersion: 99, blocks: [] } });
  localStorage.setItem('studio-document-draft:owner:artifact-one:document-one', raw);
  await render();
  expect(host.textContent).toContain('未能读取上次的文档草稿');
  expect(storedDraft()).toBe(raw);
  expect([...host.querySelectorAll('button')].some(node => node.textContent === '恢复草稿')).toBe(false);
});

it('advances the successful baseline so the next autosave uses the confirmed version', async () => {
  await render(); await edit(); vi.useFakeTimers();
  await change('第一轮修改'); await tick(650);
  expect(props.onSave).toHaveBeenCalledTimes(1); expect(props.onSave).toHaveBeenNthCalledWith(1, documentValue('第一轮修改'), '方案说明', expect.objectContaining({ version: 1 }), false);
  expect(host.textContent).toContain('已保存');
  await change('第二轮修改'); await tick(650);
  expect(props.onSave).toHaveBeenNthCalledWith(2, documentValue('第二轮修改'), '方案说明', expect.objectContaining({ version: 2, document: documentValue('第一轮修改') }), false);
  expect(storedDraft()).toBeNull();
});

it('keeps a new edit made during an in-flight save and submits it against the resulting baseline', async () => {
  let acknowledge!: (element: BoardElement) => void;
  props.onSave = vi.fn().mockImplementationOnce(() => new Promise<BoardElement>(resolve => { acknowledge = resolve; })).mockImplementation(async (document, title, base) => ({ ...base, version: base.version + 1, document, text: title }));
  await render(); await edit(); vi.useFakeTimers();
  await change('提交中的版本'); await tick(650); await change('等待期间继续输入');
  await act(async () => acknowledge({ ...props.element, version: 2, document: documentValue('提交中的版本') }));
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="测试块编辑器"]')!.value).toBe('等待期间继续输入');
  await tick(650); expect(props.onSave).toHaveBeenCalledTimes(2);
  expect(props.onSave).toHaveBeenLastCalledWith(documentValue('等待期间继续输入'), '方案说明', expect.objectContaining({ version: 2 }), false);
});

it('shows newer canonical props after a delayed older save acknowledgement when no newer local edit exists', async () => {
  let acknowledge!: (element: BoardElement) => void;
  props.onSave = vi.fn(() => new Promise<BoardElement>(resolve => { acknowledge = resolve; }));
  await render(); await edit(); vi.useFakeTimers();
  await change('本机已提交的版本二'); await tick(650);
  expect(props.onSave).toHaveBeenCalledTimes(1);
  const delayedAck = { ...props.element, version: 2, document: documentValue('本机已提交的版本二') };
  props = { ...props, element: { ...elementValue('协作者已经保存的版本三', 3), text: '远端新标题' } };
  await render();
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="测试块编辑器"]')!.value).toBe('本机已提交的版本二');
  expect(props.onActivity).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: true, saving: true }));
  await act(async () => acknowledge(structuredClone(delayedAck)));
  await tick(1000); await click('阅读文档');
  expect(props.onSave).toHaveBeenCalledTimes(1);
  expect({ title: document.querySelector<HTMLInputElement>('[aria-label="文档标题"]')!.value, text: host.querySelector('.studio-doc-prose')!.textContent, saved: host.textContent?.includes('已保存') }).toEqual({ title: '远端新标题', text: '协作者已经保存的版本三', saved: true });
});

it('retains typing after newer canonical props arrive and keeps its confirmed base for the later conflict', async () => {
  let acknowledge!: (element: BoardElement) => void;
  props.onSave = vi.fn().mockImplementationOnce(() => new Promise<BoardElement>(resolve => { acknowledge = resolve; })).mockRejectedValueOnce(new Error('版本冲突，请比较最新内容'));
  await render(); await edit(); vi.useFakeTimers();
  await change('已经发出的版本二'); await tick(650);
  const delayedAck = { ...props.element, version: 2, document: documentValue('已经发出的版本二') };
  props = { ...props, element: elementValue('协作者的版本三', 3) }; await render();
  await change('回执之前继续输入的本机草稿');
  await act(async () => acknowledge(structuredClone(delayedAck)));
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="测试块编辑器"]')!.value).toBe('回执之前继续输入的本机草稿');
  await tick(650);
  expect(props.onSave).toHaveBeenCalledTimes(2);
  expect(props.onSave).toHaveBeenLastCalledWith(documentValue('回执之前继续输入的本机草稿'), '方案说明', expect.objectContaining({ version: 2, document: documentValue('已经发出的版本二') }), false);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('版本冲突');
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="测试块编辑器"]')!.value).toBe('回执之前继续输入的本机草稿');
  await click('比较最新内容'); const comparison = host.querySelector('[aria-label="比较文档草稿"]')!;
  expect(comparison.textContent).toContain('协作者的版本三'); expect(comparison.textContent).toContain('回执之前继续输入的本机草稿');
});

it('preserves failed text without an automatic retry loop and retries only when requested', async () => {
  props.onSave = vi.fn().mockRejectedValueOnce(new Error('网络中断')).mockImplementation(async (document, title, base) => ({ ...base, version: base.version + 1, document, text: title }));
  await render(); await edit(); vi.useFakeTimers();
  await change('必须保留的草稿'); await tick(650);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('网络中断'); expect(storedDraft()).toContain('必须保留的草稿');
  await tick(5000); expect(props.onSave).toHaveBeenCalledTimes(1);
  await click('重试保存'); expect(props.onSave).toHaveBeenCalledTimes(2); expect(host.querySelector('[role="alert"]')).toBeNull();
});

it('retains a stale local draft, displays both sides and uses the fresh version only after comparison', async () => {
  props.onSave = vi.fn().mockRejectedValueOnce(new Error('目标版本冲突')).mockImplementation(async (document, title, base) => ({ ...base, version: base.version + 1, document, text: title }));
  await render(); await edit(); vi.useFakeTimers(); await change('我的修改');
  props = { ...props, element: elementValue('他人已经保存的内容', 2) }; await render(); await tick(650);
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="测试块编辑器"]')!.value).toBe('我的修改');
  expect(props.onSave).toHaveBeenNthCalledWith(1, documentValue('我的修改'), '方案说明', expect.objectContaining({ version: 1 }), false);
  await click('比较最新内容'); const comparison = document.querySelector('[aria-label="比较文档草稿"]')!;
  expect(comparison.textContent).toContain('他人已经保存的内容'); expect(comparison.textContent).toContain('我的修改');
  await click('保存已比较的草稿'); expect(props.onSave).toHaveBeenLastCalledWith(documentValue('我的修改'), '方案说明', expect.objectContaining({ version: 2 }), true);
});

it('does not save a dirty document after the UI becomes read-only and retains it for explicit retry', async () => {
  await render(); await edit(); vi.useFakeTimers(); await change('权限改变前的草稿');
  props = { ...props, canEdit: false }; await render(); await tick(1000);
  expect(props.onSave).not.toHaveBeenCalled(); expect(storedDraft()).toContain('权限改变前的草稿'); expect(host.textContent).toContain('只读');
  props = { ...props, canEdit: true }; await render(); await tick(1000); expect(props.onSave).not.toHaveBeenCalled();
  await click('重试保存'); expect(props.onSave).toHaveBeenCalledTimes(1);
});

it('keeps a recovered draft across reopening until the user chooses recovery or discard', async () => {
  localStorage.setItem('studio-document-draft:owner:artifact-one:document-one', JSON.stringify({ base: props.element, document: documentValue('不能丢失的旧草稿'), title: '草稿标题' }));
  await render(); expect(host.textContent).toContain('有上次未保存');
  await act(async () => root.unmount()); root = createRoot(host);
  await render(); expect(host.textContent).toContain('有上次未保存');
  await click('恢复草稿');
  expect(document.querySelector<HTMLInputElement>('[aria-label="文档标题"]')!.value).toBe('草稿标题');
  expect(storedDraft()).toContain('不能丢失的旧草稿');
});

it('preserves reading position across expand and return and exposes real headings and text search', async () => {
  props.element = { ...props.element, document: { schemaVersion: 1, blocks: [{ id: 'heading', type: 'heading', props: { level: 2 }, content: '实施步骤', children: [] }, ...documentValue('保留的正文').blocks] } };
  await render(); const inline = host.querySelector<HTMLDivElement>('.studio-document-scroll')!;
  inline.scrollTop = 180; await act(async () => inline.dispatchEvent(new Event('scroll', { bubbles: true })));
  props = { ...props, expanded: true }; await render();
  expect(portal.querySelector<HTMLDivElement>('.studio-document-scroll')!.scrollTop).toBe(180);
  expect(portal.querySelector('[aria-label="文档目录"]')!.textContent).toContain('实施步骤');
  await change('正文', '文档内查找'); expect(portal.textContent).toContain('1 处'); expect(portal.querySelector('.is-find-match')!.textContent).toContain('正文');
  props = { ...props, expanded: false }; await render(); expect(host.querySelector<HTMLDivElement>('.studio-document-scroll')!.scrollTop).toBe(180);
  expect(props.onSave).not.toHaveBeenCalled();
});

it('renders a normal ordered list with consecutive numbers in reading mode', async () => {
  const list: DocumentContent = { schemaVersion: 1, blocks: ['第一项', '第二项'].map((text, index) => ({ id: `item-${index}`, type: 'numberedListItem', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })) };
  await act(async () => root.render(<DocumentReadView document={list} client={props.client} />));
  expect([...host.querySelectorAll('.studio-doc-list-item > span')].map(node => node.textContent)).toEqual(['1.', '2.']);
});

it('waits for a private image to become available and releases its subscription after resolution', async () => {
  let url: string | undefined; const listeners = new Set<() => void>(), removed = vi.fn();
  props.client = { ...props.client, baseUrl: 'http://studio.test', assetUrl: () => url, assetState: () => ({ status: 'loading' }), subscribeAssets: listener => { listeners.add(listener); return () => { listeners.delete(listener); removed(); }; } };
  await render(); await edit(); const previousRemoved = removed.mock.calls.length;
  await click('测试读取图片'); let settled = false; void imageRequests.values[0]!.then(() => { settled = true; });
  await act(async () => { await Promise.resolve(); }); expect(settled).toBe(false);
  url = 'blob:resolved-image'; await act(async () => { for (const listener of listeners) listener(); });
  await expect(imageRequests.values[0]).resolves.toBe(url); expect(removed).toHaveBeenCalledTimes(previousRemoved + 1); expect(listeners.size).toBe(0);
});

it('cancels a pending image when its document unmounts', async () => {
  const removed = vi.fn();
  props.client = { ...props.client, baseUrl: 'http://studio.test', assetUrl: () => undefined, subscribeAssets: () => removed };
  await render(); await edit(); await click('测试读取图片'); const previousRemoved = removed.mock.calls.length;
  await act(async () => root.unmount()); root = createRoot(host);
  await expect(imageRequests.values[0]).rejects.toThrow('取消'); expect(removed).toHaveBeenCalledTimes(previousRemoved + 1);
});

it('reports an already failed private image without waiting for an unrelated asset event', async () => {
  props.client = { ...props.client, baseUrl: 'http://studio.test', assetUrl: () => undefined, assetState: () => ({ status: 'error', message: '图片已被删除' }), subscribeAssets: () => () => {} };
  await render(); await edit(); await click('测试读取图片'); let outcome = 'pending';
  void imageRequests.values[0]!.then(() => { outcome = 'resolved'; }, cause => { outcome = cause.message; });
  await act(async () => { await Promise.resolve(); }); expect(outcome).toBe('图片已被删除');
});

it('uses Escape to dismiss a local export menu before leaving document editing', async () => {
  await render(); await edit(); await click('导出文档');
  expect(document.querySelector('[aria-label="文档导出格式"]')).toBeTruthy();
  await act(async () => button('导出文档').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(document.querySelector('[aria-label="文档导出格式"]')).toBeNull(); expect(document.querySelector('[aria-label="测试块编辑器"]')).toBeTruthy();
  await act(async () => button('阅读文档').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(document.querySelector('[aria-label="测试块编辑器"]')).toBeNull(); expect(props.onExit).not.toHaveBeenCalled();
});
