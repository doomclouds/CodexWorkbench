import type {
  BoardObject,
  ConnectorDetail,
  ConnectorEndpoint,
  Geometry,
  MoveDelta,
  MoveTarget,
  PayloadRecord,
  Point,
} from './model.js';
import type { GeometryParityOperation } from './geometry-parity.js';
import type { BoardCreationAttachment } from './geometry-attachments.js';
import { canAdvanceVersion } from './movement.js';

export type GeometryTransformKind = 'resize' | 'rotate' | 'connect';
export type GeometryLayerDirection = 'forward' | 'backward' | 'front' | 'back';

export interface GeometryObjectChange {
  readonly target: MoveTarget;
  readonly geometry: Geometry;
  readonly connector?: ConnectorDetail;
  readonly ink?: readonly Point[];
}

interface CreateOperation {
  readonly kind: 'create';
  readonly object: BoardObject;
  readonly payload?: PayloadRecord;
  readonly attachment?: BoardCreationAttachment;
}

interface TransformOperation {
  readonly kind: 'transform';
  readonly transform: GeometryTransformKind;
  readonly objects: readonly GeometryObjectChange[];
}

interface LockOperation {
  readonly kind: 'lock';
  readonly targets: readonly MoveTarget[];
  readonly locked: boolean;
}

interface DeleteOperation {
  readonly kind: 'delete';
  readonly targets: readonly MoveTarget[];
}

interface ReorderOperation {
  readonly kind: 'reorder';
  readonly direction: GeometryLayerDirection;
  readonly expectedBoardRevision: bigint;
  readonly targets: readonly MoveTarget[];
}

interface DuplicateTarget {
  readonly source: MoveTarget;
  readonly newObjectId: string;
}

interface DuplicateOperation {
  readonly kind: 'duplicate';
  readonly targets: readonly DuplicateTarget[];
  readonly delta: MoveDelta;
}

export type GeometryOperation =
  | CreateOperation
  | TransformOperation
  | LockOperation
  | DeleteOperation
  | ReorderOperation
  | DuplicateOperation
  | GeometryParityOperation;

