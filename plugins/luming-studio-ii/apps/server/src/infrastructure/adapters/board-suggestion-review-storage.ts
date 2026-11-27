import type {
  BoardChanges,
  BoardSuggestionApplicationState,
  BoardSuggestionClock,
  BoardSuggestionObjectClocks,
  BoardSuggestionReviewState,
  PayloadRecord,
} from '../../modules/whiteboard/ports/index.js';
import { decodeReceiptObject } from './board-object-storage.js';
import {
  decodeJson,
  decodePayload,
  storedArray,
  storedBool,
  storedDecimalVersion,
  storedRecord,
  storedText,
} from './stored-values.js';

function storedIds(value: unknown, field: string): readonly string[] | undefined {
  return value === undefined
    ? undefined
    : storedArray(value, field).map((id) => storedText(id, field));
}

function storedPayload(value: unknown): PayloadRecord {
  const { objectId, payloadVersion, bodyKind, data } = storedRecord(
    value,
    'saved_suggestion_payload',
  );

  return {
    objectId: storedText(objectId, 'object_id'),
    payloadVersion: storedDecimalVersion(payloadVersion, 'payload_version'),
    bodyKind: storedText(bodyKind, 'body_kind'),
    data: decodePayload(JSON.stringify(data)),
  };
}

function storedInverse(value: unknown): BoardChanges {
  const { objects, removedObjectIds, payloads, removedPayloadObjectIds, order } = storedRecord(
    value,
    'suggestion_inverse',
  );

  return {
    kind: 'changes',
    objects:
      objects === undefined
        ? undefined
        : storedArray(objects, 'inverse_objects').map(decodeReceiptObject),
    removedObjectIds: storedIds(removedObjectIds, 'inverse_removed_ids'),
    payloads:
      payloads === undefined
        ? undefined
        : storedArray(payloads, 'inverse_payloads').map(storedPayload),
    removedPayloadObjectIds: storedIds(removedPayloadObjectIds, 'inverse_removed_payload_ids'),
    order: storedIds(order, 'inverse_order'),
  };
}

function storedApplication(value: unknown): BoardSuggestionApplicationState {
  const data = storedRecord(value, 'suggestion_application');
  const footprint = storedRecord(data.footprint, 'suggestion_application_footprint');

  return {
    optionId: storedText(data.optionId, 'applied_option'),
    boardRevision: storedDecimalVersion(data.boardRevision, 'application_board_revision'),
    baselineBoardRevision: storedDecimalVersion(
      data.baselineBoardRevision,
      'application_baseline_revision',
    ),
    footprint: {
      objectIds: storedIds(footprint.objectIds, 'application_objects') ?? [],
      payloadIds: storedIds(footprint.payloadIds, 'application_payloads'),
      editsOrder: storedBool(footprint.editsOrder, 'application_order'),
    },
    inverse: storedInverse(data.inverse),
    afterFingerprint: storedText(data.afterFingerprint, 'application_after_fingerprint'),
  };
}

function storedClock(value: unknown): BoardSuggestionClock | undefined {
  if (value === undefined) {
    return undefined;
  }

  const clock = storedRecord(value, 'suggestion_clock');

  return {
    physical: storedDecimalVersion(clock.physical, 'physical_clock'),
    logical: storedDecimalVersion(clock.logical, 'logical_clock'),
  };
}

function storedObjectClock(value: unknown): BoardSuggestionObjectClocks {
  const { objectId, geometry, payload } = storedRecord(value, 'suggestion_object_clock');

  return {
    objectId: storedText(objectId, 'object_id'),
    geometry: storedClock(geometry),
    payload: storedClock(payload),
  };
}

export function decodeSuggestionReview(json: unknown): BoardSuggestionReviewState | undefined {
  if (json === null) {
    return undefined;
  }

  const { applications, objectClocks, boardClock } = storedRecord(
    decodeJson(json, 'suggestion_review_json'),
    'suggestion_review',
  );

  return {
    applications: storedArray(applications, 'suggestion_applications').map(storedApplication),
    objectClocks: storedArray(objectClocks, 'suggestion_object_clocks').map(storedObjectClock),
    boardClock: storedClock(boardClock),
  };
}

export function encodeSuggestionReview(review: BoardSuggestionReviewState): string {
  return JSON.stringify(review, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}
