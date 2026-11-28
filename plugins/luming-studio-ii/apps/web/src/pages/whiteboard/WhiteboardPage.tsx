import type { ComponentProps } from 'react';
import type { BoardFeedbackService } from '../../data/feedback/index.js';
import type { BoardRoomSession } from '../../data/rooms/index.js';
import type { BoardSharingService } from '../../data/sharing/index.js';
import type { AttachedReviewSource, SuggestionService } from '../../data/suggestions/index.js';
import type {
  BoardHistoryService,
  ExportBoard,
  RequestBoardDownload,
  WhiteboardEditService,
  WhiteboardService,
} from '../../data/whiteboard/index.js';
import { BoardSharingSurface } from '../../surfaces/board-sharing/index.js';
import { BoardSuggestionsSurface } from '../../surfaces/board-suggestions/index.js';
import { participantColor, RoomPresenceSurface } from '../../surfaces/room-presence/index.js';
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
  readonly feedbackThreadId: string;
  readonly comment: string;
  readonly excerpt?: string;
  readonly targetLabel?: string;
  readonly selectedTargets?: readonly {
    readonly objectId: string;
    readonly kind: string;
    readonly label: string;
  }[];
}

interface DocumentAsset {
  readonly mimeType: string;
  readonly content: Uint8Array;
}

