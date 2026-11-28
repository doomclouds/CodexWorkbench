import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { CanvasObject, CanvasProps, CanvasViewport } from './contracts.js';
import { createCanvasObjectStore } from './rendering/object-store.js';

function gridSpacing(zoom: number) {
  const spacing = 24 * zoom;

  return spacing >= 8 ? spacing : spacing * 2 ** Math.ceil(Math.log2(8 / spacing));
}

export function useCanvasCamera() {
  const world = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const present = useCallback(({ x, y, zoom }: CanvasViewport) => {
    const layer = world.current;
    if (layer) {
      const transform = layer.dataset.canvasFocus ? '' : `translate(${x}px, ${y}px) scale(${zoom})`;
      if (layer.style.transform !== transform) {
        layer.style.transform = transform;
      }
    }

    const background = grid.current;
    if (background) {
      const spacing = gridSpacing(zoom);
      background.style.backgroundPosition = `${x}px ${y}px`;
      background.style.backgroundSize = `${spacing}px ${spacing}px`;
    }
  }, []);

  return { world, grid, present };
}

export function useCanvasDetailZoom(
  root: RefObject<HTMLDivElement | null>,
  zoom: number,
  continuousZoom: boolean | undefined,
) {
  const [settled, setSettled] = useState(zoom);
  useEffect(() => {
    const view = root.current?.ownerDocument.defaultView;
    if (!view || settled === zoom || !continuousZoom) {
      return;
    }

    const timer = view.setTimeout(() => setSettled(zoom), 100);

    return () => view.clearTimeout(timer);
  }, [continuousZoom, root, settled, zoom]);

  const jump = Math.max(zoom / settled, settled / zoom) >= 2;
  if (settled !== zoom && (!continuousZoom || jump)) {
    setSettled(zoom);
    return zoom;
  }

  return settled;
}

export function useActiveObjectZoom(
  objects: readonly CanvasObject[],
  activeIds: ReadonlySet<string>,
  zoom: number,
  contentTracking?: CanvasProps['contentTracking'],
) {
  const videoIds = useMemo(
    () => objects.filter(({ kind }) => kind === 'video').map(({ id }) => id),
    [objects],
  );
  const trackedIds = useMemo(() => {
    const ids: string[] = [];
    for (const [id, tracking] of contentTracking ?? []) {
      if (tracking.requests.length > 0) {
        ids.push(id);
      }
    }

    return ids;
  }, [contentTracking]);
  const [store] = useState(() => createCanvasObjectStore<number>());
  useLayoutEffect(() => {
    if (activeIds.size === 0 && videoIds.length === 0 && trackedIds.length === 0) {
      store.update(undefined);
      return;
    }

    const ids = new Set([...activeIds, ...videoIds, ...trackedIds]);
    store.update(new Map(Array.from(ids, (id) => [id, zoom])));
  }, [activeIds, store, trackedIds, videoIds, zoom]);

  return store;
}
