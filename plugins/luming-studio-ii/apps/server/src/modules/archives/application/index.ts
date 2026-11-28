import {
  isArchiveIdentifier,
  type BoardAssetImport,
  type ImportedArchiveAsset,
} from '../domain/index.js';
import type { ArchiveImportPort } from '../ports/index.js';

export type {
  ArchiveImportReceipt,
  ArchiveImportRejectionReason,
  BoardAssetRejection,
} from '../domain/index.js';

export const MAX_ARCHIVE_IMPORT_BYTES = 128 * 1024 * 1024;
export const MAX_BOARD_ASSET_IMPORT_BYTES = 20 * 1024 * 1024;

export class ArchiveRequestError extends Error {}

export class BoardAssetAccessError extends Error {}

interface ArchiveImportDependencies {
  readonly newBoardId: () => string;
  readonly now: () => number;
  readonly digest: (value: string | Uint8Array) => string;
  readonly prepareAsset: (
    boardId: string,
    assetId: string,
    content: Uint8Array,
  ) => Promise<ImportedArchiveAsset | undefined>;
}

function requireCommandId(value: string): string {
  if (!isArchiveIdentifier(value)) {
    throw new ArchiveRequestError('Invalid archive command identifier.');
  }

  return value;
}

function requireAssetId(value: string): void {
  if (!isArchiveIdentifier(value)) {
    throw new ArchiveRequestError('Invalid board or asset identifier.');
  }
}

function requireOwnerResult<T>(result: T | undefined): T {
  if (result === undefined) {
    throw new BoardAssetAccessError('Board assets require an active board owner.');
  }

  return result;
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
    getAsset(actorId: string, boardId: string, assetId: string, allowTrashedOwner = false) {
      if (!isArchiveIdentifier(boardId) || !isArchiveIdentifier(assetId)) {
        throw new ArchiveRequestError('Invalid imported asset identifier.');
      }

      return port.getAsset(actorId, boardId, assetId, allowTrashedOwner);
    },
    listBoardAssets(actorId: string, boardId: string, cursor = '', limit = 50) {
      requireAssetId(boardId);
      if (cursor !== '') {
        requireAssetId(cursor);
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new ArchiveRequestError('Board asset page size must be between 1 and 100.');
      }

      return requireOwnerResult(port.listBoardAssets(actorId, boardId, cursor, limit));
    },
    async importBoardAsset(
      actorId: string,
      boardId: string,
      commandId: string,
      content: Uint8Array,
    ): Promise<BoardAssetImport> {
      requireAssetId(boardId);
      requireCommandId(commandId);
      if (!port.isActiveBoardOwner(actorId, boardId)) {
        throw new BoardAssetAccessError('Board assets require an active board owner.');
      }
      if (content.byteLength > MAX_BOARD_ASSET_IMPORT_BYTES) {
        return { kind: 'rejected', reason: 'tooLarge' };
      }

      const assetId =
        'managed-' + dependencies.digest(JSON.stringify([boardId, actorId, commandId]));
      const asset = await dependencies.prepareAsset(boardId, assetId, content);
      if (!asset) {
        return { kind: 'rejected', reason: 'invalidMedia' };
      }

      return requireOwnerResult(
        port.importBoardAsset(actorId, boardId, assetId, dependencies.digest(content), asset),
      );
    },
    deleteBoardAsset(actorId: string, boardId: string, assetId: string) {
      requireAssetId(boardId);
      requireAssetId(assetId);

      return requireOwnerResult(port.deleteBoardAsset(actorId, boardId, assetId));
    },
  };
}

export type ArchiveImportApplication = ReturnType<typeof createArchiveImportApplication>;