const worldLimit = 10_000_000;
const rotationLimit = 360;
const maximumLabelLength = 4096;
const maximumPaths = 64;
const maximumInkSamples = 20_000;
const minimumInkWidth = 0.1;
const maximumInkWidth = 100;
const shapes = new Set([
  'rounded',
  'rect',
  'ellipse',
  'diamond',
  'pill',
  'hexagon',
  'parallelogram',
  'database',
  'queue',
  'document',
  'cloud',
  'person',
]);
const fixedOrientationKinds = new Set([
  'section',
  'document',
  'todo',
  'table',
  'html',
  'diagram',
  'chart',
]);
const colorLiteral = /^(?:transparent|#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8})$/iu;

function inWorld(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= worldLimit;
}

function pointInWorld({ x, y }: Point): boolean {
  return inWorld(x) && inWorld(y);
}

function validGeometry({ x, y, width, height, rotation }: Geometry): boolean {
  return (
    [x, y, width, height, x + width, y + height].every(inWorld) &&
    width >= 0 &&
    height >= 0 &&
    Number.isFinite(rotation) &&
    Math.abs(rotation) <= rotationLimit
  );
}

function validAppearance({ appearance }: BoardObject): boolean {
  if (!appearance) {
    return true;
  }

  const { fill, stroke, strokeWidth } = appearance;

  return (
    [fill, stroke].every((value) => value === undefined || colorLiteral.test(value)) &&
    (strokeWidth === undefined || (strokeWidth >= 0 && strokeWidth <= maximumInkWidth))
  );
}

function validInkWidth(width: number): boolean {
  return width >= minimumInkWidth && width <= maximumInkWidth;
}

export function hasValidEditInk(points: readonly Point[]): boolean {
  return (
    points.length > 0 &&
    points.length <= maximumInkSamples &&
    points.every(({ x, y }) => x >= 0 && x <= 1 && y >= 0 && y <= 1)
  );
}

export function connectorAttachmentIds(detail: ConnectorDetail): readonly string[] {
  const { start, end } = detail;
  const ids = [start.attachment?.objectId, end.attachment?.objectId];

  return [...new Set(ids.filter((id) => id !== undefined))];
}

function validEndpoint({ point, attachment }: ConnectorEndpoint): boolean {
  return pointInWorld(point) && (!attachment || validNewObjectId(attachment.objectId));
}

export function hasValidConnectorGeometry(detail: ConnectorDetail): boolean {
  const { start, end, bends, relativeBends, labelOffset } = detail;
  const validRelative =
    !relativeBends ||
    (relativeBends.offsets.length <= maximumPaths && relativeBends.offsets.every(inWorld));

  return (
    validEndpoint(start) &&
    validEndpoint(end) &&
    bends.length <= maximumPaths &&
    bends.every(pointInWorld) &&
    validRelative &&
    (!labelOffset || pointInWorld(labelOffset))
  );
}

export function validNewObjectId(id: string): boolean {
  return id.length <= 160 && /^[\p{L}\p{N}][\p{L}\p{N}_.:-]*$/u.test(id);
}

function validDetail({ kind, detail }: BoardObject): boolean {
  switch (kind) {
    case 'shape':
      return detail?.kind === 'shape' && shapes.has(detail.outline);
    case 'section':
      return detail?.kind === 'section';
    case 'ink':
      return detail?.kind === 'ink' && validInkWidth(detail.width);
    case 'connector':
      return detail?.kind === 'connector' && hasValidConnectorGeometry(detail);
    default:
      return detail === undefined;
  }
}

export function validateCreatedObject(object: BoardObject): boolean {
  const { objectId, label, geometryVersion, payloadVersion, locked, groupId, geometry } = object;
  const validVersion =
    geometryVersion === 0n && (payloadVersion === undefined || payloadVersion === 0n);
  const hasArea = object.kind === 'connector' || (geometry.width > 0 && geometry.height > 0);

  return (
    validNewObjectId(objectId) &&
    label.length <= maximumLabelLength &&
    validVersion &&
    !locked &&
    groupId === undefined &&
    hasArea &&
    validGeometry(geometry) &&
    validAppearance(object) &&
    validDetail(object)
  );
}

function scaleInkWidth(width: number, before: Geometry, after: Geometry): number {
  const scaleX = before.width > 0 ? after.width / before.width : 1;
  const scaleY = before.height > 0 ? after.height / before.height : 1;
  const averageScale = (scaleX + scaleY) / 2;

  return Math.min(maximumInkWidth, Math.max(minimumInkWidth, width * averageScale));
}

function nextDetail(
  object: BoardObject,
  { geometry, connector }: GeometryObjectChange,
  transform: GeometryTransformKind,
): BoardObject['detail'] {
  if (transform === 'connect') {
    return connector;
  }

  const { detail } = object;
  if (transform === 'resize' && detail?.kind === 'ink') {
    return { ...detail, width: scaleInkWidth(detail.width, object.geometry, geometry) };
  }

  return detail;
}

function validTransformFields(
  object: BoardObject,
  { geometry, connector, ink }: GeometryObjectChange,
  transform: GeometryTransformKind,
): boolean {
  const detailKind = object.detail?.kind;
  if (transform === 'connect') {
    return (
      detailKind === 'connector' &&
      connector !== undefined &&
      hasValidConnectorGeometry(connector) &&
      geometry.rotation === object.geometry.rotation &&
      !ink
    );
  }
  if (connector || detailKind === 'connector') {
    return false;
  }

  const invalidPoints = ink !== undefined && ink.length > 0 && !hasValidEditInk(ink);
  if (ink && (detailKind !== 'ink' || invalidPoints)) {
    return false;
  }

  const previous = object.geometry;
  if (transform === 'resize') {
    return geometry.rotation === previous.rotation && geometry.width > 0 && geometry.height > 0;
  }

  return (
    !fixedOrientationKinds.has(object.kind) &&
    geometry.width === previous.width &&
    geometry.height === previous.height
  );
}

export function advanceGeometry(
  object: BoardObject,
  change: GeometryObjectChange,
  transform: GeometryTransformKind,
): BoardObject | undefined {
  if (
    !canAdvanceVersion(object.geometryVersion) ||
    !validGeometry(change.geometry) ||
    !validTransformFields(object, change, transform)
  ) {
    return undefined;
  }

  return {
    ...object,
    geometry: change.geometry,
    geometryVersion: object.geometryVersion + 1n,
    detail: nextDetail(object, change, transform),
  };
}

export function geometryInWorld(geometry: Geometry): boolean {
  return validGeometry(geometry);
}
