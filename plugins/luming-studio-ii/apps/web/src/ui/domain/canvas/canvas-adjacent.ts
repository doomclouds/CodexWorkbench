import type { CanvasProjection } from './canvas-creation.js';
import type { CanvasCreateIntent, CanvasObject, CanvasPort, CanvasRect } from './contracts.js';
import { getAdjacentGeometry, oppositePort } from './connectors/adjacent.js';
import { portPoint } from './connectors/geometry.js';
import { projectedObjectBounds, projectObject, queryScene } from './scene/index.js';

function obstacleAt(view: CanvasProjection, sourceId: string, bounds: CanvasRect) {
  const hits = queryScene(view.index, bounds, view.pending);
  const obstacle = hits.find(
    ({ object }) =>
      object.id !== sourceId && view.registry?.get(object.kind)?.blocksPlacement !== false,
  );

  return obstacle && projectedObjectBounds(obstacle);
}

function asDraft({
  id: _id,
  version: _version,
  locked: _locked,
  parentId: _parent,
  groupId: _group,
  ...source
}: CanvasObject) {
  return source;
}

export function placementFromPort(
  view: CanvasProjection,
  sourceId: string,
  port: CanvasPort,
  interactionId: string,
): CanvasCreateIntent | undefined {
  const source = projectObject(view.index, view.pending, sourceId);
  if (!source) {
    return undefined;
  }

  const policy = view.registry?.get(source.object.kind)?.portClick;
  if (!policy) {
    return undefined;
  }

  const geometry = getAdjacentGeometry(
    source.geometry,
    port,
    (bounds) => obstacleAt(view, sourceId, bounds),
    policy === 'connect' ? 'shape' : 'note',
  );
  const object = { ...asDraft(source.object), label: '', geometry };
  const base = { kind: 'create' as const, interactionId, object };
  if (policy === 'place') {
    return base;
  }

  const targetPort = oppositePort(port);

  return {
    ...base,
    link: {
      source: {
        objectId: sourceId,
        expectedVersion: source.object.version,
        port,
        point: portPoint(source.geometry, port),
      },
      target: { port: targetPort, point: portPoint(geometry, targetPort) },
    },
  };
}
