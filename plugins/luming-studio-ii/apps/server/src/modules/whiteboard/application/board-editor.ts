import type {
  Actor,
  BoardEditIdentity,
  BoardEditReceipt,
  ContentOperation,
  GeometryOperation,
  ImageOperation,
} from '../domain/index.js';
import type { BoardEditRepository } from '../ports/index.js';
import { planImageEdit } from './attach-image.js';
import { planContentEdit } from './edit-content.js';
import { planGeometryEdit } from './edit-geometry.js';
import { readBoardEditReceipt, runBoardEdit } from './run-board-edit.js';

interface BoardCommand<Operation> extends BoardEditIdentity {
  readonly operation: Operation;
  readonly signature: string;
}

export interface BoardEditorApplication {
  editGeometry(actor: Actor, command: BoardCommand<GeometryOperation>): BoardEditReceipt;
  editContent(actor: Actor, command: BoardCommand<ContentOperation>): BoardEditReceipt;
  attachImage(actor: Actor, command: BoardCommand<ImageOperation>): BoardEditReceipt;
  getEditReceipt(actor: Actor, identity: BoardEditIdentity): BoardEditReceipt | undefined;
}

export function createBoardEditorApplication(
  repository: BoardEditRepository,
  now: () => number,
): BoardEditorApplication {
  return {
    editGeometry(actor, { operation, signature, boardId, commandId }) {
      return runBoardEdit(
        repository,
        actor,
        { boardId, commandId },
        { kind: 'geometry', signature, savedAtMillis: now() },
        (writer, board) => planGeometryEdit(writer, board, operation),
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
    attachImage(actor, { operation, signature, boardId, commandId }) {
      return runBoardEdit(
        repository,
        actor,
        { boardId, commandId },
        { kind: 'image', signature, savedAtMillis: now() },
        (writer, board) => planImageEdit(writer, board, operation),
      );
    },
    getEditReceipt: (actor, identity) => readBoardEditReceipt(repository, actor, identity),
  };
}
