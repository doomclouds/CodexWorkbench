import { Lightbulb } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import type { BoardEditReceipt } from '../../data/whiteboard/index.js';
import { OperationNotice, StatusText } from '../../ui/base/index.js';
import {
  Canvas,
  type CanvasObject,
  type CanvasProps,
  type CanvasViewport,
} from '../../ui/domain/canvas/index.js';
import {
  BoardDocumentChrome,
  BoardHeader,
  BoardSelectionViewing,
  BoardToolbar,
  type BoardTool,
} from './BoardChrome.js';
import { MoveNotice, MoveStatus } from './MoveFeedback.js';
import type {
  BoardFeedbackFrame,
  BoardExportContext,
  BoardHistoryFrame,
  BoardMediaAction,
  BoardMediaUpload,
  BoardSuggestionFrame,
  BoardSuggestionListFrame,
  WhiteboardEditorFeatures,
} from './board-features.js';
import {
  GeometryNotice,
  GeometrySelectionActions,
  GeometrySelectionObjectControls,
  GeometryStatus,
} from './geometry-controls.js';
import type { GeometryActionContext } from './GeometryBoardMenu.js';
import type { useGeometryEdits } from './geometry-session.js';
import type { useMoveSession } from './move-session.js';
import type { BoardTitleEditor } from './use-board-title.js';
import type { useContentEdits } from './use-content-edits.js';

type BoardAnchorAction = (trigger: HTMLButtonElement) => void;
type WorkspaceMove = ReturnType<typeof useMoveSession>;
type WorkspaceGeometry = ReturnType<typeof useGeometryEdits>;
type ContentNotice = ReturnType<typeof useContentEdits>['notice'];
type AppliedEdit = Extract<BoardEditReceipt, { kind: 'applied' }>;

interface WorkspaceCanvasProps {
  readonly viewOnly: boolean;
  readonly annotating: boolean;
  readonly input: CanvasProps;
}

function ignoreSelection() {
  return undefined;
}

export function WorkspaceCanvas({ viewOnly, annotating, input }: WorkspaceCanvasProps) {
  return (
    <Canvas
      {...input}
      selection={viewOnly ? [] : input.selection}
      tool={viewOnly ? 'select' : input.tool}
      pendingEdits={viewOnly ? undefined : input.pendingEdits}
      onSelectionChange={viewOnly || annotating ? ignoreSelection : input.onSelectionChange}
      canEdit={input.canEdit && !annotating}
      canDraw={input.canDraw && !viewOnly && !annotating}
      hasContentEditPermission={input.canEdit}
      selectionActions={annotating ? undefined : input.selectionActions}
      onContextMenu={viewOnly || annotating ? undefined : input.onContextMenu}
    />
  );
}

interface WorkspaceSelectionBarProps {
  readonly selection: readonly CanvasObject[];
  readonly locks: GeometryActionContext['locks'];
  readonly editAvailable: boolean;
  readonly formatAvailable: boolean;
  readonly canEdit: boolean;
  readonly moreOpen: boolean;
  readonly onOpenViewing: BoardAnchorAction;
  readonly onEditObject: (id: string) => void;
  readonly selectedHtmlId?: string;
  readonly onAction: WorkspaceGeometry['handleSelectionAction'];
  readonly onOpenMore: BoardAnchorAction;
  readonly onSelectAll: () => void;
  readonly onAnnotate?: () => void;
  readonly onRenameSection?: GeometryActionContext['onRenameSection'];
  readonly clipboard?: GeometryActionContext['clipboard'];
  readonly textStyleById?: Parameters<typeof GeometrySelectionObjectControls>[0]['textStyleById'];
  readonly customColors?: readonly string[];
  readonly onFormatObject?: Parameters<typeof GeometrySelectionObjectControls>[0]['onFormatObject'];
}

export function WorkspaceSelectionBar({
  selection,
  locks,
  editAvailable,
  formatAvailable,
  canEdit,
  moreOpen,
  onOpenViewing,
  onEditObject,
  selectedHtmlId,
  onAction,
  onOpenMore,
  onSelectAll,
  onAnnotate,
  onRenameSection,
  clipboard,
  textStyleById,
  customColors,
  onFormatObject,
}: WorkspaceSelectionBarProps) {
  return (
    <>
      <BoardSelectionViewing onOpen={onOpenViewing} />
      {editAvailable && (
        <>
          <GeometrySelectionObjectControls
            selection={selection.map((object) =>
              locks.ids.has(object.id) && !object.locked ? { ...object, locked: true } : object,
            )}
            canEdit={formatAvailable}
            disabled={!canEdit}
            onEditObject={onEditObject}
            selectedHtmlId={selectedHtmlId}
            onAction={onAction}
            textStyleById={textStyleById}
            customColors={customColors}
            onFormatObject={onFormatObject}
          />
          <GeometrySelectionActions
            selection={selection}
            locks={locks}
            canEdit={canEdit}
            onAction={onAction}
            onOpenMore={onOpenMore}
            moreOpen={moreOpen}
            onSelectAll={onSelectAll}
            onAnnotate={onAnnotate}
            onRenameSection={onRenameSection}
            clipboard={clipboard}
          />
        </>
      )}
    </>
  );
}

