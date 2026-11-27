import type {
  Actor,
  BoardEditIdentity,
  BoardEditReceipt,
  ContentOperation,
  GeometryOperation,
  ImageOperation,
  VideoOperation,
} from '../domain/index.js';
import { archiveImageSource } from '../domain/index.js';
import type { BoardEditRepository } from '../ports/index.js';
import { planVideoEdit } from './attach-image.js';
import { pasteBoardObjects } from './clipboard-paste.js';
import {
  planDocumentImageUpload,
  type DocumentImageOperation,
  type DocumentImageUpload,
} from './document-image.js';
import { planContentEdit } from './edit-content.js';
import { planGeometryEdit } from './edit-geometry.js';
import { createAttachImage, type RenderUploadedSvg } from './prepare-board-image.js';
import { planBoardReverse, type BoardReverseSource } from './reverse-board-edit.js';
import { readBoardEditReceipt, runBoardEdit } from './run-board-edit.js';

interface BoardCommand<Operation> extends BoardEditIdentity {
  readonly operation: Operation;
  readonly signature: string;
}

export interface BoardEditorApplication {
  editGeometry(actor: Actor, command: BoardCommand<GeometryOperation>): BoardEditReceipt;
  editContent(actor: Actor, command: BoardCommand<ContentOperation>): BoardEditReceipt;
  attachImage(actor: Actor, command: BoardCommand<ImageOperation>): Promise<BoardEditReceipt>;
  attachVideo(actor: Actor, command: BoardCommand<VideoOperation>): BoardEditReceipt;
  uploadDocumentImage(
    actor: Actor,
    command: BoardCommand<DocumentImageOperation>,
  ): DocumentImageUpload;
  reverseEdit(actor: Actor, command: BoardCommand<BoardReverseSource>): BoardEditReceipt;
  getEditReceipt(actor: Actor, identity: BoardEditIdentity): BoardEditReceipt | undefined;
}

export function createBoardEditorApplication(
  repository: BoardEditRepository,
  now: () => number,
  renderUploadedSvg?: RenderUploadedSvg,
): BoardEditorApplication {
  return {
    editGeometry(actor, { operation, signature, boardId, commandId }) {
      return runBoardEdit(
        repository,
        actor,
        { boardId, commandId },
        { kind: 'geometry', signature, savedAtMillis: now() },
        (writer, board) =>
          operation.kind === 'paste'
            ? pasteBoardObjects(writer, board, actor, operation, signature)
            : planGeometryEdit(writer, board, operation),
      );
    },
    editContent(actor, { operation, signature, boardId, commandId }) {
      return runBoardEdit(
        repository,
        actor,
        { boardId, commandId },
        { kind: 'content', signature, savedAtMillis: now() },
        (writer, board) => planContentEdit(writer, board, operation),
      );
    },
    attachImage: createAttachImage(repository, now, renderUploadedSvg),
    attachVideo(actor, { operation, signature, boardId, commandId }) {
      return runBoardEdit(
        repository,
        actor,
        { boardId, commandId },
        { kind: 'content', signature, savedAtMillis: now() },
        (writer, board) => planVideoEdit(writer, board, operation),
      );
    },
    uploadDocumentImage(actor, { operation, signature, boardId, commandId }) {
      const receipt = runBoardEdit(
        repository,
        actor,
        { boardId, commandId },
        { kind: 'image', signature, savedAtMillis: now() },
        (writer, board) => planDocumentImageUpload(writer, board, operation),
      );

      return {
        receipt,
        assetUrl:
          receipt.outcome.kind === 'applied'
            ? archiveImageSource(boardId, operation.assetId)
            : undefined,
      };
    },
    reverseEdit(actor, { operation, signature, boardId, commandId }) {
      return runBoardEdit(
        repository,
        actor,
        { boardId, commandId },
        { kind: 'geometry', signature, savedAtMillis: now() },
        (writer, board) => planBoardReverse(writer, board, actor, operation),
      );
    },
    getEditReceipt: (actor, identity) => readBoardEditReceipt(repository, actor, identity),
  };
}
