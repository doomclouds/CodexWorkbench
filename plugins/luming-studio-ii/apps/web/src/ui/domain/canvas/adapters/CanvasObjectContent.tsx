import type { ReactNode } from 'react';

import { CanvasConnectorPath } from '../connectors/CanvasConnectorPath.js';
import type { ResolvedConnection } from '../connectors/geometry.js';
import type { CanvasGeometry, CanvasObjectDraft } from '../contracts.js';
import { CanvasInkPath } from '../ink/CanvasInkPath.js';
import { CanvasShapeOutline } from './CanvasShapeOutline.js';
import './CanvasObjectContent.css';

interface CanvasObjectContentProps {
  object: CanvasObjectDraft;
  geometry: CanvasGeometry;
  zoom: number;
  content: ReactNode;
  connectorRoute?: ResolvedConnection;
  contentInert: boolean;
}

interface CanvasSectionContentProps {
  label: string;
  transparent?: boolean;
  geometry: CanvasGeometry;
  zoom: number;
}

const sectionHitWidth = 8;

function CanvasSectionContent({ label, transparent, geometry, zoom }: CanvasSectionContentProps) {
  const { width, height } = geometry;

  return (
    <>
      <div className="studio-ui-canvas-section-title" data-canvas-section-title="">
        {label}
      </div>
      {transparent && (
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

export function CanvasObjectContent({
  object,
  geometry,
  zoom,
  content,
  connectorRoute,
  contentInert,
}: CanvasObjectContentProps) {
  const { label } = object;
  const { width, height } = geometry;

  switch (object.kind) {
    case 'shape':
      return (
        <>
          <CanvasShapeOutline
            shape={object.shape}
            width={width}
            height={height}
            fill={object.fill}
            stroke={object.stroke}
            strokeWidth={object.strokeWidth}
            dashed={object.dashed}
            hollow={object.hollow}
          />
          <div className="studio-ui-canvas-object-label">{content ?? label}</div>
        </>
      );
    case 'section':
      return (
        <CanvasSectionContent
          label={label}
          transparent={object.transparent}
          geometry={geometry}
          zoom={zoom}
        />
      );
    case 'ink':
      return (
        <CanvasInkPath
          ink={object.ink}
          width={width}
          height={height}
          zoom={zoom}
          stroke={object.stroke}
          dashed={object.dashed}
        />
      );
    case 'connector':
      return connectorRoute ? (
        <CanvasConnectorPath
          route={connectorRoute}
          connection={object.connection}
          label={label}
          stroke={object.stroke}
          dashed={object.dashed}
        />
      ) : null;
    case 'text':
    case 'note':
    case 'sticker':
      return <div className="studio-ui-canvas-object-label">{content ?? label}</div>;
    case 'native':
    case 'html':
    case 'document':
    case 'todo':
    case 'table':
    case 'image':
    case 'video':
    case 'link':
    case 'diagram':
    case 'chart':
      return (
        <>
          <div className="studio-ui-canvas-native-title">{label}</div>
          <div
            className="studio-ui-canvas-native-content"
            data-canvas-native={contentInert ? undefined : ''}
            inert={contentInert}
          >
            {content}
          </div>
        </>
      );
  }
}
