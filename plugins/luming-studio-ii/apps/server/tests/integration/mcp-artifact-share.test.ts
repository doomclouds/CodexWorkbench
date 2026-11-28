import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { BoardCatalogService } from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { BoardSharingService } from '@codexworkbench/luming-studio-ii-contracts/sharing/service';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, test } from 'vitest';
import { createStudioMcpServer } from '../../src/entrypoints/mcp/index.js';
import { actorHeader, callWhiteboard } from '../support/whiteboard-client.js';
import { useSharingTestServer } from './sharing-test-server.js';

const runtime = useSharingTestServer();
const owner = 'mcp-share-owner';
const other = 'mcp-share-unrelated';
const mediaType = 'application/protobuf';
const { inspectBoardInvitation, joinBoardInvitation } = BoardSharingService.method;

type McpOptions = Parameters<typeof createStudioMcpServer>[0];
type Fault = 'write-reply-lost' | 'lookup-unreachable';

async function board() {
  const { receipt } = await callWhiteboard(
    runtime.owner,
    owner,
    BoardCatalogService.method.createBoard,
    {
      commandId: 'create-share-board',
      title: 'Share verification',
    },
  );
  assert.equal(receipt?.outcome.case, 'created');

  return receipt.outcome.value.boardId;
}

function dispatchFor(actor: string, fault: Fault | undefined): McpOptions['dispatch'] {
  let loseWrite = fault !== undefined;

  return async (request, signal) => {
    if (fault === 'lookup-unreachable' && request.route.endsWith('/GetBoardSharingReceipt')) {
      return new Response(null, { status: 503 });
    }

    const headers = new Headers({ [actorHeader]: actor });
    if (request.mediaType) {
      headers.set('content-type', request.mediaType);
    }
    const body = request.body instanceof Uint8Array ? Buffer.from(request.body) : request.body;
    const response = await fetch(new URL(request.route, runtime.owner), {
      method: request.method,
      headers,
      body,
      signal,
    });

    if (loseWrite && request.route.endsWith('/UpdateBoardSharing')) {
      loseWrite = false;
      await response.body?.cancel();

      throw new Error('The write arrived but the transport lost its reply.');
    }

    return response;
  };
}

async function fixture(actor = owner, fault?: Fault) {
  const dispatch = dispatchFor(actor, fault);
  let commands = 0;
  const server = createStudioMcpServer({
    html: '<html></html>',
    pluginVersion: '1.0.0',
    now: () => 0,
    allocateId: () => 'share-mcp-' + ++commands,
    createFile: () => Promise.reject(new Error('Unexpected transfer request')),
    dispatch,
    onError: (error) => {
      throw error;
    },
  });
  const client = new Client({ name: 'artifact-share-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    call: async (args: Record<string, unknown>): Promise<Record<string, unknown> | undefined> => {
      const result = await client.callTool({ name: 'artifact_share', arguments: args });

      return result.structuredContent as Record<string, unknown> | undefined;
    },
    async close() {
      try {
        await server.close();
      } finally {
        await client.close();
      }
    },
  };
}

type ShareFixture = Awaited<ReturnType<typeof fixture>>;

async function invitation(mcp: ShareFixture, boardId: string, role = 'viewer') {
  const result = await mcp.call({ boardId, action: 'status', role });
  const data = result?.data as { invitation?: { url: string } } | undefined;
  assert.ok(data?.invitation?.url);

  return data.invitation.url;
}

async function join(boardId: string, href: string) {
  const token = new URLSearchParams(new URL(href).hash.slice(1)).get('invite');
  assert.ok(token);
  const request = { boardId, invitationToken: token };
  const intro = await fetch(
    new URL(
      '/' + inspectBoardInvitation.parent.typeName + '/' + inspectBoardInvitation.name,
      runtime.guest('local'),
    ),
    {
      method: 'POST',
      headers: { 'content-type': mediaType },
      body: Buffer.from(
        toBinary(inspectBoardInvitation.input, create(inspectBoardInvitation.input, request)),
      ),
    },
  );
  assert.equal(intro.status, 200);
  const cookie = intro.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie);
  await intro.body?.cancel();
  const name = 'Share guest';
  const guest = await fetch(
    new URL(
      '/' + joinBoardInvitation.parent.typeName + '/' + joinBoardInvitation.name,
      runtime.guest('local'),
    ),
    {
      method: 'POST',
      headers: { 'content-type': mediaType, cookie },
      body: Buffer.from(
        toBinary(
          joinBoardInvitation.input,
          create(joinBoardInvitation.input, { ...request, name }),
        ),
      ),
    },
  );
  assert.equal(guest.status, 200);
  const { session } = fromBinary(
    joinBoardInvitation.output,
    new Uint8Array(await guest.arrayBuffer()),
  );
  assert.ok(session?.actorId);

  return session.actorId;
}

