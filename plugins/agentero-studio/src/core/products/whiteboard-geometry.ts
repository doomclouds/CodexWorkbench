import type { BoardElement } from '../../contracts/studio.js';

export interface Point { x: number; y: number }
/** Midpoint quadratics smooth pen strokes; repeated points keep deliberate corners. */
export function strokePath(coordinates: readonly number[] = [], offset: Point = { x: 0, y: 0 }): string {
  const points: Point[] = [];
  for (let index = 0; index + 1 < coordinates.length; index += 2) points.push({ x: coordinates[index]! + offset.x, y: coordinates[index + 1]! + offset.y });
  if (!points.length) return '';
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const point = points[index]!, next = points[index + 1]!;
    path += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`;
  }
  const last = points.at(-1)!;
  return `${path} L ${last.x} ${last.y}`;
}
export type ArrowHead = 'none' | 'arrow' | 'circle';
export function arrowHeads(arrow: BoardElement): [ArrowHead, ArrowHead] {
  const heads = arrow.heads;
  if (Array.isArray(heads) && heads.length === 2 && heads.every(head => ['none', 'arrow', 'circle'].includes(head))) return heads as [ArrowHead, ArrowHead];
  return [arrow.head === 'both' ? 'arrow' : 'none', arrow.head === 'none' ? 'none' : 'arrow'];
}

function rotatePoint(point: Point, center: Point, degrees: number): Point {
  const angle = degrees % 360 * Math.PI / 180;
  if (!angle) return point;
  const cosine = Math.cos(angle), sine = Math.sin(angle), dx = point.x - center.x, dy = point.y - center.y;
  return { x: center.x + dx * cosine - dy * sine, y: center.y + dx * sine + dy * cosine };
}

export function arrowEnd(element: BoardElement | undefined, side: string | undefined, other: Point, fallback: Point): Point {
  if (!element) return fallback;
  const center = { x: element.x + element.w / 2, y: element.y + element.h / 2 };
  const localOther = rotatePoint(other, center, -(element.rotation ?? 0));
  const resolved = side ?? (Math.abs(localOther.x - center.x) > Math.abs(localOther.y - center.y) ? localOther.x >= center.x ? 'right' : 'left' : localOther.y >= center.y ? 'bottom' : 'top');
  const anchor = resolved === 'left' ? { x: element.x, y: center.y } : resolved === 'right' ? { x: element.x + element.w, y: center.y } : resolved === 'top' ? { x: center.x, y: element.y } : { x: center.x, y: element.y + element.h };
  return rotatePoint(anchor, center, element.rotation ?? 0);
}

function roundedPolyline(points: Point[], radius = 8): string {
  if (!points.length) return '';
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1]!, current = points[index]!, next = points[index + 1]!;
    const beforeLength = Math.hypot(current.x - previous.x, current.y - previous.y), afterLength = Math.hypot(next.x - current.x, next.y - current.y);
    const r = Math.min(radius, beforeLength / 2, afterLength / 2);
    if (!r) { path += ` L ${current.x} ${current.y}`; continue; }
    const before = { x: current.x + (previous.x - current.x) / beforeLength * r, y: current.y + (previous.y - current.y) / beforeLength * r };
    const after = { x: current.x + (next.x - current.x) / afterLength * r, y: current.y + (next.y - current.y) / afterLength * r };
    path += ` L ${before.x} ${before.y} Q ${current.x} ${current.y} ${after.x} ${after.y}`;
  }
  return `${path} L ${points.at(-1)!.x} ${points.at(-1)!.y}`;
}

/** Native bends alternate relative coordinates, the first half from the source centre, the rest from the target. */
export function arrowGeometry(arrow: BoardElement, elements: readonly BoardElement[]): { path: string; points: Point[]; label: Point } {
  const fromElement = typeof arrow.from === 'string' ? elements.find(e => e.id === arrow.from) : undefined;
  const toElement = typeof arrow.to === 'string' ? elements.find(e => e.id === arrow.to) : undefined;
  const center = (e: BoardElement | undefined, value: BoardElement['from'], fallback: Point) => e ? { x: e.x + e.w / 2, y: e.y + e.h / 2 } : Array.isArray(value) ? { x: value[0], y: value[1] } : fallback;
  const fromCenter = center(fromElement, arrow.from, { x: arrow.x, y: arrow.y });
  const toCenter = center(toElement, arrow.to, { x: arrow.x + arrow.w, y: arrow.y + arrow.h });
  let from = arrowEnd(fromElement, arrow.fromSide, toCenter, fromCenter), to = arrowEnd(toElement, arrow.toSide, fromCenter, toCenter);
  let points: Point[] | undefined;
  const bends: unknown[] = Array.isArray(arrow.bends) ? arrow.bends : [];
  if ((bends[0] === 'h' || bends[0] === 'v') && bends.length > 1 && bends.length <= 13 && bends.slice(1).every(value => typeof value === 'number' && Number.isFinite(value))) {
    const firstHorizontal = bends[0] === 'h';
    const offsets = bends.slice(1) as number[];
    const at = offsets.map((offset, index) => {
      const origin = index < Math.ceil(offsets.length / 2) ? fromCenter : toCenter;
      return offset + (firstHorizontal === (index % 2 === 0) ? origin.x : origin.y);
    });
    const firstOther = firstHorizontal ? { x: at[0]!, y: fromCenter.y } : { x: fromCenter.x, y: at[0]! };
    const nextHorizontal = firstHorizontal === (offsets.length % 2 === 0);
    const lastOther = nextHorizontal ? { x: toCenter.x, y: at.at(-1)! } : { x: at.at(-1)!, y: toCenter.y };
    from = arrowEnd(fromElement, arrow.fromSide ?? ((fromElement?.rotation ?? 0) % 360 ? undefined : firstHorizontal ? firstOther.x >= fromCenter.x ? 'right' : 'left' : firstOther.y >= fromCenter.y ? 'bottom' : 'top'), firstOther, fromCenter);
    to = arrowEnd(toElement, arrow.toSide ?? ((toElement?.rotation ?? 0) % 360 ? undefined : nextHorizontal ? lastOther.y >= toCenter.y ? 'bottom' : 'top' : lastOther.x >= toCenter.x ? 'right' : 'left'), lastOther, toCenter);
    points = [from];
    let cursor = from;
    at.forEach((coordinate, index) => { cursor = firstHorizontal === (index % 2 === 0) ? { x: coordinate, y: cursor.y } : { x: cursor.x, y: coordinate }; points!.push(cursor); });
    points.push(nextHorizontal ? { x: to.x, y: cursor.y } : { x: cursor.x, y: to.y }, to);
    const clearsEnd = (element: BoardElement | undefined, endpoint: Point, neighbor: Point, side: string | undefined) => {
      if (!element) return true;
      if ((element.rotation ?? 0) % 360) {
        const center = { x: element.x + element.w / 2, y: element.y + element.h / 2 };
        const localEnd = rotatePoint(endpoint, center, -element.rotation!), localNeighbor = rotatePoint(neighbor, center, -element.rotation!);
        return (localNeighbor.x - localEnd.x) * (localEnd.x - center.x) + (localNeighbor.y - localEnd.y) * (localEnd.y - center.y) > 0;
      }
      if (side === 'left' || endpoint.x === element.x && endpoint.y === element.y + element.h / 2) return neighbor.y === endpoint.y && neighbor.x < endpoint.x;
      if (side === 'right' || endpoint.x === element.x + element.w && endpoint.y === element.y + element.h / 2) return neighbor.y === endpoint.y && neighbor.x > endpoint.x;
      if (side === 'top' || endpoint.y === element.y) return neighbor.x === endpoint.x && neighbor.y < endpoint.y;
      return neighbor.x === endpoint.x && neighbor.y > endpoint.y;
    };
    // A route inside a bound shape or against an explicit side falls back to the automatic route.
    if (!clearsEnd(fromElement, from, points[1]!, arrow.fromSide) || !clearsEnd(toElement, to, points.at(-2)!, arrow.toSide) || points.some((point, index) => index > 0 && point.x !== points![index - 1]!.x && point.y !== points![index - 1]!.y)) points = undefined;
  } else if (bends.length >= 2 && bends.length % 2 === 0 && bends.every(value => typeof value === 'number' && Number.isFinite(value))) {
    points = [from];
    for (let index = 0; index < bends.length; index += 2) points.push({ x: bends[index] as number, y: bends[index + 1] as number });
    points.push(to);
  }
  if (!points) {
    from = arrowEnd(fromElement, arrow.fromSide, toCenter, fromCenter); to = arrowEnd(toElement, arrow.toSide, fromCenter, toCenter);
    if (Math.abs(from.x - to.x) < 1 || Math.abs(from.y - to.y) < 1) points = [from, to];
    else {
      const horizontal = arrow.fromSide === 'left' || arrow.fromSide === 'right' || (!arrow.fromSide && Math.abs(to.x - from.x) >= Math.abs(to.y - from.y));
      points = horizontal ? [from, { x: (from.x + to.x) / 2, y: from.y }, { x: (from.x + to.x) / 2, y: to.y }, to] : [from, { x: from.x, y: (from.y + to.y) / 2 }, { x: to.x, y: (from.y + to.y) / 2 }, to];
    }
  }
  points = points.filter((point, index) => index === 0 || point.x !== points![index - 1]!.x || point.y !== points![index - 1]!.y);
  const middle = Math.floor((points.length - 1) / 2), left = points[middle]!, right = points[middle + 1] ?? left;
  return { path: roundedPolyline(points), points, label: { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 } };
}

export function shapePath(element: BoardElement): string {
  const { w, h, kind = 'rounded' } = element;
  if (kind === 'person') { const r = Math.min(w * .19, h * .16), cx = w / 2, cy = h * .17; return `M ${cx-r} ${cy} A ${r} ${r} 0 1 0 ${cx+r} ${cy} A ${r} ${r} 0 1 0 ${cx-r} ${cy} Z M ${w * .12} ${h} V ${h * .55} C ${w * .12} ${h * .3} ${w * .88} ${h * .3} ${w * .88} ${h * .55} V ${h} Z`; }
  if (kind === 'diamond') return `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`;
  if (kind === 'hexagon') return `M ${w * .18} 0 H ${w * .82} L ${w} ${h / 2} L ${w * .82} ${h} H ${w * .18} L 0 ${h / 2} Z`;
  if (kind === 'parallelogram') return `M ${w * .18} 0 H ${w} L ${w * .82} ${h} H 0 Z`;
  if (kind === 'database') return `M 0 18 C 0 -6 ${w} -6 ${w} 18 V ${h - 18} C ${w} ${h + 6} 0 ${h + 6} 0 ${h - 18} Z M 0 18 C 0 42 ${w} 42 ${w} 18`;
  if (kind === 'document') return `M 0 0 H ${w} V ${h - 15} Q ${w * .75} ${h - 35} ${w / 2} ${h - 15} Q ${w * .25} ${h + 5} 0 ${h - 15} Z`;
  if (kind === 'cloud') return `M ${w * .2} ${h * .8} C ${-w * .08} ${h * .8} ${-w * .03} ${h * .25} ${w * .25} ${h * .28} C ${w * .27} ${-h * .03} ${w * .7} ${-h * .03} ${w * .75} ${h * .3} C ${w * 1.07} ${h * .25} ${w * 1.09} ${h * .8} ${w * .8} ${h * .8} Z`;
  return '';
}
