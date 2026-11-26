import assert from 'node:assert/strict';
import {
  BoardEditRejectionReason,
  BoardEditService,
  BoardLayerDirection,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import {
  BoardHistoryService,
  BoardVersionKind,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/history';
import { ConnectorPort } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import {
  BoardExportFormat,
  WhiteboardService,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import { seedLargeHistoricalPayloads } from '../support/board-restore-database.js';
import { callWhiteboard, sendWhiteboardRequest } from '../support/whiteboard-client.js';
import {
  documentContent,
  documentId,
  documentPayloadVersion,
  documentTitle,
  editorId,
  lockedId,
  mainBoardId,
  outsiderId,
  shapeId,
  viewerId,
} from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const server = useWhiteboardTestServer();
const { getBoardScene, moveObjects } = WhiteboardService.method;
const { editBoardGeometry, editObjectContent, getBoardEditReceipt } = BoardEditService.method;
const {
  listBoardVersions,
  getBoardVersionScene,
  getBoardVersionPayloads,
  restoreBoardVersion,
  exportBoardVersion,
} = BoardHistoryService.method;

const board = { boardId: mainBoardId };
const baseline = { ...board, revision: 0n };
const whole = { case: 'whole', value: {} } as const;
const shapeSelection = { case: 'selection' as const, value: { objectIds: [shapeId] } };

async function move(objectId: string, token: bigint, dx: number, commandId: string) {
  const result = await callWhiteboard(server.address, editorId, moveObjects, {
    ...board,
    commandId,
    delta: { dx, dy: 0 },
    targets: [{ objectId, expectedGeometryVersion: token }],
  });
  const outcome = result.receipt?.outcome;
  assert.equal(outcome?.case, 'applied');

  return outcome.value.boardRevision;
}

async function lockShape(locked: boolean, version: bigint, commandId: string) {
  const result = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    ...board,
    commandId,
    operation: {
      case: 'changeLock',
      value: { locked, targets: [{ objectId: shapeId, expectedGeometryVersion: version }] },
    },
  });
  const outcome = result.receipt?.outcome;
  assert.equal(outcome?.case, 'applied');

  return outcome.value.boardRevision;
}

test('exposes the initial baseline, fixed scene and separately loaded payloads to readers', async () => {
  const initial = await callWhiteboard(server.address, viewerId, listBoardVersions, board);
  expect(initial).toMatchObject({
    currentRevision: 0n,
    versions: [{ revision: 0n, kind: BoardVersionKind.BASELINE }],
  });
  expect(initial.nextBeforeRevision).toBeUndefined();

  expect(await move(shapeId, 0n, 40, 'move-history-shape')).toBe(1n);
  const current = await callWhiteboard(server.address, viewerId, getBoardScene, board);
  expect(current.scene?.objects.find(({ objectId }) => objectId === shapeId)?.geometry?.x).toBe(56);

  const original = await callWhiteboard(server.address, editorId, getBoardVersionScene, baseline);
  expect(original.scene).toMatchObject({ boardRevision: 0n, access: { canEdit: false } });
  expect(original.scene?.objects.find(({ objectId }) => objectId === shapeId)?.geometry?.x).toBe(
    16,
  );

  const content = await callWhiteboard(server.address, viewerId, getBoardVersionPayloads, {
    ...baseline,
    objectIds: [documentId, 'missing-object'],
  });
  expect(content).toMatchObject({ revision: 0n, unavailable: false });
  expect(content.results.map(({ objectId }) => objectId)).toEqual([documentId, 'missing-object']);
  expect(content.results[0]?.result).toMatchObject({
    case: 'payload',
    value: { payloadVersion: documentPayloadVersion, body: { case: 'document' } },
  });
  expect(content.results[1]?.result.case).toBe('unavailable');

  const latest = await callWhiteboard(server.address, viewerId, listBoardVersions, {
    ...board,
    limit: 1,
  });
  expect(latest).toMatchObject({
    currentRevision: 1n,
    nextBeforeRevision: 1n,
    versions: [{ revision: 1n, changedObjectCount: 1, kind: BoardVersionKind.GEOMETRY }],
  });
  const earlier = await callWhiteboard(server.address, viewerId, listBoardVersions, {
    ...board,
    beforeRevision: 1n,
  });
  expect(earlier.versions.map(({ revision }) => revision)).toEqual([0n]);
  expect(earlier.nextBeforeRevision).toBeUndefined();
});

test('exports the saved title, geometry and payload instead of the current geometry', async () => {
  await move(shapeId, 0n, 40, 'move-before-version-export');
  const result = await callWhiteboard(server.address, viewerId, exportBoardVersion, {
    ...baseline,
    format: BoardExportFormat.JSON,
    scope: whole,
  });
  assert.equal(result.result.case, 'file');
  const { content, revision } = result.result.value;
  const json = new TextDecoder().decode(content);
  expect(revision).toBe(0n);
  expect(JSON.parse(json)).toMatchObject({ board: { title: 'Architecture', revision: '0' } });
  expect(JSON.parse(json)).toMatchObject({
    objects: expect.arrayContaining([
      expect.objectContaining({
        objectId: shapeId,
        geometry: { x: 16, y: -8, width: 100, height: 80, rotation: 0 },
      }),
    ]),
  });
  expect(json).toContain(documentContent);

  const svg = await callWhiteboard(server.address, viewerId, exportBoardVersion, {
    ...baseline,
    format: BoardExportFormat.SVG,
    scope: shapeSelection,
  });
  assert.equal(svg.result.case, 'file');
  expect(svg.result.value.mimeType).toBe('image/svg+xml');
});

test('restores explicit objects in a new revision and replays the original receipt after restart', async () => {
  await move(shapeId, 0n, 40, 'shape-before-partial-restore');
  await move(documentId, 0n, 24, 'document-before-partial-restore');

  const request = {
    ...baseline,
    commandId: 'restore-from-baseline',
    expectedCurrentRevision: 2n,
    scope: shapeSelection,
  };
  const applied = await callWhiteboard(server.address, editorId, restoreBoardVersion, request);
  expect(applied.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      boardRevision: 3n,
      changedObjects: [{ objectId: shapeId, geometryVersion: 3n, geometry: { x: 16 } }],
    },
  });

  await server.restart();
  const replayed = await callWhiteboard(server.address, editorId, restoreBoardVersion, request);
  expect(replayed).toEqual(applied);
  const lookedUp = await callWhiteboard(server.address, editorId, getBoardEditReceipt, {
    ...board,
    commandId: request.commandId,
  });
  expect(lookedUp.receipt).toEqual(applied.receipt);
  const current = await callWhiteboard(server.address, editorId, getBoardScene, board);
  expect(current.scene?.objects.find(({ objectId }) => objectId === documentId)?.geometry?.x).toBe(
    124,
  );

  const history = await callWhiteboard(server.address, editorId, listBoardVersions, board);
  expect(history.versions[0]).toMatchObject({
    revision: 3n,
    kind: BoardVersionKind.RESTORE,
    sourceRevision: 0n,
    changedObjectCount: 1,
  });
  const beforeRestore = await callWhiteboard(server.address, viewerId, getBoardVersionScene, {
    ...board,
    revision: 2n,
  });
  expect(
    beforeRestore.scene?.objects.find(({ objectId }) => objectId === shapeId)?.geometry?.x,
  ).toBe(56);
});

