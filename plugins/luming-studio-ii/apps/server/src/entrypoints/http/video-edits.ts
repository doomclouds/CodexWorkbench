import { toBinary } from '@bufbuild/protobuf';
import {
  BoardEditService,
  type AttachBoardVideoRequest,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import type {
  BoardEditorApplication,
  VideoOperation,
} from '../../modules/whiteboard/application/index.js';
import { toBoardEditReceipt } from './board-edit-receipt.js';
import { HttpRequestError, requireId } from './request.js';
import type { ObserveEdit } from './room-changes.js';
import { unaryRoute, type RouteEntry } from './unary-route.js';

const attach = BoardEditService.method.attachBoardVideo;
const emptyContent = new Uint8Array();

export const boardVideoRoutePath = '/' + BoardEditService.typeName + '/' + attach.name;
export const boardVideoRequestLimit = 20 * 1024 * 1024 + 32 * 1024;

function readOperation({
  objectId,
  displayName,
  content,
  geometry,
  mediaType,
}: AttachBoardVideoRequest): VideoOperation {
  if (!geometry) {
    throw new HttpRequestError(400, 'Video geometry is required.');
  }

  const { x, y, width, height, rotation } = geometry;

  return { objectId, displayName, content, mediaType, geometry: { x, y, width, height, rotation } };
}

export function createVideoEditRoute(
  application: BoardEditorApplication,
  digest: (value: Uint8Array) => string,
  observe?: ObserveEdit,
): RouteEntry {
  return unaryRoute(attach, (actor, request) => {
    const { boardId, commandId, content } = request;
    const metadata = toBinary(attach.input, { ...request, content: emptyContent });
    const receipt = application.attachVideo(actor, {
      boardId: requireId(boardId),
      commandId: requireId(commandId),
      operation: readOperation(request),
      signature: 'video:' + digest(metadata) + ':' + digest(content),
    });
    observe?.(receipt);

    return { receipt: toBoardEditReceipt(receipt) };
  });
}
