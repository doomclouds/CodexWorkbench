import type { BoardFeedbackService, FeedbackPoint } from '../../data/feedback/index.js';

export interface FeedbackCanvasObject {
  readonly id: string;
  readonly label: string;
  readonly geometry: FeedbackPoint & {
    readonly width: number;
    readonly height: number;
    readonly rotation: number;
  };
  readonly geometryVersion: bigint;
}

export interface FeedbackViewport extends FeedbackPoint {
  readonly zoom: number;
}

export interface WhiteboardFeedbackSurfaceProps {
  readonly boardId: string;
  readonly canEdit: boolean;
  readonly viewing: boolean;
  readonly viewport: FeedbackViewport;
  readonly objects: readonly FeedbackCanvasObject[];
  readonly selectedIds: readonly string[];
  readonly service: BoardFeedbackService;
  readonly createCommandId: () => string;
  readonly panelOpen: boolean;
  readonly onPanelOpenChange: (open: boolean) => void;
  readonly anchor?: HTMLElement | null;
  readonly focusWorldPoint?: (point: FeedbackPoint) => void;
  readonly annotationActive?: boolean;
  readonly singleKeys?: boolean;
  readonly onAnnotationActiveChange?: (active: boolean) => void;
  readonly onUnresolvedChange?: (unresolved: boolean) => void;
  readonly annotationRequest?: { readonly objectId: string; readonly sequence: number };
}
