import { useEffectEvent, useLayoutEffect, useRef, type RefObject } from 'react';
import { jsonEqual } from '../../../../../../shared/safe-merge.js';
import type { Point, Rect } from '../../scene/canvas-model.js';

export interface DocumentFocusSurface {
  id: string;
  scopeKey: string;
  origin: Point;
  zoom: number;
  clip: Rect;
  baseWidth: number;

  scrollBy(delta: Point): void;

  setZoomAnchor(point: Point | null): void;

  prepareExit?(): Promise<boolean>;
}
interface Props {
  expanded: boolean;
  id: string;
  version: number;
  zoom: number;
  host: HTMLElement | null;
  scroll: RefObject<HTMLDivElement | null>;
  content: RefObject<HTMLDivElement | null>;
  scrollBy(delta: Point): void;
  prepareExit(): Promise<boolean>;
  onChange?: (surface: DocumentFocusSurface | null) => void;
}
interface Metrics {
  origin: Point;
  zoom: number;
  clip: Rect;
  scopeKey: string;
}

export default function useDocumentFocusSurface({
  expanded,
  id,
  version,
  zoom,
  host,
  scroll,
  content,
  scrollBy,
  prepareExit,
  onChange,
}: Props): void {
  const notify = useEffectEvent((surface: DocumentFocusSurface | null) => onChange?.(surface));
  const beforeExit = useRef(prepareExit);
  useLayoutEffect(() => {
    beforeExit.current = prepareExit;
  }, [prepareExit]);
  const active = useRef(false);
  const metric = useRef<Metrics | null>(null);
  const anchor = useRef<Point | null>(null);
  useLayoutEffect(() => {
    const node = scroll.current;
    const body = content.current;
    const viewportUnavailable = !expanded || !host;
    if (viewportUnavailable || !node || !body) {
      if (active.current) {
        active.current = false;
        notify(null);
      }

      metric.current = null;
      anchor.current = null;

      return;
    }

    const width = () => {
      const style = getComputedStyle(node);

      return Math.max(
        120,
        Math.min(
          820,
          node.clientWidth -
            parseFloat(style.paddingLeft || '0') -
            parseFloat(style.paddingRight || '0'),
        ),
      );
    };

    let baseWidth = width();
    body.style.setProperty('width', `${baseWidth}px`);
    const measure = () => {
      const viewport = host.getBoundingClientRect();
      const clip = node.getBoundingClientRect();
      const box = body.getBoundingClientRect();
      const scopeKey = `document:${id}:${version}:${Math.round(baseWidth)}`;

      return {
        origin: { x: box.left - viewport.left, y: box.top - viewport.top },
        zoom,
        scopeKey,
        clip: {
          x: clip.left - viewport.left,
          y: clip.top - viewport.top,
          w: node.clientWidth,
          h: node.clientHeight,
        },
      };
    };

    const previous = metric.current;
    const current = measure();
    if (previous && previous.zoom !== zoom) {
      const point = anchor.current ?? {
        x: previous.clip.x + previous.clip.w / 2,
        y: previous.clip.y + previous.clip.h / 2,
      };
      const location = {
        x: (point.x - previous.origin.x) / previous.zoom,
        y: (point.y - previous.origin.y) / previous.zoom,
      };
      scrollBy({
        x: current.origin.x + location.x * zoom - point.x,
        y: current.origin.y + location.y * zoom - point.y,
      });
    }

    anchor.current = null;
    let firstMeasurement = true;
    const publish = () => {
      const next = measure();
      if (!firstMeasurement && jsonEqual(next, metric.current)) {
        return;
      }

      firstMeasurement = false;
      metric.current = next;
      active.current = true;
      notify({ ...next, id, baseWidth, ...controls });
    };

    let connected = true;
    const controls = {
      scrollBy(delta: Point) {
        if (connected) {
          scrollBy(delta);
          publish();
        }
      },
      setZoomAnchor(point: Point | null) {
        if (connected) {
          anchor.current = point;
        }
      },
      prepareExit() {
        return beforeExit.current();
      },
    };
    publish();
    const resize = () => {
      const next = width();
      if (Math.abs(next - baseWidth) > 1) {
        baseWidth = next;
        body.style.setProperty('width', `${baseWidth}px`);
      }

      publish();
    };

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : undefined;
    observer?.observe(node);
    observer?.observe(body);
    node.addEventListener('scroll', publish, { passive: true });
    window.addEventListener('resize', resize);

    return () => {
      connected = false;
      observer?.disconnect();
      node.removeEventListener('scroll', publish);
      window.removeEventListener('resize', resize);
      body.style.removeProperty('width');
    };
  }, [expanded, id, version, zoom, host, scroll, content, scrollBy]);
  useLayoutEffect(
    () => () => {
      if (active.current) {
        active.current = false;
        notify(null);
      }
    },
    [],
  );
}
