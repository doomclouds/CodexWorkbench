import { useRef, type KeyboardEvent } from 'react';
import type {
  BoardEditReceipt,
  WhiteboardReadyState,
  createWhiteboardSession,
} from '../../data/whiteboard/index.js';
import type { CanvasEditIntent, CanvasObjectIntent } from '../../ui/domain/canvas/index.js';
import { canvasOwnsClipboard } from './board-clipboard.js';
import type { WhiteboardEditorFeatures } from './board-features.js';
import type { BoardTool } from './BoardChrome.js';
import type { projectScene, projectTextStyles } from './canvas-projection.js';
import { record } from './content-edit-value.js';
import { adjacentTextDraft } from './geometry-commands.js';
import { useGeometryEdits } from './geometry-session.js';
import { useMoveSession } from './move-session.js';
import { useBoardUndo } from './use-board-undo.js';
import { useContentEdits } from './use-content-edits.js';
import type { useWorkspaceSelection } from './use-workspace-selection.js';

type AppliedEdit = Extract<BoardEditReceipt, { kind: 'applied' }>;

const adjacentTextKinds = new Set(['text', 'note', 'shape', 'section']);

function geometryAvailability(
  editingReady: boolean,
  hasGeometryService: boolean,
  undoPending: boolean,
  geometry: Pick<ReturnType<typeof useGeometryEdits>, 'hasPendingEdit' | 'canQueueInk'>,
  tool: BoardTool,
) {
  const historyReady = editingReady && !geometry.hasPendingEdit;
  const canEdit = historyReady && !undoPending;
  const canInsert = canEdit && hasGeometryService;
  const canDraw = editingReady && !undoPending && hasGeometryService && geometry.canQueueInk;
  const canChooseTools = canInsert || (tool === 'pen' && canDraw);

  return { historyReady, canEdit, canInsert, canDraw, canChooseTools };
}

interface WorkspaceEditingOptions {
  readonly state: WhiteboardReadyState;
  readonly session: ReturnType<typeof createWhiteboardSession>;
  readonly createCommandId: () => string;
  readonly objectsById: NonNullable<ReturnType<typeof projectScene>>['objectsById'];
  readonly textStyleById: ReturnType<typeof projectTextStyles>;
  readonly editingSelection: Pick<
    ReturnType<typeof useWorkspaceSelection>,
    | 'selection'
    | 'selectPlacement'
    | 'editObject'
    | 'readSelectionEpoch'
    | 'onPlacementStarted'
    | 'onPlacementFailed'
  >;
  readonly editService?: WhiteboardEditorFeatures['editService'];
  readonly localDrafts?: WhiteboardEditorFeatures['localDrafts'];
  readonly tool: BoardTool;
  readonly online: boolean;
  readonly mayEdit: boolean;
  readonly mayEditContent: boolean;
  readonly onPlacementApplied: (receipt: AppliedEdit, ids: readonly string[]) => void;
}

