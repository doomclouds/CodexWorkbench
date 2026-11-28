import { Buffer } from 'node:buffer';
import {
  BoardExportFormat,
  WhiteboardService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, test } from 'vitest';
import { createStudioMcpServer, type LocalRequest } from '../../src/entrypoints/mcp/index.js';
import { actorHeader, callWhiteboard } from '../support/whiteboard-client.js';
import { mainBoardId, viewerId } from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const http = useWhiteboardTestServer();
const owner = 'catalog-model-owner';

type Options = Parameters<typeof createStudioMcpServer>[0];

interface FixtureOptions {
  readonly actor?: string;
  readonly loseCreateResponse?: boolean;
  readonly readArchiveFile?: Options['readArchiveFile'];
  readonly readAssetFile?: Options['readAssetFile'];
}

interface ModelBoard {
  readonly id: string;
  readonly title: string;
  readonly entryVersion: string;
}

interface ModelAsset {
  readonly assetId: string;
}

async function fixture({
  actor = owner,
  loseCreateResponse,
  readArchiveFile,
  readAssetFile,
}: FixtureOptions = {}) {
  let counter = 0;
  let responseLost = false;
  const requests: LocalRequest[] = [];
  const server = createStudioMcpServer({
    html: '<html></html>',
    pluginVersion: '1.0.0',
    now: () => 0,
    allocateId: () => 'manage-test-allocation-' + ++counter,
    createFile: () => Promise.reject(new Error('Unexpected file spool.')),
    readArchiveFile,
    readAssetFile,
    async dispatch(request, signal) {
      requests.push(request);
      const headers = new Headers({ [actorHeader]: actor });
      if (request.mediaType) {
        headers.set('content-type', request.mediaType);
      }
      if (request.commandId) {
        headers.set('x-studio-command-id', request.commandId);
      }
      const response = await fetch(new URL(request.route, http.address), {
        method: request.method,
        headers,
        body: request.body instanceof Uint8Array ? Buffer.from(request.body) : request.body,
        signal,
      });

      if (loseCreateResponse && !responseLost && request.route.endsWith('/CreateBoard')) {
        responseLost = true;
        await response.body?.cancel();

        return new Response(null, { status: 503 });
      }

      return response;
    },
    onError() {},
  });
  const client = new Client({ name: 'manage-acceptance', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    requests,
    call: (input: Record<string, unknown>) =>
      client.callTool({ name: 'artifact_manage', arguments: input }),
    async close() {
      await client.close();
      await server.close();
    },
  };
}

type ManageFixture = Awaited<ReturnType<typeof fixture>>;

function board(result: Awaited<ReturnType<ManageFixture['call']>>): ModelBoard {
  const frame = result.structuredContent as { data?: { artifact?: ModelBoard } } | undefined;
  const data = frame?.data;
  if (!data?.artifact) {
    throw new Error('Expected an artifact in the management receipt');
  }

  return data.artifact;
}

function create(client: ManageFixture, commandId: string, title: string) {
  return client.call({ action: 'create', commandId, title });
}

function replaceEntry(
  client: ManageFixture,
  current: ModelBoard,
  action: 'rename' | 'pin' | 'trash' | 'restore',
  details: Record<string, unknown> = {},
) {
  return client.call({
    action,
    commandId: action + '-' + current.entryVersion,
    artifactId: current.id,
    expectedEntryVersion: current.entryVersion,
    ...details,
  });
}

test('exposes catalog lifecycle with stable receipts, optimistic versions, and batch purge results', async () => {
  const client = await fixture();
  try {
    const { tools } = await client.client.listTools();
    expect(tools.find(({ name }) => name === 'artifact_manage')?._meta).toEqual({
      ui: { visibility: ['model'] },
    });
    const source = board(await create(client, 'create-one', '作品甲'));
    expect(
      board(await client.call({ action: 'create', operationId: 'create-one', title: '作品甲' })),
    ).toEqual(source);
    expect((await create(client, 'create-one', '误复用')).structuredContent).toMatchObject({
      ok: false,
      error: { code: 'COMMAND_ID_REUSE' },
    });

    const duplicate = board(
      await client.call({
        action: 'duplicate',
        commandId: 'copy-one',
        boardId: source.id,
      }),
    );
    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate.title).toContain('作品甲');
    const renamed = board(await replaceEntry(client, source, 'rename', { title: '新的标题' }));
    expect(
      (await replaceEntry(client, source, 'pin', { pinned: true })).structuredContent,
    ).toMatchObject({
      ok: false,
      error: { code: 'ENTRY_VERSION_CHANGED' },
    });
    const pinned = await replaceEntry(client, renamed, 'pin', { pinned: true });
    expect(pinned.structuredContent).toMatchObject({ data: { artifact: { pinned: true } } });
    const trashed = board(await replaceEntry(client, board(pinned), 'trash'));
    const restored = board(await replaceEntry(client, trashed, 'restore'));
    const again = board(await replaceEntry(client, restored, 'trash'));

    const purge = {
      action: 'purge',
      commandId: 'purge-mixed',
      artifactIds: [again.id, duplicate.id],
      expectedEntryVersions: {
        [again.id]: again.entryVersion,
        [duplicate.id]: duplicate.entryVersion,
      },
    };
    const deleted = await client.call(purge);
    expect(deleted.structuredContent).toMatchObject({
      ok: true,
      data: {
        deletedIds: [again.id],
        failures: [{ artifactId: duplicate.id, code: 'STATE_CHANGED' }],
      },
    });
    const receipt = await client.call({ action: 'receipt', commandId: 'purge-mixed' });
    expect(receipt.structuredContent).toEqual(deleted.structuredContent);
    expect((await client.call(purge)).structuredContent).toEqual(deleted.structuredContent);
  } finally {
    await client.close();
  }
});

