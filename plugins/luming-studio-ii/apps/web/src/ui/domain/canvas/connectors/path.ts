import {
  connectionPathData as resolvedPathData,
  connectorArrowPoints as resolvedArrowPoints,
  roundedConnectorSegments,
  type ConnectorSegment,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/connector-route';
import type { CanvasPoint } from '../contracts.js';

export const connectionLineWidth = 2;
export const connectionCircleRadius = 4;

const cornerSamples = 4;

function interpolate(start: CanvasPoint, end: CanvasPoint, ratio: number): CanvasPoint {
  return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
}

export function connectionPathData(points: readonly CanvasPoint[]) {
  return resolvedPathData(points);
}

export function connectorArrowPoints(
  points: readonly CanvasPoint[],
  atStart: boolean,
  strokeWidth: number,
) {
  return resolvedArrowPoints(points, atStart, strokeWidth);
}

function hitLine(start: CanvasPoint, end: CanvasPoint, point: CanvasPoint, reach: number) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = dx ** 2 + dy ** 2;
  const projected = length ? ((point.x - start.x) * dx + (point.y - start.y) * dy) / length : 0;
  const near = interpolate(start, end, Math.min(1, Math.max(0, projected)));

  return (point.x - near.x) ** 2 + (point.y - near.y) ** 2 <= reach ** 2;
}

function hitSegment({ start, end, turn }: ConnectorSegment, point: CanvasPoint, reach: number) {
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
  return roundedConnectorSegments(points).some((segment) => hitSegment(segment, point, reach));
}
