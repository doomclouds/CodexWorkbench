import type { CanvasPoint } from '../contracts.js';

interface ConnectionSegment {
  readonly start: CanvasPoint;
  readonly end: CanvasPoint;
  readonly turn?: CanvasPoint;
}

export const connectionLineWidth = 2;
export const connectionHeadLength = 10;
export const connectionHeadHalfWidth = 5;
export const connectionCircleRadius = 4;

const cornerRadius = 8;
const cornerSamples = 4;

function interpolate(start: CanvasPoint, end: CanvasPoint, ratio: number): CanvasPoint {
  return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
}

function corner(before: CanvasPoint, bend: CanvasPoint, after: CanvasPoint): ConnectionSegment {
  const beforeLength = Math.hypot(before.x - bend.x, before.y - bend.y);
  const afterLength = Math.hypot(after.x - bend.x, after.y - bend.y);
  const radius = Math.min(cornerRadius, beforeLength / 2, afterLength / 2);

  return {
    start: interpolate(bend, before, beforeLength ? radius / beforeLength : 0),
    turn: bend,
    end: interpolate(bend, after, afterLength ? radius / afterLength : 0),
  };
}

function roundedSegments(points: readonly CanvasPoint[]): readonly ConnectionSegment[] {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) {
    return [];
  }

  const segments: ConnectionSegment[] = [];
  let cursor = first;

  for (let index = 1; index < points.length - 1; index += 1) {
    const before = points[index - 1];
    const bend = points[index];
    const after = points[index + 1];
    if (!before || !bend || !after) {
      continue;
    }

    const arc = corner(before, bend, after);
    segments.push({ start: cursor, end: arc.start }, arc);
    cursor = arc.end;
  }

  segments.push({ start: cursor, end: last });

  return segments;
}

export function connectionPathData(points: readonly CanvasPoint[]) {
  const first = points[0];
  if (!first) {
    return '';
  }

  const parts = roundedSegments(points).map(({ turn, end }) =>
    turn ? `Q ${turn.x} ${turn.y} ${end.x} ${end.y}` : `L ${end.x} ${end.y}`,
  );

  return `M ${first.x} ${first.y} ${parts.join(' ')}`;
}

function hitLine(start: CanvasPoint, end: CanvasPoint, point: CanvasPoint, reach: number) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = dx ** 2 + dy ** 2;
  const projected = length ? ((point.x - start.x) * dx + (point.y - start.y) * dy) / length : 0;
  const near = interpolate(start, end, Math.min(1, Math.max(0, projected)));

  return (point.x - near.x) ** 2 + (point.y - near.y) ** 2 <= reach ** 2;
}

function hitSegment({ start, end, turn }: ConnectionSegment, point: CanvasPoint, reach: number) {
  if (!turn) {
    return hitLine(start, end, point, reach);
  }

  let prior = start;
  for (let index = 1; index <= cornerSamples; index += 1) {
    const ratio = index / cornerSamples;
    const current = interpolate(
      interpolate(start, turn, ratio),
      interpolate(turn, end, ratio),
      ratio,
    );

    if (hitLine(prior, current, point, reach)) {
      return true;
    }

    prior = current;
  }

  return false;
}

export function hitRoundedConnection(
  points: readonly CanvasPoint[],
  point: CanvasPoint,
  reach: number,
) {
  return roundedSegments(points).some((segment) => hitSegment(segment, point, reach));
}
