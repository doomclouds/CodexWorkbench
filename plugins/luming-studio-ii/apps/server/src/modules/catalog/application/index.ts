import { normalizeBoardTitle } from '../domain/index.js';
import type {
  CatalogBoardSummary,
  CatalogCreatedReceipt,
  CatalogOrder,
  CatalogReceipt,
} from '../domain/index.js';
import type { CatalogRepository } from '../ports/index.js';
import { CatalogQueryError, readCatalogCursor, writeCatalogCursor } from './cursor.js';

export { CatalogQueryError } from './cursor.js';
export type { CatalogBoardSummary, CatalogReceipt } from '../domain/index.js';

export interface CatalogActor {
  readonly id: string;
}

export interface CatalogListRequest {
  readonly query: string;
  readonly order: CatalogOrder;
  readonly pageSize: number;
  readonly cursor?: string;
}

export interface CatalogPage {
  readonly boards: readonly CatalogBoardSummary[];
  readonly nextCursor?: string;
}

export interface CreateBoardCommand {
  readonly commandId: string;
  readonly title: string;
}

export interface CatalogApplication {
  listBoards(actor: CatalogActor, request: CatalogListRequest): CatalogPage;
  createBoard(actor: CatalogActor, command: CreateBoardCommand): CatalogReceipt;
  getReceipt(actor: CatalogActor, commandId: string): CatalogReceipt | undefined;
}

interface CatalogServices {
  readonly newBoardId: () => string;
  readonly now: () => number;
}

const maxQueryLength = 200;
const maxPageSize = 100;
const initialEntryVersion = 1n;

function listBoards(
  repository: CatalogRepository,
  actor: CatalogActor,
  request: CatalogListRequest,
): CatalogPage {
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

  const scope = { actorId: actor.id, query, order };
  const after = cursor === undefined ? undefined : readCatalogCursor(cursor, scope);
  const found = repository.listBoards({ ...scope, limit: pageSize + 1, after });
  const boards = found.slice(0, pageSize);
  const lastBoard = boards.at(-1);
  const nextCursor =
    lastBoard && found.length > pageSize ? writeCatalogCursor(scope, lastBoard) : undefined;

  return { boards, nextCursor };
}

function creationTimestamp(now: number): bigint {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('The clock returned an invalid catalog timestamp.');
  }

  return BigInt(now);
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
      updatedAtMillis: creationTimestamp(services.now()),
      pinned: false,
      entryVersion: initialEntryVersion,
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
      return stored.board.title === title
        ? stored
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
  return {
    listBoards: (actor, request) => listBoards(repository, actor, request),
    createBoard: (actor, command) => createBoard(repository, services, actor, command),
    getReceipt: (actor, commandId) => repository.getReceipt(actor.id, commandId),
  };
}
