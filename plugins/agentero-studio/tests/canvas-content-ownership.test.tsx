// @vitest-environment jsdom
import { act, useState, type PointerEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_STYLE, LOCAL_ACTOR, type Anchor, type Board, type BoardElement, type Operation, type StudioClient, type ToolName } from '../src/contracts/studio.js';
import type { WhiteboardCanvasProps } from '../src/app/canvas/WhiteboardCanvas.js';

interface DocProps {
  element: BoardElement; interactive: boolean; annotationMode?: boolean; expanded: boolean; styleProfile?: unknown;
  onInteract(active: boolean): void; onMoveStart?: (event: PointerEvent) => void;
  onAnnotate(anchor: Anchor, version: number): void;
}
const documents = vi.hoisted(() => new Map<string, DocProps>());
vi.mock('../src/app/canvas/DocumentRegion.js', () => ({
  default: (props: DocProps) => {
    documents.set(props.element.id, props);
    return <div className="studio-document-region" data-document-id={props.element.id} data-native-interactive={props.interactive ? 'true' : undefined} onPointerDown={event => { if (props.interactive || (event.target as Element).closest('[data-document-controls]')) event.stopPropagation(); }} onDoubleClick={event => { event.stopPropagation(); props.onInteract(true); }}>
      <header data-document-controls="true"><button type="button" aria-label={`标题进入 ${props.element.id}`} onClick={() => props.onInteract(true)}>进入正文</button><button type="button" aria-label={`移动文档 ${props.element.id}`} data-native-interactive="true" onPointerDown={props.onMoveStart}>移动</button></header>
      <p data-document-body={props.element.id}>文档正文</p>
      {props.annotationMode && <button type="button" aria-label={`备注段落 ${props.element.id}`} onClick={() => props.onAnnotate({ coordinateSpace: 'document', elementIds: [props.element.id], blockIds: ['paragraph'], sourceVersion: props.element.version, quote: '文档正文' }, props.element.version)}>备注</button>}
    </div>;
  },
}));
import WhiteboardCanvas from '../src/app/canvas/WhiteboardCanvas.js';

const item = (id: string, type: BoardElement['type'] = 'document', x = 0, extra: Partial<BoardElement> = {}): BoardElement => ({ id, type, x, y: 0, w: type === 'shape' ? 150 : 600, h: type === 'shape' ? 100 : 400, version: 1, text: id, ...(type === 'document' ? { document: { schemaVersion: 1, blocks: [{ id: 'paragraph', type: 'paragraph', props: {}, content: '文档正文', children: [] }] } } : type === 'html' ? { html: '<button>HTML 正文</button>', sourceRevision: 1 } : {}), ...extra });
const initialView = { x: 14, y: 28, zoom: .5 };
let host: HTMLDivElement, root: Root, props: WhiteboardCanvasProps;
const query = (label: string) => host.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const world = () => host.querySelector<HTMLElement>('.studio-canvas-world')!.style.transform;
const selected = () => [...host.querySelectorAll('[data-element-id].is-selected')].map(element => element.getAttribute('data-element-id'));
async function pointer(target: Element, type: string, x = 100, y = 100, extra: MouseEventInit = {}) {
  await act(async () => { const event = new MouseEvent(type, { button: 0, bubbles: true, cancelable: true, clientX: x, clientY: y, ...extra }); Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event); });
}
async function click(label: string) { const target = query(label); await pointer(target, 'pointerdown'); await pointer(target, 'click'); }
async function selectElement(id: string) { const target = host.querySelector(`[data-element-id="${id}"]`)!; await pointer(target, 'pointerdown'); await pointer(query('白板画布'), 'pointerup'); }
async function key(value: string) { await act(async () => { query('白板画布').dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); }); }
async function mount(elements = [item('doc'), item('doc-two', 'document', 800), item('shape', 'shape', 1600)], extra: Partial<WhiteboardCanvasProps> = {}) {
  const board: Board = { artifact: { id: 'ownership', type: 'whiteboard', title: 'Ownership', revision: 1, createdAt: '', updatedAt: '', pinned: false }, elements, style: DEFAULT_STYLE };
  const call = vi.fn(async (_name: ToolName, args: Record<string, unknown> = {}) => ({ board: { ...board, artifact: { ...board.artifact, revision: 2 }, elements: board.elements.map(element => ({ ...element, ...(args.operations as Operation[]).find(operation => operation.id === element.id)?.changes })) } }));
  const client: StudioClient = { embedded: true, async call<T>(name: ToolName, args?: Record<string, unknown>) { return await call(name, args) as T; } };
  props = { board, client, actor: LOCAL_ACTOR, onChanged: vi.fn(), onAnnotate: vi.fn(), onAnnotateNative: vi.fn(), onAnnotationModeChange: vi.fn(), externalViewport: initialView, externalSelectedIds: [elements[0].id], ...extra };
  await render(); return call;
}
async function render(extra: Partial<WhiteboardCanvasProps> = {}) { props = { ...props, ...extra }; await act(async () => root.render(<WhiteboardCanvas {...props} />)); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); documents.clear(); localStorage.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000); vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(650);
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.releasePointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = () => false;
  host = document.createElement('div'); host.className = 'studio'; document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('releases Doc content on another selection and lets the first return click select its frame', async () => {
  const call = await mount(); await click('与文档内容交互'); expect(documents.get('doc')!.interactive).toBe(true);
  await selectElement('shape'); expect(selected()).toEqual(['shape']); expect(documents.get('doc')!.interactive).toBe(false);
  await pointer(host.querySelector('[data-document-body="doc"]')!, 'pointerdown'); await pointer(query('白板画布'), 'pointerup');
  expect(selected()).toEqual(['doc']); expect(documents.get('doc')!.interactive).toBe(false); expect(call).not.toHaveBeenCalled();
});

