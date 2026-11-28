import assert from 'node:assert/strict';
import {
  appendFile,
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pluginRoot = fileURLToPath(new URL('../plugins/luming-studio-ii/', import.meta.url));
const serverRoot = join(pluginRoot, 'apps', 'server');
const webRoot = join(pluginRoot, 'apps', 'web');
const runtime = join(pluginRoot, 'runtime');
const requireServer = createRequire(join(serverRoot, 'package.json'));
const requireWeb = createRequire(join(webRoot, 'package.json'));
const { build: bundle } = await import(pathToFileURL(requireWeb.resolve('esbuild')).href);
const { build: viteBuild } = await import(pathToFileURL(requireWeb.resolve('vite')).href);
const manifest = requireServer(join(pluginRoot, 'plugin.json'));
const { version } = manifest;
assert.equal(requireServer(join(pluginRoot, 'package.json')).version, version);

async function normalizeWebScripts(webPath) {
  const emitted = await readdir(webPath, { recursive: true, withFileTypes: true });
  const scripts = emitted.filter((entry) => entry.isFile() && entry.name.endsWith('.js'));
  await Promise.all(
    scripts.map(async ({ parentPath, name }) => {
      const path = join(parentPath, name);
      const content = await readFile(path);
      if (content.at(-1) !== 10) {
        await appendFile(path, '\n');
      }
    }),
  );
}

async function buildRuntime() {
  await mkdir(runtime, { recursive: true });
  const runtimePath = await realpath(runtime);
  assert.equal(dirname(runtimePath), await realpath(pluginRoot));
  assert.equal(basename(runtimePath), 'runtime');
  await mkdir(join(runtimePath, 'web'), { recursive: true });
  const webPath = await realpath(join(runtimePath, 'web'));
  assert.equal(dirname(webPath), runtimePath);
  assert.equal(basename(webPath), 'web');

  await bundle({
    absWorkingDir: serverRoot,
    entryPoints: { server: 'src/bootstrap/mcp-main.ts', backend: 'src/bootstrap/main.ts' },
    outdir: runtimePath,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
  });
  await copyFile(
    requireServer.resolve('@resvg/resvg-wasm/index_bg.wasm'),
    join(runtimePath, 'resvg.wasm'),
  );
  await viteBuild({ root: webRoot, mode: 'mcp', logLevel: 'error' });
  await copyFile(join(webRoot, 'dist', 'mcp', 'mcp.html'), join(runtimePath, 'app.html'));
  await viteBuild({
    root: webRoot,
    mode: 'whiteboard',
    logLevel: 'error',
    build: { outDir: webPath, emptyOutDir: true },
  });
  await normalizeWebScripts(webPath);
}

function decodeFrame(result, key) {
  assert.notEqual(result.isError, true);
  assert.equal(result.structuredContent?.ok, true);
  assert.equal(result.content.length, 0);
  const frame = result._meta?.[key];
  assert.ok(frame);

  return frame;
}

async function privateHttpStatus(service, token, method, body) {
  const endpoint = new URL('/' + method.parent.typeName + '/' + method.name, service.origin);
  assert.equal(endpoint.hostname, '127.0.0.1');
  const response = await fetch(endpoint, {
    method: 'POST',
    body,
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/protobuf' },
    signal: AbortSignal.timeout(5000),
  });
  await response.body?.cancel();

  return response.status;
}

async function verifyAppTools(client) {
  const { tools } = await client.listTools();
  const expectedTools = [
    'artifact_activity',
    'artifact_apply',
    'artifact_context',
    'artifact_export',
    'artifact_feedback',
    'artifact_list',
    'artifact_manage',
    'artifact_read',
    'artifact_share',
    'artifact_suggest',
    'studio_app_request',
    'studio_open',
  ];
  assert.deepEqual(tools.map(({ name }) => name).sort(), expectedTools);
  const openTool = tools.find(({ name }) => name === 'studio_open');
  const requestTool = tools.find(({ name }) => name === 'studio_app_request');
  assert.deepEqual(openTool?._meta?.ui?.visibility, ['app']);
  assert.deepEqual(openTool?._meta?.['openai/ui']?.entrypoints, [{ type: 'thread' }]);
  assert.deepEqual(requestTool?._meta?.ui?.visibility, ['app']);
}

async function verifyAppResource(client) {
  const uri = 'ui://luming-studio-ii/app';
  const iconSrc =
    'data:image/png;base64,' +
    (await readFile(join(pluginRoot, 'assets', 'icon64.png'))).toString('base64');
  assert.equal(client.getServerVersion()?.icons?.[0]?.src, iconSrc);
  const resources = await client.listResources();
  const resource = resources.resources.find((candidate) => candidate.uri === uri);
  assert.equal(resource?.icons?.[0]?.src, iconSrc);
  const app = (await client.readResource({ uri })).contents[0];
  assert.equal(app?.mimeType, 'text/html;profile=mcp-app');
  assert.match(app?.text ?? '', /<script/);
  assert.ok(app?.text?.includes(iconSrc));
  assert.deepEqual(app?._meta?.ui?.csp?.connectDomains, []);
  assert.equal(app?._meta?.['openai/ui']?.preferredDisplayMode, 'fullscreen');
}

async function openWorkbench(client) {
  await verifyAppTools(client);
  await verifyAppResource(client);
  const open = await client.callTool({ name: 'studio_open', arguments: {} });
  const { id } = decodeFrame(open, 'session');
  assert.deepEqual(Object.keys(open._meta.session).sort(), ['expiresAtMillis', 'id']);
  assert.equal(open.structuredContent.data.boardId, undefined);

  return id;
}

function createAppRpc(client, sessionId) {
  const { create, fromBinary, toBinary } = requireServer('@bufbuild/protobuf');

  return async (service, method, input, current = sessionId) => {
    const body = Buffer.from(toBinary(method.input, create(method.input, input))).toString(
      'base64',
    );
    const result = await client.callTool({
      name: 'studio_app_request',
      arguments: {
        version: 1,
        action: 'request',
        sessionId: current,
        service: service.typeName,
        method: method.name,
        body,
      },
    });
    const privateResponse = decodeFrame(result, 'response');
    assert.equal(privateResponse.status, 200);
    assert.equal(privateResponse.contentType, 'application/protobuf');

    return fromBinary(method.output, Buffer.from(privateResponse.body, 'base64'));
  };
}

async function verifyBoardRoundtrip(client, sessionId, rpc) {
  const { create, toBinary } = requireServer('@bufbuild/protobuf');
  const { BoardCatalogService } = requireServer(
    '@codexworkbench/luming-studio-ii-contracts/catalog/service',
  );
  const { WhiteboardService } = requireServer(
    '@codexworkbench/luming-studio-ii-contracts/whiteboard/service',
  );
  const { receipt } = await rpc(BoardCatalogService, BoardCatalogService.method.createBoard, {
    commandId: 'packaged-mcp-create',
    title: 'MCP runtime smoke',
  });
  assert.equal(receipt?.outcome.case, 'created');
  const { boardId, entryVersion } = receipt.outcome.value;
  const { scene } = await rpc(WhiteboardService, WhiteboardService.method.getBoardScene, {
    boardId,
  });
  assert.equal(scene?.title, 'MCP runtime smoke');
  assert.equal(scene?.access?.canEdit, true);

  const scopedOpen = await client.callTool({ name: 'studio_open', arguments: { boardId } });
  const { id: scopedSessionId } = decodeFrame(scopedOpen, 'session');
  const scopedScene = await rpc(
    WhiteboardService,
    WhiteboardService.method.getBoardScene,
    { boardId },
    scopedSessionId,
  );
  assert.equal(scopedScene.scene?.boardId, boardId);
  const wrongBoard = await client.callTool({
    name: 'studio_app_request',
    arguments: {
      version: 1,
      action: 'request',
      sessionId: scopedSessionId,
      service: WhiteboardService.typeName,
      method: WhiteboardService.method.getBoardScene.name,
      body: Buffer.from(
        toBinary(
          WhiteboardService.method.getBoardScene.input,
          create(WhiteboardService.method.getBoardScene.input, { boardId: 'different-board' }),
        ),
      ).toString('base64'),
    },
  });
  assert.equal(wrongBoard.structuredContent.error.code, 'INVALID_ARGUMENT');
  await client.callTool({
    name: 'studio_app_request',
    arguments: { version: 1, action: 'close', sessionId: scopedSessionId },
  });

  const found = await client.callTool({ name: 'artifact_list', arguments: { query: 'runtime' } });
  const { artifacts } = found.structuredContent.data;
  assert.deepEqual(
    artifacts.map(({ updatedAt, ...board }) => board),
    [
      {
        id: boardId,
        title: 'MCP runtime smoke',
        type: 'whiteboard',
        pinned: false,
        canManage: true,
        entryVersion: entryVersion.toString(),
        revision: scene.boardRevision.toString(),
      },
    ],
  );
  assert.ok(Number.isFinite(Date.parse(artifacts[0].updatedAt)));

  const rejected = await client.callTool({
    name: 'studio_app_request',
    arguments: {
      version: 1,
      action: 'request',
      sessionId,
      service: 'https://example.invalid',
      method: 'ListBoards',
    },
  });
  assert.equal(rejected.isError, true);
  assert.equal(rejected.structuredContent.error.code, 'INVALID_ARGUMENT');
  assert.equal(rejected._meta, undefined);

  return boardId;
}

async function verifyArchiveRoundtrip(client, sessionId) {
  const { fromBinary } = requireServer('@bufbuild/protobuf');
  const { ImportBoardArchiveResponseSchema } = requireServer(
    '@codexworkbench/luming-studio-ii-contracts/archives/service',
  );
  const archive = await readFile(
    join(serverRoot, 'tests', 'fixtures', 'archives', 'legacy-v4.studio.zip'),
  );
  const middle = Math.floor(archive.byteLength / 2);
  const first = await client.callTool({
    name: 'studio_app_request',
    arguments: {
      version: 1,
      action: 'upload',
      sessionId,
      size: archive.byteLength,
      offset: 0,
      data: archive.subarray(0, middle).toString('base64'),
    },
  });
  const { transferId, nextOffset } = decodeFrame(first, 'transfer');
  assert.equal(nextOffset, middle);
  const second = await client.callTool({
    name: 'studio_app_request',
    arguments: {
      version: 1,
      action: 'upload',
      sessionId,
      transferId,
      size: archive.byteLength,
      offset: middle,
      data: archive.subarray(middle).toString('base64'),
    },
  });
  assert.equal(decodeFrame(second, 'transfer').nextOffset, archive.byteLength);

  const imported = await client.callTool({
    name: 'studio_app_request',
    arguments: {
      version: 1,
      action: 'request',
      sessionId,
      service: 'luming.studio.v1.BoardArchiveService',
      method: 'ImportBoardArchive',
      commandId: 'packaged-mcp-archive',
      uploadId: transferId,
    },
  });
  const importedResponse = decodeFrame(imported, 'response');
  assert.equal(importedResponse.status, 200);
  const { receipt: archiveReceipt } = fromBinary(
    ImportBoardArchiveResponseSchema,
    Buffer.from(importedResponse.body, 'base64'),
  );
  assert.equal(archiveReceipt?.outcome.case, 'imported');

  return archiveReceipt.outcome.value.boardId;
}

async function verifySuggestionRoundtrip(client, sessionId, rpc, reviewBoard, dataRoot) {
  const { create, fromJson, toBinary } = requireServer('@bufbuild/protobuf');
  const { BoardSuggestionService } = requireServer(
    '@codexworkbench/luming-studio-ii-contracts/suggestions/service',
  );
  const { WhiteboardService } = requireServer(
    '@codexworkbench/luming-studio-ii-contracts/whiteboard/service',
  );
  const reviewedObject = 'release-scope';
  const review = await rpc(
    BoardSuggestionService,
    BoardSuggestionService.method.createBoardReviewSource,
    {
      boardId: reviewBoard,
      commandId: 'packaged-mcp-freeze',
      expectedBoardRevision: 0n,
      origin: { case: 'selection', value: { objectIds: [reviewedObject] } },
    },
  );
  assert.ok(review.source?.sourceId);
  assert.deepEqual(review.source.objectIds, [reviewedObject]);
  assert.equal(review.source.targetsBoardRevision, 0n);
  const [capturedObject] = review.source.targets;
  assert.equal(capturedObject?.objectId, reviewedObject);
  assert.equal(capturedObject?.geometryVersion, 0n);
  assert.ok(capturedObject.geometry);
  const { x, y, width, height, rotation } = capturedObject.geometry;
  const resizedWidth = width + 40;
  const expectedGeometryVersion = String(capturedObject.geometryVersion);
  const proposal = {
    boardId: reviewBoard,
    sourceId: review.source.sourceId,
    commandId: 'packaged-mcp-suggest',
    observation: '冻结范围需要人工确认。',
    options: [
      {
        optionId: 'lock-shape',
        label: '扩大并锁定该对象',
        operations: [
          {
            geometry: {
              transform: {
                kind: 'BOARD_TRANSFORM_KIND_RESIZE',
                objects: [
                  {
                    target: { objectId: reviewedObject, expectedGeometryVersion },
                    geometry: { x, y, width: resizedWidth, height, rotation },
                  },
                ],
              },
            },
          },
          {
            geometry: {
              changeLock: {
                locked: true,
                targets: [{ objectId: reviewedObject, expectedGeometryVersion }],
              },
            },
          },
        ],
      },
      {
        optionId: 'remove-shape',
        label: '移除该对象',
        edit: {
          geometry: {
            delete: { targets: [{ objectId: reviewedObject, expectedGeometryVersion }] },
          },
        },
      },
    ],
  };
  const backend = JSON.parse(await readFile(join(dataRoot, 'service.json'), 'utf8'));
  assert.ok(backend.token !== backend.agentToken, 'Owner and Agent credentials are distinct.');
  const submit = BoardSuggestionService.method.submitBoardSuggestion;
  const submitBody = toBinary(
    submit.input,
    fromJson(submit.input, {
      ...proposal,
      options: proposal.options.map(({ edit, ...option }) => ({ ...option, ...edit })),
    }),
  );
  assert.equal(await privateHttpStatus(backend, backend.token, submit, submitBody), 403);
  const appSubmit = await client.callTool({
    name: 'studio_app_request',
    arguments: {
      version: 1,
      action: 'request',
      sessionId,
      service: BoardSuggestionService.typeName,
      method: submit.name,
      body: Buffer.from(submitBody).toString('base64'),
    },
  });
  assert.equal(appSubmit.structuredContent.error.code, 'INVALID_ARGUMENT');

  const { tools } = await client.listTools();
  const modelTool = tools.find(({ name }) => name === 'artifact_suggest');
  const choices = modelTool?.inputSchema.properties?.options?.items?.anyOf;
  assert.ok(choices?.some(({ required }) => required.includes('edit')));
  assert.ok(choices.some(({ properties }) => properties.operations?.maxItems === 60));
  assert.equal(
    tools.some(({ name }) => /^(?:artifact_accept|artifact_withdraw)$/u.test(name)),
    false,
  );

  const invalid = await client.callTool({
    name: 'artifact_suggest',
    arguments: {
      ...proposal,
      commandId: 'invalid-both-review-formats',
      options: [
        { ...proposal.options[0], edit: proposal.options[0].operations[0] },
        proposal.options[1],
      ],
    },
  });
  assert.equal(invalid.isError, true);

  const submitted = await client.callTool({
    name: 'artifact_suggest',
    arguments: proposal,
  });
  assert.notEqual(submitted.isError, true);
  const { proposalId, proposalVersion } = submitted.structuredContent.data.suggestion;
  const selection = {
    boardId: reviewBoard,
    proposalId,
    optionId: 'lock-shape',
    expectedProposalVersion: BigInt(proposalVersion),
  };
  const preview = await rpc(
    BoardSuggestionService,
    BoardSuggestionService.method.previewBoardSuggestion,
    selection,
  );
  assert.equal(preview.result.case, 'preview');
  const staged = preview.result.value.changedObjects.find(
    ({ objectId }) => objectId === reviewedObject,
  );
  assert.equal(staged?.geometry?.width, resizedWidth);
  assert.equal(staged?.locked, true);
  const beforeAccept = await rpc(WhiteboardService, WhiteboardService.method.getBoardScene, {
    boardId: reviewBoard,
  });
  assert.equal(beforeAccept.scene.boardRevision, 0n);
  assert.equal(
    beforeAccept.scene.objects.find(({ objectId }) => objectId === reviewedObject)?.locked,
    false,
  );
  const accept = BoardSuggestionService.method.acceptBoardSuggestion;
  const acceptance = {
    ...selection,
    commandId: 'packaged-mcp-accept',
  };
  assert.equal(
    await privateHttpStatus(
      backend,
      backend.agentToken,
      accept,
      toBinary(accept.input, create(accept.input, acceptance)),
    ),
    403,
  );
  const accepted = await rpc(BoardSuggestionService, accept, acceptance);
  assert.equal(accepted.receipt?.outcome.case, 'applied');
  const confirmed = await rpc(WhiteboardService, WhiteboardService.method.getBoardScene, {
    boardId: reviewBoard,
  });
  assert.equal(confirmed.scene.boardRevision, 1n);
  assert.equal(
    confirmed.scene.objects.find(({ objectId }) => objectId === reviewedObject)?.geometry?.width,
    resizedWidth,
  );
  assert.equal(
    confirmed.scene.objects.find(({ objectId }) => objectId === reviewedObject)?.locked,
    true,
  );
}

async function verifyGuestAssetRefresh(rpc, boardId, install) {
  const { BoardSharingService, SharingScope } = requireServer(
    '@codexworkbench/luming-studio-ii-contracts/sharing/service',
  );
  const { getBoardSharing, updateBoardSharing } = BoardSharingService.method;
  const current = await rpc(BoardSharingService, getBoardSharing, { boardId });
  await rpc(BoardSharingService, updateBoardSharing, {
    boardId,
    commandId: 'runtime-refresh-probe',
    expectedVersion: current.sharing.version,
    operation: { case: 'setScope', value: { scope: SharingScope.LOCAL } },
  });
  const next = await rpc(BoardSharingService, getBoardSharing, { boardId });
  const invite = new URL(next.sharing.links.find(({ enabled, url }) => enabled && url)?.url);
  assert.equal(invite.protocol, 'http:');
  assert.equal(invite.hostname, '127.0.0.1');

  const entry = new URL('/', invite);
  const filename = 'runtime-refresh-probe.js';
  const asset = new URL('/assets/' + filename, invite);
  const load = (url) => fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.equal((await load(entry)).status, 200);
  assert.equal((await load(asset)).status, 404);

  const web = join(install, 'runtime', 'web');
  const javascript = 'export const refreshed = true;\n';
  await writeFile(join(web, 'assets', filename), javascript);
  await writeFile(
    join(web, 'index.html'),
    `<html><script src="/assets/${filename}"></script></html>`,
  );
  const replaced = await load(entry);
  assert.equal(replaced.status, 200);
  const html = await replaced.text();
  assert.ok(html.includes('data-studio-guest-entry="true"') && html.includes(filename));
  const updated = await load(asset);
  assert.equal(updated.status, 200);
  assert.match(updated.headers.get('content-type') ?? '', /^text\/javascript/u);
  assert.equal(await updated.text(), javascript);
}

async function verifyLivePanelReading(invoke, boardId, objectId) {
  const panel = await invoke('studio_app_request', { version: 1, action: 'connect', boardId });
  const panelSession = panel._meta?.session?.id;
  assert.ok(panelSession);
  const view = { boardId, viewId: 'packaged-mcp-view', mode: 'context' };
  const camera = { x: 80, y: -35, zoom: 0.75 };
  const synced = await invoke('studio_app_request', {
    version: 1,
    action: 'view',
    sessionId: panelSession,
    viewId: view.viewId,
    sequence: 1,
    state: {
      boardId,
      selectedIds: [objectId],
      selectedCount: 1,
      viewport: camera,
      focusedObjectId: objectId,
    },
  });
  assert.equal(synced.structuredContent?.ok, true);
  const focused = await invoke('artifact_read', view);
  assert.equal(focused.structuredContent?.data?.source, 'live-panel');
  assert.deepEqual(focused.structuredContent.data.contexts[0].selectedIds, [objectId]);
  assert.deepEqual(focused.structuredContent.data.contexts[0].viewport, camera);
  await invoke('studio_app_request', { version: 1, action: 'close', sessionId: panelSession });
  const closed = await invoke('artifact_read', view);
  assert.equal(closed.structuredContent?.error?.code, 'LIVE_CONTEXT_REQUIRED');
}

async function verifyModelReadingAndWriting(client, rpc, boardId) {
  const { WhiteboardService } = requireServer(
    '@codexworkbench/luming-studio-ii-contracts/whiteboard/service',
  );
  const objectId = 'release-scope';
  const invoke = async (name, args) => client.callTool({ name, arguments: args });
  const overview = await invoke('artifact_context', {
    boardId,
    scope: { kind: 'objects', objectIds: [objectId] },
    include: ['overview', 'text'],
  });
  assert.equal(overview.structuredContent?.ok, true);
  assert.deepEqual(
    overview.structuredContent.data.objects.map(({ id }) => id),
    [objectId],
  );
  assert.ok(overview.content.every(({ type }) => type !== 'image'));

  const read = await invoke('artifact_read', { boardId, mode: 'objects', ids: [objectId] });
  assert.equal(read.structuredContent?.ok, true);
  const [target] = read.structuredContent.data.items;
  assert.equal(target.id, objectId);
  const expectedGeometryVersion = target.object.geometryVersion;
  assert.match(expectedGeometryVersion, /^\d+$/u);
  await verifyLivePanelReading(invoke, boardId, objectId);
  const taskId = 'packaged-mcp-scoped-agent';
  const activity = await invoke('artifact_activity', {
    action: 'begin',
    boardId,
    taskId,
    label: '检查已授权对象',
    scope: { objectIds: [objectId] },
  });
  assert.equal(activity.structuredContent?.ok, true);
  const { generation } = activity.structuredContent.data;
  assert.ok(generation);
  const command = {
    boardId,
    taskId,
    generation,
    commandId: 'packaged-mcp-agent-unlock',
    operations: [
      {
        geometry: {
          changeLock: { locked: false, targets: [{ objectId, expectedGeometryVersion }] },
        },
      },
    ],
  };
  const lookup = { ...command, mode: 'operation-receipt' };
  const missing = await invoke('artifact_read', lookup);
  assert.equal(missing.structuredContent?.error?.code, 'COMMIT_RESULT_UNKNOWN');
  const before = await rpc(WhiteboardService, WhiteboardService.method.getBoardScene, {
    boardId,
  });
  assert.equal(
    before.scene?.objects.find((candidate) => candidate.objectId === objectId)?.locked,
    true,
  );
  const applied = await invoke('artifact_apply', command);
  assert.equal(applied.structuredContent?.ok, true);
  assert.ok(applied.structuredContent.data.receipt.applied);
  const { scene } = await rpc(WhiteboardService, WhiteboardService.method.getBoardScene, {
    boardId,
  });
  assert.equal(scene.objects.find((candidate) => candidate.objectId === objectId)?.locked, false);

  const ended = await invoke('artifact_activity', { action: 'end', boardId, taskId, generation });
  assert.equal(ended.structuredContent?.ok, true);
  const committed = await invoke('artifact_read', lookup);
  assert.equal(committed.structuredContent?.ok, true);
  assert.deepEqual(
    committed.structuredContent.data.receipt,
    applied.structuredContent.data.receipt,
  );
  const replay = await invoke('artifact_apply', command);
  assert.deepEqual(replay.structuredContent?.data?.receipt, applied.structuredContent.data.receipt);
  const stale = await invoke('artifact_apply', {
    ...command,
    commandId: 'packaged-mcp-agent-ended',
  });
  assert.equal(stale.isError, true);
  assert.equal(stale.structuredContent?.ok, false);
}

async function protocolSmoke(client, dataRoot, install) {
  const sessionId = await openWorkbench(client);
  const rpc = createAppRpc(client, sessionId);
  const boardId = await verifyBoardRoundtrip(client, sessionId, rpc);
  const reviewBoard = await verifyArchiveRoundtrip(client, sessionId);
  await verifySuggestionRoundtrip(client, sessionId, rpc, reviewBoard, dataRoot);
  await verifyModelReadingAndWriting(client, rpc, reviewBoard);
  await verifyGuestAssetRefresh(rpc, boardId, install);
  await client.callTool({
    name: 'studio_app_request',
    arguments: { version: 1, action: 'close', sessionId },
  });

  return boardId;
}

async function closeProbeBackend(dataRoot) {
  let record;
  try {
    record = JSON.parse(await readFile(join(dataRoot, 'service.json'), 'utf8'));
  } catch (error) {
    if (error instanceof Error && error.code === 'ENOENT') {
      return;
    }

    throw error;
  }

  const origin = new URL(record.origin);
  assert.equal(origin.protocol, 'http:');
  assert.equal(origin.hostname, '127.0.0.1');
  assert.ok(Number.isInteger(record.pid) && record.pid > 0);

  try {
    const endpoint = new URL('/luming.studio.v1.WhiteboardService/GetBoardScene', origin);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + record.token, 'content-type': 'application/protobuf' },
      signal: AbortSignal.timeout(1500),
    });
    assert.equal(response.status, 400);
    process.kill(record.pid, 'SIGTERM');
  } catch (error) {
    if (error instanceof Error && error.code === 'ESRCH') {
      return;
    }

    throw error;
  }

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await delay(50);
    try {
      process.kill(record.pid, 0);
    } catch (error) {
      if (error instanceof Error && error.code === 'ESRCH') {
        return;
      }

      throw error;
    }
  }
  throw new Error('The isolated Studio verification process has not exited.');
}

