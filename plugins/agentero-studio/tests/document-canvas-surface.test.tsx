// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DocumentFocusSurface } from '../src/app/canvas/DocumentRegion.js';
import type { WhiteboardCanvasProps } from '../src/app/canvas/WhiteboardCanvas.js';
import { DEFAULT_STYLE, LOCAL_ACTOR, type Board, type BoardElement } from '../src/contracts/studio.js';
import type { DocumentContent } from '../src/contracts/document.js';
import { NativeContentQueue } from '../src/app/canvas/content-queue.js';
type SaveDocument = (document: DocumentContent, title: string, base: BoardElement, overwrite?: boolean) => Promise<BoardElement | false>;
const controller = vi.hoisted(() => ({ scrollBy: vi.fn(), setZoomAnchor: vi.fn(), click: vi.fn(), publish: null as null | ((surface: DocumentFocusSurface | null) => void), save: null as SaveDocument | null }));
vi.mock('../src/app/canvas/DocumentRegion.js', async () => {
  const React = await import('react');
  return { default: (props: { expanded: boolean; readingZoom: number; onFocusSurface: (surface: DocumentFocusSurface | null) => void; onSave: SaveDocument }) => {
    controller.publish = props.onFocusSurface;
    controller.save = props.onSave;
    React.useEffect(() => { if (props.expanded) props.onFocusSurface({ id: 'doc', scopeKey: 'doc:1:820', origin: { x: 220, y: 120 }, clip: { x: 180, y: 90, w: 820, h: 500 }, zoom: props.readingZoom, baseWidth: 820, scrollBy: controller.scrollBy, setZoomAnchor: controller.setZoomAnchor }); return () => { if (props.expanded) props.onFocusSurface(null); }; }, [props.expanded, props.readingZoom]);
    return <div className={props.expanded ? 'studio-document-focus' : 'studio-document-region'} data-native-interactive="true"><button aria-label="文档内容按钮" onClick={controller.click}>content</button>{props.expanded && <input aria-label="文档内查找" />}<p>文档正文</p></div>;
  } };
});
import WhiteboardCanvas from '../src/app/canvas/WhiteboardCanvas.js';
let host: HTMLDivElement, root: Root, props: WhiteboardCanvasProps;
const original = { x: 17, y: 39, zoom: .5 };
const board: Board = { artifact: { id: 'board', type: 'whiteboard', title: 'Document surface', revision: 1, pinned: false, createdAt: '', updatedAt: '' }, style: DEFAULT_STYLE, elements: [{ id: 'doc', type: 'document', text: '方案', x: 100, y: 120, w: 600, h: 400, version: 1, document: { schemaVersion: 1, blocks: [] } }] };
const query = (label: string) => host.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const world = () => host.querySelector<HTMLElement>('.studio-canvas-world')!.style.transform;
async function pointer(target: Element, type: string, button: number, x: number, y: number) { await act(async () => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button, detail: type === 'click' ? 1 : 0, clientX: x, clientY: y }))); }
async function click(label: string) { await pointer(query(label), 'click', 0, 0, 0); }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000); vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(650);
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.releasePointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = () => false;
  controller.scrollBy.mockClear(); controller.setZoomAnchor.mockClear(); controller.click.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  props = { board, actor: LOCAL_ACTOR, client: { embedded: true, call: vi.fn() }, onChanged: vi.fn(), onAnnotate: vi.fn(), onCursorMove: vi.fn(), externalViewport: original, externalSelectedIds: ['doc'] };
  await act(async () => root.render(<WhiteboardCanvas {...props} />)); await click('全屏观看选区');
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('opens documents at standard reading scale without a second fullscreen toolbar and restores the board on Escape', async () => {
  expect(world()).toBe('translate(0px,0px) scale(1)');
  expect(query('全屏缩放比例')).toBeNull(); expect(query('全屏放大')).toBeNull(); expect(query('退出全屏观看')).toBeNull();
  await act(async () => query('白板画布').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(world()).toBe('translate(17px,39px) scale(0.5)'); expect(props.onChanged).not.toHaveBeenCalled();
});
it('routes middle and Space drag into actual document scrolling instead of moving the hidden board', async () => {
  const before = world(), target = query('文档内容按钮');
  await pointer(target, 'pointerdown', 1, 500, 300); await pointer(query('白板画布'), 'pointermove', 1, 460, 250); await pointer(query('白板画布'), 'pointerup', 1, 460, 250);
  expect(controller.scrollBy).toHaveBeenCalledWith({ x: 40, y: 50 }); expect(world()).toBe(before);
  await act(async () => query('白板画布').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })));
  await pointer(target, 'pointerdown', 0, 400, 300); await pointer(query('白板画布'), 'pointermove', 0, 390, 270); await pointer(query('白板画布'), 'pointerup', 0, 390, 270); await pointer(target, 'click', 0, 390, 270);
  expect(controller.scrollBy).toHaveBeenCalledWith({ x: 10, y: 30 }); expect(controller.click).not.toHaveBeenCalled(); expect(world()).toBe(before);
  await act(async () => query('白板画布').dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true })));
});
it('preserves native plain wheels and keeps document writing scale stable on pinch or modified wheel', async () => {
  const before = world(), target = query('文档内容按钮');
  const ordinary = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 50 });
  await act(async () => target.dispatchEvent(ordinary)); expect(ordinary.defaultPrevented).toBe(false); expect(world()).toBe(before);
  controller.setZoomAnchor.mockClear();
  const modified = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true, clientX: 330, clientY: 240 });
  await act(async () => target.dispatchEvent(modified));
  expect(modified.defaultPrevented).toBe(true); expect(controller.setZoomAnchor).not.toHaveBeenCalled(); expect(world()).toBe(before);
});
it('keeps the document native context menu while suppressing the board menu in blank reading space', async () => {
  const native = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  await act(async () => query('文档内容按钮').dispatchEvent(native));
  expect(native.defaultPrevented).toBe(false);
  const blank = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  await act(async () => query('白板画布').dispatchEvent(blank));
  expect(blank.defaultPrevented).toBe(true);
  expect(host.querySelector('.studio-canvas-context-menu')).toBeNull();
});
it('keeps document find reachable after viewing controls return keyboard focus to the viewport', async () => {
  query('白板画布').focus();
  const down = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
  await act(async () => query('白板画布').dispatchEvent(down));
  expect(down.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(query('文档内查找'));
});
it('omits the generic ink layer and maps document presence back inside its original board frame', async () => {
  expect(query('临时荧光笔')).toBeNull(); expect(host.querySelector('.studio-reading-marker')).toBeNull();
  const before = world();
  await pointer(query('文档内容按钮'), 'pointermove', 0, 590, 340); expect(props.onCursorMove).toHaveBeenLastCalledWith({ x: 400, y: 320 });
  expect(props.onChanged).not.toHaveBeenCalled();
});

it('keeps a later geometry task when replacing a failed document save and waits for its confirmation', async () => {
  let finishGeometry!: (receipt: { board: Board }) => void;
  const send = vi.fn(async (args: Record<string, unknown>) => {
    const operations = args.operations as { op: string }[];
    if (operations.some(operation => operation.op === 'document')) throw new Error('CONFLICT');
    return new Promise<{ board: Board }>(resolve => { finishGeometry = resolve; });
  });
  const queue = new NativeContentQueue({ send, changed: vi.fn(), accepted: vi.fn() });
  props = { ...props, contentQueue: queue }; await act(async () => root.render(<WhiteboardCanvas {...props} />));
  const draft: DocumentContent = { schemaVersion: 1, blocks: [{ id: 'paragraph', type: 'paragraph', props: {}, content: '本机正文', children: [] }] };
  let initial!: BoardElement | false;
  await act(async () => { initial = await controller.save!(draft, '方案', board.elements[0]!); });
  expect(initial).toBe(false);
  const failedId = queue.tasks[0]!.id;
  queue.setEnabled(false);
  await act(async () => { void queue.enqueue(board, [{ op: 'update', id: 'doc', changes: { x: 250 } }], '移动元素', board.elements, true, undefined, 'later-geometry'); });
  const canonical = { ...board.elements[0]!, version: 3 };
  let failure: unknown;
  await act(async () => { void controller.save!(draft, '方案', canonical, true).catch(cause => { failure = cause; }); await Promise.resolve(); });
  expect(queue.tasks.some(task => task.id === 'later-geometry')).toBe(true);
  expect(queue.tasks.some(task => task.id === failedId)).toBe(false);
  expect(String(failure)).toContain('未确认');
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => queue.setEnabled(true));
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1]![0].operations).toEqual([{ op: 'update', id: 'doc', changes: { x: 250 } }]);
  await act(async () => finishGeometry({ board: { ...board, artifact: { ...board.artifact, revision: 2 }, elements: [{ ...canonical, x: 250, version: 4 }] } }));
  expect(queue.tasks).toEqual([]);
});

