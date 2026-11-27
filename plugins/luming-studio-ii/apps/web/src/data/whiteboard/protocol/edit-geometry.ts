import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardArrangePreset,
  BoardLayerDirection,
  BoardTransformKind,
  type BoardObjectStylePatchSchema,
  type EditBoardGeometryRequestSchema,
  type EditBoardTargetSchema,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { TextAlignment } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';
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
  WhiteboardStylePatch,
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
const presets = {
  tidy: BoardArrangePreset.TIDY,
  left: BoardArrangePreset.LEFT,
  hcenter: BoardArrangePreset.HCENTER,
  right: BoardArrangePreset.RIGHT,
  top: BoardArrangePreset.TOP,
  vcenter: BoardArrangePreset.VCENTER,
  bottom: BoardArrangePreset.BOTTOM,
};
const alignments = {
  left: TextAlignment.LEFT,
  center: TextAlignment.CENTER,
  right: TextAlignment.RIGHT,
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

function writeStylePatch(
  patch: WhiteboardStylePatch,
): MessageInitShape<typeof BoardObjectStylePatchSchema> {
  const { textAlign, startHead, endHead, ...remaining } = patch;

  return {
    ...remaining,
    textAlign: textAlign && alignments[textAlign],
    startHead: startHead && heads[startHead],
    endHead: endHead && heads[endHead],
  };
}

function writeGeometryOperation(
  operation: EditBoardGeometryOperation,
  resolveAsset: AssetResolver,
): WireGeometry['operation'] {
  switch (operation.kind) {
    case 'create': {
      const attachment = operation.attachment;

      return {
        case: 'create',
        value: {
          object: writeObject(operation.object),
          initialPayload: writeInitialPayload(operation.initialPayload, resolveAsset),
          attachment: attachment && {
            source: writeTarget(attachment.source),
            sourcePort: ports[attachment.sourcePort],
            targetPort: ports[attachment.targetPort],
            connectorId: attachment.connectorId,
          },
        },
      };
    }
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
    case 'group':
      return {
        case: 'group',
        value: { targets: operation.targets.map(writeTarget), groupId: operation.groupId },
      };
    case 'ungroup':
      return { case: 'ungroup', value: { targets: operation.targets.map(writeTarget) } };
    case 'createSection':
      return {
        case: 'createSection',
        value: {
          targets: operation.targets.map(writeTarget),
          sectionId: operation.sectionId,
          title: operation.title,
        },
      };
    case 'arrange':
      return {
        case: 'arrange',
        value: { targets: operation.targets.map(writeTarget), preset: presets[operation.preset] },
      };
    case 'style':
      return {
        case: 'style',
        value: {
          targets: operation.targets.map(({ target, expectedPayloadVersion }) => ({
            target: writeTarget(target),
            expectedPayloadVersion,
          })),
          patch: writeStylePatch(operation.patch),
        },
      };
    case 'paste':
      return {
        case: 'paste',
        value: {
          sourceBoardId: operation.sourceBoardId,
          sourceRevision: operation.sourceRevision,
          targets: operation.targets.map(({ sourceObjectId, newObjectId }) => ({
            sourceObjectId,
            objectId: newObjectId,
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
