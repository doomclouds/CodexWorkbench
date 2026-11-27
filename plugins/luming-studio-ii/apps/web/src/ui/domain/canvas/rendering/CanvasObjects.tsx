import { memo, useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { builtInFrame, CanvasObjectContent } from '../adapters/index.js';
import type { ResolvedConnection } from '../connectors/geometry.js';
import type {
  CanvasObjectCapabilities,
  CanvasGeometry,
  CanvasObjectDraft,
  CanvasObjectExtension,
  CanvasObjectNavigation,
  CanvasObjectPayload,
  CanvasObjectViewProps,
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
  formatObjectRequest?: CanvasProps['formatObjectRequest'];
  viewing?: boolean;
  focusObjectId?: string;
  expandedObjectId?: string;
  canEditExpandedObject?: boolean;
  readHtmlSource?: CanvasProps['readHtmlSource'];
  downloadFile?: CanvasProps['downloadFile'];
  readDocumentAsset?: CanvasProps['readDocumentAsset'];
  uploadDocumentImage?: CanvasProps['uploadDocumentImage'];
  onOpenNativeSource?: CanvasProps['onOpenNativeSource'];
  nativeSourceLabel?: CanvasProps['nativeSourceLabel'];
  nativeSourceRequest?: CanvasProps['nativeSourceRequest'];
  annotationActive?: CanvasProps['annotationActive'];
  onAnnotateContent?: CanvasProps['onAnnotateContent'];
  isLocked?: (id: string) => boolean;
  canWriteObject?: CanvasProps['canWriteObject'];
  onObjectIntent?: CanvasProps['onObjectIntent'];
  onOpenPresentation?: CanvasProps['onOpenPresentation'];
  onClosePresentation?: CanvasProps['onClosePresentation'];
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
  singleSelected?: boolean;
  embedActive?: boolean;
  canEdit?: boolean;
  locked?: boolean;
  editRequest?: number;
  formatRequest?: CanvasObjectViewProps['formatRequest'];
  focusedReading?: boolean;
  expanded?: boolean;
  readHtmlSource?: CanvasObjectsProps['readHtmlSource'];
  downloadFile?: CanvasObjectsProps['downloadFile'];
  readDocumentAsset?: CanvasObjectsProps['readDocumentAsset'];
  uploadDocumentImage?: CanvasObjectsProps['uploadDocumentImage'];
  onOpenNativeSource?: CanvasObjectsProps['onOpenNativeSource'];
  nativeSourceLabel?: CanvasObjectsProps['nativeSourceLabel'];
  nativeSourceRequest?: CanvasObjectsProps['nativeSourceRequest'];
  annotationActive?: CanvasObjectsProps['annotationActive'];
  onAnnotateContent?: CanvasObjectsProps['onAnnotateContent'];
  onObjectIntent?: CanvasObjectsProps['onObjectIntent'];
  onOpenPresentation?: CanvasObjectsProps['onOpenPresentation'];
  onClosePresentation?: CanvasObjectsProps['onClosePresentation'];
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
  focusedReading?: boolean,
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

  return focusedReading
    ? { ...style, left: 0, top: 0, width: '100%', height: '100%', transform: 'none' }
    : style;
}

const minimumVideoControlWidth = 128;
const minimumVideoControlHeight = 72;

function nativeBodyActive(
  kind: CanvasObjectDraft['kind'],
  geometry: CanvasGeometry,
  zoom: number,
  singleSelected: boolean,
) {
  if (kind === 'document' || kind === 'todo') {
    return singleSelected;
  }
  if (kind === 'video') {
    return (
      geometry.width * zoom >= minimumVideoControlWidth &&
      geometry.height * zoom >= minimumVideoControlHeight
    );
  }

  return true;
}

function bodyInteraction(
  mode: CanvasObjectCapabilities['content'],
  draft: boolean,
  embedActive: boolean,
  nativeActive: boolean,
) {
  const embedded = mode === 'embedded';
  const interactive = !draft && (embedded ? embedActive : mode === 'native' && nativeActive);
  const blockedEmbed = embedded && !interactive;

  return { interactive, blockedEmbed, inert: draft || blockedEmbed };
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
    singleSelected,
    embedActive = false,
    canEdit = false,
    locked,
    editRequest,
    formatRequest,
    focusedReading,
    expanded,
    readHtmlSource,
    downloadFile,
    readDocumentAsset,
    uploadDocumentImage,
    onOpenNativeSource,
    nativeSourceLabel,
    nativeSourceRequest,
    annotationActive,
    onAnnotateContent,
    onObjectIntent,
    onOpenPresentation,
    onClosePresentation,
    onObjectNavigation,
    onObjectRetentionChange,
    zoom,
  }: CanvasRenderedObjectProps) => {
    const draft = id === undefined;
    const transparent = object.kind === 'section' && object.transparent;
    const mode = extension?.capabilities.content ?? 'passive';
    const View = extension?.View;
    const bodySelected = [singleSelected, focusedReading, expanded].some(Boolean);
    const nativeActive = !View || nativeBodyActive(object.kind, geometry, zoom, bodySelected);
    const { interactive, blockedEmbed, inert } = bodyInteraction(
      mode,
      draft,
      embedActive,
      nativeActive,
    );
    const readOnly = !canEdit || !onObjectIntent;
    const ownsFrame = usesOwnedFrame(object.kind, View, payload);
    const focusedAttribute = focusedReading ? '' : undefined;
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
        formatRequest={readOnly ? undefined : formatRequest}
        focusedReading={focusedReading}
        expanded={expanded}
        readHtmlSource={readHtmlSource}
        downloadFile={downloadFile}
        readDocumentAsset={readDocumentAsset}
        uploadDocumentImage={uploadDocumentImage}
        onOpenNativeSource={onOpenNativeSource}
        nativeSourceLabel={nativeSourceLabel}
        nativeSourceRequest={nativeSourceRequest}
        annotationActive={annotationActive}
        onAnnotateContent={onAnnotateContent}
        onOpenPresentation={onOpenPresentation}
        onClosePresentation={onClosePresentation}
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
        data-canvas-focused-reading={focusedAttribute}
        data-canvas-controls={focusedAttribute}
        aria-hidden={draft || undefined}
        style={objectStyle(object, geometry, zoom, focusedReading)}
      >
        <CanvasObjectContent
          object={object}
          geometry={geometry}
          zoom={zoom}
          content={body}
          connectorRoute={connectorRoute}
          interactive={interactive}
          inert={inert}
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

function allowedFormatRequest(
  request: CanvasObjectsProps['formatObjectRequest'],
  id: string,
  extension: CanvasRenderedObjectProps['extension'],
) {
  if (request?.id !== id || !extension?.capabilities.inlineFormats?.includes(request.format)) {
    return;
  }

  return request;
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
  formatObjectRequest,
  viewing,
  focusObjectId,
  expandedObjectId,
  canEditExpandedObject,
  readHtmlSource,
  downloadFile,
  readDocumentAsset,
  uploadDocumentImage,
  onOpenNativeSource,
  nativeSourceLabel,
  nativeSourceRequest,
  annotationActive,
  onAnnotateContent,
  isLocked,
  canWriteObject = () => true,
  onObjectIntent,
  onOpenPresentation,
  onClosePresentation,
  onObjectNavigation,
  onObjectRetentionChange,
}: CanvasObjectsProps) {
  const selectedIds = useMemo(() => new Set(selection), [selection]);
  const annotateEmbeds = Boolean(annotationActive && onAnnotateContent);
  const documentTools = { readDocumentAsset, uploadDocumentImage };
  const single = selection.length === 1;
  const formatRequest =
    selection.length === 1 && selectedIds.has(formatObjectRequest?.id ?? '')
      ? formatObjectRequest
      : undefined;
  const projected = objects.map(({ object, geometry, connectorRoute }) => {
    const { id, kind, locked } = object;
    const extension = registry.get(kind);
    const frame = builtInFrame(kind);
    const expanded = id === expandedObjectId;
    const focused = id === focusObjectId;
    const selected = selectedIds.has(id);
    const nativeSource =
      nativeSourceRequest?.source.elementId === id ? nativeSourceRequest : undefined;

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
        selected={selected}
        singleSelected={single && selected}
        embedActive={viewing || id === activeEmbedId || annotateEmbeds}
        focusedReading={focused}
        expanded={expanded}
        canEdit={canEdit || (expanded && canEditExpandedObject)}
        locked={locked || isLocked?.(id)}
        editRequest={editRequest?.id === id ? editRequest.sequence : undefined}
        formatRequest={allowedFormatRequest(formatRequest, id, extension)}
        readHtmlSource={readHtmlSource}
        downloadFile={downloadFile}
        {...(kind === 'document' ? documentTools : undefined)}
        onOpenNativeSource={onOpenNativeSource}
        nativeSourceLabel={nativeSourceLabel}
        nativeSourceRequest={nativeSource}
        annotationActive={annotationActive}
        onAnnotateContent={viewing && !focused ? undefined : onAnnotateContent}
        onObjectIntent={canWriteObject(kind) ? onObjectIntent : undefined}
        onOpenPresentation={onOpenPresentation}
        onClosePresentation={expanded || focused ? onClosePresentation : undefined}
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
