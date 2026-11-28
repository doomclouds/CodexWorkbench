import { useCallback, useMemo, useState } from 'react';
import { canConnectTo } from './canvas-creation.js';
import type { CanvasFrame } from './canvas-frame.js';
import { applyGesturePreviews } from './canvas-gesture-preview.js';
import type {
  CanvasObjectChange,
  CanvasObjectKind,
  CanvasObjectRegistry,
  CanvasProps,
  CanvasViewport,
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
import { projectMoveWithinWindow } from './scene/move-preview.js';
import { expandSelectionIds } from './selection/index.js';
import { getViewportBounds, rectContainsRect, rectsIntersect } from './viewport/index.js';
import type { CanvasViewportSize } from './viewport/index.js';

const viewOverscan = 128;
const windowBucket = 64;
const visitedOffscreenBodyLimit = 256;
const noObjectChanges: ReadonlyMap<string, CanvasObjectChange> = new Map();
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
  const entering = useMemo(
    () => windowed.filter(({ object }) => !seen.has(object.id) && cached(object.id)),
    [windowed, seen, cached],
  );

  if (retained.length !== seen.size || entering.length) {
    const next = new Set([...retained, ...entering.map(({ object }) => object.id)]);
    setSeen(next);

    return next;
  }

  return seen;
}

function useWindowBounds(viewport: CanvasViewport, size: CanvasViewportSize) {
  const bounds = getViewportBounds(viewport, size, viewOverscan);
  const step = windowBucket / 2 ** Math.floor(Math.log2(viewport.zoom));
  const x = Math.floor(bounds.x / step) * step;
  const y = Math.floor(bounds.y / step) * step;
  const right = Math.ceil((bounds.x + bounds.width) / step) * step;
  const bottom = Math.ceil((bounds.y + bounds.height) / step) * step;

  const candidate = useMemo(
    () => ({ x, y, width: right - x, height: bottom - y }),
    [x, y, right, bottom],
  );
  const [mounted, setMounted] = useState(candidate);
  const bounded = mounted.width <= candidate.width * 2 && mounted.height <= candidate.height * 2;
  if (bounded && rectContainsRect(mounted, getViewportBounds(viewport, size, windowBucket / 2))) {
    return mounted;
  }

  if (mounted !== candidate) {
    setMounted(candidate);
  }

  return candidate;
}

function useStableWindow(candidate: readonly ProjectedCanvasObject[]) {
  const [current, setCurrent] = useState({ candidate, objects: candidate });
  if (current.candidate === candidate) {
    return current.objects;
  }

  const same =
    current.objects.length === candidate.length &&
    current.objects.every((object, index) => object === candidate[index]);
  const objects = same ? current.objects : candidate;

  setCurrent({ candidate, objects });

  return objects;
}

function presentedIds(
  presentation: CanvasProps['presentation'],
  index: SceneIndex,
  pending: ReadonlyMap<string, CanvasObjectChange>,
) {
  if (presentation?.focusObjectId) {
    return new Set([presentation.focusObjectId]);
  }
  if (presentation?.objectIds.length) {
    return new Set(expandSelectionIds(index, presentation.objectIds, pending));
  }
}

function inLayerOrder(index: SceneIndex, entries: ProjectedCanvasObject[]) {
  const layerOf = ({ object }: ProjectedCanvasObject) => index.getEntry(object.id)?.layer ?? 0;

  return entries.sort((first, second) => layerOf(first) - layerOf(second));
}

function mergeWindows(
  index: SceneIndex,
  background: readonly ProjectedCanvasObject[],
  foreground: readonly ProjectedCanvasObject[] | undefined,
) {
  if (!foreground) {
    return background;
  }

  const objects = new Map(background.map((entry) => [entry.object.id, entry]));
  for (const entry of foreground) {
    objects.set(entry.object.id, entry);
  }
  return inLayerOrder(index, [...objects.values()]);
}

export function useCanvasModel(
  {
    scene,
    pendingEdits,
    selection,
    canEdit,
    payloadById,
    remoteGesturePreviews,
    presentation,
  }: CanvasProps,
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
  const bounds = useWindowBounds(presentation?.returnViewport ?? viewport, size);
  const visibleBounds = useMemo(() => getViewportBounds(viewport, size), [viewport, size]);
  const moveFrame = !preview || preview.kind === 'move';
  const pendingMovesOnly = !pendingEdits?.some(({ kind }) => kind !== 'move');
  const canProjectMove = moveFrame && pendingMovesOnly && !remoteGesturePreviews?.length;
  const projectedMove = useMemo(() => {
    if (!canProjectMove || changes.size === 0) {
      return undefined;
    }

    return projectMoveWithinWindow(index, noObjectChanges, changes, [...changes.values()], {
      window: bounds,
      visible: visibleBounds,
    });
  }, [canProjectMove, changes, index, bounds, visibleBounds]);
  const windowChanges = projectedMove || changes.size === 0 ? noObjectChanges : changes;
  const windowed = useMemo(
    () => queryScene(index, bounds, windowChanges),
    [index, bounds, windowChanges],
  );
  const displayChanges = useMemo(
    () => applyGesturePreviews(index, windowChanges, remoteGesturePreviews),
    [index, windowChanges, remoteGesturePreviews],
  );
  const displayCandidates = useMemo(
    () => (displayChanges === windowChanges ? windowed : queryScene(index, bounds, displayChanges)),
    [index, bounds, windowChanges, displayChanges, windowed],
  );
  const presentationIds = useMemo(
    () => presentedIds(presentation, index, pending),
    [presentation, index, pending],
  );
  const foreground = useMemo(() => {
    if (!presentation) {
      return undefined;
    }

    return queryScene(
      index,
      getViewportBounds(viewport, size, viewOverscan),
      displayChanges,
    ).filter(({ object }) => presentationIds?.has(object.id) !== false);
  }, [presentation, presentationIds, index, viewport, size, displayChanges]);
  const mounted = useMemo(
    () => mergeWindows(index, displayCandidates, foreground),
    [index, displayCandidates, foreground],
  );
  const displayWindow = useStableWindow(mounted);
  const visitedBodies = useVisitedBodies(windowed, index, registry, payloadById);
  const visibleIds = useMemo(() => {
    if (!foreground && windowChanges.size === 0 && index.fullyWithin(visibleBounds)) {
      return index.objectIds;
    }

    return (foreground ?? windowed)
      .filter((entry) => rectsIntersect(projectedObjectBounds(entry), visibleBounds))
      .map(({ object }) => object.id);
  }, [index, visibleBounds, windowChanges, windowed, foreground]);
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

    return inLayerOrder(index, [...displayWindow, ...additions]);
  }, [displayWindow, retainedId, retainedIds, visitedBodies, index, displayChanges]);

  return { index, pending, selected, painted, visibleIds, projectedMove, presentationIds };
}