test('keeps an ambiguous transport error tied to the original command and can read its receipt', async () => {
  const client = await fixture({ loseCreateResponse: true });
  try {
    const dropped = await create(client, 'unknown-save', '恢复回执');
    expect(dropped.structuredContent).toMatchObject({
      ok: false,
      error: { code: 'COMMIT_RESULT_UNKNOWN' },
      data: { commandId: 'unknown-save', receiptKind: 'catalog' },
    });
    const saved = board(await client.call({ action: 'receipt', commandId: 'unknown-save' }));
    expect(board(await create(client, 'unknown-save', '恢复回执'))).toEqual(saved);
  } finally {
    await client.close();
  }
});

test('does not write for invalid purge inputs or an unauthorized member', async () => {
  const client = await fixture({ actor: viewerId });
  try {
    const invalid = await client.call({
      action: 'purge',
      commandId: 'invalid-batch',
      artifactIds: ['only', 'only'],
      expectedEntryVersions: { only: 0 },
    });
    expect(invalid.structuredContent).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
    expect(client.requests).toHaveLength(0);
    const denied = await client.call({
      action: 'rename',
      commandId: 'viewer-write',
      artifactId: mainBoardId,
      expectedEntryVersion: 0,
      title: '不可修改',
    });
    expect(denied.structuredContent).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  } finally {
    await client.close();
  }
});

test('uploads an explicitly picked backup through the archive route and reads the matching archive receipt', async () => {
  const inputs: string[] = [];
  let archive = new Uint8Array();
  const client = await fixture({
    readArchiveFile(path) {
      inputs.push(path);

      return Promise.resolve(archive);
    },
  });

  try {
    const existing = board(await create(client, 'import-source', '导出样本'));
    const { result } = await callWhiteboard(
      http.address,
      owner,
      WhiteboardService.method.exportBoard,
      {
        boardId: existing.id,
        expectedRevision: 0n,
        format: BoardExportFormat.ZIP,
        scope: { case: 'whole', value: {} },
      },
    );

    if (result.case !== 'file') {
      throw new Error('The archive export did not return a file.');
    }

    archive = new Uint8Array(result.value.content);

    const imported = await client.call({
      action: 'import',
      commandId: 'import-one',
      archivePath: 'C:/user/whiteboard.studio.zip',
    });
    expect(board(imported).id).not.toBe(existing.id);
    expect(inputs).toEqual(['C:/user/whiteboard.studio.zip']);
    expect(client.requests.at(-1)).toMatchObject({
      route: expect.stringMatching(/\/ImportBoardArchive$/u),
      mediaType: 'application/zip',
      commandId: 'import-one',
    });
    const receipt = await client.call({
      action: 'receipt',
      commandId: 'import-one',
      receiptKind: 'archive',
    });
    expect(receipt.structuredContent).toEqual(imported.structuredContent);
  } finally {
    await client.close();
  }
});

test('imports a media asset once, lists it and removes it with the same stable identifier', async () => {
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Efp8AAAAASUVORK5CYII=',
    'base64',
  );
  const paths: string[] = [];
  const client = await fixture({
    readAssetFile(path) {
      paths.push(path);

      return Promise.resolve(bytes);
    },
  });

  try {
    const created = board(await create(client, 'assets-board', '素材样例'));
    const command = {
      action: 'asset-import',
      boardId: created.id,
      commandId: 'asset-one',
      assetPath: 'C:/user/artwork.png',
    };
    const imported = await client.call(command);
    const frame = imported.structuredContent as { data?: { asset?: ModelAsset } } | undefined;
    const assetId = frame?.data?.asset?.assetId;
    expect(assetId).toBeTruthy();
    expect((await client.call(command)).structuredContent).toEqual(imported.structuredContent);
    const listing = await client.call({ action: 'asset-list', artifactId: created.id });
    expect(listing.structuredContent).toMatchObject({
      ok: true,
      data: { assets: [{ assetId, mediaType: 'image/png', byteLength: bytes.byteLength }] },
    });
    expect(paths).toEqual([command.assetPath, command.assetPath]);

    const remove = { action: 'asset-delete', boardId: created.id, assetId };
    const removed = await client.call(remove);
    expect(removed.structuredContent).toMatchObject({
      ok: true,
      data: { status: 'removed', assetId },
    });
    expect((await client.call(remove)).structuredContent).toEqual(removed.structuredContent);
    expect(
      (await client.call({ action: 'asset-list', artifactId: created.id })).structuredContent,
    ).toMatchObject({ ok: true, data: { assets: [] } });
  } finally {
    await client.close();
  }
});
