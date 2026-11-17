// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WhiteboardCanvas, { type NativeAnnotation, type WhiteboardCanvasProps } from '../src/app/canvas/WhiteboardCanvas.js';
import { anchorBounds, arrowGeometry, makeElement, relativeElementPoint } from '../src/app/canvas/canvas-model.js';
import { DEFAULT_STYLE, LOCAL_ACTOR, type Board, type BoardElement, type Feedback, type Json, type Operation, type Presence, type RoomMessage, type StudioClient, type ToolName } from '../src/contracts/studio.js';
import { encodeGestureFrame, NativeGestureReceiver } from '../src/app/shared/useNativeGestureSync.js';
import { StudioService } from '../src/core/service.js';
import { boardStickerMarkup, BOARD_STICKERS } from '../src/core/products/whiteboard-stickers.js';
import { buildBoardHtml, buildBoardSvg } from '../src/core/serialization.js';
import { CommentComposer } from '../src/app/shared/comments/CommentPopover.js';

let host: HTMLDivElement, root: Root;
const element = (id: string, extra: Partial<BoardElement> = {}): BoardElement => ({ id, type: 'shape', x: 100, y: 120, w: 200, h: 100, version: 1, text: 'A', ...extra });
const board = (elements: BoardElement[], revision = 1): Board => ({ artifact: { id: 'board', type: 'whiteboard', title: 'Board', revision, createdAt: '', updatedAt: '', pinned: false }, style: DEFAULT_STYLE, elements });
const initialViewport = { x: 0, y: 0, zoom: 1 };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  host = document.createElement('div'); host.className = 'studio'; document.body.append(host); root = createRoot(host);
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.releasePointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = () => false;
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function mount(elements: BoardElement[] = [], props: Partial<WhiteboardCanvasProps> = {}) {
  await act(async () => root.render(<WhiteboardCanvas board={board(elements)} client={{ embedded: true, call: vi.fn() }} actor={LOCAL_ACTOR} onChanged={() => {}} onAnnotate={() => {}} externalViewport={initialViewport} {...props} />));
}
async function editable(elements: BoardElement[] = [], props: Partial<WhiteboardCanvasProps> = {}) {
  let current = board(elements);
  const call = vi.fn(async (_name: string, args: { operations: Operation[] }) => {
    for (const operation of args.operations) {
      if (operation.op === 'add') current = { ...current, elements: [...current.elements, { ...operation.element, version: 1 } as BoardElement] };
      else if (operation.op === 'delete') current = { ...current, elements: current.elements.filter(item => item.id !== operation.id) };
      else if (operation.op === 'style') current = { ...current, style: { ...current.style, ...operation.style } as Board['style'] };
      else current = { ...current, elements: current.elements.map(item => item.id === operation.id ? { ...item, ...operation.changes, version: item.version + 1 } : item) };
    }
    current = { ...current, artifact: { ...current.artifact, revision: current.artifact.revision + 1 } };
    return { board: current };
  });
  function Harness() { const [value, setValue] = useState(current); return <WhiteboardCanvas board={value} client={{ embedded: true, call } as StudioClient} actor={LOCAL_ACTOR} onChanged={setValue} onAnnotate={() => {}} externalViewport={initialViewport} {...props} />; }
  await act(async () => root.render(<Harness />));
  return call;
}
const query = (label: string) => host.querySelector(`[aria-label="${label}"]`)!;
async function event(node: Element, name: string, x = 0, y = 0) { await act(async () => node.dispatchEvent(new MouseEvent(name, { bubbles: true, button: 0, clientX: x, clientY: y }))); }
async function click(label: string) { await event(query(label), 'click'); }

it.each(['resize', 'rotate'] as const)('keeps the final %s frame limited to actual operation targets on a multi-object board', async kind => {
  const values = [element('target', {type:'note'}), element('untouched', {x:1200,y:900})], original = board(values);
  const frames: Json[] = [], receiver = new NativeGestureReceiver(); let sequence = 0, release!: () => void, saved: Board | undefined;
  receiver.authority({type:'document',document:original});
  const pending = new Promise<void>(resolve => { release = resolve; });
  const room = { send: async (_topic: string, data: Json) => { frames.push(data); receiver.receive({peerId:'author-page',actor:LOCAL_ACTOR,seq:++sequence,topic:'gesture',data,createdAt:''}); return true; }, subscribe: () => () => {} };
  const call = vi.fn(async (_name: string, args: {operations:Operation[]}) => { await pending; saved = board(values.map(value => { const operation=args.operations.find(operation => operation.id===value.id); return operation ? {...value,...operation.changes,version:value.version+1} : value; }),2); return {board:saved}; });
  const shared = {client:{embedded:true,call} as StudioClient,room,selfPeerId:'author-page'};
  await mount(values,shared); await event(host.querySelector('[data-element-id="target"]')!,'pointerdown',120,140); await event(query('白板画布'),'pointerup',120,140);
  await event(query(kind==='resize'?'调整元素大小 se':'旋转所选元素 ne'),'pointerdown',300,120);
  await event(query('白板画布'),'pointermove',380,280);
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,60));});
  await event(query('白板画布'),'pointerup',390,290);
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,80));});
  const snapshots = frames.flatMap(frame => (frame as {atoms?:{element?:BoardElement}[]}).atoms?.flatMap(atom => atom.element ? [atom.element] : []) ?? []);
  expect(snapshots.length).toBeGreaterThan(0); expect([...new Set(snapshots.map(value=>value.id))]).toEqual(['target']);
  expect(receiver.read(original).flatMap(gesture=>gesture.elements.map(value=>value.id))).toEqual(['target']);
  await act(async()=>release()); expect(saved).toBeDefined();
  receiver.authority({type:'document',document:saved!}); await mount(saved!.elements,shared); expect(receiver.read(saved!)).toEqual([]);
  const deleted = board(saved!.elements.filter(value=>value.id!=='target'),3); await mount(deleted.elements,shared);
  receiver.authority({type:'document',document:deleted});
  expect(receiver.read(deleted)).toEqual([]);
});

it('shows one geometry activity for a peer target while retaining genuine editing on a different target', async () => {
  const values=[element('target',{type:'note'}),element('other',{x:1200,y:900})], remote={...LOCAL_ACTOR,id:'remote',name:'Resize author'};
  const listeners=new Map<string,Set<(message:RoomMessage)=>void>>(), room={send:async()=>true,subscribe:(topic:string,listener:(message:RoomMessage)=>void)=>{const group=listeners.get(topic)??new Set();group.add(listener);listeners.set(topic,group);return()=>{group.delete(listener);};}};
  const presence:Presence[]=[{peerId:'remote-page',actor:remote,updatedAt:new Date().toISOString(),context:{viewId:'remote-page',artifactId:'board',selectedIds:['target'],movingIds:['target'],editingIds:['other']}}];
  const client:StudioClient={embedded:true,call:vi.fn()}, shared={client,room,presence};
  await mount(values,shared);let sequence=0;
  const packets=encodeGestureFrame({id:'resize-operation',operationId:'resize-operation',kind:'resize',origin:'existing',baseRevision:1,elements:[{...values[0]!,w:350,h:180}]},1,()=>++sequence);
  await act(async()=>{for(const data of packets)for(const receive of listeners.get('gesture')??[])receive({peerId:'remote-page',actor:remote,seq:sequence++,topic:'gesture',data,createdAt:''});});
  expect([...host.querySelectorAll('span')].filter(node=>node.textContent==='Resize author · 正在调整')).toHaveLength(1);
  expect(host.querySelectorAll('[data-peer-state="moving"]')).toHaveLength(0);
  expect(host.querySelector('[data-peer-target="other"]')?.textContent).toContain('正在编辑');
  await act(async()=>root.render(<WhiteboardCanvas board={board([values[1]!],2)} actor={LOCAL_ACTOR} onChanged={()=>{}} onAnnotate={()=>{}} externalViewport={initialViewport} {...shared}/>));
  expect(host.textContent).not.toContain('Resize author · 正在调整'); expect(host.querySelector('[data-peer-target="other"]')?.textContent).toContain('正在编辑');
});

it('reports geometry instead of simultaneous content editing while resizing an open note editor', async () => {
  const activity=vi.fn(); await editable([],{onActivityChange:activity});
  await click('便签'); await event(query('白板画布'),'pointerdown',100,120); await event(query('白板画布'),'pointerup',100,120);
  const id=query('编辑文字').closest('[data-element-id]')!.getAttribute('data-element-id')!;
  await act(async()=>{query('编辑文字').textContent='still drafting';query('编辑文字').dispatchEvent(new InputEvent('input',{bubbles:true}));});
  await event(query('调整元素大小 se'),'pointerdown',308,304);await event(query('白板画布'),'pointermove',350,350);
  expect(activity.mock.lastCall?.[0]).toMatchObject({movingIds:[id],editingIds:[]});
  await event(query('白板画布'),'pointercancel');
  expect(activity.mock.lastCall?.[0]).toMatchObject({movingIds:[],editingIds:[id]});expect(query('编辑文字').textContent).toBe('still drafting');
});

it.each(['blank', 'other'] as const)('finishes an empty new text after formatting when clicking %s without requiring a second click', async target => {
  const call = await editable([element('other')]);
  await click('文字'); await event(query('白板画布'), 'pointerdown', 500, 300); await event(query('白板画布'), 'pointerup', 500, 300);
  const createdId = host.querySelector('[contenteditable="true"]')!.closest('[data-element-id]')!.getAttribute('data-element-id')!;
  const size = query('文字大小') as HTMLSelectElement;
  await act(async () => { size.focus(); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(size, '48'); size.dispatchEvent(new Event('change', { bubbles: true })); });
  await event(target === 'blank' ? query('白板画布') : host.querySelector('[data-element-id="other"]')!, 'pointerdown', 20, 20);
  await event(query('白板画布'), 'pointerup', 20, 20);
  await vi.waitFor(() => expect(host.querySelector(`[data-element-id="${createdId}"]`)).toBeNull());
  expect(host.querySelector('[contenteditable="true"]')).toBeNull();
  expect(host.querySelector('[data-element-id="other"]')?.classList.contains('is-selected')).toBe(target === 'other');
  expect(call.mock.calls.flatMap(([, args]) => args.operations).filter(operation => operation.op === 'delete').map(operation => operation.id)).toEqual([createdId]);
});

