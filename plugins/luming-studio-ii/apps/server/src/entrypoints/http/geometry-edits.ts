import { toJson } from '@bufbuild/protobuf';
import {
  BoardArrangePreset,
  BoardLayerDirection,
  BoardTransformKind,
  type BoardCreationAttachment as WireCreationAttachment,
  type BoardObjectStylePatch,
  type CreateBoardObject,
  type EditBoardGeometryRequest,
  type EditBoardTarget,
  type TransformBoardObject,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import {
  ObjectPayloadSchema,
  TextAlignment,
  type ObjectPayload,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';
import {
  BendAxis,
  ConnectorHead,
  ConnectorPort,
  type ConnectorEndpoint as WireEndpoint,
  type ConnectorGeometry,
  type Geometry as WireGeometry,
  type ObjectMetadata,
  type Point as WirePoint,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import type {
  BoardCreationAttachment,
  BoardObject,
  ConnectorDetail,
  ConnectorEndpoint,
  ConnectorHead as DomainHead,
  ConnectorPort as DomainPort,
  Geometry,
  GeometryDetail,
  GeometryLayerDirection,
  GeometryObjectChange,
  GeometryOperation,
  GeometryTransformKind,
  MoveTarget,
  PayloadRecord,
  Point,
} from '../../modules/whiteboard/application/index.js';
import { HttpRequestError, requireId } from './request.js';

type Axis = NonNullable<ConnectorDetail['relativeBends']>['firstAxis'];
type Arrange = Extract<GeometryOperation, { kind: 'arrange' }>;
type Style = Extract<GeometryOperation, { kind: 'style' }>;

const arrangePresets = new Map<BoardArrangePreset, Arrange['preset']>([
  [BoardArrangePreset.TIDY, 'tidy'],
  [BoardArrangePreset.LEFT, 'left'],
  [BoardArrangePreset.HCENTER, 'hcenter'],
  [BoardArrangePreset.RIGHT, 'right'],
  [BoardArrangePreset.TOP, 'top'],
  [BoardArrangePreset.VCENTER, 'vcenter'],
  [BoardArrangePreset.BOTTOM, 'bottom'],
]);
const alignments = new Map<TextAlignment, string>([
  [TextAlignment.LEFT, 'TEXT_ALIGNMENT_LEFT'],
  [TextAlignment.CENTER, 'TEXT_ALIGNMENT_CENTER'],
  [TextAlignment.RIGHT, 'TEXT_ALIGNMENT_RIGHT'],
]);

const transformKinds = new Map<BoardTransformKind, GeometryTransformKind>([
  [BoardTransformKind.RESIZE, 'resize'],
  [BoardTransformKind.ROTATE, 'rotate'],
  [BoardTransformKind.CONNECT, 'connect'],
]);
const layerDirections = new Map<BoardLayerDirection, GeometryLayerDirection>([
  [BoardLayerDirection.FORWARD, 'forward'],
  [BoardLayerDirection.BACKWARD, 'backward'],
  [BoardLayerDirection.FRONT, 'front'],
  [BoardLayerDirection.BACK, 'back'],
]);
const ports = new Map<ConnectorPort, DomainPort>([
  [ConnectorPort.TOP, 'top'],
  [ConnectorPort.BOTTOM, 'bottom'],
  [ConnectorPort.LEFT, 'left'],
  [ConnectorPort.RIGHT, 'right'],
]);
const heads = new Map<ConnectorHead, DomainHead>([
  [ConnectorHead.NONE, 'none'],
  [ConnectorHead.ARROW, 'arrow'],
  [ConnectorHead.CIRCLE, 'circle'],
]);
const bendAxes = new Map<BendAxis, Axis>([
  [BendAxis.HORIZONTAL, 'horizontal'],
  [BendAxis.VERTICAL, 'vertical'],
]);

function requireField<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new HttpRequestError(400, name + ' is required or is unsupported');
  }

  return value;
}

function readTarget(value: EditBoardTarget | undefined): MoveTarget {
  const { objectId, expectedGeometryVersion } = requireField(value, 'Edit target');

  return {
    objectId: requireId(objectId),
    expectedGeometryVersion: requireField(expectedGeometryVersion, 'Expected geometry version'),
  };
}

function readGeometry(value: WireGeometry | undefined): Geometry {
  const { x, y, width, height, rotation } = requireField(value, 'Object geometry');

  return { x, y, width, height, rotation };
}

function readPoint({ x, y }: WirePoint): Point {
  return { x, y };
}

function readEndpoint(value: WireEndpoint | undefined): ConnectorEndpoint {
  const { point, attachment } = requireField(value, 'Connector endpoint');
  const origin = readPoint(requireField(point, 'Connector point'));
  if (!attachment) {
    return { point: origin };
  }

  const objectId = requireId(attachment.objectId);
  const port =
    attachment.port === ConnectorPort.UNSPECIFIED
      ? undefined
      : requireField(ports.get(attachment.port), 'Connector port');

  return { point: origin, attachment: { objectId, port } };
}

function readHead(value: ConnectorHead): DomainHead | undefined {
  return value === ConnectorHead.UNSPECIFIED
    ? undefined
    : requireField(heads.get(value), 'Connector head');
}

function readConnector({
  start,
  end,
  bends,
  relativeBends,
  labelOffset,
  startHead,
  endHead,
}: ConnectorGeometry): ConnectorDetail {
  return {
    kind: 'connector',
    start: readEndpoint(start),
    end: readEndpoint(end),
    bends: bends.map(readPoint),
    relativeBends: relativeBends && {
      firstAxis: requireField(bendAxes.get(relativeBends.firstAxis), 'Connector bend axis'),
      offsets: relativeBends.offsets,
    },
    labelOffset: labelOffset && readPoint(labelOffset),
    startHead: readHead(startHead),
    endHead: readHead(endHead),
  };
}

function readDetail(detail: ObjectMetadata['geometryDetail']): GeometryDetail | undefined {
  switch (detail.case) {
    case 'shape':
      return { kind: detail.case, outline: detail.value.outline };
    case 'section':
      return { kind: detail.case, transparent: detail.value.transparent };
    case 'ink':
      return { kind: detail.case, width: detail.value.width };
    case 'connector':
      return readConnector(detail.value);
    case undefined:
      return undefined;
  }
}

function readAppearance(value: ObjectMetadata['appearance']): BoardObject['appearance'] {
  if (!value) {
    return undefined;
  }

  const { fill, stroke, strokeWidth, dashed, hollow } = value;

  return { fill, stroke, strokeWidth, dashed, hollow };
}

function readCreatedObject(value: ObjectMetadata | undefined): BoardObject {
  const {
    objectId,
    kind,
    label,
    geometry,
    geometryVersion,
    payloadVersion,
    locked,
    parentId,
    groupId,
    appearance,
    geometryDetail,
  } = requireField(value, 'New object');

  return {
    objectId: requireId(objectId),
    kind,
    label,
    geometry: readGeometry(geometry),
    geometryVersion: geometryVersion ?? 0n,
    payloadVersion,
    locked,
    parentId,
    groupId,
    appearance: readAppearance(appearance),
    detail: readDetail(geometryDetail),
  };
}

function readInitialPayload(
  objectId: string,
  value: ObjectPayload | undefined,
): PayloadRecord | undefined {
  if (!value) {
    return undefined;
  }

  const bodyKind = requireField(value.body.case, 'Initial payload body');
  const converted = toJson(ObjectPayloadSchema, value);
  const data =
    converted && typeof converted === 'object' && !Array.isArray(converted)
      ? converted[bodyKind]
      : undefined;

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpRequestError(400, 'Initial object payload must be a Protobuf message');
  }

  return { objectId, payloadVersion: value.payloadVersion ?? 0n, bodyKind, data };
}