test('rejects stale, forbidden, missing and locked restore operations without writing a revision', async () => {
  await move(shapeId, 0n, 40, 'move-before-lock');
  expect(await lockShape(true, 1n, 'lock-moved-shape')).toBe(2n);
  const request = {
    ...baseline,
    expectedCurrentRevision: 2n,
    commandId: 'blocked-restore',
    scope: whole,
  };

  const locked = await callWhiteboard(server.address, editorId, restoreBoardVersion, request);
  expect(locked.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.GEOMETRY_LOCKED },
  });
  const forbidden = await callWhiteboard(server.address, viewerId, restoreBoardVersion, request);
  expect(forbidden.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.FORBIDDEN },
  });
  const stale = await callWhiteboard(server.address, editorId, restoreBoardVersion, {
    ...request,
    expectedCurrentRevision: 0n,
  });
  expect(stale.receipt?.outcome).toMatchObject({ case: 'conflict', value: { boardRevision: 2n } });
  const unavailable = await callWhiteboard(server.address, editorId, restoreBoardVersion, {
    ...request,
    revision: 99n,
  });
  expect(unavailable.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.VERSION_UNAVAILABLE },
  });
  const history = await callWhiteboard(server.address, editorId, listBoardVersions, board);
  expect(history.currentRevision).toBe(2n);
});

