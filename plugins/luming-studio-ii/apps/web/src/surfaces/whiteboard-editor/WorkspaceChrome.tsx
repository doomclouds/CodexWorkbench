import type { ReactNode } from 'react';
import type { BoardEditReceipt } from '../../data/whiteboard/index.js';
import { OperationNotice, StatusText } from '../../ui/base/index.js';
import {
  Canvas,
  type CanvasObject,
  type CanvasProps,
  type CanvasViewport,
} from '../../ui/domain/canvas/index.js';
import { BoardHeader, BoardSelectionViewing, BoardToolbar, type BoardTool } from './BoardChrome.js';
import { MoveNotice, MoveStatus } from './MoveFeedback.js';
import type {
  BoardFeedbackFrame,
  BoardExportContext,
  BoardHistoryFrame,
  BoardMediaAction,
  WhiteboardEditorFeatures,
} from './board-features.js';
import {
  GeometryNotice,
  GeometrySelectionActions,
  GeometrySelectionObjectControls,
  GeometryStatus,
} from './geometry-controls.js';
import type { useGeometryEdits } from './geometry-session.js';
import type { useMoveSession } from './move-session.js';
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
      onSelectionChange={viewOnly ? ignoreSelection : input.onSelectionChange}
      selectionActions={annotating ? undefined : input.selectionActions}
      onContextMenu={viewOnly || annotating ? undefined : input.onContextMenu}
    />
  );
}

interface WorkspaceSelectionBarProps {
  readonly selection: readonly CanvasObject[];
  readonly editAvailable: boolean;
  readonly canEdit: boolean;
  readonly moreOpen: boolean;
  readonly onOpenViewing: BoardAnchorAction;
  readonly onEditObject: (id: string) => void;
  readonly onAction: WorkspaceGeometry['handleSelectionAction'];
  readonly onOpenMore: BoardAnchorAction;
  readonly onSelectAll: () => void;
  readonly onAnnotate?: () => void;
}

export function WorkspaceSelectionBar({
  selection,
  editAvailable,
  canEdit,
  moreOpen,
  onOpenViewing,
  onEditObject,
  onAction,
  onOpenMore,
  onSelectAll,
  onAnnotate,
}: WorkspaceSelectionBarProps) {
  return (
    <>
      <BoardSelectionViewing onOpen={onOpenViewing} />
      {editAvailable && (
        <>
          <GeometrySelectionObjectControls
            selection={selection}
            canEdit={canEdit}
            onEditObject={onEditObject}
            onAction={onAction}
          />
          <GeometrySelectionActions
            selection={selection}
            canEdit={canEdit}
            onAction={onAction}
            onOpenMore={onOpenMore}
            moreOpen={moreOpen}
            onSelectAll={onSelectAll}
            onAnnotate={onAnnotate}
          />
        </>
      )}
    </>
  );
}

interface WorkspaceHeaderProps {
  readonly title: string;
  readonly watching: boolean;
  readonly historyPreview: boolean;
  readonly historyOpen: boolean;
  readonly feedbackOpen: boolean;
  readonly shareOpen: boolean;
  readonly annotationActive: boolean;
  readonly unresolvedFeedback: boolean;
  readonly writeAccess: boolean;
  readonly moving: boolean;
  readonly move: WorkspaceMove;
  readonly geometry: WorkspaceGeometry;
  readonly notice: ContentNotice;
  readonly readNotices: ReactNode;
  readonly onBack?: () => void;
  readonly onRename?: (title: string) => void;
  readonly onOpenShare?: BoardAnchorAction;
  readonly onOpenHistory?: BoardAnchorAction;
  readonly onToggleFeedback?: BoardAnchorAction;
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

export function WorkspaceHeader(props: WorkspaceHeaderProps) {
  const {
    title,
    watching,
    historyPreview,
    historyOpen,
    feedbackOpen,
    shareOpen,
    annotationActive,
    unresolvedFeedback,
    move,
    geometry,
    notice,
    readNotices,
    onBack,
    onRename,
    onOpenShare,
    onOpenHistory,
    onToggleFeedback,
    onToggleAnnotation,
  } = props;

  return (
    <div hidden={watching}>
      <BoardHeader
        title={title}
        canManage={props.writeAccess && Boolean(onBack || onRename)}
        onBack={onBack}
        onRename={historyPreview ? undefined : onRename}
        status={boardStatus(props)}
        onOpenShare={historyPreview ? undefined : onOpenShare}
        shareOpen={shareOpen}
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
      />
    );
  }

  return renderMedia
    ? renderMedia({
        boardId,
        canEdit: canInsertImage,
        paused: mediaPaused || !visible,
        viewport,
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
}

export function WorkspacePanels({ features, feedback, history }: WorkspacePanelsProps) {
  return (
    <>
      {features.renderFeedback?.(feedback)}
      {features.renderHistory?.(history)}
    </>
  );
}

interface WorkspaceExportProps {
  readonly anchor?: HTMLButtonElement;
  readonly context: BoardExportContext;
  readonly render?: WhiteboardEditorFeatures['renderExport'];
  readonly onClose: () => void;
}

export function WorkspaceExport({ anchor, context, render, onClose }: WorkspaceExportProps) {
  if (!anchor || !render) {
    return null;
  }

  return render({
    anchor,
    context,
    onRequestClose: onClose,
    restoreFocus: () => anchor.focus({ preventScroll: true }),
  });
}
