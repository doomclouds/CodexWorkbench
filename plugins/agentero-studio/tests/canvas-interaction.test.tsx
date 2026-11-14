// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WhiteboardCanvas, { type NativeAnnotation, type WhiteboardCanvasProps } from '../src/app/canvas/WhiteboardCanvas.js';
import { anchorBounds, makeElement, relativeElementPoint } from '../src/app/canvas/canvas-model.js';
import { DEFAULT_STYLE, LOCAL_ACTOR, type Board, type BoardElement, type Feedback, type Operation, type StudioClient, type ToolName } from '../src/contracts/studio.js';
import { StudioService } from '../src/core/service.js';
import { boardStickerMarkup, BOARD_STICKERS } from '../src/core/products/whiteboard-stickers.js';
import { buildBoardHtml, buildBoardSvg } from '../src/core/serialization.js';

let host: HTMLDivElement, root: Root;
const element = (id: string, extra: Partial<BoardElement> = {}): BoardElement => ({ id, type: 'shape', x: 100, y: 120, w: 200, h: 100, version: 1, text: 'A', ...extra });
const board = (elements: BoardElement[], revision = 1): Board => ({ artifact: { id: 'board', type: 'whiteboard', title: 'Board', revision, createdAt: '', updatedAt: '', pinned: false }, style: DEFAULT_STYLE, elements });
const initialViewport = { x: 0, y: 0, zoom: 1 };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
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
async function pointer(x: number, y: number, end = { x, y }) { await event(query('白板画布'), 'pointerdown', x, y); if (x !== end.x || y !== end.y) await event(query('白板画布'), 'pointermove', end.x, end.y); await event(query('白板画布'), 'pointerup', end.x, end.y); }
async function select(id: string) { await event(host.querySelector(`[data-element-id="${id}"]`)!, 'pointerdown'); await event(query('白板画布'), 'pointerup'); }
async function input(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function key(node: Element, value: string, options: KeyboardEventInit = {}) { await act(async () => node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value, ...options }))); }

