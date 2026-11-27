import type { ReactNode } from 'react';
import type {
  AttachedReviewSource,
  SuggestionAppliedReceipt,
  SuggestionPreviewFrame,
  SuggestionService,
} from '../../data/suggestions/index.js';

export interface BoardSuggestionsSurfaceProps {
  readonly anchor: HTMLElement | null;
  readonly boardId: string;
  readonly revision: bigint;
  readonly service: SuggestionService;
  readonly createCommandId: () => string;
  readonly onRequestClose: () => void;
  readonly restoreFocus: () => void;
  readonly onApplied: (receipt: SuggestionAppliedReceipt) => void;
  readonly onPreviewChange?: (active: boolean) => void;
  readonly renderPreview?: (frame: SuggestionPreviewFrame) => ReactNode;
  readonly selection?: readonly string[];
  readonly feedbackThreadId?: string;
  readonly onAttachSource?: (reference: AttachedReviewSource) => void | Promise<void>;
  readonly attachmentMode?: 'context' | 'copy';
}

export interface SuggestionNotice {
  readonly message: string;
  readonly tone: 'error' | 'success';
}
