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
  readonly locked: boolean;
  readonly selected: boolean;
  readonly mode: CanvasObjectCapabilities['content'];
  readonly Frame?: ComponentType<CanvasPrimitiveFrameProps>;
}

const draggableBodyKinds = new Set<CanvasObjectDraft['kind']>(['link', 'image', 'table']);

function EmbeddedCaption({
  object,
  geometry,
  zoom,
  selected,
  canEdit,
  locked,
}: Pick<
  CanvasObjectContentProps,
  'object' | 'geometry' | 'zoom' | 'selected' | 'canEdit' | 'locked'
>) {
  const captionVisible = object.kind === 'html' && zoom >= 0.5 && geometry.width * zoom >= 96;
  if (!selected && !captionVisible) {
    return null;
  }

  const scale = selected ? 1 / zoom : Math.min(1 / zoom, 1);
  const width = geometry.width / scale;
  const name = object.kind === 'html' ? 'HTML 图解' : '嵌入对象';

  return (
    <div
      className="studio-ui-canvas-embedded-title"
      data-canvas-external-title=""
      style={{
        width: selected ? Math.max(width, 24) : width,
        bottom: `calc(100% + ${8 * scale}px)`,
        transform: `scale(${scale})`,
      }}
    >
      {selected && (
        <button
          className="studio-ui-canvas-embedded-grip"
          data-canvas-drag-surface="title"
          type="button"
          aria-label={`移动 ${name}`}
          title={locked ? `${name}位置已锁定` : `拖动把手移动 ${name}`}
          disabled={!canEdit || locked}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="9" cy="6" r="1" />
            <circle cx="15" cy="6" r="1" />
            <circle cx="9" cy="12" r="1" />
            <circle cx="15" cy="12" r="1" />
            <circle cx="9" cy="18" r="1" />
            <circle cx="15" cy="18" r="1" />
          </svg>
        </button>
      )}
      {captionVisible && <strong title={object.label}>{object.label}</strong>}
    </div>
  );
}

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
  locked,
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
      {embedded && (
        <EmbeddedCaption
          object={object}
          geometry={geometry}
          zoom={zoom}
          selected={selected}
          canEdit={canEdit}
          locked={locked}
        />
      )}
    </>
  );
}
