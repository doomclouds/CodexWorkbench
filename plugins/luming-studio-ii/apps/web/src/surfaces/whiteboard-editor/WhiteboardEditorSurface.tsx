import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  createWhiteboardSession,
  type BoardEditReceipt,
  type WhiteboardService,
} from '../../data/whiteboard/index.js';
import { Button, OperationNotice, StatePanel, type ActionMenuAnchor } from '../../ui/base/index.js';
import {
  type CanvasFitScope,
  type CanvasEditIntent,
  type CanvasHandle,
  type CanvasPoint,
  type CanvasObjectExtension,
  type CanvasProps,
  type CanvasViewport,
  type CanvasViewportRequest,
} from '../../ui/domain/canvas/index.js';
import { studioObjectExtensions } from '../../ui/domain/objects/index.js';
import { documentExtension } from '../../ui/domain/objects/document/index.js';
import type { BoardTool } from './BoardChrome.js';
import { BoardHtmlCreation, useBoardHtmlCreation } from './BoardHtmlCreation.js';
import { BoardViewportTools } from './BoardViewportTools.js';
import { BoardWelcome } from './BoardWelcome.js';
import { renderBoardHistoryCanvas } from './HistoryCanvasView.js';
import type { WhiteboardEditorFeatures } from './board-features.js';
import { projectPayloads, projectScene } from './canvas-projection.js';
import { GeometryBoardMenu } from './geometry-controls.js';
import { useGeometryEdits } from './geometry-session.js';
import { useMoveSession } from './move-session.js';
import { useBoardPresentation } from './use-board-presentation.js';
import { useBoardTitle, type RenameBoard } from './use-board-title.js';
import { useContentEdits } from './use-content-edits.js';
import {
  WorkspaceCanvas,
  WorkspaceExport,
  WorkspaceHeader,
  WorkspacePanels,
  WorkspaceSelectionBar,
  WorkspaceToolbar,
} from './WorkspaceChrome.js';
import './whiteboard-editor.css';

export interface WhiteboardEditorSurfaceProps {
  readonly boardId: string;
  readonly service: WhiteboardService;
  readonly createCommandId: () => string;
  readonly onBack?: () => void;
  readonly renameBoard?: RenameBoard;
  readonly features: WhiteboardEditorFeatures;
}

type WhiteboardSession = ReturnType<typeof createWhiteboardSession>;
type WhiteboardState = ReturnType<WhiteboardSession['getSnapshot']>;
type ReadyState = Extract<WhiteboardState, { kind: 'ready' }>;
type SceneProjection = NonNullable<ReturnType<typeof projectScene>>;
type BoardViewportChange =
  | { readonly fit: CanvasFitScope }
  | { readonly zoom: number }
  | { readonly viewport: CanvasViewport };

interface BoardWorkspaceProps {
  readonly state: ReadyState;
  readonly session: WhiteboardSession;
  readonly projection: SceneProjection;
  readonly createCommandId: () => string;
  readonly onBack?: () => void;
  readonly renameBoard?: RenameBoard;
  readonly features: WhiteboardEditorFeatures;
}

interface BoardSurfaceProps {
  readonly state: ReadyState;
  readonly session: WhiteboardSession;
  readonly createCommandId: () => string;
  readonly onBack?: () => void;
  readonly renameBoard?: RenameBoard;
  readonly features: WhiteboardEditorFeatures;
}

const movable = {
  move: true,
  resize: false,
  rotate: false,
  connect: false,
} as const;

const moveExtensions: readonly CanvasObjectExtension[] = [
  ...studioObjectExtensions.map((extension) => ({
    ...extension,
    placement: undefined,
    portClick: undefined,
    capabilities: { ...extension.capabilities, resize: false, rotate: false, connect: false },
  })),
  { kind: 'ink', capabilities: { ...movable, content: 'passive' }, blocksPlacement: false },
  { kind: 'native', capabilities: { ...movable, content: 'native' } },
];

