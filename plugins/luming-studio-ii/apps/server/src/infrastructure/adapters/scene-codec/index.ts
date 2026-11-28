import { create, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import {
  BendAxis,
  ConnectorHead,
  ConnectorPort,
  ObjectMetadataSchema,
  type ConnectorEndpointSchema,
  type ConnectorGeometrySchema,
  type ObjectMetadata,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import type { RoomContentChange } from '../../../modules/rooms/application/index.js';
import type {
  BoardContentChange,
  BoardObject,
  ConnectorDetail,
  ConnectorEndpoint,
  ConnectorHead as DomainConnectorHead,
  ConnectorPort as DomainConnectorPort,
} from '../../../modules/whiteboard/application/index.js';

const CONNECTOR_PORTS: Record<DomainConnectorPort, ConnectorPort> = {
  top: ConnectorPort.TOP,
  bottom: ConnectorPort.BOTTOM,
  left: ConnectorPort.LEFT,
  right: ConnectorPort.RIGHT,
};
const CONNECTOR_HEADS: Record<DomainConnectorHead, ConnectorHead> = {
  none: ConnectorHead.NONE,
  arrow: ConnectorHead.ARROW,
  circle: ConnectorHead.CIRCLE,
};

type GeometryDetailInit = MessageInitShape<typeof ObjectMetadataSchema>['geometryDetail'];

function toEndpoint(endpoint: ConnectorEndpoint): MessageInitShape<typeof ConnectorEndpointSchema> {
  const { point, attachment } = endpoint;
  if (!attachment) {
    return { point };
  }

  const { objectId, port } = attachment;
  return {
    point,
    attachment: { objectId, port: port ? CONNECTOR_PORTS[port] : ConnectorPort.UNSPECIFIED },
  };
}

function toConnector(detail: ConnectorDetail): MessageInitShape<typeof ConnectorGeometrySchema> {
  const { start, end, bends, relativeBends, labelOffset, startHead, endHead } = detail;
  const axis = relativeBends?.firstAxis === 'horizontal' ? BendAxis.HORIZONTAL : BendAxis.VERTICAL;

  return {
    start: toEndpoint(start),
    end: toEndpoint(end),
    bends: [...bends],
    relativeBends: relativeBends
      ? { firstAxis: axis, offsets: [...relativeBends.offsets] }
      : undefined,
    labelOffset,
    startHead: startHead ? CONNECTOR_HEADS[startHead] : ConnectorHead.UNSPECIFIED,
    endHead: endHead ? CONNECTOR_HEADS[endHead] : ConnectorHead.UNSPECIFIED,
  };
}

function toGeometryDetail(detail: BoardObject['detail']): GeometryDetailInit {
  if (!detail) {
    return undefined;
  }

  switch (detail.kind) {
    case 'shape':
      return { case: 'shape', value: { outline: detail.outline } };
    case 'section':
      return { case: 'section', value: { transparent: detail.transparent } };
    case 'ink':
      return { case: 'ink', value: { width: detail.width } };
    case 'connector':
      return { case: 'connector', value: toConnector(detail) };
  }
}

export function toObjectMetadata(object: BoardObject): ObjectMetadata {
  return create(ObjectMetadataSchema, {
    objectId: object.objectId,
    kind: object.kind,
    label: object.label,
    geometry: object.geometry,
    geometryVersion: object.geometryVersion,
    payloadVersion: object.payloadVersion,
    locked: object.locked,
    parentId: object.parentId,
    groupId: object.groupId,
    appearance: object.appearance,
    geometryDetail: toGeometryDetail(object.detail),
  });
}

export function toRoomContentChange(change: BoardContentChange): RoomContentChange {
  const { boardId, boardRevision } = change;
  if (change.kind === 'refresh') {
    return { boardId, boardRevision, refreshScene: true };
  }

  const { changedObjects, removedObjectIds } = change;
  return {
    boardId,
    boardRevision,
    changedObjectIds: changedObjects.map(({ objectId }) => objectId),
    removedObjectIds,
    changedObjects: changedObjects.map((object) =>
      toBinary(ObjectMetadataSchema, toObjectMetadata(object)),
    ),
  };
}
