import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { create, toBinary } from '@bufbuild/protobuf';
import { BoardCatalogService } from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import {
  BoardRoomService,
  type StreamBoardRoomEventsResponse,
} from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import {
  BoardSharingService,
  SharingRole,
  SharingScope,
} from '@codexworkbench/luming-studio-ii-contracts/sharing/service';
import { Code, createClient, type Interceptor } from '@connectrpc/connect';
import { createConnectTransport, createGrpcWebTransport } from '@connectrpc/connect-node';
import { beforeEach, expect, test } from 'vitest';
import {
  actorHeader,
  callWhiteboard,
  sendWhiteboardRequest,
} from '../support/whiteboard-client.js';
import {
  editorId,
  mainBoardId,
  outsiderId,
  seedWhiteboardDatabase,
  teammateId,
} from '../support/whiteboard-database.js';
import { agentPrincipalPrefix, useSharingTestServer } from './sharing-test-server.js';

const server = useSharingTestServer();
const { getBoardRoom, updateBoardPresence, leaveBoardPresence } = BoardRoomService.method;
const share = BoardSharingService.method;
const scope = { boardId: mainBoardId, viewId: 'stream-observer' };
const peer = { boardId: mainBoardId, viewId: 'stream-peer' };
const owner = 'stream-owner';
const timeoutMs = 5000;

type Stream = AsyncIterator<StreamBoardRoomEventsResponse>;

beforeEach(() => seedWhiteboardDatabase(server.databasePath));

function abortScope() {
  const controller = new AbortController();

  return {
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]),
    abort: () => controller.abort(),
  };
}

function streamClient(
  address: URL,
  protocol: 'grpc-web' | 'connect',
  interceptors: Interceptor[] = [],
) {
  const createTransport = protocol === 'grpc-web' ? createGrpcWebTransport : createConnectTransport;
  return createClient(
    BoardRoomService,
    createTransport({
      baseUrl: address.origin,
      httpVersion: '1.1',
      useBinaryFormat: true,
      interceptors,
    }),
  );
}

async function readEvent(iterator: Stream) {
  const { value, done } = await iterator.next();
  if (done || !value.event) {
    throw new Error('Room stream ended before sending an event');
  }

  return value.event;
}

test('delivers a snapshot and live events over the same binary gRPC-Web HTTP request', async () => {
  const lifetime = abortScope();
  const requests: { url: string; type: string | null }[] = [];
  const client = streamClient(server.owner, 'grpc-web', [
    (next) => (request) => {
      requests.push({ url: request.url, type: request.header.get('content-type') });
      return next(request);
    },
  ]);
  const responseHeaders: Headers[] = [];
  const stream = client
    .streamBoardRoomEvents(scope, {
      headers: { [actorHeader]: editorId },
      signal: lifetime.signal,
      onHeader: (headers) => responseHeaders.push(headers),
    })
    [Symbol.asyncIterator]();

  try {
    const first = await readEvent(stream);
    expect(first).toMatchObject({
      boardId: mainBoardId,
      sequence: 0n,
      payload: { case: 'snapshot', value: { actorId: editorId } },
    });
    const editingObjectIds = ['shape-1'];
    await callWhiteboard(server.owner, teammateId, updateBoardPresence, {
      ...peer,
      sequence: 1n,
      editingObjectIds,
    });
    expect(await readEvent(stream)).toMatchObject({
      roomInstanceId: first.roomInstanceId,
      sequence: 1n,
      payload: {
        case: 'participants',
        value: {
          upserts: [{ key: { actorId: teammateId, viewId: peer.viewId }, editingObjectIds }],
        },
      },
    });

    const current = await callWhiteboard(server.owner, editorId, getBoardRoom, {
      boardId: mainBoardId,
    });
    expect(current.event?.payload).toMatchObject({
      case: 'snapshot',
      value: { participants: [{ editingObjectIds }] },
    });

    await callWhiteboard(server.owner, teammateId, leaveBoardPresence, { ...peer, sequence: 2n });
    expect(await readEvent(stream)).toMatchObject({
      roomInstanceId: first.roomInstanceId,
      sequence: 2n,
      payload: { case: 'participants', value: { removals: [{ actorId: teammateId }] } },
    });

    const pending = stream.next();
    lifetime.abort();
    await expect(pending).rejects.toMatchObject({ code: Code.Canceled });
    expect(requests).toEqual([
      {
        url: server.owner.origin + '/luming.studio.v1.BoardRoomService/StreamBoardRoomEvents',
        type: 'application/grpc-web+proto',
      },
    ]);
    expect(responseHeaders.map((headers) => headers.get('content-type'))).toEqual([
      'application/grpc-web+proto',
    ]);
    expect(server.errors).toEqual([]);
  } finally {
    lifetime.abort();
  }
});

