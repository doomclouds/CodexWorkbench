import { fromJson, type MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardEditRejectionReason,
  BoardEditService,
  SaveEmbedStateSchema,
  type EditObjectContentRequestSchema,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { expect, test } from 'vitest';
import { callWhiteboard, sendWhiteboardRequest } from '../support/whiteboard-client.js';
import { editorId, mainBoardId, viewerId } from '../support/whiteboard-database.js';
import {
  assetPath,
  chartId,
  embedId,
  imageId,
  legacyStickerId,
  lockedImageId,
  seedNativeObjects,
  stickerId,
  tableId,
} from '../support/whiteboard-native-content-fixture.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

type ContentRequest = MessageInitShape<typeof EditObjectContentRequestSchema>;
type ContentEdit = ContentRequest['edit'];

const server = useWhiteboardTestServer();
const { editObjectContent } = BoardEditService.method;
const { getObjectPayloads } = WhiteboardService.method;
const originalWidth = 480;
const initialColumns = ['col-1', 'col-2'];
const extendedColumns = [...initialColumns, 'col-3'];

function editContent(objectId: string, commandId: string, version: bigint, edit: ContentEdit) {
  return callWhiteboard(server.address, editorId, editObjectContent, {
    boardId: mainBoardId,
    objectId,
    commandId,
    expectedPayloadVersion: version,
    edit,
  });
}

function readPayload(objectId: string) {
  return callWhiteboard(server.address, viewerId, getObjectPayloads, {
    boardId: mainBoardId,
    objectIds: [objectId],
  });
}

function tableEdit(
  columnIds: string[],
  columnWidths: number[],
  widths?: [number, number],
  rowIds = ['row-1'],
): ContentEdit {
  const cells = columnIds.map((id) => ({ value: { case: 'text' as const, value: id } }));

  return {
    case: 'table',
    value: {
      table: {
        text: 'Schedule',
        grid: { rows: rowIds.map(() => ({ cells })), rowIds, columnIds, columnWidths, head: true },
      },
      widthChange: widths ? { expectedWidth: widths[0], width: widths[1] } : undefined,
    },
  };
}

test.each([false, true])('commits a row and its frame together with lock %s', async (locked) => {
  seedNativeObjects(server.databasePath, locked);
  const columns = [240, 240];
  const add = tableEdit(initialColumns, columns, undefined, ['row-1', 'row-2']);
  const saved = await editContent(tableId, 'table-add-row', 0n, add);
  expect(saved.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      changedObjects: [
        {
          objectId: tableId,
          geometry: { x: 12, y: 28, height: locked ? 120 : 240, width: originalWidth },
          geometryVersion: locked ? 0n : 1n,
          payloadVersion: 1n,
        },
      ],
    },
  });

  await server.restart();
  expect((await editContent(tableId, 'table-add-row', 0n, add)).receipt).toEqual(saved.receipt);
  const removed = await editContent(
    tableId,
    'table-remove-row',
    1n,
    tableEdit(initialColumns, columns),
  );
  expect(removed.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      changedObjects: [
        {
          objectId: tableId,
          geometry: { height: 120, width: originalWidth },
          geometryVersion: locked ? 0n : 2n,
          payloadVersion: 2n,
        },
      ],
    },
  });
});

test('keeps locked table content writable while allowing same-frame columns to be added', async () => {
  seedNativeObjects(server.databasePath, true);
  const cell = await editContent(tableId, 'table-cell', 0n, tableEdit(initialColumns, [240, 240]));
  expect(cell.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      changedObjects: [{ objectId: tableId, geometryVersion: 0n, payloadVersion: 1n }],
    },
  });

  const add = tableEdit(extendedColumns, [160, 160, 160], [originalWidth, originalWidth]);
  const changed = await editContent(tableId, 'table-add', 1n, add);
  expect(changed.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      changedObjects: [
        {
          objectId: tableId,
          geometry: { width: originalWidth },
          geometryVersion: 1n,
          payloadVersion: 2n,
        },
      ],
    },
  });

  const dragged = tableEdit(extendedColumns, [120, 200, 160], [originalWidth, originalWidth]);
  const drag = await editContent(tableId, 'table-column-drag', 2n, dragged);
  const frame = tableEdit(extendedColumns, [160, 160, 160], [originalWidth, 540]);
  const resize = await editContent(tableId, 'table-frame-resize', 2n, frame);
  for (const result of [drag, resize]) {
    expect(result.receipt?.outcome).toMatchObject({
      case: 'rejected',
      value: { reason: BoardEditRejectionReason.GEOMETRY_LOCKED },
    });
  }
});

