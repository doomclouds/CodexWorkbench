import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyContentIntent,
  NativeContentQueue,
  sameContentOperations,
  sameContentValue,
  sameWireContentValue,
  type ContentReceipt,
} from '../src/app/canvas/content-queue.js';
import {
  DEFAULT_STYLE,
  LOCAL_ACTOR,
  type Board,
  type BoardElement,
  type Operation,
} from '../src/contracts/studio.js';
import { StudioService } from '../src/core/service.js';

const element = (id = 'one', extra: Partial<BoardElement> = {}): BoardElement => ({
  id,
  type: 'text',
  x: 0,
  y: 0,
  w: 200,
  h: 100,
  version: 1,
  text: 'base',
  ...extra,
});
const board = (elements = [element()], revision = 1): Board => ({
  artifact: {
    id: 'board',
    title: 'Queue',
    type: 'whiteboard',
    revision,
    pinned: false,
    createdAt: '',
    updatedAt: '',
  },
  elements,
  style: DEFAULT_STYLE,
});
const operation = (id: string, changes: Partial<BoardElement>): Operation[] => [
  { op: 'update', id, changes },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });

  return { promise, resolve, reject };
}

const create = (send: (args: Record<string, unknown>) => Promise<ContentReceipt>) =>
  new NativeContentQueue({ send, changed() {}, accepted() {} });

