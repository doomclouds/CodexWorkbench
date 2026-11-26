import { toBinary } from '@bufbuild/protobuf';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import type { BoardEditorApplication } from '../../modules/whiteboard/application/index.js';
import { toBoardEditReceipt } from './board-edit-receipt.js';
import { readContentOperation } from './content-edits.js';
import { readGeometryOperation } from './geometry-edits.js';
import { readImageOperation } from './image-edits.js';
import { requireId } from './request.js';
import { unaryRoute, type RouteEntry } from './unary-route.js';

const { editBoardGeometry, editObjectContent, attachBoardImage, getBoardEditReceipt } =
  BoardEditService.method;

export const boardImageRoutePath = '/' + BoardEditService.typeName + '/' + attachBoardImage.name;
export const boardImageRequestLimit = 8 * 1024 * 1024 + 32 * 1024;

export function createBoardEditRoutes(
  application: BoardEditorApplication,
  digest: (value: Uint8Array) => string,
): readonly RouteEntry[] {
  return [
    unaryRoute(editBoardGeometry, (actor, request) => ({
      receipt: toBoardEditReceipt(
        application.editGeometry(actor, {
          boardId: requireId(request.boardId),
          commandId: requireId(request.commandId),
          operation: readGeometryOperation(request),
          signature: 'geometry:' + digest(toBinary(editBoardGeometry.input, request)),
        }),
      ),
    })),
    unaryRoute(editObjectContent, (actor, request) => ({
      receipt: toBoardEditReceipt(
        application.editContent(actor, {
          boardId: requireId(request.boardId),
          commandId: requireId(request.commandId),
          operation: readContentOperation(request),
          signature: 'content:' + digest(toBinary(editObjectContent.input, request)),
        }),
      ),
    })),
    unaryRoute(attachBoardImage, (actor, request) => ({
      receipt: toBoardEditReceipt(
        application.attachImage(actor, {
          boardId: requireId(request.boardId),
          commandId: requireId(request.commandId),
          operation: readImageOperation(request),
          signature: 'image:' + digest(toBinary(attachBoardImage.input, request)),
        }),
      ),
    })),
    unaryRoute(getBoardEditReceipt, (actor, request) => {
      const receipt = application.getEditReceipt(actor, {
        boardId: requireId(request.boardId),
        commandId: requireId(request.commandId),
      });

      return { receipt: receipt && toBoardEditReceipt(receipt) };
    }),
  ];
}
