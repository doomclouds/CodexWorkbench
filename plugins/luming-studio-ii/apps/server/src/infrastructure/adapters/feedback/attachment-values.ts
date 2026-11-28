import type {
  FeedbackAttachment,
  FeedbackFrozenTarget,
  FeedbackSelectionTarget,
} from '../../../modules/feedback/ports/index.js';
import { readFinite, readText } from './stored-values.js';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fields(value: unknown): Record<string, unknown> {
  if (!record(value)) {
    throw new Error('Invalid stored feedback source.');
  }

  return value;
}

function version(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d{1,20}$/u.test(value)) {
    throw new Error('Invalid stored feedback source version.');
  }

  return BigInt(value);
}

function point(value: unknown) {
  const input = fields(value);

  return { x: readFinite(input.x, 'x'), y: readFinite(input.y, 'y') };
}

function bounds(value: unknown) {
  if (value !== undefined) {
    const input = fields(value);

    return {
      ...point(input),
      width: readFinite(input.width, 'width'),
      height: readFinite(input.height, 'height'),
    };
  }
}

function targetReference(value: unknown) {
  const input = fields(value);

  return {
    objectId: readText(input.objectId, 'object_id'),
    geometryVersion: version(input.geometryVersion),
    payloadVersion: input.payloadVersion === undefined ? undefined : version(input.payloadVersion),
  };
}

function frozenObject(value: unknown) {
  const input = fields(value);

  return {
    ...point(input),
    kind: readText(input.kind, 'kind'),
    label: readText(input.label, 'label'),
    width: readFinite(input.width, 'width'),
    height: readFinite(input.height, 'height'),
    rotation: readFinite(input.rotation, 'rotation'),
  };
}

export function feedbackJson(value: unknown): string | null {
  return value === undefined
    ? null
    : JSON.stringify(value, (_key, entry: unknown) =>
        typeof entry === 'bigint' ? entry.toString() : entry,
      );
}

export function readSelectionSnapshot(value: unknown): {
  readonly target: FeedbackSelectionTarget;
  readonly frozenTargets: readonly FeedbackFrozenTarget[];
} {
  const input = fields(JSON.parse(readText(value, 'selection_json')));
  const target = fields(input.target);
  if (target.kind !== 'selection' || !Array.isArray(input.frozenTargets)) {
    throw new Error('Invalid stored feedback selection.');
  }

  const frozenTargets = input.frozenTargets.map((entry: unknown) => {
    const source = fields(entry);

    return { reference: targetReference(source.reference), object: frozenObject(source.object) };
  });

  return {
    target: {
      kind: 'selection',
      point: point(target.point),
      bounds: bounds(target.bounds),
      expectedBoardRevision: version(target.expectedBoardRevision),
      objects: frozenTargets.map(({ reference }) => reference),
    },
    frozenTargets,
  };
}

export function readAttachment(value: unknown): FeedbackAttachment | undefined {
  if (value === null) {
    return;
  }

  const input = fields(JSON.parse(readText(value, 'attachment_json')));
  const { state, requestId, claimId, claimedAtMillis, threadVersion } = input;
  if (state !== 'pending' && state !== 'claimed' && state !== 'attached') {
    throw new Error('Invalid stored feedback attachment state.');
  }

  return {
    requestId: readText(requestId, 'request_id'),
    state,
    claimId: typeof claimId === 'string' ? claimId : undefined,
    claimedAtMillis: claimedAtMillis === undefined ? undefined : version(claimedAtMillis),
    threadVersion: version(threadVersion),
  };
}
