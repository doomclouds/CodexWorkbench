export interface LocalRequest {
  readonly route: string;
  readonly method: 'GET' | 'POST';
  readonly mediaType?: string;
  readonly commandId?: string;
  readonly body?: Uint8Array | Blob;
}

export type DispatchLocalRequest = (
  request: LocalRequest,
  signal: AbortSignal,
) => Promise<Response>;
