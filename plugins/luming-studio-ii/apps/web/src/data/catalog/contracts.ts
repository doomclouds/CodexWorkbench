export type CatalogSortOrder = 'recent' | 'title';

export interface CatalogBoardSummary {
  readonly boardId: string;
  readonly title: string;
  readonly updatedAtMillis?: bigint;
  readonly pinned: boolean;
  readonly entryVersion: bigint;
  readonly canManage?: boolean;
}

export interface CatalogListRequest {
  readonly query: string;
  readonly order: CatalogSortOrder;
  readonly pageSize: number;
  readonly cursor?: string;
}

export interface CatalogPage {
  readonly boards: readonly CatalogBoardSummary[];
  readonly nextCursor?: string;
}

export interface CatalogCreateRequest {
  readonly commandId: string;
  readonly title: string;
}

export interface CatalogDuplicateRequest {
  readonly commandId: string;
  readonly sourceBoardId: string;
}

export type CatalogRejectionReason =
  | 'invalidTitle'
  | 'commandIdReuse'
  | 'forbidden'
  | 'entryVersionChanged'
  | 'stateChanged'
  | 'invalidCommand'
  | 'unknown';

export type CatalogReceipt =
  | { readonly kind: 'created'; readonly commandId: string; readonly board: CatalogBoardSummary }
  | {
      readonly kind: 'rejected';
      readonly commandId: string;
      readonly reason: CatalogRejectionReason;
    };

export type CatalogPost = (
  path: string,
  body: Uint8Array,
  signal?: AbortSignal,
) => Promise<Uint8Array>;

export interface BoardCatalogService {
  listBoards(request: CatalogListRequest, signal?: AbortSignal): Promise<CatalogPage>;
  createBoard(request: CatalogCreateRequest, signal?: AbortSignal): Promise<CatalogReceipt>;
  duplicateBoard?(request: CatalogDuplicateRequest, signal?: AbortSignal): Promise<CatalogReceipt>;
  getReceipt(commandId: string, signal?: AbortSignal): Promise<CatalogReceipt | undefined>;
}

export interface TrashedBoardSummary {
  readonly board: CatalogBoardSummary;
  readonly trashedAtMillis: bigint;
}

export interface TrashedCatalogPage {
  readonly boards: readonly TrashedBoardSummary[];
  readonly nextCursor?: string;
}

type CatalogManageOperation =
  | { readonly kind: 'rename'; readonly title: string }
  | { readonly kind: 'pin'; readonly pinned: boolean }
  | { readonly kind: 'trash' }
  | { readonly kind: 'restore' };

export interface CatalogManageRequest {
  readonly commandId: string;
  readonly boardId: string;
  readonly expectedEntryVersion: bigint;
  readonly operation: CatalogManageOperation;
}

export interface CatalogPurgeTarget {
  readonly boardId: string;
  readonly expectedEntryVersion: bigint;
}

export interface CatalogPurgeRequest {
  readonly commandId: string;
  readonly targets: readonly CatalogPurgeTarget[];
}

export type CatalogManagementRejectionReason = CatalogRejectionReason;

export type CatalogPurgeItemResult =
  | { readonly boardId: string; readonly deleted: true }
  | {
      readonly boardId: string;
      readonly deleted: false;
      readonly reason: CatalogManagementRejectionReason;
    };

export type CatalogManagementReceipt =
  | { readonly kind: 'changed'; readonly commandId: string; readonly board: CatalogBoardSummary }
  | {
      readonly kind: 'purged';
      readonly commandId: string;
      readonly items: readonly CatalogPurgeItemResult[];
    }
  | {
      readonly kind: 'rejected';
      readonly commandId: string;
      readonly reason: CatalogManagementRejectionReason;
    };

export interface CatalogManagementService {
  listTrashedBoards(request: CatalogListRequest, signal?: AbortSignal): Promise<TrashedCatalogPage>;
  manageBoard(
    request: CatalogManageRequest,
    signal?: AbortSignal,
  ): Promise<CatalogManagementReceipt>;
  purgeBoards(
    request: CatalogPurgeRequest,
    signal?: AbortSignal,
  ): Promise<CatalogManagementReceipt>;
  getReceipt(
    commandId: string,
    signal?: AbortSignal,
  ): Promise<CatalogManagementReceipt | undefined>;
}
