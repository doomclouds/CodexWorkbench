// @vitest-environment jsdom
import { act, useState, type PointerEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_STYLE, LOCAL_ACTOR, type Anchor, type Board, type BoardElement, type Operation, type StudioClient, type ToolName } from '../src/contracts/studio.js';
import type { WhiteboardCanvasProps } from '../src/app/canvas/WhiteboardCanvas.js';
import type { DocumentFocusSurface } from '../src/app/canvas/DocumentRegion.js';

interface DocProps {
  element: BoardElement; interactive: boolean; annotationActive?: boolean; expanded: boolean; editRequest?: number; styleProfile?: unknown;
  onInteract(active: boolean): void; onEdit(): void; onExit(): void; onMoveStart?: (event: PointerEvent) => void;
  onFocusSurface(surface: DocumentFocusSurface | null): void;
  onAnnotate(anchor: Anchor, version: number): void;
}
const documents = vi.hoisted(() => new Map<string, DocProps>());
vi.mock('../src/app/canvas/DocumentRegion.js', () => ({
  default: (props: DocProps) => {
    documents.set(props.element.id, props);
    return <div className={`studio-document-region${props.expanded ? ' studio-document-focus' : ''}`} data-document-id={props.element.id} data-native-interactive={props.interactive ? 'true' : undefined} onPointerDown={event => { if (props.interactive || (event.target as Element).closest('[data-document-controls]')) event.stopPropagation(); }} onDoubleClick={event => { event.stopPropagation(); props.onEdit(); }}>
      <header data-document-controls="true"><button type="button" aria-label={`标题进入 ${props.element.id}`} onClick={() => props.onInteract(true)}>进入正文</button><button type="button" aria-label={`编辑正文 ${props.element.id}`} onClick={props.onEdit}>编辑</button><button type="button" aria-label={`移动文档 ${props.element.id}`} data-native-interactive="true" onPointerDown={props.onMoveStart}>移动</button>{props.expanded && <button type="button" aria-label={`返回画板 ${props.element.id}`} onClick={props.onExit}>返回</button>}</header>
      <div className="studio-document-scroll" data-document-content="true" onPointerDown={event => { event.stopPropagation(); if (!props.interactive) props.onInteract(true); }}>
        <p data-document-body={props.element.id}>文档正文</p>
        {props.annotationActive && <button type="button" aria-label={`备注段落 ${props.element.id}`} onClick={() => props.onAnnotate({ coordinateSpace: 'document', elementIds: [props.element.id], blockIds: ['paragraph'], sourceVersion: props.element.version, quote: '文档正文' }, props.element.version)}>备注</button>}
      </div>
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
async function key(value: string, target: Element = query('白板画布'), extra: KeyboardEventInit = {}) { const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra }); await act(async () => { target.dispatchEvent(event); }); return event; }
async function mount(elements = [item('doc'), item('doc-two', 'document', 800), item('shape', 'shape', 1600)], extra: Partial<WhiteboardCanvasProps> = {}) {
  let board: Board = { artifact: { id: 'ownership', type: 'whiteboard', title: 'Ownership', revision: 1, createdAt: '', updatedAt: '', pinned: false }, elements, style: DEFAULT_STYLE };
  const call = vi.fn(async (_name: ToolName, args: Record<string, unknown> = {}) => {
    const operations = args.operations as Operation[];
    board = { ...board, artifact: { ...board.artifact, revision: board.artifact.revision + 1 }, elements: [...board.elements.map(element => ({ ...element, ...operations.find(operation => operation.id === element.id)?.changes })), ...operations.filter(operation => operation.op === 'add').map(operation => operation.element as BoardElement)] };
    return { board };
  });
  const client: StudioClient = { embedded: true, async call<T>(name: ToolName, args?: Record<string, unknown>) { return await call(name, args) as T; } };
  props = { board, client, actor: LOCAL_ACTOR, onChanged: vi.fn(next => { props = { ...props, board: next }; root.render(<WhiteboardCanvas {...props} />); }), onAnnotate: vi.fn(), onAnnotateNative: vi.fn(), onAnnotationModeChange: vi.fn(), externalViewport: initialView, externalSelectedIds: elements[0] ? [elements[0].id] : [], ...extra };
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

it('lets a selected document be read without an extra interaction mode and releases it on another selection', async () => {
  const call = await mount();
  expect(query('与文档内容交互')).toBeNull(); expect(documents.get('doc')!.interactive).toBe(true);
  await selectElement('shape'); expect(selected()).toEqual(['shape']); expect(documents.get('doc')!.interactive).toBe(false);
  await pointer(host.querySelector('[data-document-body="doc"]')!, 'pointerdown'); await pointer(query('白板画布'), 'pointerup');
  expect(selected()).toEqual(['doc']); expect(documents.get('doc')!.interactive).toBe(true); expect(call).not.toHaveBeenCalled();
});

it('selects HTML with a canvas-owned first press and preserves its iframe as selection changes', async () => {
  const call = await mount([item('html', 'html'), item('shape', 'shape', 900)], { externalSelectedIds: [] }), frame = host.querySelector('iframe')!;
  expect(frame.style.pointerEvents).toBe('none'); expect(frame.tabIndex).toBe(-1);
  await selectElement('html');
  expect(query('白板画布').setPointerCapture).toHaveBeenCalledWith(1);
  expect(query('与 HTML 内容交互')).toBeNull();
  expect(frame.style.pointerEvents).toBe('auto'); expect(frame.tabIndex).toBe(0);
  await selectElement('shape'); expect(frame.style.pointerEvents).toBe('none');
  await selectElement('html'); expect(selected()).toEqual(['html']); expect(frame.style.pointerEvents).toBe('auto');
  await pointer(host.querySelector('.studio-html-move-edge')!, 'pointerdown');
  expect(frame.style.pointerEvents).toBe('none');
  await pointer(query('白板画布'), 'pointerup');
  expect(frame.style.pointerEvents).toBe('auto');
  await render({ externalSelectedIds: ['html', 'shape'] }); expect(frame.style.pointerEvents).toBe('none');
  expect(host.querySelector('iframe')).toBe(frame); expect(call).not.toHaveBeenCalled();
});

it('selects a document from its header and releases content on blank or multi selection', async () => {
  await mount(undefined, { externalSelectedIds: ['shape'] });
  await click('标题进入 doc'); expect(selected()).toEqual(['doc']); expect(documents.get('doc')!.interactive).toBe(true);
  expect(documents.get('doc')!.styleProfile).toBe(DEFAULT_STYLE);
  await click('标题进入 doc-two'); expect(selected()).toEqual(['doc-two']); expect(documents.get('doc')!.interactive).toBe(false);
  await pointer(query('白板画布'), 'pointerdown', 950, 600); await pointer(query('白板画布'), 'pointerup', 950, 600);
  expect(selected()).toEqual([]); expect(documents.get('doc-two')!.interactive).toBe(false);
  await click('标题进入 doc'); await render({ externalSelectedIds: ['doc', 'shape'] });
  expect(documents.get('doc')!.interactive).toBe(false); expect(selected()).toEqual(['doc', 'shape']);
});

it('routes the unified board comment tool to paragraph anchors without changing the viewport', async () => {
  await mount(); const before = world(); await render({ annotationActive: true });
  expect(query('聚焦备注')).toBeNull(); expect(documents.get('doc')!.annotationActive).toBe(true); expect(world()).toBe(before);
  await click('备注段落 doc');
  expect(props.onAnnotateNative).toHaveBeenCalledOnce();
  expect(props.onAnnotateNative).toHaveBeenLastCalledWith(expect.objectContaining({ anchor: expect.objectContaining({ coordinateSpace: 'document', blockIds: ['paragraph'], sourceVersion: 1 }) }));
});

it.each(['Enter', 'F2'])('routes canvas %s to expanded document editing without creating a native text edit', async value => {
  const reading = vi.fn(); await mount(undefined, { onReadingChange: reading });
  const before = world(); await key(value);
  expect(documents.get('doc')!.expanded).toBe(true); expect(documents.get('doc')!.editRequest).toBe(1);
  expect(host.querySelector('[data-element-id="doc"].is-editing')).toBeNull();
  expect(query('编辑文字')).toBeNull(); expect(query('全屏观看工具')).toBeNull();
  expect(reading).toHaveBeenCalledWith(true, 'document');
  await click('返回画板 doc'); expect(world()).toBe(before);
  expect(documents.get('doc')!.expanded).toBe(false); expect(reading).toHaveBeenLastCalledWith(false);
});

it('uses the same expanded editing request for the document header and supports repeated edit activation', async () => {
  await mount(); await click('编辑正文 doc');
  expect(documents.get('doc')!).toMatchObject({ expanded: true, editRequest: 1 });
  await click('编辑正文 doc'); expect(documents.get('doc')!.editRequest).toBe(2);
  await click('返回画板 doc'); expect(documents.get('doc')!.expanded).toBe(false);
});

it('places a document from the empty board entry and edits only after an explicit request', async () => {
  const call = await mount([]); const entry = [...host.querySelectorAll('button')].find(button => button.textContent === '添加文档')!;
  await pointer(entry, 'click');
  expect(call).not.toHaveBeenCalled(); expect(documents.size).toBe(0);
  await pointer(query('白板画布'), 'pointermove', 120, 140);
  expect(host.querySelector('[data-document-placement]')).not.toBeNull();
  await pointer(query('白板画布'), 'pointerdown', 120, 140);
  expect(documents.size).toBe(0); expect(call).not.toHaveBeenCalled();
  await pointer(query('白板画布'), 'pointerup', 120, 140);
  const document = [...documents.values()][0];
  expect(call).toHaveBeenCalledOnce(); expect(document).toMatchObject({ expanded: false, interactive: true, editRequest: undefined });
  expect(document.element).toMatchObject({ x: 212, y: 224, w: 680, h: 560 });
  expect(query('编辑文字')).toBeNull(); expect(host.querySelector('.studio-document-focus')).toBeNull();
  expect(selected()).toEqual([document.element.id]);
  await click(`编辑正文 ${document.element.id}`);
  expect(documents.get(document.element.id)).toMatchObject({ expanded: true, editRequest: 1 });
});

it('exits unified comments before leaving the expanded document', async () => {
  await mount();
  let setAnnotation: (active: boolean) => void;
  function Controlled() { const [annotation, update] = useState(false); setAnnotation = update; return <WhiteboardCanvas {...props} annotationActive={annotation} onAnnotationModeChange={update} />; }
  await act(async () => root.render(<Controlled />)); await key('Enter');
  await act(async () => setAnnotation(true)); expect(documents.get('doc')!.annotationActive).toBe(true);
  await key('Escape'); expect(documents.get('doc')!).toMatchObject({ expanded: true, annotationActive: false });
  await key('Escape'); expect(documents.get('doc')!.expanded).toBe(false);
});

it('waits for the document save guard before leaving from canvas Escape', async () => {
  await mount(); await key('Enter'); const prepareExit = vi.fn().mockResolvedValue(false);
  await act(async () => { documents.get('doc')!.onFocusSurface({ id: 'doc', scopeKey: 'doc:1', origin: { x: 0, y: 0 }, zoom: 1, clip: { x: 0, y: 0, w: 900, h: 500 }, baseWidth: 800, scrollBy: vi.fn(), setZoomAnchor: vi.fn(), prepareExit }); });
  await key('Escape'); expect(prepareExit).toHaveBeenCalledOnce(); expect(documents.get('doc')!.expanded).toBe(true);
  prepareExit.mockResolvedValue(true); await key('Escape'); expect(documents.get('doc')!.expanded).toBe(false);
});

it('releases selected document reading by deselecting it when the local reader exits', async () => {
  await mount(); await act(async () => { documents.get('doc')!.onInteract(false); });
  expect(selected()).toEqual([]); expect(documents.get('doc')!.interactive).toBe(false);
  expect(document.activeElement).toBe(query('白板画布'));
});

it('does not let document content shortcuts select, delete or move board objects', async () => {
  const call = await mount(); const content = host.querySelector('[data-document-body="doc"]')!;
  for (const [value, extra] of [['a', { ctrlKey: true }], ['z', { ctrlKey: true }], ['Delete', {}], ['ArrowRight', {}], ['3', { code: 'Digit3' }]] as const) await key(value, content, extra);
  expect(selected()).toEqual(['doc']); expect(call).not.toHaveBeenCalled();
  expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe('select');
});

it.each([{ ctrlKey: true }, { metaKey: true }])('keeps canvas zoom and fit shortcuts reachable from inline document reading: %j', async command => {
  const call = await mount(), content = host.querySelector('[data-document-body="doc"]')!;
  expect((await key('=', content, command)).defaultPrevented).toBe(true); expect(world()).toContain('scale(0.6)');
  expect((await key('-', content, command)).defaultPrevented).toBe(true); expect(world()).toContain('scale(0.5)');
  expect((await key('0', content, command)).defaultPrevented).toBe(true); expect(world()).toContain('scale(1)');
  expect((await key(')', content, { shiftKey: true, code: 'Digit0' })).defaultPrevented).toBe(true); expect(world()).toContain('scale(1)');
  expect((await key('!', content, { shiftKey: true, code: 'Digit1' })).defaultPrevented).toBe(true);
  const all = world(); expect(Number(/scale\(([^)]+)\)/.exec(all)![1])).toBeLessThan(1);
  expect((await key('@', content, { shiftKey: true, code: 'Digit2' })).defaultPrevented).toBe(true);
  expect(Number(/scale\(([^)]+)\)/.exec(world())![1])).toBeGreaterThan(1);
  expect(selected()).toEqual(['doc']); expect(call).not.toHaveBeenCalled();
  expect((await key(' ', content, { code: 'Space' })).defaultPrevented).toBe(false);
});

it('consumes expanded document zoom shortcuts across its fields while leaving printable keys and outside inputs intact', async () => {
  await mount(); await key('Enter'); const content = host.querySelector('[data-document-body="doc"]')!, before = world();
  for (const target of [content, query('白板画布')]) {
    for (const [value, extra] of [['=', { ctrlKey: true }], ['-', { metaKey: true }], ['0', { ctrlKey: true }], [')', { shiftKey: true, code: 'Digit0' }], ['!', { shiftKey: true, code: 'Digit1' }], ['@', { shiftKey: true, code: 'Digit2' }]] as const) {
      expect((await key(value, target, extra)).defaultPrevented).toBe(true); expect(world()).toBe(before);
    }
  }
  const input = document.createElement('input'); content.append(input);
  const editor = document.createElement('div'); editor.setAttribute('contenteditable', 'true'); content.append(editor);
  const outside = document.createElement('input'); document.body.append(outside);
  for (const target of [input, editor]) {
    expect((await key('=', target, { ctrlKey: true })).defaultPrevented).toBe(true);
    expect((await key('@', target, { shiftKey: true, code: 'Digit2' })).defaultPrevented).toBe(false);
    expect((await key('b', target, { ctrlKey: true })).defaultPrevented).toBe(false);
  }
  expect((await key('=', outside, { ctrlKey: true })).defaultPrevented).toBe(false);
  expect(world()).toBe(before); outside.remove();
});

it('leaves selected document wheel and scrollbar gestures with the document without moving the canvas', async () => {
  const call = await mount(), before = world(), content = host.querySelector('.studio-document-scroll')!;
  const inside = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 });
  await act(async () => { content.dispatchEvent(inside); });
  expect(inside.defaultPrevented).toBe(false); expect(world()).toBe(before);
  await pointer(content, 'pointerdown'); await pointer(query('白板画布'), 'pointermove', 150, 300); await pointer(query('白板画布'), 'pointerup', 150, 300);
  expect(world()).toBe(before); expect(call).not.toHaveBeenCalled();
  const outside = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 });
  await act(async () => { query('白板画布').dispatchEvent(outside); });
  expect(outside.defaultPrevented).toBe(true); expect(world()).not.toBe(before);
});

