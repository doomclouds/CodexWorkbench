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
  return repository.write((writer) =>
    runBoardEditInTransaction(writer, actor, identity, request, plan),
  );
}

export function runBoardEditInTransaction(
  writer: BoardEditWriter,
  actor: Actor,
  identity: BoardEditIdentity,
  request: BoardEditRequest,
  plan: PlanBoardEdit,
): BoardEditReceipt {
  const { boardId, commandId } = identity;
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
  const applied = writer.applyBoardChanges(board, decision, { ...details, actorId: actor.id });
  const advancedRevision = applied.boardRevision > board.revision;
  const outcome = advancedRevision ? applied : { ...applied, order: undefined };
  const receipt = { ...identity, outcome };
  writer.saveEditReceipt(actor.id, { signature, receipt, advancedRevision });

  return receipt;
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

export function checkBoardEditBeforePreparation(
  repository: BoardEditRepository,
  actor: Actor,
  identity: BoardEditIdentity,
  signature: string,
): BoardEditReceipt | undefined {
  const { boardId, commandId } = identity;

  return repository.read((reader) => {
    if (!reader.getAccess(boardId, actor.id)?.canEdit) {
      return rejected(identity, 'forbidden');
    }

    const stored = reader.getEditReceipt(boardId, actor.id, commandId);
    if (stored) {
      return stored.signature === signature ? stored.receipt : rejected(identity, 'commandIdReuse');
    }

    return undefined;
  });
}
