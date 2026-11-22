import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STYLE,
  LOCAL_ACTOR,
  STUDIO_TOOLS,
  type Board,
  type BoardElement,
  type StudioClient,
  type UnitSaveReceipt,
} from '../../src/contracts/studio.js';
import { createStudioToolCall } from '../../src/app/transport/tool-response.js';
import {
  sendCanvasSave,
  verifyCanvasSave,
} from '../../src/app/features/whiteboard/save-receipt.js';
import { NativeContentQueue } from '../../src/app/features/whiteboard/canvas/sync/content-queue.js';

const changed: BoardElement = { id: 'box', type: 'note', x: 10, y: 0, w: 30, h: 20, version: 2 };
const unchanged: BoardElement = { ...changed, id: 'neighbor', x: 40, version: 1 };

function board(revision: number, item: BoardElement = changed): Board {
  return {
    artifact: {
      id: 'drawing',
      type: 'whiteboard',
      title: '白板',
      revision,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      pinned: false,
    },
    style: DEFAULT_STYLE,
    elements: [item, unchanged],
  };
}

const original = board(1, { ...changed, version: 1, x: 0 });
const committed = board(2);
const operations = [{ op: 'update', id: 'box', changes: { x: 10 } }] as const;
const intent = {
  artifactId: 'drawing',
  operationId: 'save-1',
  operations,
  summary: '移动',
  merge: 'safe',
} as const;

function compact(args: Record<string, unknown>): UnitSaveReceipt {
  return {
    receiptFormat: 'units-v1',
    operationId: String(args.operationId),
    baseRevision: 1,
    artifact: committed.artifact,
    historyEntry: {
      id: 'commit-2',
      revision: 2,
      createdAt: '2025-01-01T00:00:00.000Z',
      actor: LOCAL_ACTOR,
      summary: '移动',
      changedIds: [changed.id],
    },
    units: [{ id: changed.id, after: changed }],
  };
}

type Send = (name: string, args: Record<string, unknown>) => Promise<unknown>;

function clientWith(send: Send) {
  const call = vi.fn(send);
  const client: StudioClient = { embedded: false, call: call as StudioClient['call'] };

  return { client, call };
}

function queueWith(client: StudioClient, getBoard = () => original) {
  return new NativeContentQueue({
    send: (args) => sendCanvasSave(client, getBoard, args),
    confirm: (args) => verifyCanvasSave(client, getBoard, args),
    changed() {},
    accepted() {},
  });
}

function move(queue: NativeContentQueue) {
  return queue.enqueue(
    original,
    [...operations],
    '移动',
    original.elements,
    true,
    undefined,
    intent.operationId,
  );
}