it.each([{ x: 250 }, { text: '标题与样式', fill: '#ffffff' }])('does not mistake unrelated changes %j for a document save during comparison', async changes => {
  const send = vi.fn(async () => { throw new Error('geometry offline'); });
  const queue = new NativeContentQueue({ send, changed: vi.fn(), accepted: vi.fn() });
  await queue.enqueue(board, [{ op: 'update', id: 'doc', changes }], '编辑文档', board.elements, true, undefined, 'failed-geometry');
  queue.setEnabled(false);
  props = { ...props, contentQueue: queue }; await act(async () => root.render(<WhiteboardCanvas {...props} />));
  const draft: DocumentContent = { schemaVersion: 1, blocks: [{ id: 'paragraph', type: 'paragraph', props: {}, content: '正文', children: [] }] };
  let failure: unknown;
  await act(async () => { void controller.save!(draft, '方案', board.elements[0]!, true).catch(cause => { failure = cause; }); await Promise.resolve(); });
  expect(String(failure)).toContain('未确认');
  expect(queue.tasks.map(task => task.id)).toEqual(['failed-geometry']);
  expect(send).toHaveBeenCalledTimes(1);
});

it('recognizes a restored title-only document save without losing later queued geometry', async () => {
  const queue = new NativeContentQueue({ send: vi.fn(), changed: vi.fn(), accepted: vi.fn() });
  queue.setEnabled(false);
  queue.restore([{ id: 'restored-document-title', keys: ['doc'], before: structuredClone(board), sources: structuredClone(board.elements), operations: [{ op: 'update', id: 'doc', changes: { text: '上次的文档标题' } }], summary: '编辑文档', remember: true, state: 'failed' }]);
  void queue.enqueue(board, [{ op: 'update', id: 'doc', changes: { x: 300 } }], '移动元素', board.elements, true, undefined, 'restored-later-geometry');
  props = { ...props, contentQueue: queue }; await act(async () => root.render(<WhiteboardCanvas {...props} />));
  let failure: unknown;
  await act(async () => { void controller.save!({ schemaVersion: 1, blocks: [] }, '已比较的标题', { ...board.elements[0]!, version: 3 }, true).catch(cause => { failure = cause; }); await Promise.resolve(); });
  expect(String(failure)).toContain('未确认');
  expect(queue.tasks.map(task => task.id)).toEqual(['restored-later-geometry']);
  expect(queue.tasks[0]!.operations).toEqual([{ op: 'update', id: 'doc', changes: { x: 300 } }]);
});
