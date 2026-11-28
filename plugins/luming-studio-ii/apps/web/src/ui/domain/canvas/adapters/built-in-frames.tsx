import type { CSSProperties, ReactNode } from 'react';
import { CanvasConnectorPath, connectorLabelLift } from '../connectors/CanvasConnectorPath.js';
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
  readonly selected: boolean;
  readonly connectorRoute?: ResolvedConnection;
}

const sectionHitWidth = 8;
const sectionCaptionFontSize = 17;
const sectionOverview = { fontSize: 12, height: 16, gap: 4 };
const connectorCaptionFontSize = 13;
const minimumConnectorCaptionPixels = 8;

interface SectionOverviewStyle extends CSSProperties {
  '--studio-ui-section-overview-font'?: string;
  '--studio-ui-section-overview-line'?: string;
  '--studio-ui-section-overview-gap'?: string;
}

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
        <div
          className={
            object.shape === 'person'
              ? 'studio-ui-canvas-object-label studio-ui-canvas-object-label--person'
              : 'studio-ui-canvas-object-label'
          }
        >
          {content ?? object.label}
        </div>
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
  const overview = zoom < 1 && sectionCaptionFontSize * zoom < sectionOverview.fontSize;
  const captionFits = width * zoom >= 30 && height * zoom >= 12;
  const overviewStyle: SectionOverviewStyle | undefined = overview
    ? {
        '--studio-ui-section-overview-font': `${sectionOverview.fontSize / zoom}px`,
        '--studio-ui-section-overview-line': `${sectionOverview.height / zoom}px`,
        '--studio-ui-section-overview-gap': `${sectionOverview.gap / zoom}px`,
      }
    : undefined;

  return (
    <>
      {showCaption && (
        <div
          className="studio-ui-canvas-section-title"
          data-canvas-section-title=""
          data-canvas-caption-below-threshold={(overview && !captionFits) || undefined}
          data-overview={overview || undefined}
          style={overviewStyle}
          title={overview ? object.label : undefined}
        >
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
  zoom,
  content,
  showCaption,
  selected,
}: CanvasPrimitiveFrameProps) {
  if (object.kind !== 'connector' || !connectorRoute) {
    return null;
  }

  const { labelPosition, geometry } = connectorRoute;
  const readableCaption =
    showCaption && connectorCaptionFontSize * zoom >= minimumConnectorCaptionPixels;
  const customCaption = readableCaption && content != null;
  const defaultCaption = readableCaption && !customCaption ? object.label : '';

  return (
    <>
      <CanvasConnectorPath
        route={connectorRoute}
        connection={object.connection}
        zoom={zoom}
        label={defaultCaption}
        stroke={selected ? 'var(--studio-ui-accent, #eb6c36)' : object.stroke}
        dashed={object.dashed}
      />
      {customCaption && labelPosition && (
        <div
          className="studio-ui-canvas-connector-label"
          style={{
            left: labelPosition.x - geometry.x,
            top: labelPosition.y - geometry.y - connectorLabelLift,
          }}
        >
          {content}
        </div>
      )}
    </>
  );
}
