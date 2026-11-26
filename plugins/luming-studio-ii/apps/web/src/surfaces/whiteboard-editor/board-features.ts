import type { ComponentType, ReactNode } from 'react';
import type { CanvasViewport } from '../../ui/domain/canvas/index.js';

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

interface BoardExportContext {
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

export interface WhiteboardEditorFeatures {
  readonly Viewing: ComponentType<BoardViewingFrame>;
  readonly renderExport?: (frame: BoardExportFrame) => ReactNode;
}
