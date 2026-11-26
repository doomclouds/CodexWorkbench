import assert from 'node:assert/strict';
import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardEditRejectionReason,
  BoardEditService,
  BoardLayerDirection,
  BoardTransformKind,
  type BoardEditReceipt,
  type EditBoardGeometryRequestSchema,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import type {
  ObjectPayloadSchema,
  TableGridSchema,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';
import { ConnectorPort } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import {
  MoveRejectionReason,
  WhiteboardService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import {
  readLayerScale,
  seedLayerScale,
  seedOversizedCopyBody,
  setGeometryRanks,
} from '../support/board-geometry-database.js';
import { callWhiteboard, sendWhiteboardRequest } from '../support/whiteboard-client.js';
import {
  documentId,
  documentPayloadVersion,
  editorId,
  lockedId,
  mainBoardId,
  secondBoardId,
  shapeId,
  viewerId,
} from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

type Request = MessageInitShape<typeof EditBoardGeometryRequestSchema>;
type Operation = NonNullable<Request['operation']>;

const server = useWhiteboardTestServer();
const { editBoardGeometry, getBoardEditReceipt } = BoardEditService.method;
const { getBoardScene, getObjectPayloads, moveObjects } = WhiteboardService.method;
const box = { x: 20, y: 30, width: 144, height: 100, rotation: 0 };
const tableBox = { ...box, width: 480, height: 180 };

function edit(commandId: string, operation: Operation, actorId = editorId, boardId = mainBoardId) {
  return callWhiteboard(server.address, actorId, editBoardGeometry, {
    boardId,
    commandId,
    operation,
  });
}

function applied(receipt: BoardEditReceipt | undefined) {
  assert.equal(receipt?.outcome.case, 'applied');

  return receipt.outcome.value;
}

function target(objectId: string, expectedGeometryVersion = 0n) {
  return { objectId, expectedGeometryVersion };
}

function createShape(objectId: string): Operation {
  return {
    case: 'create',
    value: {
      object: {
        objectId,
        kind: 'shape',
        label: 'New shape',
        geometry: box,
        geometryDetail: { case: 'shape', value: { outline: 'rounded' } },
      },
    },
  };
}

function createTable(
  objectId: string,
  initialPayload?: MessageInitShape<typeof ObjectPayloadSchema>,
): Operation {
  return {
    case: 'create',
    value: {
      object: {
        objectId,
        kind: 'table',
        label: '表格',
        geometry: tableBox,
        appearance: { fill: '#ffffff' },
      },
      initialPayload,
    },
  };
}

function createConnector(objectId: string, from: string, to: string): Operation {
  return {
    case: 'create',
    value: {
      object: {
        objectId,
        kind: 'connector',
        label: 'Connection',
        geometry: box,
        geometryDetail: {
          case: 'connector',
          value: {
            start: {
              point: { x: 10, y: 12 },
              attachment: { objectId: from, port: ConnectorPort.RIGHT },
            },
            end: {
              point: { x: 144, y: 12 },
              attachment: { objectId: to, port: ConnectorPort.LEFT },
            },
          },
        },
      },
    },
  };
}

function lock(objectId: string, expectedVersion: bigint, locked: boolean): Operation {
  return { case: 'changeLock', value: { targets: [target(objectId, expectedVersion)], locked } };
}

function removeGeometry(objectId: string, expectedVersion = 0n): Operation {
  return { case: 'delete', value: { targets: [target(objectId, expectedVersion)] } };
}

async function currentScene() {
  const response = await callWhiteboard(server.address, editorId, getBoardScene, {
    boardId: mainBoardId,
  });
  assert.ok(response.scene);

  return response.scene;
}

test('creates geometry and a version-zero body, then replays its recorded result after restart', async () => {
  const objectId = 'new-rounded';
  const commandId = 'place-once';
  const operation = createShape(objectId);
  const response = await edit(commandId, operation);

  expect(applied(response.receipt)).toMatchObject({
    boardRevision: 1n,
    changedObjects: [{ objectId, geometry: box, geometryVersion: 0n, payloadVersion: 0n }],
    changedPayloads: [{ objectId, result: { case: 'payload', value: { payloadVersion: 0n } } }],
  });

  await server.restart();
  const queried = await callWhiteboard(server.address, editorId, getBoardEditReceipt, {
    boardId: mainBoardId,
    commandId,
  });
  expect(queried.receipt).toEqual(response.receipt);
  expect((await edit(commandId, operation)).receipt).toEqual(response.receipt);
  expect((await currentScene()).objects.filter((item) => item.objectId === objectId)).toHaveLength(
    1,
  );
  expect((await currentScene()).boardRevision).toBe(1n);

  const reused = await edit(commandId, createShape('different-shape'));
  expect(reused.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.COMMAND_ID_REUSE },
  });
});

