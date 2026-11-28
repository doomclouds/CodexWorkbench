import { create, fromBinary, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import {
  AgentActivityEndReason,
  AgentActivityPhase,
  BoardRoomService,
  type ChangeAgentActivityRequest,
} from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Buffer } from 'node:buffer';
import { expect, test } from 'vitest';
import { createStudioMcpServer, type LocalRequest } from '../../src/entrypoints/mcp/index.js';

const activity = BoardRoomService.method.changeAgentActivity;
const boardId = 'board-a';
const taskId = 'draft-flow';
const generation = 'generation-a';
const now = 2500;
const expiresAtUnixMs = 120_000;
const task = { boardId, taskId };
const begin = { ...task, action: 'begin', scope: { objectIds: ['object-a'] }, label: '架构图' };

type McpOptions = Parameters<typeof createStudioMcpServer>[0];
type Dispatch = NonNullable<McpOptions['dispatchAgentActivity']>;

function encodeReply(result: MessageInitShape<typeof activity.output>['result']) {
  const bytes = toBinary(activity.output, create(activity.output, { result }));

  return new Response(new Uint8Array(bytes), {
    headers: { 'content-type': 'application/protobuf' },
  });
}

async function mcpFixture(dispatch?: Dispatch, createFile?: McpOptions['createFile']) {
  const ownerRequests: LocalRequest[] = [];
  const errors: unknown[] = [];
  let allocation = 0;
  const server = createStudioMcpServer({
    html: '<html></html>',
    pluginVersion: '1.0.0',
    now: () => now,
    allocateId: () => '11111111-1111-4111-8111-' + String(++allocation).padStart(12, '0'),
    createFile: createFile ?? (() => Promise.reject(new Error('Unexpected MCP transfer spool.'))),
    dispatch: (request) => {
      ownerRequests.push(request);

      return Promise.resolve(new Response(null, { status: 403 }));
    },
    dispatchAgentActivity: dispatch,
    onError: (error) => errors.push(error),
  });
  const client = new Client({ name: 'studio-activity-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    ownerRequests,
    errors,
    call: (args: Record<string, unknown>) =>
      client.callTool({ name: 'artifact_activity', arguments: args }),
    async close() {
      await server.close();
      await client.close();
    },
  };
}

function agentPort(requests: ChangeAgentActivityRequest[]): Dispatch {
  return (body) => {
    const request = fromBinary(activity.input, body);
    requests.push(request);
    if (request.action.case === 'disconnect') {
      return Promise.resolve(encodeReply({ case: 'disconnected', value: {} }));
    }
    if (request.action.case === 'end') {
      return Promise.resolve(
        encodeReply({
          case: 'ended',
          value: {
            generation: request.action.value.generation,
            reason: AgentActivityEndReason.COMPLETED,
          },
        }),
      );
    }

    const phase =
      request.action.case === 'update' ? request.action.value.phase : AgentActivityPhase.PREPARING;

    return Promise.resolve(
      encodeReply({
        case: 'workspace',
        value: {
          agentId: request.agentId,
          taskId: request.taskId,
          generation,
          phase,
          expiresAtUnixMs: BigInt(expiresAtUnixMs),
        },
      }),
    );
  };
}

test('omits activity from the MCP tool catalog when no protected dispatch is supplied', async () => {
  const fixture = await mcpFixture();
  try {
    const { tools } = await fixture.client.listTools();
    expect(tools.map(({ name }) => name)).not.toContain('artifact_activity');
  } finally {
    await fixture.close();
  }
});

test('publishes the action schema and forwards only a transport-minted Agent identity', async () => {
  const requests: ChangeAgentActivityRequest[] = [];
  const fixture = await mcpFixture(agentPort(requests));
  try {
    const { tools } = await fixture.client.listTools();
    const tool = tools.find(({ name }) => name === 'artifact_activity');
    expect(tool?.inputSchema.required).toEqual(['boardId', 'taskId', 'action']);
    expect(tool?.inputSchema.properties).toHaveProperty('scope');
    expect(tool?.inputSchema.properties).not.toHaveProperty('agentId');
    expect(tool?._meta).toEqual({ ui: { visibility: ['model'] } });

    const started = await fixture.call(begin);
    expect(started.structuredContent).toEqual({
      ok: true,
      data: { ...task, generation, status: 'active', phase: 'preparing', expiresAtUnixMs },
    });
    await fixture.call({
      ...task,
      action: 'update',
      generation,
      phase: 'writing',
      activeObjectIds: ['object-a'],
    });
    await fixture.call({ ...task, action: 'status' });
    const ended = await fixture.call({ ...task, action: 'end', generation });
    expect(ended.structuredContent).toEqual({
      ok: true,
      data: { ...task, generation, status: 'ended', reason: 'completed' },
    });

    expect(requests.map(({ action }) => action.case)).toEqual(['begin', 'update', 'status', 'end']);
    const identities = requests.map(({ agentId }) => agentId);
    expect(identities).toEqual(
      Array.from({ length: 4 }, () => 'agent-11111111-1111-4111-8111-000000000001'),
    );
    expect(requests[0]?.action.value).toMatchObject({
      scope: { target: { case: 'objects', value: { objectIds: ['object-a'] } } },
    });
    expect(requests[1]?.action.value).toMatchObject({
      generation,
      phase: AgentActivityPhase.WRITING,
      activeObjectIds: ['object-a'],
    });
    expect(fixture.ownerRequests).toEqual([]);
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }

  expect(requests[4]).toMatchObject({
    agentId: requests[0]?.agentId,
    action: { case: 'disconnect' },
  });
  expect(requests).toHaveLength(5);
});

test('rejects spoofed identity, release, mixed scopes, and missing or unrelated fields', async () => {
  const requests: ChangeAgentActivityRequest[] = [];
  const fixture = await mcpFixture(agentPort(requests));
  const bounds = { x: 0, y: 0, width: 300, height: 500 };
  try {
    const invalid = [
      { ...begin, agentId: 'agent-other' },
      { ...task, action: 'release', generation },
      { ...begin, scope: { objectIds: ['object-a'], bounds } },
      { ...task, action: 'update', generation, phase: 'writing' },
      { ...task, action: 'status', generation },
    ];

    for (const input of invalid) {
      expect((await fixture.call(input)).isError).toBe(true);
    }

    expect(requests).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('disconnects the whole Agent session on graceful MCP close', async () => {
  const requests: ChangeAgentActivityRequest[] = [];
  const fixture = await mcpFixture(agentPort(requests));
  const bounds = { x: 22, y: 35, width: 120, height: 2040 };
  try {
    const started = await fixture.call({ ...begin, scope: { bounds } });
    expect(started.isError).not.toBe(true);
    expect(requests[0]?.action.value).toMatchObject({
      scope: { target: { case: 'area', value: bounds } },
    });
  } finally {
    await fixture.close();
  }

  expect(requests[1]).toMatchObject({
    agentId: requests[0]?.agentId,
    action: { case: 'disconnect' },
  });
  expect(requests).toHaveLength(2);
  expect(fixture.errors).toEqual([]);
});

test('bounds the byte stream before decoding a response from the activity endpoint', async () => {
  const fixture = await mcpFixture(() =>
    Promise.resolve(new Response(new Uint8Array(32 * 1024 + 1))),
  );

  try {
    const result = await fixture.call({ ...task, action: 'status' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ ok: false, error: { code: 'TOO_LARGE' } });
  } finally {
    await fixture.close();
  }
});

test('returns the MCP read result without waiting for its presence notification', async () => {
  let resolvePresence: ((response: Response) => void) | undefined;
  const pending = new Promise<Response>((resolve) => {
    resolvePresence = resolve;
  });
  const requests: ChangeAgentActivityRequest[] = [];
  const fixture = await mcpFixture((bytes) => {
    const request = fromBinary(activity.input, bytes);
    requests.push(request);

    return request.action.case === 'readPresence'
      ? pending
      : Promise.resolve(encodeReply({ case: 'disconnected', value: {} }));
  });

  try {
    const result = await fixture.client.callTool({
      name: 'artifact_read',
      arguments: { boardId, mode: 'summary' },
    });
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(requests.map(({ action }) => action.case)).toEqual(['readPresence']);
  } finally {
    resolvePresence?.(new Response(null, { status: 403 }));
    await fixture.close();
  }

  expect(requests.map(({ action }) => action.case)).toEqual(['readPresence', 'disconnect']);
});

test('allows the owner App to route release for its session board only', async () => {
  const fixture = await mcpFixture();
  try {
    const opened = await fixture.client.callTool({ name: 'studio_open', arguments: { boardId } });
    expect(opened.isError).not.toBe(true);

    async function release(board: string) {
      const request = create(activity.input, {
        boardId: board,
        taskId,
        agentId: 'agent-authorized',
        action: { case: 'release', value: { generation } },
      });

      return fixture.client.callTool({
        name: 'studio_app_request',
        arguments: {
          version: 1,
          action: 'request',
          sessionId: '11111111-1111-4111-8111-000000000001',
          service: BoardRoomService.typeName,
          method: activity.name,
          body: Buffer.from(toBinary(activity.input, request)).toString('base64'),
        },
      });
    }

    expect((await release('another-board')).isError).toBe(true);
    expect((await release(boardId)).isError).not.toBe(true);
    expect(fixture.ownerRequests).toHaveLength(1);
    expect(fixture.ownerRequests[0]?.route).toBe(
      '/luming.studio.v1.BoardRoomService/ChangeAgentActivity',
    );
  } finally {
    await fixture.close();
  }
});

test('forwards a panel room wait only for the board authorized by its session', async () => {
  const fixture = await mcpFixture();
  const method = BoardRoomService.method.waitBoardRoomEvents;
  const after = { roomInstanceId: 'room-one', sequence: 7n };
  const input = { boardId, viewId: 'test-panel', after };
  try {
    const open = await fixture.client.callTool({ name: 'studio_open', arguments: { boardId } });
    expect(open.isError).not.toBe(true);

    function wait(board: string) {
      const body = toBinary(method.input, create(method.input, { ...input, boardId: board }));

      return fixture.client.callTool({
        name: 'studio_app_request',
        arguments: {
          version: 1,
          action: 'request',
          sessionId: '11111111-1111-4111-8111-000000000001',
          service: BoardRoomService.typeName,
          method: method.name,
          body: Buffer.from(body).toString('base64'),
        },
      });
    }

    expect((await wait('another-board')).isError).toBe(true);
    expect((await wait(boardId))._meta?.response).toMatchObject({ status: 403 });
    expect(fixture.ownerRequests).toEqual([
      expect.objectContaining({
        method: 'POST',
        route: '/luming.studio.v1.BoardRoomService/WaitBoardRoomEvents',
      }),
    ]);
    const body = fixture.ownerRequests[0]?.body;
    expect(body).toBeInstanceOf(Uint8Array);
    if (body instanceof Uint8Array) {
      expect(fromBinary(method.input, body)).toMatchObject(input);
    }
  } finally {
    await fixture.close();
  }
});

test.each([
  BoardEditService.method.attachBoardImage,
  BoardEditService.method.uploadBoardDocumentImage,
])('forwards a 20 MiB $name and rejects media for another board', async (method) => {
  const fixture = await mcpFixture(undefined, () => {
    const chunks: Uint8Array<ArrayBuffer>[] = [];

    return Promise.resolve({
      append(bytes) {
        chunks.push(new Uint8Array(bytes));
        return Promise.resolve();
      },
      read: () => Promise.reject(new Error('Unexpected download.')),
      body: () => Promise.resolve(new Blob(chunks)),
      dispose() {
        chunks.length = 0;
        return Promise.resolve();
      },
    });
  });
  const sessionId = '11111111-1111-4111-8111-000000000001';
  const send = (args: Record<string, unknown>) =>
    fixture.client.callTool({
      name: 'studio_app_request',
      arguments: { version: 1, sessionId, ...args },
    });
  const route = { service: BoardEditService.typeName, method: method.name, action: 'request' };

  try {
    const opened = await fixture.client.callTool({ name: 'studio_open', arguments: { boardId } });
    expect(opened.isError).not.toBe(true);
    const other = { boardId: 'another-board', assetId: 'test-asset' };
    const foreignUpload = toBinary(method.input, create(method.input, { boardId: other.boardId }));
    expect(
      (await send({ ...route, body: Buffer.from(foreignUpload).toString('base64') })).isError,
    ).toBe(true);
    expect((await send({ action: 'asset', ...other })).isError).toBe(true);

    const content = new Uint8Array(20 * 1024 * 1024);
    const body = toBinary(method.input, create(method.input, { boardId, content }));
    const chunkSize = 128 * 1024;
    let transferId: string | undefined;
    for (let offset = 0; offset < body.byteLength; offset += chunkSize) {
      const result = await send({
        action: 'upload',
        offset,
        size: body.byteLength,
        data: Buffer.from(body.subarray(offset, offset + chunkSize)).toString('base64'),
        ...(transferId && { transferId }),
      });
      const transfer = result._meta?.transfer;
      expect(transfer).toMatchObject({ transferId: expect.any(String) });
      transferId = (transfer as { transferId: string }).transferId;
    }

    const result = await send({ ...route, uploadId: transferId });
    expect(result.isError).not.toBe(true);
    expect(fixture.ownerRequests).toHaveLength(1);
    expect(fixture.ownerRequests[0]).toMatchObject({
      route: '/luming.studio.v1.BoardEditService/' + method.name,
      body: { size: body.byteLength },
    });
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});