test('distinguishes unavailable versions from empty scenes and enforces authorization', async () => {
  const gone = { ...board, revision: 99n };
  const scene = await callWhiteboard(server.address, viewerId, getBoardVersionScene, gone);
  expect(scene.scene).toBeUndefined();
  const payload = await callWhiteboard(server.address, viewerId, getBoardVersionPayloads, {
    ...gone,
    objectIds: [documentId],
  });
  expect(payload).toMatchObject({ unavailable: true, results: [], revision: 99n });
  const exported = await callWhiteboard(server.address, viewerId, exportBoardVersion, {
    ...gone,
    scope: whole,
    format: BoardExportFormat.JSON,
  });
  expect(exported.result).toMatchObject({ case: 'unavailable', value: true });

  const read = await sendWhiteboardRequest(
    server.address,
    outsiderId,
    getBoardVersionScene,
    baseline,
  );
  expect(read.status).toBe(403);
  const exportDenied = await sendWhiteboardRequest(server.address, outsiderId, exportBoardVersion, {
    ...baseline,
    scope: whole,
    format: BoardExportFormat.JSON,
  });
  expect(exportDenied.status).toBe(403);
  const missingRevision = await sendWhiteboardRequest(
    server.address,
    editorId,
    getBoardVersionScene,
    board,
  );
  expect(missingRevision.status).toBe(400);
  expect(server.errors).toEqual([]);
});

test('restores a previous document using a fresh payload token without rewinding geometry', async () => {
  const changed = await callWhiteboard(server.address, editorId, editObjectContent, {
    ...board,
    commandId: 'change-document-before-restore',
    objectId: documentId,
    expectedPayloadVersion: documentPayloadVersion,
    edit: {
      case: 'document',
      value: {
        title: 'Updated title',
        schemaVersion: 1,
        blocks: [{ blockId: 'paragraph-1', type: 'paragraph' }],
      },
    },
  });
  expect(changed.receipt?.outcome).toMatchObject({ case: 'applied', value: { boardRevision: 1n } });

  const restored = await callWhiteboard(server.address, editorId, restoreBoardVersion, {
    ...baseline,
    commandId: 'restore-document-with-high-token',
    expectedCurrentRevision: 1n,
    scope: { case: 'selection', value: { objectIds: [documentId] } },
  });
  expect(restored.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      boardRevision: 2n,
      changedObjects: [
        { objectId: documentId, geometryVersion: 0n, payloadVersion: documentPayloadVersion + 2n },
      ],
      changedPayloads: [
        {
          objectId: documentId,
          result: {
            case: 'payload',
            value: { body: { case: 'document', value: { title: documentTitle } } },
          },
        },
      ],
    },
  });

  const previous = await callWhiteboard(server.address, viewerId, getBoardVersionPayloads, {
    ...board,
    revision: 1n,
    objectIds: [documentId],
  });
  expect(previous.results[0]?.result).toMatchObject({
    case: 'payload',
    value: {
      payloadVersion: documentPayloadVersion + 1n,
      body: { case: 'document', value: { title: 'Updated title' } },
    },
  });
});

