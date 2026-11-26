import type { Geometry, Point } from './model.js';

const radiansPerDegree = Math.PI / 180;
const degreesPerTurn = 360;

function rotationOf({ rotation }: Geometry) {
  const angle = (rotation % degreesPerTurn) * radiansPerDegree;

  return { cosine: Math.cos(angle), sine: Math.sin(angle) };
}

function corners(geometry: Geometry): readonly Point[] {
  const { x, y, width, height } = geometry;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const { cosine, sine } = rotationOf(geometry);
  const offsets = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ];

  return offsets.map(({ x: dx, y: dy }) => ({
    x: x + halfWidth + dx * cosine - dy * sine,
    y: y + halfHeight + dx * sine + dy * cosine,
  }));
}

export function sectionContains(section: Geometry, candidate: Geometry): boolean {
  const halfWidth = section.width / 2;
  const halfHeight = section.height / 2;
  const { cosine, sine } = rotationOf(section);
  const tolerance = Number.EPSILON * Math.max(halfWidth, halfHeight);

  return corners(candidate).every(({ x, y }) => {
    const dx = x - section.x - halfWidth;
    const dy = y - section.y - halfHeight;
    const localX = dx * cosine + dy * sine;
    const localY = -dx * sine + dy * cosine;

    return Math.abs(localX) <= halfWidth + tolerance && Math.abs(localY) <= halfHeight + tolerance;
  });
}
