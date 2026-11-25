import type { CanvasGeometry, CanvasPort, CanvasRect } from '../contracts.js';

interface PlacementRule {
  readonly axis: 'x' | 'y';
  readonly extent: 'width' | 'height';
  readonly direction: 1 | -1;
  readonly opposite: CanvasPort;
}

const portRules = {
  top: { axis: 'y', extent: 'height', direction: -1, opposite: 'bottom' },
  right: { axis: 'x', extent: 'width', direction: 1, opposite: 'left' },
  bottom: { axis: 'y', extent: 'height', direction: 1, opposite: 'top' },
  left: { axis: 'x', extent: 'width', direction: -1, opposite: 'right' },
} as const satisfies Record<CanvasPort, PlacementRule>;

const noteGap = 24;
const shapeGap = 48;
const obstacleClearance = 12;

export function oppositePort(port: CanvasPort): CanvasPort {
  return portRules[port].opposite;
}

function beside(
  source: CanvasGeometry,
  obstacle: CanvasRect,
  { axis, extent, direction }: PlacementRule,
  gap: number,
): CanvasGeometry {
  const offset = direction > 0 ? obstacle[extent] + gap : -(source[extent] + gap);

  return { ...source, [axis]: obstacle[axis] + offset, rotation: 0 };
}

function obstacleSearchBounds({ x, y, width, height }: CanvasGeometry): CanvasRect {
  return {
    x: x - obstacleClearance,
    y: y - obstacleClearance,
    width: width + obstacleClearance * 2,
    height: height + obstacleClearance * 2,
  };
}

export function getAdjacentGeometry(
  source: CanvasGeometry,
  port: CanvasPort,
  findObstacle: (searchBounds: CanvasRect) => CanvasRect | undefined,
  kind: 'shape' | 'note' = 'shape',
): CanvasGeometry {
  const rule = portRules[port];
  const { axis, direction } = rule;
  const gap = kind === 'note' ? noteGap : shapeGap;
  let next = beside(source, source, rule, gap);

  while (true) {
    const obstacle = findObstacle(obstacleSearchBounds(next));
    if (!obstacle) {
      return next;
    }

    const afterObstacle = beside(source, obstacle, rule, gap);
    const advance = (afterObstacle[axis] - next[axis]) * direction;
    if (advance > 0) {
      next = afterObstacle;
      continue;
    }

    return next;
  }
}
