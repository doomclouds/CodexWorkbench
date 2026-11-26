import { create, fromBinary, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { type ObjectMetadataSchema } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import {
  CommandReceiptNotRecordedSchema,
  CommandReceiptSchema,
  MoveConflictReason,
  ObjectPayloadResultSchema,
  WhiteboardService,
  type CommandReceipt,
  type MoveObjectsRequest,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';

export const sampleBoardId = 'phase-one-board';

const { getBoardScene, getObjectPayloads, moveObjects, getCommandReceipt } =
  WhiteboardService.method;
const shape = {
  objectId: 'rectangle',
  kind: 'shape',
  label: '可移动图形',
  geometry: { x: 40, y: 40, width: 120, height: 80, rotation: 0 },
  geometryVersion: 0n,
} satisfies MessageInitShape<typeof ObjectMetadataSchema>;
const caption = {
  objectId: 'caption',
  kind: 'text',
  label: '可见正文',
  geometry: { x: 280, y: 50, width: 200, height: 90, rotation: 0 },
  geometryVersion: 0n,
  payloadVersion: 1n,
} satisfies MessageInitShape<typeof ObjectMetadataSchema>;
const distant = {
  ...caption,
  objectId: 'distant',
  geometry: { ...caption.geometry, x: 6000 },
};

interface Options {
  readonly canEdit?: boolean;
  readonly move?: (
    request: MoveObjectsRequest,
    attempt: number,
  ) => CommandReceipt | Promise<CommandReceipt>;
}

function rpcPath(method: { readonly name: string }): string {
  return '/' + WhiteboardService.typeName + '/' + method.name;
}

export function moved(request: MoveObjectsRequest): CommandReceipt {
  const { delta } = request;
  if (!delta) {
    throw new Error('The move request omitted its displacement.');
  }

  return create(CommandReceiptSchema, {
    boardId: request.boardId,
    commandId: request.commandId,
    outcome: {
      case: 'applied',
      value: {
        boardRevision: 1n,
        objects: [
          {
            ...shape,
            geometry: {
              ...shape.geometry,
              x: shape.geometry.x + delta.dx,
              y: shape.geometry.y + delta.dy,
            },
            geometryVersion: 1n,
          },
        ],
      },
    },
  });
}

export function conflicted(request: MoveObjectsRequest): CommandReceipt {
  return create(CommandReceiptSchema, {
    boardId: request.boardId,
    commandId: request.commandId,
    outcome: {
      case: 'conflict',
      value: {
        boardRevision: 1n,
        reason: MoveConflictReason.GEOMETRY_VERSION_CHANGED,
        currentObjects: [{ ...shape, geometryVersion: 1n }],
      },
    },
  });
}

export function createWhiteboardRpcMock({ canEdit = true, move }: Options = {}) {
  const moves: MoveObjectsRequest[] = [];
  const payloadReads: string[][] = [];
  const receiptReads: string[] = [];
  const sceneReads: string[] = [];
  let receipt: CommandReceipt | undefined;

  async function post(path: string, bytes: Uint8Array): Promise<Uint8Array> {
    if (path === rpcPath(getBoardScene)) {
      const request = fromBinary(getBoardScene.input, bytes);
      sceneReads.push(request.boardId);

      return toBinary(
        getBoardScene.output,
        create(getBoardScene.output, {
          scene: {
            boardId: request.boardId,
            title: '一期测试白板',
            boardRevision: 0n,
            access: { canEdit },
            objects: [shape, caption, distant],
          },
        }),
      );
    }
    if (path === rpcPath(getObjectPayloads)) {
      const request = fromBinary(getObjectPayloads.input, bytes);
      payloadReads.push(request.objectIds);

      return toBinary(
        getObjectPayloads.output,
        create(getObjectPayloads.output, {
          boardId: request.boardId,
          results: request.objectIds.map((objectId) =>
            create(ObjectPayloadResultSchema, {
              objectId,
              result: {
                case: 'payload',
                value: {
                  payloadVersion: 1n,
                  body: { case: 'text', value: { text: '从服务读取的正文' } },
                },
              },
            }),
          ),
        }),
      );
    }
    if (path === rpcPath(moveObjects)) {
      const request = fromBinary(moveObjects.input, bytes);
      moves.push(request);
      const result = move ? await move(request, moves.length) : moved(request);
      if (result.outcome?.case === 'applied') {
        receipt = result;
      }

      return toBinary(moveObjects.output, create(moveObjects.output, { receipt: result }));
    }
    if (path === rpcPath(getCommandReceipt)) {
      const request = fromBinary(getCommandReceipt.input, bytes);
      receiptReads.push(request.commandId);
      const result = receipt
        ? { case: 'receipt' as const, value: receipt }
        : {
            case: 'notRecorded' as const,
            value: create(CommandReceiptNotRecordedSchema, {
              boardId: request.boardId,
              commandId: request.commandId,
            }),
          };

      return toBinary(getCommandReceipt.output, create(getCommandReceipt.output, { result }));
    }

    throw new Error('Unknown whiteboard RPC: ' + path);
  }

  return { post, moves, payloadReads, receiptReads, sceneReads };
}