describe('native content queue', () => {
  it("keeps document operations on their original CAS after a geometry ACK includes someone else's paragraph", async () => {
    const folder = await mkdtemp(join(tmpdir(), 'studio-document-ack-'));
    const target = resolve(folder);
    if (!target.startsWith(resolve(tmpdir()) + sep)) {
      throw new Error('Unexpected test folder');
    }

    const service = new StudioService({ dataRoot: folder });
    try {
      const created = (await service.execute(
        'artifact_manage',
        {
          action: 'create',
          title: 'Document ACK',
          elements: [
            element('one', {
              type: 'document',
              document: {
                schemaVersion: 1,
                blocks: [{ id: 'paragraph', type: 'paragraph', props: {}, content: 'base' }],
              },
            }),
          ],
        },
        LOCAL_ACTOR,
      )) as { board: Board };
      const base = created.board;
      const remote = { ...LOCAL_ACTOR, id: 'remote', name: '协作者', role: 'editor' as const };
      await service.execute(
        'artifact_apply',
        {
          artifactId: base.artifact.id,
          operationId: 'remote-paragraph',
          expectedVersions: { one: 1 },
          operations: [
            {
              op: 'document',
              id: 'one',
              data: {
                operations: [{ op: 'update', id: 'paragraph', changes: { content: 'remote' } }],
              },
            },
          ],
        },
        remote,
      );
      const received = deferred<ContentReceipt>();
      const release = deferred<void>();
      const send = vi.fn(async (args: Record<string, unknown>) => {
        const result = (await service.execute(
          'artifact_apply',
          args,
          LOCAL_ACTOR,
        )) as ContentReceipt;

        if (args.summary === 'geometry') {
          received.resolve(result);
          await release.promise;
        }

        return result;
      });
      const queue = create(send);
      const geometry = queue.enqueue(base, operation('one', { x: 40 }), 'geometry');
      const serverAck = await received.promise;
      expect(serverAck.board.elements[0]).toMatchObject({
        version: 3,
        x: 40,
        document: { blocks: [{ id: 'paragraph', content: 'remote' }] },
      });
      const blockOps: Operation[] = [
        {
          op: 'document',
          id: 'one',
          data: { operations: [{ op: 'update', id: 'paragraph', changes: { content: 'local' } }] },
        },
      ];
      const pending = queue.enqueue(base, blockOps, 'old document draft', base.elements);
      release.resolve();
      await geometry;
      expect(await pending).toBeNull();
      expect(send.mock.calls[1]![0]).toMatchObject({
        expectedVersions: { one: 1 },
        operations: blockOps,
      });
      expect(queue.tasks[0]).toMatchObject({
        state: 'failed',
        sources: [{ version: 1 }],
        operations: blockOps,
      });
      expect(queue.tasks[0]!.strictVersions).toBeUndefined();
      const saved = (await service.execute(
        'artifact_read',
        { artifactId: base.artifact.id, mode: 'objects', ids: ['one'] },
        LOCAL_ACTOR,
      )) as { elements: BoardElement[] };
      expect(saved.elements[0]).toMatchObject({
        version: 3,
        x: 40,
        document: { blocks: [{ content: 'remote' }] },
      });
    } finally {
      await service.close();
      await rm(target, { recursive: true, force: true });
    }
  });
  it('carries explicit gesture operation ids and keeps distinct equal gestures as distinct commits', async () => {
    const first = deferred<ContentReceipt>();
    const send = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ board: board([element('one', { version: 2, x: 10 })], 2) });
    const queue = create(send);
    const base = board();
    const operations = operation('one', { x: 10 });
    const a = queue.enqueue(base, operations, 'drag', base.elements, true, undefined, 'gesture-a');
    const b = queue.enqueue(base, operations, 'drag', base.elements, true, undefined, 'gesture-b');
    expect(queue.tasks.map((task) => task.id)).toEqual(['gesture-a', 'gesture-b']);
    expect(send.mock.calls[0]![0]).toMatchObject({ operationId: 'gesture-a' });
    first.resolve({ board: board([element('one', { version: 2, x: 10 })], 2) });
    await a;
    await b;
    expect(send.mock.calls[1]![0]).toMatchObject({
      operationId: 'gesture-b',
      expectedVersions: { one: 2 },
    });
  });
  it('shares a pending receipt when operation fields differ only by key order or omitted values', async () => {
    const response = deferred<ContentReceipt>();
    const receipt = { board: board([element('one', { version: 2, text: 'saved' })], 2) };
    const send = vi.fn().mockReturnValueOnce(response.promise).mockResolvedValue(receipt);
    const queue = create(send);
    const base = board();
    const first = queue.enqueue(
      base,
      operation('one', { text: 'saved', color: undefined, data: { a: 1, b: [2, 3] } }),
      'edit',
    );
    const equivalent = queue.enqueue(
      base,
      [{ changes: { data: { b: [2, 3], a: 1 }, text: 'saved' }, id: 'one', op: 'update' }],
      'edit',
    );
    response.resolve(receipt);

    await expect(first).resolves.toBe(receipt);
    await expect(equivalent).resolves.toBe(receipt);
    expect(equivalent).toBe(first);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps operation identity, operation order, and nested array positions in the wire comparison', () => {
    const edit: Operation = {
      op: 'update',
      id: 'one',
      data: { rows: [undefined, 2], public: true, optional: undefined },
    };
    const equivalent: Operation = {
      id: 'one',
      data: { public: true, rows: [null, 2] },
      op: 'update',
    };
    const move: Operation = { op: 'update', id: 'one', changes: { x: 10 } };

    expect(sameContentOperations([edit, move], [equivalent, move])).toBe(true);
    expect(sameContentOperations([edit, move], [move, equivalent])).toBe(false);
    expect(sameContentOperations([edit], [{ ...equivalent, id: 'two' }])).toBe(false);
    expect(
      sameContentOperations([edit], [{ ...equivalent, data: { public: true, rows: [2, null] } }]),
    ).toBe(false);
    expect(
      sameContentOperations(
        [edit],
        [{ ...equivalent, data: { public: true, rows: [null, 2], optional: null } }],
      ),
    ).toBe(false);
  });

  it('compares normalized canvas values and rebases entries without JSON encoding', () => {
    const base = { fill: 'blue', x: 10, data: { y: 20, count: 1 } };
    const equivalent = { data: { count: 1, y: 20 }, fill: 'blue', x: 10 };
    const remote = { fill: 'green', x: 10, data: { y: 30, count: 1 } };
    const edited = { ...equivalent, x: 11 };
    const encode = vi.spyOn(JSON, 'stringify');
    const decode = vi.spyOn(JSON, 'parse');
    let equal: boolean;
    let rebased: unknown;
    let wireCalls: number;
    try {
      equal = sameContentValue(base, equivalent);
      rebased = applyContentIntent(base, edited, remote);
      wireCalls = encode.mock.calls.length + decode.mock.calls.length;
    } finally {
      encode.mockRestore();
      decode.mockRestore();
    }

    expect(equal).toBe(true);
    expect(rebased).toEqual({ ...remote, x: 11 });
    expect(wireCalls).toBe(0);
  });

  it('preserves omitted fields and matches reordered operations beyond the structural depth limit', () => {
    let original: Record<string, unknown> = { x: 0, y: 1 };
    let equivalent: Record<string, unknown> = { y: 1, x: 0 };
    for (let depth = 0; depth < 72; depth++) {
      original = { node: original, depth, caption: undefined };
      equivalent = { depth, node: equivalent };
    }

    expect(sameWireContentValue(original, equivalent)).toBe(true);
    expect(
      sameContentOperations(
        [{ op: 'update', id: 'one', data: original }],
        [{ op: 'update', id: 'one', data: equivalent }],
      ),
    ).toBe(true);
  });

  it('settles an accepted receipt and drains the next edit after notification failures', async () => {
    const response = deferred<ContentReceipt>();
    const firstReceipt = { board: board([element('one', { version: 2, text: 'first' })], 2) };
    const nextReceipt = { board: board([element('one', { version: 3, text: 'next' })], 3) };
    const send = vi.fn().mockReturnValueOnce(response.promise).mockResolvedValue(nextReceipt);
    const ownerError = new Error('owner notification failed');
    const subscriberError = new Error('subscriber notification failed');
    const accepted = vi.fn().mockImplementationOnce(() => {
      throw ownerError;
    });
    const subscriber = vi.fn().mockImplementationOnce(() => {
      throw subscriberError;
    });
    const laterAccepted = vi.fn();
    const queue = new NativeContentQueue({ send, changed() {}, accepted });
    queue.subscribe({ accepted: subscriber, changed() {} });
    queue.subscribe({ accepted: laterAccepted, changed() {} });
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const base = board();
      const first = queue.enqueue(base, operation('one', { text: 'first' }), 'first');
      const next = queue.enqueue(base, operation('one', { text: 'next' }), 'next');
      response.resolve(firstReceipt);

      await expect(first).resolves.toBe(firstReceipt);
      await expect(next).resolves.toBe(nextReceipt);
      expect(laterAccepted.mock.calls.map(([, receipt]) => receipt)).toEqual([
        firstReceipt,
        nextReceipt,
      ]);
      expect(report.mock.calls.map(([, error]) => error)).toEqual([ownerError, subscriberError]);
      expect(send.mock.calls[1]![0]).toMatchObject({ expectedVersions: { one: 2 } });
      expect(queue.tasks).toHaveLength(0);
    } finally {
      report.mockRestore();
    }
  });

  it('still submits an edit and invokes later change listeners when a change listener throws', async () => {
    const receipt = { board: board([element('one', { version: 2, text: 'saved' })], 2) };
    const send = vi.fn().mockResolvedValue(receipt);
    const error = new Error('change notification failed');
    const changed = vi.fn().mockImplementationOnce(() => {
      throw error;
    });
    const laterChanged = vi.fn();
    const queue = create(send);
    queue.subscribe({ changed, accepted() {} });
    queue.subscribe({ changed: laterChanged, accepted() {} });
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        queue.enqueue(board(), operation('one', { text: 'saved' }), 'save'),
      ).resolves.toBe(receipt);
      expect(laterChanged).toHaveBeenCalled();
      expect(report.mock.calls.map(([, cause]) => cause)).toEqual([error]);
      expect(queue.tasks).toHaveLength(0);
    } finally {
      report.mockRestore();
    }
  });

  it('drains a queued history action when the previous history acknowledgment handler throws', async () => {
    const response = deferred<ContentReceipt>();
    const base = board();
    const firstReceipt = { board: board([element('one', { version: 2, text: 'first' })], 2) };
    const lastReceipt = { board: board([element('one', { version: 3, text: 'next' })], 3) };
    const send = vi.fn().mockReturnValueOnce(response.promise).mockResolvedValue(lastReceipt);
    const error = new Error('history notification failed');
    const rejected = vi.fn();
    const secondAccepted = vi.fn();
    const firstAccepted = vi.fn(() => {
      throw error;
    });
    const queue = create(send);
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      queue.enqueueHistory(base, 'first history action', {
        prepare: () => ({
          before: base,
          operations: operation('one', { text: 'first' }),
          summary: 'first history action',
          accepted: firstAccepted,
        }),
        rejected,
      });
      queue.enqueueHistory(base, 'next history action', {
        prepare: () => ({
          before: firstReceipt.board,
          operations: operation('one', { text: 'next' }),
          summary: 'next history action',
          accepted: secondAccepted,
        }),
        rejected,
      });
      response.resolve(firstReceipt);

      await vi.waitFor(() => expect(secondAccepted).toHaveBeenCalledWith(lastReceipt));
      expect(firstAccepted).toHaveBeenCalledWith(firstReceipt);
      expect(rejected).not.toHaveBeenCalled();
      expect(report.mock.calls.map(([, cause]) => cause)).toEqual([error]);
      expect(queue.tasks).toHaveLength(0);
    } finally {
      report.mockRestore();
    }
  });

  it('serializes one unit, drains later input and lets independent units save in parallel', async () => {
    const first = deferred<ContentReceipt>();
    const independent = deferred<ContentReceipt>();
    const next = deferred<ContentReceipt>();
    const send = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(independent.promise)
      .mockReturnValueOnce(next.promise);
    const queue = create(send);
    const base = board([element(), element('two')]);
    const a = queue.enqueue(base, operation('one', { text: 'first' }), 'first');
    const b = queue.enqueue(base, operation('one', { text: 'second' }), 'second');
    const c = queue.enqueue(base, operation('two', { fill: 'red' }), 'independent');
    expect(send).toHaveBeenCalledTimes(2);
    first.resolve({
      board: board([element('one', { version: 2, text: 'first' }), element('two')], 2),
    });
    await a;
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2]![0]).toMatchObject({
      expectedVersions: { one: 2 },
      merge: 'safe',
      operations: operation('one', { text: 'second' }),
    });
    independent.resolve({
      board: board([element(), element('two', { version: 2, fill: 'red' })], 3),
    });
    next.resolve({
      board: board(
        [
          element('one', { version: 3, text: 'second' }),
          element('two', { version: 2, fill: 'red' }),
        ],
        4,
      ),
    });
    await Promise.all([b, c]);
    expect(queue.tasks).toHaveLength(0);
  });

  it('replays exactly the original operation id and arguments after an uncertain response', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({ board: board([element('one', { version: 2, text: 'saved' })], 2) });
    const queue = create(send);
    const base = board();
    expect(await queue.enqueue(base, operation('one', { text: 'saved' }), 'edit')).toBeNull();
    expect(queue.tasks[0]).toMatchObject({ state: 'failed', error: 'Network unavailable' });
    const original = structuredClone(send.mock.calls[0]![0]);
    queue.observe(board([element('one', { version: 8, text: 'remote' })], 8));
    await queue.retry(queue.tasks[0]!.id);
    expect(send.mock.calls[1]![0]).toEqual(original);
    expect(queue.tasks).toHaveLength(0);
  });

  it('parks a pending same-field conflict introduced by a merged own ACK', async () => {
    const first = deferred<ContentReceipt>();
    const send = vi.fn().mockReturnValue(first.promise);
    const queue = create(send);
    const base = board([element('one', { data: { a: 0, b: 0 } })]);
    const a = queue.enqueue(base, operation('one', { data: { a: 1, b: 0 } }), 'a');
    const b = queue.enqueue(base, operation('one', { data: { a: 1, b: 1 } }), 'b');
    first.resolve({ board: board([element('one', { version: 3, data: { a: 1, b: 2 } })], 3) });
    await a;
    expect(await b).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.tasks[0]).toMatchObject({
      state: 'failed',
      sources: [{ version: 1 }],
      operations: operation('one', { data: { a: 1, b: 1 } }),
    });
  });

  it('preserves merged remote fields when a later own intention touches another path', async () => {
    const first = deferred<ContentReceipt>();
    const send = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({
        board: board([element('one', { version: 4, data: { a: 2, b: 2 } })], 4),
      });
    const queue = create(send);
    const base = board([element('one', { data: { a: 0, b: 0 } })]);
    const a = queue.enqueue(base, operation('one', { data: { a: 1, b: 0 } }), 'a');
    const b = queue.enqueue(base, operation('one', { data: { a: 2, b: 0 } }), 'later a');
    first.resolve({ board: board([element('one', { version: 3, data: { a: 1, b: 2 } })], 3) });
    await a;
    await b;
    expect(send.mock.calls[1]![0]).toMatchObject({
      expectedVersions: { one: 3 },
      operations: operation('one', { data: { a: 2, b: 2 } }),
    });
  });
  it('continues live text on its own line while preserving a remote line merged into an own ACK', async () => {
    const first = deferred<ContentReceipt>();
    const send = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ board: board([element('one', { version: 4, text: 'a2\nb1' })], 4) });
    const queue = create(send);
    const base = board([element('one', { text: 'a0\nb0' })]);
    const a = queue.enqueue(base, operation('one', { text: 'a1\nb0' }), 'first text');
    const b = queue.enqueue(base, operation('one', { text: 'a2\nb0' }), 'newer text');
    first.resolve({ board: board([element('one', { version: 3, text: 'a1\nb1' })], 3) });
    await a;
    await b;
    expect(send.mock.calls[1]![0]).toMatchObject({
      expectedVersions: { one: 3 },
      operations: operation('one', { text: 'a2\nb1' }),
    });
    await queue.enqueue(base, operation('one', { text: 'a3\nb0' }), 'third text');
    expect(send.mock.calls[2]![0]).toMatchObject({
      operations: operation('one', { text: 'a3\nb1' }),
    });
  });

  it('never treats an observed remote snapshot as an own ACK', async () => {
    const send = vi.fn().mockRejectedValue(new Error('CONFLICT'));
    const queue = create(send);
    const base = board();
    queue.observe(board([element('one', { version: 2, text: 'remote' })], 2));
    await queue.enqueue(base, operation('one', { text: 'mine' }), 'mine');
    expect(send.mock.calls[0]![0]).toMatchObject({ expectedVersions: { one: 1 } });
  });

  it('pauses queued work after revocation and retains it without submitting', async () => {
    const first = deferred<ContentReceipt>();
    const send = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ board: board([element('one', { version: 3, text: 'second' })], 3) });
    const queue = create(send);
    const base = board();
    const a = queue.enqueue(base, operation('one', { text: 'first' }), 'first');
    const b = queue.enqueue(base, operation('one', { text: 'second' }), 'second');
    queue.setEnabled(false);
    first.resolve({ board: board([element('one', { version: 2, text: 'first' })], 2) });
    await a;
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.tasks).toHaveLength(1);
    queue.setEnabled(true);
    await b;
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not promote a pending table cell onto a remote row identity change in an own ACK', async () => {
    const first = deferred<ContentReceipt>();
    const send = vi.fn().mockReturnValue(first.promise);
    const queue = create(send);
    const original = element('one', {
      type: 'table',
      data: { rows: [['A', 'B']], rowIds: ['original'], columnIds: ['a', 'b'] },
    });
    const base = board([original]);
    const a = queue.enqueue(base, operation('one', { color: 'red' }), 'color');
    const b = queue.enqueue(
      base,
      operation('one', { data: { ...original.data, rows: [['local A', 'B']] } }),
      'cell',
    );
    first.resolve({
      board: board(
        [
          {
            ...original,
            version: 3,
            color: 'red',
            data: { ...original.data, rows: [['replacement', 'B']], rowIds: ['replacement'] },
          },
        ],
        3,
      ),
    });
    await a;
    expect(await b).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.tasks[0]!.error).toContain('行列结构');
  });

  it('freezes indirect arrow targets for deletion and order targets through the real service', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'studio-native-targets-'));
    const service = new StudioService({ dataRoot: folder });
    try {
      const { board: initial } = (await service.execute('artifact_manage', {
        action: 'create',
        title: 'Targets',
        elements: [
          element('a'),
          element('b'),
          element('arrow', { type: 'arrow', from: 'a', to: 'b' }),
        ],
      })) as { board: Board };
      const send = vi.fn((args) => service.execute('artifact_apply', args));
      const queue = create(send);
      const deleted = await queue.enqueue(
        initial,
        [{ op: 'delete', id: 'a' }],
        'delete connected node',
        [initial.elements[0]!],
      );
      expect(deleted?.board.elements.map((item) => item.id)).toEqual(['b']);
      expect(send.mock.calls[0]![0]).toMatchObject({
        expectedVersions: { a: initial.elements[0]!.version, arrow: initial.elements[2]!.version },
      });
      const ordered = await queue.enqueue(
        initial,
        [{ op: 'layout', ids: ['b'], preset: 'front' }],
        'stale order',
      );
      expect(ordered).toBeNull();
      expect(send.mock.calls[1]![0]).toMatchObject({
        expectedVersions: { b: initial.elements[1]!.version, $order: initial.orderVersion },
      });
    } finally {
      await service.close();
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('merges two live clients on separate lines and separate stable table cells through the real service', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'studio-native-queue-'));
    const service = new StudioService({ dataRoot: folder });
    try {
      const { board: initial } = (await service.execute('artifact_manage', {
        action: 'create',
        title: 'Interleaving',
        elements: [
          element('text', { text: 'first\nsecond' }),
          element('table', {
            type: 'table',
            data: {
              rows: [
                ['A', 'B'],
                ['C', 'D'],
              ],
            },
          }),
        ],
      })) as { board: Board };
      const a = create((args) =>
        service.execute('artifact_apply', args, { ...LOCAL_ACTOR, id: 'a' }),
      );
      const b = create((args) =>
        service.execute('artifact_apply', args, { ...LOCAL_ACTOR, id: 'b' }),
      );
      const table = initial.elements.find((item) => item.id === 'table')!;
      const receipts = await Promise.all([
        a.enqueue(initial, operation('text', { text: 'A first\nsecond' }), 'A text'),
        b.enqueue(initial, operation('text', { text: 'first\nB second' }), 'B text'),
        a.enqueue(
          initial,
          operation('table', {
            data: {
              ...table.data,
              rows: [
                ['A local', 'B'],
                ['C', 'D'],
              ],
            },
          }),
          'A cell',
        ),
        b.enqueue(
          initial,
          operation('table', {
            data: {
              ...table.data,
              rows: [
                ['A', 'B'],
                ['C', 'B local'],
              ],
            },
          }),
          'B cell',
        ),
      ]);
      expect(receipts.every(Boolean)).toBe(true);
      const latest = (await service.execute('artifact_read', {
        artifactId: initial.artifact.id,
      })) as Board;
      expect(latest.elements.find((item) => item.id === 'text')!.text).toBe('A first\nB second');
      expect(latest.elements.find((item) => item.id === 'table')!.data?.rows).toEqual([
        ['A local', 'B'],
        ['C', 'B local'],
      ]);
      const stale = create((args) =>
        service.execute('artifact_apply', args, { ...LOCAL_ACTOR, id: 'stale' }),
      );
      expect(
        await stale.enqueue(initial, operation('text', { text: 'clobber\nsecond' }), 'same line'),
      ).toBeNull();
      expect(
        (
          (await service.execute('artifact_read', { artifactId: initial.artifact.id })) as Board
        ).elements.find((item) => item.id === 'text')!.text,
      ).toBe('A first\nB second');
    } finally {
      await service.close();
      await rm(folder, { recursive: true, force: true });
    }
  });
});
