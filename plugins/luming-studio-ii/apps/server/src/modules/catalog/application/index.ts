import { catalogTimestamp, normalizeBoardTitle } from '../domain/index.js';
import type {
  CatalogBoardSummary,
  CatalogCreatedReceipt,
  CatalogOrder,
  CatalogReceipt,
  CatalogScope,
  CatalogThumbnailRequest,
  CatalogThumbnailResult,
  CatalogTrashedBoard,
} from '../domain/index.js';
import type { CatalogLookup, CatalogRepository } from '../ports/index.js';
import { createCatalogThumbnailReader } from './catalog-thumbnail.js';
import { CatalogQueryError, readCatalogCursor, writeCatalogCursor } from './cursor.js';
import { duplicateBoard, type DuplicateBoardCommand } from './duplicate-board.js';
import {
  manageBoard,
  purgeBoards,
  type ManageBoardCommand,
  type PurgeBoardsCommand,
} from './management.js';

export { CatalogQueryError } from './cursor.js';
export type { DuplicateBoardCommand } from './duplicate-board.js';
export type {
  CatalogBoardSummary,
  CatalogReceipt,
  CatalogRejectionReason,
  CatalogTrashedBoard,
} from '../domain/index.js';
export type { ManageBoardCommand, PurgeBoardsCommand } from './management.js';

export interface CatalogActor {
  readonly id: string;
}

export interface CatalogListRequest {
  readonly query: string;
  readonly order: CatalogOrder;
  readonly pageSize: number;
  readonly cursor?: string;
  readonly pinnedOnly?: boolean;
}

export interface CatalogPage {
  readonly boards: readonly CatalogBoardSummary[];
  readonly nextCursor?: string;
}

export interface CatalogTrashPage {
  readonly boards: readonly CatalogTrashedBoard[];
  readonly nextCursor?: string;
}

export interface CreateBoardCommand {
  readonly commandId: string;
  readonly title: string;
}

export interface CatalogApplication {
  listBoards(actor: CatalogActor, request: CatalogListRequest): CatalogPage;
  listTrashedBoards(actor: CatalogActor, request: CatalogListRequest): CatalogTrashPage;
  getBoardThumbnail(actor: CatalogActor, request: CatalogThumbnailRequest): CatalogThumbnailResult;
  createBoard(actor: CatalogActor, command: CreateBoardCommand): CatalogReceipt;
  duplicateBoard(actor: CatalogActor, command: DuplicateBoardCommand): CatalogReceipt;
  manageBoard(actor: CatalogActor, command: ManageBoardCommand): CatalogReceipt;
  purgeBoards(actor: CatalogActor, command: PurgeBoardsCommand): CatalogReceipt;
  getReceipt(actor: CatalogActor, commandId: string): CatalogReceipt | undefined;
}

interface CatalogServices {
  readonly newBoardId: () => string;
  readonly now: () => number;
}

const maxQueryLength = 200;
const maxPageSize = 100;
const initialEntryVersion = 1n;

function catalogLookup(
  actor: CatalogActor,
  request: CatalogListRequest,
  view?: CatalogScope['view'],
): CatalogLookup {
  const { order, pageSize, cursor } = request;
  const query = request.query.trim();
  if (query.length > maxQueryLength) {
    throw new CatalogQueryError('The catalog search query is too long.');
  }
  if (order !== 'recent' && order !== 'title') {
    throw new CatalogQueryError('The catalog sort order is invalid.');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > maxPageSize) {
    throw new CatalogQueryError('The catalog page size is out of range.');
  }

  const scope = { actorId: actor.id, query, order, view };
  const pinnedScope =
    view === undefined && request.pinnedOnly ? { ...scope, pinnedOnly: true } : scope;
  const after = cursor === undefined ? undefined : readCatalogCursor(cursor, pinnedScope);

  return { ...pinnedScope, limit: pageSize + 1, after };
}

function listBoards(
  repository: CatalogRepository,
  actor: CatalogActor,
  request: CatalogListRequest,
): CatalogPage {
  const { pageSize } = request;
  const lookup = catalogLookup(actor, request);
  const found = repository.listBoards(lookup);
  const boards = found.slice(0, pageSize);
  const lastBoard = boards.at(-1);
  const nextCursor =
    lastBoard && found.length > pageSize ? writeCatalogCursor(lookup, lastBoard) : undefined;

  return { boards, nextCursor };
}

function listTrashedBoards(
  repository: CatalogRepository,
  actor: CatalogActor,
  request: CatalogListRequest,
): CatalogTrashPage {
  const { pageSize } = request;
  const lookup = catalogLookup(actor, request, 'trash');
  const found = repository.listTrashedBoards(lookup);
  const boards = found.slice(0, pageSize);
  const lastBoard = boards.at(-1);
  const nextCursor =
    lastBoard && found.length > pageSize
      ? writeCatalogCursor(lookup, {
          ...lastBoard.board,
          trashedAtMillis: lastBoard.trashedAtMillis,
        })
      : undefined;

  return { boards, nextCursor };
}

function newBoard(
  services: CatalogServices,
  commandId: string,
  title: string,
): CatalogCreatedReceipt {
  return {
    kind: 'created',
    commandId,
    board: {
      boardId: services.newBoardId(),
      title,
      updatedAtMillis: catalogTimestamp(services.now()),
      pinned: false,
      entryVersion: initialEntryVersion,
      canManage: true,
    },
  };
}

function createBoard(
  repository: CatalogRepository,
  services: CatalogServices,
  actor: CatalogActor,
  command: CreateBoardCommand,
): CatalogReceipt {
  const { commandId } = command;
  const title = normalizeBoardTitle(command.title);

  return repository.write((creation) => {
    const stored = creation.getReceipt(actor.id, commandId);
    if (stored) {
      const { receipt, duplicateSourceId } = stored;
      return duplicateSourceId === undefined &&
        receipt.kind === 'created' &&
        receipt.board.title === title
        ? receipt
        : { kind: 'rejected', commandId, reason: 'commandIdReuse' };
    }
    if (title === undefined) {
      return { kind: 'rejected', commandId, reason: 'invalidTitle' };
    }

    const created = newBoard(services, commandId, title);
    creation.saveBoard(actor.id, created);

    return created;
  });
}

export function createCatalogApplication(
  repository: CatalogRepository,
  services: CatalogServices,
): CatalogApplication {
  const readThumbnail = createCatalogThumbnailReader(repository);

  return {
    listBoards: (actor, request) => listBoards(repository, actor, request),
    listTrashedBoards: (actor, request) => listTrashedBoards(repository, actor, request),
    getBoardThumbnail: (actor, request) => readThumbnail(actor.id, request),
    createBoard: (actor, command) => createBoard(repository, services, actor, command),
    duplicateBoard: (actor, command) =>
      duplicateBoard(repository, actor.id, command, (commandId, title) =>
        newBoard(services, commandId, title),
      ),
    manageBoard: (actor, command) => manageBoard(repository, actor.id, command, services.now),
    purgeBoards: (actor, command) => purgeBoards(repository, actor.id, command),
    getReceipt: (actor, commandId) => repository.getReceipt(actor.id, commandId),
  };
}
