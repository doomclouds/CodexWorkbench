import {
  BendAxis,
  ConnectorHead,
  ConnectorPort,
  type BoardScene,
  type ConnectorEndpoint,
  type ConnectorGeometry,
  type ObjectMetadata,
  type RelativeBends,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import type {
  WhiteboardConnection,
  WhiteboardConnectorHead,
  WhiteboardObject,
  WhiteboardPoint,
  WhiteboardPort,
  WhiteboardRelativeBends,
  WhiteboardScene,
} from '../contracts.js';
import { matchIdentity, requireField } from './values.js';

const ports = new Map<ConnectorPort, WhiteboardPort>([
  [ConnectorPort.TOP, 'top'],
  [ConnectorPort.BOTTOM, 'bottom'],
  [ConnectorPort.LEFT, 'left'],
  [ConnectorPort.RIGHT, 'right'],
]);
const heads = new Map<ConnectorHead, WhiteboardConnectorHead>([
  [ConnectorHead.NONE, 'none'],
  [ConnectorHead.ARROW, 'arrow'],
  [ConnectorHead.CIRCLE, 'circle'],
]);
const axes = new Map<BendAxis, WhiteboardRelativeBends['firstAxis']>([
  [BendAxis.HORIZONTAL, 'horizontal'],
  [BendAxis.VERTICAL, 'vertical'],
]);

export function readPoint({ x, y }: WhiteboardPoint): WhiteboardPoint {
  if (![x, y].every(Number.isFinite)) {
    throw new Error('Whiteboard response has an invalid point.');
  }

  return { x, y };
}

function readEndpoint(source: ConnectorEndpoint): WhiteboardConnection['start'] {
  const { attachment } = source;
  const point = readPoint(requireField(source.point, 'connector endpoint point'));

  return {
    point,
    attachment: attachment && {
      objectId: attachment.objectId,
      port: ports.get(attachment.port),
    },
  };
}

function readRelativeBends(source: RelativeBends | undefined) {
  if (!source) {
    return;
  }

  const firstAxis = axes.get(source.firstAxis);

  return firstAxis && { firstAxis, offsets: source.offsets };
}

function readConnection(source: ConnectorGeometry): WhiteboardConnection {
  return {
    start: readEndpoint(requireField(source.start, 'connector start')),
    end: readEndpoint(requireField(source.end, 'connector end')),
    bends: source.bends.map(readPoint),
    relativeBends: readRelativeBends(source.relativeBends),
    labelOffset: source.labelOffset && readPoint(source.labelOffset),
    startHead: heads.get(source.startHead),
    endHead: heads.get(source.endHead),
  };
}

function readDetail(detail: ObjectMetadata['geometryDetail']): WhiteboardObject['detail'] {
  switch (detail.case) {
    case 'shape':
      return { kind: 'shape', outline: detail.value.outline };
    case 'section':
      return { kind: 'section', transparent: detail.value.transparent };
    case 'ink':
      return { kind: 'ink', width: detail.value.width };
    case 'connector':
      return { kind: 'connector', connection: readConnection(detail.value) };
    case undefined:
      return undefined;
  }
}

function readGeometry(source: ObjectMetadata['geometry']): WhiteboardObject['geometry'] {
  const { x, y, width, height, rotation } = requireField(source, 'object geometry');

  if (![x, y, width, height, rotation].every(Number.isFinite) || Math.min(width, height) < 0) {
    throw new Error('Whiteboard response has an invalid object geometry.');
  }

  return { x, y, width, height, rotation };
}

function readAppearance(source: ObjectMetadata['appearance']): WhiteboardObject['appearance'] {
  if (!source) {
    return;
  }

  const { fill, stroke, strokeWidth, dashed, hollow } = source;

  return { fill, stroke, strokeWidth, dashed, hollow };
}

function readObject(object: ObjectMetadata): WhiteboardObject {
  return {
    id: object.objectId,
    kind: object.kind,
    label: object.label,
    geometry: readGeometry(object.geometry),
    geometryVersion: requireField(object.geometryVersion, 'object geometry version'),
    payloadVersion: object.payloadVersion,
    locked: object.locked,
    parentId: object.parentId,
    groupId: object.groupId,
    appearance: readAppearance(object.appearance),
    detail: readDetail(object.geometryDetail),
  };
}

export function readObjects(objects: readonly ObjectMetadata[]): readonly WhiteboardObject[] {
  const seen = new Set<string>();

  return objects.map((object) => {
    const { objectId } = object;
    if (!objectId.trim() || seen.has(objectId)) {
      throw new Error('Whiteboard response has an invalid or duplicate object ID.');
    }

    seen.add(objectId);

    return readObject(object);
  });
}

export function readScene(source: BoardScene | undefined, boardId: string): WhiteboardScene {
  const scene = requireField(source, 'scene');
  matchIdentity(scene.boardId, boardId, 'board ID');
  const access = requireField(scene.access, 'board access');

  return {
    boardId,
    title: scene.title,
    revision: requireField(scene.boardRevision, 'board revision'),
    canEdit: access.canEdit && !access.trashed,
    ...(access.trashed ? { trashed: true } : {}),
    objects: readObjects(scene.objects),
  };
}
