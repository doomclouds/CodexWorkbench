import { expect, test } from 'vitest';
import { createMcpTransport, observeMcpRoomSnapshots } from '../../src/platform/mcp/index.js';

const chunkSize = 128 * 1024;
const boardPath = '/luming.studio.v1.WhiteboardService/GetBoardScene';
const sessionId = 'panel-session';
const bodyMime = 'application/protobuf';

type Options = Parameters<typeof createMcpTransport>[0];
type Frame = Parameters<Options['call']>[0];

function binaryResponse(response: Readonly<Record<string, unknown>>) {
  return { content: [], structuredContent: { ok: true }, _meta: { response } };
}

function inlineResponse(content: string, mimeType = bodyMime) {
  return binaryResponse({
    status: 200,
    contentType: mimeType,
    size: content.length,
    body: btoa(content),
  });
}

function transport(call: Options['call']) {
  const lifetime = new AbortController();
  const invalidated: string[] = [];
  const client = createMcpTransport({
    call,
    session: async () => ({ id: sessionId, expiresAtMillis: Number.MAX_SAFE_INTEGER }),
    invalidateSession: (id) => invalidated.push(id),
    lifetime: lifetime.signal,
  });

  return { client, lifetime, invalidated };
}

test('sends a declared service and method without forwarding a URL or headers', async () => {
  const frames: Frame[] = [];
  const { client } = transport(async (frame) => {
    frames.push(frame);
    return inlineResponse('scene');
  });

  await expect(
    client.postProtobuf('http://127.0.0.1:7090' + boardPath, new Uint8Array()),
  ).rejects.toThrow('已声明的 Protobuf 服务');
  expect(frames).toHaveLength(0);

  const bytes = await client.postProtobuf(boardPath, new Uint8Array([1, 2, 3]));
  expect(frames[0]).toEqual({
    action: 'request',
    version: 1,
    sessionId,
    service: 'luming.studio.v1.WhiteboardService',
    method: 'GetBoardScene',
    body: 'AQID',
    uploadId: undefined,
  });
  expect(new TextDecoder().decode(bytes)).toBe('scene');
});

test('permits human review and keeps proposal submission off the app-only bridge', async () => {
  const service = '/luming.studio.v1.BoardSuggestionService/';
  const frames: Frame[] = [];
  const { client } = transport(async (frame) => {
    frames.push(frame);
    return inlineResponse('preview');
  });

  await expect(
    client.postProtobuf(service + 'SubmitBoardSuggestion', new Uint8Array()),
  ).rejects.toThrow('建议评审操作');
  await client.postProtobuf(service + 'PreviewBoardSuggestion', new Uint8Array());
  expect(frames).toEqual([
    expect.objectContaining({
      service: 'luming.studio.v1.BoardSuggestionService',
      method: 'PreviewBoardSuggestion',
    }),
  ]);
});

test('transfers large data with checked offsets and releases the temporary transfers', async () => {
  const frames: Frame[] = [];
  const size = chunkSize + 3;
  const input = new Uint8Array(size).fill(97);
  const { client } = transport(async (frame) => {
    frames.push(frame);
    switch (frame.action) {
      case 'upload': {
        const { offset, data } = frame;
        if (typeof offset !== 'number' || typeof data !== 'string') {
          throw new Error('Expected an upload part with its byte offset.');
        }

        const decoded = atob(data);
        expect(decoded).toBe('a'.repeat(Math.min(size - offset, chunkSize)));
        return {
          structuredContent: { ok: true },
          _meta: { transfer: { transferId: 'upload-id', nextOffset: offset + decoded.length } },
        };
      }
      case 'request':
        expect(frame.uploadId).toBe('upload-id');
        expect(frame.body).toBeUndefined();
        return binaryResponse({
          status: 200,
          contentType: bodyMime,
          size,
          downloadId: 'download-id',
        });
      case 'download': {
        const { offset } = frame;
        if (typeof offset !== 'number') {
          throw new Error('Expected the download part offset.');
        }

        const length = Math.min(size - offset, chunkSize);
        const nextOffset = offset + length;
        return {
          structuredContent: { ok: true },
          _meta: {
            chunk: { data: btoa('b'.repeat(length)), nextOffset, done: nextOffset === size },
          },
        };
      }
      case 'release':
        return { structuredContent: { ok: true } };
      default:
        throw new Error('Unexpected transport operation.');
    }
  });

  const bytes = await client.postProtobuf(boardPath, input);
  expect(bytes.byteLength).toBe(size);
  expect(bytes.every((byte) => byte === 98)).toBe(true);
  expect(frames.map(({ action }) => action)).toEqual([
    'upload',
    'upload',
    'request',
    'download',
    'download',
    'release',
    'release',
  ]);
  expect(frames.slice(-2).map(({ transferId }) => transferId)).toEqual([
    'download-id',
    'upload-id',
  ]);
});

test('refuses an oversized response before downloading any bytes', async () => {
  const frames: Frame[] = [];
  const { client } = transport(async (frame) => {
    frames.push(frame);
    return binaryResponse({
      status: 200,
      contentType: bodyMime,
      size: 128 * 1024 * 1024 + 1,
      downloadId: 'unsafe',
    });
  });

  await expect(client.postProtobuf(boardPath, new Uint8Array())).rejects.toThrow('超过大小限制');
  expect(frames).toHaveLength(1);
});