interface WorkspaceHeaderProps {
  readonly title: string;
  readonly watching: boolean;
  readonly documentReading: boolean;
  readonly historyPreview: boolean;
  readonly historyOpen: boolean;
  readonly feedbackOpen: boolean;
  readonly suggestionsOpen: boolean;
  readonly shareOpen: boolean;
  readonly lanSharing: boolean;
  readonly consumeShareEntry?: () => boolean;
  readonly annotationActive: boolean;
  readonly unresolvedFeedback: boolean;
  readonly writeAccess: boolean;
  readonly trashed?: boolean;
  readonly moving: boolean;
  readonly move: WorkspaceMove;
  readonly geometry: WorkspaceGeometry;
  readonly notice: ContentNotice;
  readonly readNotices: ReactNode;
  readonly participants?: ReactNode;
  readonly suggestionTrigger: Ref<HTMLButtonElement>;
  readonly onBack?: () => void;
  readonly titleEditor?: BoardTitleEditor;
  readonly onOpenShare?: BoardAnchorAction;
  readonly onOpenHistory?: BoardAnchorAction;
  readonly onToggleFeedback?: BoardAnchorAction;
  readonly onOpenSuggestions?: BoardAnchorAction;
  readonly onToggleAnnotation?: () => void;
}

function boardStatus({ writeAccess, moving, geometry, move }: WorkspaceHeaderProps) {
  if (!writeAccess) {
    return <StatusText message="只读" />;
  }
  if (geometry.hasPendingEdit && !moving) {
    return <GeometryStatus controls={geometry} />;
  }

  return <MoveStatus controls={move} />;
}

function headerParticipants({
  participants,
  suggestionsOpen,
  suggestionTrigger,
  onOpenSuggestions,
}: WorkspaceHeaderProps) {
  return (
    <>
      {participants}
      {onOpenSuggestions && (
        <button
          ref={suggestionTrigger}
          type="button"
          className="whiteboard-chrome__action"
          aria-label="私人建议"
          aria-haspopup="dialog"
          aria-expanded={suggestionsOpen}
          title="私人建议"
          onClick={(event) => onOpenSuggestions(event.currentTarget)}
        >
          <Lightbulb size={18} aria-hidden="true" />
        </button>
      )}
    </>
  );
}

export function WorkspaceHeader(props: WorkspaceHeaderProps) {
  const {
    title,
    watching,
    documentReading,
    historyPreview,
    historyOpen,
    feedbackOpen,
    shareOpen,
    lanSharing,
    annotationActive,
    unresolvedFeedback,
    move,
    geometry,
    notice,
    readNotices,
    onBack,
    titleEditor,
    onOpenShare,
    onOpenHistory,
    onToggleFeedback,
    onToggleAnnotation,
  } = props;

  if (documentReading) {
    return (
      <BoardDocumentChrome
        onToggleFeedback={onToggleFeedback}
        feedbackOpen={feedbackOpen}
        annotationActive={annotationActive}
        unresolvedFeedback={unresolvedFeedback}
        onToggleAnnotation={onToggleAnnotation}
      />
    );
  }

  return (
    <div hidden={watching}>
      <BoardHeader
        title={title}
        canManage={(props.trashed || props.writeAccess) && Boolean(onBack || titleEditor)}
        onBack={onBack}
        titleEditor={historyPreview ? undefined : titleEditor}
        status={boardStatus(props)}
        participants={headerParticipants(props)}
        onOpenShare={historyPreview ? undefined : onOpenShare}
        shareOpen={shareOpen}
        lanSharing={lanSharing}
        consumeShareEntry={props.consumeShareEntry}
        onOpenHistory={onOpenHistory}
        historyOpen={historyOpen}
        onToggleFeedback={onToggleFeedback}
        feedbackOpen={feedbackOpen}
        annotationActive={annotationActive}
        unresolvedFeedback={unresolvedFeedback}
        onToggleAnnotation={historyPreview ? undefined : onToggleAnnotation}
      />
      <MoveNotice controls={move} />
      <GeometryNotice controls={geometry} />
      {notice && (
        <OperationNotice
          id="whiteboard-content-unknown"
          level="warning"
          message={notice.message}
          actions={[{ id: 'retry-content', label: '重试原保存', onActivate: notice.retry }]}
        />
      )}
      {readNotices}
    </div>
  );
}

