import type { CanvasConnection, CanvasConnectorHead, CanvasPoint } from '../contracts.js';
import type { ResolvedConnection } from './geometry.js';
import {
  connectionCircleRadius,
  connectionLineWidth,
  connectionPathData,
  connectorArrowPoints,
} from './path.js';
import './CanvasConnectorPath.css';

interface CanvasConnectorPathProps {
  readonly route: ResolvedConnection;
  readonly connection: CanvasConnection;
  readonly zoom: number;
  readonly label?: string;
  readonly preview?: boolean;
  readonly stroke?: string;
  readonly dashed?: boolean;
}

interface ConnectorHeadProps {
  readonly head: CanvasConnectorHead;
  readonly points: readonly CanvasPoint[];
  readonly atStart?: boolean;
  readonly strokeWidth: number;
}

const connectorDashPattern = '6 5';
const overviewZoom = 0.5;
const minimumOverviewStroke = 0.7;
export const connectorLabelLift = 28;

function ConnectorHead({ head, points, atStart = false, strokeWidth }: ConnectorHeadProps) {
  const tip = atStart ? points[0] : points.at(-1);
  if (!tip || head === 'none') {
    return null;
  }

  const scale = strokeWidth / connectionLineWidth;
  if (head === 'circle') {
    return (
      <circle
        className="studio-ui-canvas-connector-circle"
        cx={tip.x}
        cy={tip.y}
        r={connectionCircleRadius * scale}
        strokeWidth={strokeWidth}
      />
    );
  }

  const arrow = connectorArrowPoints(points, atStart, strokeWidth);
  if (!arrow) {
    return null;
  }

  return (
    <polyline
      points={arrow.map(({ x, y }) => `${x},${y}`).join(' ')}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

export function CanvasConnectorPath({
  route,
  connection,
  zoom,
  label,
  preview = false,
  stroke,
  dashed,
}: CanvasConnectorPathProps) {
  const { geometry, points, strokeWidth, labelPosition } = route;
  const start = points[0];
  const end = points.at(-1);
  if (!start || !end) {
    return null;
  }

  const { x, y, width, height } = geometry;
  const renderedStrokeWidth =
    zoom > 0 && zoom < overviewZoom
      ? Math.max(strokeWidth, minimumOverviewStroke / zoom)
      : strokeWidth;
  const separatePaint = renderedStrokeWidth > strokeWidth;
  const pathData = connectionPathData(points);
  const dashPattern = dashed ? connectorDashPattern : undefined;

  return (
    <>
      <svg
        className="studio-ui-canvas-connector"
        data-canvas-connector-preview={preview || undefined}
        data-canvas-stroke={stroke}
        style={{
          color: stroke === undefined ? undefined : `var(--studio-ui-canvas-stroke, ${stroke})`,
        }}
        viewBox={`${x} ${y} ${width} ${height}`}
        aria-hidden="true"
      >
        <path
          d={pathData}
          data-canvas-geometry-hit=""
          fill="none"
          stroke={separatePaint ? 'transparent' : 'currentColor'}
          strokeWidth={strokeWidth}
          strokeDasharray={dashPattern}
          strokeLinecap="round"
        />
        {separatePaint && (
          <path
            d={pathData}
            fill="none"
            stroke="currentColor"
            strokeWidth={renderedStrokeWidth}
            strokeDasharray={dashPattern}
            strokeLinecap="round"
            pointerEvents="none"
          />
        )}
        <ConnectorHead
          head={connection.startHead ?? 'none'}
          points={points}
          atStart
          strokeWidth={strokeWidth}
        />
        <ConnectorHead
          head={connection.endHead ?? 'arrow'}
          points={points}
          strokeWidth={strokeWidth}
        />
      </svg>
      {label && labelPosition && (
        <div
          className="studio-ui-canvas-connector-label"
          style={{ left: labelPosition.x - x, top: labelPosition.y - y - connectorLabelLift }}
        >
          {label}
        </div>
      )}
    </>
  );
}
