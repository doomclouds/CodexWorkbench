import {
  canAdvanceVersion,
  objectAllowsStyle,
  styleChangesObjectKind,
  styledObject,
  styledText,
  styleTouchesObject,
  styleTouchesText,
  validStylePatch,
  type BoardEditDecision,
  type BoardObject,
  type GeometryOperation,
  type PayloadRecord,
} from '../domain/index.js';
import type { GeometryToolsScope } from './edit-geometry-tools.js';

type Style = Extract<GeometryOperation, { kind: 'style' }>;

const textKinds = new Set(['text', 'note', 'shape', 'section', 'connector']);

function textPayloads(
  scope: GeometryToolsScope,
  objects: readonly BoardObject[],
  { targets, patch }: Style,
): readonly PayloadRecord[] | BoardEditDecision {
  const ids = objects.map(({ objectId }) => objectId);
  const current = scope.writer.getPayloads(scope.board.boardId, ids);
  const bodies = new Map(current.map((payload) => [payload.objectId, payload]));
  const versions = new Map(
    targets.map(({ target, expectedPayloadVersion }) => [target.objectId, expectedPayloadVersion]),
  );

  const needsVersion = styleTouchesText(patch);
  const writesText = needsVersion || patch.label !== undefined;
  const updates: PayloadRecord[] = [];
  for (const object of objects) {
    const payload = bodies.get(object.objectId);
    if (!textKinds.has(object.kind)) {
      return { kind: 'rejected', reason: 'unsupportedKind' };
    }

    const expected = versions.get(object.objectId);
    if (!payload) {
      if (expected !== undefined || object.payloadVersion !== undefined) {
        return {
          kind: 'conflict',
          boardRevision: scope.board.revision,
          objects,
          payloads: current,
        };
      }

      updates.push({
        objectId: object.objectId,
        bodyKind: 'text',
        payloadVersion: 0n,
        data: styledText({ text: object.label }, patch),
      });
      continue;
    }
    if (payload.bodyKind !== 'text') {
      return { kind: 'rejected', reason: 'unsupportedKind' };
    }
    if (!writesText) {
      continue;
    }
    if (needsVersion && expected === undefined) {
      return { kind: 'rejected', reason: 'invalidEdit' };
    }
    if (expected !== undefined && payload.payloadVersion !== expected) {
      return { kind: 'conflict', boardRevision: scope.board.revision, objects, payloads: current };
    }
    if (!canAdvanceVersion(payload.payloadVersion)) {
      return { kind: 'rejected', reason: 'versionUnavailable' };
    }

    updates.push({
      ...payload,
      payloadVersion: payload.payloadVersion + 1n,
      data: styledText(payload.data, patch),
    });
  }

  return updates;
}

function styleObjects(
  selected: readonly BoardObject[],
  payloads: readonly PayloadRecord[],
  patch: Style['patch'],
): readonly BoardObject[] {
  const versions = new Map(
    payloads.map(({ objectId, payloadVersion }) => [objectId, payloadVersion]),
  );
  const metadata = styleTouchesObject(patch);

  return selected.map((object) => {
    const next = metadata ? styledObject(object, patch) : object;
    const payloadVersion = versions.get(object.objectId);

    return payloadVersion === undefined ? next : { ...next, payloadVersion };
  });
}

export function applyBoardStyle(
  scope: GeometryToolsScope,
  selected: readonly BoardObject[],
  operation: Style,
): BoardEditDecision {
  const { patch } = operation;
  if (!validStylePatch(patch)) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }
  if (selected.some((object) => !objectAllowsStyle(object, patch))) {
    return { kind: 'rejected', reason: 'unsupportedKind' };
  }
  if (selected.some((object) => styleChangesObjectKind(object, patch) && scope.locked(object))) {
    return { kind: 'rejected', reason: 'geometryLocked' };
  }
  if (
    styleTouchesObject(patch) &&
    selected.some((object) => !canAdvanceVersion(object.geometryVersion))
  ) {
    return { kind: 'rejected', reason: 'versionUnavailable' };
  }

  const texts = styleTouchesText(patch) || patch.label !== undefined || patch.shapeForm === 'text';
  const payloads = texts ? textPayloads(scope, selected, operation) : [];
  if ('kind' in payloads) {
    return payloads;
  }

  return { kind: 'changes', objects: styleObjects(selected, payloads, patch), payloads };
}
