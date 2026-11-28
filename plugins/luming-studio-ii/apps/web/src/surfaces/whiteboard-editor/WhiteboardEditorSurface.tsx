import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createWhiteboardSession, type WhiteboardService } from '../../data/whiteboard/index.js';
import { Button, StatePanel } from '../../ui/base/index.js';
import {
  type CanvasNativeSource,
  type CanvasObjectExtension,
  type CanvasProps,
} from '../../ui/domain/canvas/index.js';
import { studioObjectExtensions } from '../../ui/domain/objects/index.js';
import { documentExtension } from '../../ui/domain/objects/document/index.js';
import { LinkDialog } from '../../ui/domain/objects/media/index.js';
import { textExtension, TextSaveNoticePublisher } from '../../ui/domain/objects/text/index.js';
import type { BoardTool } from './BoardChrome.js';
import { BoardDraftRecovery } from './BoardDraftRecovery.js';
import { BoardHtmlCreation, useBoardHtmlCreation } from './BoardHtmlCreation.js';
import { BoardViewportTools } from './BoardViewportTools.js';
import { BoardWelcome } from './BoardWelcome.js';
import { renderBoardHistoryCanvas } from './HistoryCanvasView.js';
import type { BoardPresenceSlot, WhiteboardEditorFeatures } from './board-features.js';
import { projectPayloads, projectScene, projectTextStyles } from './canvas-projection.js';
import { GeometryBoardMenu } from './geometry-controls.js';
import { defaultInkColor } from './GeometryDrawChoices.js';
import { clipboardTextDraft } from './geometry-commands.js';
import { readBoardDraftCurrent } from './local-board-drafts.js';
import { renderSuggestionPreview } from './suggestion-preview.js';
import { boardPanelActions, useBoardPanels } from './use-board-panels.js';
import { readFeedbackView, useWorkspaceAnnotation } from './use-workspace-annotation.js';
import { useWorkspaceEditing } from './use-workspace-editing.js';
import { useWorkspaceSelection } from './use-workspace-selection.js';
import { useWorkspaceTransfers } from './use-workspace-transfers.js';
import {
  BoardViewReporter,
  readInitialWorkspaceView,
  useWorkspaceViewport,
} from './WorkspaceViewport.js';
import { useTextSaveIssues, WorkspaceNotices } from './WorkspaceNotices.js';
import { useBoardTitle, type RenameBoard } from './use-board-title.js';
import { useBoardContentTracking } from './use-board-content-tracking.js';
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

interface BoardWorkspaceProps {
  readonly state: ReadyState;
  readonly session: WhiteboardSession;
  readonly service: WhiteboardService;
  readonly projection: SceneProjection;
  readonly createCommandId: () => string;
  readonly onBack?: () => void;
  readonly renameBoard?: RenameBoard;
  readonly features: WhiteboardEditorFeatures;
}

