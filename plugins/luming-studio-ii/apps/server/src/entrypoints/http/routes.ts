import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  WhiteboardService,
  type GetCommandReceiptResponseSchema,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import type { WhiteboardApplication } from '../../modules/whiteboard/application/index.js';
import { createExportRoute } from './export-route.js';
import { toPayloadResult } from './payload.js';
import { toCommandReceipt, toMoveCommand } from './receipt.js';
import { requireId } from './request.js';
import { toBoardScene } from './scene.js';
import { canReadTrashedBoard, unaryRoute, type RouteEntry } from './unary-route.js';

type ReceiptResponseInit = MessageInitShape<typeof GetCommandReceiptResponseSchema>;

export function createWhiteboardRoutes(application: WhiteboardApplication): readonly RouteEntry[] {
  const { getBoardScene, getObjectPayloads, moveObjects, getCommandReceipt } =
    WhiteboardService.method;

  return [
    createExportRoute(application),
    unaryRoute(getBoardScene, (actor, request) => ({
      scene: toBoardScene(
        application.getBoardScene(actor, requireId(request.boardId), canReadTrashedBoard(actor)),
      ),
    })),
    unaryRoute(getObjectPayloads, (actor, request) => {
      const boardId = requireId(request.boardId);
      const results = application.getObjectPayloads(
        actor,
        boardId,
        request.objectIds,
        canReadTrashedBoard(actor),
      );

      return { boardId, results: results.map(toPayloadResult) };
    }),
    unaryRoute(moveObjects, (actor, request) => {
      const receipt = application.moveObjects(actor, toMoveCommand(request));
      return { receipt: toCommandReceipt(receipt) };
    }),
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
  ];
}
