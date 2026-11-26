import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardLayerDirection,
  BoardTransformKind,
  type EditBoardGeometryRequestSchema,
  type EditBoardTargetSchema,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import {
  BendAxis,
  ConnectorHead,
  ConnectorPort,
  type ConnectorEndpointSchema,
  type ConnectorGeometrySchema,
  type ObjectMetadataSchema,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import type {
  WhiteboardConnection,
  WhiteboardConnectionEndpoint,
  WhiteboardMoveTarget,
  WhiteboardObject,
} from '../contracts.js';
import type {
  EditBoardGeometryCommand,
  EditBoardGeometryOperation,
  WhiteboardObjectDraft,
} from '../edits-types.js';
import { writeInitialPayload } from './edit-content.js';

type AssetResolver = (source: string) => string;
type WireGeometry = MessageInitShape<typeof EditBoardGeometryRequestSchema>;
type WireObject = MessageInitShape<typeof ObjectMetadataSchema>;

const transforms = {
  resize: BoardTransformKind.RESIZE,
  rotate: BoardTransformKind.ROTATE,
  connect: BoardTransformKind.CONNECT,
};
const directions = {
  forward: BoardLayerDirection.FORWARD,
  backward: BoardLayerDirection.BACKWARD,
  front: BoardLayerDirection.FRONT,
  back: BoardLayerDirection.BACK,
};
const ports = {
  top: ConnectorPort.TOP,
  bottom: ConnectorPort.BOTTOM,
  left: ConnectorPort.LEFT,
  right: ConnectorPort.RIGHT,
};
const heads = {
  none: ConnectorHead.NONE,
  arrow: ConnectorHead.ARROW,
  circle: ConnectorHead.CIRCLE,
};
const axes = {
  horizontal: BendAxis.HORIZONTAL,
  vertical: BendAxis.VERTICAL,
};

function writeEndpoint({
  point,
  attachment,
}: WhiteboardConnectionEndpoint): MessageInitShape<typeof ConnectorEndpointSchema> {
  return {
    point,
    attachment: attachment && {
      objectId: attachment.objectId,
      port: attachment.port && ports[attachment.port],
    },
  };
}

function writeConnection(
  connection: WhiteboardConnection,
): MessageInitShape<typeof ConnectorGeometrySchema> {
  const { start, end, bends, relativeBends, labelOffset, startHead, endHead } = connection;

  return {
    start: writeEndpoint(start),
    end: writeEndpoint(end),
    bends: bends && [...bends],
    relativeBends: relativeBends && {
      firstAxis: axes[relativeBends.firstAxis],
      offsets: [...relativeBends.offsets],
    },
    labelOffset,
    startHead: startHead && heads[startHead],
    endHead: endHead && heads[endHead],
  };
}

function writeDetail(detail: WhiteboardObject['detail']): WireObject['geometryDetail'] {
  switch (detail?.kind) {
    case 'shape':
      return { case: 'shape', value: { outline: detail.outline } };
    case 'section':
      return { case: 'section', value: { transparent: detail.transparent } };
    case 'ink':
      return { case: 'ink', value: { width: detail.width } };
    case 'connector':
      return { case: 'connector', value: writeConnection(detail.connection) };
    case undefined:
      return undefined;
  }
}

function writeObject(object: WhiteboardObjectDraft): WireObject {
  const { id, kind, label, geometry, locked, parentId, groupId, appearance, detail } = object;

  return {
    objectId: id,
    kind,
    label,
    geometry,
    locked,
    parentId,
    groupId,
    appearance,
    geometryDetail: writeDetail(detail),
  };
}

function writeTarget({
  id,
  expectedGeometryVersion,
}: WhiteboardMoveTarget): MessageInitShape<typeof EditBoardTargetSchema> {
  return { objectId: id, expectedGeometryVersion };
}

function writeGeometryOperation(
  operation: EditBoardGeometryOperation,
  resolveAsset: AssetResolver,
): WireGeometry['operation'] {
  switch (operation.kind) {
    case 'create':
      return {
        case: 'create',
        value: {
          object: writeObject(operation.object),
          initialPayload: writeInitialPayload(operation.initialPayload, resolveAsset),
        },
      };
    case 'transform':
      return {
        case: 'transform',
        value: {
          kind: transforms[operation.transform],
          objects: operation.objects.map(({ target, geometry, connection, ink }) => ({
            target: writeTarget(target),
            geometry,
            connector: connection && writeConnection(connection),
            ink: ink && { points: [...ink] },
          })),
        },
      };
    case 'changeLock':
      return {
        case: 'changeLock',
        value: { targets: operation.targets.map(writeTarget), locked: operation.locked },
      };
    case 'delete':
      return { case: 'delete', value: { targets: operation.targets.map(writeTarget) } };
    case 'reorder':
      return {
        case: 'reorder',
        value: {
          targets: operation.targets.map(writeTarget),
          direction: directions[operation.direction],
          expectedBoardRevision: operation.expectedBoardRevision,
        },
      };
    case 'duplicate':
      return {
        case: 'duplicate',
        value: {
          targets: operation.targets.map(({ source, newObjectId }) => ({
            source: writeTarget(source),
            newObjectId,
          })),
          delta: { dx: operation.delta.x, dy: operation.delta.y },
        },
      };
  }
}

export function writeGeometry(
  { boardId, commandId, operation }: EditBoardGeometryCommand,
  resolveAsset: AssetResolver,
): WireGeometry {
  return { boardId, commandId, operation: writeGeometryOperation(operation, resolveAsset) };
}
