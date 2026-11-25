import type { ComponentType, ReactNode } from 'react';
import type { ResolvedConnection } from '../connectors/geometry.js';
import type { CanvasGeometry, CanvasObjectCapabilities, CanvasObjectDraft } from '../contracts.js';
import type { CanvasPrimitiveFrameProps } from './built-in-frames.js';
import './CanvasObjectContent.css';

interface CanvasObjectContentProps {
  readonly object: CanvasObjectDraft;
  readonly geometry: CanvasGeometry;
  readonly zoom: number;
  readonly content?: ReactNode;
  readonly connectorRoute?: ResolvedConnection;
  readonly interactive: boolean;
  readonly mode: CanvasObjectCapabilities['content'];
  readonly Frame?: ComponentType<CanvasPrimitiveFrameProps>;
}

export function CanvasObjectContent({
  object,
  geometry,
  zoom,
  content,
  connectorRoute,
  interactive,
  mode,
  Frame,
}: CanvasObjectContentProps) {
  const showCaption = mode === 'passive';
  const primitive = Frame && (
    <Frame
      object={object}
      geometry={geometry}
      zoom={zoom}
      connectorRoute={connectorRoute}
      content={showCaption ? content : undefined}
      showCaption={showCaption}
    />
  );

  if (showCaption) {
    return (
      primitive ?? <div className="studio-ui-canvas-object-label">{content ?? object.label}</div>
    );
  }

  return (
    <>
      {primitive}
      <div className="studio-ui-canvas-native-title">{object.label}</div>
      <div
        className="studio-ui-canvas-native-content"
        data-canvas-native={interactive ? '' : undefined}
        inert={!interactive}
      >
        {content}
      </div>
    </>
  );
}