it.each([.5, 1, 2])('keeps all single-document resize hit areas outside the body at zoom %s', async zoom => {
  await mount([item('doc')], { externalViewport: { x: 0, y: 0, zoom } });
  const frame = host.querySelector<HTMLElement>('.studio-selection-frame')!, border = parseFloat(frame.style.borderWidth);
  expect(frame.classList.contains('has-outside-resize')).toBe(true);
  const edge = (side: string) => query(`调整元素大小 ${side}`);
  const north = edge('n'), east = edge('e'), south = edge('s'), west = edge('w');
  expect((parseFloat(north.style.top) + parseFloat(north.style.height) + border) * zoom).toBeLessThanOrEqual(0);
  expect((-parseFloat(east.style.right) - parseFloat(east.style.width) - border) * zoom).toBeGreaterThanOrEqual(0);
  expect((-parseFloat(south.style.bottom) - parseFloat(south.style.height) - border) * zoom).toBeGreaterThanOrEqual(0);
  expect((parseFloat(west.style.left) + parseFloat(west.style.width) + border) * zoom).toBeLessThanOrEqual(0);
  expect(parseFloat(east.style.width) * zoom).toBe(8); expect(parseFloat(north.style.height) * zoom).toBe(8);
  const corners = [...frame.querySelectorAll<HTMLButtonElement>('.studio-selection-corner')];
  expect(corners).toHaveLength(4); expect(corners.every(corner => parseFloat(corner.style.width) * zoom === 10)).toBe(true);
  expect(corners.map(corner => corner.style.transform)).toEqual(['translate(-100%,-100%)', 'translate(0%,-100%)', 'translate(0%,0%)', 'translate(-100%,0%)']);
});

