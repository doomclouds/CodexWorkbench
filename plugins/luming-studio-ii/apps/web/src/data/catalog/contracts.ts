export type CatalogSortOrder = 'recent' | 'title';

export interface CatalogBoardSummary {
  readonly boardId: string;
  readonly title: string;
  readonly updatedAtMillis?: bigint;
  readonly pinned: boolean;
  readonly entryVersion: bigint;
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

export type CatalogRejectionReason = 'invalidTitle' | 'commandIdReuse' | 'unknown';

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
  getReceipt(commandId: string, signal?: AbortSignal): Promise<CatalogReceipt | undefined>;
}