test('compares table frame width and preserves both versions across a receipt replay and reopen', async () => {
  seedNativeObjects(server.databasePath, false);
  const stale = tableEdit(initialColumns, [300, 240], [460, 540]);
  const conflict = await editContent(tableId, 'table-stale-width', 0n, stale);
  expect(conflict.receipt?.outcome).toMatchObject({
    case: 'conflict',
    value: { currentObjects: [{ objectId: tableId, geometry: { width: originalWidth } }] },
  });

  const edit = tableEdit(initialColumns, [300, 240], [originalWidth, 540]);
  const saved = await editContent(tableId, 'table-width', 0n, edit);
  expect(saved.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      changedObjects: [
        { objectId: tableId, label: 'Schedule', geometry: { width: 540 }, geometryVersion: 1n },
      ],
    },
  });

  await server.restart();
  const replayed = await editContent(tableId, 'table-width', 0n, edit);
  expect(replayed.receipt).toEqual(saved.receipt);

  const loaded = await readPayload(tableId);
  expect(loaded.results[0]?.result).toMatchObject({
    case: 'payload',
    value: {
      payloadVersion: 1n,
      body: {
        case: 'table',
        value: { grid: { columnIds: initialColumns, columnWidths: [300, 240] } },
      },
    },
  });
});

const savedState = fromJson(SaveEmbedStateSchema, { state: { step: 2 } });
const stateEdit = { case: 'embedState', value: savedState } as const;
const updateSource = {
  case: 'embedSource',
  value: { title: 'Updated demo', html: '<p>Updated</p>', expectedSourceRevision: 0n },
} as const;

test.each(['html', 'diagram'] as const)(
  'saves %s state independently and requires current source and payload versions',
  async (kind) => {
    seedNativeObjects(server.databasePath, false, kind);
    const state = await editContent(embedId, 'write-embed-state', 0n, stateEdit);
    expect(state.receipt?.outcome.case).toBe('applied');

    const source = await editContent(embedId, 'write-embed-source', 1n, updateSource);
    expect(source.receipt?.outcome).toMatchObject({
      case: 'applied',
      value: {
        changedObjects: [{ objectId: embedId, kind, label: 'Updated demo', geometryVersion: 0n }],
        changedPayloads: [
          {
            objectId: embedId,
            result: {
              case: 'payload',
              value: {
                payloadVersion: 2n,
                body: { case: 'embed', value: { sourceRevision: 1n, state: savedState.state } },
              },
            },
          },
        ],
      },
    });

    const oldSource = await editContent(embedId, 'old-embed-source', 2n, updateSource);
    const oldState = await editContent(embedId, 'old-embed-state', 0n, stateEdit);
    expect(oldSource.receipt?.outcome.case).toBe('conflict');
    expect(oldState.receipt?.outcome.case).toBe('conflict');

    const chart = await editContent(chartId, 'chart-state', 0n, stateEdit);
    expect(chart.receipt?.outcome).toMatchObject({
      case: 'rejected',
      value: { reason: BoardEditRejectionReason.UNSUPPORTED_KIND },
    });
  },
);