const editExtensions: readonly CanvasObjectExtension[] = studioObjectExtensions.map(
  (extension: CanvasObjectExtension) =>
    extension.portClick === 'place' ? { ...extension, portClick: 'connect' } : extension,
);

function useBoardPanels() {
  const [exportAnchor, setExportAnchor] = useState<HTMLButtonElement>();
  const [historyAnchor, setHistoryAnchor] = useState<HTMLButtonElement | null>(null);
  const [historyPreview, setHistoryPreview] = useState(false);
  const [feedbackAnchor, setFeedbackAnchor] = useState<HTMLButtonElement | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  function openHistory(anchor: HTMLButtonElement) {
    setExportAnchor(undefined);
    setFeedbackOpen(false);
    setHistoryAnchor((current) => (current === anchor ? null : anchor));
  }

  function toggleFeedback(anchor: HTMLButtonElement) {
    setExportAnchor(undefined);
    setHistoryAnchor(null);
    setFeedbackAnchor(anchor);
    setFeedbackOpen((open) => !open);
  }

  function openExport(anchor: HTMLButtonElement) {
    setHistoryAnchor(null);
    setFeedbackOpen(false);
    setExportAnchor((current) => (current === anchor ? undefined : anchor));
  }

  function closeExport() {
    setExportAnchor(undefined);
  }

  function closeHistory() {
    setHistoryAnchor(null);
  }

  return {
    exportAnchor,
    historyAnchor,
    historyPreview,
    feedbackAnchor,
    feedbackOpen,
    openHistory,
    toggleFeedback,
    openExport,
    closeExport,
    closeHistory,
    setHistoryPreview,
    setFeedbackOpen,
  };
}

function boardPanelActions(
  features: WhiteboardEditorFeatures,
  panels: ReturnType<typeof useBoardPanels>,
) {
  return {
    onOpenShare: features.renderExport ? panels.openExport : undefined,
    onOpenHistory: features.renderHistory ? panels.openHistory : undefined,
    onToggleFeedback: features.renderFeedback ? panels.toggleFeedback : undefined,
  };
}

function selectedObjectsFor(projected: SceneProjection, ids: readonly string[]) {
  return ids.flatMap((id) => {
    const object = projected.objectsById.get(id);

    return object ? [object] : [];
  });
}

function welcomeAvailable(
  viewOnly: boolean,
  annotating: boolean,
  tool: BoardTool,
  objectCount: number,
) {
  const interacting = annotating || typeof tool !== 'string';

  return !viewOnly && !interacting && objectCount === 0;
}

function bodyEditingAvailable(online: boolean, expanded: boolean, scope?: string) {
  return online || (expanded && Boolean(scope));
}

function annotationActions(
  online: boolean,
  feedbackEnabled: boolean,
  onToggleAnnotation: () => void,
  onAnnotate: () => void,
) {
  if (!online || !feedbackEnabled) {
    return {};
  }

  return { onToggleAnnotation, onAnnotate };
}

