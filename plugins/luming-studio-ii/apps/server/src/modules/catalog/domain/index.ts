export type CatalogOrder = 'recent' | 'title';

export interface CatalogBoardSummary {
  readonly boardId: string;
  readonly title: string;
  readonly updatedAtMillis?: bigint;
  readonly pinned: boolean;
  readonly entryVersion: bigint;
}

export interface CatalogCreatedReceipt {
  readonly kind: 'created';
  readonly commandId: string;
  readonly board: CatalogBoardSummary;
}

export interface CatalogRejectedReceipt {
  readonly kind: 'rejected';
  readonly commandId: string;
  readonly reason: 'invalidTitle' | 'commandIdReuse';
}

export type CatalogReceipt = CatalogCreatedReceipt | CatalogRejectedReceipt;

export type CatalogPosition = Pick<
  CatalogBoardSummary,
  'boardId' | 'title' | 'updatedAtMillis' | 'pinned'
>;

export interface CatalogScope {
  readonly actorId: string;
  readonly query: string;
  readonly order: CatalogOrder;
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
