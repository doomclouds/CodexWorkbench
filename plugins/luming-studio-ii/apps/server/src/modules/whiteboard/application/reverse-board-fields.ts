import { canAdvanceVersion, type BoardObject, type PayloadRecord } from '../domain/index.js';

const objectFields = [
  'kind',
  'label',
  'locked',
  'parentId',
  'groupId',
  'appearance',
  'detail',
] as const;
const geometryFields = ['x', 'y', 'width', 'height', 'rotation'] as const;

export function sameReversalValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function sameObjectContent(left: BoardObject, right: BoardObject) {
  return (
    sameReversalValue(left.geometry, right.geometry) &&
    objectFields.every((field) => sameReversalValue(left[field], right[field]))
  );
}

export function nextObjectClock(revision: bigint, ...clocks: readonly (bigint | undefined)[]) {
  const latest = clocks.reduce<bigint>(
    (maximum, clock) => (clock !== undefined && clock > maximum ? clock : maximum),
    revision,
  );

  return canAdvanceVersion(latest) ? latest + 1n : undefined;
}

function reverseFields<T, Field extends keyof T>(
  current: T,
  expected: T,
  desired: T,
  fields: readonly Field[],
): Partial<T> | undefined {
  const changes: Partial<T> = {};
  for (const field of fields) {
    if (sameReversalValue(expected[field], desired[field])) {
      continue;
    }
    if (!sameReversalValue(current[field], expected[field])) {
      return undefined;
    }

    changes[field] = desired[field];
  }

  return changes;
}

export function reverseObjectFields(
  current: BoardObject,
  expected: BoardObject,
  desired: BoardObject,
) {
  const fields = reverseFields(current, expected, desired, objectFields);
  const geometry = reverseFields(
    current.geometry,
    expected.geometry,
    desired.geometry,
    geometryFields,
  );

  if (!fields || !geometry) {
    return undefined;
  }

  return { ...current, ...fields, geometry: { ...current.geometry, ...geometry } };
}

export function samePayloadContent(
  left: PayloadRecord | undefined,
  right: PayloadRecord | undefined,
) {
  return left?.bodyKind === right?.bodyKind && sameReversalValue(left?.data, right?.data);
}
