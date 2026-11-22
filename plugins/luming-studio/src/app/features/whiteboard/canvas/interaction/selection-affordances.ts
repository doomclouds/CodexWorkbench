import type { BoardElement } from '../../../../../contracts/studio.js';
import type { Point } from '../scene/canvas-model.js';

export type ConnectionSide = 'top' | 'right' | 'bottom' | 'left';

export const CONNECTION_SIDES: ConnectionSide[] = ['top', 'right', 'bottom', 'left'];
export const OPPOSITE_SIDE: Record<ConnectionSide, ConnectionSide> = {
  top: 'bottom',
  right: 'left',
  bottom: 'top',
  left: 'right',
};
export const ROTATABLE_TYPES = new Set([
  'note',
  'text',
  'shape',
  'image',
  'stroke',
  'sticker',
  'link',
]);
const CONNECTABLE_TYPES = new Set(['note', 'shape', 'text', 'table', 'container', 'image', 'link']);

export function canShowConnectionPorts(element: BoardElement, zoom: number): boolean {
  return (
    CONNECTABLE_TYPES.has(element.type) &&
    !element.locked &&
    zoom >= 0.25 &&
    Math.max(element.w, element.h) * zoom >= 40
  );
}

export function connectionPoint(element: BoardElement, side: ConnectionSide, offset = 0): Point {
  const dx = sideOffset(side, 'left', 'right', element.w / 2 + offset);
  const dy = sideOffset(side, 'top', 'bottom', element.h / 2 + offset);
  const angle = ((element.rotation ?? 0) * Math.PI) / 180;

  return {
    x: element.x + element.w / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: element.y + element.h / 2 + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

function sideOffset(
  side: ConnectionSide,
  start: ConnectionSide,
  end: ConnectionSide,
  distance: number,
) {
  if (side === start) {
    return -distance;
  }

  return side === end ? distance : 0;
}

export function connectionAtPoint(
  elements: readonly BoardElement[],
  point: Point,
  zoom: number,
  excluded: readonly string[] = [],
): { element: BoardElement; side?: ConnectionSide } | undefined {
  for (const element of [...elements].reverse()) {
    if (excluded.includes(element.id) || ['arrow', 'stroke'].includes(element.type)) {
      continue;
    }

    const port = CONNECTABLE_TYPES.has(element.type)
      ? CONNECTION_SIDES.find(
          (side) =>
            Math.hypot(
              connectionPoint(element, side, 12 / zoom).x - point.x,
              connectionPoint(element, side, 12 / zoom).y - point.y,
            ) *
              zoom <=
            12,
        )
      : undefined;

    if (port) {
      return { element, side: port };
    }

    const angle = (-(element.rotation ?? 0) * Math.PI) / 180;
    const dx = point.x - element.x - element.w / 2;
    const dy = point.y - element.y - element.h / 2;
    const x = dx * Math.cos(angle) - dy * Math.sin(angle);
    const y = dx * Math.sin(angle) + dy * Math.cos(angle);
    if (Math.abs(x) <= element.w / 2 && Math.abs(y) <= element.h / 2) {
      return { element };
    }
  }
}

export function adjacentElement(
  source: BoardElement,
  side: ConnectionSide,
  next: BoardElement,
  elements: readonly BoardElement[],
): BoardElement {
  const gap = source.type === 'note' ? 24 : 48;
  const centerX = source.x + (source.w - next.w) / 2;
  const centerY = source.y + (source.h - next.h) / 2;
  const place = (box: BoardElement) => {
    switch (side) {
      case 'left':
        return { ...next, x: box.x - next.w - gap, y: centerY };
      case 'right':
        return { ...next, x: box.x + box.w + gap, y: centerY };
      case 'top':
        return { ...next, x: centerX, y: box.y - next.h - gap };
      case 'bottom':
        return { ...next, x: centerX, y: box.y + box.h + gap };
    }
  };

  let result = place(source);
  const occupied = elements.filter(
    (element) =>
      element.id !== source.id &&
      !['stroke', 'container', 'sticker', 'arrow'].includes(element.type),
  );

  for (let index = 0; index < occupied.length; index++) {
    const candidate = result;
    const hit = occupied.find(
      (element) =>
        candidate.x < element.x + element.w + 12 &&
        candidate.x + candidate.w + 12 > element.x &&
        candidate.y < element.y + element.h + 12 &&
        candidate.y + candidate.h + 12 > element.y,
    );

    if (!hit) {
      break;
    }

    result = place(hit);
  }

  return result;
}