function readCreationAttachment(value: WireCreationAttachment): BoardCreationAttachment {
  return {
    source: readTarget(value.source),
    sourcePort: requireField(ports.get(value.sourcePort), 'Source port'),
    targetPort: requireField(ports.get(value.targetPort), 'Target port'),
    connectorId: requireId(value.connectorId),
  };
}

function readCreate(value: CreateBoardObject): GeometryOperation {
  const object = readCreatedObject(value.object);

  return {
    kind: 'create',
    object,
    payload: readInitialPayload(object.objectId, value.initialPayload),
    attachment: value.attachment && readCreationAttachment(value.attachment),
  };
}

function readTransform(change: TransformBoardObject): GeometryObjectChange {
  const { target, geometry, connector, ink } = change;

  return {
    target: readTarget(target),
    geometry: readGeometry(geometry),
    connector: connector && readConnector(connector),
    ink: ink?.points.map(readPoint),
  };
}

function readStyle(value: BoardObjectStylePatch | undefined): Style['patch'] {
  const patch = requireField(value, 'Style patch');
  const { textAlign, startHead, endHead } = patch;

  return {
    fill: patch.fill,
    stroke: patch.stroke,
    strokeWidth: patch.strokeWidth,
    dashed: patch.dashed,
    hollow: patch.hollow,
    textColor: patch.textColor,
    fontFamily: patch.fontFamily,
    fontSize: patch.fontSize,
    shapeForm: patch.shapeForm,
    label: patch.label,
    bold: patch.bold,
    italic: patch.italic,
    textAlign:
      textAlign === undefined
        ? undefined
        : requireField(alignments.get(textAlign), 'Text alignment'),
    startHead:
      startHead === undefined ? undefined : requireField(heads.get(startHead), 'Start head'),
    endHead: endHead === undefined ? undefined : requireField(heads.get(endHead), 'End head'),
  };
}

