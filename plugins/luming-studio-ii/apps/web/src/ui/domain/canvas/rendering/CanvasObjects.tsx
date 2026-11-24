import { memo } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { CanvasObjectContent } from '../adapters/index.js';
import type { ResolvedConnection } from '../connectors/geometry.js';
import type { CanvasGeometry, CanvasObjectDraft, CanvasObjectKind } from '../contracts.js';
import type { ProjectedCanvasObject } from '../scene/index.js';
import './CanvasObjects.css';

interface CanvasDraftView {
  readonly key: string;
  readonly object: CanvasObjectDraft;
  readonly connectorRoute?: ResolvedConnection;
}

interface CanvasObjectsProps {
  objects: readonly ProjectedCanvasObject[];
  contentById?: ReadonlyMap<string, ReactNode>;
  drafts?: readonly CanvasDraftView[];
  zoom?: number;
  activeEmbedId?: string;
}

interface CanvasObjectViewProps {
  object: CanvasObjectDraft;
  id?: string;
  geometry: CanvasGeometry;
  content?: ReactNode;
  connectorRoute?: ResolvedConnection;
  zoom: number;
  contentInert: boolean;
}

interface CanvasObjectStyle extends CSSProperties {
  '--studio-ui-canvas-object-fill'?: string;
  '--studio-ui-canvas-object-stroke'?: string;
  '--studio-ui-canvas-object-stroke-width'?: string;
  '--studio-ui-canvas-object-line-style'?: string;
}

const embeddedContent = new Set<CanvasObjectKind>(['html', 'diagram', 'chart']);

function objectStyle(object: CanvasObjectDraft, { x, y, width, height, rotation }: CanvasGeometry) {
  const style: CanvasObjectStyle = {
    left: x,
    top: y,
    width,
    height,
    transform: `rotate(${rotation}deg)`,
    '--studio-ui-canvas-object-fill': object.fill,
    '--studio-ui-canvas-object-stroke': object.stroke,
    '--studio-ui-canvas-object-stroke-width':
      object.strokeWidth === undefined ? undefined : `${object.strokeWidth}px`,
    '--studio-ui-canvas-object-line-style': object.dashed ? 'dashed' : undefined,
  };

  return style;
}

const CanvasObjectView = memo(
  ({
    object,
    id,
    geometry,
    content,
    connectorRoute,
    zoom,
    contentInert,
  }: CanvasObjectViewProps) => {
    const draft = id === undefined;
    const transparent = object.kind === 'section' && object.transparent;

    return (
      <div
        className={'studio-ui-canvas-object studio-ui-canvas-object--' + object.kind}
        data-canvas-object={id}
        data-canvas-draft={draft ? '' : undefined}
        data-canvas-transparent={transparent ? '' : undefined}
        aria-hidden={draft || undefined}
        style={objectStyle(object, geometry)}
      >
        <CanvasObjectContent
          object={object}
          geometry={geometry}
          zoom={zoom}
          content={content}
          connectorRoute={connectorRoute}
          contentInert={contentInert}
        />
      </div>
    );
  },
);

function objectZoom(object: CanvasObjectDraft, zoom: number) {
  return object.kind === 'ink' || object.kind === 'section' ? zoom : 1;
}

export function CanvasObjects({
  objects,
  contentById,
  drafts,
  zoom = 1,
  activeEmbedId,
}: CanvasObjectsProps) {
  return (
    <>
      {objects.map(({ object, geometry, connectorRoute }) => (
        <CanvasObjectView
          key={object.id}
          object={object}
          id={object.id}
          content={contentById?.get(object.id)}
          geometry={geometry}
          connectorRoute={connectorRoute}
          zoom={objectZoom(object, zoom)}
          contentInert={embeddedContent.has(object.kind) && object.id !== activeEmbedId}
        />
      ))}
      {drafts?.map(({ key, object, connectorRoute }) => (
        <CanvasObjectView
          key={key}
          object={object}
          geometry={connectorRoute?.geometry ?? object.geometry}
          connectorRoute={connectorRoute}
          zoom={objectZoom(object, zoom)}
          contentInert
        />
      ))}
    </>
  );
}
