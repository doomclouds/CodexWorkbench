import { useCallback, useMemo, useState } from 'react';
import { canConnectTo } from './canvas-creation.js';
import type { CanvasFrame } from './canvas-frame.js';
import { applyGesturePreviews } from './canvas-gesture-preview.js';
import type {
  CanvasObjectChange,
  CanvasObjectKind,
  CanvasObjectRegistry,
  CanvasProps,
} from './contracts.js';
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
const visitedOffscreenBodyLimit = 256;
const visitedBodyKinds = new Set<CanvasObjectKind>([
  'html',
  'diagram',
  'chart',
  'document',
  'todo',
  'table',
  'video',
]);

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
  registry: CanvasObjectRegistry,
  enabled: boolean,
  pendingResizeObjectId?: string,
) {
  if (selected.length === 0) {
    return {};
  }

  const object = selected.length === 1 ? selected[0] : undefined;
  const single =
    enabled && object && editableTarget(index, pending, object.object.id) ? object : undefined;
  const allEditable =
    enabled && selected.every(({ object }) => editableTarget(index, pending, object.id));
  const pendingResize =
    object &&
    object.object.id === pendingResizeObjectId &&
    editableTarget(index, pending, object.object.id);
  const resizable = Boolean(allEditable || pendingResize);
  const allowResize =
    resizable && selected.every(({ object }) => registry.get(object.kind)?.capabilities.resize);
  const allowRotate =
    allEditable && selected.every(({ object }) => registry.get(object.kind)?.capabilities.rotate);
  const geometries = selected.map(({ geometry }) => geometry);
  const showSelectionBox = object?.object.kind !== 'connector' || !allEditable;

  return {
    transformBox: showSelectionBox ? getTransformBox(geometries) : undefined,
    lockedSelection: !resizable,
    allowResize,
    allowRotate,
    cornerResizeOnly:
      selected.length > 1 && geometries.some(({ rotation }) => rotation % 360 !== 0),
    selectedConnector: single?.object.kind === 'connector' ? single : undefined,
    portSource: single && canConnectTo(single.object, registry) ? single : undefined,
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

function hasCachedBody(
  id: string,
  index: SceneIndex,
  registry: CanvasObjectRegistry,
  payloadById: CanvasProps['payloadById'],
) {
  const kind = index.get(id)?.kind;
  const payload = payloadById?.get(id);
  if (!kind || !payload) {
    return false;
  }
  if (!visitedBodyKinds.has(kind) || !registry.get(kind)?.View) {
    return false;
  }

  if (kind === 'diagram' || kind === 'chart') {
    const value = payload.value;

    return Boolean(
      value && typeof value === 'object' && 'html' in value && typeof value.html === 'string',
    );
  }

  return true;
}

function useVisitedBodies(
  windowed: readonly ProjectedCanvasObject[],
  index: SceneIndex,
  registry: CanvasObjectRegistry,
  payloadById: CanvasProps['payloadById'],
) {
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const cached = useCallback(
    (id: string) => hasCachedBody(id, index, registry, payloadById),
    [index, registry, payloadById],
  );
  const retained = useMemo(() => [...seen].filter(cached), [seen, cached]);
  const entering = windowed.filter(({ object }) => !seen.has(object.id) && cached(object.id));
  if (retained.length !== seen.size || entering.length) {
    const next = new Set([...retained, ...entering.map(({ object }) => object.id)]);
    setSeen(next);

    return next;
  }

  return seen;
}

export function useCanvasModel(
  { scene, pendingEdits, selection, canEdit, payloadById, remoteGesturePreviews }: CanvasProps,
  frame: CanvasFrame,
  size: CanvasViewportSize,
  retainedId: string | undefined,
  retainedIds: ReadonlySet<string>,
  registry: CanvasObjectRegistry,
) {
  const index = useMemo(() => createSceneIndex(scene.objects, registry), [scene.objects, registry]);
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
  const displayChanges = useMemo(
    () => applyGesturePreviews(index, changes, remoteGesturePreviews),
    [index, changes, remoteGesturePreviews],
  );
  const displayWindow = useMemo(
    () =>
      displayChanges === changes
        ? windowed
        : queryScene(index, getViewportBounds(viewport, size, viewOverscan), displayChanges),
    [index, viewport, size, changes, displayChanges, windowed],
  );
  const visitedBodies = useVisitedBodies(windowed, index, registry, payloadById);
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
    if (!retainedId && retainedIds.size === 0 && visitedBodies.size === 0) {
      return displayWindow;
    }

    const ids = new Set(retainedIds);
    if (retainedId) {
      ids.add(retainedId);
    }

    const windowIds = new Set(displayWindow.map(({ object }) => object.id));
    for (const id of windowIds) {
      ids.delete(id);
    }

    const offscreenVisits = [...visitedBodies].filter((id) => !windowIds.has(id) && !ids.has(id));
    for (const id of offscreenVisits.slice(-visitedOffscreenBodyLimit)) {
      ids.add(id);
    }

    const additions = [...ids].flatMap((id) => {
      const projected = projectObject(index, displayChanges, id);

      return projected ? [projected] : [];
    });

    if (additions.length === 0) {
      return displayWindow;
    }

    const layerOf = ({ object }: ProjectedCanvasObject) => index.getEntry(object.id)?.layer ?? 0;

    return [...displayWindow, ...additions].sort(
      (first, second) => layerOf(first) - layerOf(second),
    );
  }, [displayWindow, retainedId, retainedIds, visitedBodies, index, displayChanges]);

  return { index, pending, selected, painted, visibleIds };
}