test('uses the same event journal for Connect replay and the subsequent live stream', async () => {
  const client = streamClient(server.owner, 'connect');
  const headers = { [actorHeader]: editorId };
  const first = abortScope();
  const resumed = abortScope();
  const initial = client
    .streamBoardRoomEvents(scope, { headers, signal: first.signal })
    [Symbol.asyncIterator]();

  try {
    const snapshot = await readEvent(initial);
    first.abort();
    const { roomInstanceId, sequence } = snapshot;
    await callWhiteboard(server.owner, teammateId, updateBoardPresence, { ...peer, sequence: 1n });

    const responseHeaders: Headers[] = [];
    const stream = client
      .streamBoardRoomEvents(
        { ...scope, after: { roomInstanceId, sequence } },
        { headers, signal: resumed.signal, onHeader: (header) => responseHeaders.push(header) },
      )
      [Symbol.asyncIterator]();
    expect(await readEvent(stream)).toMatchObject({
      sequence: 1n,
      payload: { case: 'participants' },
    });
    await callWhiteboard(server.owner, teammateId, leaveBoardPresence, { ...peer, sequence: 2n });
    expect(await readEvent(stream)).toMatchObject({
      sequence: 2n,
      payload: { case: 'participants' },
    });
    expect(responseHeaders.map((header) => header.get('content-type'))).toEqual([
      'application/connect+proto',
    ]);
  } finally {
    first.abort();
    resumed.abort();
  }
});

test('publishes immediate view removal when a gRPC-Web response closes without a leave RPC', async () => {
  const client = streamClient(server.owner, 'grpc-web');
  const watching = abortScope();
  const visiting = abortScope();
  const observer = client
    .streamBoardRoomEvents(scope, { headers: { [actorHeader]: editorId }, signal: watching.signal })
    [Symbol.asyncIterator]();
  const visitor = client
    .streamBoardRoomEvents(peer, {
      headers: { [actorHeader]: teammateId },
      signal: visiting.signal,
    })
    [Symbol.asyncIterator]();

  try {
    const snapshot = await readEvent(observer);
    assert.ok(snapshot.sequence !== undefined);
    await readEvent(visitor);
    const sample = { ...peer, sequence: 1n };
    const view = { actorId: teammateId, viewId: peer.viewId };
    await expect(
      callWhiteboard(server.owner, teammateId, updateBoardPresence, sample),
    ).resolves.toMatchObject({ accepted: true });
    expect(await readEvent(observer)).toMatchObject({
      sequence: snapshot.sequence + 1n,
      payload: { case: 'participants', value: { upserts: [{ key: view }] } },
    });
    visiting.abort();
    expect(await readEvent(observer)).toMatchObject({
      sequence: snapshot.sequence + 2n,
      payload: { case: 'participants', value: { upserts: [], removals: [view] } },
    });
    await expect(
      callWhiteboard(server.owner, teammateId, updateBoardPresence, { ...sample, sequence: 2n }),
    ).resolves.toMatchObject({ accepted: false });
    expect(server.errors).toEqual([]);
  } finally {
    visiting.abort();
    watching.abort();
  }
});

