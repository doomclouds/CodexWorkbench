import { memo, useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { builtInFrame, CanvasObjectContent } from '../adapters/index.js';
import type { ResolvedConnection } from '../connectors/geometry.js';
import type {
  CanvasGeometry,
  CanvasObjectCapabilities,
  CanvasObjectDraft,
  CanvasObjectExtension,
  CanvasObjectNavigation,
  CanvasObjectPayload,
  CanvasObjectRegistry,
  CanvasProps,
} from '../contracts.js';
import type { ProjectedCanvasObject } from '../scene/index.js';
import { CanvasRegisteredBody } from './CanvasRegisteredBody.js';
import './CanvasObjects.css';

interface CanvasDraftView {
  readonly key: string;
  readonly object: CanvasObjectDraft;
  readonly connectorRoute?: ResolvedConnection;
}

interface CanvasObjectsProps {
  objects: readonly ProjectedCanvasObject[];
  registry: CanvasObjectRegistry;
  selection: readonly string[];
  canEdit: boolean;
  contentById?: ReadonlyMap<string, ReactNode>;
  payloadById?: ReadonlyMap<string, CanvasObjectPayload>;
  drafts?: readonly CanvasDraftView[];
  zoom?: number;
  activeEmbedId?: string;
  editRequest?: { readonly id: string; readonly sequence: number };
  isLocked?: (id: string) => boolean;
  onObjectIntent?: CanvasProps['onObjectIntent'];
  onObjectNavigation?: (id: string, event: CanvasObjectNavigation) => void;
  onObjectRetentionChange?: (id: string, retain: boolean) => void;
}

interface CanvasRenderedObjectProps {
  object: CanvasObjectDraft;
  id?: string;
  geometry: CanvasGeometry;
  content?: ReactNode;
  payload?: CanvasObjectPayload;
  connectorRoute?: ResolvedConnection;
  extension?: CanvasObjectExtension;
  frame?: ReturnType<typeof builtInFrame>;
  selected?: boolean;
  embedActive?: boolean;
  canEdit?: boolean;
  locked?: boolean;
  editRequest?: number;
  onObjectIntent?: CanvasObjectsProps['onObjectIntent'];
  onObjectNavigation?: CanvasObjectsProps['onObjectNavigation'];
  onObjectRetentionChange?: CanvasObjectsProps['onObjectRetentionChange'];
  zoom: number;
}

interface CanvasObjectStyle extends CSSProperties {
  '--studio-ui-canvas-object-fill'?: string;
  '--studio-ui-canvas-object-stroke'?: string;
  '--studio-ui-canvas-object-stroke-width'?: string;
  '--studio-ui-canvas-object-line-style'?: string;
}

function objectStyle(
  object: CanvasObjectDraft,
  { x, y, width, height, rotation }: CanvasGeometry,
  zoom: number,
) {
  const fill = object.fill?.toLowerCase();
  const pinnedNote = object.kind === 'note' && fill === '#f9e56f';
  const widthAtZoom =
    object.kind === 'section' && zoom < 0.5
      ? Math.max(object.strokeWidth ?? 1, 0.7 / zoom)
      : object.strokeWidth;
  const style: CanvasObjectStyle = {
    left: x,
    top: y,
    width,
    height,
    transform: `rotate(${rotation}deg)`,
    color: pinnedNote ? 'light-dark(#0b0b0b, #efefef)' : undefined,
    '--studio-ui-canvas-object-fill': pinnedNote ? 'light-dark(#f9e56f, #f5d515)' : object.fill,
    '--studio-ui-canvas-object-stroke': object.stroke,
    '--studio-ui-canvas-object-stroke-width':
      widthAtZoom === undefined ? undefined : `${widthAtZoom}px`,
    '--studio-ui-canvas-object-line-style': object.dashed ? 'dashed' : undefined,
  };

  return style;
}

function canInteractWithBody(
  mode: CanvasObjectCapabilities['content'],
  draft: boolean,
  embedActive: boolean,
) {
  if (draft) {
    return false;
  }

  return mode === 'embedded' ? embedActive : mode === 'native';
}

const ownedFrameKinds = new Set<CanvasObjectDraft['kind']>([
  'document',
  'todo',
  'table',
  'link',
  'image',
  'video',
  'html',
  'diagram',
  'chart',
]);

function usesOwnedFrame(
  kind: CanvasObjectDraft['kind'],
  view: CanvasObjectExtension['View'],
  payload: CanvasObjectPayload | undefined,
) {
  return Boolean(view && payload) && ownedFrameKinds.has(kind);
}

const CanvasObjectView = memo(
  ({
    object,
    id,
    geometry,
    content,
    payload,
    connectorRoute,
    extension,
    frame,
    selected = false,
    embedActive = false,
    canEdit = false,
    locked,
    editRequest,
    onObjectIntent,
    onObjectNavigation,
    onObjectRetentionChange,
    zoom,
  }: CanvasRenderedObjectProps) => {
    const draft = id === undefined;
    const transparent = object.kind === 'section' && object.transparent;
    const mode = extension?.capabilities.content ?? 'passive';
    const interactive = canInteractWithBody(mode, draft, embedActive);
    const readOnly = !canEdit || !onObjectIntent;
    const blockedEmbed = mode === 'embedded' && !interactive;
    const View = extension?.View;
    const ownsFrame = usesOwnedFrame(object.kind, View, payload);
    const body = View ? (
      <CanvasRegisteredBody
        View={View}
        object={object}
        id={id}
        geometry={geometry}
        zoom={zoom}
        content={content}
        payload={payload}
        selected={selected}
        interactive={interactive}
        readOnly={readOnly}
        locked={locked}
        editRequest={editRequest}
        onObjectIntent={blockedEmbed ? undefined : onObjectIntent}
        onObjectNavigation={interactive ? onObjectNavigation : undefined}
        onObjectRetentionChange={onObjectRetentionChange}
      />
    ) : (
      content
    );

    return (
      <div
        className={'studio-ui-canvas-object studio-ui-canvas-object--' + object.kind}
        data-canvas-object={id}
        data-canvas-draft={draft ? '' : undefined}
        data-canvas-transparent={transparent ? '' : undefined}
        data-canvas-locked={locked ? '' : undefined}
        aria-hidden={draft || undefined}
        style={objectStyle(object, geometry, zoom)}
      >
        <CanvasObjectContent
          object={object}
          geometry={geometry}
          zoom={zoom}
          content={body}
          connectorRoute={connectorRoute}
          interactive={interactive}
          ownsFrame={ownsFrame}
          canEdit={canEdit}
          selected={selected}
          mode={mode}
          Frame={frame?.Frame}
        />
      </div>
    );
  },
);

function objectZoom(
  frame: CanvasRenderedObjectProps['frame'],
  extension: CanvasRenderedObjectProps['extension'],
  zoom: number,
) {
  return frame?.usesZoom || extension?.View ? zoom : 1;
}

export function CanvasObjects({
  objects,
  registry,
  selection,
  canEdit,
  contentById,
  payloadById,
  drafts,
  zoom = 1,
  activeEmbedId,
  editRequest,
  isLocked,
  onObjectIntent,
  onObjectNavigation,
  onObjectRetentionChange,
}: CanvasObjectsProps) {
  const selectedIds = useMemo(() => new Set(selection), [selection]);
  const projected = objects.map(({ object, geometry, connectorRoute }) => {
    const { id, kind, locked } = object;
    const extension = registry.get(kind);
    const frame = builtInFrame(kind);

    return (
      <CanvasObjectView
        key={id}
        object={object}
        id={id}
        content={contentById?.get(id)}
        payload={payloadById?.get(id)}
        geometry={geometry}
        connectorRoute={connectorRoute}
        extension={extension}
        frame={frame}
        selected={selectedIds.has(id)}
        embedActive={id === activeEmbedId}
        canEdit={canEdit}
        locked={locked || isLocked?.(id)}
        editRequest={editRequest?.id === id ? editRequest.sequence : undefined}
        onObjectIntent={onObjectIntent}
        onObjectNavigation={onObjectNavigation}
        onObjectRetentionChange={onObjectRetentionChange}
        zoom={objectZoom(frame, extension, zoom)}
      />
    );
  });
  const previews = drafts?.map(({ key, object, connectorRoute }) => {
    const extension = registry.get(object.kind);
    const frame = builtInFrame(object.kind);

    return (
      <CanvasObjectView
        key={key}
        object={object}
        geometry={connectorRoute?.geometry ?? object.geometry}
        connectorRoute={connectorRoute}
        extension={extension}
        frame={frame}
        zoom={objectZoom(frame, extension, zoom)}
      />
    );
  });

  return (
    <>
      {projected}
      {previews}
    </>
  );
}