it.each(['text', 'linked-arrow'] as const)('offers an explicit cancel after %s locking blocks empty-text deletion and keeps other selection usable', async locked => {
  const call = await editable([element('locked-text', { type: 'text', text: 'authoritative original', locked: locked === 'text' }), element('other'), ...(locked === 'linked-arrow' ? [element('linked', { type:'arrow', from:'locked-text', to:'other', locked:true })] : [])]);
  await event(host.querySelector('[data-element-id="locked-text"]')!, 'dblclick');
  await act(async () => { query('编辑文字').textContent = ''; query('编辑文字').dispatchEvent(new InputEvent('input', { bubbles:true })); });
  await act(async () => query('编辑文字').dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true })));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('已锁定'); expect(query('编辑文字')).not.toBeNull();
  await click('取消本次文字编辑');
  expect(query('编辑文字')).toBeNull(); expect(host.querySelector('[data-element-id="locked-text"]')?.textContent).toContain('authoritative original');
  await event(host.querySelector('[data-element-id="other"]')!, 'pointerdown'); await event(query('白板画布'), 'pointerup');
  expect(host.querySelector('[data-element-id="other"]')?.classList.contains('is-selected')).toBe(true);
  expect(call).not.toHaveBeenCalled();
});
async function pointer(x: number, y: number, end = { x, y }) { await event(query('白板画布'), 'pointerdown', x, y); if (x !== end.x || y !== end.y) await event(query('白板画布'), 'pointermove', end.x, end.y); await event(query('白板画布'), 'pointerup', end.x, end.y); }
async function select(id: string) { await event(host.querySelector(`[data-element-id="${id}"]`)!, 'pointerdown'); await event(query('白板画布'), 'pointerup'); }
async function input(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => { if(node.getAttribute('contenteditable')!==null)node.textContent=value;else Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function key(node: Element, value: string, options: KeyboardEventInit = {}) { await act(async () => node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value, ...options }))); }

