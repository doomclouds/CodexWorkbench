import type { CanvasGeometry, CanvasPoint, CanvasRect } from '../contracts.js';
import type { ProjectedCanvasObject } from '../scene/index.js';
import { containsPoint, normalizeViewport } from '../viewport/index.js';

const sectionEdgePixels = 4;
const radiansPerDegree = Math.PI / 180;

export function hitsSectionEdge(point: CanvasPoint, geometry: CanvasGeometry, zoom: number) {
  const tolerance = sectionEdgePixels / normalizeViewport({ x: 0, y: 0, zoom }).zoom;
  const diameter = tolerance * 2;
  const outer = {
    ...geometry,
    x: geometry.x - tolerance,
    y: geometry.y - tolerance,
    width: geometry.width + diameter,
    height: geometry.height + diameter,
  };

  if (!containsPoint(point, outer)) {
    return false;
  }

  return !containsPoint(point, {
    ...geometry,
    x: geometry.x + tolerance,
    y: geometry.y + tolerance,
    width: geometry.width - diameter,
    height: geometry.height - diameter,
  });
}

function corners({ x, y, width, height, rotation }: CanvasGeometry) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const angle = rotation * radiansPerDegree;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);

  function corner(dx: number, dy: number): CanvasPoint {
    return {
      x: x + halfWidth + dx * cosine - dy * sine,
      y: y + halfHeight + dx * sine + dy * cosine,
    };
  }

  return [
    corner(-halfWidth, -halfHeight),
    corner(halfWidth, -halfHeight),
    corner(halfWidth, halfHeight),
    corner(-halfWidth, halfHeight),
  ];
}

export function withinSection(entry: ProjectedCanvasObject, section: CanvasGeometry) {
  const points = entry.connectorRoute?.points ?? corners(entry.geometry);

  return points.every((point) => containsPoint(point, section));
}

function crossingInterval(start: number, end: number, min: number, max: number) {
  if (start === end) {
    return start >= min && start <= max ? ([0, 1] as const) : undefined;
  }

  const first = (min - start) / (end - start);
  const second = (max - start) / (end - start);

  return [Math.min(first, second), Math.max(first, second)] as const;
}

function crossesRect(start: CanvasPoint, end: CanvasPoint, rect: CanvasRect) {
  const horizontal = crossingInterval(start.x, end.x, rect.x, rect.x + rect.width);
  const vertical = crossingInterval(start.y, end.y, rect.y, rect.y + rect.height);
  if (!horizontal || !vertical) {
    return false;
  }

  const enters = Math.max(0, horizontal[0], vertical[0]);
  const leaves = Math.min(1, horizontal[1], vertical[1]);

  return enters <= leaves;
}

export function crossesSectionEdge(geometry: CanvasGeometry, rect: CanvasRect) {
  const points = corners(geometry);

  return points.some((point, index) => {
    const next = points[(index + 1) % points.length];

    return next !== undefined && crossesRect(point, next, rect);
  });
}
