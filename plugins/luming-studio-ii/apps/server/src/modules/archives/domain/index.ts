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

export function isArchiveIdentifier(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}
