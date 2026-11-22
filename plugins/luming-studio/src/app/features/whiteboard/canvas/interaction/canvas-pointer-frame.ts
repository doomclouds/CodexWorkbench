import type { BoardElement } from '../../../../../contracts/studio.js';
import { anchorBounds, type Point, type Rect, type Viewport } from '../scene/canvas-model.js';
import type { AlignmentGuide } from '../scene/native-geometry.js';
import {
  arrowPointOperations,
  creationPlacement,
  finalizeGesturePlacement,
  maxDrawingPoints,
  resizeGestureOperations,
  rotateGestureOperations,
  selectionDragDelta,
  selectionHasDragged,
  snappedDrawingPoint,
  type Gesture,
  type GestureModifiers,
} from './canvas-gesture-placement.js';

export const drawingLimitNotice = '本笔已达到长度上限，正在保存当前笔迹，请另起一笔。';

interface PointerSample {
  point: Point;
  screen: Point;
  zoom: number;
  modifiers: GestureModifiers;
}

type PointerFrame =
  | { kind: 'gesture'; gesture: Gesture }
  | { kind: 'selection'; gesture: Gesture; capture: boolean; guides: AlignmentGuide[] }
  | { kind: 'viewport'; viewport: Viewport }
  | { kind: 'document-pan'; gesture: Gesture; documentId: string; delta: Point }
  | { kind: 'drawing-limit' };

type PanGesture = Extract<Gesture, { kind: 'pan' }>;

interface DocumentPanSurface {
  id: string;
  scrollBy(delta: Point): void;
}

interface PointerFrameEffects {
  surface?: DocumentPanSurface | null;
  capture(): void;
  setViewport(viewport: Viewport): void;
  updateGesture(gesture: Gesture): void;
  setGuides(guides: AlignmentGuide[]): void;
  onDrawingLimit(message: string): void;
}

type ReleaseSample = Omit<PointerSample, 'screen'> & { elements: BoardElement[] };

export function documentPanDelta(gesture: PanGesture, screen: Point): Point {
  return { x: gesture.start.x - screen.x, y: gesture.start.y - screen.y };
}

export function focusedDocumentCursor(point: Point, clip: Rect, target: BoardElement | undefined) {
  const insideX = point.x >= clip.x && point.x <= clip.x + clip.w;
  const insideY = point.y >= clip.y && point.y <= clip.y + clip.h;
  if (!target || !insideX || !insideY) {
    return null;
  }

  const position = anchorBounds(
    {
      coordinateSpace: 'element',
      elementIds: [target.id],
      x: (point.x - clip.x) / clip.w,
      y: (point.y - clip.y) / clip.h,
    },
    [target],
  );

  return position ? { x: position.x, y: position.y } : null;
}

function selectionFrame(
  gesture: Extract<Gesture, { kind: 'move' }>,
  sample: PointerSample,
  elements: BoardElement[],
): PointerFrame | undefined {
  if (!selectionHasDragged(gesture, sample.screen)) {
    return;
  }

  const { delta, guides } = selectionDragDelta(gesture, sample.point, sample.zoom, elements);

  return {
    kind: 'selection',
    capture: !gesture.dragging,
    guides,
    gesture: {
      ...gesture,
      dragging: true,
      current: { x: gesture.start.x + delta.x, y: gesture.start.y + delta.y },
    },
  };
}

function drawingFrame(
  gesture: Extract<Gesture, { kind: 'draw' }>,
  { point, zoom, modifiers }: PointerSample,
): PointerFrame | undefined {
  if (gesture.points.length >= maxDrawingPoints) {
    return { kind: 'drawing-limit' };
  }

  const shiftStroke = modifiers.shiftKey && gesture.element.type === 'stroke';
  if (shiftStroke) {
    const anchor = gesture.straightStart ?? gesture.points.at(-1)!;
    const prefix = gesture.straightPoints ?? gesture.points;

    return {
      kind: 'gesture',
      gesture: {
        ...gesture,
        straightStart: anchor,
        straightPoints: prefix,
        points: [...prefix, snappedDrawingPoint(anchor, point)],
      },
    };
  }

  const next =
    modifiers.shiftKey && gesture.element.type === 'arrow'
      ? snappedDrawingPoint(gesture.start, point)
      : point;
  const previous = gesture.points.at(-1)!;
  if (Math.hypot(next.x - previous.x, next.y - previous.y) > 2 / zoom) {
    return {
      kind: 'gesture',
      gesture: {
        ...gesture,
        straightStart: undefined,
        straightPoints: undefined,
        points: [...gesture.points, next],
      },
    };
  }
}

