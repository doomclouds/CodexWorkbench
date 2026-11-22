import type { BoardElement, Operation } from '../../../../../contracts/studio.js';
import { normalizedRect, type Point, type Rect, type Viewport } from '../scene/canvas-model.js';
import {
  resizeBox,
  resizeElement,
  resizeSelection,
  rotateSelection,
  snapMove,
  type ResizeHandle,
} from '../scene/native-geometry.js';
import type { ConnectionSide } from './selection-affordances.js';

interface CreatingElement {
  kind: 'create';
  start: Point;
  element: BoardElement;
  initialSize: Pick<BoardElement, 'w' | 'h'>;
}

interface ResizingSelection {
  kind: 'resize';
  start: Point;
  elements: BoardElement[];
  ids: string[];
  box: Rect;
  handle: ResizeHandle;
  operations: Operation[];
}

interface RotatingSelection {
  kind: 'rotate';
  start: Point;
  elements: BoardElement[];
  ids: string[];
  box: Rect;
  operations: Operation[];
}

interface MovingSelection {
  kind: 'move';
  start: Point;
  screenStart: Point;
  current: Point;
  ids: string[];
  elements: BoardElement[];
  copies?: BoardElement[];
  dragging?: boolean;
}

interface MovingArrowPoint {
  kind: 'arrow-point';
  start: Point;
  element: BoardElement;
  end: 'from' | 'to' | 'bends';
  bendIndex: number;
  points: Point[];
  operations: Operation[];
}

type GestureDetail =
  | {
      kind: 'pan';
      start: Point;
      viewport: Viewport;
      pointerId?: number;
      frame?: { regionId: string; pointerId: number };
      documentId?: string;
    }
  | { kind: 'marquee'; start: Point; end: Point; additive: boolean }
  | { kind: 'annotate'; start: Point; end: Point; element?: BoardElement }
  | MovingSelection
  | ResizingSelection
  | RotatingSelection
  | MovingArrowPoint
  | {
      kind: 'draw';
      start: Point;
      points: Point[];
      element: BoardElement;
      from?: string;
      straightStart?: Point;
      straightPoints?: Point[];
    }
  | { kind: 'connect'; start: Point; current: Point; element: BoardElement; side: ConnectionSide }
  | CreatingElement;

export type Gesture = { operationId?: string; baseRevision?: number } & GestureDetail;

export interface GestureModifiers {
  shiftKey: boolean;
  altKey: boolean;
}

interface PlacementSample {
  point: Point;
  screen: Point;
  zoom: number;
  modifiers: GestureModifiers;
}

export const canvasDragThreshold = 5;

export function resizeGestureOperations(
  gesture: ResizingSelection,
  point: Point,
  modifiers: GestureModifiers,
): Operation[] {
  const delta = { x: point.x - gesture.start.x, y: point.y - gesture.start.y };
  const targets = gesture.elements.filter((element) => gesture.ids.includes(element.id));
  const { shiftKey: aspect, altKey: center } = modifiers;
  if (targets.length === 1) {
    return resizeElement(targets[0], gesture.handle, delta, { aspect, center });
  }

  const box = resizeBox(gesture.box, gesture.handle, delta, {
    aspect: aspect || targets.some((element) => Boolean(element.rotation)),
    center,
  });

  return resizeSelection(gesture.elements, gesture.ids, gesture.box, box);
}

export function rotateGestureOperations(
  gesture: RotatingSelection,
  point: Point,
  snap: boolean,
): Operation[] {
  const center = { x: gesture.box.x + gesture.box.w / 2, y: gesture.box.y + gesture.box.h / 2 };
  const from = Math.atan2(gesture.start.y - center.y, gesture.start.x - center.x);
  const to = Math.atan2(point.y - center.y, point.x - center.x);
  const angle = ((to - from) * 180) / Math.PI;

  return rotateSelection(gesture.elements, gesture.ids, snap ? Math.round(angle / 15) * 15 : angle);
}

function squarePlacementPoint(start: Point, point: Point): Point {
  const x = point.x - start.x;
  const y = point.y - start.y;
  const side = Math.max(Math.abs(x), Math.abs(y));

  return { x: start.x + Math.sign(x || 1) * side, y: start.y + Math.sign(y || 1) * side };
}

export function snappedDrawingPoint(start: Point, point: Point): Point {
  const increment = Math.PI / 4;
  const angle =
    Math.round(Math.atan2(point.y - start.y, point.x - start.x) / increment) * increment;
  const distance = Math.hypot(point.x - start.x, point.y - start.y);

  return { x: start.x + Math.cos(angle) * distance, y: start.y + Math.sin(angle) * distance };
}

export function creationPlacement(
  gesture: CreatingElement,
  point: Point,
  zoom: number,
  square: boolean,
  release: boolean,
): BoardElement {
  const { start, element, initialSize } = gesture;
  const end = square && element.type === 'shape' ? squarePlacementPoint(start, point) : point;
  if (Math.hypot(end.x - start.x, end.y - start.y) * zoom < canvasDragThreshold) {
    return release ? { ...element, ...start, ...initialSize } : element;
  }

  const box = normalizedRect(start, end);

  return { ...element, ...box, w: Math.max(32, box.w), h: Math.max(28, box.h) };
}

export function selectionDragDelta(
  gesture: MovingSelection,
  point: Point,
  zoom: number,
  elements: BoardElement[],
) {
  return snapMove(
    elements,
    gesture.ids,
    { x: point.x - gesture.start.x, y: point.y - gesture.start.y },
    zoom,
  );
}

export function selectionHasDragged(gesture: MovingSelection, screen: Point): boolean {
  return (
    Boolean(gesture.dragging) ||
    Math.hypot(screen.x - gesture.screenStart.x, screen.y - gesture.screenStart.y) >=
      canvasDragThreshold
  );
}

