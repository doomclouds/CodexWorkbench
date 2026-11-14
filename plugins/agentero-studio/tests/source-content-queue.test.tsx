// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NativeContentQueue } from '../src/app/canvas/content-queue.js';
import { DEFAULT_STYLE, LOCAL_ACTOR, type Board, type StudioClient } from '../src/contracts/studio.js';

let exposed: NativeContentQueue;
vi.mock('../src/app/canvas/WhiteboardCanvas', () => ({ default: ({ board, contentQueue, onEditHtml }: { board: Board; contentQueue: NativeContentQueue; onEditHtml: (element?: Board['elements'][number]) => void }) => { exposed = contentQueue; return <><button onClick={() => onEditHtml(board.elements[0])}>编辑源码</button><button onClick={() => onEditHtml()}>新增源码</button></>; } }));
import { whiteboardProduct } from '../src/app/products/whiteboard.js';
const makeBoard = (html = '<p>old</p>', revision = 1): Board => ({ artifact: { id: 'source-board', title: 'Source', type: 'whiteboard', revision, pinned: false, createdAt: '', updatedAt: '' }, elements: [{ id: 'region', type: 'html', x: 0, y: 0, w: 400, h: 300, version: revision, html, text: 'Region', state: { votes: 0 } }], style: DEFAULT_STYLE });
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const button = (text: string) => [...host.querySelectorAll('button')].find(node => node.textContent === text)!;
async function click(text: string) { await act(async () => button(text).click()); }
async function change(value: string) { await act(async () => { const textarea = host.querySelector<HTMLTextAreaElement>('#studio-html-source')!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value); textarea.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function submit() { await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
async function mount(board: Board, call: StudioClient['call']) { const Editor = whiteboardProduct.Editor; await act(async () => root.render(<Editor document={board} client={{ embedded: true, call }} actor={LOCAL_ACTOR} presence={[]} selfPeerId="self" onChanged={() => {}} onAnnotate={() => {}} onSelectionChange={() => {}} onViewportChange={() => {}} onCursorMove={() => {}} />)); }

it('shares one singleflight unit between native embed state and completed HTML source saves', async () => {
  let resolveFirst!: (value: { board: Board }) => void;
  const initial = makeBoard(), next = makeBoard('<p>new</p>', 3); next.elements[0]!.state = { votes: 1 };
  const writes: Record<string, unknown>[] = [];
  const call = vi.fn(async (name, args) => { if (name === 'artifact_read') return { html: '<p>old</p>' }; writes.push(args); if (writes.length === 1) return new Promise(resolve => { resolveFirst = resolve; }); return { board: next }; }) as StudioClient['call'];
  await mount(initial, call); await click('编辑源码');
  let native!: Promise<unknown>;
  await act(async () => { native = exposed.enqueue(initial, [{ op: 'update', id: 'region', changes: { state: { votes: 1 } } }], 'state'); });
  await change('<p>new</p>'); await submit(); expect(writes).toHaveLength(1);
  const first = makeBoard('<p>old</p>', 2); first.elements[0]!.state = { votes: 1 };
  await act(async () => { resolveFirst({ board: first }); await native; });
  expect(writes).toHaveLength(2); expect(writes[1]).toMatchObject({ expectedVersions: { region: 2 }, merge: 'safe', operations: [{ op: 'update', id: 'region', changes: { html: '<p>new</p>' } }] });
  expect(host.querySelector('#studio-html-source')).toBeNull();
});

it('reuses the original add receipt before saving a newer source draft under the same new element id', async () => {
  const initial = { ...makeBoard(), elements: [] }, writes: Record<string, any>[] = [];
  const call = vi.fn(async (_name, args) => { writes.push(args!); if (writes.length === 1) throw new Error('Network response lost'); const id = writes[0]!.operations[0].element.id; return { board: { ...initial, artifact: { ...initial.artifact, revision: writes.length }, elements: [{ ...writes[0]!.operations[0].element, id, version: writes.length - 1, html: writes.length === 3 ? '<p>second</p>' : '<p>first</p>' }] } }; }) as StudioClient['call'];
  await mount(initial, call); await click('新增源码'); await change('<p>first</p>'); await submit();
  await change('<p>second</p>'); await submit();
  expect(writes).toHaveLength(3); expect(writes[1]).toEqual(writes[0]);
  expect(writes[2]).toMatchObject({ expectedVersions: { [writes[0]!.operations[0].element.id]: 1 }, operations: [{ op: 'update', id: writes[0]!.operations[0].element.id, changes: { html: '<p>second</p>' } }] });
  expect(writes[2]!.operationId).not.toBe(writes[0]!.operationId); expect(host.querySelector('#studio-html-source')).toBeNull();
});
