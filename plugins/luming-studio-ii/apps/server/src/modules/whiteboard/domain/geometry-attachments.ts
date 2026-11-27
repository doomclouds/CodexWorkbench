import { exportConnector, geometryCenter } from './export-geometry.js';
import type { BoardObject, ConnectorDetail, ConnectorPort, MoveTarget } from './model.js';

export interface BoardCreationAttachment {
  readonly source: MoveTarget;
  readonly sourcePort: ConnectorPort;
  readonly targetPort: ConnectorPort;
  readonly connectorId: string;
}

const oppositePort: Readonly<Record<ConnectorPort, ConnectorPort>> = {
  top: 'bottom',
  right: 'left',
  bottom: 'top',
  left: 'right',
};

export function adjacentShapeConnector(
  source: BoardObject,
  target: BoardObject,
  { sourcePort, targetPort, connectorId }: BoardCreationAttachment,
): BoardObject | undefined {
  if (
    source.kind !== 'shape' ||
    target.kind !== 'shape' ||
    oppositePort[sourcePort] !== targetPort
  ) {
    return undefined;
  }

  const detail: ConnectorDetail = {
    kind: 'connector',
    start: {
      point: geometryCenter(source.geometry),
      attachment: { objectId: source.objectId, port: sourcePort },
    },
    end: {
      point: geometryCenter(target.geometry),
      attachment: { objectId: target.objectId, port: targetPort },
    },
    bends: [],
    endHead: 'arrow',
  };
  const objects = new Map([
    [source.objectId, source],
    [target.objectId, target],
  ]);
  const route = exportConnector(detail, objects);
  if (!route) {
    return undefined;
  }

  const [first, second] = route.points;
  const last = route.points.at(-1);
  if (!first || !second || !last) {
    return undefined;
  }

  const x = route.points.map((point) => point.x);
  const y = route.points.map((point) => point.y);
  const left = Math.min(...x);
  const top = Math.min(...y);

  return {
    objectId: connectorId,
    label: '连线',
    kind: 'connector',
    geometry: {
      x: left,
      y: top,
      width: Math.max(...x) - left,
      height: Math.max(...y) - top,
      rotation: 0,
    },
    locked: false,
    geometryVersion: 0n,
    detail: {
      ...detail,
      start: { ...detail.start, point: first },
      end: { ...detail.end, point: last },
    },
  };
}