interface BoardSurfaceProps {
  readonly state: ReadyState;
  readonly session: WhiteboardSession;
  readonly service: WhiteboardService;
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
const newLink = { title: '链接', href: '' } as const;
const canvasPenWidth = 3;

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

function welcomeAvailable(
  viewOnly: boolean,
  annotating: boolean,
  tool: BoardTool,
  objectCount: number,
) {
  const interacting = annotating || typeof tool !== 'string';

  return !viewOnly && !interacting && objectCount === 0;
}

function availableEditAccess(
  mayEdit: boolean,
  mayComment: boolean | undefined,
  watching: boolean,
  previewing: boolean,
  documentReading: boolean,
) {
  const viewOnly = watching || previewing;
  const mayAnnotate = !previewing && (!watching || documentReading);
  return {
    viewOnly,
    online: mayEdit && !viewOnly,
    canComment: (mayComment ?? mayEdit) && mayAnnotate,
    canEditExpanded: mayEdit && !previewing,
  };
}

function BoardWorkspace({
  state,
  session,
  service,
  projection,
  createCommandId,
  onBack,
  renameBoard,
  features,
}: BoardWorkspaceProps) {
  const board = state.scene;
  const [hasOpeningObjects] = useState(() => board.objects.length > 0);
  const initial = readInitialWorkspaceView({ state, projection, features });
  const [editingObjects, setEditingObjects] = useState<ReadonlySet<string>>(() => new Set());
  const handleObjectEditing = useCallback((id: string, editing: boolean) => {
    setEditingObjects((current) => {
      if (current.has(id) === editing) {
        return current;
      }

      const next = new Set(current);
      if (editing) {
        next.add(id);
      } else {
        next.delete(id);
      }

      return next;
    });
  }, []);
  const { textSaveIssues, publishTextSaveIssue } = useTextSaveIssues();
  const [tool, setTool] = useState<BoardTool>('select');
  const [showGrid, setShowGrid] = useState(true);
  const [singleKeys, setSingleKeys] = useState(true);
  const [penColor, setPenColor] = useState<string>(defaultInkColor);
  const contentTracking = useBoardContentTracking();
  const [nativeSourceRequest, setNativeSourceRequest] =
    useState<CanvasProps['nativeSourceRequest']>();
  const [sourceIssue, setSourceIssue] = useState<string>();
  const [linkCreation, setLinkCreation] = useState(false);
  const nextWelcomePlacement = useRef(0);
  const panels = useBoardPanels();
  const creation = useBoardHtmlCreation();
  const editingSelection = useWorkspaceSelection({
    initialSelectedIds: initial.selectedIds,
    projection,
    payloads: state.payloads,
  });
  const {
    selected,
    selection,
    selectedObjects,
    selectionLocks,
    selectedHtmlId,
    menuAnchor,
    dismissMenu,
    objectEdit,
    editObject,
    formatObjectRequest,
    clearFormatRequest,
    advanceSelectionEpoch,
    changeSelection,
    selectAll,
    handleContextMenu,
    handleSelectionMenu,
    handleFormatObject,
    onRenameSection,
  } = editingSelection;
  const projected = useMemo(
    () => projectPayloads(projection, state.payloads),
    [projection, state.payloads],
  );
  const textStyleById = useMemo(
    () => projectTextStyles(state.payloads, selection),
    [selection, state.payloads],
  );
  const mayEdit = board.canEdit && !state.sceneError;
  const title = board.title || '白板';

  function handleRoomAccessLost() {
    panels.closeAll();
    annotation.reset();
    dismissMenu();
    clearFormatRequest();
    session.reload();
    features.onRoomAccessLost?.();
  }

  const {
    canvasRef,
    canvasArea,
    setCanvasArea,
    viewport,
    setViewport,
    viewportSize,
    setViewportSize,
    viewportRequest,
    detachSequence,
    detachFollow,
    restoreViewport,
    fitViewport,
    handleZoomBoard,
    handleManualZoom,
    handleManualFit,
    focusCanvas,
    focusWorldPoint,
    fitPresentation,
    scope,
    focusedObjectId,
    returnViewport,
    enter,
    exit,
    focusContentObject,
    placementPoint,
    worldCenter,
  } = useWorkspaceViewport({
    initial,
    objectsById: projection.objectsById,
    canFollow: Boolean(features.renderPresence),
  });

  function handleOpenViewing(ids: readonly string[], trigger?: HTMLButtonElement) {
    panels.closeAll();
    annotation.reset();
    dismissMenu();
    clearFormatRequest();
    enter(ids, trigger);
  }

  const watching = Boolean(scope);
  const feedbackView = readFeedbackView(
    scope,
    projection,
    viewport,
    viewportSize,
    panels.historyPreview,
  );
  const { documentReading, viewport: feedbackViewport } = feedbackView;

  const previewing = panels.historyPreview || panels.suggestionPreview;
  const expandedObjectId = scope?.expandedObjectId;
  const editingObjectIds = useMemo(() => {
    if (!mayEdit || previewing || editingObjects.size === 0) {
      return undefined;
    }

    return [...editingObjects].filter(
      (id) => projection.objectsById.has(id) && (!watching || expandedObjectId === id),
    );
  }, [mayEdit, previewing, editingObjects, projection.objectsById, watching, expandedObjectId]);
  const objectGeometry = useMemo(
    () => new Map(board.objects.map(({ id, geometry }) => [id, geometry])),
    [board.objects],
  );
  const { viewOnly, online, canComment, canEditExpanded } = availableEditAccess(
    mayEdit,
    features.commentAccess,
    watching,
    previewing,
    documentReading,
  );
  const { editService, Viewing, renderExport, renderFeedback } = features;
  const {
    undo,
    move,
    moving,
    editingReady,
    geometry,
    content,
    canEdit,
    canInsert,
    canDraw,
    canChooseTools,
    viewportHistory,
    handleEditApplied,
    handleObjectIntent,
    handleHistoryKey,
    handleEdit,
    handleRestore,
  } = useWorkspaceEditing({
    state,
    session,
    createCommandId,
    objectsById: projection.objectsById,
    textStyleById,
    editingSelection,
    editService,
    localDrafts: features.localDrafts,
    tool,
    online,
    mayEdit,
    mayEditContent: online || (canEditExpanded && Boolean(expandedObjectId)),
    onPlacementApplied: creation.complete,
  });
  const boardTitle = useBoardTitle({
    boardId: board.boardId,
    title,
    renameBoard: online ? renameBoard : undefined,
    onSaved: session.reload,
  });

  function insertClipboardText(text: string) {
    const object = clipboardTextDraft(text, worldCenter());
    geometry.handleEdit({ kind: 'create', interactionId: 'paste-text', object });
  }

  async function handleSaveLink({
    title: label,
    href,
  }: {
    readonly title: string;
    readonly href: string;
  }) {
    const stateNow = geometry.state;
    const prior = stateNow.kind === 'unknown' ? stateNow.edit.command.operation : undefined;
    const retry =
      prior?.kind === 'create' &&
      prior.object.kind === 'link' &&
      prior.initialPayload?.kind === 'link' &&
      prior.object.label === label &&
      prior.initialPayload.value.href === href;
    const { x, y } = worldCenter();
    const result = retry
      ? await geometry.retryWithReceipt()
      : await geometry.submitEdit({
          kind: 'create',
          interactionId: 'create-link',
          object: {
            kind: 'link',
            label,
            geometry: { x, y, width: 320, height: 94, rotation: 0 },
            metadata: { href },
          },
        });

    if (!result) {
      return false;
    }
    if ('detail' in result) {
      throw new Error(result.detail);
    }

    return result.receipt.kind === 'applied';
  }

  const annotation = useWorkspaceAnnotation({
    canComment,
    feedbackEnabled: Boolean(renderFeedback),
    documentReading,
    viewport: feedbackViewport,
    canvasArea,
    objects: board.objects,
    objectsById: projection.objectsById,
    revision: board.revision,
    payloadById: projected.payloadById,
    selection,
    onActivate: () => {
      dismissMenu();
      setTool('select');
    },
    onToggle: () => panels.setFeedbackOpen(false),
  });
  const annotationActive = annotation.active;
  const annotationRange = annotation.range;
  const clipboard = useWorkspaceTransfers({
    clipboard: features.clipboard,
    sourceBoardId: board.boardId,
    sourceRevision: board.revision,
    objects: projection.scene.objects,
    selection,
    active: !viewOnly && !annotationActive,
    canEdit: canInsert && !annotationActive,
    canDrop: canInsert,
    hasLockedSelection: selectionLocks.ids.size > 0,
    onSelectionAction: geometry.handleSelectionAction,
    onObjects: geometry.handlePaste,
    onText: insertClipboardText,
    canvasArea,
  });

  function nativeSourceLabel(source: CanvasNativeSource) {
    if (!source.artifactId || source.artifactId === board.boardId) {
      return projection.objectsById.get(source.elementId)?.label;
    }
  }

  function openNativeSource(source: CanvasNativeSource) {
    if (source.artifactId && source.artifactId !== board.boardId) {
      setSourceIssue('这条来源位于其他白板。');
      return;
    }
    if (!projection.objectsById.has(source.elementId)) {
      setSourceIssue('来源对象已不存在。');
      return;
    }

    setSourceIssue(undefined);
    exit();
    detachFollow();
    changeSelection([source.elementId]);
    fitViewport('selection');
    setNativeSourceRequest((current) => ({ source, sequence: (current?.sequence ?? 0) + 1 }));
  }

  function handleToolChange(nextTool: BoardTool) {
    advanceSelectionEpoch();
    annotation.reset();
    dismissMenu();
    clearFormatRequest();
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

  const selectionActions = (
    <WorkspaceSelectionBar
      selection={selectedObjects}
      locks={selectionLocks}
      editAvailable={Boolean(editService)}
      formatAvailable={editingReady}
      canEdit={canEdit}
      onOpenViewing={(trigger) => handleOpenViewing(selection, trigger)}
      onEditObject={editObject}
      selectedHtmlId={selectedHtmlId}
      onAction={geometry.handleSelectionAction}
      moreOpen={menuAnchor !== null}
      onOpenMore={handleSelectionMenu}
      onSelectAll={selectAll}
      onAnnotate={annotation.onAnnotate}
      onRenameSection={onRenameSection}
      clipboard={clipboard.menu}
      textStyleById={textStyleById}
      customColors={board.customColors}
      onFormatObject={handleFormatObject}
    />
  );
  const pendingEdits = moving ? move.pendingEdits : geometry.pendingEdits;
  const pendingPlacement = geometry.pendingPlacement;
  const canvasScene = useMemo(() => {
    const scene = projected.scene;
    if (!pendingPlacement || projection.objectsById.has(pendingPlacement.id)) {
      return scene;
    }

    return { ...scene, objects: [...scene.objects, pendingPlacement] };
  }, [projected.scene, projection.objectsById, pendingPlacement]);
  const canvasSelection = useMemo(() => {
    const id = pendingPlacement?.id;
    return id && selected.includes(id) && !selection.includes(id) ? [...selection, id] : selection;
  }, [pendingPlacement, selected, selection]);
  function renderCanvas(room?: BoardPresenceSlot) {
    return (
      <WorkspaceCanvas
        viewOnly={viewOnly}
        annotating={annotationActive}
        input={{
          ref: canvasRef,
          viewId: board.boardId,
          label: title,
          scene: viewOnly ? projected.scene : canvasScene,
          selection: canvasSelection,
          tool,
          penStyle: { stroke: penColor, width: canvasPenWidth },
          fitOnMount: hasOpeningObjects && features.fitOnMount,
          initialViewport: initial.viewport,
          viewportRequest,
          showGrid,
          presentation: scope,
          selectionActions,
          canEdit,
          canDraw,
          pendingResizeObjectId: online && !annotationActive ? pendingPlacement?.id : undefined,
          nudgeSave: online && !annotationActive ? move.nudgeSave : undefined,
          canEditExpandedObject: canEditExpanded,
          pendingEdits,
          objectExtensions: editService ? studioObjectExtensions : moveExtensions,
          payloadById: projected.payloadById,
          onSelectionChange: changeSelection,
          onToolChange: handleToolChange,
          onContextMenu: handleContextMenu,
          blankDoubleClickPlacement: textExtension.placement,
          editObjectRequest: objectEdit,
          formatObjectRequest,
          onEditIntent: handleEdit,
          canWriteObject: content.canWriteObject,
          onObjectIntent: handleObjectIntent,
          readHtmlSource: features.readHtmlSource,
          downloadFile: features.downloadObjectFile,
          readDocumentAsset: features.readDocumentAsset,
          uploadDocumentImage: features.uploadDocumentImage,
          annotationActive,
          onAnnotateContent:
            renderFeedback && canComment ? annotation.onAnnotateContent : undefined,
          contentTracking: contentTracking.tracking,
          nativeSourceRequest,
          onOpenNativeSource: openNativeSource,
          nativeSourceLabel,
          onOpenPresentation: handleOpenViewing,
          onClosePresentation: exit,
          onViewportChange: setViewport,
          onViewportSizeChange: setViewportSize,
          onViewportNavigation: viewOnly ? undefined : detachFollow,
          onWorldPointerChange: viewOnly ? undefined : room?.onCursorChange,
          onGesturePreviewChange: room?.onGesturePreviewChange,
          onObjectEditingChange: room ? handleObjectEditing : undefined,
          remoteGesturePreviews: room?.remoteGesturePreviews,
          onVisibleObjectsChange: session.observeVisible,
        }}
      />
    );
  }
  const exportAnchor = panels.exportAnchor;

  function renderWorkspace(room?: BoardPresenceSlot) {
    if (room?.accessLost) {
      return (
        <div className="whiteboard-editor__state">
          <StatePanel kind="error" title="白板访问已撤销" />
        </div>
      );
    }

    return (
      <>
        <BoardViewReporter
          boardId={board.boardId}
          selectedIds={selection}
          viewport={viewport}
          focusedObjectId={focusedObjectId}
          returnViewport={returnViewport}
          enabled={!previewing}
          onViewContext={features.onViewContext}
        />
        <WorkspaceHeader
          title={title}
          watching={watching}
          documentReading={documentReading}
          historyPreview={previewing}
          historyOpen={Boolean(panels.historyAnchor)}
          feedbackOpen={panels.feedbackOpen}
          suggestionsOpen={Boolean(panels.suggestionAnchor)}
          suggestionTrigger={panels.suggestionTrigger}
          shareOpen={Boolean(exportAnchor)}
          lanSharing={features.lanSharing ?? panels.lanSharing}
          consumeShareEntry={features.consumeShareEntry}
          annotationActive={annotationActive}
          unresolvedFeedback={annotation.unresolved}
          writeAccess={board.canEdit}
          trashed={board.trashed}
          moving={moving}
          move={move}
          geometry={geometry}
          notice={content.getNotice((objectId) => textSaveIssues.has(objectId))}
          participants={room?.participants}
          onBack={onBack}
          titleEditor={boardTitle.editor}
          theme={features.theme}
          {...boardPanelActions(features, panels)}
          onToggleAnnotation={annotation.onToggleAnnotation}
          readNotices={
            <WorkspaceNotices
              state={state}
              reload={session.reload}
              retryPayloads={session.retryPayloads}
              unsafePayloadVersion={projected.unsafePayloadVersion}
              renameFailure={boardTitle.failure}
              textSaveIssues={textSaveIssues}
              sourceIssue={sourceIssue}
              dismissSourceIssue={() => setSourceIssue(undefined)}
              clipboardIssue={clipboard.issue}
              dismissClipboardIssue={clipboard.dismiss}
              undo={undo}
            />
          }
        />
        {room?.notice}
        <div
          className="whiteboard-editor__canvas"
          data-document-reading={documentReading || undefined}
          ref={setCanvasArea}
        >
          <BoardDraftRecovery
            draftAccess={content.draftAccess}
            readCurrent={(objectId, signal) =>
              readBoardDraftCurrent(service, board.boardId, objectId, signal)
            }
            copyText={features.clipboard?.writeText}
            downloadFile={features.downloadObjectFile}
          />
          <div
            className="whiteboard-editor__live-canvas"
            data-canvas-toolbar-scope=""
            inert={previewing}
            {...clipboard.handlers}
            onDragOver={clipboard.handleDragOver}
            onDrop={clipboard.handleDrop}
            onKeyDown={handleHistoryKey}
            onClick={annotation.onClick}
            onPointerDownCapture={annotationRange.begin}
            onPointerMoveCapture={annotationRange.move}
            onPointerUpCapture={annotationRange.finish}
            onPointerCancelCapture={annotationRange.cancel}
            onPointerLeave={annotationRange.cancel}
          >
            <Viewing
              active={watching}
              documentReading={documentReading}
              title={title}
              viewport={viewport}
              onZoom={handleZoomBoard}
              onFit={fitPresentation}
              onExit={exit}
              onCanvasFocus={focusCanvas}
            >
              <TextSaveNoticePublisher.Provider value={publishTextSaveIssue}>
                {renderCanvas(room)}
              </TextSaveNoticePublisher.Provider>
            </Viewing>
            {annotationRange.marquee && (
              <div
                aria-hidden="true"
                className="whiteboard-editor__annotation-range"
                style={{
                  left: annotationRange.marquee.x,
                  top: annotationRange.marquee.y,
                  width: annotationRange.marquee.width,
                  height: annotationRange.marquee.height,
                }}
              />
            )}
            {room?.overlay}
            <div hidden={watching}>
              <BoardViewportTools
                zoom={viewport.zoom}
                onZoom={handleManualZoom}
                onFit={handleManualFit}
                hasSelection={selection.length > 0}
                showGrid={showGrid}
                onShowGridChange={setShowGrid}
                singleKeys={singleKeys}
                onSingleKeysChange={setSingleKeys}
                timerEditable={board.canEdit}
                timer={features.renderSharedTimer?.()}
                history={viewportHistory}
              />
              <WorkspaceToolbar
                boardId={board.boardId}
                tool={tool}
                viewport={viewport}
                visible={board.canEdit}
                canInsertImage={board.canEdit}
                mediaPaused={!online}
                canEditGeometry={canChooseTools}
                renderMedia={features.renderMedia}
                onApplied={handleEditApplied}
                onToolChange={handleToolChange}
                onCanvasFocus={focusCanvas}
                singleKeys={singleKeys}
                penColor={penColor}
                onPenColorChange={setPenColor}
                onAddHtml={canInsert ? handleOpenHtml : undefined}
                onAddLink={canInsert ? () => setLinkCreation(true) : undefined}
                placementPoint={placementPoint}
                onUploadReady={clipboard.handleUploadReady}
              />
            </div>
            {welcomeAvailable(viewOnly, annotationActive, tool, canvasScene.objects.length) && (
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
              updateKey: room?.feedbackUpdateKey,
              viewerActorId: room?.viewerActorId,
              boardId: board.boardId,
              canEdit: canComment,
              viewing: feedbackView.hidingFeedback,
              viewport: feedbackViewport,
              viewportSize,
              objects: board.objects,
              selectedIds: selection,
              panelOpen: panels.feedbackOpen,
              onPanelOpenChange: panels.setFeedbackOpen,
              anchor: panels.feedbackAnchor,
              focusWorldPoint,
              focusContentObject,
              contentLocations: contentTracking.locations,
              onContentLocationRequests: contentTracking.requestLocations,
              annotationActive,
              onAnnotationActiveChange: annotation.onActiveChange,
              onUnresolvedChange: annotation.onUnresolvedChange,
              annotationRequest: annotation.request,
              contentAnnotationRequest: annotation.contentRequest,
              pointAnnotationRequest: annotation.pointRequest,
              selectionAnnotationRequest: annotationRange.request,
              hostPicking: true,
              focusedObjectId: feedbackView.focusedObjectId,
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
            suggestions={{
              updateKey: room?.suggestionsUpdateKey,
              boardId: board.boardId,
              previewHost: canvasArea,
              anchor: panels.suggestionAnchor,
              onClose: panels.closeSuggestions,
              restoreFocus: panels.restoreSuggestionsFocus,
              onApplied: handleEditApplied,
              onPreviewChange: panels.setSuggestionPreview,
              renderPreview: (key, changes) => renderSuggestionPreview(key, state, changes),
            }}
          />
        </div>
        <GeometryBoardMenu
          anchor={menuAnchor}
          selection={selectedObjects}
          locks={selectionLocks}
          canEdit={canInsert}
          onAction={geometry.handleSelectionAction}
          onFit={handleManualFit}
          onSelectAll={selectAll}
          onRequestClose={dismissMenu}
          onRenameSection={onRenameSection}
          clipboard={clipboard.menu}
          returnFocus={focusCanvas}
        />
        {linkCreation && (
          <LinkDialog
            initial={newLink}
            onSave={handleSaveLink}
            onClose={() => setLinkCreation(false)}
            onRestoreFocus={focusCanvas}
            readOnly={!online}
          />
        )}
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
            selectedHtmlId,
          }}
          render={renderExport}
          onClose={panels.closeExport}
          onLanSharingChange={panels.setLanSharing}
        />
      </>
    );
  }

  return features.renderPresence
    ? features.renderPresence({
        viewport: viewportSize && { ...viewport, ...viewportSize },
        editingObjectIds,
        objectGeometry,
        paused: viewOnly,
        detachSequence,
        onViewportRequest: restoreViewport,
        onCanvasFocus: () =>
          canvasArea
            ?.querySelector<HTMLElement>('[data-canvas-root]')
            ?.focus({ preventScroll: true }),
        onContentChanged: session.acceptRoomContent,
        onAccessLost: handleRoomAccessLost,
        render: renderWorkspace,
      })
    : renderWorkspace();
}

function LoadedBoard({
  state,
  session,
  service,
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

  const visibleFeatures: WhiteboardEditorFeatures = state.scene.trashed
    ? {
        Viewing: features.Viewing,
        fitOnMount: features.fitOnMount,
        initialBoardView: features.initialBoardView,
        theme: features.theme,
        readDocumentAsset: features.readDocumentAsset,
        clipboard: features.clipboard,
      }
    : features;

  return (
    <BoardWorkspace
      key={state.scene.trashed ? 'trashed' : 'active'}
      state={state}
      session={session}
      service={service}
      projection={projection}
      createCommandId={createCommandId}
      onBack={onBack}
      renameBoard={renameBoard}
      features={visibleFeatures}
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
          service={service}
          createCommandId={createCommandId}
          onBack={onBack}
          renameBoard={renameBoard}
          features={features}
        />
      )}
    </section>
  );
}