function BoardWorkspace({
  state,
  session,
  projection,
  createCommandId,
  onBack,
  renameBoard,
  features,
}: BoardWorkspaceProps) {
  const board = state.scene;
  const canvasRef = useRef<CanvasHandle>(null);
  const [canvasArea, setCanvasArea] = useState<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [tool, setTool] = useState<BoardTool>('select');
  const [showGrid, setShowGrid] = useState(true);
  const [singleKeys, setSingleKeys] = useState(true);
  const [penColor, setPenColor] = useState('#2d3142');
  const [annotationActive, setAnnotationActive] = useState(false);
  const [unresolvedFeedback, setUnresolvedFeedback] = useState(false);
  const [annotationRequest, setAnnotationRequest] = useState<{
    readonly objectId: string;
    readonly sequence: number;
  }>();
  const [menuAnchor, setMenuAnchor] = useState<ActionMenuAnchor | null>(null);
  const [objectEdit, setObjectEdit] = useState<CanvasProps['editObjectRequest']>();
  const nextWelcomePlacement = useRef(0);
  const [viewport, setViewport] = useState<CanvasViewport>({ x: 0, y: 0, zoom: 1 });
  const [viewportRequest, setViewportRequest] = useState<CanvasViewportRequest>();
  const panels = useBoardPanels();
  const creation = useBoardHtmlCreation();
  const selection = useMemo(
    () => selected.filter((id) => projection.objectsById.has(id)),
    [selected, projection.objectsById],
  );
  const projected = useMemo(
    () => projectPayloads(projection, state.payloads),
    [projection, state.payloads],
  );
  const mayEdit = board.canEdit && !state.sceneError;
  const title = board.title || '白板';

  function requestViewport(request: BoardViewportChange) {
    setViewportRequest((current) => ({
      ...request,
      requestId: String(Number(current?.requestId ?? 0) + 1),
    }));
  }

  function fitViewport(fit: CanvasFitScope) {
    requestViewport({ fit });
  }

  function handleZoomBoard(zoom: number) {
    requestViewport({ zoom });
  }

  function restoreViewport(restored: CanvasViewport) {
    requestViewport({ viewport: restored });
  }

  function focusCanvas() {
    canvasRef.current?.focus();
  }

  function focusWorldPoint(point: CanvasPoint) {
    const bounds = canvasArea?.getBoundingClientRect();
    if (bounds) {
      restoreViewport({
        x: bounds.width / 2 - point.x * viewport.zoom,
        y: bounds.height / 2 - point.y * viewport.zoom,
        zoom: viewport.zoom,
      });
    }
  }

  function fitPresentation() {
    fitViewport('auto');
  }

  const { scope, enter, exit } = useBoardPresentation({
    objects: projection.objectsById,
    viewport,
    onRestore: restoreViewport,
    onFit: fitPresentation,
    focusCanvas,
  });

  function handleOpenViewing(ids: readonly string[], trigger?: HTMLButtonElement) {
    panels.closeExport();
    panels.closeHistory();
    panels.setFeedbackOpen(false);
    setAnnotationActive(false);
    setMenuAnchor(null);
    enter(ids, trigger);
  }

  const watching = Boolean(scope);
  const viewOnly = watching || panels.historyPreview;
  const online = mayEdit && !viewOnly;
  const canEditExpanded = mayEdit && !panels.historyPreview;
  const move = useMoveSession(session, board.boardId, online, createCommandId);
  const moving = move.pendingEdits.length > 0;
  const { editService, Viewing, renderExport, renderFeedback } = features;
  const editingReady = online && !moving;
  const boardTitle = useBoardTitle({
    boardId: board.boardId,
    title,
    renameBoard: online ? renameBoard : undefined,
    onSaved: session.reload,
  });

  function handleEditApplied(
    receipt: Extract<BoardEditReceipt, { kind: 'applied' }>,
    ids?: readonly string[],
  ) {
    session.acceptEdit(receipt);
    if (ids) {
      setMenuAnchor(null);
      setSelected(ids);
      creation.complete(receipt, ids);
    }
  }

  const geometry = useGeometryEdits({
    boardId: board.boardId,
    revision: board.revision,
    canEdit: editingReady,
    service: editService,
    createCommandId,
    objectsById: projection.objectsById,
    onApplied: handleEditApplied,
    onConflict: session.reload,
  });
  const content = useContentEdits({
    boardId: board.boardId,
    service: editService,
    canEdit: bodyEditingAvailable(online, canEditExpanded, scope?.expandedObjectId),
    createCommandId,
    onApplied: handleEditApplied,
    onConflict: session.acceptConflict,
  });
  const canEdit = editingReady && !geometry.hasPendingEdit;
  const canInsert = canEdit && Boolean(editService);
  const selectedObjects = selectedObjectsFor(projection, selection);

  function handleEdit(intent: CanvasEditIntent) {
    if (intent.kind === 'move') {
      move.handleEdit(intent);
    } else {
      geometry.handleEdit(intent);
    }
  }

  function handleRestore(receipt: BoardEditReceipt) {
    if (receipt.kind === 'applied') {
      session.acceptEdit(receipt);
      session.reload();
    }
  }

  function changeAnnotation(active: boolean) {
    if (active) {
      setMenuAnchor(null);
      setTool('select');
    }

    setAnnotationActive(active);
  }

  function handleToggleAnnotation() {
    panels.setFeedbackOpen(false);
    changeAnnotation(!annotationActive);
  }

  function handleAnnotateSelection() {
    const [objectId] = selection;
    if (objectId) {
      setAnnotationRequest((current) => ({ objectId, sequence: (current?.sequence ?? 0) + 1 }));
    }
  }

  function handleToolChange(nextTool: BoardTool) {
    setAnnotationActive(false);
    setMenuAnchor(null);
    setTool(nextTool);
  }

  function handleAddDocument() {
    const object = documentExtension.placement;
    if (!object) {
      return;
    }

    nextWelcomePlacement.current += 1;
    handleToolChange({
      kind: 'place',
      requestId: 'welcome-document-' + nextWelcomePlacement.current,
      object,
    });
    focusCanvas();
  }

  function handleOpenHtml() {
    handleToolChange('select');
    creation.handleOpen();
  }

  function handleContextMenu(anchor: CanvasPoint, ids: readonly string[]) {
    setSelected(ids);
    setMenuAnchor(anchor);
  }

  function handleSelectionMenu(trigger: HTMLButtonElement) {
    const { left, bottom } = trigger.getBoundingClientRect();

    setMenuAnchor({ x: left, y: bottom + 6 });
  }

  function editObject(id: string) {
    setObjectEdit({ id });
  }

  function selectAll() {
    setSelected(projected.scene.objects.map(({ id }) => id));
  }

  const annotation = annotationActions(
    online,
    Boolean(renderFeedback),
    handleToggleAnnotation,
    handleAnnotateSelection,
  );
  const selectionActions = (
    <WorkspaceSelectionBar
      selection={selectedObjects}
      editAvailable={Boolean(editService)}
      canEdit={canEdit}
      onOpenViewing={(trigger) => handleOpenViewing(selection, trigger)}
      onEditObject={editObject}
      onAction={geometry.handleSelectionAction}
      moreOpen={menuAnchor !== null}
      onOpenMore={handleSelectionMenu}
      onSelectAll={selectAll}
      onAnnotate={annotation.onAnnotate}
    />
  );
  const pendingEdits = moving ? move.pendingEdits : geometry.pendingEdits;
  const canvas = (
    <WorkspaceCanvas
      viewOnly={viewOnly}
      annotating={annotationActive}
      input={{
        ref: canvasRef,
        viewId: board.boardId,
        label: title,
        scene: projected.scene,
        selection,
        tool,
        penStyle: { stroke: penColor },
        fitOnMount: Boolean(onBack),
        viewportRequest,
        showGrid,
        presentation: scope,
        selectionActions,
        canEdit,
        canEditExpandedObject: canEditExpanded,
        pendingEdits,
        objectExtensions: editService ? editExtensions : moveExtensions,
        payloadById: projected.payloadById,
        onSelectionChange: setSelected,
        onToolChange: handleToolChange,
        onContextMenu: handleContextMenu,
        editObjectRequest: objectEdit,
        onEditIntent: handleEdit,
        canWriteObject: content.canWriteObject,
        onObjectIntent: content.handleObjectIntent,
        readHtmlSource: features.readHtmlSource,
        onOpenPresentation: handleOpenViewing,
        onClosePresentation: exit,
        onViewportChange: setViewport,
        onVisibleObjectsChange: session.observeVisible,
      }}
    />
  );
  const exportAnchor = panels.exportAnchor;

  return (
    <>
      <WorkspaceHeader
        title={title}
        watching={watching}
        historyPreview={panels.historyPreview}
        historyOpen={Boolean(panels.historyAnchor)}
        feedbackOpen={panels.feedbackOpen}
        shareOpen={Boolean(exportAnchor)}
        annotationActive={annotationActive}
        unresolvedFeedback={unresolvedFeedback}
        writeAccess={board.canEdit}
        moving={moving}
        move={move}
        geometry={geometry}
        notice={content.notice}
        onBack={onBack}
        onRename={boardTitle.rename}
        {...boardPanelActions(features, panels)}
        onToggleAnnotation={annotation.onToggleAnnotation}
        readNotices={
          <BoardReadNotices
            state={state}
            session={session}
            unsafePayloadVersion={projected.unsafePayloadVersion}
            renameError={boardTitle.error}
          />
        }
      />
      <div className="whiteboard-editor__canvas" ref={setCanvasArea}>
        <div className="whiteboard-editor__live-canvas" inert={panels.historyPreview}>
          <Viewing
            active={watching}
            documentReading={Boolean(scope?.focusObjectId)}
            title={title}
            viewport={viewport}
            onZoom={handleZoomBoard}
            onFit={fitPresentation}
            onExit={exit}
            onCanvasFocus={focusCanvas}
          >
            {canvas}
          </Viewing>
          <div hidden={watching}>
            <BoardViewportTools
              zoom={viewport.zoom}
              onZoom={handleZoomBoard}
              onFit={fitViewport}
              hasSelection={selection.length > 0}
              showGrid={showGrid}
              onShowGridChange={setShowGrid}
              singleKeys={singleKeys}
              onSingleKeysChange={setSingleKeys}
              timerEditable={board.canEdit}
            />
            <WorkspaceToolbar
              boardId={board.boardId}
              tool={tool}
              viewport={viewport}
              visible={board.canEdit}
              canInsertImage={board.canEdit}
              mediaPaused={!online}
              canEditGeometry={canInsert}
              renderMedia={features.renderMedia}
              onApplied={handleEditApplied}
              onToolChange={handleToolChange}
              onCanvasFocus={focusCanvas}
              singleKeys={singleKeys}
              penColor={penColor}
              onPenColorChange={setPenColor}
              onAddHtml={canInsert ? handleOpenHtml : undefined}
            />
          </div>
          {welcomeAvailable(viewOnly, annotationActive, tool, projected.scene.objects.length) && (
            <BoardWelcome
              canEdit={board.canEdit}
              disabled={!canInsert}
              onAddDocument={handleAddDocument}
              onAddHtml={handleOpenHtml}
            />
          )}
        </div>
        <WorkspacePanels
          features={features}
          feedback={{
            boardId: board.boardId,
            canEdit: online,
            viewing: viewOnly,
            viewport,
            objects: board.objects,
            selectedIds: selection,
            panelOpen: panels.feedbackOpen,
            onPanelOpenChange: panels.setFeedbackOpen,
            anchor: panels.feedbackAnchor,
            focusWorldPoint,
            annotationActive,
            onAnnotationActiveChange: changeAnnotation,
            onUnresolvedChange: setUnresolvedFeedback,
            annotationRequest,
            singleKeys,
          }}
          history={{
            boardId: board.boardId,
            title,
            revision: board.revision,
            canEdit: mayEdit && !moving && !geometry.hasPendingEdit,
            anchor: panels.historyAnchor,
            onClose: panels.closeHistory,
            onPreviewChange: panels.setHistoryPreview,
            onRestored: handleRestore,
            renderPreview: renderBoardHistoryCanvas,
          }}
        />
      </div>
      <GeometryBoardMenu
        anchor={menuAnchor}
        selection={selectedObjects}
        canEdit={canInsert}
        onAction={geometry.handleSelectionAction}
        onFit={fitViewport}
        onSelectAll={selectAll}
        onRequestClose={() => setMenuAnchor(null)}
        returnFocus={focusCanvas}
      />
      <BoardHtmlCreation
        creation={creation}
        geometry={geometry}
        viewport={viewport}
        canInsert={canInsert}
        readHtmlSource={features.readHtmlSource}
        onRestoreFocus={focusCanvas}
      />
      <WorkspaceExport
        anchor={exportAnchor}
        context={{
          boardId: board.boardId,
          title,
          revision: board.revision,
          selectedIds: selection,
        }}
        render={renderExport}
        onClose={panels.closeExport}
      />
    </>
  );
}

