import type {
  Appearance,
  BoardObject,
  GeometryDetail,
} from '../../modules/whiteboard/ports/index.js';
import type { SqliteRow } from '../platform/index.js';
import {
  decodeJson,
  storedArray,
  storedBool,
  storedDecimalVersion,
  storedNumber,
  storedRecord,
  storedSqliteBool,
  storedText,
  storedVersion,
} from './stored-values.js';

type ConnectorDetail = Extract<GeometryDetail, { kind: 'connector' }>;
type ConnectorEndpoint = ConnectorDetail['start'];
type ConnectorPort = NonNullable<ConnectorEndpoint['attachment']>['port'];
type ConnectorHead = NonNullable<ConnectorDetail['startHead']>;
type RelativeBends = NonNullable<ConnectorDetail['relativeBends']>;

function decodePoint(value: unknown) {
  const { x, y } = storedRecord(value, 'point');

  return { x: storedNumber(x, 'x'), y: storedNumber(y, 'y') };
}

function decodeAppearance(value: unknown): Appearance {
  const { fill, stroke, strokeWidth, dashed, hollow } = storedRecord(value, 'appearance');

  return {
    fill: fill === undefined ? undefined : storedText(fill, 'fill'),
    stroke: stroke === undefined ? undefined : storedText(stroke, 'stroke'),
    strokeWidth: strokeWidth === undefined ? undefined : storedNumber(strokeWidth, 'strokeWidth'),
    dashed: dashed === undefined ? undefined : storedBool(dashed, 'dashed'),
    hollow: hollow === undefined ? undefined : storedBool(hollow, 'hollow'),
  };
}

function decodePort(value: unknown): ConnectorPort {
  switch (value) {
    case undefined:
    case 'top':
    case 'bottom':
    case 'left':
    case 'right':
      return value;
    default:
      throw new Error('Invalid stored connector port.');
  }
}

function decodeHead(value: unknown): ConnectorHead {
  switch (value) {
    case 'none':
    case 'circle':
    case 'arrow':
      return value;
    default:
      throw new Error('Invalid stored connector head.');
  }
}

function decodeEndpoint(value: unknown): ConnectorEndpoint {
  const { point, attachment } = storedRecord(value, 'endpoint');
  const position = decodePoint(point);
  if (attachment === undefined) {
    return { point: position };
  }

  const { objectId, port } = storedRecord(attachment, 'attachment');

  return {
    point: position,
    attachment: { objectId: storedText(objectId, 'objectId'), port: decodePort(port) },
  };
}

function decodeRelativeBends(value: unknown): RelativeBends {
  const { firstAxis, offsets } = storedRecord(value, 'relativeBends');
  if (firstAxis !== 'horizontal' && firstAxis !== 'vertical') {
    throw new Error('Invalid stored connector bend axis.');
  }

  return {
    firstAxis,
    offsets: storedArray(offsets, 'offsets').map((offset) => storedNumber(offset, 'offset')),
  };
}

function decodeConnector(value: Record<string, unknown>): ConnectorDetail {
  const { start, end, bends, relativeBends, labelOffset, startHead, endHead } = value;

  return {
    kind: 'connector',
    start: decodeEndpoint(start),
    end: decodeEndpoint(end),
    bends: storedArray(bends, 'bends').map(decodePoint),
    relativeBends: relativeBends === undefined ? undefined : decodeRelativeBends(relativeBends),
    labelOffset: labelOffset === undefined ? undefined : decodePoint(labelOffset),
    startHead: startHead === undefined ? undefined : decodeHead(startHead),
    endHead: endHead === undefined ? undefined : decodeHead(endHead),
  };
}

function decodeDetail(value: unknown): GeometryDetail {
  const detail = storedRecord(value, 'detail');
  switch (detail.kind) {
    case 'shape':
      return { kind: 'shape', outline: storedText(detail.outline, 'outline') };
    case 'section':
      return { kind: 'section', transparent: storedBool(detail.transparent, 'transparent') };
    case 'ink':
      return { kind: 'ink', width: storedNumber(detail.width, 'ink width') };
    case 'connector':
      return decodeConnector(detail);
    default:
      throw new Error('Invalid stored geometry detail.');
  }
}

function decodeGeometry(value: Record<string, unknown>) {
  const { x, y, width, height, rotation } = value;

  return {
    x: storedNumber(x, 'x'),
    y: storedNumber(y, 'y'),
    width: storedNumber(width, 'width'),
    height: storedNumber(height, 'height'),
    rotation: storedNumber(rotation, 'rotation'),
  };
}

export function decodeSceneObject(row: SqliteRow): BoardObject {
  return {
    objectId: storedText(row.object_id, 'object_id'),
    kind: storedText(row.kind, 'kind'),
    label: storedText(row.label, 'label'),
    geometry: decodeGeometry(row),
    geometryVersion: storedVersion(row.geometry_version, 'geometry_version'),
    payloadVersion:
      row.payload_version === null
        ? undefined
        : storedVersion(row.payload_version, 'payload_version'),
    locked: storedSqliteBool(row.locked, 'locked'),
    parentId: row.parent_id === null ? undefined : storedText(row.parent_id, 'parent_id'),
    groupId: row.group_id === null ? undefined : storedText(row.group_id, 'group_id'),
    appearance:
      row.appearance_json === null
        ? undefined
        : decodeAppearance(decodeJson(row.appearance_json, 'appearance_json')),
    detail:
      row.detail_json === null
        ? undefined
        : decodeDetail(decodeJson(row.detail_json, 'detail_json')),
  };
}

export function decodeReceiptObject(value: unknown): BoardObject {
  const object = storedRecord(value, 'receipt object');
  const { parentId, groupId, appearance, detail, payloadVersion } = object;

  return {
    objectId: storedText(object.objectId, 'objectId'),
    kind: storedText(object.kind, 'kind'),
    label: storedText(object.label, 'label'),
    geometry: decodeGeometry(storedRecord(object.geometry, 'geometry')),
    geometryVersion: storedDecimalVersion(object.geometryVersion, 'geometryVersion'),
    payloadVersion:
      payloadVersion === undefined
        ? undefined
        : storedDecimalVersion(payloadVersion, 'payloadVersion'),
    locked: storedBool(object.locked, 'locked'),
    parentId: parentId === undefined ? undefined : storedText(parentId, 'parentId'),
    groupId: groupId === undefined ? undefined : storedText(groupId, 'groupId'),
    appearance: appearance === undefined ? undefined : decodeAppearance(appearance),
    detail: detail === undefined ? undefined : decodeDetail(detail),
  };
}
