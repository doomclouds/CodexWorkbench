import { freezeFeedbackContent } from './content.js';
import type {
  FeedbackAnchor,
  FeedbackAnchorObject,
  FeedbackAnchorTarget,
  FeedbackContentSource,
  FeedbackPoint,
  FeedbackRejected,
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
  target: FeedbackAnchorTarget,
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
