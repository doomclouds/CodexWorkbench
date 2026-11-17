import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Point, Rect } from './canvas-model.js';

export interface DocumentFocusSurface {
  id: string; scopeKey: string; origin: Point; zoom: number; clip: Rect; baseWidth: number;
  /** Positive deltas advance scrollLeft/scrollTop in viewport CSS pixels. */
  scrollBy(delta: Point): void;
  /** Canvas-local point to preserve through the next readingZoom change. */
  setZoomAnchor(point: Point | null): void;
  /** Flushes document edits before a canvas-owned exit request. */
  prepareExit?(): Promise<boolean>;
}
interface Props {
  expanded: boolean; id: string; version: number; zoom: number; host: HTMLElement | null;
  scroll: RefObject<HTMLDivElement | null>; content: RefObject<HTMLDivElement | null>;
  prepareExit(): Promise<boolean>;
  onChange?: (surface: DocumentFocusSurface | null) => void;
}
interface Metrics { origin: Point; zoom: number; clip: Rect; scopeKey: string }
export default function useDocumentFocusSurface({ expanded, id, version, zoom, host, scroll, content, prepareExit, onChange }: Props): number | undefined {
  const [baseWidth, setBaseWidth] = useState<number>();
  const notify = useRef(onChange); notify.current = onChange;
  const beforeExit = useRef(prepareExit); beforeExit.current = prepareExit;
  const active = useRef(false), metric = useRef<Metrics | null>(null), anchor = useRef<Point | null>(null), refresh = useRef<() => void>(() => {});
  const controls = useMemo(() => ({
    scrollBy(delta: Point) { const node = scroll.current; if (node) { node.scrollLeft += delta.x; node.scrollTop += delta.y; refresh.current(); } },
    setZoomAnchor(point: Point | null) { anchor.current = point; },
    prepareExit() { return beforeExit.current(); },
  }), [scroll]);
  useLayoutEffect(() => {
    const node = scroll.current, body = content.current;
    if (!expanded || !node || !body || !host) {
      if (active.current) { active.current = false; notify.current?.(null); }
      metric.current = null; anchor.current = null;
      return;
    }
    const width = () => {
      const style = getComputedStyle(node);
      return Math.max(120, Math.min(820, node.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0')));
    };
    const available = width();
    if (baseWidth === undefined || Math.abs(baseWidth - available) > 1) { setBaseWidth(available); return; }
    const scopeKey = `document:${id}:${version}:${Math.round(baseWidth)}`;
    const measure = () => {
      const viewport = host.getBoundingClientRect(), clip = node.getBoundingClientRect(), box = body.getBoundingClientRect();
      return { origin: { x: box.left - viewport.left, y: box.top - viewport.top }, zoom, scopeKey, clip: { x: clip.left - viewport.left, y: clip.top - viewport.top, w: node.clientWidth, h: node.clientHeight } };
    };
    const previous = metric.current, current = measure();
    if (previous && previous.zoom !== zoom) {
      const point = anchor.current ?? { x: previous.clip.x + previous.clip.w / 2, y: previous.clip.y + previous.clip.h / 2 };
      const location = { x: (point.x - previous.origin.x) / previous.zoom, y: (point.y - previous.origin.y) / previous.zoom };
      node.scrollLeft += current.origin.x + location.x * zoom - point.x;
      node.scrollTop += current.origin.y + location.y * zoom - point.y;
    }
    anchor.current = null;
    const publish = () => {
      const next = measure();
      if (JSON.stringify(next) === JSON.stringify(metric.current)) return;
      metric.current = next; active.current = true;
      notify.current?.({ ...next, id, baseWidth, ...controls });
    };
    refresh.current = publish;
    publish();
    const resize = () => { const next = width(); if (Math.abs(next - baseWidth) > 1) setBaseWidth(next); else publish(); };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : undefined;
    observer?.observe(node); observer?.observe(body);
    node.addEventListener('scroll', publish, { passive: true });
    window.addEventListener('resize', resize);
    return () => { observer?.disconnect(); node.removeEventListener('scroll', publish); window.removeEventListener('resize', resize); };
  }, [expanded, id, version, zoom, host, baseWidth, scroll, content, controls]);
  useLayoutEffect(() => () => { if (active.current) { active.current = false; notify.current?.(null); } }, []);
  return expanded ? baseWidth : undefined;
}