it('releases HTML without replacing its iframe and keeps its first return click in selection mode', async () => {
  const call = await mount([item('html', 'html'), item('shape', 'shape', 900)]), frame = host.querySelector('iframe')!;
  await click('与 HTML 内容交互'); expect(frame.style.pointerEvents).toBe('auto');
  await selectElement('shape'); expect(frame.style.pointerEvents).toBe('none');
  await selectElement('html'); expect(selected()).toEqual(['html']); expect(frame.style.pointerEvents).toBe('none');
  expect(host.querySelector('iframe')).toBe(frame); expect(call).not.toHaveBeenCalled();
});

it('selects a Doc when its own header enters content and closes it on blank or multi selection', async () => {
  await mount(undefined, { externalSelectedIds: ['shape'] });
  await click('标题进入 doc'); expect(selected()).toEqual(['doc']); expect(documents.get('doc')!.interactive).toBe(true);
  expect(documents.get('doc')!.styleProfile).toBe(DEFAULT_STYLE);
  await click('标题进入 doc-two'); expect(selected()).toEqual(['doc-two']); expect(documents.get('doc')!.interactive).toBe(false);
  await pointer(query('白板画布'), 'pointerdown', 950, 600); await pointer(query('白板画布'), 'pointerup', 950, 600);
  expect(selected()).toEqual([]); expect(documents.get('doc-two')!.interactive).toBe(false);
  await click('标题进入 doc'); await render({ externalSelectedIds: ['doc', 'shape'] });
  expect(documents.get('doc')!.interactive).toBe(false); expect(selected()).toEqual(['doc', 'shape']);
});

it('focuses paragraph comments in the board and restores the entry view only on explicit exit or Escape', async () => {
  await mount(); const before = world(); await click('聚焦备注');
  expect(host.querySelector('.is-reading')).toBeNull(); expect(documents.get('doc')!.annotationMode).toBe(true); expect(world()).not.toBe(before);
  await click('备注段落 doc'); expect(props.onAnnotateNative).toHaveBeenLastCalledWith(expect.objectContaining({ anchor: expect.objectContaining({ coordinateSpace: 'document', blockIds: ['paragraph'], sourceVersion: 1 }) }));
  await click('退出聚焦备注'); expect(world()).toBe(before); expect(selected()).toEqual(['doc']);
  await click('聚焦备注'); await key('Escape'); expect(world()).toBe(before); expect(documents.get('doc')!.annotationMode).toBe(false);
});

it('keeps mode notices inside the shared save stack and closes a zoom menu before leaving focused comments', async () => {
  await mount(); const before = world(), stack = host.querySelector('[aria-label="草稿与保存提示"]')!;
  await click('与文档内容交互'); expect(query('退出内容交互').closest('[aria-label="草稿与保存提示"]')).toBe(stack);
  await click('退出内容交互'); await click('聚焦备注'); const focused = world();
  expect(query('退出聚焦备注').closest('[aria-label="草稿与保存提示"]')).toBe(stack);
  await click('缩放菜单'); expect(host.querySelector('.studio-zoom-menu')).not.toBeNull();
  await key('Escape'); expect(host.querySelector('.studio-zoom-menu')).toBeNull(); expect(documents.get('doc')!.annotationMode).toBe(true); expect(world()).toBe(focused);
  await key('Escape'); expect(documents.get('doc')!.annotationMode).toBe(false); expect(world()).toBe(before);
});

it('honors a new selection or tool instead of restoring the old focus-note snapshot', async () => {
  await mount(); const before = world(); await click('聚焦备注'); const focused = world();
  await selectElement('shape'); expect(selected()).toEqual(['shape']); expect(world()).toBe(focused); expect(world()).not.toBe(before); expect(query('退出聚焦备注')).toBeNull();
  await render({ externalSelectedIds: ['doc'] }); await click('聚焦备注'); await render({ externalSelectedIds: ['doc', 'shape'] });
  expect(documents.get('doc')!.annotationMode).toBe(false); expect(selected()).toEqual(['doc', 'shape']);
  await render({ externalSelectedIds: ['doc'] }); await click('聚焦备注'); await click('平移');
  expect(query('退出聚焦备注')).toBeNull(); expect(host.querySelector('.studio-whiteboard')?.getAttribute('data-tool')).toBe('pan');
});