interface WorkspaceToolbarProps {
  readonly boardId: string;
  readonly tool: BoardTool;
  readonly viewport: CanvasViewport;
  readonly visible: boolean;
  readonly canInsertImage: boolean;
  readonly mediaPaused: boolean;
  readonly canEditGeometry: boolean;
  readonly renderMedia?: WhiteboardEditorFeatures['renderMedia'];
  readonly onApplied: (receipt: AppliedEdit, ids?: readonly string[]) => void;
  readonly onToolChange: (tool: BoardTool) => void;
  readonly onCanvasFocus: () => void;
  readonly singleKeys: boolean;
  readonly penColor: string;
  readonly onPenColorChange: (color: string) => void;
  readonly onAddHtml?: () => void;
  readonly onAddLink?: () => void;
  readonly placementPoint: () => { readonly x: number; readonly y: number } | undefined;
  readonly onUploadReady: (upload: BoardMediaUpload | undefined) => void;
}

export function WorkspaceToolbar({
  boardId,
  tool,
  viewport,
  visible,
  canInsertImage,
  mediaPaused,
  canEditGeometry,
  renderMedia,
  onApplied,
  onToolChange,
  onCanvasFocus,
  singleKeys,
  penColor,
  onPenColorChange,
  onAddHtml,
  onAddLink,
  placementPoint,
  onUploadReady,
}: WorkspaceToolbarProps) {
  if (!visible && !renderMedia) {
    return null;
  }

  function renderTools(mediaAction?: BoardMediaAction) {
    return (
      <BoardToolbar
        tool={tool}
        onToolChange={onToolChange}
        canEditGeometry={canEditGeometry}
        onCanvasFocus={onCanvasFocus}
        mediaAction={mediaAction}
        singleKeys={singleKeys}
        penColor={penColor}
        onPenColorChange={onPenColorChange}
        onAddHtml={onAddHtml}
        onAddLink={onAddLink}
      />
    );
  }

  return renderMedia
    ? renderMedia({
        boardId,
        canEdit: canInsertImage,
        paused: mediaPaused || !visible,
        viewport,
        placementPoint,
        onUploadReady,
        renderTools,
        onApplied: (receipt) =>
          onApplied(
            receipt,
            receipt.objects.map(({ id }) => id),
          ),
        onExitPlacement: () => onToolChange('select'),
      })
    : renderTools();
}

interface WorkspacePanelsProps {
  readonly features: WhiteboardEditorFeatures;
  readonly feedback: BoardFeedbackFrame;
  readonly history: BoardHistoryFrame;
  readonly suggestions: BoardSuggestionFrame;
}

export function WorkspacePanels({
  features,
  feedback,
  history,
  suggestions,
}: WorkspacePanelsProps) {
  const { renderFeedback, renderHistory, renderSuggestions } = features;
  if (!renderFeedback) {
    return (
      <>
        {renderHistory?.(history)}
        {renderSuggestions?.(suggestions)}
      </>
    );
  }

  const inline =
    renderSuggestions &&
    ((frame: BoardSuggestionListFrame) =>
      renderSuggestions({
        ...suggestions,
        anchor: null,
        inline: { ...frame, previewHost: suggestions.previewHost ?? null },
      }));

  return (
    <>
      {renderFeedback({ ...feedback, renderSuggestions: inline })}
      {renderHistory?.(history)}
    </>
  );
}

interface WorkspaceExportProps {
  readonly anchor?: HTMLButtonElement;
  readonly context: BoardExportContext;
  readonly render?: WhiteboardEditorFeatures['renderExport'];
  readonly onClose: () => void;
  readonly onLanSharingChange: (active: boolean) => void;
}

export function WorkspaceExport({
  anchor,
  context,
  render,
  onClose,
  onLanSharingChange,
}: WorkspaceExportProps) {
  if (!render) {
    return null;
  }

  return render({
    anchor: anchor ?? null,
    context,
    onLanSharingChange,
    onRequestClose: onClose,
    restoreFocus: () => anchor?.focus({ preventScroll: true }),
  });
}
