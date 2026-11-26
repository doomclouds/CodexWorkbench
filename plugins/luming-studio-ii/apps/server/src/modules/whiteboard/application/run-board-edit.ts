import {
  canAdvanceVersion,
  type Actor,
  type BoardEditDecision,
  type BoardEditIdentity,
  type BoardEditReceipt,
  type BoardEditRejection,
  type BoardHeader,
  type BoardVersionKind,
} from '../domain/index.js';
import type { BoardEditRepository, BoardEditWriter } from '../ports/index.js';

interface BoardEditRequest {
  readonly signature: string;
  readonly kind: BoardVersionKind;
  readonly savedAtMillis: number;
  readonly sourceRevision?: bigint;
}

type PlanBoardEdit = (writer: BoardEditWriter, board: BoardHeader) => BoardEditDecision;

function rejected(identity: BoardEditIdentity, reason: BoardEditRejection): BoardEditReceipt {
  return { ...identity, outcome: { kind: 'rejected', reason } };
}

export function runBoardEdit(
  repository: BoardEditRepository,
  actor: Actor,
  identity: BoardEditIdentity,
  request: BoardEditRequest,
  plan: PlanBoardEdit,
): BoardEditReceipt {
  const { boardId, commandId } = identity;

  return repository.write((writer) => {
    const access = writer.getAccess(boardId, actor.id);
    const board = access?.canEdit ? writer.getBoard(boardId) : undefined;
    if (!board) {
      return rejected(identity, 'forbidden');
    }

    const stored = writer.getEditReceipt(boardId, actor.id, commandId);
    if (stored) {
      return stored.signature === request.signature
        ? stored.receipt
        : rejected(identity, 'commandIdReuse');
    }

    const decision = plan(writer, board);
    if (decision.kind !== 'changes') {
      return { ...identity, outcome: decision };
    }
    if (!canAdvanceVersion(board.revision)) {
      return rejected(identity, 'invalidEdit');
    }

    const { signature, ...details } = request;
    const outcome = writer.applyBoardChanges(board, decision, { ...details, actorId: actor.id });
    const receipt = { ...identity, outcome };
    writer.saveEditReceipt(actor.id, { signature, receipt });

    return receipt;
  });
}

export function readBoardEditReceipt(
  repository: BoardEditRepository,
  actor: Actor,
  identity: BoardEditIdentity,
): BoardEditReceipt | undefined {
  const { boardId, commandId } = identity;

  return repository.read((reader) =>
    reader.getAccess(boardId, actor.id)?.canEdit
      ? reader.getEditReceipt(boardId, actor.id, commandId)?.receipt
      : rejected(identity, 'forbidden'),
  );
}
