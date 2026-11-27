import type { ComponentType, ReactNode, Ref } from 'react';

export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

export interface CanvasRect extends CanvasPoint {
  readonly width: number;
  readonly height: number;
}

export interface CanvasGeometry extends CanvasRect {
  readonly rotation: number;
}

export interface CanvasViewport extends CanvasPoint {
  readonly zoom: number;
}

export type CanvasViewportSize = Pick<CanvasRect, 'width' | 'height'>;
export type CanvasViewportNavigation = 'pan' | 'zoom' | 'fit' | 'escape';

export type CanvasFitScope = 'auto' | 'board' | 'selection';

export type CanvasViewportRequest = {
  readonly requestId: string;
} & (
  | { readonly viewport: CanvasViewport }
  | { readonly fit: CanvasFitScope }
  | { readonly zoom: number }
);

export interface CanvasObjectActivation {
  readonly id: string;
  readonly point: CanvasPoint;
}

export type CanvasShape =
  | 'rounded'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'pill'
  | 'hexagon'
  | 'parallelogram'
  | 'database'
  | 'queue'
  | 'document'
  | 'cloud'
  | 'person';

export type CanvasContentKind =
  | 'native'
  | 'html'
  | 'document'
  | 'todo'
  | 'table'
  | 'image'
  | 'video'
  | 'link'
  | 'diagram'
  | 'chart';

export type CanvasCustomObjectKind = `${string}:${string}`;

export type CanvasPort = 'top' | 'bottom' | 'left' | 'right';
export type CanvasConnectorHead = 'none' | 'arrow' | 'circle';

export interface CanvasConnectionEndpoint {
  readonly point: CanvasPoint;
  readonly attachment?: { readonly objectId: string; readonly port?: CanvasPort };
}

export interface CanvasRelativeBends {
  readonly firstAxis: 'horizontal' | 'vertical';
  readonly offsets: readonly number[];
}

export interface CanvasConnection {
  readonly start: CanvasConnectionEndpoint;
  readonly end: CanvasConnectionEndpoint;
  readonly bends?: readonly CanvasPoint[];
  readonly relativeBends?: CanvasRelativeBends;
  readonly labelOffset?: CanvasPoint;
  readonly startHead?: CanvasConnectorHead;
  readonly endHead?: CanvasConnectorHead;
}

export interface CanvasInk {
  readonly points: readonly CanvasPoint[];
  readonly width: number;
}

export interface CanvasPenStyle {
  readonly width?: number;
  readonly stroke?: string;
}

