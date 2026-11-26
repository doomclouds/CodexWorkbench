import {
  canAdvanceVersion,
  type Actor,
  type BoardEditDecision,
  type BoardEditIdentity,
  type BoardEditReceipt,
  type BoardHeader,
  type BoardScene,
  type BoardVersionSummary,
  type ExportBoardCommand,
  type ExportBoardResult,
  type PayloadResult,
} from '../domain/index.js';
import type {
  BoardEditReader,
  BoardEditRepository,
  WhiteboardReader,
  WhiteboardRepository,
} from '../ports/index.js';
import { payloadResult, requireAccess, WhiteboardAccessError } from './board-read.js';
import { planBoardRestore } from './board-restore.js';
import { executeBoardExport } from './export-board.js';
import { runBoardEdit } from './run-board-edit.js';

export interface BoardHistoryPage {
  readonly currentRevision: bigint;
  readonly versions: readonly BoardVersionSummary[];
  readonly nextBeforeRevision?: bigint;
}

export interface RestoreBoardVersionCommand extends BoardEditIdentity {
  readonly revision: bigint;
  readonly expectedCurrentRevision: bigint;
  readonly scope: ExportBoardCommand['scope'];
}

export type BoardVersionExportResult =
  | Exclude<ExportBoardResult, { kind: 'stale' }>
  | { readonly kind: 'unavailable' };

export interface BoardHistoryApplication {
  listVersions(actor: Actor, boardId: string, before?: bigint, limit?: number): BoardHistoryPage;
  getVersionScene(actor: Actor, boardId: string, revision: bigint): BoardScene | undefined;
  getVersionPayloads(
    actor: Actor,
    boardId: string,
    revision: bigint,
    objectIds: readonly string[],
  ): readonly PayloadResult[] | undefined;
  restoreVersion(
    actor: Actor,
    command: RestoreBoardVersionCommand,
    signature: string,
  ): BoardEditReceipt;
  exportVersion(actor: Actor, command: ExportBoardCommand): BoardVersionExportResult;
}

const defaultPageSize = 20;
const maxPageSize = 50;

class UnavailableBoardVersion extends Error {}

function currentBoard(reader: WhiteboardReader, boardId: string): BoardHeader {
  const board = reader.getBoard(boardId);
  if (!board) {
    throw new WhiteboardAccessError();
  }

  return board;
}

function baseline({ title, revision }: BoardHeader): BoardVersionSummary {
  return { title, revision, kind: 'baseline', changedObjectCount: 0 };
}

function readVersion(reader: BoardEditReader, board: BoardHeader, revision: bigint) {
  if (revision < 0n || revision > board.revision) {
    return undefined;
  }

  return (
    reader.getVersion(board.boardId, revision) ??
    (revision === board.revision ? baseline(board) : undefined)
  );
}

function versionPage(
  reader: BoardEditReader,
  board: BoardHeader,
  before: bigint | undefined,
  limit: number,
): BoardHistoryPage {
  const earlierThan = before !== undefined && before <= board.revision ? before : undefined;
  const found = reader.listVersions(board.boardId, earlierThan, limit + 1);
  const versions = found.length === 0 && earlierThan === undefined ? [baseline(board)] : found;
  const page = versions.slice(0, limit);

  return {
    currentRevision: board.revision,
    versions: page,
    nextBeforeRevision: versions.length > limit ? page.at(-1)?.revision : undefined,
  };
}

function readonlySnapshotReader(reader: BoardEditReader, revision: bigint): WhiteboardReader {
  return {
    getAccess: (boardId, actorId) => reader.getAccess(boardId, actorId),
    getBoard(boardId) {
      const version = readVersion(reader, currentBoard(reader, boardId), revision);
      if (!version) {
        throw new UnavailableBoardVersion('The saved board version is no longer available');
      }

      return { boardId, title: version.title, revision };
    },
    listObjects: (boardId, limit) => reader.listVersionObjects(boardId, revision).slice(0, limit),
    getObjects: (boardId, ids) => reader.listVersionObjects(boardId, revision, ids),
    getPayloads: (boardId, ids) => reader.getVersionPayloads(boardId, revision, ids),
    getExportAsset: (boardId, assetId, maximumBytes) =>
      reader.getExportAsset?.(boardId, assetId, maximumBytes),
    getReceipt: (boardId, actorId, commandId) => reader.getReceipt(boardId, actorId, commandId),
  };
}

function exportSavedVersion(
  repository: BoardEditRepository,
  actor: Actor,
  command: ExportBoardCommand,
): BoardVersionExportResult {
  const snapshot: WhiteboardRepository = {
    read: (work) =>
      repository.read((reader) => work(readonlySnapshotReader(reader, command.expectedRevision))),
    write: (work) => repository.write(work),
  };

  try {
    const result = executeBoardExport(snapshot, actor, command, requireAccess, (reader) =>
      currentBoard(reader, command.boardId),
    );

    return result.kind === 'stale' ? { kind: 'unavailable' } : result;
  } catch (error) {
    if (error instanceof UnavailableBoardVersion) {
      return { kind: 'unavailable' };
    }

    throw error;
  }
}

function restorePlan(
  reader: BoardEditReader,
  board: BoardHeader,
  { expectedCurrentRevision, revision, scope }: RestoreBoardVersionCommand,
): BoardEditDecision {
  if (expectedCurrentRevision !== board.revision) {
    return { kind: 'conflict', boardRevision: board.revision };
  }
  if (!canAdvanceVersion(board.revision) || !readVersion(reader, board, revision)) {
    return { kind: 'rejected', reason: 'versionUnavailable' };
  }

  return planBoardRestore(reader, board, revision, scope);
}

export function createBoardHistoryApplication(
  repository: BoardEditRepository,
  now: () => number,
): BoardHistoryApplication {
  return {
    listVersions(actor, boardId, before, limit = defaultPageSize) {
      return repository.read((reader) => {
        requireAccess(reader, actor, boardId);
        const pageSize = Math.max(1, Math.min(maxPageSize, limit || defaultPageSize));

        return versionPage(reader, currentBoard(reader, boardId), before, pageSize);
      });
    },
    getVersionScene(actor, boardId, revision) {
      return repository.read((reader) => {
        requireAccess(reader, actor, boardId);
        const version = readVersion(reader, currentBoard(reader, boardId), revision);
        if (!version) {
          return undefined;
        }

        return {
          board: { boardId, title: version.title, revision },
          access: { canEdit: false },
          objects: reader.listVersionObjects(boardId, revision),
        };
      });
    },
    getVersionPayloads(actor, boardId, revision, objectIds) {
      return repository.read((reader) => {
        requireAccess(reader, actor, boardId);
        if (!readVersion(reader, currentBoard(reader, boardId), revision)) {
          return undefined;
        }

        const rows = reader.getVersionPayloads(boardId, revision, [...new Set(objectIds)]);
        const byId = new Map(rows.map((row) => [row.objectId, row]));

        return objectIds.map((id) => payloadResult(id, byId.get(id)));
      });
    },
    restoreVersion(actor, command, signature) {
      const { boardId, commandId, revision } = command;
      const commit = {
        signature,
        kind: 'restore',
        savedAtMillis: now(),
        sourceRevision: revision,
      } as const;

      return runBoardEdit(repository, actor, { boardId, commandId }, commit, (writer, board) =>
        restorePlan(writer, board, command),
      );
    },
    exportVersion(actor, command) {
      return exportSavedVersion(repository, actor, command);
    },
  };
}
