import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { request } from 'node:http';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { DescMessage, DescMethodUnary, MessageInitShape } from '@bufbuild/protobuf';

export const actorHeader = 'x-test-actor-id';
const contentType = 'application/protobuf';
const requestTimeoutMs = 5_000;

function whiteboardUrl(address: URL, method: DescMethodUnary): URL {
  return new URL('/' + method.parent.typeName + '/' + method.name, address);
}

export function sendWhiteboardRequest<Input extends DescMessage>(
  address: URL,
  actorId: string | undefined,
  method: DescMethodUnary<Input>,
  input: MessageInitShape<Input>,
): Promise<Response> {
  const headers = new Headers({ 'content-type': contentType });
  if (actorId) {
    headers.set(actorHeader, actorId);
  }

  return fetch(whiteboardUrl(address, method), {
    method: 'POST',
    headers,
    body: Buffer.from(toBinary(method.input, create(method.input, input))),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
}

export async function callWhiteboard<Input extends DescMessage, Output extends DescMessage>(
  address: URL,
  actorId: string,
  method: DescMethodUnary<Input, Output>,
  input: MessageInitShape<Input>,
) {
  const response = await sendWhiteboardRequest(address, actorId, method, input);
  assert.equal(response.status, 200, method.name);
  assert.equal(response.headers.get('content-type'), contentType);
  const wire = new Uint8Array(await response.arrayBuffer());

  return fromBinary(method.output, wire);
}

export function sendChunkedWhiteboardRequest(
  address: URL,
  actorId: string,
  method: DescMethodUnary,
  chunks: readonly Buffer[],
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      whiteboardUrl(address, method),
      {
        method: 'POST',
        headers: {
          'content-type': contentType,
          'transfer-encoding': 'chunked',
          [actorHeader]: actorId,
        },
        signal: AbortSignal.timeout(requestTimeoutMs),
      },
      (response) => {
        response.on('error', reject);
        response.on('end', () => resolve(response.statusCode));
        response.resume();
      },
    );
    outgoing.on('error', reject);
    for (const chunk of chunks) {
      outgoing.write(chunk);
    }

    outgoing.end();
  });
}
