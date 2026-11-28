import { useRef, useState, type PointerEvent } from 'react';
import type { WhiteboardObject } from '../../data/whiteboard/index.js';
import type { CanvasPoint } from '../../ui/domain/canvas/index.js';
import type { BoardFeedbackFrame, BoardSelectionAnnotation } from './board-features.js';
import { isCanvasAnnotationTarget } from './canvas-annotation.js';

type Rect = NonNullable<BoardSelectionAnnotation['bounds']>;

const minDragPixels = 5;

function rectBetween(start: CanvasPoint, end: CanvasPoint): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(1, Math.abs(start.x - end.x)),
    height: Math.max(1, Math.abs(start.y - end.y)),
  };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function extent({ geometry }: WhiteboardObject): Rect {
  const { x, y, width, height, rotation } = geometry;
  const radians = rotation * (Math.PI / 180);
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const w = width * cos + height * sin;
  const h = width * sin + height * cos;

  return { x: x + (width - w) / 2, y: y + (height - h) / 2, width: w, height: h };
}

interface RangeOptions {
  readonly enabled: boolean;
  readonly viewport: BoardFeedbackFrame['viewport'];
  readonly objects: readonly WhiteboardObject[];
  readonly revision: bigint;
}

export function useAnnotationRange({ enabled, viewport, objects, revision }: RangeOptions) {
  const origin = useRef<{ pointerId: number; point: CanvasPoint }>(undefined);
  const suppressClick = useRef(false);
  const [marquee, setMarquee] = useState<Rect>();
  const [request, setRequest] = useState<BoardFeedbackFrame['selectionAnnotationRequest']>();

  function localPoint(event: PointerEvent<HTMLDivElement>): CanvasPoint {
    const frame = event.currentTarget.getBoundingClientRect();

    return { x: event.clientX - frame.left, y: event.clientY - frame.top };
  }

  function worldPoint({ x, y }: CanvasPoint): CanvasPoint {
    return {
      x: (x - viewport.x) / viewport.zoom,
      y: (y - viewport.y) / (viewport.zoomY ?? viewport.zoom),
    };
  }

  function select(point: CanvasPoint, selection: readonly WhiteboardObject[], bounds?: Rect) {
    const target: BoardSelectionAnnotation = {
      kind: 'selection',
      point,
      bounds,
      objects: selection.map(({ id: objectId, geometryVersion, payloadVersion }) => ({
        objectId,
        geometryVersion,
        payloadVersion,
      })),
      expectedBoardRevision: revision,
    };
    setRequest((previous) => ({ sequence: (previous?.sequence ?? 0) + 1, target }));
  }

  function annotateSelected(ids: readonly string[]) {
    const selected = new Set(ids);
    const selection = objects.filter(({ id }) => selected.has(id));
    if (selection.length > 1) {
      const extents = selection.map(extent);
      const right = Math.max(...extents.map(({ x, width }) => x + width));
      const top = Math.min(...extents.map(({ y }) => y));
      const inset = 16 / viewport.zoom;
      select({ x: right - inset, y: top + inset }, selection);
    }
  }

  function begin(event: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false;
    const hit = !event.defaultPrevented && isCanvasAnnotationTarget(event.target);
    if (enabled && event.button === 0 && hit) {
      origin.current = { pointerId: event.pointerId, point: localPoint(event) };
    }
  }

  function cancel() {
    origin.current = undefined;
    setMarquee(undefined);
  }

  function draggedPoint(event: PointerEvent<HTMLDivElement>) {
    const captured = origin.current;
    if (!enabled || captured?.pointerId !== event.pointerId) {
      return;
    }

    const end = localPoint(event);
    const start = captured.point;

    return Math.hypot(end.x - start.x, end.y - start.y) >= minDragPixels
      ? { start, end }
      : undefined;
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const drag = draggedPoint(event);
    if (drag) {
      setMarquee(rectBetween(drag.start, drag.end));
    }
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    const drag = draggedPoint(event);
    cancel();
    if (!drag) {
      return;
    }

    suppressClick.current = true;
    const start = worldPoint(drag.start);
    const end = worldPoint(drag.end);
    const bounds = rectBetween(start, end);
    select(
      end,
      objects.filter((object) => intersects(bounds, extent(object))),
      bounds,
    );
  }

  function takeClickSuppression() {
    const consumed = suppressClick.current;
    suppressClick.current = false;

    return consumed;
  }

  return {
    marquee: enabled ? marquee : undefined,
    request,
    begin,
    move,
    finish,
    cancel,
    annotateSelected,
    takeClickSuppression,
  };
}
