import type {
  ExportBoard,
  ExportBoardFile,
  WhiteboardService,
} from '../../data/whiteboard/index.js';
import {
  WhiteboardEditorSurface,
  type WhiteboardEditorFeatures,
} from '../../surfaces/whiteboard-editor/index.js';
import { WhiteboardExportSurface } from '../../surfaces/whiteboard-export/index.js';
import { WhiteboardViewingSurface } from '../../surfaces/whiteboard-viewing/index.js';
import { StatePanel } from '../../ui/base/index.js';

export interface WhiteboardPageProps {
  readonly boardId?: string;
  readonly service: WhiteboardService;
  readonly createCommandId: () => string;
  readonly onBack?: () => void;
  readonly exportBoard?: ExportBoard;
  readonly downloadExport?: (file: ExportBoardFile) => void;
}

export function WhiteboardPage({
  boardId,
  service,
  createCommandId,
  onBack,
  exportBoard,
  downloadExport,
}: WhiteboardPageProps) {
  if (!boardId) {
    return (
      <StatePanel kind="empty" title="请选择白板" detail="在地址中用 ?board= 指定要打开的白板。" />
    );
  }

  const features: WhiteboardEditorFeatures = {
    Viewing: WhiteboardViewingSurface,
    renderExport:
      exportBoard && downloadExport
        ? (frame) => (
            <WhiteboardExportSurface
              {...frame}
              exportBoard={exportBoard}
              download={downloadExport}
            />
          )
        : undefined,
  };

  return (
    <WhiteboardEditorSurface
      key={boardId}
      boardId={boardId}
      service={service}
      createCommandId={createCommandId}
      onBack={onBack}
      features={features}
    />
  );
}
