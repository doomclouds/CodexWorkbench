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
  readonly inert: boolean;
  readonly ownsFrame: boolean;
  readonly canEdit: boolean;
  readonly selected: boolean;
  readonly mode: CanvasObjectCapabilities['content'];
  readonly Frame?: ComponentType<CanvasPrimitiveFrameProps>;
}

const draggableBodyKinds = new Set<CanvasObjectDraft['kind']>(['link', 'image', 'table']);

export function CanvasObjectContent({
  object,
  geometry,
  zoom,
  content,
  connectorRoute,
  interactive,
  inert,
  ownsFrame,
  canEdit,
  selected,
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
      selected={selected}
    />
  );

  const embedded = ownsFrame && mode === 'embedded';
  const captionVisible = object.kind === 'html' && zoom >= 0.5 && geometry.width * zoom >= 96;
  const captionScale = Math.min(1 / zoom, 1);
  const canDragBody = ownsFrame && draggableBodyKinds.has(object.kind);

  if (showCaption) {
    return (
      primitive ?? <div className="studio-ui-canvas-object-label">{content ?? object.label}</div>
    );
  }

  return (
    <>
      {primitive}
      {!ownsFrame && <div className="studio-ui-canvas-native-title">{object.label}</div>}
      <div
        className="studio-ui-canvas-native-content"
        data-canvas-native={interactive ? '' : undefined}
        data-canvas-owned-frame={ownsFrame ? '' : undefined}
        data-canvas-drag-surface={canDragBody ? 'body' : undefined}
        inert={inert}
      >
        {content}
      </div>
      {embedded && captionVisible && (
        <div
          className="studio-ui-canvas-embedded-title"
          data-canvas-external-title=""
          style={{
            width: geometry.width / captionScale,
            bottom: `calc(100% + ${8 * captionScale}px)`,
            transform: `scale(${captionScale})`,
          }}
        >
          <strong title={object.label}>{object.label}</strong>
        </div>
      )}
      {embedded && interactive && canEdit && (
        <div
          className="studio-ui-canvas-embedded-move-edge"
          data-canvas-drag-surface="title"
          aria-hidden="true"
          style={{ height: Math.min(6 / zoom, geometry.height / 4) }}
        />
      )}
    </>
  );
}
