export type CatalogOrder = 'recent' | 'title';

export interface CatalogBoardSummary {
  readonly boardId: string;
  readonly title: string;
  readonly updatedAtMillis?: bigint;
  readonly pinned: boolean;
  readonly entryVersion: bigint;
  readonly canManage: boolean;
}

export interface CatalogManagedBoard {
  readonly board: CatalogBoardSummary;
  readonly trashedAtMillis?: bigint;
}

export interface CatalogTrashedBoard {
  readonly board: CatalogBoardSummary;
  readonly trashedAtMillis: bigint;
}

export interface CatalogCreatedReceipt {
  readonly kind: 'created';
  readonly commandId: string;
  readonly board: CatalogBoardSummary;
}

export interface CatalogRejectedReceipt {
  readonly kind: 'rejected';
  readonly commandId: string;
  readonly reason: CatalogRejectionReason;
}

export type CatalogRejectionReason =
  | 'invalidTitle'
  | 'commandIdReuse'
  | 'forbidden'
  | 'entryVersionChanged'
  | 'stateChanged'
  | 'invalidCommand';

export interface CatalogChangedReceipt {
  readonly kind: 'changed';
  readonly commandId: string;
  readonly board: CatalogBoardSummary;
}

export type CatalogPurgeItem =
  | { readonly boardId: string; readonly deleted: true }
  | { readonly boardId: string; readonly deleted: false; readonly reason: CatalogRejectionReason };

export interface CatalogPurgedReceipt {
  readonly kind: 'purged';
  readonly commandId: string;
  readonly items: readonly CatalogPurgeItem[];
}

export type CatalogManagementReceipt =
  | CatalogChangedReceipt
  | CatalogPurgedReceipt
  | CatalogRejectedReceipt;

export type CatalogReceipt = CatalogCreatedReceipt | CatalogManagementReceipt;

export type CatalogPosition = Pick<
  CatalogBoardSummary,
  'boardId' | 'title' | 'updatedAtMillis' | 'pinned'
> & { readonly trashedAtMillis?: bigint };

export interface CatalogScope {
  readonly actorId: string;
  readonly query: string;
  readonly order: CatalogOrder;
  readonly view?: 'trash';
}

const maxTitleLength = 200;
const defaultBoardTitle = '未命名白板';
const invalidTitleCharacters = /[\p{Cc}\p{Cs}]/u;

export function normalizeBoardTitle(title: string): string | undefined {
  const normalized = title.trim();
  if (normalized.length > maxTitleLength || invalidTitleCharacters.test(normalized)) {
    return undefined;
  }

  return normalized || defaultBoardTitle;
}

export function catalogTimestamp(now: number): bigint {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('The clock returned an invalid catalog timestamp.');
  }

  return BigInt(now);
}
