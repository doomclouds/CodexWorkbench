export type ArchiveReadErrorCode =
  | 'invalidArchive'
  | 'unsupportedVersion'
  | 'incompatibleContent'
  | 'tooLarge';

export class ArchiveReadError extends Error {
  constructor(
    readonly code: ArchiveReadErrorCode,
    message: string,
    options?: ErrorOptions,
    readonly signature?: string,
  ) {
    super(message, options);
    this.name = 'ArchiveReadError';
  }
}

export function invalidArchive(message: string, options?: ErrorOptions): ArchiveReadError {
  return new ArchiveReadError('invalidArchive', message, options);
}

export function archiveTooLarge(): ArchiveReadError {
  return new ArchiveReadError('tooLarge', 'Archive exceeds its size or record limits');
}
