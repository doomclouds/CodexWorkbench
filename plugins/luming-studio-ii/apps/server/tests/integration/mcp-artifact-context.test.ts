import {
  create,
  fromBinary,
  toBinary,
  type DescMessage,
  type MessageInitShape,
} from '@bufbuild/protobuf';
import { FeedbackService } from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import { BoardHistoryService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/history';
import { ObjectPayloadSchema } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';
import { BoardSceneSchema } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Buffer } from 'node:buffer';
import { describe, expect, test } from 'vitest';
import { createStudioMcpServer, type LocalRequest } from '../../src/entrypoints/mcp/index.js';
import { actorHeader } from '../support/whiteboard-client.js';
import { mainBoardId, shapeId, viewerId } from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const boardId = 'board-a';
const current = WhiteboardService.method;
const history = BoardHistoryService.method;
const feedback = FeedbackService.method.getThread;
const encodedPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRvsAAAAASUVORK5CYII=';
const png = Buffer.from(encodedPng, 'base64');
const scopedAsset = '/studio-archive-assets/board-a/asset-a';
const block = 'heading-a';
const privateMarker = '未在备注所选段落中的文字';
const savedExcerpt = '保存时冻结的段落摘录';
const geometry = { x: 10, y: 12, width: 100, height: 80, rotation: 0 };
const board: MessageInitShape<typeof BoardSceneSchema> = {
  boardId,
  title: '发布计划白板',
  boardRevision: 7n,
  objects: [
    { objectId: 'section-a', kind: 'section', label: '发布范围', geometry, geometryVersion: 1n },
    {
      objectId: 'card-a',
      kind: 'text',
      label: '重点',
      geometry,
      geometryVersion: 1n,
      payloadVersion: 2n,
      parentId: 'section-a',
    },
    {
      objectId: 'document-a',
      kind: 'document',
      label: '发布记录',
      geometry,
      geometryVersion: 1n,
      payloadVersion: 3n,
    },
    {
      objectId: 'image-a',
      kind: 'image',
      label: '依据图',
      geometry,
      geometryVersion: 1n,
      payloadVersion: 4n,
    },
    {
      objectId: 'embed-a',
      kind: 'html',
      label: '待检查图解',
      geometry,
      geometryVersion: 1n,
      payloadVersion: 5n,
    },
  ],
};
const seededPayloads = new Map<string, MessageInitShape<typeof ObjectPayloadSchema>>([
  ['card-a', { payloadVersion: 2n, body: { case: 'text', value: { text: '准备发布' } } }],
  [
    'document-a',
    {
      payloadVersion: 3n,
      body: {
        case: 'document',
        value: {
          title: '发布记录',
          blocks: [
            {
              blockId: block,
              type: 'heading',
              content: { kind: { case: 'stringValue', value: '所选记录' } },
            },
            {
              blockId: 'unselected',
              type: 'paragraph',
              content: { kind: { case: 'stringValue', value: privateMarker } },
            },
          ],
        },
      },
    },
  ],
  ['image-a', { payloadVersion: 4n, body: { case: 'image', value: { src: scopedAsset } } }],
  [
    'embed-a',
    {
      payloadVersion: 5n,
      body: {
        case: 'embed',
        value: {
          html: '<main>图解原文</main><script>privateScript</script><p hidden>hiddenMarker</p>',
          sourceRevision: 9n,
        },
      },
    },
  ],
]);

function binary<Schema extends DescMessage>(schema: Schema, input: MessageInitShape<Schema>) {
  const body = new Uint8Array(toBinary(schema, create(schema, input)));

  return new Response(body, { headers: { 'content-type': 'application/protobuf' } });
}

function payloads(
  ids: readonly string[],
  source: ReadonlyMap<string, MessageInitShape<typeof ObjectPayloadSchema>>,
) {
  return ids.map((objectId) => {
    const payload = source.get(objectId);
    if (!payload) {
      return { objectId, result: { case: 'unavailable' as const, value: {} } };
    }

    return { objectId, result: { case: 'payload' as const, value: payload } };
  });
}

interface FixtureState {
  currentRevision: bigint;
  archived: boolean;
  preview: 'file' | 'browser';
  denyBoard: boolean;
}

