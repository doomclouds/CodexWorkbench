// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DocumentFocusSurface } from '../src/app/canvas/DocumentRegion.js';
import type { WhiteboardCanvasProps } from '../src/app/canvas/WhiteboardCanvas.js';
import { DEFAULT_STYLE, LOCAL_ACTOR, type Board } from '../src/contracts/studio.js';
const controller = vi.hoisted(() => ({ scrollBy: vi.fn(), setZoomAnchor: vi.fn(), click: vi.fn(), publish: null as null | ((surface: DocumentFocusSurface | null) => void) }));
vi.mock('../src/app/canvas/DocumentRegion.js', async () => {
  const React = await import('react');
  return { default: (props: { expanded: boolean; readingZoom: number; onFocusSurface: (surface: DocumentFocusSurface | null) => void }) => {
    controller.publish = props.onFocusSurface;
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

it('fits a focused document to standard reading scale and restores the original board viewport on exit', async () => {
  expect((query('全屏缩放比例') as HTMLInputElement).value).toBe('100');
  await click('全屏放大'); expect((query('全屏缩放比例') as HTMLInputElement).value).toBe('120');
  await click('适应全屏内容'); expect((query('全屏缩放比例') as HTMLInputElement).value).toBe('100');
  await click('退出全屏观看'); expect(world()).toBe('translate(17px,39px) scale(0.5)'); expect(props.onChanged).not.toHaveBeenCalled();
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
it('preserves native plain wheels and sends explicit zoom anchors to the document surface', async () => {
  const before = world(), target = query('文档内容按钮');
  const ordinary = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 50 });
  await act(async () => target.dispatchEvent(ordinary)); expect(ordinary.defaultPrevented).toBe(false); expect(world()).toBe(before);
  await act(async () => target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true, clientX: 330, clientY: 240 })));
  expect(controller.setZoomAnchor).toHaveBeenCalledWith({ x: 330, y: 240 }); expect(Number((query('全屏缩放比例') as HTMLInputElement).value)).toBeGreaterThan(100);
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
it('uses content origin, scale and clipping for ink while keeping the board coordinate cursor inside the original frame', async () => {
  await click('临时荧光笔');
  const marker = host.querySelector<HTMLElement>('.studio-reading-marker')!;
  expect(marker.style.clipPath).toBe('polygon(180px 90px, 1000px 90px, 1000px 590px, 180px 590px)');
  expect(marker.querySelector('g')!.getAttribute('transform')).toBe('translate(220 120) scale(1)');
  const before = world(); await act(async () => marker.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 70 }))); expect(controller.scrollBy).toHaveBeenCalledWith({ x: 0, y: 70 }); expect(world()).toBe(before);
  await pointer(query('文档内容按钮'), 'pointermove', 0, 590, 340); expect(props.onCursorMove).toHaveBeenLastCalledWith({ x: 400, y: 320 });
  expect(props.onChanged).not.toHaveBeenCalled();
});
