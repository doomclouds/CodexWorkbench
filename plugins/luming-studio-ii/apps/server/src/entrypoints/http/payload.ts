import { create } from '@bufbuild/protobuf';
import {
  ObjectPayloadResultSchema,
  ObjectPayloadUnavailableReason,
  type ObjectPayloadResult,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { parseStoredObjectPayload } from '../../infrastructure/adapters/payload-codec/index.js';
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

  return create(ObjectPayloadResultSchema, {
    objectId: result.payload.objectId,
    result: { case: 'payload', value: parseStoredObjectPayload(result.payload) },
  });
}