function panFrame(gesture: PanGesture, screen: Point): PointerFrame | undefined {
  if (gesture.frame) {
    return;
  }
  if (gesture.documentId) {
    return {
      kind: 'document-pan',
      gesture: { ...gesture, start: screen },
      documentId: gesture.documentId,
      delta: documentPanDelta(gesture, screen),
    };
  }

  return {
    kind: 'viewport',
    viewport: {
      ...gesture.viewport,
      x: gesture.viewport.x + screen.x - gesture.start.x,
      y: gesture.viewport.y + screen.y - gesture.start.y,
    },
  };
}

export function projectPointerFrame(
  gesture: Gesture,
  sample: PointerSample,
  elements: BoardElement[],
): PointerFrame | undefined {
  const { point, screen, modifiers, zoom } = sample;
  switch (gesture.kind) {
    case 'pan':
      return panFrame(gesture, screen);
    case 'marquee':
    case 'annotate':
      return { kind: 'gesture', gesture: { ...gesture, end: point } };
    case 'move':
      return selectionFrame(gesture, sample, elements);
    case 'connect':
      return { kind: 'gesture', gesture: { ...gesture, current: point } };
    case 'resize':
      return {
        kind: 'gesture',
        gesture: { ...gesture, operations: resizeGestureOperations(gesture, point, modifiers) },
      };
    case 'rotate':
      return {
        kind: 'gesture',
        gesture: {
          ...gesture,
          operations: rotateGestureOperations(gesture, point, modifiers.shiftKey),
        },
      };
    case 'arrow-point':
      return {
        kind: 'gesture',
        gesture: { ...gesture, operations: arrowPointOperations(gesture, point) },
      };
    case 'draw':
      return drawingFrame(gesture, sample);
    case 'create': {
      const element = creationPlacement(gesture, point, zoom, modifiers.shiftKey, false);

      return element === gesture.element
        ? undefined
        : { kind: 'gesture', gesture: { ...gesture, element } };
    }
  }
}

export function applyPointerFrame(frame: PointerFrame | undefined, effects: PointerFrameEffects) {
  if (!frame) {
    return;
  }

  switch (frame.kind) {
    case 'viewport':
      effects.setViewport(frame.viewport);
      return;
    case 'gesture':
      effects.updateGesture(frame.gesture);
      return;
    case 'document-pan':
      if (effects.surface?.id === frame.documentId) {
        effects.surface.scrollBy(frame.delta);
      }
      effects.updateGesture(frame.gesture);
      return;
    case 'selection':
      if (frame.capture) {
        effects.capture();
      }
      effects.setGuides(frame.guides);
      effects.updateGesture(frame.gesture);
      return;
    case 'drawing-limit':
      effects.onDrawingLimit(drawingLimitNotice);
      return;
  }
}

export function preparePointerRelease(
  gesture: Gesture | null,
  screen: Point,
  surface: DocumentPanSurface | undefined | null,
  readSample: () => ReleaseSample,
) {
  if (!gesture || (gesture.kind === 'pan' && gesture.frame)) {
    return;
  }

  if (gesture.kind === 'pan' && gesture.documentId && surface?.id === gesture.documentId) {
    surface.scrollBy(documentPanDelta(gesture, screen));
  }

  const { elements, ...sample } = readSample();
  return {
    placed: finalizeGesturePlacement(gesture, { ...sample, screen }, elements),
    point: sample.point,
  };
}