test('opens a new table with the original dimensions, example cells and stable scoped axes', async () => {
  const objectId = 'new-default-table';
  const response = await edit('create-default-table', createTable(objectId));
  const saved = applied(response.receipt);
  expect(saved.changedObjects).toMatchObject([
    {
      objectId,
      kind: 'table',
      geometry: tableBox,
      geometryVersion: 0n,
      payloadVersion: 0n,
      appearance: { fill: '#ffffff' },
    },
  ]);

  await server.restart();
  const scene = await currentScene();
  expect(scene.objects.find((object) => object.objectId === objectId)).toEqual(
    saved.changedObjects[0],
  );

  const loaded = await callWhiteboard(server.address, editorId, getObjectPayloads, {
    boardId: mainBoardId,
    objectIds: [objectId],
  });
  const [first] = loaded.results;
  expect(first).toEqual(saved.changedPayloads[0]);
  assert.equal(first?.result.case, 'payload');
  assert.equal(first.result.value.body.case, 'table');

  const grid = first.result.value.body.value.grid;
  expect(grid).toMatchObject({
    head: true,
    rowIds: ['new-default-table:row:0', 'new-default-table:row:1', 'new-default-table:row:2'],
    columnIds: ['new-default-table:col:0', 'new-default-table:col:1', 'new-default-table:col:2'],
    columnWidths: [160, 160, 160],
  });
  expect(grid?.rows.map(({ cells }) => cells.map(({ value }) => value.value))).toEqual([
    ['名称', '说明', '状态'],
    ['项目 A', '双击编辑表格', '进行中'],
    ['项目 B', '待补充', '待处理'],
  ]);
});

test('preserves supplied row and column IDs, formatting and scalar cell types', async () => {
  const grid: MessageInitShape<typeof TableGridSchema> = {
    rows: [
      {
        cells: [
          { value: { case: 'text', value: 'Run' } },
          { value: { case: 'number', value: 0 } },
          { value: { case: 'boolValue', value: false } },
          { value: { case: 'nullValue', value: 0 } },
        ],
      },
    ],
    rowIds: ['supplied-table:row:0'],
    columnIds: [
      'supplied-table:col:0',
      'supplied-table:col:1',
      'supplied-table:col:2',
      'supplied-table:col:3',
    ],
    columnWidths: [88, 104, 136, 152],
    head: false,
  };
  const objectId = 'supplied-table';
  const response = await edit(
    'create-supplied-table',
    createTable(objectId, {
      payloadVersion: 0n,
      body: { case: 'table', value: { grid } },
    }),
  );
  expect(applied(response.receipt).changedPayloads[0]?.result).toMatchObject({
    case: 'payload',
    value: { payloadVersion: 0n, body: { case: 'table', value: { grid } } },
  });
});

