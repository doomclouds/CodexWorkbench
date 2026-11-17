// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_STYLE, LOCAL_ACTOR, type Board, type Operation, type StudioClient, type ToolName } from '../src/contracts/studio.js';

vi.mock('../src/app/canvas/DocumentEditor.js', () => ({ default: () => <textarea aria-label="写作输入" /> }));
import WhiteboardCanvas from '../src/app/canvas/WhiteboardCanvas.js';

let host: HTMLDivElement, root: Root, board: Board;
const query = (selector: string) => host.querySelector<HTMLElement>(selector)!;
const viewport = () => query('[aria-label="白板画布"]');
const reader = () => query('.studio-document-scroll');

async function pointer(target: Element, type: string, x = 160, y = 120, pointerType = 'mouse') {
  const event = new MouseEvent(type, { button: 0, bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: pointerType } });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}

async function drag(target: Element, pointerType = 'mouse') {
  const down = await pointer(target, 'pointerdown', 160, 120, pointerType);
  await pointer(viewport(), 'pointermove', 240, 180, pointerType);
  await pointer(viewport(), 'pointerup', 240, 180, pointerType);
  return down;
}

async function mount({ selected = true, locked = false, readOnly = false } = {}) {
  board = {
    artifact: { id: 'document-movement', type: 'whiteboard', title: 'Document movement', revision: 1, pinned: false, createdAt: '', updatedAt: '' },
    style: DEFAULT_STYLE,
    elements: [{ id: 'doc', type: 'document', text: '拖动文档标题', x: 100, y: 80, w: 600, h: 400, locked, version: 1, document: { schemaVersion: 1, blocks: [{ id: 'paragraph', type: 'paragraph', props: {}, content: '正文仍然可以选字和滚动。', children: [] }] } }]
  };
  const call = vi.fn(async (_name: string, args: Record<string, unknown> = {}) => {
    const operations = args.operations as Operation[];
    board = {
      ...board,
      artifact: { ...board.artifact, revision: board.artifact.revision + 1 },
      elements: board.elements.map(element => ({ ...element, ...operations.find(operation => operation.id === element.id)?.changes, version: element.version + 1 }))
    };
    return { board };
  });
  const client: StudioClient = { embedded: true, async call<T>(name: ToolName, args?: Record<string, unknown>) { return await call(name, args) as T; } };
  const initialSelection = selected ? ['doc'] : [];
  const initialViewport = { x: 0, y: 0, zoom: .5 };
  function render() {
    root.render(<WhiteboardCanvas board={board} actor={LOCAL_ACTOR} client={client} onAnnotate={() => {}} onChanged={render} readOnly={readOnly} externalViewport={initialViewport} externalSelectedIds={initialSelection} />);
  }
  await act(async () => { render(); });
  const scroll = reader();
  Object.defineProperties(scroll, {
    offsetWidth: { configurable: true, value: 600 }, clientWidth: { configurable: true, value: 590 },
    offsetHeight: { configurable: true, value: 400 }, clientHeight: { configurable: true, value: 400 }
  });
  vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({ x: 50, y: 40, left: 50, top: 40, width: 300, height: 200, right: 350, bottom: 240, toJSON: () => ({}) });
  return call;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(650);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  localStorage.clear();
  host = document.createElement('div'); host.className = 'studio'; document.body.append(host); root = createRoot(host);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it.each(['.studio-document-title', '.studio-document-heading', '.studio-document-body', '.studio-document-scroll', '.studio-document-content', '.studio-doc-prose'])('moves a selected real document from %s while preserving its content', async selector => {
  const call = await mount(), original = structuredClone(board.elements[0].document);
  expect(query('.studio-document-heading input')).toBeNull();
  expect((await drag(query(selector))).defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
  expect(board.elements[0]).toMatchObject({ x: 260, y: 200, text: '拖动文档标题', document: original, version: 2 });
  expect(call.mock.calls[0][1]?.operations).toEqual([{ op: 'update', id: 'doc', changes: { x: 260, y: 200 } }]);
});

it('moves from the body background of an unselected real document and selects it', async () => {
  const call = await mount({ selected: false });
  await drag(query('.studio-document-body'));
  await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
  expect(query('[data-element-id="doc"]').classList.contains('is-selected')).toBe(true);
});

it('keeps a blank paper click in document reading without creating a history entry', async () => {
  const call = await mount();
  await pointer(reader(), 'pointerdown'); await pointer(viewport(), 'pointerup');
  expect(document.activeElement).toBe(reader()); expect(call).not.toHaveBeenCalled();
});

it('leaves selected paragraph text and controls to native input', async () => {
  const call = await mount();
  for (const selector of ['.studio-doc-prose p', '[aria-label="编辑文档"]', '[aria-label="展开文档"]', '[aria-label="导出文档"]']) {
    expect((await drag(query(selector))).defaultPrevented).toBe(false);
  }
  expect(call).not.toHaveBeenCalled();
});

it('keeps the native scrollbar gutter outside the paper drag area at 50 percent zoom', async () => {
  const call = await mount();
  const down = await pointer(reader(), 'pointerdown', 348, 120);
  await pointer(viewport(), 'pointermove', 348, 170); await pointer(viewport(), 'pointerup', 348, 170);
  expect(down.defaultPrevented).toBe(false); expect(call).not.toHaveBeenCalled();
});

it('preserves touch reading on selected blank paper', async () => {
  const call = await mount();
  expect((await drag(reader(), 'touch')).defaultPrevented).toBe(false);
  expect(call).not.toHaveBeenCalled();
});

it.each([{ locked: true }, { readOnly: true }])('keeps protected documents fixed for title and blank paper drags: %j', async protection => {
  const call = await mount(protection);
  await drag(query('.studio-document-title')); await drag(reader());
  expect(call).not.toHaveBeenCalled(); expect(board.elements[0]).toMatchObject({ x: 100, y: 80 });
});

it('keeps the expanded title as an input and does not move a focused document from its surfaces', async () => {
  const call = await mount();
  await act(async () => query('[aria-label="展开文档"]').click());
  const title = query('.studio-document-focus [aria-label="文档标题"]');
  expect(title).toBeInstanceOf(HTMLInputElement);
  expect((await drag(title)).defaultPrevented).toBe(false);
  expect((await drag(query('.studio-document-focus .studio-document-content'))).defaultPrevented).toBe(false);
  expect(call).not.toHaveBeenCalled();
});
