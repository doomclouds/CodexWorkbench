import type { ComponentProps } from 'react';
import type { BoardFeedbackService } from '../../data/feedback/index.js';
import type {
  BoardHistoryService,
  ExportBoard,
  ExportBoardFile,
  WhiteboardEditService,
  WhiteboardService,
} from '../../data/whiteboard/index.js';
import {
  WhiteboardEditorSurface,
  type WhiteboardEditorFeatures,
  type WhiteboardEditorSurfaceProps,
} from '../../surfaces/whiteboard-editor/index.js';
import { WhiteboardExportSurface } from '../../surfaces/whiteboard-export/index.js';
import { WhiteboardFeedbackSurface } from '../../surfaces/whiteboard-feedback/index.js';
import { WhiteboardHistorySurface } from '../../surfaces/whiteboard-history/index.js';
import { WhiteboardMediaSurface } from '../../surfaces/whiteboard-media/index.js';
import { WhiteboardViewingSurface } from '../../surfaces/whiteboard-viewing/index.js';
import { StatePanel } from '../../ui/base/index.js';

export interface WhiteboardPageProps {
  readonly boardId?: string;
  readonly service: WhiteboardService;
  readonly createCommandId: () => string;
  readonly onBack?: () => void;
  readonly exportBoard?: ExportBoard;
  readonly downloadExport?: (file: ExportBoardFile) => void;
  readonly editService?: WhiteboardEditService;
  readonly historyService?: BoardHistoryService;
  readonly feedbackService?: BoardFeedbackService;
  readonly prepareImage?: ComponentProps<typeof WhiteboardMediaSurface>['prepareImage'];
  readonly renameBoard?: WhiteboardEditorSurfaceProps['renameBoard'];
  readonly readHtmlSource?: WhiteboardEditorFeatures['readHtmlSource'];
}

function whiteboardFeatures({
  createCommandId,
  exportBoard,
  downloadExport,
  editService,
  historyService,
  feedbackService,
  prepareImage,
  readHtmlSource,
}: WhiteboardPageProps): WhiteboardEditorFeatures {
  return {
    Viewing: WhiteboardViewingSurface,
    editService,
    readHtmlSource,
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
    renderHistory:
      historyService && downloadExport
        ? (frame) => (
            <WhiteboardHistorySurface
              {...frame}
              service={historyService}
              createCommandId={createCommandId}
              download={downloadExport}
            />
          )
        : undefined,
    renderFeedback: feedbackService
      ? (frame) => (
          <WhiteboardFeedbackSurface
            {...frame}
            service={feedbackService}
            createCommandId={createCommandId}
          />
        )
      : undefined,
    renderMedia:
      editService && prepareImage
        ? (frame) => (
            <WhiteboardMediaSurface
              {...frame}
              service={editService}
              createCommandId={createCommandId}
              prepareImage={prepareImage}
            />
          )
        : undefined,
  };
}

export function WhiteboardPage(props: WhiteboardPageProps) {
  const { boardId, service, createCommandId, onBack, renameBoard } = props;
  if (!boardId) {
    return (
      <StatePanel kind="empty" title="请选择白板" detail="在地址中用 ?board= 指定要打开的白板。" />
    );
  }

  return (
    <WhiteboardEditorSurface
      key={boardId}
      boardId={boardId}
      service={service}
      createCommandId={createCommandId}
      onBack={onBack}
      renameBoard={renameBoard}
      features={whiteboardFeatures(props)}
    />
  );
}