async function verifyRuntime() {
  const temp = await realpath(tmpdir());
  const scratch = await mkdtemp(join(temp, 'luming-ii-runtime-check-'));
  const install = join(scratch, 'installed');
  const data = join(scratch, 'data');
  const { Client } = requireServer('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = requireServer('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({ name: 'luming-ii-runtime-smoke', version });
  const companion = new Client({ name: 'luming-ii-runtime-companion', version });
  function transport() {
    return new StdioClientTransport({
      command: process.execPath,
      args: [join(install, 'runtime', 'server.mjs'), '--data-root', data],
      cwd: install,
      stderr: 'inherit',
    });
  }

  try {
    await mkdir(install);
    await cp(runtime, join(install, 'runtime'), { recursive: true });
    await cp(join(pluginRoot, 'assets'), join(install, 'assets'), { recursive: true });
    await cp(join(pluginRoot, 'skills'), join(install, 'skills'), { recursive: true });
    await copyFile(join(pluginRoot, 'plugin.json'), join(install, 'plugin.json'));
    await copyFile(join(pluginRoot, 'mcp.json'), join(install, 'mcp.json'));
    await client.connect(transport());
    assert.equal(client.getServerVersion()?.name, 'luming-studio-ii');
    assert.equal(client.getServerVersion()?.version, version);
    const boardId = await protocolSmoke(client, data, install);
    assert.ok(boardId);
    const servicePath = join(data, 'service.json');
    const { pid } = JSON.parse(await readFile(servicePath, 'utf8'));
    await companion.connect(transport());
    const existing = await companion.callTool({
      name: 'artifact_list',
      arguments: { query: 'runtime' },
    });
    assert.equal(existing.structuredContent.data.artifacts[0]?.id, boardId);
    assert.equal(JSON.parse(await readFile(servicePath, 'utf8')).pid, pid);
  } finally {
    try {
      await Promise.all([client.close(), companion.close()]);
    } finally {
      const checked = await realpath(scratch);
      assert.equal(dirname(checked), temp);
      assert.match(basename(checked), /^luming-ii-runtime-check-/u);
      await closeProbeBackend(data);
      await rm(checked, { recursive: true, force: true });
    }
  }
}

await buildRuntime();
await verifyRuntime();
console.log('Built and verified the independent Luming Studio II MCP and Web runtime.');
