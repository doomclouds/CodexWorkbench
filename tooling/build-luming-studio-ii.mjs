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

async function openWorkbench(client) {
  const uri = 'ui://luming-studio-ii/app';
  const { tools } = await client.listTools();
  const openTool = tools.find(({ name }) => name === 'studio_open');
  const requestTool = tools.find(({ name }) => name === 'studio_app_request');
  assert.deepEqual(openTool?._meta?.['openai/ui']?.entrypoints, [{ type: 'thread' }]);
  assert.deepEqual(requestTool?._meta?.ui?.visibility, ['app']);

  const resources = await client.listResources();
  assert.ok(resources.resources.some((resource) => resource.uri === uri));
  const app = (await client.readResource({ uri })).contents[0];
  assert.equal(app?.mimeType, 'text/html;profile=mcp-app');
  assert.match(app?.text ?? '', /<script/);
  assert.deepEqual(app?._meta?.ui?.csp?.connectDomains, []);
  assert.equal(app?._meta?.['openai/ui']?.preferredDisplayMode, 'fullscreen');

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
  const { boardId } = receipt.outcome.value;
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
  assert.deepEqual(found.structuredContent.data.artifacts, [
    { id: boardId, title: 'MCP runtime smoke', type: 'whiteboard', pinned: false },
  ]);

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
  const expectedGeometryVersion = String(capturedObject.geometryVersion);
  const proposal = {
    boardId: reviewBoard,
    sourceId: review.source.sourceId,
    commandId: 'packaged-mcp-suggest',
    observation: '冻结范围需要人工确认。',
    options: [
      {
        optionId: 'lock-shape',
        label: '锁定该对象',
        edit: {
          geometry: {
            changeLock: {
              locked: true,
              targets: [{ objectId: reviewedObject, expectedGeometryVersion }],
            },
          },
        },
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
    confirmed.scene.objects.find(({ objectId }) => objectId === reviewedObject)?.locked,
    true,
  );
}

async function protocolSmoke(client, dataRoot) {
  const sessionId = await openWorkbench(client);
  const rpc = createAppRpc(client, sessionId);
  const boardId = await verifyBoardRoundtrip(client, sessionId, rpc);
  const reviewBoard = await verifyArchiveRoundtrip(client, sessionId);
  await verifySuggestionRoundtrip(client, sessionId, rpc, reviewBoard, dataRoot);
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
    await copyFile(join(pluginRoot, 'plugin.json'), join(install, 'plugin.json'));
    await copyFile(join(pluginRoot, 'mcp.json'), join(install, 'mcp.json'));
    await client.connect(transport());
    assert.deepEqual(client.getServerVersion(), { name: 'luming-studio-ii', version });
    const boardId = await protocolSmoke(client, data);
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