test('does not decode private response bytes without the host acknowledgment', async () => {
  const { client } = transport(async () => ({
    _meta: { response: { status: 200, contentType: bodyMime, size: 1, body: 'QQ==' } },
  }));

  await expect(client.postProtobuf(boardPath, new Uint8Array())).rejects.toThrow(
    '宿主未确认白板操作',
  );
});

test('drops a late host result after user cancellation and never replays the command', async () => {
  let started!: () => void;
  const enteringHost = new Promise<void>((resolve) => {
    started = resolve;
  });
  let finish!: (result: unknown) => void;
  const held = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  const frames: Frame[] = [];
  const controller = new AbortController();
  const { client } = transport(async (frame, signal) => {
    frames.push(frame);
    started();
    expect(signal?.aborted).toBe(false);
    return held;
  });
  const pending = client.postProtobuf(boardPath, new Uint8Array([9]), controller.signal);
  await enteringHost;
  controller.abort();
  finish(inlineResponse('too late'));

  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(frames).toHaveLength(1);
});

test('uses exact asset identity, rejects an expired session and leaves recovery to the consumer', async () => {
  const frames: Frame[] = [];
  const { client, invalidated } = transport(async (frame) => {
    frames.push(frame);
    return {
      isError: true,
      content: [],
      structuredContent: { ok: false, error: { code: 'SESSION_EXPIRED', message: '会话已到期。' } },
    };
  });

  await expect(
    client.getAsset({ boardId: 'board-one', assetId: 'asset-one' }),
  ).rejects.toMatchObject({
    code: 'SESSION_EXPIRED',
  });
  expect(frames).toEqual([
    {
      action: 'asset',
      version: 1,
      sessionId,
      boardId: 'board-one',
      assetId: 'asset-one',
    },
  ]);
  expect(invalidated).toEqual([sessionId]);
});

function panelClock(initiallyVisible: boolean) {
  let visible = initiallyVisible;
  let now = 0;
  const visibility = new Set<() => void>();
  const tasks = new Map<() => void, number>();
  const environment = {
    now: () => now,
    isVisible: () => visible,
    schedule(delay: number, task: () => void) {
      tasks.set(task, now + delay);

      return () => tasks.delete(task);
    },
    subscribeVisibility(task: () => void) {
      visibility.add(task);

      return () => visibility.delete(task);
    },
  };

  function setVisibility(value: boolean) {
    visible = value;
    for (const listener of visibility) {
      listener();
    }
  }

  async function advance(by: number) {
    now += by;
    for (const [task, at] of tasks) {
      if (at <= now && tasks.delete(task)) {
        task();
      }
    }
    for (let turn = 0; turn < 6; turn += 1) {
      await Promise.resolve();
    }
  }

  return { environment, setVisibility, advance };
}

test('polls only while the panel is visible and never overlaps a pending snapshot', async () => {
  const panel = panelClock(false);
  const controller = new AbortController();
  let complete!: (snapshot: string) => void;
  const pending = new Promise<string>((resolve) => {
    complete = resolve;
  });
  const reads: AbortSignal[] = [];
  const snapshots: string[] = [];
  const errors: unknown[] = [];
  const observer = {
    onEvent: (value: string) => snapshots.push(value),
    onDisconnect: (_reason?: 'accessLost', error?: unknown) => errors.push(error),
  };

  try {
    observeMcpRoomSnapshots(
      async (signal) => {
        reads.push(signal);
        return pending;
      },
      observer,
      controller.signal,
      panel.environment,
    );
    await panel.advance(2_000);
    expect(reads).toHaveLength(0);

    panel.setVisibility(true);
    await panel.advance(0);
    await panel.advance(2_000);
    expect(reads).toEqual([controller.signal]);

    complete('snapshot');
    await panel.advance(0);
    await panel.advance(599);
    expect(snapshots).toEqual(['snapshot']);
    expect(reads).toHaveLength(1);
    await panel.advance(1);
    expect(reads).toHaveLength(2);

    controller.abort();
    panel.setVisibility(true);
    await panel.advance(2_000);
    expect(errors).toHaveLength(0);
    expect(reads).toHaveLength(2);
  } finally {
    controller.abort();
  }
});

test('ends observation when the authorized room request returns access denied', async () => {
  const panel = panelClock(true);
  const controller = new AbortController();
  const calls: Frame[] = [];
  const { client } = transport(async (frame) => {
    calls.push(frame);
    return binaryResponse({ status: 403 });
  });
  const snapshots: Uint8Array[] = [];
  const errors: { reason?: 'accessLost'; error?: unknown }[] = [];
  try {
    observeMcpRoomSnapshots(
      (signal) =>
        client.postProtobuf(
          '/luming.studio.v1.BoardRoomService/GetBoardRoom',
          new Uint8Array(),
          signal,
        ),
      {
        onEvent: (snapshot) => snapshots.push(snapshot),
        onDisconnect: (reason, error) => errors.push({ reason, error }),
      },
      controller.signal,
      panel.environment,
    );
    await panel.advance(0);
    await panel.advance(2_000);

    expect(calls).toHaveLength(1);
    expect(snapshots).toHaveLength(0);
    expect(errors).toEqual([{ reason: 'accessLost', error: expect.any(Error) }]);
  } finally {
    controller.abort();
  }
});