test('opens local sharing by default, exposes one requested invite, and rotates all roles', async () => {
  const boardId = await board();
  const mcp = await fixture();
  try {
    const initial = await mcp.call({ artifactId: boardId });
    expect(initial).toMatchObject({ ok: true, data: { enabled: false, version: '0' } });
    const opened = await mcp.call({ artifactId: boardId, action: 'start' });
    expect(opened).toMatchObject({
      ok: true,
      data: { state: 'applied', version: '1', sharing: { access: 'local' } },
    });
    expect(JSON.stringify(opened)).not.toContain('#invite=');
    expect(runtime.activated).toEqual(['local']);

    const before = await invitation(mcp, boardId);
    const editorBefore = await invitation(mcp, boardId, 'editor');
    const reset = await mcp.call({ boardId, action: 'reset' });
    expect(reset).toMatchObject({ ok: true, data: { version: '2' } });
    expect(JSON.stringify(reset)).not.toContain('#invite=');
    expect(await invitation(mcp, boardId)).not.toBe(before);
    expect(await invitation(mcp, boardId, 'editor')).not.toBe(editorBefore);

    const disabled = await mcp.call({ boardId, action: 'link', role: 'viewer', on: false });
    expect(disabled).toMatchObject({
      ok: true,
      data: { sharing: { links: expect.arrayContaining([{ role: 'viewer', enabled: false }]) } },
    });
    const enabled = await mcp.call({ boardId, action: 'link', role: 'viewer', on: true });
    expect(enabled).toMatchObject({
      ok: true,
      data: { sharing: { invitation: { role: 'viewer' } } },
    });

    const stopped = await mcp.call({ boardId, action: 'stop' });
    expect(stopped).toMatchObject({ ok: true, data: { sharing: { enabled: false } } });
    expect(JSON.stringify(stopped)).not.toContain('#invite=');
  } finally {
    await mcp.close();
  }
});

test('changes, removes, restores and forgets an authorized member', async () => {
  const boardId = await board();
  const mcp = await fixture();
  try {
    await mcp.call({ boardId, action: 'start' });
    const memberId = await join(boardId, await invitation(mcp, boardId));
    const changed = await mcp.call({ boardId, action: 'role', role: 'commenter', memberId });
    expect(changed).toMatchObject({
      ok: true,
      data: { sharing: { members: [{ id: memberId, role: 'commenter', removed: false }] } },
    });
    expect(JSON.stringify(changed)).not.toContain('#invite=');

    const removed = await mcp.call({ boardId, action: 'remove', memberId });
    expect(removed).toMatchObject({
      ok: true,
      data: { sharing: { members: [{ id: memberId, removed: true }] } },
    });
    const restored = await mcp.call({ boardId, action: 'restore', memberId, role: 'viewer' });
    expect(restored).toMatchObject({
      ok: true,
      data: { sharing: { members: [{ id: memberId, role: 'viewer', removed: false }] } },
    });
    await mcp.call({ boardId, action: 'remove', memberId });
    const forgotten = await mcp.call({ boardId, action: 'forget', memberId });
    expect(forgotten).toMatchObject({ ok: true, data: { sharing: { members: [] } } });
  } finally {
    await mcp.close();
  }
});

test('checks owner and sharing version before activation, then replays a stable command once', async () => {
  const boardId = await board();
  const mcp = await fixture();
  const stranger = await fixture(other);
  try {
    const command = {
      boardId,
      action: 'start',
      access: 'lan',
      commandId: 'stable-lan',
      expectedVersion: '0',
    };
    expect(await stranger.call(command)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await mcp.call({ ...command, expectedVersion: '5' })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect(runtime.activated).toEqual([]);

    const applied = await mcp.call(command);
    expect(applied).toMatchObject({ ok: true, data: { version: '1' } });
    expect(await mcp.call(command)).toEqual(applied);
    expect(await mcp.call({ ...command, access: 'local' })).toMatchObject({
      ok: false,
      error: { code: 'COMMAND_ID_REUSE' },
    });
    const receipt = await mcp.call({ boardId, action: 'receipt', operationId: command.commandId });
    expect(receipt).toMatchObject({
      ok: true,
      data: { recorded: true, commandId: command.commandId, version: '1' },
    });
    expect(runtime.activated).toEqual(['lan']);
  } finally {
    await stranger.close();
    await mcp.close();
  }
});

test.each(['write-reply-lost', 'lookup-unreachable'] as const)(
  'keeps the same mutation identity while resolving a lost write reply (%s)',
  async (fault) => {
    const boardId = await board();
    const mcp = await fixture(owner, fault);
    try {
      const result = await mcp.call({ boardId, action: 'start' });
      if (fault === 'write-reply-lost') {
        expect(result).toMatchObject({
          ok: true,
          data: { commandId: 'share-mcp-1', version: '1' },
        });
      } else {
        expect(result).toMatchObject({
          ok: false,
          error: {
            code: 'COMMIT_RESULT_UNKNOWN',
            details: { commandId: 'share-mcp-1', expectedVersion: '0' },
          },
        });
      }
      const retry = { boardId, action: 'start', commandId: 'share-mcp-1', expectedVersion: '0' };
      expect(await mcp.call(retry)).toMatchObject({ ok: true, data: { version: '1' } });
      expect(runtime.activated).toEqual(['local']);
    } finally {
      await mcp.close();
    }
  },
);
