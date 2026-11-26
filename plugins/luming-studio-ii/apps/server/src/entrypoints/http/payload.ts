import { create, fromJson } from '@bufbuild/protobuf';
import { ObjectPayloadSchema } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';
import {
  ObjectPayloadResultSchema,
  ObjectPayloadUnavailableReason,
  type ObjectPayloadResult,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import type { PayloadResult } from '../../modules/whiteboard/application/index.js';

export function toPayloadResult(result: PayloadResult): ObjectPayloadResult {
  if (result.kind === 'unavailable') {
    const reason =
      result.reason === 'notFound'
        ? ObjectPayloadUnavailableReason.NOT_FOUND
        : ObjectPayloadUnavailableReason.UNSUPPORTED_KIND;

    return create(ObjectPayloadResultSchema, {
      objectId: result.objectId,
      result: { case: 'unavailable', value: { reason } },
    });
  }

  const { objectId, bodyKind, data, payloadVersion } = result.payload;
  const payload = fromJson(ObjectPayloadSchema, {
    [bodyKind]: data,
    payloadVersion: payloadVersion.toString(),
  });

  if (payload.body.case !== bodyKind) {
    throw new Error('Stored object payload does not match its Protobuf body');
  }

  return create(ObjectPayloadResultSchema, {
    objectId,
    result: { case: 'payload', value: payload },
  });
}
