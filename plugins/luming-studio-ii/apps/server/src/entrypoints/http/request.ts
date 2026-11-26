import { Buffer } from 'node:buffer';
import type { IncomingMessage } from 'node:http';
import { fromBinary, type DescMessage, type MessageShape } from '@bufbuild/protobuf';

const MAX_REQUEST_BYTES = 1024 * 1024;

export class HttpRequestError extends Error {
  constructor(
    readonly status: 400 | 413,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function mediaType(request: IncomingMessage): string | undefined {
  return request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
}

function requireBodySize(bytes: number, limit: number): void {
  if (bytes > limit) {
    throw new HttpRequestError(413, 'Protobuf request exceeds the size limit');
  }
}

export async function readBody(
  request: IncomingMessage,
  limit = MAX_REQUEST_BYTES,
): Promise<Uint8Array> {
  requireBodySize(Number(request.headers['content-length'] ?? 0), limit);

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of request.iterator({ destroyOnReturn: false })) {
    const chunk: unknown = value;
    if (!Buffer.isBuffer(chunk)) {
      throw new TypeError('Expected binary HTTP request chunks');
    }

    bytes += chunk.byteLength;
    requireBodySize(bytes, limit);
    chunks.push(chunk);
  }

  return Buffer.concat(chunks, bytes);
}

export function decodeRequest<Schema extends DescMessage>(
  schema: Schema,
  body: Uint8Array,
): MessageShape<Schema> {
  try {
    return fromBinary(schema, body, { readUnknownFields: false });
  } catch (error) {
    throw new HttpRequestError(400, 'Malformed Protobuf request', { cause: error });
  }
}

export function requireId(value: string): string {
  if (!value.trim()) {
    throw new HttpRequestError(400, 'Request identifier is required');
  }

  return value;
}