function historicalResponse(
  path: string | undefined,
  body: Uint8Array | undefined,
  state: FixtureState,
  source: ReadonlyMap<string, MessageInitShape<typeof ObjectPayloadSchema>>,
) {
  if (path === history.getBoardVersionScene.name) {
    const { revision } = fromBinary(history.getBoardVersionScene.input, body ?? new Uint8Array());
    return binary(history.getBoardVersionScene.output, {
      scene: state.archived || revision !== 7n ? undefined : board,
    });
  }
  if (path === history.getBoardVersionPayloads.name) {
    const request = fromBinary(history.getBoardVersionPayloads.input, body ?? new Uint8Array());
    return binary(history.getBoardVersionPayloads.output, {
      boardId: request.boardId,
      revision: request.revision,
      results: payloads(request.objectIds, source),
    });
  }
}

function previewResponse(state: FixtureState) {
  return state.preview === 'browser'
    ? binary(current.exportBoard.output, {
        result: {
          case: 'browserPng',
          value: {
            filename: '预览.png',
            revision: state.currentRevision,
            svgTemplate: '<svg>raw template</svg>',
          },
        },
      })
    : binary(current.exportBoard.output, {
        result: {
          case: 'file',
          value: {
            filename: '预览.png',
            mimeType: 'image/png',
            content: png,
            revision: state.currentRevision,
          },
        },
      });
}

function frozenResponse() {
  return binary(feedback.output, {
    thread: {
      threadId: 'thread-a',
      anchor: {
        sourceBoardRevision: 7n,
        frozenExcerpt: savedExcerpt,
        target: {
          target: {
            case: 'contentPoint',
            value: {
              objectId: 'document-a',
              payloadVersion: 3n,
              content: { case: 'document', value: { blockIds: [block] } },
            },
          },
        },
      },
    },
  });
}

function liveResponse(
  request: LocalRequest,
  state: FixtureState,
  source: ReadonlyMap<string, MessageInitShape<typeof ObjectPayloadSchema>>,
) {
  const path = request.route.split('/').at(-1);
  const body = request.body instanceof Uint8Array ? request.body : undefined;
  switch (path) {
    case undefined:
      return new Response(null, { status: 404 });
    case current.getBoardScene.name:
      return state.denyBoard
        ? new Response(null, { status: 403 })
        : binary(current.getBoardScene.output, {
            scene: { ...board, boardRevision: state.currentRevision },
          });
    case current.getObjectPayloads.name: {
      const input = fromBinary(current.getObjectPayloads.input, body ?? new Uint8Array());
      return binary(current.getObjectPayloads.output, {
        boardId: input.boardId,
        results: payloads(input.objectIds, source),
      });
    }
    case current.exportBoard.name:
      return previewResponse(state);
    case feedback.name:
      return frozenResponse();
    default:
      if (request.method === 'GET' && request.route === scopedAsset) {
        return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
      }

      return historicalResponse(path, body, state, source) ?? new Response(null, { status: 404 });
  }
}

type ContextDispatch = (request: LocalRequest, signal: AbortSignal) => Promise<Response>;

async function contextFixture(backing?: ContextDispatch) {
  const state: FixtureState = {
    currentRevision: 7n,
    archived: false,
    preview: 'file',
    denyBoard: false,
  };
  const source = new Map(seededPayloads);
  const requests: LocalRequest[] = [];
  const errors: unknown[] = [];
  const server = createStudioMcpServer({
    html: '<html></html>',
    pluginVersion: '1.0.0',
    now: () => 2_000,
    allocateId: () => '11111111-1111-4111-8111-000000000001',
    createFile: () => Promise.reject(new Error('Read-only context should not use a spool.')),
    dispatch(request, signal) {
      requests.push(request);
      return backing
        ? backing(request, signal)
        : Promise.resolve(liveResponse(request, state, source));
    },
    onError: (error) => errors.push(error),
  });
  const client = new Client({ name: 'studio-context-test', version: '1.0.0' });
  const [view, host] = InMemoryTransport.createLinkedPair();
  await server.connect(host);
  await client.connect(view);

  return {
    state,
    source,
    requests,
    errors,
    client,
    call: (args: Record<string, unknown>) =>
      client.callTool({ name: 'artifact_context', arguments: args }),
    async close() {
      await server.close();
      await client.close();
    },
  };
}