interface BoardReadNoticesProps {
  readonly state: ReadyState;
  readonly session: WhiteboardSession;
  readonly unsafePayloadVersion: boolean;
  readonly renameError?: string;
}

function BoardReadNotices({
  state,
  session,
  unsafePayloadVersion,
  renameError,
}: BoardReadNoticesProps) {
  return (
    <>
      {renameError && (
        <OperationNotice id="whiteboard-rename-failed" level="error" message={renameError} />
      )}
      {state.sceneError && (
        <OperationNotice
          id="whiteboard-reload-failed"
          level="error"
          message={'白板刷新失败。' + state.sceneError}
          actions={[{ id: 'reload', label: '重新加载', onActivate: session.reload }]}
        />
      )}
      {state.payloadError && (
        <OperationNotice
          id="whiteboard-payload-failed"
          level="warning"
          message={'对象正文加载失败。' + state.payloadError}
          actions={[{ id: 'retry-payloads', label: '重试正文', onActivate: session.retryPayloads }]}
        />
      )}
      {unsafePayloadVersion && (
        <OperationNotice
          id="whiteboard-payload-version"
          level="warning"
          message="部分对象的正文版本超出当前画布的安全整数范围。"
        />
      )}
    </>
  );
}

function LoadedBoard({
  state,
  session,
  createCommandId,
  onBack,
  renameBoard,
  features,
}: BoardSurfaceProps) {
  const projection = useMemo(() => projectScene(state.scene), [state.scene]);
  if (!projection) {
    return (
      <div className="whiteboard-editor__state">
        <StatePanel
          kind="error"
          title="无法打开画布"
          detail="白板或对象的位置版本超出当前画布的安全整数范围。"
          action={<Button label="重新加载" onActivate={session.reload} />}
        />
      </div>
    );
  }

  return (
    <BoardWorkspace
      state={state}
      session={session}
      projection={projection}
      createCommandId={createCommandId}
      onBack={onBack}
      renameBoard={renameBoard}
      features={features}
    />
  );
}

export function WhiteboardEditorSurface({
  boardId,
  service,
  createCommandId,
  onBack,
  renameBoard,
  features,
}: WhiteboardEditorSurfaceProps) {
  const session = useMemo(() => createWhiteboardSession(service, boardId), [service, boardId]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);

  useEffect(() => session.open(), [session]);

  return (
    <section className="whiteboard-editor" aria-label="白板编辑">
      {state.kind === 'loading' && (
        <div className="whiteboard-editor__state">
          <StatePanel kind="initial-loading" title="正在打开白板" />
        </div>
      )}
      {state.kind === 'failed' && (
        <div className="whiteboard-editor__state">
          <StatePanel
            kind="error"
            title="无法打开白板"
            detail={state.message}
            action={<Button label="重新加载" onActivate={session.reload} />}
          />
        </div>
      )}
      {state.kind === 'ready' && (
        <LoadedBoard
          key={boardId}
          state={state}
          session={session}
          createCommandId={createCommandId}
          onBack={onBack}
          renameBoard={renameBoard}
          features={features}
        />
      )}
    </section>
  );
}
