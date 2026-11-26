import { create, fromBinary, fromJson, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { NullValue, ValueSchema } from '@bufbuild/protobuf/wkt';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import type { ObjectPayloadSchema } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';
import { expect, test } from 'vitest';
import {
  createWhiteboardEditService,
  type WhiteboardTableContent,
} from '../../src/data/whiteboard/index.js';

const method = BoardEditService.method.editObjectContent;
const identity = { boardId: 'board', commandId: 'object-update' };
const objectId = 'editable-object';
const version = 0n;
const boardRevision = 43n;
const command = { ...identity, objectId, expectedPayloadVersion: version };

type WireBody = MessageInitShape<typeof ObjectPayloadSchema>['body'];

function saveReceipt(body: WireBody, receiptIdentity = identity, payloadVersion = version + 1n) {
  return toBinary(
    method.output,
    create(method.output, {
      receipt: {
        ...receiptIdentity,
        outcome: {
          case: 'applied',
          value: {
            boardRevision,
            changedPayloads: [
              {
                objectId,
                result: { case: 'payload', value: { payloadVersion, body } },
              },
            ],
          },
        },
      },
    }),
  );
}

test('preserves table cells, ordered IDs, header presence and width compare-and-swap', async () => {
  const table: WhiteboardTableContent = {
    text: '发布检查',
    rows: [
      ['', 0, false, null],
      ['值', 42, true, null],
    ],
    rowIds: ['r2', 'r1'],
    columnIds: ['label', 'count', 'flag', 'empty'],
    columnWidths: [96, 121, 88, 115],
    head: false,
  };
  const widthChange = { expectedWidth: 400, width: 420 };
  const edits = createWhiteboardEditService(async (_path, bytes) => {
    const request = fromBinary(method.input, bytes);
    if (request.edit.case !== 'table' || !request.edit.value.table) {
      throw new Error('Expected the table edit and its content.');
    }

    expect(request.expectedPayloadVersion).toBe(version);
    expect(request.edit.value.widthChange).toMatchObject(widthChange);
    expect(request.edit.value.table).toMatchObject({
      text: table.text,
      grid: {
        rowIds: table.rowIds,
        columnIds: table.columnIds,
        columnWidths: table.columnWidths,
        head: false,
        rows: [
          {
            cells: [
              { value: { case: 'text', value: '' } },
              { value: { case: 'number', value: 0 } },
              { value: { case: 'boolValue', value: false } },
              { value: { case: 'nullValue', value: NullValue.NULL_VALUE } },
            ],
          },
          {
            cells: [
              { value: { case: 'text', value: '值' } },
              { value: { case: 'number', value: 42 } },
              { value: { case: 'boolValue', value: true } },
              { value: { case: 'nullValue', value: NullValue.NULL_VALUE } },
            ],
          },
        ],
      },
    });

    return saveReceipt({ case: 'table', value: request.edit.value.table });
  });

  const { text, ...data } = table;
  await expect(
    edits.editContent({ ...command, edit: { kind: 'table', value: table, widthChange } }),
  ).resolves.toMatchObject({
    kind: 'applied',
    revision: boardRevision,
    payloads: [
      { kind: 'loaded', payload: { id: objectId, body: { kind: 'table', value: { text, data } } } },
    ],
  });
});

test('keeps an HTML source compare-and-swap independent of the content version', async () => {
  const value = { title: '发布清单', html: '<p>发布清单</p>', expectedSourceRevision: 0n };
  const expectedPayloadVersion = 9n;
  const edits = createWhiteboardEditService(async (_path, bytes) => {
    expect(fromBinary(method.input, bytes)).toMatchObject({
      expectedPayloadVersion,
      edit: { case: 'embedSource', value },
    });

    return saveReceipt(
      { case: 'embed', value: { title: value.title, html: value.html, sourceRevision: 1n } },
      identity,
      expectedPayloadVersion + 1n,
    );
  });

  await expect(
    edits.editContent({ ...command, expectedPayloadVersion, edit: { kind: 'embedSource', value } }),
  ).resolves.toMatchObject({
    kind: 'applied',
    payloads: [
      {
        kind: 'loaded',
        payload: {
          version: expectedPayloadVersion + 1n,
          body: {
            kind: 'embed',
            value: { title: value.title, html: value.html, sourceRevision: 1n },
          },
        },
      },
    ],
  });
});

test.each([null, { selected: false, filters: [0, null, ''] }])(
  'roundtrips an explicitly saved HTML state',
  async (value) => {
    const state = fromJson(ValueSchema, value);
    const edits = createWhiteboardEditService(async (_path, bytes) => {
      expect(fromBinary(method.input, bytes)).toMatchObject({
        edit: { case: 'embedState', value: { state } },
      });

      return saveReceipt({ case: 'embed', value: { state, sourceRevision: 7n } });
    });

    await expect(
      edits.editContent({ ...command, edit: { kind: 'embedState', value } }),
    ).resolves.toMatchObject({
      kind: 'applied',
      payloads: [
        {
          kind: 'loaded',
          payload: { body: { kind: 'embed', value: { state: value, sourceRevision: 7n } } },
        },
      ],
    });
  },
);

test('confirms the selected sticker and validates the mutation receipt identity', async () => {
  const stickerId = 'sparkle';
  const body = { case: 'sticker', value: { stickerId } } as const;
  const edits = createWhiteboardEditService(async (_path, bytes) => {
    expect(fromBinary(method.input, bytes)).toMatchObject({
      edit: { case: 'sticker', value: { stickerId } },
    });

    return saveReceipt(body);
  });
  const request = { ...command, edit: { kind: 'sticker', value: { id: stickerId } } } as const;

  await expect(edits.editContent(request)).resolves.toMatchObject({
    kind: 'applied',
    payloads: [
      { kind: 'loaded', payload: { body: { kind: 'sticker', value: { id: stickerId } } } },
    ],
  });

  const wrongReceipt = createWhiteboardEditService(async () =>
    saveReceipt(body, { ...identity, commandId: 'another-command' }),
  );
  await expect(wrongReceipt.editContent(request)).rejects.toThrow('unexpected command ID');
});

test('sends the crop and natural dimensions while returning the original asset reference', async () => {
  const value = { crop: { zoom: 1.5, x: 0.5, y: 0.2 }, naturalSize: { width: 960, height: 720 } };
  const src = '/studio-archive-assets/board/source-photo';
  const edits = createWhiteboardEditService(async (_path, bytes) => {
    expect(fromBinary(method.input, bytes)).toMatchObject({ edit: { case: 'crop', value } });

    return saveReceipt({ case: 'image', value: { src, ...value } });
  });

  await expect(
    edits.editContent({ ...command, edit: { kind: 'crop', value } }),
  ).resolves.toMatchObject({
    kind: 'applied',
    payloads: [{ kind: 'loaded', payload: { body: { kind: 'image', value: { src, ...value } } } }],
  });
});