test('restores the whole board order, resurrects old objects and removes additions', async () => {
  const newObjectId = 'new-shape-before-restore';
  const inserted = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    ...board,
    commandId: 'create-shape-before-whole-restore',
    operation: {
      case: 'create',
      value: {
        object: {
          objectId: newObjectId,
          kind: 'shape',
          label: 'New shape',
          geometry: { x: 18, y: 20, width: 30, height: 20, rotation: 0 },
          geometryDetail: { case: 'shape', value: { outline: 'rounded' } },
        },
      },
    },
  });
  expect(inserted.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { boardRevision: 1n },
  });
  const removed = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    ...board,
    commandId: 'remove-shape-before-whole-restore',
    operation: {
      case: 'delete',
      value: { targets: [{ objectId: shapeId, expectedGeometryVersion: 0n }] },
    },
  });
  expect(removed.receipt?.outcome).toMatchObject({ case: 'applied', value: { boardRevision: 2n } });

  const restored = await callWhiteboard(server.address, editorId, restoreBoardVersion, {
    ...baseline,
    commandId: 'restore-whole-board',
    expectedCurrentRevision: 2n,
    scope: whole,
  });
  expect(restored.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      boardRevision: 3n,
      changedObjects: [{ objectId: shapeId, geometryVersion: 3n }],
      objectOrder: [shapeId, documentId, lockedId],
      removedObjectIds: [newObjectId],
    },
  });

  const previous = await callWhiteboard(server.address, viewerId, getBoardVersionScene, {
    ...board,
    revision: 2n,
  });
  expect(previous.scene?.objects.map(({ objectId }) => objectId)).toEqual([
    documentId,
    lockedId,
    newObjectId,
  ]);
});

test('requires historical connector endpoints to exist in the resulting selection', async () => {
  const connectorId = 'historical-connector';
  const created = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    ...board,
    commandId: 'create-historical-connector',
    operation: {
      case: 'create',
      value: {
        object: {
          objectId: connectorId,
          kind: 'connector',
          label: 'Original connection',
          geometry: { x: 16, y: 24, width: 100, height: 80, rotation: 0 },
          geometryDetail: {
            case: 'connector',
            value: {
              start: {
                point: { x: 16, y: 24 },
                attachment: { objectId: shapeId, port: ConnectorPort.RIGHT },
              },
              end: {
                point: { x: 100, y: 45 },
                attachment: { objectId: documentId, port: ConnectorPort.LEFT },
              },
            },
          },
        },
      },
    },
  });
  expect(created.receipt?.outcome).toMatchObject({ case: 'applied', value: { boardRevision: 1n } });
  const deleted = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    ...board,
    commandId: 'delete-historical-connector-endpoint',
    operation: {
      case: 'delete',
      value: { targets: [{ objectId: shapeId, expectedGeometryVersion: 0n }] },
    },
  });
  expect(deleted.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { boardRevision: 2n, removedObjectIds: expect.arrayContaining([shapeId, connectorId]) },
  });

  const request = { ...board, revision: 1n, expectedCurrentRevision: 2n };
  const detached = await callWhiteboard(server.address, editorId, restoreBoardVersion, {
    ...request,
    commandId: 'restore-detached-connector',
    scope: { case: 'selection', value: { objectIds: [connectorId] } },
  });
  expect(detached.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.INVALID_EDIT },
  });

  const attached = await callWhiteboard(server.address, editorId, restoreBoardVersion, {
    ...request,
    commandId: 'restore-connected-selection',
    scope: { case: 'selection', value: { objectIds: [shapeId, connectorId] } },
  });
  expect(attached.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      boardRevision: 3n,
      changedObjects: [{ objectId: shapeId }, { objectId: connectorId }],
    },
  });
});