it('ends a focus-note pan before restoring and keeps ordinary object comments available', async () => {
  await mount(); const before = world(); await click('聚焦备注');
  await pointer(query('白板画布'), 'pointerdown', 100, 100, { button: 1 }); await pointer(query('白板画布'), 'pointermove', 180, 150, { button: 1 });
  await key('Escape'); await pointer(query('白板画布'), 'pointermove', 260, 220, { button: 1 }); expect(world()).toBe(before);
  await pointer(query('白板画布'), 'pointerup', 260, 220, { button: 1 }); await click('聚焦备注'); await click('备注所选元素');
  expect(props.onAnnotateNative).toHaveBeenLastCalledWith(expect.objectContaining({ anchor: expect.objectContaining({ coordinateSpace: 'element', elementIds: ['doc'] }) }));
  expect(documents.get('doc')!.annotationMode).toBe(false);
});

it.each([{ locked: true }, { readOnly: true }])('lets an explicit move handle select but does not change protected Doc geometry: %j', async protection => {
  const call = await mount([item('doc', 'document', 0, { locked: protection.locked }), item('shape', 'shape', 900)], { readOnly: protection.readOnly, externalSelectedIds: ['shape'] });
  await pointer(query('移动文档 doc'), 'pointerdown'); await pointer(query('白板画布'), 'pointermove', 180, 150); await pointer(query('白板画布'), 'pointerup', 180, 150);
  expect(selected()).toEqual(['doc']); expect(call).not.toHaveBeenCalled();
});

it('moves a Doc by its explicit handle, retaining the click threshold and body source', async () => {
  const call = await mount(); await click('与文档内容交互');
  await pointer(query('移动文档 doc'), 'pointerdown'); await pointer(query('白板画布'), 'pointerup', 103, 102); expect(call).not.toHaveBeenCalled();
  await pointer(query('移动文档 doc'), 'pointerdown'); await pointer(query('白板画布'), 'pointermove', 147, 131); await pointer(query('白板画布'), 'pointerup', 147, 131);
  expect(documents.get('doc')!.interactive).toBe(false);
  const operations = call.mock.calls[0][1]!.operations as Operation[]; expect(operations).toHaveLength(1); expect(operations[0]).toMatchObject({ op: 'update', id: 'doc' });
  expect(Object.keys(operations[0].changes!).sort()).toEqual(['x', 'y']); expect(operations[0].changes!.x).toBeGreaterThan(0);
});

it('treats a focus-note handle drag as a new movement intention without restoring or commenting', async () => {
  const call = await mount(); const before = world(); await click('聚焦备注'); const focused = world();
  await pointer(query('移动文档 doc'), 'pointerdown'); await pointer(query('白板画布'), 'pointermove', 147, 131); await pointer(query('白板画布'), 'pointerup', 147, 131);
  expect(documents.get('doc')!.annotationMode).toBe(false); expect(world()).toBe(focused); expect(world()).not.toBe(before);
  expect(call).toHaveBeenCalledOnce(); expect(props.onAnnotateNative).not.toHaveBeenCalled();
});

it('turns off parent-controlled board annotation before a header enters normal content', async () => {
  await mount();
  function Controlled() { const [annotation, setAnnotation] = useState(true); return <WhiteboardCanvas {...props} annotationActive={annotation} onAnnotationModeChange={setAnnotation} />; }
  await act(async () => root.render(<Controlled />));
  await click('标题进入 doc'); expect(documents.get('doc')!.interactive).toBe(true);
  await selectElement('shape'); expect(selected()).toEqual(['shape']); expect(props.onAnnotateNative).not.toHaveBeenCalled();
});

it('keeps owned comments and toolbar popovers inside the focus-note session', async () => {
  await mount(undefined, { activities: [{ id: 'comment', artifactId: 'ownership', type: 'comment', anchor: { elementIds: ['doc'], coordinateSpace: 'element', x: .5, y: .5 }, text: '所属备注', status: 'open', author: LOCAL_ACTOR, createdAt: '', updatedAt: '', replies: [] }], onFeedbackSelect: vi.fn() });
  await click('聚焦备注'); await click('填充颜色'); expect(documents.get('doc')!.annotationMode).toBe(true);
  const pin = host.querySelector<HTMLElement>('[data-feedback-pin="comment"]')!; await pointer(pin, 'pointerdown'); await pointer(pin, 'click');
  expect(props.onFeedbackSelect).toHaveBeenCalledOnce(); expect(documents.get('doc')!.annotationMode).toBe(true);
});

it('preserves all selected HTML interactions in multi-selection reading', async () => {
  await mount([item('one', 'html'), item('two', 'html', 800)], { externalSelectedIds: ['one', 'two'] });
  const frames = [...host.querySelectorAll('iframe')]; await click('全屏观看选区');
  expect(frames.map(frame => frame.style.pointerEvents)).toEqual(['auto', 'auto']);
  await click('退出全屏观看'); expect(frames.map(frame => frame.style.pointerEvents)).toEqual(['none', 'none']); expect([...host.querySelectorAll('iframe')]).toEqual(frames);
});
