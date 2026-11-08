export class LibraryError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, retryable = false, details?: Record<string, unknown>) {
    super(message);
    this.name = 'LibraryError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export function asLibraryError(error: unknown): LibraryError {
  if (error instanceof LibraryError) return error;
  return new LibraryError('UPSTREAM_FAILED', error instanceof Error ? error.message : '上游操作失败。');
}
