// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_STYLE, LOCAL_ACTOR, type Board, type BoardElement } from '../src/contracts/studio.js';
import { NativeContentQueue, type ContentTask } from '../src/app/canvas/content-queue.js';
import WhiteboardCanvas from '../src/app/canvas/WhiteboardCanvas.js';
import ContentConflictDialog from '../src/app/canvas/ContentConflictDialog.js';

let host: HTMLDivElement, root: Root;
const node: BoardElement = { id: 'node', type: 'shape', x: 0, y: 0, w: 200, h: 100, version: 1, text: 'original' };
const board: Board = { artifact: { id: 'layout-recovery', title: 'Layout recovery', type: 'whiteboard', revision: 1, createdAt: '', updatedAt: '', pinned: false }, style: DEFAULT_STYLE, elements: [node], orderVersion: 0 };
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout); localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!;
async function click(label: string) { await act(async () => button(label).click()); }

it('offers strict layout recovery without a generic overwrite or save-as bypass', async () => {
  const task: ContentTask = { id: 'layout', before: board, sources: [node], keys: ['node'], operations: [{ op: 'update', id: 'node', changes: { x: 200 } }], summary: '应用流程排布', remember: true, state: 'failed', strictVersions: { node: 1, $order: 0 } };
  const overwrite = vi.fn();
  await act(async () => root.render(<ContentConflictDialog task={task} current={board} onKeep={() => {}} onRemote={() => {}} onCopy={() => {}} onOverwrite={overwrite} disabled={false} />));
  expect(host.textContent).toContain('重新预览');
  expect(button('明确用我的草稿覆盖此处')).toBeUndefined(); expect(button('另存为新对象')).toBeUndefined();
  expect(button('保留草稿')).toBeDefined(); expect(button('采用当前已保存内容')).toBeDefined(); expect(overwrite).not.toHaveBeenCalled();
});

it('discarding a paused failed layout retains a later independent editing draft', async () => {
  let finishText!: (value: { board: Board }) => void;
  const textReceipt = new Promise<{ board: Board }>(resolve => { finishText = resolve; });
  const send = vi.fn().mockRejectedValueOnce(new Error('network unavailable')).mockImplementationOnce(() => textReceipt);
  const queue = new NativeContentQueue({ send, changed: () => {}, accepted: () => {} });
  await queue.enqueue(board, [{ op: 'update', id: 'node', changes: { x: 200 } }], '应用流程排布', board.elements, true, undefined, 'failed-layout', { node: 1, $order: 0 });
  queue.setEnabled(false);
  const text = queue.enqueue(board, [{ op: 'update', id: 'node', changes: { text: 'newer text draft' } }], '编辑文字', board.elements, true, undefined, 'later-text');
  const client = { embedded: true, call: vi.fn() };
  await act(async () => root.render(<WhiteboardCanvas board={board} client={client} actor={LOCAL_ACTOR} readOnly contentQueue={queue} onChanged={() => {}} onAnnotate={() => {}} />));
  await click('比较双方内容'); await click('采用当前已保存内容');
  expect(queue.tasks.map(item => item.id)).toEqual(['later-text']);
  expect(queue.tasks[0]!.operations).toEqual([{ op: 'update', id: 'node', changes: { text: 'newer text draft' } }]);
  await act(async () => { queue.setEnabled(true); finishText({ board: { ...board, artifact: { ...board.artifact, revision: 2 }, elements: [{ ...node, text: 'newer text draft', version: 2 }] } }); await text; });
  expect(send).toHaveBeenCalledTimes(2);
});
