import type { CanvasConnection, CanvasConnectorHead, CanvasPoint } from '../contracts.js';
import type { ResolvedConnection } from './geometry.js';
import {
  connectionCircleRadius,
  connectionHeadHalfWidth,
  connectionHeadLength,
  connectionLineWidth,
  connectionPathData,
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
  readonly tip: CanvasPoint;
  readonly neighbor: CanvasPoint;
  readonly strokeWidth: number;
}

const connectorDashPattern = '6 5';
const overviewZoom = 0.5;
const minimumOverviewStroke = 0.7;
export const connectorLabelLift = 28;

function ConnectorHead({ head, tip, neighbor, strokeWidth }: ConnectorHeadProps) {
  if (head === 'none') {
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

  const dx = neighbor.x - tip.x;
  const dy = neighbor.y - tip.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return null;
  }

  const back = Math.min(length, connectionHeadLength * scale);
  const spread = Math.min(back / 2, connectionHeadHalfWidth * scale);
  const center = { x: tip.x + (dx / length) * back, y: tip.y + (dy / length) * back };
  const wing = { x: (dy / length) * spread, y: (dx / length) * spread };
  const points =
    `${center.x - wing.x},${center.y + wing.y} ` +
    `${tip.x},${tip.y} ${center.x + wing.x},${center.y - wing.y}`;

  return (
    <polyline
      points={points}
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
        style={{ color: stroke }}
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
          tip={start}
          neighbor={points[1] ?? start}
          strokeWidth={strokeWidth}
        />
        <ConnectorHead
          head={connection.endHead ?? 'arrow'}
          tip={end}
          neighbor={points.at(-2) ?? end}
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