interface CanvasObjectAppearance {
  readonly label: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly dashed?: boolean;
  readonly hollow?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

type CanvasBox =
  | { readonly kind: 'shape'; readonly shape?: CanvasShape }
  | { readonly kind: 'section'; readonly transparent?: boolean }
  | { readonly kind: CanvasContentKind | CanvasCustomObjectKind | 'text' | 'note' | 'sticker' };

export type CanvasObjectDraft = CanvasObjectAppearance & { readonly geometry: CanvasGeometry } & (
    | CanvasBox
    | { readonly kind: 'ink'; readonly ink: CanvasInk }
    | { readonly kind: 'connector'; readonly connection: CanvasConnection }
  );

export type CanvasObjectKind = CanvasObjectDraft['kind'];

export type CanvasObject = CanvasObjectDraft & {
  readonly id: string;
  readonly version: number;
  readonly parentId?: string;
  readonly groupId?: string;
  readonly locked?: boolean;
};

export interface CanvasObjectCapabilities {
  readonly move: boolean;
  readonly resize: boolean;
  readonly rotate: boolean;
  readonly connect: boolean;
  readonly content: 'passive' | 'native' | 'embedded';
  readonly inlineFormats?: readonly CanvasInlineFormat[];
}

export type CanvasInlineFormat = 'bold' | 'italic' | 'link' | 'bullets' | 'numbered';

export interface CanvasObjectFormatRequest {
  readonly sequence: number;
  readonly format: CanvasInlineFormat;
}

export interface CanvasObjectGeometryContext {
  readonly object: CanvasObjectDraft;
  readonly geometry: CanvasGeometry;
}

export interface CanvasObjectHitContext extends CanvasObjectGeometryContext {
  readonly point: CanvasPoint;
  readonly zoom: number;
}

export interface CanvasObjectPayload {
  readonly version: number;
  readonly value: unknown;
}

export interface CanvasObjectOperation {
  readonly name: string;
  readonly expectedVersion: number;
  readonly value: unknown;
}

export interface CanvasObjectIntent extends CanvasObjectOperation {
  readonly objectId: string;
  readonly kind: CanvasObjectKind;
}

export type CanvasObjectReceipt =
  | { readonly ok: true; readonly payload: CanvasObjectPayload }
  | {
      readonly ok: false;
      readonly message: string;
      readonly current?: CanvasObjectPayload;
      readonly conflict?: true;
    };

export type CanvasObjectNavigation =
  | { readonly kind: 'space'; readonly held: boolean }
  | {
      readonly kind: 'pan';
      readonly phase: 'start' | 'move' | 'end' | 'cancel';
      readonly pointerId: number;
      readonly screenX: number;
      readonly screenY: number;
    }
  | {
      readonly kind: 'zoom';
      readonly x: number;
      readonly y: number;
      readonly deltaY: number;
      readonly deltaMode: number;
    };

export interface CanvasObjectFile {
  readonly filename: string;
  readonly mimeType: string;
  readonly content: Uint8Array;
}

export interface CanvasDocumentAsset {
  readonly mimeType: string;
  readonly content: Uint8Array;
}

export interface CanvasNativeSource {
  readonly artifactId?: string;
  readonly elementId: string;
  readonly blockId?: string;
  readonly itemId?: string;
  readonly version?: number;
}

export interface CanvasNativeSourceRequest {
  readonly sequence: number;
  readonly source: CanvasNativeSource;
}

type CanvasContentUnit =
  | { readonly kind: 'document'; readonly blockIds: readonly string[] }
  | { readonly kind: 'todo'; readonly itemId: string }
  | { readonly kind: 'html'; readonly nodeIds: readonly string[]; readonly sourceRevision: bigint };

export interface CanvasContentAnnotationRequest {
  readonly target: CanvasContentUnit | { readonly kind: 'object' };
  readonly u: number;
  readonly v: number;
}

export interface CanvasContentLocationRequest {
  readonly id: string;
  readonly target: CanvasContentUnit;
  readonly u: number;
  readonly v: number;
  readonly reveal?: number;
}

export interface CanvasContentLocation {
  readonly point: CanvasPoint | null;
  readonly reveal?: number;
}

export interface CanvasContentTracking {
  readonly requests: readonly CanvasContentLocationRequest[];
  readonly report: (locations: ReadonlyMap<string, CanvasContentLocation>) => void;
}

export interface CanvasObjectViewProps extends CanvasObjectGeometryContext {
  readonly id?: string;
  readonly payload?: CanvasObjectPayload;
  readonly content?: ReactNode;
  readonly zoom: number;
  readonly selected: boolean;
  readonly interactive: boolean;
  readonly readOnly: boolean;
  readonly locked?: boolean;
  readonly editRequest?: number;
  readonly formatRequest?: CanvasObjectFormatRequest;
  readonly focusedReading?: boolean;
  readonly expanded?: boolean;
  readonly readHtmlSource?: (file: File) => Promise<string>;
  readonly downloadFile?: (file: CanvasObjectFile) => void;
  readonly readDocumentAsset?: (
    source: string,
    signal?: AbortSignal,
  ) => Promise<CanvasDocumentAsset | undefined>;
  readonly uploadDocumentImage?: (file: File) => Promise<string>;
  readonly onOpenNativeSource?: (source: CanvasNativeSource) => void;
  readonly nativeSourceLabel?: (source: CanvasNativeSource) => string | undefined;
  readonly nativeSourceRequest?: CanvasNativeSourceRequest;
  readonly annotationActive?: boolean;
  readonly onAnnotateContent?: (request: CanvasContentAnnotationRequest) => void;
  readonly contentTracking?: CanvasContentTracking;
  readonly onOpenPresentation?: () => void;
  readonly onClosePresentation?: () => void;
  readonly request: (operation: CanvasObjectOperation) => Promise<CanvasObjectReceipt>;
  readonly onNavigation?: (event: CanvasObjectNavigation) => void;
  readonly onRetentionChange?: (retain: boolean) => void;
}

export interface CanvasObjectExtension {
  readonly kind: CanvasObjectKind;
  readonly capabilities: CanvasObjectCapabilities;
  readonly placement?: CanvasPlacement;
  readonly portClick?: 'place' | 'connect';
  readonly blocksPlacement?: boolean;
  readonly activateOnDoubleClick?: boolean;
  readonly bounds?: (context: CanvasObjectGeometryContext) => CanvasRect;
  readonly hitTest?: (context: CanvasObjectHitContext) => boolean;
  readonly View?: ComponentType<CanvasObjectViewProps>;
}

export interface CanvasObjectRegistry {
  get(kind: CanvasObjectKind): CanvasObjectExtension | undefined;
}

export type CanvasPlacement = CanvasObjectAppearance &
  CanvasBox & {
    readonly width: number;
    readonly height: number;
  };

export interface CanvasPlacementTool {
  readonly kind: 'place';
  readonly requestId: string;
  readonly object: CanvasPlacement;
}

export interface CanvasScene {
  readonly boardId: string;
  readonly revision: number;
  readonly objects: readonly CanvasObject[];
}

export interface CanvasObjectChange {
  readonly id: string;
  readonly expectedVersion: number;
  readonly geometry: CanvasGeometry;
  readonly connection?: CanvasConnection;
  readonly ink?: CanvasInk;
}

export type CanvasGestureGeometry = Pick<CanvasObjectChange, 'id' | 'expectedVersion' | 'geometry'>;

export interface CanvasGesturePreview {
  readonly kind: 'move' | 'resize' | 'rotate';
  readonly changes: readonly CanvasGestureGeometry[];
}

export interface CanvasCreateIntent {
  readonly kind: 'create';
  readonly interactionId: string;
  readonly object: CanvasObjectDraft;
  readonly link?: CanvasCreateLink;
}

export interface CanvasCreateLink {
  readonly source: {
    readonly objectId: string;
    readonly port: CanvasPort;
    readonly expectedVersion: number;
    readonly point: CanvasPoint;
  };
  readonly target: { readonly port: CanvasPort; readonly point: CanvasPoint };
}

export interface CanvasDuplicateIntent {
  readonly kind: 'duplicate';
  readonly interactionId: string;
  readonly delta: CanvasPoint;
  readonly sources: readonly CanvasObjectChange[];
}

interface CanvasEdit {
  readonly interactionId: string;
  readonly changes: readonly CanvasObjectChange[];
}

export interface CanvasMoveIntent extends CanvasEdit {
  readonly kind: 'move';
  readonly delta: CanvasPoint;
}

export interface CanvasTransformIntent extends CanvasEdit {
  readonly kind: 'resize' | 'rotate';
}

export interface CanvasConnectIntent extends CanvasEdit {
  readonly kind: 'connect';
}

export type CanvasEditIntent =
  | CanvasMoveIntent
  | CanvasTransformIntent
  | CanvasConnectIntent
  | CanvasCreateIntent
  | CanvasDuplicateIntent;

export type CanvasTool = 'select' | 'pan' | 'pen' | 'connector' | CanvasPlacementTool;

export interface CanvasHandle {
  focus(): void;
  fitToObjects(ids: readonly string[]): void;
}

export interface CanvasPresentation {
  readonly objectIds: readonly string[];
  readonly focusObjectId?: string;
  readonly expandedObjectId?: string;
}

export interface CanvasProps {
  readonly viewId: string;
  readonly label: string;
  readonly scene: CanvasScene;
  readonly selection: readonly string[];
  readonly tool: CanvasTool;
  readonly penStyle?: CanvasPenStyle;
  readonly canEdit: boolean;
  readonly initialViewport?: CanvasViewport;
  readonly fitOnMount?: boolean;
  readonly viewportRequest?: CanvasViewportRequest;
  readonly showGrid?: boolean;
  readonly presentation?: CanvasPresentation;
  readonly selectionActions?: ReactNode;
  readonly pendingEdits?: readonly CanvasEditIntent[];
  readonly pendingResizeObjectId?: string;
  readonly objectExtensions?: readonly CanvasObjectExtension[];
  readonly payloadById?: ReadonlyMap<string, CanvasObjectPayload>;
  readonly contentById?: ReadonlyMap<string, ReactNode>;
  readonly onSelectionChange: (selection: readonly string[]) => void;
  readonly onContextMenu?: (anchor: CanvasPoint, selection: readonly string[]) => void;
  readonly blankDoubleClickPlacement?: CanvasPlacement;
  readonly onObjectActivate?: (activation: CanvasObjectActivation) => void;
  readonly editObjectRequest?: { readonly id: string };
  readonly formatObjectRequest?: CanvasObjectFormatRequest & { readonly id: string };
  readonly readHtmlSource?: CanvasObjectViewProps['readHtmlSource'];
  readonly downloadFile?: CanvasObjectViewProps['downloadFile'];
  readonly readDocumentAsset?: CanvasObjectViewProps['readDocumentAsset'];
  readonly uploadDocumentImage?: (id: string, file: File) => Promise<string>;
  readonly onOpenNativeSource?: CanvasObjectViewProps['onOpenNativeSource'];
  readonly nativeSourceLabel?: CanvasObjectViewProps['nativeSourceLabel'];
  readonly nativeSourceRequest?: CanvasNativeSourceRequest;
  readonly annotationActive?: boolean;
  readonly onAnnotateContent?: (id: string, request: CanvasContentAnnotationRequest) => void;
  readonly contentTracking?: ReadonlyMap<string, CanvasContentTracking>;
  readonly canEditExpandedObject?: boolean;
  readonly onOpenPresentation?: (ids: readonly string[]) => void;
  readonly onClosePresentation?: () => void;
  readonly canWriteObject?: (kind: CanvasObjectKind) => boolean;
  readonly onObjectIntent?: (
    intent: CanvasObjectIntent,
  ) => CanvasObjectReceipt | Promise<CanvasObjectReceipt>;
  readonly onToolChange?: (tool: CanvasTool) => void;
  readonly onEditIntent: (intent: CanvasEditIntent) => void;
  readonly onViewportChange?: (viewport: CanvasViewport) => void;
  readonly onViewportSizeChange?: (size: CanvasViewportSize) => void;
  readonly onViewportNavigation?: (navigation: CanvasViewportNavigation) => void;
  readonly onWorldPointerChange?: (point: CanvasPoint | undefined) => void;
  readonly onGesturePreviewChange?: (preview: CanvasGesturePreview | undefined) => void;
  readonly remoteGesturePreviews?: readonly CanvasGesturePreview[];
  readonly onVisibleObjectsChange?: (ids: readonly string[]) => void;
  readonly ref?: Ref<CanvasHandle>;
}
