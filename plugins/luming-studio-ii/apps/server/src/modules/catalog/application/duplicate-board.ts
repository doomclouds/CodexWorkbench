import {
  duplicateBoardTitle,
  type CatalogCreatedReceipt,
  type CatalogReceipt,
} from '../domain/index.js';
import type { CatalogRepository } from '../ports/index.js';

export interface DuplicateBoardCommand {
  readonly sourceBoardId: string;
  readonly commandId: string;
}

type NewBoard = (commandId: string, title: string) => CatalogCreatedReceipt;

export function duplicateBoard(
  repository: CatalogRepository,
  actorId: string,
  command: DuplicateBoardCommand,
  newBoard: NewBoard,
): CatalogReceipt {
  const { sourceBoardId, commandId } = command;

  return repository.write((writer) => {
    const stored = writer.getReceipt(actorId, commandId);
    if (stored) {
      const { receipt, duplicateSourceId } = stored;

      return duplicateSourceId === sourceBoardId && receipt.kind === 'created'
        ? receipt
        : { kind: 'rejected', commandId, reason: 'commandIdReuse' };
    }

    const source = writer.getManagedBoard(actorId, sourceBoardId);
    if (!source) {
      return { kind: 'rejected', commandId, reason: 'forbidden' };
    }
    if (source.trashedAtMillis !== undefined) {
      return { kind: 'rejected', commandId, reason: 'stateChanged' };
    }

    const title = duplicateBoardTitle(source.board.title);
    if (title === undefined) {
      return { kind: 'rejected', commandId, reason: 'invalidTitle' };
    }

    const receipt = newBoard(commandId, title);
    const rejected = writer.duplicateBoard(actorId, sourceBoardId, receipt);

    return rejected ? { kind: 'rejected', commandId, reason: rejected } : receipt;
  });
}
