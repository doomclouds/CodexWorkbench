import { useMemo } from 'react';
import type { CanvasInk } from '../contracts.js';
import { inkPathData, renderedInkWidth } from './geometry.js';

interface CanvasInkPathProps {
  ink: CanvasInk;
  width: number;
  height: number;
  zoom?: number;
  stroke?: string;
  dashed?: boolean;
}

const inkStyle = { display: 'block', overflow: 'visible', pointerEvents: 'none' } as const;
const dashPattern = '6 5';

export function CanvasInkPath({
  ink,
  width,
  height,
  zoom = 1,
  stroke,
  dashed,
}: CanvasInkPathProps) {
  const path = useMemo(() => inkPathData(ink, width, height), [ink, width, height]);
  const first = ink.points[0];
  if (!first) {
    return null;
  }

  const strokeWidth = renderedInkWidth(ink, zoom);
  const dot = ink.points.length === 1;
  const style =
    stroke === undefined
      ? inkStyle
      : { ...inkStyle, color: 'var(--studio-ui-canvas-stroke, ' + stroke + ')' };

  return (
    <svg width="100%" height="100%" aria-hidden="true" style={style} data-canvas-stroke={stroke}>
      {dot ? (
        <circle
          cx={first.x * width}
          cy={first.y * height}
          r={strokeWidth / 2}
          fill="currentColor"
          data-canvas-geometry-hit=""
        />
      ) : (
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={dashed ? dashPattern : undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
          data-canvas-geometry-hit=""
        />
      )}
    </svg>
  );
}
