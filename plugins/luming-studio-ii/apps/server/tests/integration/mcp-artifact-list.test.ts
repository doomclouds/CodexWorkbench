import { Buffer } from 'node:buffer';
import {
  create,
  fromBinary,
  toBinary,
  type DescMessage,
  type DescMethodUnary,
  type MessageInitShape,
} from '@bufbuild/protobuf';
import { BoardCatalogService } from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, test } from 'vitest';
import { createStudioMcpServer } from '../../src/entrypoints/mcp/index.js';
import { actorHeader } from '../support/whiteboard-client.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const http = useWhiteboardTestServer((request) => {
  const id = request.headers[actorHeader];
  if (typeof id === 'string') {
    return { id, guestScope: id === 'catalog-guest' ? 'local' : undefined };
  }
});
const owner = 'mcp-list-owner';

interface Artifact {
  readonly id: string;
  readonly title: string;
  readonly pinned: boolean;
  readonly entryVersion: string;
}

interface ListPage {
  readonly artifacts: readonly Artifact[];
  readonly nextCursor?: string;
  readonly nextOffset?: number;
  readonly offset?: number;
}

async function connect(actor = owner) {
  const server = createStudioMcpServer({
    html: '<html></html>',
    pluginVersion: '1.0.0',
    now: () => 0,
    allocateId: () => '11111111-1111-4111-8111-111111111111',
    createFile: () => Promise.reject(new Error('Unexpected file spool.')),
    dispatch(request, signal) {
      return fetch(new URL(request.route, http.address), {
        method: request.method,
        headers: {
          [actorHeader]: actor,
          'content-type': request.mediaType ?? '',
        },
        body: request.body instanceof Uint8Array ? Buffer.from(request.body) : request.body,
        signal,
      });
    },
    onError() {},
  });
  const client = new Client({ name: 'catalog-list-acceptance', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    call: (name: string, args: Record<string, unknown>) =>
      client.callTool({ name, arguments: args }),
    async close() {
      await client.close();
      await server.close();
    },
  };
}

type Studio = Awaited<ReturnType<typeof connect>>;
type Result = Awaited<ReturnType<Studio['call']>>;

async function workbenchPreferenceRequest<Input extends DescMessage>(
  studio: Studio,
  method: DescMethodUnary<Input>,
  input: MessageInitShape<Input>,
) {
  const opened = await studio.call('studio_app_request', { version: 1, action: 'connect' });
  const session = opened._meta?.session as { id: string } | undefined;
  expect(session?.id).toBeTypeOf('string');
  const body = Buffer.from(toBinary(method.input, create(method.input, input))).toString('base64');
  const result = await studio.call('studio_app_request', {
    version: 1,
    action: 'request',
    sessionId: session?.id,
    service: method.parent.typeName,
    method: method.name,
    body,
  });
  const response = result._meta?.response as { status: number; body: string } | undefined;
  if (!response) {
    throw new Error('Expected a preferences response from the Studio panel bridge.');
  }

  return response;
}

test('shares per-actor workbench preferences across MCP clients and a service restart', async () => {
  const { getWorkbenchPreferences: read, updateWorkbenchPreferences: update } =
    BoardCatalogService.method;
  const first = await connect();
  const second = await connect();
  try {
    const [layout, theme] = await Promise.all([
      workbenchPreferenceRequest(first, update, { changes: { layout: 'list', pinnedOnly: true } }),
      workbenchPreferenceRequest(second, update, { changes: { theme: 'dark' } }),
    ]);
    expect([layout.status, theme.status]).toEqual([200, 200]);
    const invalid = await workbenchPreferenceRequest(first, update, {
      changes: { layout: 'tiles' },
    });
    expect(invalid.status).toBe(400);
    const scope = await workbenchPreferenceRequest(second, update, {
      changes: { pinnedOnly: false },
    });
    expect(scope.status).toBe(200);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }

  await http.restart();
  const reopened = await connect();
  const otherOwner = await connect('other-catalog-owner');
  const guest = await connect('catalog-guest');
  try {
    const result = await workbenchPreferenceRequest(reopened, read, {});
    expect(result.status).toBe(200);
    expect(fromBinary(read.output, Buffer.from(result.body, 'base64')).preferences).toMatchObject({
      layout: 'list',
      theme: 'dark',
      pinnedOnly: false,
    });
    const independent = await workbenchPreferenceRequest(otherOwner, read, {});
    expect(
      fromBinary(read.output, Buffer.from(independent.body, 'base64')).preferences,
    ).not.toHaveProperty('layout');
    expect((await workbenchPreferenceRequest(guest, read, {})).status).toBe(403);
    expect(
      (await workbenchPreferenceRequest(guest, update, { changes: { layout: 'grid' } })).status,
    ).toBe(403);
  } finally {
    await Promise.all([reopened.close(), otherOwner.close(), guest.close()]);
  }
});

function data<T>(result: Result): T {
  const view = result.structuredContent as { data?: T } | undefined;
  if (view?.data === undefined) {
    throw new Error(
      'Expected a structured MCP result. ' + JSON.stringify(result.structuredContent),
    );
  }

  return view.data;
}

async function list(studio: Studio, args: Record<string, unknown> = {}) {
  return data<ListPage>(await studio.call('artifact_list', args));
}

async function manage(studio: Studio, args: Record<string, unknown>) {
  const result = await studio.call('artifact_manage', args);
  expect(result.structuredContent, JSON.stringify(result.structuredContent)).toMatchObject({
    ok: true,
  });

  return data<{ artifact: Artifact }>(result).artifact;
}

function createBoard(studio: Studio, slug: string) {
  return manage(studio, { action: 'create', commandId: 'create-' + slug, title: slug });
}

function updateBoard(studio: Studio, board: Artifact, action: 'pin' | 'trash' | 'restore') {
  return manage(studio, {
    action,
    commandId: action + '-' + board.title,
    artifactId: board.id,
    expectedEntryVersion: board.entryVersion,
    ...(action === 'pin' ? { pinned: true } : {}),
  });
}

test('lists active and owned recycled boards with search, pin filters, sort and management versions', async () => {
  const studio = await connect();
  const visitor = await connect('mcp-list-visitor');
  try {
    const alpha = await createBoard(studio, 'Alpha');
    const beta = await createBoard(studio, 'Beta');
    const charlie = await createBoard(studio, 'Charlie');
    const delta = await createBoard(studio, 'Delta');
    await updateBoard(studio, beta, 'pin');
    await updateBoard(studio, charlie, 'trash');
    await updateBoard(studio, await updateBoard(studio, delta, 'pin'), 'trash');

    const active = await list(studio, { trashed: false, pinned: false, sort: 'title' });
    expect(active.artifacts.map(({ title }) => title)).toEqual(['Beta', 'Alpha']);
    expect(active.artifacts[1]).toMatchObject({
      id: alpha.id,
      type: 'whiteboard',
      canManage: true,
      entryVersion: alpha.entryVersion,
      revision: '0',
      updatedAt: expect.any(String),
    });
    expect((await list(studio, { pinned: true })).artifacts.map(({ id }) => id)).toEqual([beta.id]);
    expect((await list(studio, { query: '  aLPhA  ' })).artifacts.map(({ id }) => id)).toEqual([
      alpha.id,
    ]);
    const trash = await list(studio, { trashed: true, sort: 'title' });
    expect(trash.artifacts.map(({ title }) => title)).toEqual(['Charlie', 'Delta']);
    expect(
      (await list(studio, { trashed: true, sort: 'recent' })).artifacts.map(({ title }) => title),
    ).toEqual(['Delta', 'Charlie']);
    const pinnedTrash = await list(studio, { trashed: true, pinned: true });
    expect(pinnedTrash.artifacts[0]).toMatchObject({
      id: delta.id,
      pinned: true,
      trashedAt: expect.any(String),
    });
    expect(pinnedTrash.artifacts).toHaveLength(1);
    expect((await list(visitor, { trashed: true })).artifacts).toEqual([]);

    const trashFirst = await list(studio, { trashed: true, sort: 'title', limit: 1 });
    expect(trashFirst.nextCursor).toBeTypeOf('string');
    const trashSecond = await list(studio, {
      trashed: true,
      sort: 'title',
      cursor: trashFirst.nextCursor,
    });
    expect(trashSecond.artifacts.map(({ id }) => id)).toEqual([delta.id]);

    const [selected] = pinnedTrash.artifacts;
    if (!selected) {
      throw new Error('Expected the pinned recycled board');
    }

    const restored = await updateBoard(studio, selected, 'restore');
    expect((await list(studio, { pinned: true })).artifacts.map(({ id }) => id)).toContain(
      restored.id,
    );
    expect((await list(studio, { trashed: true })).artifacts.map(({ id }) => id)).toEqual([
      charlie.id,
    ]);
  } finally {
    await Promise.all([studio.close(), visitor.close()]);
  }
});

test('paginates the exact catalog query and rejects mismatched cursor scopes and offsets', async () => {
  const studio = await connect();
  const visitor = await connect('mcp-cursor-visitor');
  try {
    await createBoard(studio, 'map-Alpha');
    await createBoard(studio, 'map-Beta');
    await createBoard(studio, 'map-Charlie');
    const scope = { query: 'map-', sort: 'title' };
    const first = await list(studio, { ...scope, limit: 1 });
    expect(first).toMatchObject({ artifacts: [{ title: 'map-Alpha' }], offset: 0, nextOffset: 1 });
    expect(first.nextCursor).toBeTypeOf('string');
    const cursor = first.nextCursor;
    const second = await list(studio, { ...scope, pageSize: 1, cursor });
    expect(second).toMatchObject({ artifacts: [{ title: 'map-Beta' }] });
    expect(second.offset).toBeUndefined();
    const offset = await list(studio, { ...scope, limit: 1, offset: 1 });
    expect(offset).toMatchObject({ artifacts: [{ title: 'map-Beta' }], offset: 1, nextOffset: 2 });
    const last = await list(studio, { ...scope, pageSize: 1, cursor: offset.nextCursor });
    expect(last.artifacts.map(({ title }) => title)).toEqual(['map-Charlie']);
    expect(last.nextCursor).toBeUndefined();

    const invalid = [
      { ...scope, query: 'different', cursor },
      { ...scope, pinned: true, cursor },
      { ...scope, sort: 'recent', cursor },
      { ...scope, trashed: true, cursor },
      { ...scope, cursor, offset: 0 },
      { ...scope, limit: 1, pageSize: 2 },
    ];

    for (const request of invalid) {
      expect((await studio.call('artifact_list', request)).structuredContent).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT' },
      });
    }
    expect(
      (await visitor.call('artifact_list', { ...scope, cursor })).structuredContent,
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
  } finally {
    await Promise.all([studio.close(), visitor.close()]);
  }
});
