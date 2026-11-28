import { freezeFeedbackContent } from './content.js';
import type {
  FeedbackAnchor,
  FeedbackAnchorObject,
  FeedbackAnchorTarget,
  FeedbackContentSource,
  FeedbackPoint,
  FeedbackRejected,
  FeedbackSelectionTarget,
} from './model.js';

const maximumBoardCoordinate = 1_000_000_000;

function validCoordinate(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= maximumBoardCoordinate;
}

function validPoint(point: FeedbackPoint): boolean {
  return validCoordinate(point.x) && validCoordinate(point.y);
}

function inUnitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function projectObjectPoint(object: FeedbackAnchorObject, u: number, v: number): FeedbackPoint {
  const radians = (object.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const localX = (u - 0.5) * object.width;
  const localY = (v - 0.5) * object.height;

  return {
    x: object.x + object.width / 2 + localX * cos - localY * sin,
    y: object.y + object.height / 2 + localX * sin + localY * cos,
  };
}

export function freezeFeedbackAnchor(
  sourceBoardRevision: bigint,
  target: Exclude<FeedbackAnchorTarget, FeedbackSelectionTarget>,
  object?: FeedbackAnchorObject,
  contentSource?: FeedbackContentSource,
): FeedbackAnchor | FeedbackRejected {
  if (target.kind === 'board') {
    return validPoint(target.point)
      ? { target, sourceBoardRevision, frozenPoint: target.point, targetMissing: false }
      : { kind: 'rejected', reason: 'invalidAnchor' };
  }
  if (!inUnitInterval(target.u) || !inUnitInterval(target.v)) {
    return { kind: 'rejected', reason: 'invalidAnchor' };
  }
  if (!object || object.objectId !== target.objectId) {
    return { kind: 'rejected', reason: 'targetChanged' };
  }
  if (object.geometryVersion !== target.geometryVersion) {
    return { kind: 'rejected', reason: 'targetChanged', currentVersion: object.geometryVersion };
  }

  const frozenPoint = projectObjectPoint(object, target.u, target.v);
  if (!validPoint(frozenPoint)) {
    return { kind: 'rejected', reason: 'invalidAnchor' };
  }

  const { kind, label, x, y, width, height, rotation } = object;
  const content =
    target.kind === 'content' ? freezeFeedbackContent(target, kind, contentSource) : {};

  if ('kind' in content) {
    return content;
  }

  return {
    target,
    sourceBoardRevision,
    frozenPoint,
    frozenObject: { kind, label, x, y, width, height, rotation },
    ...content,
    targetMissing: false,
  };
}

function validSelection(target: FeedbackSelectionTarget): boolean {
  const { point, bounds, objects } = target;
  const ids = new Set(objects.map(({ objectId }) => objectId));
  const validBounds =
    !bounds ||
    (validPoint(bounds) &&
      validCoordinate(bounds.x + bounds.width) &&
      validCoordinate(bounds.y + bounds.height) &&
      bounds.width > 0 &&
      bounds.height > 0);

  return (
    validPoint(point) &&
    validBounds &&
    Boolean(bounds || objects.length) &&
    objects.length <= 120 &&
    ids.size === objects.length
  );
}

export function freezeFeedbackSelection(
  revision: bigint,
  target: FeedbackSelectionTarget,
  objects: readonly (FeedbackAnchorObject | undefined)[],
): FeedbackAnchor | FeedbackRejected {
  if (!validSelection(target)) {
    return { kind: 'rejected', reason: 'invalidAnchor' };
  }
  if (
    target.expectedBoardRevision !== revision ||
    objects.some((object, index) => {
      const reference = target.objects[index];
      return (
        !object ||
        object.objectId !== reference?.objectId ||
        object.geometryVersion !== reference.geometryVersion ||
        object.payloadVersion !== reference.payloadVersion
      );
    })
  ) {
    return { kind: 'rejected', reason: 'targetChanged' };
  }

  return {
    target,
    sourceBoardRevision: revision,
    frozenPoint: target.point,
    frozenTargets: objects.flatMap((object) => {
      if (!object) {
        return [];
      }

      const { objectId, geometryVersion, payloadVersion, ...geometry } = object;

      return [{ reference: { objectId, geometryVersion, payloadVersion }, object: geometry }];
    }),
    targetMissing: false,
  };
}
