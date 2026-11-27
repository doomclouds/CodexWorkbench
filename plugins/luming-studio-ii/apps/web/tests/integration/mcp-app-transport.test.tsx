import { expect, test } from 'vitest';
import { createMcpTransport, observeMcpRoomEvents } from '../../src/platform/mcp/index.js';

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
      size: 128 * 1024 * 1024 + 32 * 1024 + 1,
      downloadId: 'unsafe',
    });
  });

  await expect(client.postProtobuf(boardPath, new Uint8Array())).rejects.toThrow('超过大小限制');
  expect(frames).toHaveLength(1);
});

test('accepts protobuf framing around a 128 MiB backup before requesting the first chunk', async () => {
  const frames: Frame[] = [];
  const controller = new AbortController();
  const { client } = transport(async (frame) => {
    frames.push(frame);
    if (frame.action === 'download') {
      controller.abort();
    }

    return frame.action === 'request'
      ? binaryResponse({
          status: 200,
          contentType: bodyMime,
          size: 128 * 1024 * 1024 + 64,
          downloadId: 'maximum-backup',
        })
      : { structuredContent: { ok: true } };
  });

  const path = '/luming.studio.v1.WhiteboardService/ExportBoard';
  await expect(client.postProtobuf(path, new Uint8Array(), controller.signal)).rejects.toThrow();
  expect(frames.map(({ action }) => action)).toEqual(['request', 'download', 'release']);
  expect(frames[1]).toMatchObject({ transferId: 'maximum-backup', offset: 0 });
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

function panelVisibility(initiallyVisible: boolean) {
  let visible = initiallyVisible;
  const visibility = new Set<() => void>();
  const environment = {
    isVisible: () => visible,
    subscribe(task: () => void) {
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

  return { environment, setVisibility };
}

interface TestRoomEvent {
  readonly instanceId: string;
  readonly sequence: bigint;
}

interface TestRoomWait {
  readonly cursor: TestRoomEvent | undefined;
  readonly signal: AbortSignal;
  readonly complete: (batch: readonly TestRoomEvent[]) => void;
}

test('waits once for room events and resumes from the delivered cursor after a hidden interval', async () => {
  const panel = panelVisibility(false);
  const controller = new AbortController();
  const event = { instanceId: 'room', sequence: 42n };
  const reads: TestRoomWait[] = [];
  const events: TestRoomEvent[] = [];
  const errors: unknown[] = [];
  const observer = {
    onEvent: (value: TestRoomEvent) => events.push(value),
    onDisconnect: (_reason?: 'accessLost', error?: unknown) => errors.push(error),
  };

  try {
    observeMcpRoomEvents(
      (cursor, signal) =>
        new Promise((complete, reject) => {
          reads.push({ cursor, signal, complete });
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
      observer,
      controller.signal,
      panel.environment,
    );
    expect(reads).toHaveLength(0);

    panel.setVisibility(true);
    expect(reads).toHaveLength(1);
    expect(reads[0]?.cursor).toBeUndefined();
    reads[0]?.complete([event]);
    await expect.poll(() => reads.length).toBe(2);
    expect(events).toEqual([event]);
    expect(reads[1]?.cursor).toEqual(event);

    panel.setVisibility(false);
    expect(reads[1]?.signal.aborted).toBe(true);
    await Promise.resolve();
    expect(reads).toHaveLength(2);
    panel.setVisibility(true);
    await expect.poll(() => reads.length).toBe(3);
    expect(reads[2]?.cursor).toEqual(event);

    controller.abort();
    expect(reads[2]?.signal.aborted).toBe(true);
    await Promise.resolve();
    expect(errors).toHaveLength(0);
    expect(reads).toHaveLength(3);
  } finally {
    controller.abort();
  }
});

test('retries an interrupted transport with the last delivered room cursor', async () => {
  const panel = panelVisibility(true);
  const controller = new AbortController();
  const event = { instanceId: 'room', sequence: 8n };
  const cursors: (TestRoomEvent | undefined)[] = [];
  const errors: unknown[] = [];
  try {
    observeMcpRoomEvents(
      async (cursor, signal) => {
        cursors.push(cursor);
        if (cursors.length === 1) {
          return [event];
        }
        if (cursors.length === 2) {
          throw new Error('Transient host interruption.');
        }

        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
      { onEvent: () => undefined, onDisconnect: (_reason, error) => errors.push(error) },
      controller.signal,
      panel.environment,
    );

    await expect.poll(() => cursors).toEqual([undefined, event, event]);
    expect(errors).toEqual([]);
  } finally {
    controller.abort();
  }
});

test('ends observation when the authorized room request returns access denied', async () => {
  const panel = panelVisibility(true);
  const controller = new AbortController();
  const calls: Frame[] = [];
  const { client } = transport(async (frame) => {
    calls.push(frame);
    return binaryResponse({ status: 403 });
  });
  const events: unknown[] = [];
  const errors: { reason?: 'accessLost'; error?: unknown }[] = [];
  try {
    observeMcpRoomEvents(
      async (_cursor, signal) => {
        await client.postProtobuf(
          '/luming.studio.v1.BoardRoomService/WaitBoardRoomEvents',
          new Uint8Array(),
          signal,
        );

        return [];
      },
      {
        onEvent: (event) => events.push(event),
        onDisconnect: (reason, error) => errors.push({ reason, error }),
      },
      controller.signal,
      panel.environment,
    );
    await expect.poll(() => errors).toEqual([{ reason: 'accessLost', error: expect.any(Error) }]);
    expect(calls).toEqual([expect.objectContaining({ method: 'WaitBoardRoomEvents' })]);
    expect(events).toHaveLength(0);
  } finally {
    controller.abort();
  }
});
