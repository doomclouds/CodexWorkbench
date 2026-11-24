import { useMemo } from 'react';
import { canConnectTo } from './canvas-creation.js';
import type { CanvasFrame } from './canvas-frame.js';
import type { CanvasObjectChange, CanvasProps } from './contracts.js';
import { getTransformBox } from './gestures/index.js';
import {
  buildPendingEdits,
  createSceneIndex,
  isObjectLocked,
  projectedObjectBounds,
  projectObject,
  queryScene,
} from './scene/index.js';
import type { ProjectedCanvasObject, SceneIndex } from './scene/index.js';
import { getViewportBounds, rectsIntersect } from './viewport/index.js';
import type { CanvasViewportSize } from './viewport/index.js';

const viewOverscan = 128;

export function editableTarget(
  index: SceneIndex,
  pending: ReadonlyMap<string, CanvasObjectChange>,
  id: string,
) {
  const object = index.get(id);
  if (!object || isObjectLocked(index, id) || pending.has(id)) {
    return undefined;
  }

  return object;
}

export function isCurrentEdit(
  index: SceneIndex,
  pending: ReadonlyMap<string, CanvasObjectChange>,
  changes: readonly CanvasObjectChange[],
) {
  return changes.every((change) => {
    const object = editableTarget(index, pending, change.id);

    return object?.version === change.expectedVersion;
  });
}

export function selectionControls(
  selected: readonly ProjectedCanvasObject[],
  index: SceneIndex,
  pending: ReadonlyMap<string, CanvasObjectChange>,
  enabled: boolean,
) {
  if (!enabled || selected.length === 0) {
    return {};
  }

  const object = selected.length === 1 ? selected[0] : undefined;
  const single = object && editableTarget(index, pending, object.object.id) ? object : undefined;
  const canTransform = selected.every(
    ({ object }) => object.kind !== 'connector' && editableTarget(index, pending, object.id),
  );
  const geometries = selected.map(({ geometry }) => geometry);

  return {
    transformBox: canTransform ? getTransformBox(geometries) : undefined,
    cornerResizeOnly:
      selected.length > 1 && geometries.some(({ rotation }) => rotation % 360 !== 0),
    selectedConnector: single?.object.kind === 'connector' ? single : undefined,
    portSource: single && canConnectTo(single.object) ? single : undefined,
  };
}

function projectedChanges(
  index: SceneIndex,
  pending: ReadonlyMap<string, CanvasObjectChange>,
  preview: CanvasFrame['preview'],
) {
  if (!preview || !isCurrentEdit(index, pending, preview.changes)) {
    return pending;
  }

  const changes = new Map(pending);
  for (const change of preview.changes) {
    changes.set(change.id, change);
  }

  return changes;
}

export function useCanvasModel(
  { scene, pendingEdits, selection, canEdit }: CanvasProps,
  frame: CanvasFrame,
  size: CanvasViewportSize,
  retainedId: string | undefined,
) {
  const index = useMemo(() => createSceneIndex(scene.objects), [scene.objects]);
  const pending = useMemo(
    () => buildPendingEdits(index, pendingEdits ?? []),
    [index, pendingEdits],
  );
  const preview = canEdit ? frame.preview : undefined;
  const changes = useMemo(
    () => projectedChanges(index, pending, preview),
    [index, pending, preview],
  );
  const viewport = frame.viewport;
  const windowed = useMemo(() => {
    const bounds = getViewportBounds(viewport, size, viewOverscan);

    return queryScene(index, bounds, changes);
  }, [index, viewport, size, changes]);
  const visibleIds = useMemo(() => {
    const bounds = getViewportBounds(viewport, size);

    return windowed
      .filter((entry) => rectsIntersect(projectedObjectBounds(entry), bounds))
      .map(({ object }) => object.id);
  }, [windowed, viewport, size]);
  const selected = useMemo(
    () =>
      selection.flatMap((id) => {
        const projected = projectObject(index, changes, id);

        return projected ? [projected] : [];
      }),
    [selection, index, changes],
  );
  const painted = useMemo(() => {
    if (!retainedId || windowed.some(({ object }) => object.id === retainedId)) {
      return windowed;
    }

    const retained = projectObject(index, changes, retainedId);

    return retained ? [...windowed, retained] : windowed;
  }, [windowed, retainedId, index, changes]);

  return { index, pending, selected, painted, visibleIds };
}