it('keeps document edge resizing available outside the scroll surface', async () => {
  const call = await mount([item('doc')]);
  await pointer(query('调整元素大小 e'), 'pointerdown', 314, 128); await pointer(query('白板画布'), 'pointermove', 414, 128); await pointer(query('白板画布'), 'pointerup', 414, 128);
  const operations = call.mock.calls[0][1]!.operations as Operation[];
  expect(operations).toHaveLength(1); expect(operations[0]).toMatchObject({ op: 'update', id: 'doc' });
  expect(operations[0].changes!.w).toBeGreaterThan(600); expect(operations[0].changes).not.toHaveProperty('document');
});

it('preserves centered resize targets for other objects and document multi-selections', async () => {
  await mount([item('shape', 'shape'), item('doc')], { externalSelectedIds: ['shape'] });
  const centered = () => { expect(host.querySelector('.has-outside-resize')).toBeNull(); expect(query('调整元素大小 e').style.right).toBe('-8px'); };
  centered(); await render({ externalSelectedIds: ['shape', 'doc'] }); centered();
});

it('ignores shortcuts originating outside this canvas', async () => {
  const call = await mount(); const outside = document.createElement('button'); document.body.append(outside);
  await key('a', outside, { ctrlKey: true }); await key('Delete', outside);
  expect(selected()).toEqual(['doc']); expect(call).not.toHaveBeenCalled(); outside.remove();
});