describe('whiteboard incremental save receipts', () => {
  it('projects onto the exact predecessor and reuses unchanged elements without a second request', async () => {
    const { client, call } = clientWith(async (_name, args) => compact(args));
    const saved = await sendCanvasSave(client, () => original, intent);

    expect(saved.board).toEqual(committed);
    expect(saved.board.elements[1]).toBe(unchanged);
    expect(saved.historyEntry).toMatchObject({ id: 'commit-2', revision: 2 });
    expect(call.mock.calls).toEqual([
      [STUDIO_TOOLS.apply, { ...intent, receiptFormat: 'units-v1' }],
    ]);
    expect(intent).not.toHaveProperty('receiptFormat');
  });

  it('returns the authoritative board already at the commit revision after checking the units', async () => {
    const { client, call } = clientWith(async (_name, args) => compact(args));
    const saved = await sendCanvasSave(client, () => committed, intent);
    expect(saved.board).toBe(committed);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it.each([board(4), board(2, { ...changed, x: 99 }), { ...original, elements: [unchanged] }])(
    'reads the exact retained revision for an incompatible local snapshot',
    async (current) => {
      const { client, call } = clientWith(async (name, args) =>
        name === STUDIO_TOOLS.apply ? compact(args) : { board: committed },
      );
      const saved = await sendCanvasSave(client, () => current, intent);
      expect(saved.board).toBe(committed);
      expect(call.mock.calls.at(-1)).toEqual([
        STUDIO_TOOLS.read,
        { mode: 'version', artifactId: 'drawing', versionId: 'commit-2' },
      ]);
      expect(call).toHaveBeenCalledTimes(2);
    },
  );

  it('keeps a committed edit recoverable when the exact snapshot is unavailable and retries read-only', async () => {
    let canReadVersion = false;
    const { client, call } = clientWith(async (name, args) => {
      if (name === STUDIO_TOOLS.apply || args.mode === 'operation-receipt') {
        return compact(args);
      }

      return { board: canReadVersion ? committed : board(4) };
    });
    const queue = queueWith(client, () => board(4));

    await expect(move(queue)).resolves.toBeNull();
    const task = queue.tasks[0]!;
    expect(task).toMatchObject({
      state: 'failed',
      recovered: true,
      failure: { code: 'COMMIT_RESULT_UNKNOWN' },
    });
    expect(task.args).not.toHaveProperty('receiptFormat');

    canReadVersion = true;
    await expect(queue.retry(task.id)).resolves.toMatchObject({ board: committed });
    expect(call.mock.calls.filter(([name]) => name === STUDIO_TOOLS.apply)).toHaveLength(1);
    expect(call.mock.calls[2]).toEqual([
      STUDIO_TOOLS.read,
      { ...intent, mode: 'operation-receipt', receiptFormat: 'units-v1' },
    ]);
  });

  it.each([
    new TypeError('Failed to fetch'),
    Object.assign(new Error('Host disconnected'), { code: 'NETWORK_ERROR' }),
    Object.assign(new Error('Host timed out'), { code: 'TIMEOUT' }),
  ])('only consults the original receipt on retry after %s', async (failure) => {
    const { client, call } = clientWith(async (name, args) => {
      if (name === STUDIO_TOOLS.apply) {
        throw failure;
      }

      return compact(args);
    });
    const queue = queueWith(client);
    await expect(move(queue)).resolves.toBeNull();
    expect(queue.tasks[0]).toMatchObject({
      recovered: true,
      failure: { code: 'COMMIT_RESULT_UNKNOWN' },
    });
    await expect(queue.retry(intent.operationId)).resolves.toMatchObject({ board: committed });
    expect(call.mock.calls.map(([name]) => name)).toEqual([STUDIO_TOOLS.apply, STUDIO_TOOLS.read]);
  });

  it('keeps definite service rejections and accepts the original board shape from old services', async () => {
    let rejected = true;
    const { client, call } = clientWith(async () => {
      if (rejected) {
        throw Object.assign(new Error('当前无权编辑。'), { code: 'FORBIDDEN', status: 403 });
      }

      return { board: committed };
    });
    const queue = queueWith(client);
    await expect(move(queue)).resolves.toBeNull();
    expect(queue.tasks[0]?.recovered).toBeUndefined();
    expect(queue.tasks[0]?.failure).toMatchObject({ code: 'FORBIDDEN' });

    rejected = false;
    await expect(queue.retry(intent.operationId)).resolves.toMatchObject({ board: committed });
    expect(call.mock.calls).toHaveLength(2);
    expect(call.mock.calls[0]).toEqual(call.mock.calls[1]);
  });

  it('permits a compact operation receipt only for an opt-in transport caller', async () => {
    const call = createStudioToolCall(async (_name, args, read) =>
      read(Response.json({ ok: true, data: compact(args) })),
    );
    const { client } = clientWith(call as Send);
    await expect(verifyCanvasSave(client, () => original, intent)).resolves.toMatchObject({
      board: committed,
    });
    const request = { ...intent, mode: 'operation-receipt' as const, operations: [...operations] };
    await expect(call(STUDIO_TOOLS.read, request)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
