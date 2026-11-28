import type { ComponentType, ReactNode } from 'react';
import type {
  BoardEditReceipt,
  WhiteboardContentChange,
  WhiteboardEditService,
  WhiteboardObject,
  WhiteboardPayloadResult,
  WhiteboardScene,
} from '../../data/whiteboard/index.js';
import type {
  CanvasGesturePreview,
  CanvasGeometry,
  CanvasPoint,
  CanvasContentAnnotationRequest,
  CanvasContentLocation,
  CanvasContentLocationRequest,
  CanvasProps,
  CanvasViewport,
  CanvasViewportSize,
} from '../../ui/domain/canvas/index.js';
import type { LocalBoardDraftConfig } from './local-board-drafts.js';

type AppliedEdit = Extract<BoardEditReceipt, { kind: 'applied' }>;

export interface BoardViewContext {
  readonly boardId: string;
  readonly selectedIds: readonly string[];
  readonly viewport: CanvasViewport;
  readonly focusedObjectId?: string;
  readonly returnViewport?: CanvasViewport;
}

type InitialBoardView = Omit<BoardViewContext, 'viewport'> & {
  readonly viewport?: CanvasViewport;
};

export interface BoardPresenceSlot {
  readonly connection?: 'connecting' | 'reconnecting';
  readonly participants: ReactNode;
  readonly notice: ReactNode;
  readonly overlay: ReactNode;
  readonly accessLost: boolean;
  readonly feedbackUpdateKey?: string;
  readonly viewerActorId?: string;
  readonly suggestionsUpdateKey?: string;
  readonly onCursorChange: (point: CanvasPoint | undefined) => void;
  readonly onGesturePreviewChange: (preview: CanvasGesturePreview | undefined) => void;
  readonly remoteGesturePreviews?: readonly CanvasGesturePreview[];
}

interface BoardPresenceFrame {
  readonly viewport?: CanvasViewport & CanvasViewportSize;
  readonly editingObjectIds?: readonly string[];
  readonly objectGeometry?: ReadonlyMap<string, CanvasGeometry>;
  readonly paused: boolean;
  readonly detachSequence: number;
  readonly onViewportRequest: (viewport: CanvasViewport) => void;
  readonly onCanvasFocus: () => void;
  readonly onContentChanged: (change: WhiteboardContentChange) => void;
  readonly onAccessLost: () => void;
  readonly render: (slot: BoardPresenceSlot) => ReactNode;
}

interface BoardViewingFrame {
  readonly active: boolean;
  readonly documentReading: boolean;
  readonly title: string;
  readonly viewport: CanvasViewport;
  readonly onZoom: (zoom: number) => void;
  readonly onFit: () => void;
  readonly onExit: () => void;
  readonly onCanvasFocus: () => void;
  readonly children: ReactNode;
}

export interface BoardExportContext {
  readonly boardId: string;
  readonly title: string;
  readonly revision: bigint;
  readonly selectedIds: readonly string[];
  readonly selectedHtmlId?: string;
}

export interface BoardExportFrame {
  readonly anchor: HTMLButtonElement | null;
  readonly context: BoardExportContext;
  readonly onLanSharingChange: (active: boolean) => void;
  readonly onRequestClose: () => void;
  readonly restoreFocus: () => void;
}

export interface BoardPreviewFrame {
  readonly scene: WhiteboardScene;
  readonly loadPayloads: (
    objectIds: readonly string[],
    signal?: AbortSignal,
  ) => Promise<readonly WhiteboardPayloadResult[]>;
  readonly selection: readonly string[];
  readonly onSelectionChange: (ids: readonly string[]) => void;
}

export interface BoardHistoryFrame {
  readonly boardId: string;
  readonly title: string;
  readonly revision: bigint;
  readonly canEdit: boolean;
  readonly anchor: HTMLButtonElement | null;
  readonly onClose: () => void;
  readonly onPreviewChange: (active: boolean) => void;
  readonly onRestored: (receipt: BoardEditReceipt) => void;
  readonly renderPreview: (frame: BoardPreviewFrame) => ReactNode;
}

type ContentLocationRequests = ReadonlyMap<string, readonly CanvasContentLocationRequest[]>;

export interface BoardFeedbackFrame {
  readonly boardId: string;
  readonly updateKey?: string;
  readonly viewerActorId?: string;
  readonly canEdit: boolean;
  readonly viewing: boolean;
  readonly viewport: CanvasViewport & { readonly zoomY?: number };
  readonly viewportSize?: CanvasViewportSize;
  readonly objects: readonly WhiteboardObject[];
  readonly selectedIds: readonly string[];
  readonly panelOpen: boolean;
  readonly onPanelOpenChange: (open: boolean) => void;
  readonly anchor: HTMLButtonElement | null;
  readonly focusWorldPoint: (point: CanvasPoint) => void;
  readonly focusContentObject?: (id: string) => void;
  readonly contentLocations?: ReadonlyMap<string, CanvasContentLocation>;
  readonly onContentLocationRequests?: (requests: ContentLocationRequests | undefined) => void;
  readonly annotationActive?: boolean;
  readonly onAnnotationActiveChange?: (active: boolean) => void;
  readonly onUnresolvedChange?: (unresolved: boolean) => void;
  readonly annotationRequest?: {
    readonly objectId: string;
    readonly sequence: number;
    readonly u?: number;
    readonly v?: number;
  };
  readonly pointAnnotationRequest?: { readonly sequence: number; readonly point: CanvasPoint };
  readonly selectionAnnotationRequest?: {
    readonly sequence: number;
    readonly target: BoardSelectionAnnotation;
  };
  readonly hostPicking?: boolean;
  readonly focusedObjectId?: string;
  readonly contentAnnotationRequest?: {
    readonly sequence: number;
    readonly target: BoardContentAnnotation;
    readonly excerpt?: string;
  };
  readonly singleKeys?: boolean;
  readonly renderSuggestions?: (frame: BoardSuggestionListFrame) => ReactNode;
}