export function useWorkspaceEditing({
  state,
  session,
  createCommandId,
  objectsById,
  textStyleById,
  editingSelection,
  editService,
  localDrafts,
  tool,
  online,
  mayEdit,
  mayEditContent,
  onPlacementApplied,
}: WorkspaceEditingOptions) {
  const board = state.scene;
  const {
    selection,
    selectPlacement,
    editObject,
    readSelectionEpoch,
    onPlacementStarted,
    onPlacementFailed,
  } = editingSelection;
  const newTextIds = useRef(new Set<string>());
  const undo = useBoardUndo({
    boardId: board.boardId,
    revision: board.revision,
    enabled: online,
    service: editService,
    createCommandId,
    onApplied: session.acceptEdit,
    onConflict: session.acceptConflict,
  });
  const move = useMoveSession(session, board.boardId, online, createCommandId, undo.recordMove);
  const moving = move.pendingEdits.length > 0;
  const editingReady = online && !moving;

  function handleEditApplied(
    receipt: AppliedEdit,
    ids?: readonly string[],
    context?: { readonly selectionCurrent: boolean; readonly editText: boolean },
  ) {
    session.acceptEdit(receipt);
    undo.recordEdit(receipt);
    if (ids) {
      const insertedLabel = receipt.objects.find(
        ({ id, kind, payloadVersion }) =>
          (kind === 'text' || kind === 'note') && payloadVersion === 0n && ids.includes(id),
      );

      if (insertedLabel?.kind === 'text') {
        newTextIds.current.add(insertedLabel.id);
      }
      if (context?.selectionCurrent !== false) {
        selectPlacement(ids);
        if (context?.editText && insertedLabel) {
          editObject(insertedLabel.id);
        }
      }
      onPlacementApplied(receipt, ids);
    }
  }

  const geometry = useGeometryEdits({
    boardId: board.boardId,
    revision: board.revision,
    canEdit: editingReady,
    canWrite: mayEdit,
    service: editService,
    createCommandId,
    objectsById: objectsById,
    payloadVersion: (id) =>
      state.payloads.get(id)?.version ??
      board.objects.find((object) => object.id === id)?.payloadVersion,
    readSelectionEpoch,
    onPlacementStarted,
    onPlacementFailed,
    onApplied: handleEditApplied,
    onConflict: session.reload,
  });
  const content = useContentEdits({
    boardId: board.boardId,
    service: editService,
    localDrafts,
    canEdit: !undo.hasPendingEdit && mayEditContent,
    createCommandId,
    onApplied: handleEditApplied,
    onConflict: session.acceptConflict,
  });
  const { historyReady, canEdit, canInsert, canDraw, canChooseTools } = geometryAvailability(
    editingReady,
    Boolean(editService),
    undo.hasPendingEdit,
    geometry,
    tool,
  );
  const viewportHistory = {
    canUndo: historyReady && undo.canUndo,
    canRedo: historyReady && undo.canRedo,
    onChange: (direction: 'undo' | 'redo') => undo[direction](),
  };
  async function handleObjectIntent(intent: CanvasObjectIntent) {
    const { objectId, kind, name, value } = intent;
    if (name !== 'text.commit' || !record(value) || typeof value.text !== 'string') {
      return content.handleObjectIntent(intent);
    }

    const epoch = readSelectionEpoch();
    const current = state.payloads.get(objectId)?.body;
    const previousText = current?.kind === 'text' ? current.value.text : undefined;
    const previouslyFilled = typeof previousText === 'string' && Boolean(previousText.trim());
    const blankText = value.close === true && kind === 'text' && !value.text.trim();
    const shouldRemove = blankText && (previouslyFilled || newTextIds.current.has(objectId));
    const request = shouldRemove ? { ...intent, value: { ...value, deleteEmpty: true } } : intent;
    const receipt = await content.handleObjectIntent(request);
    if (!receipt.ok) {
      return receipt;
    }

    newTextIds.current.delete(objectId);
    const currentSelection = readSelectionEpoch() === epoch && selection.includes(objectId);
    if (value.adjacent === true && currentSelection && !blankText) {
      await createAdjacentText(objectId);
    }

    return receipt;
  }

  async function createAdjacentText(id: string) {
    const source = objectsById.get(id);
    if (!source || !canInsert || !adjacentTextKinds.has(source.kind)) {
      return;
    }

    const object = adjacentTextDraft(source, textStyleById.get(id));
    const result = await geometry.submitEdit({
      kind: 'create',
      interactionId: 'continue-text',
      object,
    });

    if (result && 'receipt' in result && result.receipt.kind === 'applied') {
      const [created] = result.receipt.objects;
      if (created) {
        editObject(created.id);
      }
    }
  }

  function handleHistoryKey(event: KeyboardEvent<HTMLDivElement>) {
    const primary = event.ctrlKey || event.metaKey;
    const typing = event.altKey || event.nativeEvent.isComposing;
    if (!primary || typing || !canvasOwnsClipboard(event)) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === 'z' || key === 'y') {
      event.preventDefault();
      if (historyReady) {
        undo[key === 'y' || event.shiftKey ? 'redo' : 'undo']();
      }
    }
  }

  function handleEdit(intent: CanvasEditIntent) {
    if (intent.kind === 'move') {
      move.handleEdit(intent);
      return;
    }

    geometry
      .submitEdit(intent, intent.kind === 'create' && !intent.link)
      ?.catch(geometry.reportEditFailure);
  }

  function handleRestore(receipt: BoardEditReceipt) {
    if (receipt.kind === 'applied') {
      session.acceptEdit(receipt);
      session.reload();
    }
  }

  return {
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
  };
}
