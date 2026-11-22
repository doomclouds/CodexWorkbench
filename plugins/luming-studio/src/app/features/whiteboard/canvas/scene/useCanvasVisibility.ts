import { useCallback, useMemo, useState } from 'react';
import type { BoardElement } from '../../../../../contracts/studio.js';
import { boundsOf, contains, intersects, type Rect, type Viewport } from './canvas-model.js';
import { geometryBounds } from './native-geometry.js';

export interface CanvasViewportExtent {
  width: number;
  height: number;
}

interface CanvasVisibilityOptions {
  elements: BoardElement[];
  viewport: Viewport;
  extent: CanvasViewportExtent | null;
  ready: boolean;
  stableGeometry: boolean;
  protectedIds: ReadonlySet<string>;
}

const viewportOverscan = 160;
const viewportBucket = 128;
const noMountedElements: BoardElement[] = [];

export function useCanvasVisibility({
  elements,
  viewport: { x, y, zoom },
  extent,
  ready,
  stableGeometry,
  protectedIds,
}: CanvasVisibilityOptions) {
  const [retained, setRetained] = useState<ReadonlySet<string>>(() => new Set());
  const retain = useCallback((id: string) => {
    setRetained((current) => (current.has(id) ? current : new Set([...current, id])));
  }, []);
  const width = extent?.width ?? 0;
  const height = extent?.height ?? 0;
  const left = Math.floor((-x - viewportOverscan) / viewportBucket) * viewportBucket;
  const top = Math.floor((-y - viewportOverscan) / viewportBucket) * viewportBucket;
  const right = Math.ceil((width - x + viewportOverscan) / viewportBucket) * viewportBucket;
  const bottom = Math.ceil((height - y + viewportOverscan) / viewportBucket) * viewportBucket;
  const measured = width > 0 && height > 0;
  const measureScene = ready && measured && stableGeometry;
  const sceneBounds = useMemo(() => {
    if (!measureScene) {
      return undefined;
    }

    return boundsOf(
      elements
        .filter((element) => !isUnboundedPath(element))
        .map((element) => mountBounds(element, elements)),
    );
  }, [elements, measureScene]);

  const mounted = useMemo(() => {
    if (!ready || !extent) {
      return noMountedElements;
    }
    if (!width || !height) {
      return elements;
    }

    const window: Rect = {
      x: left / zoom,
      y: top / zoom,
      w: (right - left) / zoom,
      h: (bottom - top) / zoom,
    };

    if (sceneBounds === null || (sceneBounds && contains(window, sceneBounds))) {
      return elements;
    }

    return elements.filter((element) =>
      retainInWindow(element, window, elements, retained, protectedIds),
    );
  }, [
    ready,
    extent,
    width,
    height,
    left,
    top,
    right,
    bottom,
    zoom,
    elements,
    sceneBounds,
    retained,
    protectedIds,
  ]);

  return { mounted, retain };
}

function isUnboundedPath(element: BoardElement) {
  return element.type === 'arrow' || element.type === 'stroke';
}

function mountBounds(element: BoardElement, elements: BoardElement[]) {
  return element.rotation ? geometryBounds(element, elements) : element;
}

function retainInWindow(
  element: BoardElement,
  window: Rect,
  elements: BoardElement[],
  retained: ReadonlySet<string>,
  protectedIds: ReadonlySet<string>,
): boolean {
  const pinned = retained.has(element.id) || protectedIds.has(element.id);
  if (pinned || isUnboundedPath(element)) {
    return true;
  }

  return intersects(window, mountBounds(element, elements));
}
