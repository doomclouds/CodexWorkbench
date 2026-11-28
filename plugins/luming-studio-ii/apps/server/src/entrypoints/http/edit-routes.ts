import { toBinary } from '@bufbuild/protobuf';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import type { BoardEditorApplication } from '../../modules/whiteboard/application/index.js';
import { toBoardEditReceipt } from './board-edit-receipt.js';
import { readContentOperation } from './content-edits.js';
import { readGeometryOperation } from './geometry-edits.js';
import { readImageOperation } from './image-edits.js';
import { requireId } from './request.js';
import { asyncUnaryRoute, unaryRoute, type RouteEntry } from './unary-route.js';

const {
  editBoardGeometry,
  editObjectContent,
  attachBoardImage,
  reverseBoardEdit,
  getBoardEditReceipt,
} = BoardEditService.method;

export const boardImageRoutePath = '/' + BoardEditService.typeName + '/' + attachBoardImage.name;
export const boardImageRequestLimit = 20 * 1024 * 1024 + 32 * 1024;

export function createBoardEditRoutes(
  application: BoardEditorApplication,
  digest: (value: Uint8Array) => string,
): readonly RouteEntry[] {
  return [
    unaryRoute(editBoardGeometry, (actor, request) => {
      const operation = readGeometryOperation(request);
      if (operation.kind === 'paste') {
        actor.authorizeRead?.(operation.sourceBoardId);
      }

      return {
        receipt: toBoardEditReceipt(
          application.editGeometry(actor, {
            boardId: requireId(request.boardId),
            commandId: requireId(request.commandId),
            operation,
            signature: 'geometry:' + digest(toBinary(editBoardGeometry.input, request)),
          }),
        ),
      };
    }),
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
    asyncUnaryRoute(attachBoardImage, async (actor, request) => ({
      receipt: toBoardEditReceipt(
        await application.attachImage(actor, {
          boardId: requireId(request.boardId),
          commandId: requireId(request.commandId),
          operation: readImageOperation(request),
          signature: 'image:' + digest(toBinary(attachBoardImage.input, request)),
        }),
      ),
    })),
    unaryRoute(reverseBoardEdit, (actor, request) => {
      const { source } = request;
      const kind = source.case === 'moveCommandId' ? 'move' : 'edit';

      return {
        receipt: toBoardEditReceipt(
          application.reverseEdit(actor, {
            boardId: requireId(request.boardId),
            commandId: requireId(request.commandId),
            operation: { kind, commandId: requireId(source.value ?? '') },
            signature: 'reverse:' + digest(toBinary(reverseBoardEdit.input, request)),
          }),
        ),
      };
    }),
    unaryRoute(getBoardEditReceipt, (actor, request) => {
      const receipt = application.getEditReceipt(actor, {
        boardId: requireId(request.boardId),
        commandId: requireId(request.commandId),
      });

      return { receipt: receipt && toBoardEditReceipt(receipt) };
    }),
  ];
}
