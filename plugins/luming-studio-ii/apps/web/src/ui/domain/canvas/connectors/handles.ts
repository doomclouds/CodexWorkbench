import type { CanvasPoint } from '../contracts.js';

export function connectionHandleBends(points: readonly CanvasPoint[]) {
  const bends = points.slice(1, -1);
  const start = points[0];
  const end = points.at(-1);
  if (bends.length || !start || !end) {
    return bends;
  }

  return [{ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }];
}
