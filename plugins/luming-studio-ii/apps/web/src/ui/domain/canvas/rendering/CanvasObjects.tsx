import { memo, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { builtInFrame, CanvasObjectContent } from '../adapters/index.js';
import { showsIdleHtmlCaption } from '../adapters/caption-metrics.js';
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
import type { CanvasObjectStore } from './object-store.js';
import { useContentTracking } from './native-content-locations.js';
import './CanvasObjects.css';

interface CanvasDraftView {
  readonly key: string;
  readonly object: CanvasObjectDraft;
  readonly connectorRoute?: ResolvedConnection;
}

interface CanvasObjectsProps {
  objects: readonly ProjectedCanvasObject[];
  movePreview: CanvasObjectStore<ProjectedCanvasObject>;
  registry: CanvasObjectRegistry;
  selection: readonly string[];
  canEdit: boolean;
  contentById?: ReadonlyMap<string, ReactNode>;
  payloads: CanvasObjectStore<CanvasObjectPayload>;
  drafts?: readonly CanvasDraftView[];
  zoom?: number;
  sectionCaptionWidths?: ReadonlyMap<string, number>;
  activeZoom: CanvasObjectStore<number>;
  activeZoomIds: ReadonlySet<string>;
  activeEmbedId?: string;
  editRequest?: { readonly id: string; readonly sequence: number };
  formatObjectRequest?: CanvasProps['formatObjectRequest'];
  viewing?: boolean;
  presentationIds?: ReadonlySet<string>;
  backgroundZoom?: number;
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
  hasContentEditPermission?: CanvasProps['hasContentEditPermission'];
  onAnnotateContent?: CanvasProps['onAnnotateContent'];
  contentTracking?: CanvasProps['contentTracking'];
  isLocked?: (id: string) => boolean;
  canWriteObject?: CanvasProps['canWriteObject'];
  onObjectIntent?: CanvasProps['onObjectIntent'];
  onOpenPresentation?: CanvasProps['onOpenPresentation'];
  onClosePresentation?: CanvasProps['onClosePresentation'];
  onObjectNavigation?: (id: string, event: CanvasObjectNavigation) => void;
  onObjectRetentionChange?: (id: string, retain: boolean) => void;
  onObjectEditingChange?: CanvasProps['onObjectEditingChange'];
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
  hidden?: boolean;
  selected?: boolean;
  singleSelected?: boolean;
  sectionCaptionWidth?: number;
  keepPassiveContent?: boolean;
  embedActive?: boolean;
  canEdit?: boolean;
  canEditContent?: boolean;
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
  contentTracking?: CanvasObjectViewProps['contentTracking'];
  onObjectIntent?: CanvasObjectsProps['onObjectIntent'];
  onOpenPresentation?: CanvasObjectsProps['onOpenPresentation'];
  onClosePresentation?: CanvasObjectsProps['onClosePresentation'];
  onObjectNavigation?: CanvasObjectsProps['onObjectNavigation'];
  onObjectRetentionChange?: CanvasObjectsProps['onObjectRetentionChange'];
  onObjectEditingChange?: CanvasObjectsProps['onObjectEditingChange'];
  zoom: number;
}

const emptyContentTracking: NonNullable<CanvasProps['contentTracking']> = new Map();

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

function managesAnnotationEditing(extension: CanvasObjectExtension | undefined, enabled: boolean) {
  return enabled && extension?.capabilities.managesAnnotationEditing === true;
}

function hasEditCaption(
  kind: CanvasObjectDraft['kind'],
  extension: CanvasObjectExtension | undefined,
  payload: CanvasObjectPayload | undefined,
  selected: boolean,
) {
  const caption = extension?.capabilities.content === 'embedded' || (kind === 'video' && selected);

  return caption && usesOwnedFrame(kind, extension?.View, payload);
}

function editAccess(
  extension: CanvasObjectExtension | undefined,
  active: boolean,
  expanded: boolean,
  allowAnnotation: boolean,
  access: Pick<CanvasObjectsProps, 'canEdit' | 'canEditExpandedObject'>,
) {
  const editable = access.canEdit || Boolean(expanded && access.canEditExpandedObject);
  const annotation = managesAnnotationEditing(extension, allowAnnotation);
  const scoped = extension?.capabilities.editOnlyWhenSelected;
  const canEdit = editable && (!scoped || active);

  return { editable, canEditContent: Boolean(extension?.View && (canEdit || annotation)) };
}

function passiveBody(
  extension: CanvasObjectExtension | undefined,
  active: boolean,
  view: Pick<CanvasObjectViewProps, 'object' | 'geometry' | 'payload' | 'zoom'>,
  body: ReactNode,
) {
  if (active || extension?.capabilities.content !== 'passive') {
    return body;
  }

  return extension.isPassiveContentVisible?.(view) === false ? false : body;
}

function hoverTitle(
  object: CanvasObjectDraft,
  width: number,
  zoom: number,
  id: string | undefined,
  focusedReading: boolean | undefined,
) {
  const available = id !== undefined && !focusedReading;

  return available && object.kind === 'html' && !showsIdleHtmlCaption(width, zoom)
    ? object.label
    : undefined;
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
    hidden,
    selected = false,
    singleSelected,
    sectionCaptionWidth,
    keepPassiveContent,
    embedActive = false,
    canEdit = false,
    canEditContent,
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
    contentTracking,
    onObjectIntent,
    onOpenPresentation,
    onClosePresentation,
    onObjectNavigation,
    onObjectRetentionChange,
    onObjectEditingChange,
    zoom,
  }: CanvasRenderedObjectProps) => {
    const draft = id === undefined;
    const transparent = object.kind === 'section' && object.transparent;
    const mode = extension?.capabilities.content ?? 'passive';
    const View = extension?.View;
    const root = useRef<HTMLDivElement>(null);
    const { embedded, revealing } = useContentTracking(root, {
      contentTracking,
      mode,
      geometry,
      zoom,
      focusedReading,
    });
    const bodySelected = [singleSelected, focusedReading, expanded, revealing].some(Boolean);
    const activeContent = [
      keepPassiveContent,
      bodySelected,
      editRequest !== undefined,
      formatRequest,
      contentTracking,
      content != null,
    ].some(Boolean);
    const nativeActive = !View || nativeBodyActive(object.kind, geometry, zoom, bodySelected);
    const { interactive, blockedEmbed, inert } = bodyInteraction(
      mode,
      draft,
      embedActive,
      nativeActive,
    );
    const readOnly = !canEditContent || !onObjectIntent;
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
        contentTracking={embedded}
        onOpenPresentation={onOpenPresentation}
        onClosePresentation={onClosePresentation}
        onObjectIntent={blockedEmbed ? undefined : onObjectIntent}
        onObjectNavigation={interactive ? onObjectNavigation : undefined}
        onObjectRetentionChange={onObjectRetentionChange}
        onObjectEditingChange={onObjectEditingChange}
      />
    ) : (
      content
    );

    return (
      <div
        ref={root}
        className={'studio-ui-canvas-object studio-ui-canvas-object--' + object.kind}
        data-canvas-object={id}
        data-canvas-draft={draft ? '' : undefined}
        data-canvas-transparent={transparent ? '' : undefined}
        data-canvas-locked={locked ? '' : undefined}
        data-canvas-focused-reading={focusedAttribute}
        data-canvas-controls={focusedAttribute}
        hidden={hidden}
        inert={hidden}
        aria-hidden={draft || undefined}
        title={hoverTitle(object, geometry.width, zoom, id, focusedReading)}
        style={objectStyle(object, geometry, zoom, focusedReading)}
      >
        <CanvasObjectContent
          object={object}
          geometry={geometry}
          zoom={zoom}
          content={passiveBody(extension, activeContent, { object, geometry, payload, zoom }, body)}
          connectorRoute={connectorRoute}
          interactive={interactive}
          inert={inert}
          ownsFrame={ownsFrame}
          canEdit={canEdit}
          locked={locked === true}
          selected={selected}
          sectionCaptionWidth={sectionCaptionWidth}
          mode={mode}
          Frame={frame?.Frame}
        />
      </div>
    );
  },
);

