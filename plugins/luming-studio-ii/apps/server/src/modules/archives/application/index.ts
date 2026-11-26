import { isArchiveIdentifier } from '../domain/index.js';
import type { ArchiveImportPort } from '../ports/index.js';

export type { ArchiveImportReceipt, ArchiveImportRejectionReason } from '../domain/index.js';

export const MAX_ARCHIVE_IMPORT_BYTES = 128 * 1024 * 1024;

export class ArchiveRequestError extends Error {}

interface ArchiveImportDependencies {
  readonly newBoardId: () => string;
  readonly now: () => number;
}

function requireCommandId(value: string): string {
  if (!isArchiveIdentifier(value)) {
    throw new ArchiveRequestError('Invalid archive command identifier.');
  }

  return value;
}

export function createArchiveImportApplication(
  port: ArchiveImportPort,
  dependencies: ArchiveImportDependencies,
) {
  return {
    importCurrent(actorId: string, commandId: string, chunks: AsyncIterable<Uint8Array>) {
      return port.importCurrent({
        actorId,
        commandId: requireCommandId(commandId),
        boardId: dependencies.newBoardId(),
        updatedAtMillis: dependencies.now(),
        chunks,
      });
    },
    getReceipt(actorId: string, commandId: string) {
      return port.getReceipt(actorId, requireCommandId(commandId));
    },
    getAsset(actorId: string, boardId: string, assetId: string) {
      if (!isArchiveIdentifier(boardId) || !isArchiveIdentifier(assetId)) {
        throw new ArchiveRequestError('Invalid imported asset identifier.');
      }

      return port.getAsset(actorId, boardId, assetId);
    },
  };
}

export type ArchiveImportApplication = ReturnType<typeof createArchiveImportApplication>;