test('rejects an initial table body with duplicated row IDs without publishing an object', async () => {
  const objectId = 'invalid-new-table';
  const response = await edit(
    'create-invalid-table',
    createTable(objectId, {
      body: {
        case: 'table',
        value: {
          grid: {
            rows: [
              { cells: [{ value: { case: 'text', value: 'First' } }] },
              {
                cells: [{ value: { case: 'text', value: 'Duplicate' } }],
              },
            ],
            rowIds: ['invalid-new-table:row:0', 'invalid-new-table:row:0'],
            columnIds: ['invalid-new-table:col:0'],
            columnWidths: [480],
            head: true,
          },
        },
      },
    }),
  );
  expect(response.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.INVALID_EDIT },
  });

  const scene = await currentScene();
  expect(scene.boardRevision).toBe(0n);
  expect(scene.objects.some((object) => object.objectId === objectId)).toBe(false);
});

test('resizes a document without rewriting its body and reports a concurrent version conflict', async () => {
  const operation: Operation = {
    case: 'transform',
    value: {
      kind: BoardTransformKind.RESIZE,
      objects: [{ target: target(documentId), geometry: box }],
    },
  };
  const response = await edit('resize-document', operation);

  expect(applied(response.receipt)).toMatchObject({
    boardRevision: 1n,
    changedObjects: [
      { objectId: documentId, geometryVersion: 1n, payloadVersion: documentPayloadVersion },
    ],
    changedPayloads: [],
  });

  const stale = await edit('stale-resize', operation);
  expect(stale.receipt?.outcome).toMatchObject({
    case: 'conflict',
    value: { boardRevision: 1n, currentObjects: [{ objectId: documentId, geometryVersion: 1n }] },
  });

  const payloads = await callWhiteboard(server.address, editorId, getObjectPayloads, {
    boardId: mainBoardId,
    objectIds: [documentId],
  });
  expect(payloads.results[0]?.result).toMatchObject({
    case: 'payload',
    value: { payloadVersion: documentPayloadVersion },
  });
});

test('rejects a mixed rotation atomically when one object has a fixed orientation', async () => {
  const rotateShape = {
    target: target(shapeId),
    geometry: { x: 16, y: -8, width: 100, height: 80, rotation: 45 },
  };
  const rotateDocument = {
    target: target(documentId),
    geometry: { x: 100, y: 24, width: 100, height: 80, rotation: 45 },
  };
  const rejected = await edit('mixed-rotation', {
    case: 'transform',
    value: { kind: BoardTransformKind.ROTATE, objects: [rotateShape, rotateDocument] },
  });
  expect(rejected.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.INVALID_EDIT },
  });
  expect((await currentScene()).boardRevision).toBe(0n);

  const saved = await edit('shape-rotation', {
    case: 'transform',
    value: { kind: BoardTransformKind.ROTATE, objects: [rotateShape] },
  });
  expect(applied(saved.receipt)).toMatchObject({
    boardRevision: 1n,
    changedObjects: [{ objectId: shapeId, geometryVersion: 1n, geometry: { rotation: 45 } }],
  });
});

test('resizes an ink stroke by changing stroke width without replacing its normalized path', async () => {
  const objectId = 'ink-stroke';
  const points = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.75 },
  ];
  const created = await edit('create-ink', {
    case: 'create',
    value: {
      object: {
        objectId,
        kind: 'ink',
        label: 'Ink',
        geometry: box,
        geometryDetail: { case: 'ink', value: { width: 4 } },
      },
      initialPayload: { body: { case: 'ink', value: { points } } },
    },
  });
  expect(applied(created.receipt).changedPayloads[0]?.result).toMatchObject({
    case: 'payload',
    value: { payloadVersion: 0n, body: { case: 'ink', value: { points } } },
  });

  const resized = await edit('resize-ink', {
    case: 'transform',
    value: {
      kind: BoardTransformKind.RESIZE,
      objects: [
        {
          target: target(objectId),
          geometry: { ...box, width: box.width * 2, height: box.height * 2 },
          ink: { points },
        },
      ],
    },
  });
  expect(applied(resized.receipt)).toMatchObject({
    boardRevision: 2n,
    changedObjects: [
      {
        objectId,
        geometryVersion: 1n,
        payloadVersion: 0n,
        geometryDetail: { case: 'ink', value: { width: 8 } },
      },
    ],
    changedPayloads: [],
  });
});