export interface WhiteboardPageProps {
  readonly boardId?: string;
  readonly service: WhiteboardService;
  readonly createCommandId: () => string;
  readonly onBack?: () => void;
  readonly exportBoard?: ExportBoard;
  readonly downloadExport?: RequestBoardDownload;
  readonly downloadObjectFile?: WhiteboardEditorFeatures['downloadObjectFile'];
  readonly clipboard?: WhiteboardEditorFeatures['clipboard'];
  readonly localDrafts?: WhiteboardEditorFeatures['localDrafts'];
  readonly readDocumentAsset?: (
    boardId: string,
    source: string,
    signal?: AbortSignal,
  ) => Promise<DocumentAsset | undefined>;
  readonly readDocumentImageFile?: (file: File) => Promise<Uint8Array>;
  readonly editService?: WhiteboardEditService;
  readonly historyService?: BoardHistoryService;
  readonly feedbackService?: BoardFeedbackService;
  readonly suggestions?: SuggestionService;
  readonly onAttachReviewSource?: (
    reference: BoardReviewReference,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly sharingService?: BoardSharingService;
  readonly copyShareLink?: (url: string) => Promise<void>;
  readonly theme?: WhiteboardEditorFeatures['theme'];
  readonly lanSharing?: boolean;
  readonly consumeShareEntry?: () => boolean;
  readonly editAccess?: boolean;
  readonly commentAccess?: boolean;
  readonly room?: BoardRoomSession;
  readonly onRoomAccessLost?: () => void;
  readonly onViewContext?: WhiteboardEditorFeatures['onViewContext'];
  readonly fitOnMount?: boolean;
  readonly initialBoardView?: WhiteboardEditorFeatures['initialBoardView'];
  readonly prepareImage?: ComponentProps<typeof WhiteboardMediaSurface>['prepareImage'];
  readonly prepareVideo?: ComponentProps<typeof WhiteboardMediaSurface>['prepareVideo'];
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

function activeShareMembers(room: BoardRoomSession) {
  const { status, actorId, participants } = room.getSnapshot();
  if (status !== 'online') {
    return undefined;
  }

  const members = new Set(participants.map((participant) => participant.actorId));
  if (actorId !== undefined) {
    members.delete(actorId);
  }
  return members;
}

function subscribeShareMembers(room: BoardRoomSession, changed: () => void) {
  let members = activeShareMembers(room);
  return room.subscribe(() => {
    const previous = members;
    members = activeShareMembers(room);
    if (!members) {
      return;
    }

    const different =
      !previous || members.size !== previous.size || [...members].some((id) => !previous.has(id));

    if (different) {
      changed();
    }
  });
}

function shareAndExport({
  sharingService,
  copyShareLink,
  createCommandId,
  exportBoard,
  downloadExport,
  lanSharing,
  room,
}: WhiteboardPageProps): WhiteboardEditorFeatures['renderExport'] {
  if (!sharingService || !copyShareLink) {
    return exportBoard && downloadExport
      ? (frame) => (
          <WhiteboardExportSurface {...frame} exportBoard={exportBoard} download={downloadExport} />
        )
      : undefined;
  }

  const subscribeMemberPresence = room
    ? (listener: () => void) => subscribeShareMembers(room, listener)
    : undefined;

  return (frame) => (
    <BoardSharingSurface
      anchor={frame.anchor}
      boardId={frame.context.boardId}
      title={frame.context.title}
      service={sharingService}
      createCommandId={createCommandId}
      copyLink={copyShareLink}
      onLanSharingChange={lanSharing === undefined ? frame.onLanSharingChange : undefined}
      subscribeMemberPresence={subscribeMemberPresence}
      onRequestClose={frame.onRequestClose}
      restoreFocus={frame.restoreFocus}
      exportContent={
        exportBoard && downloadExport ? (
          <WhiteboardExportSurface
            {...frame}
            inline
            canBackup
            exportBoard={exportBoard}
            download={downloadExport}
          />
        ) : undefined
      }
    />
  );
}

function documentImages(
  props: WhiteboardPageProps,
): Pick<WhiteboardEditorFeatures, 'readDocumentAsset' | 'uploadDocumentImage'> {
  const { boardId, readDocumentAsset, readDocumentImageFile, editService, createCommandId } = props;
  if (!boardId) {
    return {};
  }

  return {
    readDocumentAsset:
      readDocumentAsset && ((source, signal) => readDocumentAsset(boardId, source, signal)),
    uploadDocumentImage:
      readDocumentImageFile &&
      editService?.uploadDocumentImage &&
      (async (objectId, file) => {
        const content = await readDocumentImageFile(file);
        const command = { boardId, objectId, content, commandId: createCommandId() };
        const result = await editService.uploadDocumentImage?.(command);
        if (result?.receipt.kind !== 'applied' || !result.assetUrl) {
          throw new Error('白板服务未能保存文档图片。');
        }

        return result.assetUrl;
      }),
  };
}

function whiteboardFeatures(props: WhiteboardPageProps): WhiteboardEditorFeatures {
  const {
    createCommandId,
    downloadExport,
    downloadObjectFile,
    clipboard,
    localDrafts,
    editService,
    historyService,
    feedbackService,
    prepareImage,
    prepareVideo,
    readHtmlSource,
    editAccess,
    commentAccess,
    suggestions,
    onAttachReviewSource,
  } = props;

  return {
    ...roomFeatures(props),
    fitOnMount: props.fitOnMount,
    initialBoardView: props.initialBoardView,
    theme: props.theme,
    ...documentImages(props),
    Viewing: WhiteboardViewingSurface,
    editService,
    readHtmlSource,
    downloadObjectFile,
    clipboard,
    localDrafts,
    editAccess,
    commentAccess,
    lanSharing: props.lanSharing,
    consumeShareEntry: props.consumeShareEntry,
    renderExport: shareAndExport(props),
    renderHistory:
      historyService && downloadExport
        ? (frame) => (
            <WhiteboardHistorySurface
              {...frame}
              service={historyService}
              createCommandId={createCommandId}
              colorForAuthor={participantColor}
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
            colorForAuthor={participantColor}
            onAttachThread={
              suggestions && onAttachReviewSource
                ? async ({ boardId, threadId, threadVersion, commandId, signal }) => {
                    const { thread } = await feedbackService.getThread(
                      { boardId, threadId, pageSize: 1 },
                      signal,
                    );
                    signal.throwIfAborted();
                    if (thread.version !== threadVersion) {
                      throw new Error('备注内容已更新，请重新核对后附加。');
                    }

                    const source = await suggestions.createReviewSource(
                      { boardId, commandId, origin: { kind: 'feedback', threadId } },
                      signal,
                    );
                    signal.throwIfAborted();
                    const target = thread.anchor.target;
                    const targetLabel =
                      target.kind === 'selection'
                        ? (target.bounds ? '画板范围' : '选区') +
                          ' · ' +
                          target.objects.length +
                          ' 个对象'
                        : thread.anchor.frozenObject?.label;
                    await onAttachReviewSource(
                      {
                        boardId,
                        feedbackThreadId: thread.id,
                        comment: thread.first.text,
                        excerpt: thread.anchor.frozenExcerpt,
                        targetLabel,
                        selectedTargets: thread.anchor.frozenTargets?.map(
                          ({ reference, object }) => ({
                            objectId: reference.objectId,
                            kind: object.kind,
                            label: object.label,
                          }),
                        ),
                        sourceId: source.sourceId,
                        capturedBoardRevision: source.capturedBoardRevision,
                        targetsBoardRevision: source.targetsBoardRevision,
                        targets: source.targets,
                      },
                      signal,
                    );
                  }
                : undefined
            }
          />
        )
      : undefined,
    renderSuggestions: suggestions
      ? (frame) => (
          <BoardSuggestionsSurface
            anchor={frame.anchor}
            inline={frame.inline}
            boardId={frame.boardId}
            updateKey={frame.updateKey}
            service={suggestions}
            createCommandId={createCommandId}
            onRequestClose={frame.onClose}
            restoreFocus={frame.restoreFocus}
            onApplied={frame.onApplied}
            onPreviewChange={frame.onPreviewChange}
            renderPreview={({ proposalId, optionId, changes }) =>
              frame.renderPreview(proposalId + ':' + optionId, changes)
            }
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
              prepareVideo={prepareVideo}
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
