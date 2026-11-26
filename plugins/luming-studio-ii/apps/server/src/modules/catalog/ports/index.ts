import type {
  CatalogBoardSummary,
  CatalogCreatedReceipt,
  CatalogManagedBoard,
  CatalogManagementReceipt,
  CatalogPosition,
  CatalogReceipt,
  CatalogScope,
  CatalogTrashedBoard,
} from '../domain/index.js';

export type {
  CatalogBoardSummary,
  CatalogCreatedReceipt,
  CatalogManagedBoard,
  CatalogManagementReceipt,
  CatalogOrder,
  CatalogPosition,
  CatalogReceipt,
  CatalogRejectionReason,
  CatalogTrashedBoard,
} from '../domain/index.js';

export interface CatalogLookup extends CatalogScope {
  readonly limit: number;
  readonly after?: CatalogPosition;
}

export interface StoredCatalogReceipt {
  readonly receipt: CatalogReceipt;
  readonly signature?: string;
}

export interface CatalogWriter {
  getReceipt(actorId: string, commandId: string): StoredCatalogReceipt | undefined;
  saveBoard(actorId: string, receipt: CatalogCreatedReceipt): void;
  getManagedBoard(actorId: string, boardId: string): CatalogManagedBoard | undefined;
  changeBoard(board: CatalogManagedBoard): void;
  deleteBoard(boardId: string): void;
  saveManagementReceipt(
    actorId: string,
    signature: string,
    receipt: CatalogManagementReceipt,
  ): void;
}

export interface CatalogRepository {
  listBoards(lookup: CatalogLookup): readonly CatalogBoardSummary[];
  listTrashedBoards(lookup: CatalogLookup): readonly CatalogTrashedBoard[];
  getReceipt(actorId: string, commandId: string): CatalogReceipt | undefined;
  write<T>(work: (writer: CatalogWriter) => T): T;
}
