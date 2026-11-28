type BridgeCode =
  | 'SESSION_EXPIRED'
  | 'INVALID_ARGUMENT'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'COMMIT_RESULT_UNKNOWN'
  | 'TOO_LARGE'
  | 'UNAVAILABLE';

export class BridgeError extends Error {
  constructor(
    readonly code: BridgeCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function invalidArgument(message: string): BridgeError {
  return new BridgeError('INVALID_ARGUMENT', message);
}

export function tooLarge(message: string): BridgeError {
  return new BridgeError('TOO_LARGE', message);
}