export function finalizeGesturePlacement(
  gesture: Gesture,
  sample: PlacementSample,
  elements: BoardElement[],
): Gesture {
  const { point, screen, zoom, modifiers } = sample;
  switch (gesture.kind) {
    case 'move': {
      const { delta } = selectionDragDelta(gesture, point, zoom, elements);

      return {
        ...gesture,
        current: { x: gesture.start.x + delta.x, y: gesture.start.y + delta.y },
        dragging: selectionHasDragged(gesture, screen),
      };
    }
    case 'resize':
      return { ...gesture, operations: resizeGestureOperations(gesture, point, modifiers) };
    case 'rotate':
      return {
        ...gesture,
        operations: rotateGestureOperations(gesture, point, modifiers.shiftKey),
      };
    case 'create':
      return {
        ...gesture,
        element: creationPlacement(gesture, point, zoom, modifiers.shiftKey, true),
      };
    case 'pan':
    case 'marquee':
    case 'annotate':
    case 'arrow-point':
    case 'draw':
    case 'connect':
      return gesture;
  }
}

function arrowPointChanges(gesture: MovingArrowPoint, point: Point): Partial<BoardElement> {
  if (gesture.end === 'bends') {
    return {
      bends: gesture.points
        .slice(1, -1)
        .flatMap((value, index) =>
          index === gesture.bendIndex ? [point.x, point.y] : [value.x, value.y],
        ),
    };
  }

  return { [gesture.end]: [point.x, point.y] };
}

export function arrowPointOperations(
  gesture: MovingArrowPoint,
  point: Point,
  elements?: readonly BoardElement[],
): Operation[] {
  const changes = arrowPointChanges(gesture, point);
  if (gesture.end !== 'bends' && elements) {
    const target = elements.findLast((element) => {
      if (element.id === gesture.element.id || ['arrow', 'stroke'].includes(element.type)) {
        return false;
      }

      const withinHorizontal = point.x >= element.x && point.x <= element.x + element.w;
      const withinVertical = point.y >= element.y && point.y <= element.y + element.h;

      return withinHorizontal && withinVertical;
    });

    if (target) {
      changes[gesture.end] = target.id;
    }
  }

  return [{ op: 'update', id: gesture.element.id, changes }];
}

export function projectGestureGeometry(
  elements: readonly BoardElement[],
  operations: readonly Operation[],
): BoardElement[] {
  const changes = new Map<string, Partial<BoardElement> | undefined>();
  for (const operation of operations) {
    if (operation.id && !changes.has(operation.id)) {
      changes.set(operation.id, operation.changes);
    }
  }

  return elements.map((element) => ({ ...element, ...changes.get(element.id) }));
}

export function drawnElement(
  gesture: Extract<Gesture, { kind: 'draw' }>,
  points = gesture.points,
): BoardElement {
  const end = points.at(-1) ?? gesture.start;
  let x = points[0]?.x ?? gesture.start.x;
  let y = points[0]?.y ?? gesture.start.y;
  let right = x;
  let bottom = y;
  for (const point of points) {
    x = Math.min(x, point.x);
    y = Math.min(y, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  const w = Math.max(1, right - x);
  const h = Math.max(1, bottom - y);
  const geometry = { x, y, w, h };

  return gesture.element.type === 'arrow'
    ? { ...gesture.element, ...geometry, to: [end.x, end.y] }
    : {
        ...gesture.element,
        ...geometry,
        points: points.flatMap((point) => [point.x - x, point.y - y]),
      };
}

export const maxDrawingPoints = 20_000;

export function finalizeDrawing(
  gesture: Extract<Gesture, { kind: 'draw' }>,
  point: Point,
  snap: boolean,
  scene: readonly BoardElement[],
) {
  const arrow = gesture.element.type === 'arrow';
  const end = arrow && snap ? snappedDrawingPoint(gesture.start, point) : point;
  const last = gesture.points.at(-1)!;
  const canAppend =
    gesture.points.length < maxDrawingPoints && (end.x !== last.x || end.y !== last.y);
  const element = drawnElement(gesture, canAppend ? [...gesture.points, end] : gesture.points);
  if (arrow) {
    const target = scene.findLast((candidate) => {
      if (
        candidate.id === gesture.from ||
        ['arrow', 'stroke', 'container'].includes(candidate.type)
      ) {
        return false;
      }

      const withinHorizontal = end.x >= candidate.x && end.x <= candidate.x + candidate.w;
      const withinVertical = end.y >= candidate.y && end.y <= candidate.y + candidate.h;

      return withinHorizontal && withinVertical;
    });
    element.to = target?.id ?? [end.x, end.y];
  }

  return { element, reachedLimit: !arrow && gesture.points.length >= maxDrawingPoints };
}

const geometryPreviewKinds = { rotate: 'turn', 'arrow-point': 'arrow', resize: 'resize' } as const;

export function geometryCommit(
  gesture: ResizingSelection | RotatingSelection | MovingArrowPoint,
  point: Point,
  scene: readonly BoardElement[],
) {
  const elements = gesture.kind === 'arrow-point' ? [gesture.element] : gesture.elements;
  const operations =
    gesture.kind === 'arrow-point'
      ? arrowPointOperations(gesture, point, scene)
      : gesture.operations;

  if (!operations.length) {
    return null;
  }

  const affected = new Set(operations.flatMap((operation) => (operation.id ? [operation.id] : [])));

  return {
    elements,
    operations,
    preview: projectGestureGeometry(
      elements.filter((element) => affected.has(element.id)),
      operations,
    ),
    kind: geometryPreviewKinds[gesture.kind],
    summary: gesture.kind === 'rotate' ? '旋转元素' : '调整几何',
  };
}