test('rejects deletion with a locked related connector and excludes previously deleted IDs', async () => {
  const connectorId = 'architecture-link';
  applied(
    (await edit('create-connector', createConnector(connectorId, shapeId, documentId))).receipt,
  );
  applied((await edit('lock-connector', lock(connectorId, 0n, true))).receipt);

  const blocked = await edit('delete-with-locked-link', removeGeometry(shapeId));
  expect(blocked.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.GEOMETRY_LOCKED },
  });
  expect((await currentScene()).boardRevision).toBe(2n);

  applied((await edit('unlock-connector', lock(connectorId, 1n, false))).receipt);
  const deleted = applied((await edit('remove-shape', removeGeometry(shapeId))).receipt);
  expect(deleted.removedObjectIds).toEqual([shapeId, connectorId]);
  const scene = await currentScene();
  expect(scene.objects.map(({ objectId }) => objectId)).toEqual([documentId, lockedId]);

  const reusedId = await edit('create-removed-id', createShape(shapeId));
  expect(reusedId.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.INVALID_EDIT },
  });
  expect((await currentScene()).boardRevision).toBe(4n);
});

test('publishes an authoritative layer order and rejects a stale expected board revision', async () => {
  const operation: Operation = {
    case: 'reorder',
    value: {
      targets: [target(shapeId)],
      direction: BoardLayerDirection.FORWARD,
      expectedBoardRevision: 0n,
    },
  };
  const response = await edit('object-forward', operation);
  expect(applied(response.receipt).objectOrder).toEqual([documentId, shapeId, lockedId]);

  const stale = await edit('stale-order', operation);
  expect(stale.receipt?.outcome).toMatchObject({
    case: 'conflict',
    value: { boardRevision: 1n },
  });

  await server.restart();
  expect((await currentScene()).objects.map(({ objectId }) => objectId)).toEqual([
    documentId,
    shapeId,
    lockedId,
  ]);
});

test('blocks the existing MoveObjects route while an attached connector is geometry locked', async () => {
  const connectorId = 'move-lock-link';
  applied(
    (await edit('create-move-link', createConnector(connectorId, shapeId, documentId))).receipt,
  );
  applied((await edit('lock-move-link', lock(connectorId, 0n, true))).receipt);

  const blocked = await callWhiteboard(server.address, editorId, moveObjects, {
    boardId: mainBoardId,
    commandId: 'blocked-move-endpoint',
    delta: { dx: 31, dy: 1 },
    targets: [target(shapeId)],
  });
  expect(blocked.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: MoveRejectionReason.GEOMETRY_LOCKED },
  });
  expect((await currentScene()).boardRevision).toBe(2n);

  applied((await edit('unlock-move-link', lock(connectorId, 1n, false))).receipt);
  const moved = await callWhiteboard(server.address, editorId, moveObjects, {
    boardId: mainBoardId,
    commandId: 'move-unlocked-endpoint',
    delta: { dx: 31, dy: 1 },
    targets: [target(shapeId)],
  });
  expect(moved.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { boardRevision: 4n, objects: [{ objectId: shapeId, geometry: { x: 47, y: -7 } }] },
  });
});

test('reconnects an existing endpoint while retaining the other same-board attachment', async () => {
  const objectId = 'reconnectable-link';
  applied(
    (await edit('put-reconnectable-link', createConnector(objectId, shapeId, documentId))).receipt,
  );

  const start = {
    point: { x: 10, y: 12 },
    attachment: { objectId: shapeId, port: ConnectorPort.RIGHT },
  };
  const end = {
    point: { x: 400, y: 25 },
    attachment: { objectId: lockedId, port: ConnectorPort.LEFT },
  };
  const changed = await edit('reconnect-to-shape', {
    case: 'transform',
    value: {
      kind: BoardTransformKind.CONNECT,
      objects: [
        { target: target(objectId), geometry: { ...box, width: 390 }, connector: { start, end } },
      ],
    },
  });
  expect(applied(changed.receipt)).toMatchObject({
    boardRevision: 2n,
    changedObjects: [
      {
        objectId,
        geometryVersion: 1n,
        geometryDetail: { case: 'connector', value: { start, end } },
      },
    ],
    changedPayloads: [],
  });
});