export function readGeometryOperation({ operation }: EditBoardGeometryRequest): GeometryOperation {
  switch (operation.case) {
    case 'create':
      return readCreate(operation.value);
    case 'transform':
      return {
        kind: 'transform',
        transform: requireField(transformKinds.get(operation.value.kind), 'Transform kind'),
        objects: operation.value.objects.map(readTransform),
      };
    case 'changeLock':
      return {
        kind: 'lock',
        locked: operation.value.locked,
        targets: operation.value.targets.map(readTarget),
      };
    case 'delete':
      return { kind: 'delete', targets: operation.value.targets.map(readTarget) };
    case 'reorder':
      return {
        kind: 'reorder',
        direction: requireField(layerDirections.get(operation.value.direction), 'Layer direction'),
        expectedBoardRevision: requireField(
          operation.value.expectedBoardRevision,
          'Expected board revision',
        ),
        targets: operation.value.targets.map(readTarget),
      };
    case 'duplicate': {
      const { delta, targets } = operation.value;
      const { dx, dy } = requireField(delta, 'Duplicate offset');

      return {
        kind: 'duplicate',
        delta: { dx, dy },
        targets: targets.map(({ source, newObjectId }) => ({
          source: readTarget(source),
          newObjectId: requireId(newObjectId),
        })),
      };
    }
    case 'group':
      return {
        kind: 'group',
        groupId: requireId(operation.value.groupId),
        targets: operation.value.targets.map(readTarget),
      };
    case 'ungroup':
      return { kind: 'ungroup', targets: operation.value.targets.map(readTarget) };
    case 'createSection':
      return {
        kind: 'createSection',
        sectionId: requireId(operation.value.sectionId),
        title: operation.value.title,
        targets: operation.value.targets.map(readTarget),
      };
    case 'arrange':
      return {
        kind: 'arrange',
        preset: requireField(arrangePresets.get(operation.value.preset), 'Arrange preset'),
        targets: operation.value.targets.map(readTarget),
      };
    case 'style':
      return {
        kind: 'style',
        patch: readStyle(operation.value.patch),
        targets: operation.value.targets.map(({ target, expectedPayloadVersion }) => ({
          target: readTarget(target),
          expectedPayloadVersion,
        })),
      };
    case 'paste': {
      const { sourceBoardId, sourceRevision, targets, delta } = operation.value;
      const { dx, dy } = requireField(delta, 'Paste offset');

      return {
        kind: 'paste',
        sourceBoardId: requireId(sourceBoardId),
        sourceRevision: requireField(sourceRevision, 'Source revision'),
        targets: targets.map(({ sourceObjectId, objectId }) => ({
          sourceObjectId: requireId(sourceObjectId),
          objectId: requireId(objectId),
        })),
        delta: { dx, dy },
      };
    }
    case undefined:
      throw new HttpRequestError(400, 'Geometry operation is required');
  }
}