describe('whiteboard direct interaction', () => {
  it.each([0, 35])('keeps a clicked native target fully highlighted while the comment composer focuses at rotation %s', async rotation => {
    const target = element('clicked', { x: 100, y: 120, w: 130, h: 70, rotation });
    const annotate = vi.fn();
    function Harness() {
      const [annotation, setAnnotation] = useState<NativeAnnotation | null>(null);
      return <><WhiteboardCanvas board={board([target])} client={{ embedded: true, call: vi.fn() }} actor={LOCAL_ACTOR} onChanged={() => {}} onAnnotate={() => {}} externalViewport={initialViewport} annotationActive annotationTarget={annotation?.anchor} onAnnotateNative={value => { annotate(value); setAnnotation(value); }} />
        {annotation && <CommentComposer text="" attach={false} busy={false} saved={false} error="" onTextChange={() => {}} onAttachChange={() => {}} onSubmit={() => {}} />}</>;
    }
    await act(async () => root.render(<Harness />));
    await event(host.querySelector('[data-element-id="clicked"]')!, 'pointerdown', 165, 155);
    await event(query('白板画布'), 'pointerup', 165, 155);
    expect(document.activeElement).toBe(query('批注内容'));
    expect(host.querySelector('[data-annotation-hover]')).toBeNull();
    expect(annotate.mock.lastCall![0]).toMatchObject({ anchor: { coordinateSpace: 'element', elementIds: ['clicked'], x: .5, y: .5 }, screenPoint: { x: 165, y: 155 } });
    const outline = host.querySelector<HTMLElement>('[data-comment-target]')!;
    expect(outline.style.left).toBe('100px'); expect(outline.style.top).toBe('120px');
    expect(outline.style.width).toBe('130px'); expect(outline.style.height).toBe('70px');
    expect(outline.style.transform).toBe(rotation ? `rotate(${rotation}deg)` : '');
  });

  it('highlights the whole native multi-target while leaving board points small and HTML selections to the frame', async () => {
    const elements = [element('a'), element('b', { x: 400 }), element('html', { type: 'html', html: '<p>Hello</p>' })];
    await mount(elements, { annotationActive: true, annotationTarget: { coordinateSpace: 'board', elementIds: ['a', 'b'], x: 44, y: 55 } });
    let outline = host.querySelector<HTMLElement>('[data-comment-target]')!;
    expect(outline.style.left).toBe('100px'); expect(outline.style.width).toBe('500px'); expect(outline.style.height).toBe('100px');
    await mount(elements, { annotationActive: true, annotationTarget: { coordinateSpace: 'board', elementIds: [], x: 44, y: 55 } });
    outline = host.querySelector<HTMLElement>('[data-comment-target]')!;
    expect(outline.style.left).toBe('44px'); expect(outline.style.top).toBe('55px'); expect(outline.style.width).toBe('12px'); expect(outline.style.height).toBe('12px');
    await mount(elements, { annotationActive: true, annotationTarget: { coordinateSpace: 'html', regionId: 'html', targetIds: ['paragraph'], x: 4, y: 5, w: 50, h: 20 } });
    expect(host.querySelector('[data-comment-target]')).toBeNull();
  });

  it('previews native annotation hits without changing selection and clears them across lifecycle boundaries', async () => {
    const selection = vi.fn(), target = element('hover', { rotation: 35 });
    const props = { annotationActive: true, onSelectionChange: selection, externalViewport: { x: 10, y: 20, zoom: .5 } };
    await mount([target], props);
    const hit = () => host.querySelector('[data-annotation-hover="hover"]') as HTMLElement | null;
    await event(host.querySelector('[data-element-id="hover"]')!, 'pointermove', 150, 145);
    expect(hit()).not.toBeNull(); expect(hit()!.style.transform).toBe('rotate(35deg)'); expect(hit()!.style.borderWidth).toBe('4px');
    expect(host.querySelector('.studio-selection-frame')).toBeNull(); expect(selection.mock.lastCall?.[0] ?? []).toEqual([]);
    await event(query('白板画布'), 'pointerout'); expect(hit()).toBeNull();
    await event(host.querySelector('[data-element-id="hover"]')!, 'pointermove');
    await event(query('白板画布'), 'pointercancel'); expect(hit()).toBeNull();
    await event(host.querySelector('[data-element-id="hover"]')!, 'pointermove');
    await act(async () => { host.hidden = true; }); expect(hit()).toBeNull();
    await act(async () => { host.hidden = false; }); expect(hit()).toBeNull();
    await event(host.querySelector('[data-element-id="hover"]')!, 'pointermove');
    await mount([target], { ...props, annotationActive: false }); expect(hit()).toBeNull();
  });

  it('previews the actual annotation object on native text, hollow shapes, notes, table cells and arrows', async () => {
    const annotate = vi.fn();
    const values = [element('text', { type: 'text' }), element('shape', { kind: 'ellipse', hollow: true }), element('note', { type: 'note' }), element('table', { type: 'table', data: { rows: [['标题'], ['值']] } }), element('arrow', { type: 'arrow', from: [100, 120], to: [300, 120], label: '说明' })];
    await mount(values, { annotationActive: true, onAnnotateNative: annotate });
    const hit = () => host.querySelector('[data-annotation-hover]');
    for (const [id, child] of [['text', '.studio-element-text'], ['shape', '.studio-element-text'], ['note', '.studio-note-fill'], ['table', 'td'], ['arrow', '.studio-arrow-label'], ['arrow', 'path[pointer-events="stroke"]']] as const) {
      const target = host.querySelector(`[data-element-id="${id}"] ${child}`)!;
      await event(target, 'pointermove', 150, 145);
      expect(hit()?.getAttribute('data-annotation-hover')).toBe(id);
      if (id === 'arrow') expect(hit()?.localName).toBe('path');
      await event(target, 'pointerdown', 150, 145);
      await event(query('白板画布'), 'pointerup', 150, 145);
      expect(annotate.mock.lastCall?.[0].anchor).toMatchObject({ coordinateSpace: 'element', elementIds: [id] });
    }
    await event(query('白板画布'), 'pointermove', 500, 400);
    expect(hit()).toBeNull();
  });

  it('hands hover to the HTML iframe and document body without leaving a native object preview', async () => {
    const annotate = vi.fn();
    const values = [element('shape'), element('html', { type: 'html', html: '<p>A</p>' }), element('doc', { type: 'document' })];
    await mount(values, { annotationActive: true, onAnnotateNative: annotate });
    const shape = host.querySelector('[data-element-id="shape"]')!, iframe = host.querySelector('iframe')!;
    const hit = () => host.querySelector('[data-annotation-hover]');
    await event(shape, 'pointermove'); expect(hit()).not.toBeNull();
    await act(async () => shape.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: iframe })));
    expect(hit()).toBeNull();
    for (const selector of ['[data-document-content]', '[data-document-controls]']) {
      const target = host.querySelector(selector)!;
      await event(shape, 'pointermove'); expect(hit()).not.toBeNull();
      await event(target, 'pointermove'); expect(hit()).toBeNull();
      await event(target, 'pointerdown'); await event(query('白板画布'), 'pointerup');
      expect(annotate).not.toHaveBeenCalled();
    }
  });

  it('pins a quick comment inside the visible top-right corner of a huge element at the current zoom', async () => {
    const annotate = vi.fn();
    const target = element('huge', { x: -300, y: -200, w: 2000, h: 1500 });
    await mount([target], { onAnnotateNative: annotate, externalViewport: { x: 100, y: 50, zoom: .5 } });
    vi.spyOn(query('白板画布'), 'getBoundingClientRect').mockReturnValue({ left: 40, top: 60, right: 840, bottom: 660, width: 800, height: 600 } as DOMRect);
    await select('huge'); await click('备注所选元素');
    const annotation = annotate.mock.lastCall![0] as NativeAnnotation;
    expect(annotation.screenPoint).toEqual({ x: 824, y: 76 });
    expect(annotation.anchor.coordinateSpace).toBe('element'); expect(annotation.anchor.x).toBeCloseTo(.834); expect(annotation.anchor.y).toBeCloseTo(.088);
    const attached = anchorBounds(annotation.anchor, [target])!;
    expect(attached.x * .5 + 140).toBeCloseTo(824); expect(attached.y * .5 + 110).toBeCloseTo(76);
  });

  it('keeps quick-comment relative anchors consistent for rotated and multiple elements', async () => {
    const annotate = vi.fn(), target = element('turn', { rotation: 90 });
    await mount([target], { onAnnotateNative: annotate });
    vi.spyOn(query('白板画布'), 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 } as DOMRect);
    await select('turn'); await click('备注所选元素');
    let annotation = annotate.mock.lastCall![0] as NativeAnnotation;
    expect(annotation.screenPoint).toEqual({ x: 234, y: 86 });
    expect(anchorBounds(annotation.anchor, [target])).toMatchObject({ x: 234, y: 86 });
    await mount([element('a'), element('b', { x: 400 })], { onAnnotateNative: annotate, externalSelectedIds: ['a', 'b'] });
    await click('备注所选元素'); annotation = annotate.mock.lastCall![0] as NativeAnnotation;
    expect(annotation.screenPoint).toEqual({ x: 584, y: 136 });
    expect(anchorBounds(annotation.anchor, [element('a'), element('b', { x: 400 })])).toMatchObject({ x: 584, y: 136 });
  });
  it('closes the tool menu before changing the current tool or selection', async () => {
    const onSelectionChange = vi.fn(); await mount([element('a')], { onSelectionChange }); await select('a'); await click('形状');
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => query('白板画布').dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true); expect(host.querySelector('.studio-insert-menu')).toBeNull();
    expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe('shape');
    expect(onSelectionChange).toHaveBeenLastCalledWith(['a']);
    await key(query('白板画布'), 'Escape'); expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe('select');
    expect(onSelectionChange).toHaveBeenLastCalledWith(['a']);
    await key(query('白板画布'), 'Escape'); expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });
  it('only lets the visible preview respond while the live canvas remains mounted under hidden', async () => {
    const live = vi.fn(), preview = vi.fn();
    const common = { board: board([]), client: { embedded: true, call: vi.fn() }, actor: LOCAL_ACTOR, onChanged: vi.fn(), onAnnotate: vi.fn(), annotationActive: true };
    await act(async () => root.render(<><div hidden><WhiteboardCanvas {...common} onAnnotationModeChange={live} /></div><WhiteboardCanvas {...common} onAnnotationModeChange={preview} /></>));
    await key(host.querySelectorAll('.studio-canvas-viewport')[1]!, 'Escape');
    expect(preview).toHaveBeenCalledWith(false); expect(live).not.toHaveBeenCalled();
  });
  it('hides all of this identity’s cursors across refreshes and shows one current cursor per other member', async () => {
    const now = Date.now(), other = { ...LOCAL_ACTOR, id: 'other-member', name: '协作者' };
    const peers: NonNullable<WhiteboardCanvasProps['presence']> = [
      { peerId: 'old-self', actor: LOCAL_ACTOR, cursor: { x: 10, y: 20 }, updatedAt: new Date(now - 2000).toISOString() },
      { peerId: 'current-self', actor: LOCAL_ACTOR, cursor: { x: 30, y: 40 }, updatedAt: new Date(now).toISOString() },
      { peerId: 'old-other', actor: other, cursor: { x: 50, y: 60 }, updatedAt: new Date(now - 1000).toISOString() },
      { peerId: 'current-other', actor: other, cursor: { x: 70, y: 80 }, updatedAt: new Date(now).toISOString() },
      { peerId: 'expired', actor: { ...other, id: 'expired' }, cursor: { x: 90, y: 100 }, updatedAt: new Date(now - 15 * 60_000 - 1).toISOString() },
    ];
    for (const selfPeerId of ['current-self', 'refreshed-self', 'refreshed-again']) {
      await mount([], { presence: peers, selfPeerId });
      const cursors = host.querySelectorAll<HTMLElement>('.studio-remote-cursor');
      expect(cursors).toHaveLength(1); expect(cursors[0]!.querySelector('span')!.textContent).toBe('协作者');
      expect(cursors[0]!.style.left).toBe('70px'); expect(cursors[0]!.style.top).toBe('80px');
    }
  });
  it('keeps exactly eight main tools in the approved order and collects lower-frequency insertion', async () => {
    await mount();
    expect([...query('白板工具').querySelectorAll('button')].map(button => button.getAttribute('aria-label'))).toEqual(['选择', '平移', '文字', '分区', '便签', '画笔', '形状', '贴纸']);
    expect(query('元素属性')).toBeNull();
    await click('形状');
    expect(host.querySelector('.studio-insert-menu')!.textContent).toContain('HTML 图解');
    expect(host.querySelector('.studio-insert-menu')!.textContent).toContain('表格');
    await click('贴纸');
    expect(query('搜索贴纸')).not.toBeNull();
    expect(host.querySelector('.studio-media-upload')!.textContent).toContain('上传图片或视频');
  });
  it('hides the selected element chrome during other tools and temporary pan without forgetting selection', async () => {
    const onSelectionChange = vi.fn(); await editable([element('a')], { onSelectionChange }); await select('a');
    await click('文字颜色'); expect(host.querySelector('.studio-format-popover')).not.toBeNull();
    await click('平移'); expect(query('选区格式')).toBeNull();
    expect(onSelectionChange).toHaveBeenLastCalledWith(['a']);
    await pointer(500, 400); expect(onSelectionChange).toHaveBeenLastCalledWith(['a']);
    await key(query('白板画布'), '1'); expect(query('选区格式')).not.toBeNull();
    expect(host.querySelector('.studio-format-popover')).toBeNull();
    await key(query('白板画布'), ' ', { code: 'Space' }); expect(query('选区格式')).toBeNull(); expect(host.querySelector('.studio-selection-frame')).toBeNull();
    await act(async () => query('白板画布').dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ', code: 'Space' })));
    expect(query('选区格式')).not.toBeNull(); expect(onSelectionChange).toHaveBeenLastCalledWith(['a']);
  });
  it('closes format popovers on an outside pointer without changing selection or saved content', async () => {
    const call = await editable([element('a')]); await select('a'); await click('文字颜色');
    const outside = document.createElement('button'); document.body.append(outside);
    try { await event(outside, 'pointerdown'); expect(host.querySelector('.studio-format-popover')).toBeNull(); }
    finally { outside.remove(); }
    expect(query('选区格式')).not.toBeNull(); expect(call).not.toHaveBeenCalled();
  });
  it('switches fixed numeric tools and global annotation without opening an insertion menu', async () => {
    await editable();
    for (const [digit, expected] of [['1','select'],['2','pan'],['3','text'],['4','container'],['5','note'],['6','stroke'],['7','shape'],['8','sticker'],['9','annotate']]) {
      await key(query('白板画布'), digit);
      expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe(expected);
      expect(host.querySelector('.studio-insert-menu')).toBeNull();
    }
    await key(query('白板画布'), '9'); expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe('annotate');
    expect(query('选择').getAttribute('title')).toBe('选择（1）');
    await key(query('白板画布'), '2', { code: 'Numpad2' }); expect(query('平移').getAttribute('aria-pressed')).toBe('true');
    await click('画笔'); expect(query('箭头模式').getAttribute('title')).not.toContain('9');
    await key(query('白板画布'), '9'); expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe('annotate');
    await key(query('白板画布'), 'Escape'); expect(query('选择').getAttribute('aria-pressed')).toBe('true');
    await key(query('白板画布'), '1');
    for (const value of ['v','h','t','a','s','p','r','e','n','f','l','x','m','o','d']) await key(query('白板画布'), value);
    await key(query('白板画布'), 'T', { shiftKey: true });
    expect(query('选择').getAttribute('aria-pressed')).toBe('true');
  });
  it('keeps numeric tool keys out of inputs, composition, modifiers, menus and other pages', async () => {
    await editable([element('a')]);
    const numeric = async (target: Element, options: KeyboardEventInit = {}) => { await key(target, '3', options); expect(query('选择').getAttribute('aria-pressed')).toBe('true'); };
    for (const options of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }]) await numeric(query('白板画布'), options);
    for (const tag of ['input', 'textarea', 'select', 'div']) {
      const input = document.createElement(tag); if (tag === 'div') input.setAttribute('contenteditable', 'true');
      query('白板画布').append(input); try { await numeric(input); } finally { input.remove(); }
    }
    const outside = document.createElement('button'); document.body.append(outside);
    try { await numeric(outside); } finally { outside.remove(); }
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await numeric(query('白板画布')); visibility.mockRestore();
    await select('a'); await click('文字颜色'); await numeric(query('白板画布'));
    await key(query('白板画布'), 'Escape'); await click('形状');
    const before = host.querySelector('.studio-whiteboard')!.getAttribute('data-tool');
    await key(query('白板画布'), '2'); expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe(before);
  });
  it('leaves HTML interaction before switching from a toolbar button and does not steal its numeric input', async () => {
    await editable([element('html', { type: 'html', html: '<p>Hello</p>' })]); await select('html'); await click('与 HTML 内容交互');
    expect(host.querySelector<HTMLIFrameElement>('iframe')!.style.pointerEvents).toBe('auto');
    await key(host.querySelector('iframe')!, '2'); expect(query('选择').getAttribute('aria-pressed')).toBe('true');
    await click('平移'); expect(host.querySelector<HTMLIFrameElement>('iframe')!.style.pointerEvents).toBe('none'); expect(query('选区格式')).toBeNull();
    await key(query('白板画布'), '1'); expect(query('选区格式')).not.toBeNull();
  });
  it.each(['Enter', 'F2'])('starts the selected native element editor with %s without consuming typed digits', async editKey => {
    await editable([element('a', { locked: true })]); await select('a'); await key(query('白板画布'), editKey);
    expect(query('编辑文字')).not.toBeNull(); await input(query('编辑文字') as HTMLTextAreaElement, '123456789');
    await key(query('编辑文字'), '2'); expect(query('选择').getAttribute('aria-pressed')).toBe('true');
    expect(query('编辑文字').textContent).toBe('123456789');
  });
  it('routes keyboard editing to the existing HTML source and table cell editors', async () => {
    const onEditHtml = vi.fn(); await editable([element('html', { type: 'html', html: '<p>Hello</p>' }), element('table', { type: 'table', data: { rows: [['header'],['value']] } })], { onEditHtml });
    await select('html'); await key(query('白板画布'), 'F2'); expect(onEditHtml).toHaveBeenCalledWith(expect.objectContaining({ id: 'html' }));
    await select('table'); await key(query('白板画布'), 'Enter'); expect(query('表格第1行第1列')).not.toBeNull();
  });
  it('keeps table actions in screen space above the bottom dock and retains cell drafts when using them', async () => {
    const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left+width, bottom: top+height, x:left, y:top, toJSON:()=>({}) }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if(this.classList.contains('studio-native-table'))return rect(750,720,350,160);
      if(this.classList.contains('studio-table-controls'))return rect(750,886,240,34);
      if(this.classList.contains('studio-canvas-toolbar'))return rect(600,900,600,60);
      if(this.classList.contains('studio-selection-toolbar'))return rect(400,662,650,42);
      return rect(0,0,1400,1000);
    });
    const call = await editable([element('table', { type:'table',data:{rows:[['Header'],['Value']]} })], { externalViewport:{x:0,y:0,zoom:.48} });
    await select('table');
    const controls = query('表格操作') as HTMLElement;
    expect(controls.parentElement).toBe(host.querySelector('.studio-whiteboard'));
    expect(controls.closest('.studio-canvas-world')).toBeNull(); expect(controls.style.top).toBe('620px');
    expect(Number.parseFloat((query('调整第1列宽度') as HTMLElement).style.width)*.48).toBeCloseTo(8);
    await event(host.querySelector('[data-cell="1:0"]')!, 'dblclick'); await input(query('表格第2行第1列') as HTMLTextAreaElement,'QA cell 123456789');
    await event(query('添加表格行'),'pointerdown'); await click('添加表格行');
    expect(call.mock.lastCall![1].operations[0]!.changes?.data?.rows).toEqual([['Header'],['QA cell 123456789'],['']]);
  });
  it('preserves a failed inline draft when a toolbar switch cannot save it', async () => {
    const call = await editable([element('a')]); await select('a'); await key(query('白板画布'), 'Enter');
    await input(query('编辑文字') as HTMLTextAreaElement, 'Keep this unsaved draft'); call.mockRejectedValueOnce(new Error('Save unavailable'));
    await click('平移'); expect(query('选择').getAttribute('aria-pressed')).toBe('true');
    expect(query('编辑文字').textContent).toBe('Keep this unsaved draft'); expect(host.querySelector('[role="alert"]')!.textContent).toContain('Save unavailable');
  });
  it('redraws only resolved media URLs after background asset notifications and shows loading or errors', async () => {
    const callbacks = new Set<() => void>(), reference = '/assets/board/photo.png';
    let status: 'loading' | 'ready' | 'error' = 'loading';
    const client: StudioClient = { embedded: true, baseUrl: 'http://studio.test', call: vi.fn(), assetUrl: () => status === 'ready' ? 'blob:resolved-photo' : undefined, assetState: () => ({ status, ...(status === 'error' ? { message: 'Media transfer failed' } : {}) }), subscribeAssets: listener => { callbacks.add(listener); return () => callbacks.delete(listener); } };
    await mount([element('image', { type: 'image', src: reference })], { client });
    expect(host.textContent).toContain('正在加载媒体'); expect(host.querySelector('img')).toBeNull(); expect(callbacks.size).toBe(1);
    status = 'ready'; await act(async () => callbacks.forEach(listener => listener()));
    expect(host.querySelector('img')!.getAttribute('src')).toBe('blob:resolved-photo'); expect(host.textContent).not.toContain('正在加载媒体');
    status = 'error'; await act(async () => callbacks.forEach(listener => listener()));
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('Media transfer failed'); expect(host.querySelector('img')).toBeNull();
    await act(async () => root.unmount()); expect(callbacks.size).toBe(0); root = createRoot(host);
  });
  it.each(['文字', '便签'])('creates %s by a click, enters inline input, saves Escape with the returned version and returns to select', async label => {
    const call = await editable();
    await click(label); await pointer(320, 250);
    expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe('select');
    const editor = query('编辑文字') as HTMLTextAreaElement;
    expect(editor).not.toBeNull();
    expect(editor.closest('.studio-board-element')?.classList.contains('is-editing')).toBe(true);
    await input(editor, 'Created locally'); await key(editor, 'Escape');
    expect(call).toHaveBeenCalledTimes(2);
    const id = call.mock.calls[0]![1].operations[0]!.id!;
    expect((call.mock.calls[1]![1] as unknown as { expectedVersions: Record<string, number> }).expectedVersions).toEqual({ [id]: 1 });
    expect(query('编辑文字')).toBeNull();
    expect(host.querySelector('.studio-board-element.is-editing')).toBeNull();
    expect(host.querySelector(`[data-element-id="${id}"]`)!.textContent).toContain('Created locally');
  });
  it('uses dragged dimensions, creates blank-space text by double click and cancels an unfinished gesture with Escape', async () => {
    const call = await editable(); await click('形状'); await pointer(400, 300, { x: 180, y: 160 });
    expect(call.mock.calls[0]![1].operations[0]!.element).toMatchObject({ x: 180, y: 160, w: 220, h: 140 });
    await event(query('白板画布'), 'dblclick', 600, 400);
    expect(call.mock.calls[1]![1].operations[0]!.element).toMatchObject({ type: 'text', x: 600, y: 400, text: '' });
    await key(query('编辑文字'), 'Escape'); await click('便签');
    await event(query('白板画布'), 'pointerdown', 20, 30); await key(query('白板画布'), 'Escape'); await event(query('白板画布'), 'pointerup', 90, 90);
    expect(call).toHaveBeenCalledTimes(3);
    expect(call.mock.calls[2]![1].operations[0]).toMatchObject({ op: 'delete' });
  });
  it('creates sections with the white fill selected and keeps palette changes in the saved element', async () => {
    const call = await editable();
    await click('分区'); await pointer(100, 100, { x: 500, y: 350 });
    expect(call.mock.calls[0]![1].operations[0]!.element).toMatchObject({ type: 'container', fill: '#EFEFEF', w: 400, h: 250 });
    const created = call.mock.calls[0]![1].operations[0]!.element as BoardElement;
    const exported = new DOMParser().parseFromString(buildBoardSvg(board([created])), 'image/svg+xml');
    expect(exported.querySelector(`[data-studio-id="${created.id}"] rect`)?.getAttribute('fill')).toBe('#EFEFEF');
    expect(query('编辑文字')).toBeNull(); await click('填充颜色');
    expect(query('填充 白色').getAttribute('aria-pressed')).toBe('true');
    await click('填充 蓝色');
    expect(call.mock.lastCall![1].operations[0]!.changes).toMatchObject({ fill: '#9DC8F7' });
    expect(query('填充 白色').getAttribute('aria-pressed')).toBe('false');
    expect(query('填充 蓝色').getAttribute('aria-pressed')).toBe('true');
  });
  it('keeps section border choices selected and makes solid, dashed and hidden borders match the saved style', async () => {
    await editable([element('section', { type: 'container', fill: '#EFEFEF', stroke: '#9ca3af' })]);
    await select('section'); await click('边框与线条');
    const choice = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('.studio-format-row button')].find(button => button.textContent === text)!;
    const section = () => host.querySelector<HTMLElement>('[data-element-id="section"]')!;
    expect(choice('实线').getAttribute('aria-pressed')).toBe('true');
    expect(section().style.borderStyle).toBe('solid');
    await event(choice('无边框'), 'click');
    expect(choice('无边框').getAttribute('aria-pressed')).toBe('true');
    expect(section().style.borderColor).toBe('rgba(0, 0, 0, 0)');
    await event(choice('虚线'), 'click');
    expect(choice('虚线').getAttribute('aria-pressed')).toBe('true');
    expect(section().style.borderStyle).toBe('dashed'); expect(section().style.borderColor).not.toBe('rgba(0, 0, 0, 0)');
    await input(query('线条宽度') as HTMLInputElement, '3');
    expect(section().style.borderWidth).toBe('3px');
    await event(choice('实线'), 'click');
    expect(choice('实线').getAttribute('aria-pressed')).toBe('true'); expect(choice('虚线').getAttribute('aria-pressed')).toBe('false');
    expect(section().style.borderStyle).toBe('solid'); expect(section().style.borderWidth).toBe('3px');
  });
  it('returns to select after each successful pen, arrow and sticker placement', async () => {
    const call = await editable(); await click('画笔'); await pointer(50, 80, { x: 160, y: 180 });
    expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe('select');
    await click('画笔'); await click('箭头模式'); await pointer(200, 200, { x: 300, y: 300 });
    expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe('select');
    await click('贴纸'); await click('贴纸 想法'); await pointer(500, 300); await pointer(600, 300);
    expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe('select');
    expect(call.mock.calls.map(([, args]) => args.operations[0]!.element?.type)).toEqual(['stroke', 'arrow', 'sticker']);
    expect(call.mock.calls[2]![1].operations[0]!.element).toMatchObject({ text: '想法', data: { stickerIconId: 'bulb' } });
    expect(host.querySelectorAll('[data-element-id] [data-sticker-icon-id="bulb"]')).toHaveLength(1);
  });
  it('preserves a legal single-point dot and saves the full 20k-point limit without duplicating the mouseup tail', async () => {
    const folder = await mkdtemp(join(tmpdir(),'studio-stroke-limit-')), service = new StudioService({ dataRoot:folder });
    try {
      const fixture = await service.execute('artifact_manage',{ action:'create' }) as {board:Board};
      const send = vi.fn(async (name: ToolName,args?:Record<string,unknown>) => service.execute(name,args,LOCAL_ACTOR));
      const client:StudioClient={embedded:true,async call<T>(name:ToolName,args?:Record<string,unknown>){return await send(name,args) as T;}};
      function Harness(){const[value,setValue]=useState(fixture.board);return <WhiteboardCanvas board={value} client={client} actor={LOCAL_ACTOR} onChanged={setValue} onAnnotate={()=>{}} externalViewport={initialViewport}/>;}
      await act(async()=>root.render(<Harness/>));
      await click('画笔'); await pointer(5,7);
      await vi.waitFor(async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe('select');});
      const first=await service.execute('artifact_read',{artifactId:fixture.board.artifact.id,mode:'board'}) as Board;
      expect(first.elements[0]).toMatchObject({type:'stroke',x:5,y:7,w:1,h:1,points:[0,0]});
      await click('画笔'); await event(query('白板画布'),'pointerdown',100,100);
      for(let start=1;start<20000;start+=100){
        await act(async()=>{for(let index=start;index<Math.min(20000,start+100);index++)query('白板画布').dispatchEvent(new MouseEvent('pointermove',{bubbles:true,button:0,clientX:100+index*3,clientY:100+index*3}));});
      }
      await event(query('白板画布'),'pointerup',100+20000*3,100+20000*3);
      await vi.waitFor(async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe('select');});
      const latest=await service.execute('artifact_read',{artifactId:fixture.board.artifact.id,mode:'board'}) as Board, stroke=latest.elements[1];
      expect(stroke.points).toHaveLength(40000);expect(stroke.points!.slice(0,2)).toEqual([0,0]);expect(stroke.points!.slice(-2)).toEqual([19999*3,19999*3]);
      expect(stroke).toMatchObject({x:100,y:100,w:19999*3,h:19999*3});
      expect(send.mock.calls.filter(([name])=>name==='artifact_apply')).toHaveLength(2);
      expect(host.textContent).toContain('长度上限');expect(host.querySelector('[role="alert"]')).toBeNull();
    } finally {await service.close();await rm(folder,{recursive:true,force:true});}
  },30000);
  it('creates an adjacent item with Ctrl Enter and ends a section title with Enter', async () => {
    const call = await editable(); await click('便签'); await pointer(120, 160);
    await input(query('编辑文字') as HTMLTextAreaElement, 'First'); await key(query('编辑文字'), 'Enter', { ctrlKey: true });
    expect(call.mock.calls[2]![1].operations[0]!.element).toMatchObject({ type: 'note', x: 352, y: 160, text: '' });
    await key(query('编辑文字'), 'Escape'); await click('分区'); await pointer(600, 200); await key(query('白板画布'), 'Enter'); await input(query('编辑文字') as HTMLTextAreaElement, 'Section'); await key(query('编辑文字'), 'Enter');
    expect(query('编辑文字')).toBeNull();
  });
  it('keeps locks as geometry locks while permitting text, style and comments, and supports in-place unlock', async () => {
    const annotate = vi.fn(), activity = vi.fn();
    const call = await editable([element('locked', { locked: true })], { onAnnotateNative: annotate, onActivityChange: activity });
    await select('locked'); expect(query('调整元素大小')).toBeNull();
    expect(activity.mock.lastCall?.[0].movingIds).toEqual([]);
    await click('加粗'); expect(call.mock.calls[0]![1].operations[0]!.changes).toEqual({ bold: true });
    await click('备注所选元素'); expect(annotate.mock.lastCall?.[0]).toMatchObject({ anchor: { elementIds: ['locked'], coordinateSpace: 'element' } });
    expect(annotate.mock.lastCall![0].anchor.x).toBeCloseTo(.92); expect(annotate.mock.lastCall![0].anchor.y).toBeCloseTo(.16);
    await event(host.querySelector('[data-element-id="locked"]')!, 'dblclick'); await input(query('编辑文字') as HTMLTextAreaElement, 'Still editable'); await key(query('编辑文字'), 'Escape');
    await key(query('白板画布'), 'Delete'); expect(call).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll('.studio-selection-corner.is-locked')).toHaveLength(4); await click('更多操作'); expect([...host.querySelectorAll<HTMLButtonElement>('[role=menuitem]')].find(button=>button.textContent==='删除Delete')?.disabled).toBe(true);
    await event(host.querySelector('.studio-selection-toolbar [aria-label="解锁元素"]')!, 'click');
    expect(call.mock.calls[2]![1].operations[0]!.changes).toEqual({ locked: false });
    expect(host.querySelectorAll('[aria-label^="调整元素大小"]')).toHaveLength(8);
  });
  it('blocks crop of a locked image while keeping its lock action reachable', async () => {
    await mount([element('image', { type: 'image', locked: true, src: 'data:image/png;base64,AA' })]); await select('image'); await event(host.querySelector('[data-element-id="image"]')!, 'dblclick');
    expect((query('裁剪图片') as HTMLButtonElement).disabled).toBe(true); expect(query('解锁元素')).not.toBeNull();
  });
  it('retains an inline draft without submitting when editing permission is suspended', async () => {
    const elements = [element('draft')], call = vi.fn(), editor = { ...LOCAL_ACTOR, role: 'editor' as const };
    await mount(elements, { actor: editor, client: { embedded: true, call } });
    await select('draft'); await event(host.querySelector('[data-element-id="draft"]')!, 'dblclick');
    await input(query('编辑文字') as HTMLTextAreaElement, 'Keep this unsent draft');
    await mount(elements, { readOnly: true, actor: { ...editor, role: 'viewer' }, client: { embedded: true, call } });
    expect(query('编辑文字').getAttribute('contenteditable')).toBe('false');
    await event(query('编辑文字'), 'focusout'); await key(query('编辑文字'), 'Escape');
    expect(call).not.toHaveBeenCalled(); expect(query('编辑文字').textContent).toBe('Keep this unsent draft');
    await mount(elements, { actor: editor, client: { embedded: true, call } });
    expect(query('编辑文字').getAttribute('contenteditable')).toBe('true');
    expect(query('编辑文字').textContent).toBe('Keep this unsent draft'); expect(call).not.toHaveBeenCalled();
  });
  it('saves visible inline input before capturing and freezing a native comment against the real service', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'studio-canvas-comment-'));
    const service = new StudioService({ dataRoot: folder });
    try {
      const fixture = await service.execute('artifact_manage', { action: 'create', title: 'Native comment', elements: [element('one', { locked: true })] }, LOCAL_ACTOR) as { board: Board };
      const annotate = vi.fn();
      const liveClient: StudioClient = { embedded: true, async call<T>(name: ToolName, args: Record<string, unknown> = {}) { return await service.execute(name, args, LOCAL_ACTOR) as T; } };
      function Harness() { const [value, setValue] = useState(fixture.board); return <WhiteboardCanvas board={value} client={liveClient} actor={LOCAL_ACTOR} onChanged={setValue} onAnnotate={() => {}} onAnnotateNative={annotate} externalViewport={initialViewport} />; }
      await act(async () => root.render(<Harness />));
      await select('one'); await event(host.querySelector('[data-element-id="one"]')!, 'dblclick');
      await input(query('编辑文字') as HTMLTextAreaElement, 'New visible text');
      await click('备注所选元素');
      await act(async () => { await vi.waitFor(() => expect(annotate).toHaveBeenCalledTimes(1)); });
      const target = annotate.mock.calls[0]![0] as NativeAnnotation;
      expect(target.versions).toEqual({ one: 2 }); expect(target.label).toContain('New visible text');
      const saved = await service.execute('artifact_feedback', { action: 'create', artifactId: fixture.board.artifact.id, text: 'Discuss the visible input', anchor: target.anchor, versions: target.versions }, LOCAL_ACTOR);
      const frozen = await service.execute('artifact_read', { artifactId: fixture.board.artifact.id, mode: 'context', contextId: saved.contextId }, LOCAL_ACTOR);
      expect(frozen.sources[0]).toMatchObject({ elementId: 'one', version: 2, element: { text: 'New visible text', locked: true } });
      expect(query('编辑文字')).toBeNull();
    } finally {
      await act(async () => root.render(null)); await service.close(); await rm(folder, { recursive: true, force: true });
    }
  });
  it('retains inline drafts and does not capture comments on a failed save', async () => {
    const failedAnnotation=vi.fn(), activity=vi.fn(); await mount([element('conflict')],{client:{embedded:true,call:vi.fn().mockRejectedValue(new Error('CONFLICT'))},onAnnotateNative:failedAnnotation,onActivityChange:activity});
    await select('conflict');await event(host.querySelector('[data-element-id="conflict"]')!,'dblclick');await input(query('编辑文字') as HTMLTextAreaElement,'Keep this draft');
    await click('备注所选元素');expect(failedAnnotation).not.toHaveBeenCalled();expect(query('编辑文字').textContent).toBe('Keep this draft');
    expect(activity.mock.lastCall?.[0]).toMatchObject({ dirty: true, saving: false, saveError: expect.stringContaining('未覆盖他人的内容') });
  });
  it('reports pending and completed saves to the header using the actual mutation response', async () => {
    const activity = vi.fn(); let finish!: (value: { board: Board }) => void;
    const call = vi.fn(() => new Promise<{ board: Board }>(resolve => { finish = resolve; }));
    await mount([element('saving')], { client: { embedded: true, call } as StudioClient, onActivityChange: activity });
    await select('saving'); await click('加粗');
    expect(activity.mock.lastCall?.[0]).toMatchObject({ dirty: true, saving: true, saveError: '' });
    await act(async () => finish({ board: board([element('saving', { bold: true, version: 2 })], 2) }));
    expect(activity.mock.lastCall?.[0]).toMatchObject({ dirty: false, saving: false, saveError: '' });
  });
  it('produces relative object points and board-coordinate area and blank targets in global comment mode', async () => {
    const annotate = vi.fn();
    await mount([element('one')], { annotationActive: true, onAnnotateNative: annotate });
    await event(host.querySelector('[data-element-id="one"]')!, 'pointerdown', 150, 145); await event(query('白板画布'), 'pointerup', 150, 145);
    expect(annotate.mock.lastCall?.[0]).toMatchObject({ anchor: { coordinateSpace: 'element', elementIds: ['one'], x: .25, y: .25 }, versions: { one: 1 }, screenPoint: { x: 150, y: 145 } });
    await pointer(500, 400); expect(annotate.mock.lastCall?.[0].anchor).toEqual({ coordinateSpace: 'board', elementIds: [], x: 500, y: 400 });
    await pointer(80, 100, { x: 330, y: 250 });
    expect(annotate.mock.lastCall?.[0].anchor).toEqual({ coordinateSpace: 'board', elementIds: ['one'], x: 80, y: 100, w: 250, h: 150 });
    expect(host.querySelector('.studio-inline-editor')).toBeNull();
  });
  it('enters comment mode from pan and returns to a valid select tool when the header exits', async () => {
    const annotate = vi.fn(); await mount([element('one')], { annotationActive: false, onAnnotateNative: annotate }); await click('平移');
    await mount([element('one')], { annotationActive: true, onAnnotateNative: annotate }); await pointer(500, 400);
    expect(annotate).toHaveBeenCalledTimes(1);
    await mount([element('one')], { annotationActive: false, onAnnotateNative: annotate }); await pointer(600, 500);
    expect(annotate).toHaveBeenCalledTimes(1); expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe('select');
  });
  it('renders pins attached to resized objects and HTML internals and sends selection without editing', async () => {
    const feedback = (id: string, anchor: Feedback['anchor']): Feedback => ({ id, artifactId: 'board', type: 'comment', anchor, author: LOCAL_ACTOR, text: id, status: 'open', createdAt: '', updatedAt: '', replies: [] });
    const activities = [feedback('object', { coordinateSpace: 'element', elementIds: ['one'], x: .5, y: .5 }), feedback('html', { coordinateSpace: 'html', regionId: 'region', x: 20, y: 30 }), feedback('board', { coordinateSpace: 'board', x: 900, y: 700, w: 100, h: 80 })];
    const selected = vi.fn();
    await mount([element('one'), element('region', { type: 'html', x: 500, y: 300, html: '<p>Hello</p>' })], { activities, onFeedbackSelect: selected });
    expect((host.querySelector('[data-feedback-pin="object"]') as HTMLElement).style.left).toBe('200px');
    expect((host.querySelector('[data-feedback-pin="html"]') as HTMLElement).style.left).toBe('520px');
    await event(host.querySelector('[data-feedback-pin="object"]')!, 'click'); expect(selected.mock.lastCall?.[0].id).toBe('object');
    await mount([element('one', { x: 300, w: 400 }), element('region', { type: 'html', x: 600, y: 300, html: '<p>Hello</p>' })], { activities });
    expect((host.querySelector('[data-feedback-pin="object"]') as HTMLElement).style.left).toBe('500px');
    expect((host.querySelector('[data-feedback-pin="html"]') as HTMLElement).style.left).toBe('620px');
  });
  it('offers direct selection reading instead of an external HTML reader, activates content on double click and keeps document controls before compact zoom', async () => {
    const edit = vi.fn();
    await mount([element('region', { type: 'html', html: '<p>Hello</p>', locked: true })], { onEditHtml: edit, documentControls: <button aria-label="计时器">Timer</button> });
    await select('region'); expect(query('全屏观看选区')).not.toBeNull(); expect(host.querySelector('[aria-label="新标签页打开 HTML 图解"]')).toBeNull();
    await click('编辑 HTML 源码'); expect(edit.mock.lastCall?.[0].id).toBe('region');
    await event(host.querySelector('[data-element-id="region"]')!, 'dblclick'); expect((host.querySelector('iframe') as HTMLIFrameElement).style.pointerEvents).toBe('auto');
    expect([...host.querySelector('.studio-canvas-top-tools')!.children].map(node => node.getAttribute('aria-label'))).toEqual(['计时器', null, '缩放菜单']);
    await click('缩放菜单'); expect(query('撤销')).not.toBeNull(); expect(host.querySelector('.studio-zoom-menu')!.textContent).toContain('适应白板');
    await click('形状'); await event([...host.querySelectorAll('.studio-insert-menu button')].find(button => button.textContent === 'HTML 图解')!, 'click'); expect(edit.mock.lastCall?.[0]).toBeUndefined();
    expect(makeElement('html', { x: 0, y: 0 })).toMatchObject({ w: 1440, h: 1120 });
  });
  it('re-applies an explicitly repeated viewport after a local pan', async () => {
    await mount([element('one')]); await click('平移'); await pointer(100, 100, { x: 250, y: 200 });
    expect((host.querySelector('.studio-canvas-world') as HTMLElement).style.transform).toContain('translate(150px,100px)');
    await mount([element('one')], { externalViewport: { ...initialViewport } });
    expect((host.querySelector('.studio-canvas-world') as HTMLElement).style.transform).toContain('translate(0px,0px)');
  });
  it('accepts repeated external selection requests and filters nonexistent objects', async () => {
    const selected = vi.fn();
    await mount([element('one'), element('two')], { externalSelectedIds: ['one', 'missing'], onSelectionChange: selected });
    expect(selected.mock.lastCall?.[0]).toEqual(['one']);
    await select('two'); expect(selected.mock.lastCall?.[0]).toEqual(['two']);
    await mount([element('one'), element('two')], { externalSelectedIds: ['one'], onSelectionChange: selected });
    expect(selected.mock.lastCall?.[0]).toEqual(['one']);
  });
  it('undoes and redoes locked-object formatting without sending geometry or an implicit unlock', async () => {
    const call = await editable([element('one', { locked: true })]); await select('one'); await click('加粗');
    await click('缩放菜单'); await click('撤销');
    expect(call.mock.calls[1]![1].operations).toEqual([{ op: 'update', id: 'one', changes: { bold: false } }]);
    await click('重做'); expect(call.mock.calls[2]![1].operations).toEqual([{ op: 'update', id: 'one', changes: { bold: true } }]);
    expect(query('调整元素大小')).toBeNull();
  });
  it('ignores canvas delete, undo and tool shortcuts from buttons inside an external dialog', async () => {
    const call = await editable([element('one')]); await select('one'); await click('加粗');
    const dialog = document.createElement('section'); dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button'); button.textContent = 'Save source'; dialog.append(button); document.body.append(dialog);
    try {
      button.focus();
      await key(button, 'Delete'); await key(button, 'Backspace'); await key(button, 'z', { ctrlKey: true }); await key(button, 'd', { ctrlKey: true }); await key(button, 't');
      expect(call).toHaveBeenCalledTimes(1);
      expect(host.querySelector('[data-element-id="one"]')).not.toBeNull();
      expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe('select');
    } finally { dialog.remove(); }
  });
  it('offers a complete vector palette with search, empty-state clearing and the current choice highlighted', async () => {
    await editable(); await click('贴纸');
    expect(host.querySelectorAll('.studio-sticker-grid button')).toHaveLength(BOARD_STICKERS.length);
    expect(BOARD_STICKERS.length).toBe(42);
    expect(query('自定义贴纸')).toBeNull(); expect(host.querySelector('.studio-sticker-custom')).toBeNull();
    await input(query('搜索贴纸') as HTMLInputElement, '合作');
    expect(host.querySelectorAll('.studio-sticker-grid button')).toHaveLength(1);
    await click('贴纸 握手'); await pointer(300, 200); await key(query('白板画布'), '8'); await pointer(400, 200);
    expect(host.querySelectorAll('[data-element-id] [data-sticker-icon-id="handshake"]')).toHaveLength(2);
    await click('贴纸'); expect(query('贴纸 握手').getAttribute('aria-pressed')).toBe('true');
    await input(query('搜索贴纸') as HTMLInputElement, 'nothing-matches-this');
    expect(host.querySelector('.studio-sticker-empty')!.textContent).toContain('没有找到贴纸');
    await click('清除贴纸搜索'); expect(host.querySelectorAll('.studio-sticker-grid button')).toHaveLength(42);
  });
  it('uses numeric tools and visible shape and ink palettes without an element sidebar', async () => {
    await editable(); await key(query('白板画布'),'5'); expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe('note');
    await key(query('白板画布'),'8'); expect(query('贴纸').getAttribute('aria-pressed')).toBe('true');
    await key(query('白板画布'),'6'); await click('箭头模式'); expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe('arrow');
    expect(query('墨色 陶土色')).not.toBeNull();
    await click('形状'); await click('形状 椭圆'); expect(query('形状 椭圆').getAttribute('aria-pressed')).toBe('true');
    await click('形状 菱形'); expect(query('形状 菱形').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.studio-canvas-properties')).toBeNull();
  });
  it.each(['note', 'shape'] as const)('keeps the measured %s toolbar inside desktop and narrow canvas bounds without dropping controls', async type => {
    const layout = { width: 1280, height: 720, barWidth: type === 'shape' ? 600 : 450, barHeight: 42 };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const width = this.classList.contains('studio-selection-toolbar') ? layout.barWidth : this.classList.contains('studio-format-popover') ? 220 : layout.width;
      const height = this.classList.contains('studio-selection-toolbar') ? layout.barHeight : layout.height;
      return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON() {} };
    });
    await mount([element('one', { type, x: 3300, y: 1600 })], { externalViewport: { x: 0, y: 0, zoom: .33 }, externalSelectedIds: ['one'] });
    const toolbar = query('选区格式') as HTMLElement;
    const controls = [...toolbar.querySelectorAll('.studio-selection-toolbar-scroll > button,.studio-selection-toolbar-scroll > select')].map(node => node.getAttribute('aria-label'));
    const left = Number.parseFloat(toolbar.style.left);
    expect(left - layout.barWidth / 2).toBeGreaterThanOrEqual(12);
    expect(left + layout.barWidth / 2).toBeLessThanOrEqual(1268);
    layout.width = 320; layout.height = 440; layout.barWidth = 296; layout.barHeight = 54;
    await act(async () => window.dispatchEvent(new Event('resize')));
    expect(toolbar.style.left).toBe('160px');
    expect([...toolbar.querySelectorAll('.studio-selection-toolbar-scroll > button,.studio-selection-toolbar-scroll > select')].map(node => node.getAttribute('aria-label'))).toEqual(controls);
    await click('文字颜色');
    expect(toolbar.querySelector('.studio-format-popover')!.parentElement).toBe(toolbar);
    expect(toolbar.querySelector('.studio-selection-toolbar-scroll')!.contains(toolbar.querySelector('.studio-format-popover'))).toBe(false);
  });
  it('copies a serialized object through the system clipboard and pastes into a separate canvas instance', async () => {
    const previous=Object.getOwnPropertyDescriptor(navigator,'clipboard');let payload='';
    const writeText=vi.fn(async(value:string)=>{payload=value;}),readText=vi.fn(async()=>payload);
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText,readText}});
    try {
      await editable([element('source',{text:'Copied content'})],{externalSelectedIds:['source']});await click('更多操作');await event([...host.querySelectorAll('[role=menuitem]')].find(button=>button.textContent==='复制Ctrl/⌘ C')!,'click');
      expect(writeText).toHaveBeenCalledTimes(1);expect(payload).toContain('AGENTERO_STUDIO_ELEMENTS_V1');
      await act(async()=>root.render(null));const call=await editable();await event(query('白板画布'),'contextmenu');await event([...host.querySelectorAll('[role=menuitem]')].find(button=>button.textContent==='粘贴Ctrl/⌘ V')!,'click');
      expect(readText).toHaveBeenCalledTimes(1);expect(call.mock.calls[0]![1].operations[0]!.element).toMatchObject({text:'Copied content'});
      expect(host.querySelectorAll('[data-element-id]')).toHaveLength(1);
    } finally {if(previous)Object.defineProperty(navigator,'clipboard',previous);else Reflect.deleteProperty(navigator,'clipboard');}
  });
  it('does not delete a cut target when the system clipboard write and fallback fail', async () => {
    const previous=Object.getOwnPropertyDescriptor(navigator,'clipboard'),exec=document.execCommand;
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:vi.fn().mockRejectedValue(new Error('blocked'))}});document.execCommand=vi.fn(()=>false);
    try {
      const call=await editable([element('one')],{externalSelectedIds:['one']});await click('更多操作');await event([...host.querySelectorAll('[role=menuitem]')].find(button=>button.textContent==='剪切Ctrl/⌘ X')!,'click');
      expect(call).not.toHaveBeenCalled();expect(host.querySelector('[role=alert]')).not.toBeNull();expect(host.querySelector('[data-element-id="one"]')).not.toBeNull();
    } finally {if(previous)Object.defineProperty(navigator,'clipboard',previous);else Reflect.deleteProperty(navigator,'clipboard');document.execCommand=exec;}
  });
  it('exposes real object actions and aligns a multi-selection through the floating controls', async () => {
    const call=await editable([element('a',{x:50}),element('b',{x:400})],{externalSelectedIds:['a','b']});
    await click('对齐对象');await event([...host.querySelectorAll('.studio-format-row button')].find(button=>button.textContent==='左对齐')!,'click');
    expect(call.mock.calls[0]![1].operations).toContainEqual({op:'update',id:'b',changes:{x:50,y:120}});
    await click('更多操作');expect(host.querySelector('[role=menu]')!.textContent).toContain('置于顶层');
    expect(host.querySelector('[role=menu]')!.textContent).toContain('整理');expect(host.querySelector('.studio-canvas-properties')).toBeNull();
  });
  it('uses four noninteractive locked corners and hides geometric controls in comment mode', async () => {
    await mount([element('one',{locked:true})],{externalSelectedIds:['one']});
    expect(host.querySelectorAll('.studio-selection-corner.is-locked')).toHaveLength(4);expect(host.querySelector('.studio-lock-indicator')).toBeNull();
    await mount([element('one')],{externalSelectedIds:['one'],annotationActive:true});
    expect(host.querySelector('.studio-selection-frame')).not.toBeNull();expect(host.querySelectorAll('.studio-selection-corner.is-locked')).toHaveLength(4);expect(host.querySelectorAll('[aria-label^="调整元素大小"]')).toHaveLength(0);expect(host.querySelector('.studio-resize-handle')).toBeNull();expect(host.querySelector('.studio-annotation-hint')).toBeNull();
    expect(host.querySelector('.studio-selection-edge,.studio-rotate-hit,.studio-connection-port')).toBeNull();
  });
  it.each([
    ['text', 4, 2, 4, 4], ['note', 4, 4, 4, 4], ['shape', 4, 4, 4, 4],
    ['html', 4, 4, 0, 0], ['table', 4, 4, 0, 4], ['sticker', 4, 0, 4, 0],
    ['image', 4, 0, 4, 4], ['link', 0, 0, 4, 4], ['arrow', 0, 0, 0, 0],
  ] as const)('uses distinct reference selection affordances for %s', async (type, corners, edges, rotations, ports) => {
    await mount([element('one',{type,from:[100,120],to:[300,220]})],{externalSelectedIds:['one']});
    expect(host.querySelectorAll('button.studio-selection-corner')).toHaveLength(corners);
    expect(host.querySelectorAll('.studio-selection-edge')).toHaveLength(edges);
    expect(host.querySelectorAll('.studio-rotate-hit')).toHaveLength(rotations);
    expect(host.querySelectorAll('.studio-connection-port')).toHaveLength(ports);
    expect(host.querySelector('.studio-rotate-handle')).toBeNull();
    if(type==='arrow') expect(host.querySelectorAll('.studio-arrow-handle').length).toBeGreaterThanOrEqual(2);
  });
  it('keeps multi-selection corners and edge resizing separate from single-object connection ports', async () => {
    const call=await editable([element('a'),element('b',{x:500})],{externalSelectedIds:['a','b']});
    expect(host.querySelectorAll('button.studio-selection-corner')).toHaveLength(4);
    expect(host.querySelectorAll('.studio-selection-edge')).toHaveLength(4);
    expect(host.querySelector('.studio-connection-port')).toBeNull();
    await event(query('调整元素大小 e'),'pointerdown',700,170);await event(query('白板画布'),'pointermove',800,170);await event(query('白板画布'),'pointerup',800,170);
    expect(call.mock.calls[0]![1].operations).toHaveLength(2);
    expect(call.mock.calls[0]![1].operations.every(operation=>Number(operation.changes?.w)>200)).toBe(true);
  });
  it('rotates from the invisible corner reach without repurposing connection ports or visible resize squares', async () => {
    const call=await editable([element('one')],{externalSelectedIds:['one']});
    await event(query('旋转所选元素 ne'),'pointerdown',300,120);await event(query('白板画布'),'pointermove',250,270);
    expect((host.querySelector('.studio-selection-frame') as HTMLElement).style.transform).toBe('rotate(90deg)');
    await event(query('白板画布'),'pointerup',250,270);
    expect(call.mock.lastCall![1].operations[0]).toMatchObject({op:'update',id:'one',changes:{rotation:90}});
  });
  it('creates an adjacent blank note on click and a connected matching shape on a shape port click', async () => {
    const call=await editable([element('note',{type:'note',fill:'#F9E56F'}),element('shape',{x:700,kind:'diamond',fill:'#9DC8F7'})]);
    await select('note');await event(query('连接点 right'),'pointerdown',312,170);await event(query('白板画布'),'pointerup',312,170);
    expect(call.mock.calls[0]![1].operations[0]!.element).toMatchObject({type:'note',x:324,y:120,text:'',fill:'#F9E56F'});
    expect(query('编辑文字')).not.toBeNull();await key(query('编辑文字'),'Escape');
    await select('shape');await event(query('连接点 bottom'),'pointerdown',800,232);await event(query('白板画布'),'pointerup',800,232);
    const additions=call.mock.lastCall![1].operations.map(operation=>operation.element!);
    expect(additions[0]).toMatchObject({type:'shape',kind:'diamond',fill:'#9DC8F7',x:700,y:268,text:''});
    expect(additions[1]).toMatchObject({type:'arrow',from:'shape',fromSide:'bottom',to:additions[0].id,toSide:'top'});
    expect(query('编辑文字')).toBeNull(); expect(host.querySelectorAll('.studio-selection-corner[aria-label]')).toHaveLength(4);
    await key(query('白板画布'),'Enter'); expect(query('编辑文字')).not.toBeNull();
    expect(host.querySelectorAll('.studio-selection-toolbar [aria-label="形状类型"]')).toHaveLength(1);
  });
  it('drags a connection port into a real side binding, while text-port clicks and sticky drags do not create objects', async () => {
    const call=await editable([element('text',{type:'text'}),element('target',{x:500}),element('note',{type:'note',y:400})]);
    await select('text');await event(query('连接点 right'),'pointerdown',312,170);await event(query('白板画布'),'pointerup',312,170);
    expect(call).not.toHaveBeenCalled();
    await event(query('连接点 right'),'pointerdown',312,170);await event(query('白板画布'),'pointermove',488,170);await event(query('白板画布'),'pointerup',488,170);
    expect(call.mock.lastCall![1].operations[0]!.element).toMatchObject({type:'arrow',from:'text',fromSide:'right',to:'target',toSide:'left'});
    await select('note');await event(query('连接点 right'),'pointerdown',312,450);await event(query('白板画布'),'pointermove',400,450);await event(query('白板画布'),'pointerup',400,450);
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('places rotated connection ports on the same local side used by saved arrow geometry', async () => {
    const source=element('rotated',{type:'text',rotation:90}),target=element('target',{x:500});
    const call=await editable([source,target],{externalSelectedIds:['rotated']});
    expect((query('连接点 right') as HTMLElement).style.left).toBe('200px');
    expect((query('连接点 right') as HTMLElement).style.top).toBe('282px');
    await event(query('连接点 right'),'pointerdown',200,282);await event(query('白板画布'),'pointermove',488,170);await event(query('白板画布'),'pointerup',488,170);
    const arrow=call.mock.lastCall![1].operations[0]!.element as BoardElement;
    expect(arrow).toMatchObject({from:'rotated',fromSide:'right',to:'target',toSide:'left'});
    expect(arrowGeometry(arrow,[source,target]).points[0]).toEqual({x:200,y:270});
  });
  it('keeps native table pointer clicks uncaptured until dragging and edits the original cell on double click', async () => {
    const call=await editable([element('table',{type:'table',w:900,h:300,text:'名称\t说明\t状态\n项目 A\t双击单元格编辑\t进行中\n项目 B\t后续安排\t待处理'})]);
    const cell=[...host.querySelectorAll('td')].find(node=>node.textContent==='双击单元格编辑')!;
    const capture=vi.mocked(HTMLElement.prototype.setPointerCapture);
    for(let i=0;i<2;i++){await event(cell,'pointerdown',550,270);await event(cell,'pointerup',550,270);await event(cell,'click',550,270);}
    expect(capture).not.toHaveBeenCalled();
    await event(cell,'dblclick',550,270);
    expect(query('表格第2行第2列')).not.toBeNull();expect(query('编辑文字')).toBeNull();expect(call).not.toHaveBeenCalled();
    await key(query('表格第2行第2列'),'Escape');
    await event(host.querySelector('[data-element-id="table"]')!,'pointerdown',150,140);
    await event(query('白板画布'),'pointermove',152,142);expect(capture).not.toHaveBeenCalled();
    await event(query('白板画布'),'pointermove',180,170);expect(capture).toHaveBeenCalledTimes(1);
    await event(query('白板画布'),'pointerup',180,170);expect(call.mock.lastCall![1].operations[0]).toMatchObject({op:'update',id:'table',changes:{x:130,y:150}});
  });
  it('uses a compact icon-only draw tray with five preset inks and keeps editable line width in the selection popover', async () => {
    const call=await editable();await click('画笔');const tray=query('绘图选项');
    expect([...tray.querySelectorAll('.studio-pen-choices button')].map(button=>button.textContent)).toEqual(['','']);
    expect([...tray.querySelectorAll('.studio-native-colors button')].map(button=>button.getAttribute('aria-label'))).toEqual(['墨色 墨色','墨色 陶土色','墨色 蓝色','墨色 绿色','墨色 紫色']);
    expect(tray.querySelector('input,select,.studio-custom-color')).toBeNull();
    await click('墨色 紫色');await pointer(80,100,{x:280,y:180});
    expect(call.mock.calls[0]![1].operations[0]!.element).toMatchObject({type:'stroke',stroke:'#7C5CBF',strokeWidth:3});
    expect(query('绘图选项')).toBeNull();
    await click('选择');await click('边框与线条');expect(query('线条宽度')).not.toBeNull();expect(query('添加自定义颜色')).not.toBeNull();
    await input(query('线条宽度') as HTMLInputElement,'6');expect(call.mock.lastCall![1].operations[0]!.changes).toEqual({strokeWidth:6});
    const beforePicker = call.mock.calls.length;
    await click('添加自定义颜色'); await input(query('颜色值') as HTMLInputElement,'#123456');
    expect(call).toHaveBeenCalledTimes(beforePicker);
    await event(host.querySelector('button[type="submit"]')!, 'click');
    expect(call).toHaveBeenCalledTimes(beforePicker + 1);
    expect(call.mock.lastCall![1].operations).toEqual([{ op: 'update', id: call.mock.calls[0]![1].operations[0]!.element!.id, changes: { stroke: '#123456' } }, { op: 'style', style: { nativeInks: '123456' } }]);
  });
  it('applies and reselects custom text ink on a position-locked object without changing its lock or geometry', async () => {
    host.dataset.studioTheme = 'dark';
    const locked = element('locked', { type: 'text', text: 'Custom ink', locked: true, color: '#D97757' });
    const call = await editable([locked]); await select('locked'); await click('文字颜色');
    await click('添加自定义颜色'); await input(query('颜色值') as HTMLInputElement, '#303645');
    expect(call).not.toHaveBeenCalled(); await event(host.querySelector('button[type="submit"]')!, 'click');
    expect(call.mock.calls[0]![1].operations).toEqual([{ op: 'update', id: 'locked', changes: { color: '#303645' } }, { op: 'style', style: { nativeInks: '303645' } }]);
    const text = host.querySelector<HTMLElement>('[data-element-id="locked"]')!;
    expect(text.classList.contains('is-locked')).toBe(true); expect(text.style.left).toBe(`${locked.x}px`); expect(text.style.top).toBe(`${locked.y}px`);
    expect(getComputedStyle(text).color).toBe('rgb(48, 54, 69)');
    await click('墨色 紫色'); await click('自定义颜色 #303645');
    expect(call.mock.lastCall![1].operations[0]!.changes).toEqual({ color: '#303645' });
    expect(getComputedStyle(text).color).toBe('rgb(48, 54, 69)');
  });
  it.each([false, true])('saves a confirmed custom color and its palette in one real history entry, with single-step undo and redo (multi=%s)', async multi => {
    const folder = await mkdtemp(join(tmpdir(), 'studio-canvas-color-history-'));
    const service = new StudioService({ dataRoot: folder });
    try {
      const values = [element('locked', { type: 'text', locked: true, color: '#D97757' }), element('other', { type: 'text', x: 400, color: '#2F7CC4' })];
      const fixture = await service.execute('artifact_manage', { action: 'create', title: 'Atomic custom color', elements: values }, LOCAL_ACTOR) as { board: Board };
      let current = fixture.board;
      const selectedIds = multi ? ['locked', 'other'] : ['locked'];
      const writes: Record<string, unknown>[] = [];
      const live: StudioClient = { embedded: true, async call<T>(name: ToolName, args: Record<string, unknown> = {}) { if (name === 'artifact_apply') writes.push(args); return await service.execute(name, args, LOCAL_ACTOR) as T; } };
      function Harness() { const [value, setValue] = useState(fixture.board); return <WhiteboardCanvas board={value} client={live} actor={LOCAL_ACTOR} onChanged={next => { current = next; setValue(next); }} onAnnotate={() => {}} externalSelectedIds={selectedIds} externalViewport={initialViewport} />; }
      const historyBefore = await service.execute('artifact_read', { artifactId: current.artifact.id, mode: 'history' }, LOCAL_ACTOR);
      const until = (check: () => void) => vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); check(); });
      await act(async () => root.render(<Harness />));
      await click('文字颜色'); await click('添加自定义颜色'); await input(query('颜色值') as HTMLInputElement, '#112233');
      await event(host.querySelector('.studio-custom-color-actions button[type="button"]')!, 'click');
      expect(writes).toHaveLength(0);
      await click('添加自定义颜色'); await input(query('颜色值') as HTMLInputElement, '#303645');
      await event(host.querySelector('button[type="submit"]')!, 'click');
      await until(() => expect(current.style.nativeInks).toBe('303645'));
      expect(writes).toHaveLength(1);
      expect(writes[0].operations).toEqual([...selectedIds.map(id => ({ op: 'update', id, changes: { color: '#303645' } })), { op: 'style', style: { nativeInks: '303645' } }]);
      const historyAfter = await service.execute('artifact_read', { artifactId: current.artifact.id, mode: 'history' }, LOCAL_ACTOR);
      expect(historyAfter.history).toHaveLength(historyBefore.history.length + 1);
      expect(current.artifact.revision).toBe(fixture.board.artifact.revision + 1);
      for (const original of fixture.board.elements) {
        const next = current.elements.find(value => value.id === original.id)!;
        expect(next).toMatchObject({ x: original.x, y: original.y, w: original.w, h: original.h });
        expect(next.locked).toBe(original.locked);
        expect(next.color).toBe(selectedIds.includes(next.id) ? '#303645' : original.color);
      }
      await click('文字颜色');
      await act(async () => (query('白板画布') as HTMLElement).focus());
      await key(query('白板画布'), 'z', { ctrlKey: true });
      await until(() => expect(current.elements.map(value => value.color)).toEqual(fixture.board.elements.map(value => value.color)));
      expect(current.style.nativeInks ?? '').toBe(''); expect(writes).toHaveLength(2);
      expect((writes[1].operations as Operation[])[0]).toMatchObject({ op: 'restore', data: { mode: 'undo' } });
      await key(query('白板画布'), 'z', { ctrlKey: true, shiftKey: true });
      await until(() => expect(current.style.nativeInks).toBe('303645'));
      expect(writes).toHaveLength(3);
      expect(current.elements.filter(value => selectedIds.includes(value.id)).every(value => value.color === '#303645')).toBe(true);
      await click('文字颜色'); await click('墨色 紫色');
      await until(() => expect(current.elements.find(value => value.id === 'locked')?.color).toBe('#7C5CBF'));
      await click('自定义颜色 #303645');
      await until(() => expect(current.elements.find(value => value.id === 'locked')?.color).toBe('#303645'));
      expect(writes).toHaveLength(5);
      expect((writes[4].operations as Operation[]).every(operation => operation.op === 'update')).toBe(true);
      await event(query('自定义颜色 #303645'), 'contextmenu');
      await until(() => expect(current.style.nativeInks).toBe(''));
      expect(writes).toHaveLength(6); expect(writes[5].operations).toEqual([{ op: 'style', style: { nativeInks: '' } }]);
      expect(current.elements.find(value => value.id === 'locked')?.color).toBe('#303645');
    } finally {
      await act(async () => root.render(null)); await service.close(); await rm(folder, { recursive: true, force: true });
    }
  });
  it('formats only the chosen native text range before saving and bounds HTML caption zoom compensation', async () => {
    const call=await editable([element('one',{text:'alpha beta'})]);await select('one');await event(host.querySelector('[data-element-id="one"]')!,'dblclick');
    const editor=query('编辑文字');const text=editor.firstChild!.firstChild as Text;
    const range=document.createRange();range.setStart(text,6);range.setEnd(text,10);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));
    await click('加粗');await key(editor,'Escape');expect(call.mock.calls[0]![1].operations[0]!.changes?.text).toBe('alpha **beta**');
    await act(async()=>root.render(null));await mount([element('region',{type:'html',html:'<p>Hi</p>'})],{externalViewport:{x:0,y:0,zoom:.5}});
    const caption = host.querySelector<HTMLElement>('.studio-html-caption')!;
    expect(caption.style.transform).toBe('scale(1.5)');
    expect((query('移动 HTML 区域') as HTMLElement).style.width).toBe('28px');
    expect((host.querySelector('.studio-canvas-world') as HTMLElement).style.transform).toContain('scale(0.5)');
  });
  it.each([
    { zoom: .05, compensation: 1.5, badge: false },
    { zoom: .25, compensation: 1.5, badge: false },
    { zoom: .5, compensation: 1.5, badge: true },
    { zoom: 1, compensation: 1, badge: true },
    { zoom: 2, compensation: .5, badge: true },
  ])('shrinks HTML caption, move button and gap with its region in a distant view at $zoom', async ({ zoom, compensation, badge }) => {
    await mount([element('region', { type: 'html', w: 800, html: '<p>Hi</p>' })], { externalViewport: { x: 0, y: 0, zoom } });
    const caption = host.querySelector<HTMLElement>('.studio-html-caption')!;
    expect(caption.style.transform).toBe(`scale(${compensation})`);
    expect(parseFloat(caption.style.width) * compensation * zoom).toBeCloseTo(800 * zoom);
    expect(caption.style.bottom).toBe(`calc(100% + ${10 * compensation}px)`);
    expect(caption.querySelector('span') !== null).toBe(badge);
    const move = query('移动 HTML 区域') as HTMLButtonElement;
    expect(parseFloat(move.style.width) * compensation * zoom).toBeLessThanOrEqual(28);
    expect(move.disabled).toBe(false);
  });
  it('saves real layer commands and restores their persisted order through undo and redo', async () => {
    const folder=await mkdtemp(join(tmpdir(),'studio-canvas-layers-')),service=new StudioService({dataRoot:folder});
    try {
      const fixture=await service.execute('artifact_manage',{action:'create',title:'Layers',elements:[element('a'),element('b'),element('c')]},LOCAL_ACTOR) as {board:Board};
      const live:StudioClient={embedded:true,async call<T>(name:ToolName,args:Record<string,unknown>={}){return await service.execute(name,args,LOCAL_ACTOR) as T;}};
      function Harness(){const[value,setValue]=useState(fixture.board);return <WhiteboardCanvas board={value} client={live} actor={LOCAL_ACTOR} onChanged={setValue} onAnnotate={()=>{}} externalSelectedIds={['a']} externalViewport={initialViewport}/>;}
      await act(async()=>root.render(<Harness/>));await click('更多操作');await event([...host.querySelectorAll('[role=menuitem]')].find(button=>button.textContent==='置于顶层')!,'click');
      const order=()=>[...host.querySelectorAll('[data-element-id]')].map(node=>node.getAttribute('data-element-id'));
      await vi.waitFor(async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});expect(order()).toEqual(['b','c','a']);});
      await click('缩放菜单');await click('撤销');await vi.waitFor(async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});expect(order()).toEqual(['a','b','c']);});
      await click('重做');await vi.waitFor(async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});expect(order()).toEqual(['b','c','a']);});
      await select('c');await key(query('白板画布'),'Delete');await vi.waitFor(async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});expect(order()).toEqual(['b','a']);});await click('缩放菜单');await vi.waitFor(async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});expect((query('撤销') as HTMLButtonElement).disabled).toBe(false);});await click('撤销');await vi.waitFor(async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});expect(order()).toEqual(['b','c','a']);});
    } finally {await act(async()=>root.render(null));await service.close();await rm(folder,{recursive:true,force:true});}
  });
  it('uses identical canonical SVG markup in the palette, live canvas and SVG/HTML exports while preserving legacy text', async () => {
    const value = element('sticker', { type: 'sticker', text: '爱心', data: { stickerIconId: 'heart' }, w: 64, h: 64 });
    await mount([value, element('legacy', { type: 'sticker', text: '★' })]);
    const live = host.querySelector('[data-element-id="sticker"] svg')!;
    const expected = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); expected.innerHTML = boardStickerMarkup('heart')!;
    expect(live.innerHTML).toBe(expected.innerHTML);
    await click('贴纸'); expect(host.querySelector('.studio-sticker-grid [data-sticker-icon-id="heart"]')!.innerHTML).toBe(expected.innerHTML);
    for (const exported of [buildBoardSvg(board([value])), buildBoardHtml(board([value]))]) {
      const parsed = new DOMParser().parseFromString(exported, 'text/html');
      expect(parsed.querySelector('[data-sticker-icon-id="heart"]')!.innerHTML).toBe(expected.innerHTML);
    }
    expect(host.querySelector('[data-element-id="legacy"]')!.textContent).toBe('★');
    expect(buildBoardSvg(board([element('unknown', { type: 'sticker', text: 'Legacy fallback', data: { stickerIconId: '<script>unsafe</script>' } })]))).toContain('Legacy fallback');
  });
});

it('round-trips a rotated object anchor and distinguishes board, HTML and relative coordinates', () => {
  const target = element('rotated', { rotation: 90 });
  const point = { x: 200, y: 120 };
  const relative = relativeElementPoint(target, point);
  const anchored = anchorBounds({ coordinateSpace: 'element', elementIds: [target.id], ...relative }, [target])!;
  expect(anchored.x).toBeCloseTo(point.x); expect(anchored.y).toBeCloseTo(point.y);
  expect(anchorBounds({ coordinateSpace: 'board', x: 20, y: 30, w: 40, h: 50 }, [target])).toEqual({ x: 20, y: 30, w: 40, h: 50 });
  expect(anchorBounds({ coordinateSpace: 'html', regionId: 'missing', x: 20, y: 30 }, [target])).toBeNull();
});
