import { BoardEditService as wireService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import type { WhiteboardPayloadBody, WhiteboardPost } from './contracts.js';
import type {
  BoardEditReceipt,
  EditBoardGeometryOperation,
  EditObjectContentOperation,
  WhiteboardEditService,
} from './edits-types.js';
import { writeContent } from './protocol/edit-content.js';
import { writeGeometry } from './protocol/edit-geometry.js';
import { readBoardEditReceipt } from './protocol/edit-receipt.js';
import { request } from './protocol/index.js';

export type {
  AttachBoardImageCommand,
  BoardEditReceipt,
  BoardEditRejection,
  EditBoardGeometryCommand,
  EditBoardGeometryOperation,
  EditObjectContentCommand,
  EditObjectContentOperation,
  WhiteboardDocumentBlock,
  WhiteboardDocumentContent,
  WhiteboardEditService,
  WhiteboardInitialPayload,
  WhiteboardJson,
  WhiteboardLayerDirection,
  WhiteboardObjectDraft,
  WhiteboardTableContent,
  WhiteboardTextContent,
  WhiteboardTodoChange,
  WhiteboardTodoItem,
  WhiteboardTodoSource,
  WhiteboardTransformKind,
} from './edits-types.js';

const confirmedPayloadKinds = {
  document: 'document',
  todo: 'todo',
  text: 'text',
  table: 'table',
  embedSource: 'embed',
  embedState: 'embed',
  sticker: 'sticker',
  crop: 'image',
} as const satisfies Record<EditObjectContentOperation['kind'], WhiteboardPayloadBody['kind']>;

function confirmCreated(receipt: BoardEditReceipt, ids: readonly string[]): void {
  if (receipt.kind !== 'applied') {
    return;
  }

  const changed = new Set(receipt.objects.map(({ id }) => id));
  if (ids.some((id) => !changed.has(id))) {
    throw new Error('Whiteboard edit response did not confirm creation of the requested objects.');
  }
}

function confirmGeometry(receipt: BoardEditReceipt, operation: EditBoardGeometryOperation): void {
  if (operation.kind === 'create') {
    confirmCreated(receipt, [operation.object.id]);
  }
  if (operation.kind === 'duplicate') {
    confirmCreated(
      receipt,
      operation.targets.map(({ newObjectId }) => newObjectId),
    );
  }
}

function confirmContent(
  receipt: BoardEditReceipt,
  objectId: string,
  kind: WhiteboardPayloadBody['kind'],
): void {
  if (receipt.kind !== 'applied') {
    return;
  }

  const confirmed = receipt.payloads.some(
    (result) =>
      result.kind === 'loaded' &&
      result.payload.id === objectId &&
      result.payload.body.kind === kind,
  );

  if (!confirmed) {
    throw new Error('Whiteboard edit response did not confirm the submitted object content.');
  }
}

export function createWhiteboardEditService(
  post: WhiteboardPost,
  resolveArchiveAsset: (source: string) => string = (source) => source,
): WhiteboardEditService {
  const { editBoardGeometry, editObjectContent, attachBoardImage, getBoardEditReceipt } =
    wireService.method;

  return {
    async editGeometry(command, signal) {
      const { boardId, commandId, operation } = command;
      const response = await request(
        post,
        editBoardGeometry,
        writeGeometry(command, resolveArchiveAsset),
        signal,
      );
      const receipt = readBoardEditReceipt(
        response.receipt,
        boardId,
        commandId,
        resolveArchiveAsset,
      );
      confirmGeometry(receipt, operation);

      return receipt;
    },
    async editContent(command, signal) {
      const { boardId, commandId, objectId, edit } = command;
      const response = await request(
        post,
        editObjectContent,
        writeContent(command, resolveArchiveAsset),
        signal,
      );
      const receipt = readBoardEditReceipt(
        response.receipt,
        boardId,
        commandId,
        resolveArchiveAsset,
      );
      confirmContent(receipt, objectId, confirmedPayloadKinds[edit.kind]);

      return receipt;
    },
    async attachImage(command, signal) {
      const { boardId, commandId, objectId } = command;
      const response = await request(post, attachBoardImage, command, signal);
      const receipt = readBoardEditReceipt(
        response.receipt,
        boardId,
        commandId,
        resolveArchiveAsset,
      );
      confirmCreated(receipt, [objectId]);
      confirmContent(receipt, objectId, 'image');

      return receipt;
    },
    async getReceipt(boardId, commandId, signal) {
      const response = await request(post, getBoardEditReceipt, { boardId, commandId }, signal);

      return (
        response.receipt &&
        readBoardEditReceipt(response.receipt, boardId, commandId, resolveArchiveAsset)
      );
    },
  };
}
