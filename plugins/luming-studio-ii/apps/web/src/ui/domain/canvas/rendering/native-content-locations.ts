import { useLayoutEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import type {
  CanvasContentLocation,
  CanvasContentLocationRequest,
  CanvasContentTracking,
  CanvasGeometry,
  CanvasObjectCapabilities,
  CanvasPoint,
} from '../contracts.js';

const selector = '[data-canvas-content-unit]';
const clippingOverflow = new Set(['auto', 'scroll', 'hidden', 'clip']);
const revealOptions = { block: 'nearest', inline: 'nearest', container: 'nearest' } as const;

function clipped(point: CanvasPoint, node: Element, owner: Element, view: Window) {
  for (let parent = node.parentElement; parent && parent !== owner; parent = parent.parentElement) {
    const { overflowX, overflowY } = view.getComputedStyle(parent);
    const clipX = clippingOverflow.has(overflowX);
    const clipY = clippingOverflow.has(overflowY);
    if (clipX || clipY) {
      const { left, right, top, bottom } = parent.getBoundingClientRect();
      const outsideX = clipX && (point.x < left || point.x > right);
      const outsideY = clipY && (point.y < top || point.y > bottom);
      if (outsideX || outsideY) {
        return true;
      }
    }
  }

  return false;
}

function pointIn(node: Element, { target, u, v }: CanvasContentLocationRequest) {
  const { left, top, width, height, right } = node.getBoundingClientRect();
  if (width <= 0 || height <= 0) {
    return null;
  }
  if (target.kind === 'todo') {
    return { x: left + u * width, y: top + v * height };
  }

  return { x: right, y: top + Math.min(6, height / 2) };
}

function useNativeContentLocations(
  root: RefObject<HTMLDivElement | null>,
  tracking: CanvasContentTracking | undefined,
) {
  const revealed = useRef<number>(undefined);
  useLayoutEffect(() => {
    const owner = root.current;
    const view = owner?.ownerDocument.defaultView;
    if (!owner || !view || !tracking?.requests.length) {
      return;
    }

    const { requests, report } = tracking;
    let frame: number | undefined;
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : undefined;
    const observed = new Set<Element>([owner]);
    resize?.observe(owner);
    const measure = () => {
      const nodes = new Map<string, Element>();
      for (const node of owner.querySelectorAll<HTMLElement>(selector)) {
        nodes.set(node.dataset.canvasContentUnit!, node);
      }
      const locations = new Map<string, CanvasContentLocation>();
      for (const request of requests) {
        const { target, reveal } = request;
        if (target.kind === 'html') {
          continue;
        }

        const id = target.kind === 'todo' ? target.itemId : target.blockIds[0];
        const node = id && nodes.get(id);
        if (!node) {
          continue;
        }

        if (!observed.has(node)) {
          observed.add(node);
          resize?.observe(node);
        }
        if (reveal !== undefined && reveal !== revealed.current) {
          revealed.current = reveal;
          node.scrollIntoView?.(revealOptions);
        }
        const point = pointIn(node, request);
        locations.set(request.id, {
          point: point && !clipped(point, node, owner, view) ? point : null,
          reveal,
        });
      }
      report(locations);
    };
    function schedule() {
      frame ??= view?.requestAnimationFrame(() => {
        frame = undefined;
        measure();
      });
    }
    const mutations = new MutationObserver(schedule);
    mutations.observe(owner, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    owner.addEventListener('scroll', schedule, { capture: true, passive: true });
    measure();

    return () => {
      if (frame !== undefined) {
        view.cancelAnimationFrame(frame);
      }
      owner.removeEventListener('scroll', schedule, true);
      mutations.disconnect();
      resize?.disconnect();
    };
  }, [root, tracking]);
}

interface ContentTrackingOptions {
  readonly contentTracking?: CanvasContentTracking;
  readonly mode: CanvasObjectCapabilities['content'];
  readonly geometry: CanvasGeometry;
  readonly zoom: number;
  readonly focusedReading?: boolean;
}

export function useContentTracking(
  root: RefObject<HTMLDivElement | null>,
  { contentTracking, mode, geometry, zoom, focusedReading }: ContentTrackingOptions,
) {
  const tracking = useMemo<CanvasContentTracking | undefined>(() => {
    if (!contentTracking) {
      return undefined;
    }

    return {
      requests: contentTracking.requests,
      report(locations) {
        const bounds = root.current?.getBoundingClientRect();
        if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
          return;
        }

        const zoomX = focusedReading ? bounds.width / geometry.width : zoom;
        const zoomY = focusedReading ? bounds.height / geometry.height : zoom;
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        const world = new Map(locations);
        for (const [id, location] of locations) {
          if (location.point) {
            const { x, y } = location.point;
            world.set(id, {
              ...location,
              point: {
                x: geometry.x + geometry.width / 2 + (x - centerX) / zoomX,
                y: geometry.y + geometry.height / 2 + (y - centerY) / zoomY,
              },
            });
          }
        }
        contentTracking.report(world);
      },
    };
  }, [contentTracking, focusedReading, geometry, root, zoom]);
  useNativeContentLocations(root, mode === 'native' ? tracking : undefined);
  useLayoutEffect(() => () => contentTracking?.report(new Map()), [contentTracking]);

  return {
    embedded: mode === 'embedded' ? tracking : undefined,
    revealing: tracking?.requests.some(({ reveal }) => reveal !== undefined),
  };
}
