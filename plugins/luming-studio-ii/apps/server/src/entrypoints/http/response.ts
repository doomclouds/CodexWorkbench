import type { ServerResponse } from 'node:http';

export const protobufContentType = 'application/protobuf';

export function sendStatus(response: ServerResponse, status: number): void {
  if (status === 413) {
    response.setHeader('connection', 'close');
  }

  response.writeHead(status, { 'cache-control': 'no-store', 'content-length': 0 }).end();
}

export function sendProtobuf(response: ServerResponse, result: Uint8Array): void {
  response.writeHead(200, {
    'content-type': protobufContentType,
    'content-length': result.byteLength,
    'cache-control': 'no-store',
  });
  response.end(result);
}