function useObjectSnapshot<Value>(store: CanvasObjectStore<Value>, id: string) {
  const subscribe = useCallback((notify: () => void) => store.subscribe(id, notify), [id, store]);
  const read = useCallback(() => store.read(id), [id, store]);

  return useSyncExternalStore(subscribe, read, read);
}

const SubscribedCanvasObject = memo(
  ({
    id,
    movePreview,
    payloads,
    activeZoom,
    ...props
  }: CanvasRenderedObjectProps & {
    id: string;
    movePreview: CanvasObjectsProps['movePreview'];
    payloads: CanvasObjectsProps['payloads'];
    activeZoom: CanvasObjectsProps['activeZoom'];
  }) => {
    const preview = useObjectSnapshot(movePreview, id);
    const payload = useObjectSnapshot(payloads, id);
    const exactZoom = useObjectSnapshot(activeZoom, id);
    const { object, extension, selected } = props;
    const caption = hasEditCaption(object.kind, extension, payload, selected === true);

    return (
      <CanvasObjectView
        {...props}
        id={id}
        payload={payload}
        zoom={objectZoom(
          props.frame,
          extension,
          props.hidden ? props.zoom : (exactZoom ?? props.zoom),
        )}
        canEdit={props.canEdit && caption}
        object={preview?.object ?? props.object}
        geometry={preview?.geometry ?? props.geometry}
        connectorRoute={preview ? preview.connectorRoute : props.connectorRoute}
      />
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

function objectPresentation(
  id: string,
  {
    presentationIds,
    backgroundZoom,
    zoom = 1,
    viewing,
    activeEmbedId,
    annotateEmbeds,
  }: Pick<
    CanvasObjectsProps,
    'presentationIds' | 'backgroundZoom' | 'zoom' | 'viewing' | 'activeEmbedId'
  > & {
    annotateEmbeds: boolean;
  },
) {
  const hidden = presentationIds?.has(id) === false;

  return {
    hidden,
    embedActive: !hidden && (viewing || id === activeEmbedId || annotateEmbeds),
    zoom: hidden ? (backgroundZoom ?? zoom) : zoom,
  };
}

export const CanvasObjects = memo(
  ({
    objects,
    movePreview,
    registry,
    selection,
    canEdit,
    contentById,
    payloads,
    drafts,
    zoom = 1,
    sectionCaptionWidths,
    activeZoom,
    activeZoomIds,
    activeEmbedId,
    editRequest,
    formatObjectRequest,
    viewing,
    presentationIds,
    backgroundZoom,
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
    hasContentEditPermission,
    contentTracking = emptyContentTracking,
    isLocked,
    canWriteObject = () => true,
    onObjectIntent,
    onOpenPresentation,
    onClosePresentation,
    onObjectNavigation,
    onObjectRetentionChange,
    onObjectEditingChange,
  }: CanvasObjectsProps) => {
    const selectedIds = useMemo(() => new Set(selection), [selection]);
    const annotateEmbeds = Boolean(annotationActive && onAnnotateContent);
    const presentation = {
      presentationIds,
      backgroundZoom,
      zoom,
      viewing,
      activeEmbedId,
      annotateEmbeds,
    };
    const documentTools = { readDocumentAsset, uploadDocumentImage };
    const editPermissions = { canEdit, canEditExpandedObject };
    const allowManagedAnnotation = Boolean(annotationActive && hasContentEditPermission);
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
      const singleSelected = single && selected;
      const activeLabel = [selected, expanded, focused, activeZoomIds.has(id)].some(Boolean);
      const { editable, canEditContent } = editAccess(
        extension,
        activeLabel,
        expanded,
        allowManagedAnnotation,
        editPermissions,
      );
      const nativeSource =
        nativeSourceRequest?.source.elementId === id ? nativeSourceRequest : undefined;

      return (
        <SubscribedCanvasObject
          key={id}
          object={object}
          id={id}
          movePreview={movePreview}
          content={contentById?.get(id)}
          payloads={payloads}
          activeZoom={activeZoom}
          geometry={geometry}
          connectorRoute={connectorRoute}
          extension={extension}
          frame={frame}
          {...objectPresentation(id, presentation)}
          selected={selected}
          singleSelected={singleSelected}
          sectionCaptionWidth={sectionCaptionWidths?.get(id)}
          keepPassiveContent={extension?.isPassiveContentVisible ? activeLabel : undefined}
          focusedReading={focused}
          expanded={expanded}
          canEdit={editable}
          canEditContent={canEditContent}
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
          contentTracking={contentTracking.get(id)}
          onObjectIntent={canWriteObject(kind) ? onObjectIntent : undefined}
          onOpenPresentation={onOpenPresentation}
          onClosePresentation={expanded || focused ? onClosePresentation : undefined}
          onObjectNavigation={onObjectNavigation}
          onObjectRetentionChange={onObjectRetentionChange}
          onObjectEditingChange={onObjectEditingChange}
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
  },
);
