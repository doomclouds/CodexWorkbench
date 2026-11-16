import { expect, it, vi } from 'vitest';
import { DEFAULT_STYLE, type Board, type BoardElement } from '../src/contracts/studio.js';
import { NativeContentQueue } from '../src/app/canvas/content-queue.js';
const element = (id: string, version = 1): BoardElement => ({ id, type: 'shape', x: 0, y: 0, w: 100, h: 80, version });
const board = (version: number, elements: BoardElement[]): Board => ({ artifact: { id: 'layout', type: 'whiteboard', title: 'Layout', revision: version, createdAt: '', updatedAt: '', pinned: false }, elements, style: DEFAULT_STYLE });

it('sends layout read dependencies as strict CAS even when they are not modified', async () => {
  const before = board(1, [element('node'), element('external'), element('boundary')]);
  const send = vi.fn().mockResolvedValue({ board: before });
  const queue = new NativeContentQueue({ send, changed: () => {}, accepted: () => {} });
  await queue.enqueue(before, [{ op: 'update', id: 'node', changes: { x: 100 } }], '应用流程排布', before.elements, true, undefined, 'layout-request', { node: 1, external: 1, boundary: 1 });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ expectedVersions: { node: 1, external: 1, boundary: 1 } }));
  expect(send.mock.calls[0][0]).not.toHaveProperty('merge');
  expect(send.mock.calls[0][0].operations).toEqual([{ op: 'update', id: 'node', changes: { x: 100 } }]);
});

it('does not silently rebase a calculated layout onto an own later ACK', async () => {
  const old = board(1, [element('node')]), newer = board(2, [{ ...element('node', 2), x: 25 }]);
  const send = vi.fn().mockResolvedValueOnce({ board: newer }).mockRejectedValueOnce(Object.assign(new Error('stale preview'), { code: 'CONFLICT' }));
  const queue = new NativeContentQueue({ send, changed: () => {}, accepted: () => {} });
  await queue.enqueue(old, [{ op: 'update', id: 'node', changes: { x: 25 } }], '移动');
  await queue.enqueue(old, [{ op: 'update', id: 'node', changes: { x: 200 } }], '应用流程排布', old.elements, true, undefined, 'layout-old', { node: 1 });
  expect(send.mock.calls[1][0]).toMatchObject({ expectedVersions: { node: 1 }, operations: [{ changes: { x: 200 } }] });
  expect(send.mock.calls[1][0]).not.toHaveProperty('merge');
  expect(queue.tasks[0]).toMatchObject({ id: 'layout-old', state: 'failed', strictVersions: { node: 1 } });
});

it('keeps readonly layout dependencies out of write ownership without weakening their CAS', async () => {
  const before = board(1, [element('node'), element('external')]);
  let rejectLayout!: (cause: Error) => void;
  const pendingLayout = new Promise<never>((_resolve, reject) => { rejectLayout = reject; });
  const send = vi.fn().mockImplementationOnce(() => pendingLayout).mockResolvedValueOnce({ board: board(2, [element('node'), { ...element('external', 2), text: 'new external text' }]) });
  const queue = new NativeContentQueue({ send, changed: () => {}, accepted: () => {} });
  const layout = queue.enqueue(before, [{ op: 'update', id: 'node', changes: { x: 200 } }], '应用流程排布', before.elements, true, undefined, 'layout-readonly', { node: 1, external: 1, $order: 0 });
  expect(queue.tasks[0]!.keys).toEqual(['node']);
  const external = queue.enqueue(before, [{ op: 'update', id: 'external', changes: { text: 'new external text' } }], '编辑外部文字');
  await external;
  expect(send).toHaveBeenCalledTimes(2);
  rejectLayout(Object.assign(new Error('layout basis changed'), { code: 'CONFLICT' })); await layout;
  expect(queue.tasks[0]).toMatchObject({ id: 'layout-readonly', strictVersions: { node: 1, external: 1, $order: 0 }, state: 'failed' });
  expect(send.mock.calls[0][0]).toMatchObject({ expectedVersions: { node: 1, external: 1, $order: 0 } });
  expect(send.mock.calls[0][0]).not.toHaveProperty('merge');
});
