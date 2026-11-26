import type { ComponentType, ReactNode } from 'react';
import type {
  BoardEditReceipt,
  WhiteboardEditService,
  WhiteboardObject,
  WhiteboardPayloadResult,
  WhiteboardScene,
} from '../../data/whiteboard/index.js';
import type { CanvasPoint, CanvasViewport } from '../../ui/domain/canvas/index.js';

type AppliedEdit = Extract<BoardEditReceipt, { kind: 'applied' }>;

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

interface BoardExportFrame {
  readonly anchor: Element;
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
  readonly renderExport?: (frame: BoardExportFrame) => ReactNode;
  readonly renderHistory?: (frame: BoardHistoryFrame) => ReactNode;
  readonly renderFeedback?: (frame: BoardFeedbackFrame) => ReactNode;
  readonly renderMedia?: (frame: BoardMediaFrame) => ReactNode;
}