test('rejects non-object and oversized HTML state', async () => {
  seedNativeObjects(server.databasePath, false);
  const nonObject = fromJson(SaveEmbedStateSchema, { state: [1, 2] });
  const large = fromJson(SaveEmbedStateSchema, { state: { text: 'x'.repeat(65_536) } });
  const invalid = await editContent(embedId, 'embed-array', 0n, {
    case: 'embedState',
    value: nonObject,
  });
  const oversized = await editContent(embedId, 'embed-large', 0n, {
    case: 'embedState',
    value: large,
  });
  expect(invalid.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.INVALID_EDIT },
  });
  expect(oversized.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.TOO_LARGE },
  });

  const missing = await sendWhiteboardRequest(server.address, editorId, editObjectContent, {
    boardId: mainBoardId,
    objectId: embedId,
    commandId: 'missing-source-version',
    expectedPayloadVersion: 0n,
    edit: { case: 'embedSource', value: { title: 'Demo', html: '<p>Text</p>' } },
  });
  expect(missing.status).toBe(400);
});

test('selects known sticker IDs and saves the matching board label', async () => {
  seedNativeObjects(server.databasePath, false);
  const edit = { case: 'sticker', value: { stickerId: 'rocket' } } as const;
  const saved = await editContent(stickerId, 'sticker-rocket', 0n, edit);
  expect(saved.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: { changedObjects: [{ objectId: stickerId, geometryVersion: 0n, label: '火箭' }] },
  });

  const unknown = await editContent(stickerId, 'sticker-unknown', 1n, {
    case: 'sticker',
    value: { stickerId: 'unknown' },
  });
  expect(unknown.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.INVALID_EDIT },
  });

  const payload = await readPayload(stickerId);
  expect(payload.results[0]?.result).toMatchObject({
    case: 'payload',
    value: { body: { case: 'sticker', value: { stickerId: 'rocket' } } },
  });
});

test('saves legacy sticker text through the same receipt while preserving the geometry lock', async () => {
  seedNativeObjects(server.databasePath, false);
  const edit = { case: 'sticker', value: { fallback: '✦' } } as const;
  const saved = await editContent(legacyStickerId, 'sticker-symbol', 0n, edit);
  expect(saved.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      changedObjects: [
        { objectId: legacyStickerId, geometryVersion: 0n, locked: true, label: '✦' },
      ],
    },
  });
  const payload = await readPayload(legacyStickerId);
  expect(payload.results[0]?.result).toMatchObject({
    case: 'payload',
    value: { body: { case: 'sticker', value: { fallback: '✦' } } },
  });
  const graphic = await editContent(stickerId, 'sticker-reject-text', 0n, edit);
  expect(graphic.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.INVALID_EDIT },
  });
});

const crop = { zoom: 2, x: 0.2, y: 0.8 };
const naturalSize = { width: 1, height: 1 };
const cropEdit = { case: 'crop', value: { crop, naturalSize } } as const;

test('retains source and frame during crop, while checking finite values and ancestor locks', async () => {
  seedNativeObjects(server.databasePath, false);
  const invalid = await editContent(imageId, 'invalid-crop', 0n, {
    case: 'crop',
    value: { crop: { ...crop, x: 1.5 }, naturalSize },
  });
  expect(invalid.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.INVALID_EDIT },
  });

  const locked = await editContent(lockedImageId, 'locked-crop', 0n, cropEdit);
  expect(locked.receipt?.outcome).toMatchObject({
    case: 'rejected',
    value: { reason: BoardEditRejectionReason.GEOMETRY_LOCKED },
  });
  const success = await editContent(imageId, 'confirmed-crop', 0n, cropEdit);
  expect(success.receipt?.outcome).toMatchObject({
    case: 'applied',
    value: {
      changedObjects: [
        { objectId: imageId, geometry: { width: originalWidth }, geometryVersion: 0n },
      ],
    },
  });

  await server.restart();
  const payload = await readPayload(imageId);
  expect(payload.results[0]?.result).toMatchObject({
    case: 'payload',
    value: {
      payloadVersion: 1n,
      body: { case: 'image', value: { src: assetPath, crop, naturalSize } },
    },
  });
});
