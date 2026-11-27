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
  CanvasPoint,
  CanvasViewport,
  CanvasViewportSize,
} from '../../ui/domain/canvas/index.js';

type AppliedEdit = Extract<BoardEditReceipt, { kind: 'applied' }>;

export interface BoardViewContext {
  readonly boardId: string;
  readonly selectedIds: readonly string[];
  readonly viewport: CanvasViewport;
}

export interface BoardPresenceSlot {
  readonly participants: ReactNode;
  readonly notice: ReactNode;
  readonly overlay: ReactNode;
  readonly accessLost: boolean;
  readonly onCursorChange: (point: CanvasPoint | undefined) => void;
}

interface BoardPresenceFrame {
  readonly viewport?: CanvasViewport & CanvasViewportSize;
  readonly paused: boolean;
  readonly detachSequence: number;
  readonly onViewportRequest: (viewport: CanvasViewport) => void;
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
}

export interface BoardExportFrame {
  readonly anchor: HTMLButtonElement | null;
  readonly context: BoardExportContext;
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

export interface BoardFeedbackFrame {
  readonly boardId: string;
  readonly canEdit: boolean;
  readonly viewing: boolean;
  readonly viewport: CanvasViewport;
  readonly objects: readonly WhiteboardObject[];
  readonly selectedIds: readonly string[];
  readonly panelOpen: boolean;
  readonly onPanelOpenChange: (open: boolean) => void;
  readonly anchor: HTMLButtonElement | null;
  readonly focusWorldPoint: (point: CanvasPoint) => void;
  readonly annotationActive?: boolean;
  readonly onAnnotationActiveChange?: (active: boolean) => void;
  readonly onUnresolvedChange?: (unresolved: boolean) => void;
  readonly annotationRequest?: { readonly objectId: string; readonly sequence: number };
  readonly singleKeys?: boolean;
  readonly onReviewThread?: (threadId: string) => void;
}

export type BoardSuggestionPreviewChanges = Pick<
  AppliedEdit,
  'revision' | 'objects' | 'removedIds' | 'order' | 'payloads'
>;

export interface BoardSuggestionFrame {
  readonly anchor: HTMLButtonElement | null;
  readonly boardId: string;
  readonly revision: bigint;
  readonly selection: readonly string[];
  readonly feedbackThreadId?: string;
  readonly onClose: () => void;
  readonly restoreFocus: () => void;
  readonly onPreviewChange: (active: boolean) => void;
  readonly onApplied: (receipt: AppliedEdit) => void;
  readonly renderPreview: (key: string, changes: BoardSuggestionPreviewChanges) => ReactNode;
}

export type BoardMediaAction = (onChoose: () => void) => ReactNode;

interface BoardMediaFrame {
  readonly boardId: string;
  readonly canEdit: boolean;
  readonly paused: boolean;
  readonly viewport: CanvasViewport;
  readonly onApplied: (receipt: AppliedEdit) => void;
  readonly renderTools: (action: BoardMediaAction) => ReactNode;
  readonly onExitPlacement: () => void;
}

export interface WhiteboardEditorFeatures {
  readonly Viewing: ComponentType<BoardViewingFrame>;
  readonly editService?: WhiteboardEditService;
  readonly readHtmlSource?: (file: File) => Promise<string>;
  readonly commentAccess?: boolean;
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
