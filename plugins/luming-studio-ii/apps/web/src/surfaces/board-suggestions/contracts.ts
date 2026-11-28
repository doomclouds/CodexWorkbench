import type { ReactNode } from 'react';
import type {
  SuggestionAppliedReceipt,
  SuggestionPreviewFrame,
  SuggestionService,
} from '../../data/suggestions/index.js';

interface InlineBoardSuggestions {
  readonly outlet: HTMLElement | null;
  readonly previewHost: HTMLElement | null;
  readonly showCards: boolean;
  readonly onCardsVisibleChange: (visible: boolean) => void;
}

export interface BoardSuggestionsSurfaceProps {
  readonly anchor: HTMLElement | null;
  readonly boardId: string;
  readonly updateKey?: string;
  readonly service: SuggestionService;
  readonly createCommandId: () => string;
  readonly onRequestClose: () => void;
  readonly restoreFocus: () => void;
  readonly onApplied: (receipt: SuggestionAppliedReceipt) => void;
  readonly onPreviewChange?: (active: boolean) => void;
  readonly renderPreview?: (frame: SuggestionPreviewFrame) => ReactNode;
  readonly inline?: InlineBoardSuggestions;
}

export interface SuggestionNotice {
  readonly message: string;
  readonly tone: 'error' | 'success';
}
