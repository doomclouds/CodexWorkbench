import type { ReactNode } from 'react';
import type {
  BoardEditReceipt,
  BoardHistoryService,
  RequestBoardDownload,
  WhiteboardPayloadResult,
  WhiteboardScene,
} from '../../data/whiteboard/index.js';

export interface BoardHistoryPreviewFrame {
  readonly scene: WhiteboardScene;
  readonly loadPayloads: (
    objectIds: readonly string[],
    signal?: AbortSignal,
  ) => Promise<readonly WhiteboardPayloadResult[]>;
  readonly selection: readonly string[];
  readonly onSelectionChange: (ids: readonly string[]) => void;
}

export interface WhiteboardHistorySurfaceProps {
  readonly anchor: HTMLElement | null;
  readonly title: string;
  readonly boardId: string;
  readonly revision: bigint;
  readonly canEdit: boolean;
  readonly service: BoardHistoryService;
  readonly createCommandId: () => string;
  readonly onClose: () => void;
  readonly onRestored: (receipt: BoardEditReceipt) => void;
  readonly download: RequestBoardDownload;
  readonly renderPreview: (frame: BoardHistoryPreviewFrame) => ReactNode;
  readonly colorForAuthor?: (actorId: string) => string;
  readonly onPreviewChange?: (active: boolean) => void;
}