test('rejects both selection and whole restores that add a child to a locked section', async () => {
  const parentId = 'restored-parent';
  const childId = 'restored-child';
  const geometry = { x: 25, y: 32, width: 150, height: 120, rotation: 0 };
  const parent = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    ...board,
    commandId: 'create-restoration-test-section',
    operation: {
      case: 'create',
      value: {
        object: {
          objectId: parentId,
          kind: 'section',
          label: 'Section',
          geometry,
          geometryDetail: { case: 'section', value: { transparent: false } },
        },
      },
    },
  });
  expect(parent.receipt?.outcome.case).toBe('applied');

  const child = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    ...board,
    commandId: 'create-restoration-test-child',
    operation: {
      case: 'create',
      value: {
        object: {
          objectId: childId,
          kind: 'shape',
          label: 'Child',
          geometry,
          parentId,
          geometryDetail: { case: 'shape', value: { outline: 'rounded' } },
        },
      },
    },
  });
  expect(child.receipt?.outcome).toMatchObject({ case: 'applied', value: { boardRevision: 2n } });

  const removed = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    ...board,
    commandId: 'delete-child-from-open-section',
    operation: {
      case: 'delete',
      value: { targets: [{ objectId: childId, expectedGeometryVersion: 0n }] },
    },
  });
  expect(removed.receipt?.outcome).toMatchObject({ case: 'applied', value: { boardRevision: 3n } });

  const locked = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    ...board,
    commandId: 'lock-section-after-child-removal',
    operation: {
      case: 'changeLock',
      value: { locked: true, targets: [{ objectId: parentId, expectedGeometryVersion: 0n }] },
    },
  });
  expect(locked.receipt?.outcome).toMatchObject({ case: 'applied', value: { boardRevision: 4n } });

  const request = { ...board, revision: 2n, expectedCurrentRevision: 4n };
  const selected = await callWhiteboard(server.address, editorId, restoreBoardVersion, {
    ...request,
    commandId: 'restore-child-to-locked-section',
    scope: { case: 'selection', value: { objectIds: [childId] } },
  });
  const entire = await callWhiteboard(server.address, editorId, restoreBoardVersion, {
    ...request,
    commandId: 'restore-board-into-locked-section',
    scope: whole,
  });

  for (const result of [selected, entire]) {
    expect(result.receipt?.outcome).toMatchObject({
      case: 'rejected',
      value: { reason: BoardEditRejectionReason.GEOMETRY_LOCKED },
    });
  }

  const scene = await callWhiteboard(server.address, editorId, getBoardScene, board);
  expect(scene.scene?.boardRevision).toBe(4n);
  expect(scene.scene?.objects.some(({ objectId }) => objectId === childId)).toBe(false);
});