test('registers model-only read and pins a bounded outline continuation to its saved revision', async () => {
  const fixture = await contextFixture();
  try {
    const { tools } = await fixture.client.listTools();
    expect(tools.find(({ name }) => name === 'artifact_context')).toMatchObject({
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ['model'] } },
    });
    const first = await fixture.call({ boardId, pageSize: 1 });
    expect(first.structuredContent).toMatchObject({
      ok: true,
      data: {
        revision: '7',
        returned: ['overview'],
        count: 5,
        objects: [{ id: 'section-a' }],
        nextCursor: expect.any(String),
      },
    });
    const { data } = first.structuredContent as { data: { nextCursor: string } };
    expect(fixture.requests.map(({ route }) => route.split('/').at(-1))).toEqual([
      current.getBoardScene.name,
    ]);

    fixture.state.currentRevision = 8n;
    const continued = await fixture.call({ boardId, pageSize: 1, cursor: data.nextCursor });
    expect(continued.structuredContent).toMatchObject({
      ok: true,
      data: { revision: '7', objects: [{ id: 'card-a' }] },
    });
    expect(fixture.requests.at(-1)?.route).toContain(history.getBoardVersionScene.name);

    const wrongScope = await fixture.call({ boardId, cursor: data.nextCursor, include: ['text'] });
    expect(wrongScope.structuredContent).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
    expect(fixture.errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('reads only selected descendants and excludes a payload after its version changes', async () => {
  const fixture = await contextFixture();
  try {
    const input = {
      boardId,
      scope: { kind: 'section', sectionId: 'section-a' },
      include: ['text', 'structure'],
    };
    const selected = await fixture.call(input);
    expect(selected.structuredContent).toMatchObject({
      ok: true,
      data: {
        count: 2,
        returned: ['text', 'structure'],
        objects: [{ id: 'section-a' }, { id: 'card-a' }],
      },
    });
    expect(selected.content).toMatchObject([
      { type: 'text', text: expect.stringContaining('准备发布') },
    ]);
    const request = fixture.requests.at(-1);
    expect(request?.body).toBeInstanceOf(Uint8Array);
    expect(
      fromBinary(current.getObjectPayloads.input, request?.body as Uint8Array).objectIds,
    ).toEqual(['card-a']);

    fixture.source.set('card-a', {
      payloadVersion: 3n,
      body: { case: 'text', value: { text: '更新后的正文' } },
    });
    const changed = await fixture.call(input);
    expect(changed.structuredContent).toMatchObject({
      ok: true,
      data: { revision: '7', returned: ['structure'], missingPayloadIds: ['card-a'] },
    });
    expect(changed.content).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('loads only the attached document blocks at the note revision and preserves the excerpt when pruned', async () => {
  const fixture = await contextFixture();
  try {
    const sourceRef = { kind: 'feedback', boardId, feedbackThreadId: 'thread-a' };
    const mismatched = await fixture.call({ boardId: 'board-other', sourceRef });
    expect(mismatched.structuredContent).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
    expect(fixture.requests).toEqual([]);

    const note = await fixture.call({ sourceRef, include: ['text', 'structure'] });
    expect(note.structuredContent).toMatchObject({
      ok: true,
      data: {
        sourceRef,
        revision: '7',
        objects: [{ id: 'document-a', structure: { blocks: [{ id: block }] } }],
      },
    });
    expect(note.content).toMatchObject([
      { type: 'text', text: expect.stringContaining('所选记录') },
    ]);
    expect(JSON.stringify(note)).not.toContain(privateMarker);

    fixture.state.archived = true;
    const pruned = await fixture.call({ sourceRef, include: ['text', 'preview'] });
    expect(pruned.structuredContent).toMatchObject({
      ok: true,
      data: {
        sourceRef,
        revision: '7',
        missing: [{ representation: 'preview', reason: 'revisionUnavailable' }],
      },
    });
    expect(pruned.content).toEqual([{ type: 'text', text: '备注冻结摘录\n' + savedExcerpt }]);
  } finally {
    await fixture.close();
  }
});

test('returns actual PNG bytes and exposes the saved local image without reading a foreign board asset', async () => {
  const fixture = await contextFixture();
  try {
    const scope = { kind: 'objects', objectIds: ['image-a'] };
    const result = await fixture.call({ boardId, scope, include: ['preview', 'image'] });
    const image = { type: 'image', mimeType: 'image/png', data: encodedPng };
    expect(result.content).toEqual([image, image]);
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        revision: '7',
        media: [{ origin: 'savedSelection' }, { origin: 'originalImage', objectId: 'image-a' }],
      },
    });
    expect(fixture.requests.at(-1)).toEqual({ route: scopedAsset, method: 'GET' });

    fixture.source.set('image-a', {
      payloadVersion: 4n,
      body: { case: 'image', value: { src: '/studio-archive-assets/board-foreign/asset-a' } },
    });
    const foreign = await fixture.call({ boardId, scope, include: ['image'] });
    expect(foreign.content).toEqual([]);
    expect(fixture.requests.filter(({ method }) => method === 'GET')).toHaveLength(1);
  } finally {
    await fixture.close();
  }
});

test('returns exact HTML source only on request and reports a browser-required preview without fake pixels', async () => {
  const fixture = await contextFixture();
  try {
    fixture.state.preview = 'browser';
    const scope = { kind: 'objects', objectIds: ['embed-a'] };
    const result = await fixture.call({ boardId, scope, include: ['preview', 'source'] });
    expect(result.content).toMatchObject([
      { type: 'text', text: expect.stringContaining('<main>图解原文</main>') },
    ]);
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        returned: ['source'],
        objects: [{ id: 'embed-a', source: { revision: '9', truncated: false } }],
        missing: [
          {
            representation: 'preview',
            reason: 'browserRequired',
            next: expect.stringContaining('PNG'),
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('raw template');
  } finally {
    await fixture.close();
  }
});

test('reads Markdown, original markup, and plain text by object ID in one request', async () => {
  const fixture = await contextFixture();
  try {
    const { tools } = await fixture.client.listTools();
    expect(tools.find(({ name }) => name === 'artifact_context')?.title).toBe('读取白板上下文');
    const result = await fixture.call({
      boardId,
      scope: { kind: 'objects', objectIds: ['document-a', 'embed-a', 'card-a'] },
      include: ['text', 'source'],
    });
    expect(result.content).toEqual(
      expect.arrayContaining([
        { type: 'text', text: '重点 [card-a]\n准备发布' },
        { type: 'text', text: expect.stringMatching(/发布记录 \[document-a\]\n#{1,6} 所选记录/u) },
        {
          type: 'text',
          text: '待检查图解 [embed-a]\n<main>图解原文</main><script>privateScript</script><p hidden>hiddenMarker</p>',
        },
      ]),
    );
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        revision: '7',
        objects: expect.arrayContaining([
          expect.objectContaining({ id: 'card-a', kind: 'text', label: '重点' }),
          expect.objectContaining({ id: 'document-a', kind: 'document', label: '发布记录' }),
          expect.objectContaining({ id: 'embed-a', source: { revision: '9', truncated: false } }),
        ]),
      },
    });
  } finally {
    await fixture.close();
  }
});

test('reads the saved markup text without executing script or returning hidden elements', async () => {
  const fixture = await contextFixture();
  try {
    const scope = { kind: 'objects', objectIds: ['embed-a'] };
    const result = await fixture.call({ boardId, scope, include: ['text'] });
    expect(result.content).toMatchObject([
      { type: 'text', text: expect.stringContaining('图解原文') },
    ]);
    expect(JSON.stringify(result)).not.toContain('privateScript');
    expect(JSON.stringify(result)).not.toContain('hiddenMarker');
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: { returned: ['text'], objects: [{ id: 'embed-a', textOrigin: 'savedMarkup' }] },
    });
  } finally {
    await fixture.close();
  }
});

test('keeps a denied primary board from proceeding to any payload or image request', async () => {
  const fixture = await contextFixture();
  try {
    fixture.state.denyBoard = true;
    const denied = await fixture.call({ boardId, include: ['source', 'preview', 'image'] });
    expect(denied).toMatchObject({
      isError: true,
      structuredContent: { ok: false, error: { code: 'FORBIDDEN' } },
    });
    expect(fixture.requests).toHaveLength(1);
  } finally {
    await fixture.close();
  }
});

describe('saved preview through the real whiteboard service', () => {
  const whiteboard = useWhiteboardTestServer();

  test('returns the rasterized selection as a real MCP image for a viewer', async () => {
    const fixture = await contextFixture((request, signal) => {
      const headers = new Headers({ [actorHeader]: viewerId });
      if (request.mediaType) {
        headers.set('content-type', request.mediaType);
      }

      return fetch(new URL(request.route, whiteboard.address), {
        method: request.method,
        headers,
        body: request.body instanceof Uint8Array ? Buffer.from(request.body) : request.body,
        signal,
      });
    });

    try {
      const result = await fixture.call({
        boardId: mainBoardId,
        scope: { kind: 'objects', objectIds: [shapeId] },
        include: ['preview'],
      });
      expect(result.structuredContent).toMatchObject({
        ok: true,
        data: { revision: '0', returned: ['preview'], count: 1 },
      });

      if (!Array.isArray(result.content)) {
        throw new Error('Expected the tool content array.');
      }

      const image = result.content[0];
      expect(image).toMatchObject({ type: 'image', mimeType: 'image/png' });
      if (image?.type !== 'image') {
        throw new Error('Expected a model image content block.');
      }

      const bytes = Buffer.from(image.data, 'base64');
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([164, 144]);
    } finally {
      await fixture.close();
    }
  });
});
