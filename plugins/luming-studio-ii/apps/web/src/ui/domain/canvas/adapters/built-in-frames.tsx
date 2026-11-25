import type { ReactNode } from 'react';
import { CanvasConnectorPath } from '../connectors/CanvasConnectorPath.js';
import type { ResolvedConnection } from '../connectors/geometry.js';
import type { CanvasGeometry, CanvasObjectDraft } from '../contracts.js';
import { CanvasInkPath } from '../ink/CanvasInkPath.js';
import { CanvasShapeOutline } from './CanvasShapeOutline.js';

export interface CanvasPrimitiveFrameProps {
  readonly object: CanvasObjectDraft;
  readonly geometry: CanvasGeometry;
  readonly zoom: number;
  readonly content?: ReactNode;
  readonly showCaption: boolean;
  readonly connectorRoute?: ResolvedConnection;
}

const sectionHitWidth = 8;

export function CanvasShapeFrame({
  object,
  geometry,
  content,
  showCaption,
}: CanvasPrimitiveFrameProps) {
  if (object.kind !== 'shape') {
    return null;
  }

  return (
    <>
      <CanvasShapeOutline
        shape={object.shape}
        width={geometry.width}
        height={geometry.height}
        fill={object.fill}
        stroke={object.stroke}
        strokeWidth={object.strokeWidth}
        dashed={object.dashed}
        hollow={object.hollow}
      />
      {showCaption && (
        <div className="studio-ui-canvas-object-label">{content ?? object.label}</div>
      )}
    </>
  );
}

export function CanvasSectionFrame({
  object,
  geometry,
  zoom,
  content,
  showCaption,
}: CanvasPrimitiveFrameProps) {
  if (object.kind !== 'section') {
    return null;
  }

  const { width, height } = geometry;

  return (
    <>
      {showCaption && (
        <div className="studio-ui-canvas-section-title" data-canvas-section-title="">
          {content ?? object.label}
        </div>
      )}
      {object.transparent && (
        <svg
          className="studio-ui-canvas-section-hit-outline"
          aria-hidden="true"
          focusable="false"
          width={width}
          height={height}
        >
          <rect
            data-canvas-section-edge=""
            width={width}
            height={height}
            fill="none"
            stroke="transparent"
            strokeWidth={sectionHitWidth / zoom}
          />
        </svg>
      )}
    </>
  );
}

export function CanvasInkFrame({
  object,
  geometry,
  zoom,
  content,
  showCaption,
}: CanvasPrimitiveFrameProps) {
  if (object.kind !== 'ink') {
    return null;
  }

  return (
    <>
      <CanvasInkPath
        ink={object.ink}
        width={geometry.width}
        height={geometry.height}
        zoom={zoom}
        stroke={object.stroke}
        dashed={object.dashed}
      />
      {showCaption && content && <div className="studio-ui-canvas-object-label">{content}</div>}
    </>
  );
}

export function CanvasConnectorFrame({
  object,
  connectorRoute,
  content,
  showCaption,
}: CanvasPrimitiveFrameProps) {
  if (object.kind !== 'connector' || !connectorRoute) {
    return null;
  }

  const { labelPosition, geometry } = connectorRoute;
  const customCaption = showCaption && content != null;
  const defaultCaption = showCaption && !customCaption ? object.label : '';

  return (
    <>
      <CanvasConnectorPath
        route={connectorRoute}
        connection={object.connection}
        label={defaultCaption}
        stroke={object.stroke}
        dashed={object.dashed}
      />
      {customCaption && labelPosition && (
        <div
          className="studio-ui-canvas-connector-label"
          style={{ left: labelPosition.x - geometry.x, top: labelPosition.y - geometry.y }}
        >
          {content}
        </div>
      )}
    </>
  );
}
