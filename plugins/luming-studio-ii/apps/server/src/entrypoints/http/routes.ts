import {
  create,
  toBinary,
  type DescMessage,
  type MessageInitShape,
  type MessageShape,
} from '@bufbuild/protobuf';
import {
  WhiteboardService,
  type GetCommandReceiptResponseSchema,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import type { Actor, WhiteboardApplication } from '../../modules/whiteboard/application/index.js';
import { toPayloadResult } from './payload.js';
import { toCommandReceipt, toMoveCommand } from './receipt.js';
import { decodeRequest, requireId } from './request.js';
import { toBoardScene } from './scene.js';

type WhiteboardRoute = (actor: Actor, body: Uint8Array) => Uint8Array;
type RouteEntry = readonly [string, WhiteboardRoute];
type ReceiptResponseInit = MessageInitShape<typeof GetCommandReceiptResponseSchema>;
type RouteHandler<Input extends DescMessage, Output extends DescMessage> = (
  actor: Actor,
  request: MessageShape<Input>,
) => MessageInitShape<Output>;

interface UnaryMethod<Input extends DescMessage, Output extends DescMessage> {
  readonly name: string;
  readonly methodKind: 'unary';
  readonly input: Input;
  readonly output: Output;
}

function unaryRoute<Input extends DescMessage, Output extends DescMessage>(
  method: UnaryMethod<Input, Output>,
  handle: RouteHandler<Input, Output>,
): RouteEntry {
  const path = `/${WhiteboardService.typeName}/${method.name}`;

  return [
    path,
    (actor, body) => {
      const request = decodeRequest(method.input, body);
      const response = handle(actor, request);
      return toBinary(method.output, create(method.output, response));
    },
  ];
}

export function createRoutes(
  application: WhiteboardApplication,
): ReadonlyMap<string, WhiteboardRoute> {
  const { getBoardScene, getObjectPayloads, moveObjects, getCommandReceipt } =
    WhiteboardService.method;

  return new Map([
    unaryRoute(getBoardScene, (actor, request) => ({
      scene: toBoardScene(application.getBoardScene(actor, requireId(request.boardId))),
    })),
    unaryRoute(getObjectPayloads, (actor, request) => {
      const boardId = requireId(request.boardId);
      const results = application.getObjectPayloads(actor, boardId, request.objectIds);

      return { boardId, results: results.map(toPayloadResult) };
    }),
    unaryRoute(moveObjects, (actor, request) => ({
      receipt: toCommandReceipt(application.moveObjects(actor, toMoveCommand(request))),
    })),
    unaryRoute(getCommandReceipt, (actor, request): ReceiptResponseInit => {
      const boardId = requireId(request.boardId);
      const commandId = requireId(request.commandId);
      const receipt = application.getCommandReceipt(actor, boardId, commandId);

      return {
        result: receipt
          ? { case: 'receipt', value: toCommandReceipt(receipt) }
          : { case: 'notRecorded', value: { boardId, commandId } },
      };
    }),
  ]);
}