test('duplicates selected geometry and remaps the attached end to the new object', async () => {
  const connectorId = 'original-link';
  applied((await edit('make-link', createConnector(connectorId, shapeId, documentId))).receipt);
  const response = await edit('copy-two-objects', {
    case: 'duplicate',
    value: {
      targets: [
        { source: target(shapeId), newObjectId: 'new-shape' },
        { source: target(connectorId), newObjectId: 'new-link' },
      ],
      delta: { dx: 32, dy: 32 },
    },
  });
  const result = applied(response.receipt);

  expect(result.changedObjects).toEqual([
    expect.objectContaining({ objectId: 'new-shape', geometryVersion: 0n }),
    expect.objectContaining({
      objectId: 'new-link',
      geometryVersion: 0n,
      geometryDetail: expect.objectContaining({
        case: 'connector',
        value: expect.objectContaining({
          start: expect.objectContaining({
            attachment: expect.objectContaining({ objectId: 'new-shape' }),
          }),
          end: expect.objectContaining({
            attachment: expect.objectContaining({ objectId: documentId }),
          }),
        }),
      }),
    }),
  ]);
  expect(result.changedPayloads).toEqual([expect.objectContaining({ objectId: 'new-link' })]);
});

test('keeps viewer, cross-board attachments, and omitted versions out of the write path', async () => {
  const viewer = await edit('viewer-no-write', createShape('viewer-created'), viewerId);
  expect(viewer.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.FORBIDDEN },
  });

  const foreignLink = await edit(
    'cross-board-link',
    createConnector('foreign-link', shapeId, documentId),
    editorId,
    secondBoardId,
  );
  expect(foreignLink.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.OBJECT_NOT_FOUND },
  });

  const missingVersion = await sendWhiteboardRequest(server.address, editorId, editBoardGeometry, {
    boardId: mainBoardId,
    commandId: 'missing-expected-version',
    operation: { case: 'delete', value: { targets: [{ objectId: shapeId }] } },
  });
  expect(missingVersion.status).toBe(400);
  expect((await currentScene()).boardRevision).toBe(0n);
  expect(server.errors).toHaveLength(0);
});

test('records only layer targets while returning the complete order on a large board', async () => {
  const objectCount = 3_200;
  const edits = 5;
  seedLayerScale(server.databasePath, objectCount);
  const initial = readLayerScale(server.databasePath);
  let metadataCount = 0;
  let secondOrder: readonly string[] = [];
  for (let index = 0; index < edits; index += 1) {
    const front = index % 2 === 0;
    const result = applied(
      (
        await edit('large-board-order-' + index, {
          case: 'reorder',
          value: {
            targets: [target(shapeId)],
            direction: front ? BoardLayerDirection.FRONT : BoardLayerDirection.BACK,
            expectedBoardRevision: BigInt(index),
          },
        })
      ).receipt,
    );

    expect(result.objectOrder).toHaveLength(objectCount);
    expect(front ? result.objectOrder.at(-1) : result.objectOrder.at(0)).toBe(shapeId);
    metadataCount += result.changedObjects.length;
    if (index === 1) {
      secondOrder = result.objectOrder;
    }
  }

  const final = readLayerScale(server.databasePath);
  expect({ ...final.counts, metadataCount }).toMatchObject({
    historyObjects: edits,
    metadataCount: 0,
  });
  expect(final.ranks.filter(({ objectId }) => objectId !== shapeId)).toEqual(
    initial.ranks.filter(({ objectId }) => objectId !== shapeId),
  );
  expect(final.counts.receiptBytes).toBeLessThan(1024);

  await server.restart();
  const replay = await callWhiteboard(server.address, editorId, getBoardEditReceipt, {
    boardId: mainBoardId,
    commandId: 'large-board-order-1',
  });
  expect(applied(replay.receipt)).toMatchObject({
    boardRevision: 2n,
    changedObjects: [],
    objectOrder: secondOrder,
  });
});

