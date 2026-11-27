import type { ReactNode } from 'react';
import type {
  CanvasContentLocation,
  CanvasContentLocationRequest,
} from '../../ui/domain/canvas/index.js';
import type {
  BoardFeedbackService,
  FeedbackContentTarget,
  FeedbackPoint,
} from '../../data/feedback/index.js';

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
  readonly zoomY?: number;
}

export interface FeedbackAttachmentRequest {
  readonly boardId: string;
  readonly threadId: string;
  readonly commandId: string;
  readonly signal: AbortSignal;
}

export interface FeedbackSuggestionsFrame {
  readonly outlet: HTMLElement | null;
  readonly showCards: boolean;
  readonly onCardsVisibleChange: (visible: boolean) => void;
}

type ContentLocationRequests = ReadonlyMap<string, readonly CanvasContentLocationRequest[]>;

export interface WhiteboardFeedbackSurfaceProps {
  readonly boardId: string;
  readonly updateKey?: string;
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
  readonly focusContentObject?: (id: string) => void;
  readonly contentLocations?: ReadonlyMap<string, CanvasContentLocation>;
  readonly onContentLocationRequests?: (requests: ContentLocationRequests | undefined) => void;
  readonly annotationActive?: boolean;
  readonly singleKeys?: boolean;
  readonly onAnnotationActiveChange?: (active: boolean) => void;
  readonly onUnresolvedChange?: (unresolved: boolean) => void;
  readonly onReviewThread?: (threadId: string) => void;
  readonly onAttachThread?: (request: FeedbackAttachmentRequest) => Promise<void>;
  readonly attachmentMode?: 'context' | 'copy';
  readonly annotationRequest?: {
    readonly objectId: string;
    readonly sequence: number;
    readonly u?: number;
    readonly v?: number;
  };
  readonly pointAnnotationRequest?: { readonly sequence: number; readonly point: FeedbackPoint };
  readonly hostPicking?: boolean;
  readonly focusedObjectId?: string;
  readonly contentAnnotationRequest?: {
    readonly sequence: number;
    readonly target: FeedbackContentTarget;
  };
  readonly contentPoints?: ReadonlyMap<string, FeedbackPoint>;
  readonly renderSuggestions?: (frame: FeedbackSuggestionsFrame) => ReactNode;
}
