import { useCallback, useMemo, useState } from 'react';
import type { CanvasNativeSource, CanvasObject } from '../../ui/domain/canvas/index.js';

type Objects = ReadonlyMap<string, CanvasObject>;

function captureLabels(objects: Objects) {
  const labels = new Map<string, string>();
  for (const [id, object] of objects) {
    labels.set(id, object.label);
  }

  return labels;
}

function sameLabels(objects: Objects, labels: ReadonlyMap<string, string>) {
  if (objects.size !== labels.size) {
    return false;
  }

  for (const [id, object] of objects) {
    if (labels.get(id) !== object.label) {
      return false;
    }
  }

  return true;
}

export function useSourceLabel(boardId: string, objects: Objects) {
  const [previous, setPrevious] = useState(() => captureLabels(objects));
  const labels = useMemo(
    () => (sameLabels(objects, previous) ? previous : captureLabels(objects)),
    [objects, previous],
  );

  if (labels !== previous) {
    setPrevious(labels);
  }

  return useCallback(
    (source: CanvasNativeSource) => {
      if (!source.artifactId || source.artifactId === boardId) {
        return labels.get(source.elementId);
      }
    },
    [boardId, labels],
  );
}