test('uses existing sparse ranks for one-step moves and leaves the remaining rank untouched', async () => {
  setGeometryRanks(server.databasePath, [
    { objectId: shapeId, rank: -10n },
    { objectId: documentId, rank: 7n },
    { objectId: lockedId, rank: 50n },
  ]);
  const response = await edit('step-sparse-layer', {
    case: 'reorder',
    value: {
      targets: [target(shapeId)],
      direction: BoardLayerDirection.FORWARD,
      expectedBoardRevision: 0n,
    },
  });
  expect(applied(response.receipt)).toMatchObject({
    changedObjects: [],
    objectOrder: [documentId, shapeId, lockedId],
  });
  expect(readLayerScale(server.databasePath)).toMatchObject({
    ranks: [
      { objectId: documentId, rank: -10n },
      { objectId: shapeId, rank: 7n },
      { objectId: lockedId, rank: 50n },
    ],
    counts: { historyObjects: 2 },
  });
});

test.each([
  { description: 'tied ranks', shapeRank: -10n, documentRank: -10n, lockedRank: 5n },
  {
    description: 'rank overflow',
    shapeRank: -10n,
    documentRank: -8n,
    lockedRank: (1n << 63n) - 1n,
  },
])(
  'preserves the requested order by compacting $description',
  async ({ shapeRank, documentRank, lockedRank }) => {
    setGeometryRanks(server.databasePath, [
      { objectId: shapeId, rank: shapeRank },
      { objectId: documentId, rank: documentRank },
      { objectId: lockedId, rank: lockedRank },
    ]);
    const response = await edit('compact-legacy-layer', {
      case: 'reorder',
      value: {
        targets: [target(shapeId)],
        direction: BoardLayerDirection.FRONT,
        expectedBoardRevision: 0n,
      },
    });
    expect(applied(response.receipt)).toMatchObject({
      changedObjects: [],
      objectOrder: [documentId, lockedId, shapeId],
    });
    expect(readLayerScale(server.databasePath).ranks).toEqual([
      { objectId: documentId, rank: 0n },
      { objectId: lockedId, rank: 1n },
      { objectId: shapeId, rank: 2n },
    ]);
  },
);

test.each([
  { description: 'negative ranks', topRank: -5n, expectedCreationRank: -4n },
  { description: 'the maximum rank', topRank: (1n << 63n) - 1n, expectedCreationRank: 3n },
])(
  'appends new objects above $description without changing their order',
  async ({ topRank, expectedCreationRank }) => {
    setGeometryRanks(server.databasePath, [
      { objectId: shapeId, rank: -24n },
      { objectId: documentId, rank: -12n },
      { objectId: lockedId, rank: topRank },
    ]);
    const objectId = 'layer-top-new-shape';
    const created = await edit('append-shape', createShape(objectId));
    expect(applied(created.receipt).changedObjects.map((object) => object.objectId)).toEqual([
      objectId,
    ]);

    const { ranks } = readLayerScale(server.databasePath);
    expect(ranks.map((item) => item.objectId)).toEqual([shapeId, documentId, lockedId, objectId]);
    expect(ranks.at(-1)?.rank).toBe(expectedCreationRank);
  },
);

test('rejects an oversized duplicate before decoding its source body', async () => {
  seedOversizedCopyBody(server.databasePath);
  const response = await edit('over-cap-copy', {
    case: 'duplicate',
    value: {
      targets: [{ source: target(shapeId), newObjectId: 'oversized-copy' }],
      delta: { dx: 32, dy: 32 },
    },
  });

  expect(response.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.TOO_LARGE },
  });
  expect((await currentScene()).boardRevision).toBe(0n);
  expect(server.errors).toHaveLength(0);
});
