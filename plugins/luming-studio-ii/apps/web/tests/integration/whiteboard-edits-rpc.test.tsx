import {
  create,
  fromBinary,
  fromJson,
  toBinary,
  type DescMessage,
  type MessageInitShape,
} from '@bufbuild/protobuf';
import { ValueSchema } from '@bufbuild/protobuf/wkt';
import {
  BoardEditRejectionReason,
  BoardEditService,
  BoardLayerDirection,
  BoardTransformKind,
  type BoardEditReceiptSchema,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { TextAlignment } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';
import {
  BendAxis,
  ConnectorHead,
  ConnectorPort,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import { expect, test } from 'vitest';
import {
  createWhiteboardEditService,
  type AttachBoardImageCommand,
  type EditBoardGeometryCommand,
  type EditObjectContentCommand,
  type WhiteboardPost,
} from '../../src/data/whiteboard/index.js';

const { editBoardGeometry, editObjectContent, attachBoardImage, getBoardEditReceipt } =
  BoardEditService.method;
const identity = { boardId: 'board-edit', commandId: 'create-1' };
const boardGeometry = { x: 17, y: 29, width: 72, height: 93, rotation: 0 };
const objectId = 'release-rectangle';
const stickerId = 'sparkle';
const documentId = 'release-document';
const appOrigin = 'http://127.0.0.1:4311';
const assetPath = '/studio-archive-assets/board-edit/release-screenshot';
const previewUrl = appOrigin + assetPath;
const externalImage = 'https://other.example' + assetPath;
const revision = 9_007_199_254_740_999n;

type WireReceipt = MessageInitShape<typeof BoardEditReceiptSchema>;

function reply<Schema extends DescMessage>(schema: Schema, value: MessageInitShape<Schema>) {
  return toBinary(schema, create(schema, value));
}

const newSticker: EditBoardGeometryCommand = {
  ...identity,
  operation: {
    kind: 'create',
    object: { id: objectId, kind: 'sticker', label: '发布', geometry: boardGeometry },
    initialPayload: { kind: 'sticker', value: { id: stickerId, fallback: '*' } },
  },
};

const stickerApplied = {
  ...identity,
  outcome: {
    case: 'applied',
    value: {
      boardRevision: revision,
      changedObjects: [
        {
          objectId,
          kind: 'sticker',
          label: '发布',
          geometry: boardGeometry,
          geometryVersion: 0n,
          payloadVersion: 0n,
        },
      ],
      objectOrder: ['existing', objectId],
      changedPayloads: [
        {
          objectId,
          result: {
            case: 'payload',
            value: { payloadVersion: 0n, body: { case: 'sticker', value: { stickerId } } },
          },
        },
      ],
    },
  },
} satisfies WireReceipt;

test('creates stable object IDs and decodes authoritatively ordered changed metadata and content', async () => {
  const controller = new AbortController();
  const edits = createWhiteboardEditService(async (path, bytes, signal) => {
    expect(path).toBe('/luming.studio.v1.BoardEditService/EditBoardGeometry');
    expect(signal).toBe(controller.signal);
    const request = fromBinary(editBoardGeometry.input, bytes);
    expect(request).toMatchObject({
      ...identity,
      operation: {
        case: 'create',
        value: {
          object: {
            objectId,
            kind: 'sticker',
            geometry: boardGeometry,
          },
          initialPayload: { body: { case: 'sticker', value: { stickerId, fallback: '*' } } },
        },
      },
    });
    expect(request.operation).not.toHaveProperty('value.object.geometryVersion');

    return reply(editBoardGeometry.output, { receipt: stickerApplied });
  });

  await expect(edits.editGeometry(newSticker, controller.signal)).resolves.toMatchObject({
    ...identity,
    kind: 'applied',
    revision,
    objects: [{ id: objectId, geometryVersion: 0n, payloadVersion: 0n }],
    payloads: [
      {
        kind: 'loaded',
        payload: { id: objectId, version: 0n, body: { kind: 'sticker', value: { id: stickerId } } },
      },
    ],
    removedIds: [],
    order: ['existing', objectId],
  });
});

test('writes an HTML diagram as version-zero embedded source through the geometry API', async () => {
  const diagramId = 'release-html-diagram';
  const title = '图解';
  const html = '<!doctype html><html lang="zh-CN"><p>发布</p></html>';
  const edits = createWhiteboardEditService(async (_path, bytes) => {
    expect(fromBinary(editBoardGeometry.input, bytes)).toMatchObject({
      ...identity,
      operation: {
        case: 'create',
        value: {
          object: { objectId: diagramId, kind: 'html', label: title, geometry: boardGeometry },
          initialPayload: { body: { case: 'embed', value: { title, html, sourceRevision: 0n } } },
        },
      },
    });

    return reply(editBoardGeometry.output, {
      receipt: {
        ...identity,
        outcome: {
          case: 'applied',
          value: {
            boardRevision: 1n,
            changedObjects: [
              {
                objectId: diagramId,
                kind: 'html',
                label: title,
                geometry: boardGeometry,
                geometryVersion: 0n,
                payloadVersion: 0n,
              },
            ],
            changedPayloads: [
              {
                objectId: diagramId,
                result: {
                  case: 'payload',
                  value: {
                    payloadVersion: 0n,
                    body: { case: 'embed', value: { title, html, sourceRevision: 0n } },
                  },
                },
              },
            ],
          },
        },
      },
    });
  });

  await expect(
    edits.editGeometry({
      ...identity,
      operation: {
        kind: 'create',
        object: { id: diagramId, kind: 'html', label: title, geometry: boardGeometry },
        initialPayload: { kind: 'embed', value: { title, html } },
      },
    }),
  ).resolves.toMatchObject({
    kind: 'applied',
    payloads: [
      {
        kind: 'loaded',
        payload: {
          id: diagramId,
          version: 0n,
          body: { kind: 'embed', value: { title, html, sourceRevision: 0n } },
        },
      },
    ],
  });
});

test('encodes zero-based connection versions and typed connection details independently', async () => {
  const first = { x: 11, y: 22 };
  const last = { x: 55, y: 88 };
  const edits = createWhiteboardEditService(async (_path, bytes) => {
    expect(fromBinary(editBoardGeometry.input, bytes)).toMatchObject({
      operation: {
        case: 'transform',
        value: {
          kind: BoardTransformKind.CONNECT,
          objects: [
            {
              target: { objectId: 'connector', expectedGeometryVersion: 0n },
              connector: {
                start: { point: first, attachment: { objectId, port: ConnectorPort.RIGHT } },
                end: { point: last },
                relativeBends: { firstAxis: BendAxis.VERTICAL, offsets: [17, -29] },
                endHead: ConnectorHead.ARROW,
              },
            },
          ],
        },
      },
    });

    return reply(editBoardGeometry.output, {
      receipt: {
        ...identity,
        outcome: { case: 'rejected', value: { reason: BoardEditRejectionReason.GEOMETRY_LOCKED } },
      },
    });
  });

  await expect(
    edits.editGeometry({
      ...identity,
      operation: {
        kind: 'transform',
        transform: 'connect',
        objects: [
          {
            target: { id: 'connector', expectedGeometryVersion: 0n },
            geometry: boardGeometry,
            connection: {
              start: { point: first, attachment: { objectId, port: 'right' } },
              end: { point: last },
              relativeBends: { firstAxis: 'vertical', offsets: [17, -29] },
              endHead: 'arrow',
            },
          },
        ],
      },
    }),
  ).resolves.toEqual({ ...identity, kind: 'rejected', reason: 'geometryLocked' });
});

test('keeps reorder compare-and-swap values and exposes a stale authoritative revision', async () => {
  const edits = createWhiteboardEditService(async (_path, bytes) => {
    expect(fromBinary(editBoardGeometry.input, bytes)).toMatchObject({
      operation: {
        case: 'reorder',
        value: {
          targets: [{ objectId, expectedGeometryVersion: revision }],
          direction: BoardLayerDirection.FRONT,
          expectedBoardRevision: 0n,
        },
      },
    });

    return reply(editBoardGeometry.output, {
      receipt: { ...identity, outcome: { case: 'conflict', value: { boardRevision: revision } } },
    });
  });

  await expect(
    edits.editGeometry({
      ...identity,
      operation: {
        kind: 'reorder',
        targets: [{ id: objectId, expectedGeometryVersion: revision }],
        direction: 'front',
        expectedBoardRevision: 0n,
      },
    }),
  ).resolves.toEqual({ ...identity, kind: 'conflict', revision, objects: [], payloads: [] });
});

test('restores document archive paths on the wire and re-resolves them on the confirmed payload', async () => {
  const inline = [{ type: 'text', text: '发布流程', styles: { bold: true } }];
  const command: EditObjectContentCommand = {
    ...identity,
    objectId: documentId,
    expectedPayloadVersion: 0n,
    edit: {
      kind: 'document',
      value: {
        title: '发布流程',
        document: {
          schemaVersion: 1,
          blocks: [
            {
              id: 'parent',
              type: 'paragraph',
              props: {},
              content: inline,
              children: [
                { id: 'attachment', type: 'image', props: { url: previewUrl } },
                { id: 'external', type: 'image', props: { url: externalImage } },
              ],
            },
          ],
        },
      },
    },
  };

  const post: WhiteboardPost = async (path, bytes) => {
    expect(path).toBe('/luming.studio.v1.BoardEditService/EditObjectContent');
    const request = fromBinary(editObjectContent.input, bytes);
    if (request.edit.case !== 'document') {
      throw new Error('Expected a document edit.');
    }

    expect(request.expectedPayloadVersion).toBe(0n);
    expect(request.edit.value).toMatchObject({
      title: '发布流程',
      schemaVersion: 1,
      blocks: [
        {
          blockId: 'parent',
          content: fromJson(ValueSchema, inline),
          children: [
            { blockId: 'attachment', props: { url: assetPath } },
            { blockId: 'external', props: { url: externalImage } },
          ],
        },
      ],
    });

    return reply(editObjectContent.output, {
      receipt: {
        ...identity,
        outcome: {
          case: 'applied',
          value: {
            boardRevision: 2n,
            changedPayloads: [
              {
                objectId: documentId,
                result: { case: 'payload', value: { payloadVersion: 1n, body: request.edit } },
              },
            ],
          },
        },
      },
    });
  };
  const edits = createWhiteboardEditService(post, (source) =>
    source === assetPath ? previewUrl : source,
  );

  await expect(edits.editContent(command)).resolves.toMatchObject({
    kind: 'applied',
    revision: 2n,
    payloads: [{ kind: 'loaded', payload: { id: documentId, version: 1n, body: command.edit } }],
  });
});

test('serializes all todo placement states, optional cleared values and stable source IDs', async () => {
  const firstItem = { id: 'draft', text: '校验清单', checked: false };
  const source = {
    artifactId: identity.boardId,
    elementId: documentId,
    blockId: 'paragraph',
    version: revision,
  };
  const edits = createWhiteboardEditService(async (_path, bytes) => {
    expect(fromBinary(editObjectContent.input, bytes)).toMatchObject({
      objectId: 'checklist',
      expectedPayloadVersion: revision,
      edit: {
        case: 'todo',
        value: {
          edits: [
            {
              operation: {
                case: 'insert',
                value: {
                  item: { itemId: firstItem.id },
                  placement: { position: { case: 'first', value: true } },
                },
              },
            },
            {
              operation: {
                case: 'insert',
                value: {
                  item: { itemId: 'appended' },
                  placement: { position: { case: 'append', value: true } },
                },
              },
            },
            {
              operation: {
                case: 'move',
                value: {
                  itemId: 'appended',
                  placement: { position: { case: 'afterItemId', value: firstItem.id } },
                },
              },
            },
            {
              operation: {
                case: 'update',
                value: {
                  itemId: 'appended',
                  text: '',
                  checked: false,
                  sourceChange: { case: 'clearSource', value: true },
                },
              },
            },
            {
              operation: {
                case: 'update',
                value: {
                  itemId: firstItem.id,
                  sourceChange: {
                    case: 'sourceRef',
                    value: {
                      boardId: identity.boardId,
                      objectId: documentId,
                      blockId: 'paragraph',
                      version: revision,
                    },
                  },
                },
              },
            },
            { operation: { case: 'deleteItemId', value: 'appended' } },
          ],
        },
      },
    });

    return reply(editObjectContent.output, {
      receipt: {
        ...identity,
        outcome: { case: 'conflict', value: { boardRevision: revision } },
      },
    });
  });

  await expect(
    edits.editContent({
      ...identity,
      objectId: 'checklist',
      expectedPayloadVersion: revision,
      edit: {
        kind: 'todo',
        value: [
          { op: 'insert', item: firstItem, afterId: null },
          { op: 'insert', item: { ...firstItem, id: 'appended' } },
          { op: 'move', id: 'appended', afterId: firstItem.id },
          { op: 'update', id: 'appended', changes: { text: '', checked: false, sourceRef: null } },
          { op: 'update', id: firstItem.id, changes: { sourceRef: source } },
          { op: 'delete', id: 'appended' },
        ],
      },
    }),
  ).resolves.toMatchObject({ kind: 'conflict', revision });
});

test('preserves text alignment through protobuf and validates the applied content target', async () => {
  const edits = createWhiteboardEditService(async (_path, bytes) => {
    expect(fromBinary(editObjectContent.input, bytes)).toMatchObject({
      edit: { case: 'text', value: { text: '发布', fontSize: 18, align: TextAlignment.CENTER } },
    });

    return reply(editObjectContent.output, { receipt: stickerApplied });
  });

  await expect(
    edits.editContent({
      ...identity,
      objectId,
      expectedPayloadVersion: 0n,
      edit: { kind: 'text', value: { text: '发布', fontSize: 18, align: 'center' } },
    }),
  ).rejects.toThrow('did not confirm the submitted object content');
});

test('attaches bytes on the image endpoint and keeps the stable confirmed media reference', async () => {
  const command: AttachBoardImageCommand = {
    ...identity,
    objectId,
    displayName: '发布截图.png',
    geometry: boardGeometry,
    content: new Uint8Array([137, 80, 78, 71]),
  };
  const edits = createWhiteboardEditService(async (path, bytes) => {
    expect(path).toBe('/luming.studio.v1.BoardEditService/AttachBoardImage');
    expect(fromBinary(attachBoardImage.input, bytes)).toMatchObject(command);

    return reply(attachBoardImage.output, {
      receipt: {
        ...identity,
        outcome: {
          case: 'applied',
          value: {
            boardRevision: 1n,
            changedObjects: [
              {
                objectId,
                kind: 'image',
                geometry: boardGeometry,
                geometryVersion: 0n,
                payloadVersion: 0n,
              },
            ],
            changedPayloads: [
              {
                objectId,
                result: {
                  case: 'payload',
                  value: { payloadVersion: 0n, body: { case: 'image', value: { src: assetPath } } },
                },
              },
            ],
          },
        },
      },
    });
  });

  await expect(edits.attachImage(command)).resolves.toMatchObject({
    kind: 'applied',
    payloads: [
      {
        kind: 'loaded',
        payload: { id: objectId, body: { kind: 'image', value: { src: assetPath } } },
      },
    ],
  });
});

test('distinguishes absent stored receipts from missing mutation outcomes', async () => {
  const edits = createWhiteboardEditService(async (path, bytes) => {
    if (path.endsWith('/GetBoardEditReceipt')) {
      expect(fromBinary(getBoardEditReceipt.input, bytes)).toMatchObject(identity);

      return reply(getBoardEditReceipt.output, {});
    }

    return reply(editBoardGeometry.output, {});
  });

  await expect(edits.getReceipt(identity.boardId, identity.commandId)).resolves.toBeUndefined();
  await expect(edits.editGeometry(newSticker)).rejects.toThrow('missing edit command receipt');
});

test.each([
  { ...stickerApplied, boardId: 'other-board' },
  { ...stickerApplied, commandId: 'other-command' },
])('rejects a retrieved receipt for an unexpected identity', async (receipt) => {
  const edits = createWhiteboardEditService(async () =>
    reply(getBoardEditReceipt.output, { receipt }),
  );

  await expect(edits.getReceipt(identity.boardId, identity.commandId)).rejects.toThrow(
    'unexpected',
  );
});

test('rejects a contradictory order instead of applying it to the current scene', async () => {
  const edits = createWhiteboardEditService(async () =>
    reply(getBoardEditReceipt.output, {
      receipt: {
        ...identity,
        outcome: {
          case: 'applied',
          value: { boardRevision: 0n, removedObjectIds: [objectId], objectOrder: [objectId] },
        },
      },
    }),
  );

  await expect(edits.getReceipt(identity.boardId, identity.commandId)).rejects.toThrow(
    'kept an object it removed',
  );
});