export interface BoardSelectionAnnotation {
  readonly kind: 'selection';
  readonly point: CanvasPoint;
  readonly bounds?: CanvasPoint & { readonly width: number; readonly height: number };
  readonly objects: readonly {
    readonly objectId: string;
    readonly geometryVersion: bigint;
    readonly payloadVersion?: bigint;
  }[];
  readonly expectedBoardRevision: bigint;
}

export interface BoardSuggestionListFrame {
  readonly showCards: boolean;
  readonly outlet: HTMLElement | null;
  readonly onCardsVisibleChange: (visible: boolean) => void;
}

interface BoardContentAnnotation {
  readonly kind: 'content';
  readonly objectId: string;
  readonly geometryVersion: bigint;
  readonly payloadVersion: bigint;
  readonly u: number;
  readonly v: number;
  readonly content: Exclude<CanvasContentAnnotationRequest['target'], { kind: 'object' }>;
}

export type BoardSuggestionPreviewChanges = Pick<
  AppliedEdit,
  'revision' | 'objects' | 'removedIds' | 'order' | 'payloads'
>;

export interface BoardSuggestionFrame {
  readonly anchor: HTMLButtonElement | null;
  readonly boardId: string;
  readonly updateKey?: string;
  readonly previewHost?: HTMLElement | null;
  readonly inline?: BoardSuggestionListFrame & { readonly previewHost: HTMLElement | null };
  readonly onClose: () => void;
  readonly restoreFocus: () => void;
  readonly onPreviewChange: (active: boolean) => void;
  readonly onApplied: (receipt: AppliedEdit) => void;
  readonly renderPreview: (key: string, changes: BoardSuggestionPreviewChanges) => ReactNode;
}

export type BoardMediaAction = (onChoose: () => void) => ReactNode;
export type BoardMediaUpload = (files: readonly File[], point?: CanvasPoint) => void;

export interface BoardClipboardAccess {
  readonly writeText: (text: string) => Promise<void>;
  readonly readText: () => Promise<string>;
}

interface BoardMediaFrame {
  readonly boardId: string;
  readonly canEdit: boolean;
  readonly paused: boolean;
  readonly viewport: CanvasViewport;
  readonly onApplied: (receipt: AppliedEdit) => void;
  readonly renderTools: (action: BoardMediaAction) => ReactNode;
  readonly onExitPlacement: () => void;
  readonly placementPoint: () => CanvasPoint | undefined;
  readonly onUploadReady: (upload: BoardMediaUpload | undefined) => void;
}

export interface WhiteboardEditorFeatures {
  readonly fitOnMount?: boolean;
  readonly initialBoardView?: InitialBoardView;
  readonly theme?: {
    readonly resolvedTheme: 'light' | 'dark';
    readonly onThemeChange: (theme: 'light' | 'dark') => void;
  };
  readonly Viewing: ComponentType<BoardViewingFrame>;
  readonly editService?: WhiteboardEditService;
  readonly readHtmlSource?: (file: File) => Promise<string>;
  readonly downloadObjectFile?: CanvasProps['downloadFile'];
  readonly readDocumentAsset?: CanvasProps['readDocumentAsset'];
  readonly uploadDocumentImage?: CanvasProps['uploadDocumentImage'];
  readonly clipboard?: BoardClipboardAccess;
  readonly localDrafts?: LocalBoardDraftConfig;
  readonly editAccess?: boolean;
  readonly commentAccess?: boolean;
  readonly lanSharing?: boolean;
  readonly consumeShareEntry?: () => boolean;
  readonly renderPresence?: (frame: BoardPresenceFrame) => ReactNode;
  readonly renderSharedTimer?: () => ReactNode;
  readonly onRoomAccessLost?: () => void;
  readonly onViewContext?: (context: BoardViewContext | undefined) => void;
  readonly renderExport?: (frame: BoardExportFrame) => ReactNode;
  readonly renderHistory?: (frame: BoardHistoryFrame) => ReactNode;
  readonly renderFeedback?: (frame: BoardFeedbackFrame) => ReactNode;
  readonly renderSuggestions?: (frame: BoardSuggestionFrame) => ReactNode;
  readonly renderMedia?: (frame: BoardMediaFrame) => ReactNode;
}