it.each([{ locked: true }, { readOnly: true }])('lets an explicit move handle select but does not change protected document geometry: %j', async protection => {
  const call = await mount([item('doc', 'document', 0, { locked: protection.locked }), item('shape', 'shape', 900)], { readOnly: protection.readOnly, externalSelectedIds: ['shape'] });
  await pointer(query('移动文档 doc'), 'pointerdown'); await pointer(query('白板画布'), 'pointermove', 180, 150); await pointer(query('白板画布'), 'pointerup', 180, 150);
  expect(selected()).toEqual(['doc']); expect(call).not.toHaveBeenCalled();
});

it('moves a document after keyboard editing and exit, retaining the click threshold and body source', async () => {
  const call = await mount(); await key('Enter'); await click('返回画板 doc');
  await pointer(query('移动文档 doc'), 'pointerdown'); await pointer(query('白板画布'), 'pointerup', 103, 102); expect(call).not.toHaveBeenCalled();
  await pointer(query('移动文档 doc'), 'pointerdown'); await pointer(query('白板画布'), 'pointermove', 147, 131); await pointer(query('白板画布'), 'pointerup', 147, 131);
  const operations = call.mock.calls[0][1]!.operations as Operation[]; expect(operations).toHaveLength(1); expect(operations[0]).toMatchObject({ op: 'update', id: 'doc' });
  expect(Object.keys(operations[0].changes!).sort()).toEqual(['x', 'y']); expect(operations[0].changes!.x).toBeGreaterThan(0);
  expect(props.onAnnotateNative).not.toHaveBeenCalled();
});

