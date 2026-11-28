export type ArchiveImportRejectionReason =
  | 'invalidArchive'
  | 'unsupportedVersion'
  | 'incompatibleContent'
  | 'commandIdReuse'
  | 'tooLarge';

export type ArchiveImportOutcome =
  | { readonly kind: 'imported'; readonly boardId: string; readonly title: string }
  | { readonly kind: 'rejected'; readonly reason: ArchiveImportRejectionReason };

export interface ArchiveImportReceipt {
  readonly commandId: string;
  readonly outcome: ArchiveImportOutcome;
}

export interface ImportedArchiveAsset {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface BoardAssetReference {
  readonly assetId: string;
  readonly src: string;
  readonly mediaType: string;
  readonly byteLength: number;
}

export interface BoardAssetPage {
  readonly assets: readonly BoardAssetReference[];
  readonly nextCursor?: string;
}

export type BoardAssetRejection =
  | 'invalidMedia'
  | 'tooLarge'
  | 'commandIdReuse'
  | 'notFound'
  | 'referenceInUse';

export type BoardAssetImport =
  | { readonly kind: 'asset'; readonly asset: BoardAssetReference }
  | { readonly kind: 'rejected'; readonly reason: BoardAssetRejection };

export type BoardAssetRemoval =
  | { readonly kind: 'removed'; readonly assetId: string }
  | { readonly kind: 'rejected'; readonly reason: BoardAssetRejection };

export function isArchiveIdentifier(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}
