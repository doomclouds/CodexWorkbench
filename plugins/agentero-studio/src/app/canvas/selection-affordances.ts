import type { BoardElement } from '../../contracts/studio.js';
import type { Point } from './canvas-model.js';

export type ConnectionSide = 'top' | 'right' | 'bottom' | 'left';
export const CONNECTION_SIDES: ConnectionSide[] = ['top', 'right', 'bottom', 'left'];
export const OPPOSITE_SIDE: Record<ConnectionSide, ConnectionSide> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };
export const ROTATABLE_TYPES = new Set(['note', 'text', 'shape', 'image', 'stroke', 'sticker', 'link']);
const CONNECTABLE_TYPES = new Set(['note', 'shape', 'text', 'table', 'container', 'image', 'link']);

export function canShowConnectionPorts(element: BoardElement, zoom: number): boolean {
  return CONNECTABLE_TYPES.has(element.type) && !element.locked && zoom >= .25 && Math.max(element.w, element.h) * zoom >= 40;
}

export function connectionPoint(element: BoardElement, side: ConnectionSide, offset = 0): Point {
  const dx = side === 'left' ? -element.w / 2 - offset : side === 'right' ? element.w / 2 + offset : 0;
  const dy = side === 'top' ? -element.h / 2 - offset : side === 'bottom' ? element.h / 2 + offset : 0;
  const angle = (element.rotation ?? 0) * Math.PI / 180;
  return { x: element.x + element.w / 2 + dx * Math.cos(angle) - dy * Math.sin(angle), y: element.y + element.h / 2 + dx * Math.sin(angle) + dy * Math.cos(angle) };
}

/** Side bindings use the existing local-side contract, including rotated objects. */
export function connectionAtPoint(elements: readonly BoardElement[], point: Point, zoom: number, excluded: readonly string[] = []): { element: BoardElement; side?: ConnectionSide } | undefined {
  for (const element of [...elements].reverse()) {
    if (excluded.includes(element.id) || ['arrow', 'stroke'].includes(element.type)) continue;
    const port = CONNECTABLE_TYPES.has(element.type) ? CONNECTION_SIDES.find(side => Math.hypot(connectionPoint(element, side, 12 / zoom).x - point.x, connectionPoint(element, side, 12 / zoom).y - point.y) * zoom <= 12) : undefined;
    if (port) return { element, side: port };
    const angle = -(element.rotation ?? 0) * Math.PI / 180, dx = point.x - element.x - element.w / 2, dy = point.y - element.y - element.h / 2;
    const x = dx * Math.cos(angle) - dy * Math.sin(angle), y = dx * Math.sin(angle) + dy * Math.cos(angle);
    if (Math.abs(x) <= element.w / 2 && Math.abs(y) <= element.h / 2) return { element };
  }
}

export function adjacentElement(source: BoardElement, side: ConnectionSide, next: BoardElement, elements: readonly BoardElement[]): BoardElement {
  const gap = source.type === 'note' ? 24 : 48;
  const place = (box: BoardElement) => ({ ...next, x: side === 'left' ? box.x - next.w - gap : side === 'right' ? box.x + box.w + gap : source.x + (source.w - next.w) / 2, y: side === 'top' ? box.y - next.h - gap : side === 'bottom' ? box.y + box.h + gap : source.y + (source.h - next.h) / 2 });
  let result = place(source);
  const occupied = elements.filter(element => element.id !== source.id && !['stroke', 'container', 'sticker', 'arrow'].includes(element.type));
  for (let index = 0; index < occupied.length; index++) {
    const hit = occupied.find(element => result.x < element.x + element.w + 12 && result.x + result.w + 12 > element.x && result.y < element.y + element.h + 12 && result.y + result.h + 12 > element.y);
    if (!hit) break;
    result = place(hit);
  }
  return result;
}
