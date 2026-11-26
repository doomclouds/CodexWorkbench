import type {
  CatalogBoardSummary,
  CatalogCreatedReceipt,
  CatalogPosition,
  CatalogScope,
} from '../domain/index.js';

export type {
  CatalogBoardSummary,
  CatalogCreatedReceipt,
  CatalogOrder,
  CatalogPosition,
} from '../domain/index.js';

export interface CatalogLookup extends CatalogScope {
  readonly limit: number;
  readonly after?: CatalogPosition;
}

export interface CatalogCreation {
  getReceipt(actorId: string, commandId: string): CatalogCreatedReceipt | undefined;
  saveBoard(actorId: string, receipt: CatalogCreatedReceipt): void;
}

export interface CatalogRepository {
  listBoards(lookup: CatalogLookup): readonly CatalogBoardSummary[];
  getReceipt(actorId: string, commandId: string): CatalogCreatedReceipt | undefined;
  write<T>(work: (creation: CatalogCreation) => T): T;
}
