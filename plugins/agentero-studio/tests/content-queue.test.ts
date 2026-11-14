import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NativeContentQueue, type ContentReceipt } from '../src/app/canvas/content-queue.js';
import { DEFAULT_STYLE, LOCAL_ACTOR, type Board, type BoardElement, type Operation } from '../src/contracts/studio.js';
import { StudioService } from '../src/core/service.js';

const element = (id = 'one', extra: Partial<BoardElement> = {}): BoardElement => ({ id, type: 'text', x: 0, y: 0, w: 200, h: 100, version: 1, text: 'base', ...extra });
const board = (elements = [element()], revision = 1): Board => ({ artifact: { id: 'board', title: 'Queue', type: 'whiteboard', revision, pinned: false, createdAt: '', updatedAt: '' }, elements, style: DEFAULT_STYLE });
const operation = (id: string, changes: Partial<BoardElement>): Operation[] => [{ op: 'update', id, changes }];
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const create = (send: (args: Record<string, unknown>) => Promise<ContentReceipt>) => new NativeContentQueue({ send, changed() {}, accepted() {} });

describe('native content queue', () => {
  it('serializes one unit, drains later input and lets independent units save in parallel', async () => {
    const first = deferred<ContentReceipt>(), independent = deferred<ContentReceipt>(), next = deferred<ContentReceipt>();
    const send = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(independent.promise).mockReturnValueOnce(next.promise), queue = create(send), base = board([element(), element('two')]);
    const a = queue.enqueue(base, operation('one', { text: 'first' }), 'first');
    const b = queue.enqueue(base, operation('one', { text: 'second' }), 'second');
    const c = queue.enqueue(base, operation('two', { fill: 'red' }), 'independent');
    expect(send).toHaveBeenCalledTimes(2);
    first.resolve({ board: board([element('one', { version: 2, text: 'first' }), element('two')], 2) }); await a;
    expect(send).toHaveBeenCalledTimes(3); expect(send.mock.calls[2]![0]).toMatchObject({ expectedVersions: { one: 2 }, merge: 'safe', operations: operation('one', { text: 'second' }) });
    independent.resolve({ board: board([element(), element('two', { version: 2, fill: 'red' })], 3) }); next.resolve({ board: board([element('one', { version: 3, text: 'second' }), element('two', { version: 2, fill: 'red' })], 4) });
    await Promise.all([b, c]); expect(queue.tasks).toHaveLength(0);
  });

  it('replays exactly the original operation id and arguments after an uncertain response', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce({ board: board([element('one', { version: 2, text: 'saved' })], 2) }), queue = create(send), base = board();
    expect(await queue.enqueue(base, operation('one', { text: 'saved' }), 'edit')).toBeNull();
    const original = structuredClone(send.mock.calls[0]![0]);
    queue.observe(board([element('one', { version: 8, text: 'remote' })], 8));
    await queue.retry(queue.tasks[0]!.id);
    expect(send.mock.calls[1]![0]).toEqual(original); expect(queue.tasks).toHaveLength(0);
  });

  it('parks a pending same-field conflict introduced by a merged own ACK', async () => {
    const first = deferred<ContentReceipt>(), send = vi.fn().mockReturnValue(first.promise), queue = create(send), base = board([element('one', { data: { a: 0, b: 0 } })]);
    const a = queue.enqueue(base, operation('one', { data: { a: 1, b: 0 } }), 'a');
    const b = queue.enqueue(base, operation('one', { data: { a: 1, b: 1 } }), 'b');
    first.resolve({ board: board([element('one', { version: 3, data: { a: 1, b: 2 } })], 3) });
    await a; expect(await b).toBeNull(); expect(send).toHaveBeenCalledTimes(1);
    expect(queue.tasks[0]).toMatchObject({ state: 'failed', sources: [{ version: 1 }], operations: operation('one', { data: { a: 1, b: 1 } }) });
  });

  it('preserves merged remote fields when a later own intention touches another path', async () => {
    const first = deferred<ContentReceipt>(), send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ board: board([element('one', { version: 4, data: { a: 2, b: 2 } })], 4) }), queue = create(send), base = board([element('one', { data: { a: 0, b: 0 } })]);
    const a = queue.enqueue(base, operation('one', { data: { a: 1, b: 0 } }), 'a');
    const b = queue.enqueue(base, operation('one', { data: { a: 2, b: 0 } }), 'later a');
    first.resolve({ board: board([element('one', { version: 3, data: { a: 1, b: 2 } })], 3) }); await a; await b;
    expect(send.mock.calls[1]![0]).toMatchObject({ expectedVersions: { one: 3 }, operations: operation('one', { data: { a: 2, b: 2 } }) });
  });
  it('continues live text on its own line while preserving a remote line merged into an own ACK', async () => {
    const first = deferred<ContentReceipt>(), send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ board: board([element('one', { version: 4, text: 'a2\nb1' })], 4) }), queue = create(send), base = board([element('one', { text: 'a0\nb0' })]);
    const a = queue.enqueue(base, operation('one', { text: 'a1\nb0' }), 'first text');
    const b = queue.enqueue(base, operation('one', { text: 'a2\nb0' }), 'newer text');
    first.resolve({ board: board([element('one', { version: 3, text: 'a1\nb1' })], 3) }); await a; await b;
    expect(send.mock.calls[1]![0]).toMatchObject({ expectedVersions: { one: 3 }, operations: operation('one', { text: 'a2\nb1' }) });
    await queue.enqueue(base, operation('one', { text: 'a3\nb0' }), 'third text');
    expect(send.mock.calls[2]![0]).toMatchObject({ operations: operation('one', { text: 'a3\nb1' }) });
  });

  it('never treats an observed remote snapshot as an own ACK', async () => {
    const send = vi.fn().mockRejectedValue(new Error('CONFLICT')), queue = create(send), base = board();
    queue.observe(board([element('one', { version: 2, text: 'remote' })], 2));
    await queue.enqueue(base, operation('one', { text: 'mine' }), 'mine');
    expect(send.mock.calls[0]![0]).toMatchObject({ expectedVersions: { one: 1 } });
  });

  it('pauses queued work after revocation and retains it without submitting', async () => {
    const first = deferred<ContentReceipt>(), send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ board: board([element('one', { version: 3, text: 'second' })], 3) }), queue = create(send), base = board();
    const a = queue.enqueue(base, operation('one', { text: 'first' }), 'first');
    const b = queue.enqueue(base, operation('one', { text: 'second' }), 'second');
    queue.setEnabled(false); first.resolve({ board: board([element('one', { version: 2, text: 'first' })], 2) }); await a;
    expect(send).toHaveBeenCalledTimes(1); expect(queue.tasks).toHaveLength(1);
    queue.setEnabled(true); await b; expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not promote a pending table cell onto a remote row identity change in an own ACK', async () => {
    const first = deferred<ContentReceipt>(), send = vi.fn().mockReturnValue(first.promise), queue = create(send);
    const original = element('one', { type: 'table', data: { rows: [['A', 'B']], rowIds: ['original'], columnIds: ['a', 'b'] } }), base = board([original]);
    const a = queue.enqueue(base, operation('one', { color: 'red' }), 'color');
    const b = queue.enqueue(base, operation('one', { data: { ...original.data, rows: [['local A', 'B']] } }), 'cell');
    first.resolve({ board: board([{ ...original, version: 3, color: 'red', data: { ...original.data, rows: [['replacement', 'B']], rowIds: ['replacement'] } }], 3) });
    await a; expect(await b).toBeNull(); expect(send).toHaveBeenCalledTimes(1); expect(queue.tasks[0]!.error).toContain('行列结构');
  });

  it('freezes indirect arrow targets for deletion and order targets through the real service', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'studio-native-targets-')), service = new StudioService({ dataRoot: folder });
    try {
      const { board: initial } = await service.execute('artifact_manage', { action: 'create', title: 'Targets', elements: [element('a'), element('b'), element('arrow', { type: 'arrow', from: 'a', to: 'b' })] }) as { board: Board };
      const send = vi.fn(args => service.execute('artifact_apply', args)), queue = create(send);
      const deleted = await queue.enqueue(initial, [{ op: 'delete', id: 'a' }], 'delete connected node', [initial.elements[0]!]);
      expect(deleted?.board.elements.map(item => item.id)).toEqual(['b']);
      expect(send.mock.calls[0]![0]).toMatchObject({ expectedVersions: { a: initial.elements[0]!.version, arrow: initial.elements[2]!.version } });
      const ordered = await queue.enqueue(initial, [{ op: 'layout', ids: ['b'], preset: 'front' }], 'stale order');
      expect(ordered).toBeNull();
      expect(send.mock.calls[1]![0]).toMatchObject({ expectedVersions: { b: initial.elements[1]!.version, $order: initial.orderVersion } });
    } finally { await service.close(); await rm(folder, { recursive: true, force: true }); }
  });

  it('merges two live clients on separate lines and separate stable table cells through the real service', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'studio-native-queue-')), service = new StudioService({ dataRoot: folder });
    try {
      const { board: initial } = await service.execute('artifact_manage', { action: 'create', title: 'Interleaving', elements: [element('text', { text: 'first\nsecond' }), element('table', { type: 'table', data: { rows: [['A', 'B'], ['C', 'D']] } })] }) as { board: Board };
      const a = create(args => service.execute('artifact_apply', args, { ...LOCAL_ACTOR, id: 'a' })), b = create(args => service.execute('artifact_apply', args, { ...LOCAL_ACTOR, id: 'b' }));
      const table = initial.elements.find(item => item.id === 'table')!;
      const receipts = await Promise.all([
        a.enqueue(initial, operation('text', { text: 'A first\nsecond' }), 'A text'),
        b.enqueue(initial, operation('text', { text: 'first\nB second' }), 'B text'),
        a.enqueue(initial, operation('table', { data: { ...table.data, rows: [['A local', 'B'], ['C', 'D']] } }), 'A cell'),
        b.enqueue(initial, operation('table', { data: { ...table.data, rows: [['A', 'B'], ['C', 'B local']] } }), 'B cell'),
      ]);
      expect(receipts.every(Boolean)).toBe(true);
      const latest = await service.execute('artifact_read', { artifactId: initial.artifact.id }) as Board;
      expect(latest.elements.find(item => item.id === 'text')!.text).toBe('A first\nB second');
      expect(latest.elements.find(item => item.id === 'table')!.data?.rows).toEqual([['A local', 'B'], ['C', 'B local']]);
      const stale = create(args => service.execute('artifact_apply', args, { ...LOCAL_ACTOR, id: 'stale' }));
      expect(await stale.enqueue(initial, operation('text', { text: 'clobber\nsecond' }), 'same line')).toBeNull();
      expect((await service.execute('artifact_read', { artifactId: initial.artifact.id }) as Board).elements.find(item => item.id === 'text')!.text).toBe('A first\nB second');
    } finally { await service.close(); await rm(folder, { recursive: true, force: true }); }
  });
});