describe('whiteboard direct interaction', () => {
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
  it.each(['文字', '便签', '形状', '分区'])('creates %s by a click, enters inline input, saves Escape with the returned version and returns to select', async label => {
    const call = await editable();
    await click(label); await pointer(320, 250);
    expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe('select');
    const editor = query('编辑文字') as HTMLTextAreaElement;
    expect(editor).not.toBeNull();
    await input(editor, 'Created locally'); await key(editor, 'Escape');
    expect(call).toHaveBeenCalledTimes(2);
    const id = call.mock.calls[0]![1].operations[0]!.id!;
    expect((call.mock.calls[1]![1] as unknown as { expectedVersions: Record<string, number> }).expectedVersions).toEqual({ [id]: 1 });
    expect(query('编辑文字')).toBeNull();
    expect(host.querySelector(`[data-element-id="${id}"]`)!.textContent).toContain('Created locally');
  });
  it('uses dragged dimensions, creates blank-space text by double click and cancels an unfinished gesture with Escape', async () => {
    const call = await editable(); await click('形状'); await pointer(400, 300, { x: 180, y: 160 });
    expect(call.mock.calls[0]![1].operations[0]!.element).toMatchObject({ x: 180, y: 160, w: 220, h: 140 });
    await key(query('编辑文字'), 'Escape');
    await event(query('白板画布'), 'dblclick', 600, 400);
    expect(call.mock.calls[1]![1].operations[0]!.element).toMatchObject({ type: 'text', x: 600, y: 400, text: '' });
    await key(query('编辑文字'), 'Escape'); await click('便签');
    await event(query('白板画布'), 'pointerdown', 20, 30); await key(query('白板画布'), 'Escape'); await event(query('白板画布'), 'pointerup', 90, 90);
    expect(call).toHaveBeenCalledTimes(2);
  });
  it('retains continuous pen, arrow and sticker tools after saving', async () => {
    const call = await editable(); await click('画笔'); await pointer(50, 80, { x: 160, y: 180 });
    expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe('stroke');
    await click('画笔'); await click('箭头模式'); await pointer(200, 200, { x: 300, y: 300 });
    expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe('arrow');
    await click('贴纸'); await click('贴纸 想法'); await pointer(500, 300); await pointer(600, 300);
    expect(host.querySelector('.studio-whiteboard')!.getAttribute('data-tool')).toBe('sticker');
    expect(call.mock.calls.map(([, args]) => args.operations[0]!.element?.type)).toEqual(['stroke', 'arrow', 'sticker', 'sticker']);
    expect(call.mock.calls[2]![1].operations[0]!.element).toMatchObject({ text: '想法', data: { stickerIconId: 'bulb' } });
    expect(host.querySelectorAll('[data-element-id] [data-sticker-icon-id="bulb"]')).toHaveLength(2);
  });
  it('creates an adjacent item with Ctrl Enter and ends a section title with Enter', async () => {
    const call = await editable(); await click('便签'); await pointer(120, 160);
    await input(query('编辑文字') as HTMLTextAreaElement, 'First'); await key(query('编辑文字'), 'Enter', { ctrlKey: true });
    expect(call.mock.calls[2]![1].operations[0]!.element).toMatchObject({ type: 'note', x: 120, y: 368, text: '' });
    await key(query('编辑文字'), 'Escape'); await click('分区'); await pointer(600, 200); await input(query('编辑文字') as HTMLTextAreaElement, 'Section'); await key(query('编辑文字'), 'Enter');
    expect(query('编辑文字')).toBeNull();
  });
  it('keeps locks as geometry locks while permitting text, style and comments, and supports in-place unlock', async () => {
    const annotate = vi.fn(), activity = vi.fn();
    const call = await editable([element('locked', { locked: true })], { onAnnotateNative: annotate, onActivityChange: activity });
    await select('locked'); expect(query('调整元素大小')).toBeNull();
    expect(activity.mock.lastCall?.[0].movingIds).toEqual([]);
    await click('加粗'); expect(call.mock.calls[0]![1].operations[0]!.changes).toEqual({ bold: true });
    await click('备注所选元素'); expect(annotate.mock.lastCall?.[0]).toMatchObject({ anchor: { elementIds: ['locked'], coordinateSpace: 'element', x: 1, y: .5 } });
    await event(host.querySelector('[data-element-id="locked"]')!, 'dblclick'); await input(query('编辑文字') as HTMLTextAreaElement, 'Still editable'); await key(query('编辑文字'), 'Escape');
    await key(query('白板画布'), 'Delete'); expect(call).toHaveBeenCalledTimes(2);
    await click('更多元素属性'); expect((query('元素宽度') as HTMLInputElement).disabled).toBe(true); expect((query('删除所选元素') as HTMLButtonElement).disabled).toBe(true);
    await event(host.querySelector('.studio-selection-toolbar [aria-label="解锁元素"]')!, 'click');
    expect(call.mock.calls[2]![1].operations[0]!.changes).toEqual({ locked: false });
    expect(query('调整元素大小')).not.toBeNull();
  });
  it('blocks crop of a locked image while keeping its lock action reachable', async () => {
    await mount([element('image', { type: 'image', locked: true, src: 'data:image/png;base64,AA' })]); await select('image'); await event(host.querySelector('[data-element-id="image"]')!, 'dblclick');
    expect(query('裁剪图片')).toBeNull(); expect(query('解锁元素')).not.toBeNull();
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
  it('commits property text drafts before comment capture and retains inline drafts on a failed save', async () => {
    const annotate = vi.fn(), call = await editable([element('one')], { onAnnotateNative: annotate });
    await select('one'); await click('更多元素属性'); await input(query('属性文字') as HTMLTextAreaElement, 'Property draft');
    await click('备注所选元素'); expect(call.mock.calls[0]![1].operations[0]!.changes).toEqual({ text: 'Property draft' });
    expect(annotate.mock.lastCall?.[0]).toMatchObject({ label: '对象 · Property draft', versions: { one: 2 } });
    await act(async () => root.render(null));
    const failedAnnotation = vi.fn(); await mount([element('conflict')], { client: { embedded: true, call: vi.fn().mockRejectedValue(new Error('CONFLICT')) }, onAnnotateNative: failedAnnotation });
    await select('conflict'); await event(host.querySelector('[data-element-id="conflict"]')!, 'dblclick'); await input(query('编辑文字') as HTMLTextAreaElement, 'Keep this draft');
    await click('备注所选元素'); expect(failedAnnotation).not.toHaveBeenCalled(); expect((query('编辑文字') as HTMLTextAreaElement).value).toBe('Keep this draft');
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
  it('shares HTML editor and reader entries, activates content on double click and keeps document controls before compact zoom', async () => {
    const open = vi.fn(), edit = vi.fn();
    await mount([element('region', { type: 'html', html: '<p>Hello</p>', locked: true })], { onOpenHtml: open, onEditHtml: edit, documentControls: <button aria-label="计时器">Timer</button> });
    await select('region'); await click('新标签页打开 HTML 图解'); expect(open.mock.lastCall?.[0].id).toBe('region');
    await click('更多元素属性'); expect(edit.mock.lastCall?.[0].id).toBe('region');
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
    await click('贴纸 握手'); await pointer(300, 200); await pointer(400, 200);
    expect(host.querySelectorAll('[data-element-id] [data-sticker-icon-id="handshake"]')).toHaveLength(2);
    await click('贴纸'); expect(query('贴纸 握手').getAttribute('aria-pressed')).toBe('true');
    await input(query('搜索贴纸') as HTMLInputElement, 'nothing-matches-this');
    expect(host.querySelector('.studio-sticker-empty')!.textContent).toContain('没有找到贴纸');
    await click('清除贴纸搜索'); expect(host.querySelectorAll('.studio-sticker-grid button')).toHaveLength(42);
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