async function openLanBoard() {
  const { receipt } = await callWhiteboard(
    server.owner,
    owner,
    BoardCatalogService.method.createBoard,
    {
      commandId: 'stream-board',
      title: 'Stream board',
    },
  );

  if (receipt?.outcome.case !== 'created') {
    throw new Error('Could not create a test board');
  }

  const { boardId } = receipt.outcome.value;
  await setScope(boardId, SharingScope.LAN, 0n);
  const { sharing } = await callWhiteboard(server.owner, owner, share.getBoardSharing, { boardId });
  const invitation = sharing?.links.find((link) => link.role === SharingRole.VIEWER)?.url;
  if (!invitation) {
    throw new Error('Could not read the test invitation');
  }

  const invitationToken = new URLSearchParams(new URL(invitation).hash.slice(1)).get('invite');
  if (!invitationToken) {
    throw new Error('The invitation did not include a token');
  }

  const address = server.guest('lan');
  const inspected = await sendWhiteboardRequest(address, undefined, share.inspectBoardInvitation, {
    boardId,
    invitationToken,
  });
  const cookie = inspected.headers.get('set-cookie')?.split(';', 1)[0];
  expect(inspected.ok).toBe(true);

  if (!cookie) {
    throw new Error('The invitation did not set a guest cookie');
  }

  const join = share.joinBoardInvitation;
  const joined = await fetch(new URL(`/${join.parent.typeName}/${join.name}`, address), {
    method: 'POST',
    headers: { 'content-type': 'application/protobuf', cookie, origin: address.origin },
    body: Buffer.from(
      toBinary(
        join.input,
        create(join.input, {
          boardId,
          invitationToken,
          name: 'Stream guest',
        }),
      ),
    ),
    signal: AbortSignal.timeout(timeoutMs),
  });
  expect(joined.ok).toBe(true);

  await joined.arrayBuffer();

  return { boardId, address, cookie };
}

async function setScope(boardId: string, scope: SharingScope, expectedVersion: bigint) {
  const { receipt } = await callWhiteboard(server.owner, owner, share.updateBoardSharing, {
    boardId,
    commandId: 'stream-share-' + expectedVersion,
    expectedVersion,
    operation: { case: 'setScope', value: { scope } },
  });
  expect(receipt?.outcome.case).toBe('applied');
}

test('closes the live LAN guest stream when its board authorization changes', async () => {
  const { boardId, address, cookie } = await openLanBoard();
  const lifetime = abortScope();
  const client = streamClient(address, 'grpc-web');
  const stream = client
    .streamBoardRoomEvents(
      { ...scope, boardId },
      {
        headers: { cookie, origin: address.origin },
        signal: lifetime.signal,
      },
    )
    [Symbol.asyncIterator]();

  try {
    const otherBoard = client
      .streamBoardRoomEvents(scope, {
        headers: { cookie, origin: address.origin },
        signal: lifetime.signal,
      })
      [Symbol.asyncIterator]();
    await expect(readEvent(otherBoard)).rejects.toMatchObject({ code: Code.PermissionDenied });

    expect(await readEvent(stream)).toMatchObject({
      boardId,
      payload: { case: 'snapshot', value: { canEdit: false } },
    });
    const denied = expect(stream.next()).rejects.toMatchObject({ code: Code.PermissionDenied });
    await setScope(boardId, SharingScope.LOCAL, 1n);
    await denied;
    expect(server.errors).toEqual([]);
  } finally {
    lifetime.abort();
  }
});

test('enforces room authentication, board access, and cursor validation on the streaming RPC', async () => {
  const client = streamClient(server.owner, 'grpc-web');
  async function first(actor?: string, invalidCursor = false) {
    const stream = client
      .streamBoardRoomEvents(
        { ...scope, after: invalidCursor ? { roomInstanceId: 'instance' } : undefined },
        {
          headers: actor ? { [actorHeader]: actor } : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        },
      )
      [Symbol.asyncIterator]();

    return readEvent(stream);
  }

  await expect(first()).rejects.toMatchObject({ code: Code.Unauthenticated });
  await expect(first(agentPrincipalPrefix + editorId)).rejects.toMatchObject({
    code: Code.PermissionDenied,
  });
  await expect(first(outsiderId)).rejects.toMatchObject({ code: Code.PermissionDenied });
  await expect(first(editorId, true)).rejects.toMatchObject({ code: Code.InvalidArgument });
  expect(server.errors).toEqual([]);
});
