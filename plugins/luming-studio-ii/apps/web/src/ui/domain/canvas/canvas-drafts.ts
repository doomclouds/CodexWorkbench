import { useMemo } from 'react';
import type { CanvasProjection } from './canvas-creation.js';
import { canConnectTo, connectorDraft } from './canvas-creation.js';
import type { CanvasFrame } from './canvas-frame.js';
import { isCurrentEdit } from './canvas-model.js';
import { resolveConnection } from './connectors/geometry.js';
import type { ResolvedConnection } from './connectors/geometry.js';
import type {
  CanvasDuplicateIntent,
  CanvasEditIntent,
  CanvasGeometry,
  CanvasObjectDraft,
} from './contracts.js';
import { projectObject } from './scene/index.js';

interface ObjectDraftView {
  key: string;
  object: CanvasObjectDraft;
  connectorRoute?: ResolvedConnection;
}

function viewOfDraft(
  key: string,
  object: CanvasObjectDraft,
  geometryForId: (id: string) => CanvasGeometry | undefined,
): ObjectDraftView {
  if (object.kind !== 'connector') {
    return { key, object };
  }

  const connectorRoute = resolveConnection(object.connection, geometryForId, object.strokeWidth);

  return { key, object: { ...object, geometry: connectorRoute.geometry }, connectorRoute };
}

function duplicateDrafts(intent: CanvasDuplicateIntent, { index, pending }: CanvasProjection) {
  if (!isCurrentEdit(index, pending, intent.sources)) {
    return [];
  }

  const copies = new Map(intent.sources.map(({ id, geometry }) => [id, geometry]));
  return intent.sources.flatMap((change) => {
    const object = index.get(change.id);
    if (!object) {
      return [];
    }

    const draft =
      object.kind === 'connector'
        ? {
            ...object,
            connection: change.connection ?? object.connection,
            geometry: change.geometry,
          }
        : { ...object, geometry: change.geometry };

    return viewOfDraft(intent.interactionId + ':' + change.id, draft, (id) => {
      const source = index.get(id);
      if (source && canConnectTo(source)) {
        return copies.get(id) ?? projectObject(index, pending, id)?.geometry;
      }
    });
  });
}

function draftsForIntent(intent: CanvasEditIntent, view: CanvasProjection) {
  if (intent.kind === 'duplicate') {
    return duplicateDrafts(intent, view);
  }

  if (intent.kind === 'create') {
    function geometryForId(id: string) {
      const target = view.index.get(id);
      if (target && canConnectTo(target)) {
        return projectObject(view.index, view.pending, id)?.geometry;
      }
    }

    const draft = viewOfDraft(intent.interactionId, intent.object, geometryForId);
    if (!intent.link) {
      return [draft];
    }

    const { source, target } = intent.link;
    const link = connectorDraft(
      {
        start: {
          point: source.point,
          attachment: { objectId: source.objectId, port: source.port },
        },
        end: { point: target.point },
      },
      view,
    );

    return [draft, viewOfDraft(intent.interactionId + ':connector', link, geometryForId)];
  }

  return [];
}

export function useCanvasDrafts(
  pendingEdits: readonly CanvasEditIntent[] | undefined,
  draft: CanvasFrame['draft'],
  { index, pending }: CanvasProjection,
) {
  const drafts = useMemo(
    () => pendingEdits?.flatMap((intent) => draftsForIntent(intent, { index, pending })) ?? [],
    [index, pending, pendingEdits],
  );

  return draft ? [...drafts, ...draftsForIntent(draft, { index, pending })] : drafts;
}
