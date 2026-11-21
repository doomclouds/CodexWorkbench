import type { BoardElement } from '../../contracts/studio.js';

export interface Point {
  x: number;
  y: number;
}

export function arrowLabelBox(
  element: BoardElement,
  at: Point,
): { x: number; y: number; w: number; h: number } | undefined {
  if (!element.label) {
    return;
  }

  const w = element.labelSize?.w ?? Math.max(28, [...element.label].length * 14 + 16);
  const h = element.labelSize?.h ?? 20;

  return { x: at.x - w / 2, y: at.y - (element.labelSize ? h / 2 : 22), w, h };
}

export function strokePath(
  coordinates: readonly number[] = [],
  offset: Point = { x: 0, y: 0 },
): string {
  const points: Point[] = [];
  for (let index = 0; index + 1 < coordinates.length; index += 2) {
    points.push({ x: coordinates[index]! + offset.x, y: coordinates[index + 1]! + offset.y });
  }

  if (!points.length) {
    return '';
  }

  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const point = points[index]!;
    const next = points[index + 1]!;
    path += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`;
  }

  const last = points.at(-1)!;

  return `${path} L ${last.x} ${last.y}`;
}

export type ArrowHead = 'none' | 'arrow' | 'circle';

export function arrowHeads(arrow: BoardElement): [ArrowHead, ArrowHead] {
  const heads = arrow.heads;
  if (
    Array.isArray(heads) &&
    heads.length === 2 &&
    heads.every((head) => ['none', 'arrow', 'circle'].includes(head))
  ) {
    return heads as [ArrowHead, ArrowHead];
  }

  return [arrow.head === 'both' ? 'arrow' : 'none', arrow.head === 'none' ? 'none' : 'arrow'];
}

function rotatePoint(point: Point, center: Point, degrees: number): Point {
  const angle = ((degrees % 360) * Math.PI) / 180;
  if (!angle) {
    return point;
  }

  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return { x: center.x + dx * cosine - dy * sine, y: center.y + dx * sine + dy * cosine };
}

export function arrowEnd(
  element: BoardElement | undefined,
  side: string | undefined,
  other: Point,
  fallback: Point,
): Point {
  if (!element) {
    return fallback;
  }

  const center = { x: element.x + element.w / 2, y: element.y + element.h / 2 };
  const localOther = rotatePoint(other, center, -(element.rotation ?? 0));
  const horizontal = Math.abs(localOther.x - center.x) > Math.abs(localOther.y - center.y);
  const resolved = side ?? sideToward(center, localOther, horizontal);
  const anchor = sideAnchor(element, center, resolved);

  return rotatePoint(anchor, center, element.rotation ?? 0);
}

function sideToward(center: Point, other: Point, horizontal: boolean): string {
  if (horizontal) {
    return other.x >= center.x ? 'right' : 'left';
  }

  return other.y >= center.y ? 'bottom' : 'top';
}

function sideAnchor(element: BoardElement, center: Point, side: string): Point {
  if (side === 'left') {
    return { x: element.x, y: center.y };
  }
  if (side === 'right') {
    return { x: element.x + element.w, y: center.y };
  }

  return { x: center.x, y: side === 'top' ? element.y : element.y + element.h };
}

function roundedPolyline(points: Point[], radius = 8): string {
  if (!points.length) {
    return '';
  }

  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const beforeLength = Math.hypot(current.x - previous.x, current.y - previous.y);
    const afterLength = Math.hypot(next.x - current.x, next.y - current.y);
    const r = Math.min(radius, beforeLength / 2, afterLength / 2);
    if (!r) {
      path += ` L ${current.x} ${current.y}`;
      continue;
    }

    const before = {
      x: current.x + ((previous.x - current.x) / beforeLength) * r,
      y: current.y + ((previous.y - current.y) / beforeLength) * r,
    };
    const after = {
      x: current.x + ((next.x - current.x) / afterLength) * r,
      y: current.y + ((next.y - current.y) / afterLength) * r,
    };
    path += ` L ${before.x} ${before.y} Q ${current.x} ${current.y} ${after.x} ${after.y}`;
  }

  return `${path} L ${points.at(-1)!.x} ${points.at(-1)!.y}`;
}

interface ArrowEndpoint {
  element: BoardElement | undefined;
  center: Point;
  side: string | undefined;
}

export type ArrowElementIndex = ReadonlyMap<string, BoardElement>;
type ArrowElementSource = readonly BoardElement[] | ArrowElementIndex;

export function createArrowElementIndex(elements: readonly BoardElement[]): ArrowElementIndex {
  const byId = new Map<string, BoardElement>();
  for (const element of elements) {
    const id = element.id;
    if (!byId.has(id)) {
      byId.set(id, element);
    }
  }

  return byId;
}

function arrowEndpoint(
  value: BoardElement['from'],
  side: string | undefined,
  elements: ArrowElementSource,
  fallback: Point,
): ArrowEndpoint {
  let element: BoardElement | undefined;
  if (typeof value === 'string') {
    element =
      'get' in elements
        ? elements.get(value)
        : elements.find((candidate) => candidate.id === value);
  }

  if (element) {
    return {
      element,
      side,
      center: { x: element.x + element.w / 2, y: element.y + element.h / 2 },
    };
  }

  return { element, side, center: Array.isArray(value) ? { x: value[0], y: value[1] } : fallback };
}

function clearsEnd(
  { element, side, center }: ArrowEndpoint,
  endpoint: Point,
  neighbor: Point,
): boolean {
  if (!element) {
    return true;
  }

  const rotation = element.rotation ?? 0;
  if (rotation % 360) {
    const localEnd = rotatePoint(endpoint, center, -rotation);
    const localNeighbor = rotatePoint(neighbor, center, -rotation);

    return (
      (localNeighbor.x - localEnd.x) * (localEnd.x - center.x) +
        (localNeighbor.y - localEnd.y) * (localEnd.y - center.y) >
      0
    );
  }
  if (side === 'left' || (endpoint.x === element.x && endpoint.y === center.y)) {
    return neighbor.y === endpoint.y && neighbor.x < endpoint.x;
  }
  if (side === 'right' || (endpoint.x === element.x + element.w && endpoint.y === center.y)) {
    return neighbor.y === endpoint.y && neighbor.x > endpoint.x;
  }
  if (side === 'top' || endpoint.y === element.y) {
    return neighbor.x === endpoint.x && neighbor.y < endpoint.y;
  }

  return neighbor.x === endpoint.x && neighbor.y > endpoint.y;
}

function anchorWithBend(endpoint: ArrowEndpoint, other: Point, horizontal: boolean): Point {
  const { center, element } = endpoint;
  let side = endpoint.side ?? undefined;
  if (side === undefined && !((element?.rotation ?? 0) % 360)) {
    side = sideToward(center, other, horizontal);
  }

  return arrowEnd(element, side, other, center);
}

function offsetBendPoints(
  offsets: readonly number[],
  firstHorizontal: boolean,
  start: ArrowEndpoint,
  end: ArrowEndpoint,
): Point[] | undefined {
  const nextHorizontal = firstHorizontal === (offsets.length % 2 === 0);
  const coordinates = offsets.map((offset, index) => {
    const center = index < Math.ceil(offsets.length / 2) ? start.center : end.center;

    return offset + (firstHorizontal === (index % 2 === 0) ? center.x : center.y);
  });
  const first = coordinates[0]!;
  const last = coordinates.at(-1)!;
  const firstOther = firstHorizontal
    ? { x: first, y: start.center.y }
    : { x: start.center.x, y: first };
  const lastOther = nextHorizontal ? { x: end.center.x, y: last } : { x: last, y: end.center.y };
  const from = anchorWithBend(start, firstOther, firstHorizontal);
  const to = anchorWithBend(end, lastOther, !nextHorizontal);
  const points = [from];
  let cursor = from;
  coordinates.forEach((coordinate, index) => {
    cursor =
      firstHorizontal === (index % 2 === 0)
        ? { x: coordinate, y: cursor.y }
        : { x: cursor.x, y: coordinate };
    points.push(cursor);
  });
  points.push(nextHorizontal ? { x: to.x, y: cursor.y } : { x: cursor.x, y: to.y }, to);
  if (!clearsEnd(start, from, points[1]!) || !clearsEnd(end, to, points.at(-2)!)) {
    return undefined;
  }

  const diagonal = points.some((point, index) => {
    const previous = points[index - 1];

    return previous && point.x !== previous.x && point.y !== previous.y;
  });

  return diagonal ? undefined : points;
}

function finiteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function arrowPoints(arrow: BoardElement, start: ArrowEndpoint, end: ArrowEndpoint): Point[] {
  const bends: unknown[] = Array.isArray(arrow.bends) ? arrow.bends : [];
  const axis = bends[0];
  const identifiesAxis = axis === 'h' || axis === 'v';
  if (identifiesAxis && bends.length > 1 && bends.length <= 13) {
    const offsets = bends.slice(1);
    if (offsets.every(finiteCoordinate)) {
      const points = offsetBendPoints(offsets, axis === 'h', start, end);
      if (points) {
        return points;
      }
    }
  }

  const from = arrowEnd(start.element, start.side, end.center, start.center);
  const to = arrowEnd(end.element, end.side, start.center, end.center);
  if (bends.length >= 2 && bends.length % 2 === 0 && bends.every(finiteCoordinate)) {
    const points = [from];
    for (let index = 0; index < bends.length; index += 2) {
      points.push({ x: bends[index]!, y: bends[index + 1]! });
    }

    points.push(to);

    return points;
  }

  return automaticArrowPoints(from, to, start.side);
}

function automaticArrowPoints(from: Point, to: Point, side: string | undefined): Point[] {
  if (Math.abs(from.x - to.x) < 1 || Math.abs(from.y - to.y) < 1) {
    return [from, to];
  }

  const horizontal =
    side === 'left' ||
    side === 'right' ||
    (!side && Math.abs(to.x - from.x) >= Math.abs(to.y - from.y));

  if (horizontal) {
    const middleX = (from.x + to.x) / 2;

    return [from, { x: middleX, y: from.y }, { x: middleX, y: to.y }, to];
  }

  const middleY = (from.y + to.y) / 2;

  return [from, { x: from.x, y: middleY }, { x: to.x, y: middleY }, to];
}

export function arrowGeometry(
  arrow: BoardElement,
  elements: ArrowElementSource,
): { path: string; points: Point[]; label: Point } {
  const start = arrowEndpoint(arrow.from, arrow.fromSide, elements, { x: arrow.x, y: arrow.y });
  const end = arrowEndpoint(arrow.to, arrow.toSide, elements, {
    x: arrow.x + arrow.w,
    y: arrow.y + arrow.h,
  });
  const points = arrowPoints(arrow, start, end).filter((point, index, route) => {
    const previous = route[index - 1];

    return !previous || point.x !== previous.x || point.y !== previous.y;
  });
  const middle = Math.floor((points.length - 1) / 2);
  const left = points[middle]!;
  const right = points[middle + 1] ?? left;

  return {
    path: roundedPolyline(points),
    points,
    label: {
      x: (left.x + right.x) / 2 + (arrow.labelOffset?.x ?? 0),
      y: (left.y + right.y) / 2 + (arrow.labelOffset?.y ?? 0),
    },
  };
}

export function shapePath(element: BoardElement): string {
  const { w, h, kind = 'rounded' } = element;
  if (kind === 'person') {
    const r = Math.min(w * 0.19, h * 0.16);
    const cx = w / 2;
    const cy = h * 0.17;

    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z M ${w * 0.12} ${h} V ${h * 0.55} C ${w * 0.12} ${h * 0.3} ${w * 0.88} ${h * 0.3} ${w * 0.88} ${h * 0.55} V ${h} Z`;
  }
  if (kind === 'diamond') {
    return `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`;
  }
  if (kind === 'hexagon') {
    return `M ${w * 0.18} 0 H ${w * 0.82} L ${w} ${h / 2} L ${w * 0.82} ${h} H ${w * 0.18} L 0 ${h / 2} Z`;
  }
  if (kind === 'parallelogram') {
    return `M ${w * 0.18} 0 H ${w} L ${w * 0.82} ${h} H 0 Z`;
  }
  if (kind === 'database') {
    return `M 0 18 C 0 -6 ${w} -6 ${w} 18 V ${h - 18} C ${w} ${h + 6} 0 ${h + 6} 0 ${h - 18} Z M 0 18 C 0 42 ${w} 42 ${w} 18`;
  }
  if (kind === 'document') {
    return `M 0 0 H ${w} V ${h - 15} Q ${w * 0.75} ${h - 35} ${w / 2} ${h - 15} Q ${w * 0.25} ${h + 5} 0 ${h - 15} Z`;
  }
  if (kind === 'cloud') {
    return `M ${w * 0.2} ${h * 0.8} C ${-w * 0.08} ${h * 0.8} ${-w * 0.03} ${h * 0.25} ${w * 0.25} ${h * 0.28} C ${w * 0.27} ${-h * 0.03} ${w * 0.7} ${-h * 0.03} ${w * 0.75} ${h * 0.3} C ${w * 1.07} ${h * 0.25} ${w * 1.09} ${h * 0.8} ${w * 0.8} ${h * 0.8} Z`;
  }

  return '';
}
