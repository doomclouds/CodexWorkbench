import type { MarkRect, ReaderMark } from '../../contracts/reader';
import { hasMarkContent, pointsRectToViewport, rectEnvelope, type PageGeometry } from './geometry';

export const MARK_PIN_SIZE = 22;
export const MARK_PIN_GUTTER = 28;
export interface MarkPinGroup { marks: ReaderMark[]; x: number; y: number }
const intersects = (a: MarkRect, b: MarkRect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Pins remain beside their own selection; the outer gutter is always available. */
export function layoutMarkPins(marks: ReaderMark[], geometry: PageGeometry, textRects: MarkRect[] = []): MarkPinGroup[] {
  const groups: MarkPinGroup[] = [];
  for (const mark of marks.filter(hasMarkContent)) {
    const envelope = rectEnvelope(mark.rects.map(rect => pointsRectToViewport(rect, geometry, mark.space === 'norm')));
    if (!envelope) continue;
    const y = Math.max(0, Math.min(geometry.viewport.height - MARK_PIN_SIZE, envelope.y - MARK_PIN_SIZE - 4));
    let x = envelope.x + envelope.w + 6;
    const candidate = { x, y, w: MARK_PIN_SIZE, h: MARK_PIN_SIZE };
    if (x + MARK_PIN_SIZE > geometry.viewport.width || textRects.some(rect => intersects(candidate, rect))) x = geometry.viewport.width + 4;
    const collision = groups.find(group => intersects({ x: group.x - 3, y: group.y - 3, w: MARK_PIN_SIZE + 6, h: MARK_PIN_SIZE + 6 }, { x, y, w: MARK_PIN_SIZE, h: MARK_PIN_SIZE }));
    if (collision) collision.marks.push(mark);
    else groups.push({ marks: [mark], x, y });
  }
  return groups;
}

export interface ScreenBounds { left: number; top: number; right: number; bottom: number }
export function placeMarkPopover(anchor: ScreenBounds, boundary: ScreenBounds, width: number, height: number, avoid?: ScreenBounds, textBounds: ScreenBounds[] = []) {
  const gap = 8;
  const source = avoid ?? anchor;
  const clampX = (x: number) => Math.max(boundary.left, Math.min(boundary.right - width, x));
  const clampY = (y: number) => Math.max(boundary.top, Math.min(boundary.bottom - height, y));
  const candidates = [
    { left: Math.max(anchor.right, source.right) + gap, top: clampY(anchor.top - height) },
    { left: clampX(anchor.right - width), top: Math.min(anchor.top, source.top) - height - gap },
    { left: Math.min(anchor.left, source.left) - width - gap, top: clampY(anchor.top) },
    { left: clampX(anchor.left), top: Math.max(anchor.bottom, source.bottom) + gap },
  ];
  const occupied = [source, ...textBounds];
  const free = (candidate: { left: number; top: number }) => candidate.left >= boundary.left && candidate.left + width <= boundary.right && candidate.top >= boundary.top && candidate.top + height <= boundary.bottom && occupied.every(rect => candidate.left >= rect.right || candidate.left + width <= rect.left || candidate.top >= rect.bottom || candidate.top + height <= rect.top);
  const preferred = candidates.find(free);
  if (preferred) return preferred;
  // Nearby lines can obstruct the four primary positions while leaving a safe
  // gap a little farther away. Bound the search; never scan a page-size grid.
  const xs = [...new Set([clampX(Math.max(anchor.right, source.right) + gap), clampX(anchor.left), clampX(anchor.right - width), boundary.left, boundary.right - width])];
  const ys = [...new Set([boundary.top, boundary.bottom - height, ...occupied.flatMap(rect => [rect.bottom + gap, rect.top - height - gap])])]
    .filter(top => top >= boundary.top && top + height <= boundary.bottom)
    .sort((left, right) => Math.abs(left - anchor.top) - Math.abs(right - anchor.top)).slice(0, 16);
  for (const top of ys) for (const left of xs) if (free({ left, top })) return { left, top };
  return null;
}