it('preserves parent-controlled annotation while document content is selected', async () => {
  await mount();
  function Controlled() { const [annotation, setAnnotation] = useState(true); return <WhiteboardCanvas {...props} annotationActive={annotation} onAnnotationModeChange={setAnnotation} />; }
  await act(async () => root.render(<Controlled />));
  await click('标题进入 doc'); expect(documents.get('doc')!).toMatchObject({ interactive: true, annotationActive: true });
  await click('备注段落 doc'); expect(props.onAnnotateNative).toHaveBeenCalledOnce();
});

it('keeps ordinary whole-object comments alongside document paragraph comments', async () => {
  await mount(); await click('备注所选元素');
  expect(props.onAnnotateNative).toHaveBeenLastCalledWith(expect.objectContaining({ anchor: expect.objectContaining({ coordinateSpace: 'element', elementIds: ['doc'] }) }));
});

it('suspends selection actions while the view menu is open and restores them after it closes', async () => {
  await mount(); expect(query('选区格式')).not.toBeNull();
  await click('缩放菜单'); expect(query('缩放与视图')).not.toBeNull(); expect(query('选区格式')).toBeNull();
  await click('缩放菜单'); expect(query('缩放与视图')).toBeNull(); expect(query('选区格式')).not.toBeNull();
});

it('preserves all selected HTML interactions in multi-selection reading', async () => {
  await mount([item('one', 'html'), item('two', 'html', 800)], { externalSelectedIds: ['one', 'two'] });
  const frames = [...host.querySelectorAll('iframe')]; await click('全屏观看选区');
  expect(frames.map(frame => frame.style.pointerEvents)).toEqual(['auto', 'auto']);
  await click('退出全屏观看'); expect(frames.map(frame => frame.style.pointerEvents)).toEqual(['none', 'none']); expect([...host.querySelectorAll('iframe')]).toEqual(frames);
});
