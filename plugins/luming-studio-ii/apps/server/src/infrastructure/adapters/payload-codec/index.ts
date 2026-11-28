import { fromJson, type JsonObject } from '@bufbuild/protobuf';
import { ObjectPayloadSchema } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';

interface StoredObjectPayload {
  readonly bodyKind: string;
  readonly data: JsonObject;
  readonly payloadVersion: bigint;
}

export function parseStoredObjectPayload({ bodyKind, data, payloadVersion }: StoredObjectPayload) {
  const payload = fromJson(ObjectPayloadSchema, {
    [bodyKind]: data,
    payloadVersion: payloadVersion.toString(),
  });

  if (payload.body.case !== bodyKind) {
    throw new Error('Stored object payload does not match its Protobuf body');
  }

  return payload;
}
