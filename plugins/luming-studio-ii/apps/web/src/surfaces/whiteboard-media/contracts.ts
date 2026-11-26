import type { ReactNode } from 'react';

import type { BoardEditReceipt, WhiteboardEditService } from '../../data/whiteboard/index.js';
import type { CanvasViewport } from '../../ui/domain/canvas/index.js';

export interface PreparedBoardImage {
  readonly displayName: string;
  readonly width: number;
  readonly height: number;
  readonly content: Uint8Array;
  readonly previewUrl: string;
  readonly dispose: () => void;
}

export interface WhiteboardMediaSurfaceProps {
  readonly boardId: string;
  readonly canEdit: boolean;
  readonly paused?: boolean;
  readonly viewport: CanvasViewport;
  readonly createCommandId: () => string;
  readonly service: Pick<WhiteboardEditService, 'attachImage' | 'getReceipt'>;
  readonly prepareImage: (file: File, signal?: AbortSignal) => Promise<PreparedBoardImage>;
  readonly onApplied: (receipt: Extract<BoardEditReceipt, { kind: 'applied' }>) => void;
  readonly renderTools: (mediaAction: (onChoose: () => void) => ReactNode) => ReactNode;
  readonly onExitPlacement?: () => void;
}