test('rejects historical layer changes inside a locked section and restores document content in place', async () => {
  const parentId = 'locked-order-section';
  const childId = 'locked-order-document';
  const siblingId = 'locked-order-sibling';
  const originalTitle = 'Original document';
  const geometry = { x: 25, y: 32, width: 150, height: 120, rotation: 0 };
  const objects = [
    {
      objectId: parentId,
      kind: 'section',
      label: 'Section',
      geometryDetail: { case: 'section' as const, value: { transparent: false } },
    },
    { objectId: childId, kind: 'document', label: originalTitle, parentId },
    {
      objectId: siblingId,
      kind: 'shape',
      label: 'Sibling',
      parentId,
      geometryDetail: { case: 'shape' as const, value: { outline: 'rounded' } },
    },
  ];

  for (const object of objects) {
    const created = await callWhiteboard(server.address, editorId, editBoardGeometry, {
      ...board,
      commandId: 'create-' + object.objectId,
      operation: { case: 'create', value: { object: { ...object, geometry } } },
    });
    expect(created.receipt?.outcome.case).toBe('applied');
  }

  const draft = await callWhiteboard(server.address, editorId, editObjectContent, {
    ...board,
    commandId: 'change-document-before-section-lock',
    objectId: childId,
    expectedPayloadVersion: 0n,
    edit: {
      case: 'document',
      value: {
        schemaVersion: 1,
        title: 'New draft',
        blocks: [
          {
            blockId: 'new-paragraph',
            type: 'paragraph',
            content: { kind: { case: 'stringValue', value: 'New body' } },
          },
        ],
      },
    },
  });
  expect(draft.receipt?.outcome).toMatchObject({ case: 'applied', value: { boardRevision: 4n } });

  const targets = [{ objectId: childId, expectedGeometryVersion: 0n }];
  const reordered = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    ...board,
    commandId: 'move-child-forward-before-section-lock',
    operation: {
      case: 'reorder',
      value: { targets, direction: BoardLayerDirection.FORWARD, expectedBoardRevision: 4n },
    },
  });
  expect(reordered.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { boardRevision: 5n },
  });

  const locked = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    ...board,
    commandId: 'lock-section-containing-reordered-objects',
    operation: {
      case: 'changeLock',
      value: { locked: true, targets: [{ objectId: parentId, expectedGeometryVersion: 0n }] },
    },
  });
  expect(locked.receipt?.outcome).toMatchObject({ case: 'applied', value: { boardRevision: 6n } });

  const direct = await callWhiteboard(server.address, editorId, editBoardGeometry, {
    ...board,
    commandId: 'move-child-back-in-locked-section',
    operation: {
      case: 'reorder',
      value: { targets, direction: BoardLayerDirection.BACKWARD, expectedBoardRevision: 6n },
    },
  });
  const request = { ...board, revision: 3n, expectedCurrentRevision: 6n };
  const historical = await callWhiteboard(server.address, editorId, restoreBoardVersion, {
    ...request,
    commandId: 'restore-layer-order-in-locked-section',
    scope: { case: 'selection', value: { objectIds: [childId, siblingId] } },
  });

  for (const result of [direct, historical]) {
    expect(result.receipt?.outcome).toMatchObject({
      case: 'rejected',
      value: { reason: BoardEditRejectionReason.GEOMETRY_LOCKED },
    });
  }

  const content = await callWhiteboard(server.address, editorId, restoreBoardVersion, {
    ...request,
    commandId: 'restore-content-in-locked-section',
    scope: { case: 'selection', value: { objectIds: [childId] } },
  });
  expect(content.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      boardRevision: 7n,
      objectOrder: [],
      changedObjects: [{ objectId: childId, geometryVersion: 0n, parentId }],
      changedPayloads: [
        {
          objectId: childId,
          result: {
            case: 'payload',
            value: { body: { case: 'document', value: { title: originalTitle, blocks: [] } } },
          },
        },
      ],
    },
  });

  const scene = await callWhiteboard(server.address, editorId, getBoardScene, board);
  expect(
    scene.scene?.objects.slice(-3).map(({ objectId, locked }) => ({ objectId, locked })),
  ).toEqual([
    { objectId: parentId, locked: true },
    { objectId: siblingId, locked: false },
    { objectId: childId, locked: false },
  ]);
});

test('uses a cumulative UTF-8 budget before loading historical and current payloads', async () => {
  await move(shapeId, 0n, 22, 'move-before-oversize-restore');
  seedLargeHistoricalPayloads(server.databasePath, 1n);

  const request = { ...baseline, expectedCurrentRevision: 1n };
  const overBudget = await callWhiteboard(server.address, editorId, restoreBoardVersion, {
    ...request,
    commandId: 'restore-over-byte-budget',
    scope: { case: 'selection', value: { objectIds: [documentId] } },
  });
  const outcome = overBudget.receipt?.outcome;
  assert.equal(outcome?.case, 'rejected');
  expect(outcome.value.reason).toBe(BoardEditRejectionReason.TOO_LARGE);

  const unchanged = await callWhiteboard(server.address, editorId, listBoardVersions, board);
  expect(unchanged.currentRevision).toBe(1n);

  const geometryOnly = await callWhiteboard(server.address, editorId, restoreBoardVersion, {
    ...request,
    commandId: 'restore-without-loading-unrelated-payloads',
    scope: shapeSelection,
  });
  expect(geometryOnly.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { boardRevision: 2n, changedPayloads: [] },
  });
});
