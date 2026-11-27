import type { ComponentProps } from 'react';
import type { BoardFeedbackService } from '../../data/feedback/index.js';
import type { BoardRoomSession } from '../../data/rooms/index.js';
import type { BoardSharingService } from '../../data/sharing/index.js';
import type { AttachedReviewSource, SuggestionService } from '../../data/suggestions/index.js';
import type {
  BoardHistoryService,
  ExportBoard,
  ExportBoardFile,
  WhiteboardEditService,
  WhiteboardService,
} from '../../data/whiteboard/index.js';
import { BoardSharingSurface } from '../../surfaces/board-sharing/index.js';
import { BoardSuggestionsSurface } from '../../surfaces/board-suggestions/index.js';
import { RoomPresenceSurface } from '../../surfaces/room-presence/index.js';
import { SharedTimerSurface } from '../../surfaces/shared-timer/index.js';
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

interface BoardReviewReference extends AttachedReviewSource {
  readonly boardId: string;
}

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
  readonly suggestions?: SuggestionService;
  readonly onAttachReviewSource?: (reference: BoardReviewReference) => Promise<void>;
  readonly reviewSourceMode?: 'context' | 'copy';
  readonly sharingService?: BoardSharingService;
  readonly copyShareLink?: (url: string) => Promise<void>;
  readonly consumeShareEntry?: () => boolean;
  readonly commentAccess?: boolean;
  readonly room?: BoardRoomSession;
  readonly onRoomAccessLost?: () => void;
  readonly onViewContext?: WhiteboardEditorFeatures['onViewContext'];
  readonly prepareImage?: ComponentProps<typeof WhiteboardMediaSurface>['prepareImage'];
  readonly renameBoard?: WhiteboardEditorSurfaceProps['renameBoard'];
  readonly readHtmlSource?: WhiteboardEditorFeatures['readHtmlSource'];
}

function roomFeatures({
  room,
  createCommandId,
  onRoomAccessLost,
  onViewContext,
}: WhiteboardPageProps): Pick<
  WhiteboardEditorFeatures,
  'renderPresence' | 'renderSharedTimer' | 'onRoomAccessLost' | 'onViewContext'
> {
  return {
    renderPresence: room ? (frame) => <RoomPresenceSurface {...frame} session={room} /> : undefined,
    renderSharedTimer: room
      ? () => <SharedTimerSurface session={room} createCommandId={createCommandId} />
      : undefined,
    onRoomAccessLost,
    onViewContext,
  };
}

function shareAndExport({
  sharingService,
  copyShareLink,
  createCommandId,
  exportBoard,
  downloadExport,
}: WhiteboardPageProps): WhiteboardEditorFeatures['renderExport'] {
  if (!sharingService || !copyShareLink) {
    return exportBoard && downloadExport
      ? (frame) => (
          <WhiteboardExportSurface {...frame} exportBoard={exportBoard} download={downloadExport} />
        )
      : undefined;
  }

  return (frame) => (
    <BoardSharingSurface
      anchor={frame.anchor}
      boardId={frame.context.boardId}
      title={frame.context.title}
      service={sharingService}
      createCommandId={createCommandId}
      copyLink={copyShareLink}
      onRequestClose={frame.onRequestClose}
      restoreFocus={frame.restoreFocus}
      exportContent={
        exportBoard && downloadExport ? (
          <WhiteboardExportSurface
            {...frame}
            inline
            exportBoard={exportBoard}
            download={downloadExport}
          />
        ) : undefined
      }
    />
  );
}

function whiteboardFeatures(props: WhiteboardPageProps): WhiteboardEditorFeatures {
  const {
    createCommandId,
    downloadExport,
    editService,
    historyService,
    feedbackService,
    prepareImage,
    readHtmlSource,
    commentAccess,
    suggestions,
    onAttachReviewSource,
    reviewSourceMode,
  } = props;

  return {
    ...roomFeatures(props),
    Viewing: WhiteboardViewingSurface,
    editService,
    readHtmlSource,
    commentAccess,
    consumeShareEntry: props.consumeShareEntry,
    renderExport: shareAndExport(props),
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
            onReviewThread={suggestions && onAttachReviewSource ? frame.onReviewThread : undefined}
          />
        )
      : undefined,
    renderSuggestions: suggestions
      ? (frame) => (
          <BoardSuggestionsSurface
            anchor={frame.anchor}
            boardId={frame.boardId}
            revision={frame.revision}
            service={suggestions}
            createCommandId={createCommandId}
            onRequestClose={frame.onClose}
            restoreFocus={frame.restoreFocus}
            onApplied={frame.onApplied}
            onPreviewChange={frame.onPreviewChange}
            renderPreview={({ proposalId, optionId, changes }) =>
              frame.renderPreview(proposalId + ':' + optionId, changes)
            }
            selection={frame.selection}
            feedbackThreadId={frame.feedbackThreadId}
            onAttachSource={
              onAttachReviewSource
                ? (source) => onAttachReviewSource({ boardId: frame.boardId, ...source })
                : undefined
            }
            attachmentMode={reviewSourceMode}
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
