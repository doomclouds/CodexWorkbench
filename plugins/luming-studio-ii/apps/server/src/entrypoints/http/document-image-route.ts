import { toBinary } from '@bufbuild/protobuf';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import type { BoardEditorApplication } from '../../modules/whiteboard/application/index.js';
import { toBoardEditReceipt } from './board-edit-receipt.js';
import { requireId } from './request.js';
import { asyncUnaryRoute, type RouteEntry } from './unary-route.js';

const upload = BoardEditService.method.uploadBoardDocumentImage;
const assetPrefix = 'document-image-';

export const boardDocumentImageRoutePath = '/' + BoardEditService.typeName + '/' + upload.name;

export function createDocumentImageRoute(
  application: BoardEditorApplication,
  digest: (bytes: Uint8Array) => string,
): RouteEntry {
  return asyncUnaryRoute(upload, async (actor, request) => {
    const boardId = requireId(request.boardId);
    const commandId = requireId(request.commandId);
    const objectId = requireId(request.objectId);
    const identity = new TextEncoder().encode(JSON.stringify([boardId, actor.id, commandId]));
    const assetId = assetPrefix + digest(identity);
    const signature = assetPrefix + digest(toBinary(upload.input, request));
    const { receipt, assetUrl } = await application.uploadDocumentImage(actor, {
      boardId,
      commandId,
      operation: { objectId, assetId, content: request.content },
      signature,
    });

    return { receipt: toBoardEditReceipt(receipt), assetUrl };
  });
}
