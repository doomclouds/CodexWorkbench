import type {
  CatalogBoardSummary,
  CatalogCreatedReceipt,
  CatalogManagedBoard,
  CatalogManagementReceipt,
  CatalogPosition,
  CatalogReceipt,
  CatalogScope,
  CatalogThumbnail,
  CatalogThumbnailRequest,
  CatalogThumbnailResult,
  CatalogThumbnailScene,
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
  CatalogThumbnail,
  CatalogThumbnailObject,
  CatalogThumbnailRequest,
  CatalogThumbnailResult,
  CatalogThumbnailScene,
  CatalogTrashedBoard,
} from '../domain/index.js';

export interface CatalogLookup extends CatalogScope {
  readonly limit: number;
  readonly after?: CatalogPosition;
  readonly offset?: number;
}

export interface StoredCatalogReceipt {
  readonly receipt: CatalogReceipt;
  readonly signature?: string;
  readonly duplicateSourceId?: string;
}

export interface CatalogThumbnailLookup extends CatalogThumbnailRequest {
  readonly actorId: string;
}

export type CatalogThumbnailRead =
  | CatalogThumbnailResult
  | { readonly kind: 'scene'; readonly scene: CatalogThumbnailScene };

export type CatalogDuplicateFailure = 'stateChanged' | 'invalidCommand';

export interface CatalogLifecycleChange {
  readonly actorId: string;
  readonly action: 'trash' | 'restore';
}

export interface CatalogWriter {
  getReceipt(actorId: string, commandId: string): StoredCatalogReceipt | undefined;
  saveBoard(actorId: string, receipt: CatalogCreatedReceipt): void;
  duplicateBoard(
    actorId: string,
    sourceBoardId: string,
    receipt: CatalogCreatedReceipt,
  ): CatalogDuplicateFailure | undefined;
  getManagedBoard(actorId: string, boardId: string): CatalogManagedBoard | undefined;
  changeBoard(board: CatalogManagedBoard, lifecycle?: CatalogLifecycleChange): void;
  deleteBoard(boardId: string): void;
  saveManagementReceipt(
    actorId: string,
    signature: string,
    receipt: CatalogManagementReceipt,
  ): void;
}

export interface WorkbenchPreferences {
  readonly layout?: 'grid' | 'list';
  readonly theme?: 'light' | 'dark';
  readonly pinnedOnly?: boolean;
}

export interface CatalogRepository {
  listBoards(lookup: CatalogLookup): readonly CatalogBoardSummary[];
  listTrashedBoards(lookup: CatalogLookup): readonly CatalogTrashedBoard[];
  readThumbnail(lookup: CatalogThumbnailLookup, cached?: CatalogThumbnail): CatalogThumbnailRead;
  getReceipt(actorId: string, commandId: string): CatalogReceipt | undefined;
  readPreferences(actorId: string): WorkbenchPreferences;
  updatePreferences(actorId: string, changes: WorkbenchPreferences): void;
  write<T>(work: (writer: CatalogWriter) => T): T;
}
