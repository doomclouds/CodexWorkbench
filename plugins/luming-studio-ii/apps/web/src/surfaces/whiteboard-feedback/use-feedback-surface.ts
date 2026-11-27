import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type {
  FeedbackAnchor,
  FeedbackContentTarget,
  FeedbackPoint,
  FeedbackTarget,
  FeedbackThread,
} from '../../data/feedback/index.js';
import type { FeedbackCanvasObject, WhiteboardFeedbackSurfaceProps } from './contracts.js';
import type { CreateDraft } from './FeedbackPanelContent.js';
import { locateAnchor, locateDraft, selectionTarget, targetAt } from './geometry.js';
import { useFeedbackDrafts } from './thread-draft.js';
import { useFeedbackAttachment } from './use-feedback-attachment.js';
import { useFeedbackCommand } from './use-feedback-command.js';
import { useFeedbackQueries } from './use-feedback-queries.js';
import { useFeedbackShortcut } from './use-feedback-shortcut.js';

interface SelectedThread {
  readonly id: string;
  readonly placement: 'list' | 'pin';
  readonly anchor?: FeedbackAnchor;
  readonly draftTarget?: FeedbackTarget;
}

type SurfaceStateOptions = Omit<WhiteboardFeedbackSurfaceProps, 'viewport' | 'selectedIds'>;

function useFeedbackSelection(panelOpen: boolean, annotating: boolean) {
  const [selection, setSelection] = useState<SelectedThread>();
  const [view, setView] = useState({ panelOpen, annotating });
  if (view.panelOpen !== panelOpen || view.annotating !== annotating) {
    setView({ panelOpen, annotating });
    const outOfList = panelOpen && selection?.placement === 'pin';
    const outOfPin = !panelOpen && selection?.placement === 'list';
    const stoppedAnnotating = view.annotating && !annotating;
    if (outOfList || outOfPin || stoppedAnnotating) {
      setSelection(undefined);
    }
  }

  return { selection, setSelection };
}

function locateThread(
  selection: SelectedThread | undefined,
  thread: FeedbackThread | undefined,
  objects: ReadonlyMap<string, FeedbackCanvasObject>,
  contentPoints?: ReadonlyMap<string, FeedbackPoint>,
) {
  const anchor = thread?.anchor ?? selection?.anchor;
  const contentPoint = selection && contentPoints?.get(selection.id);

  return anchor
    ? locateAnchor(anchor, objects, contentPoint)
    : selection?.draftTarget && locateDraft(selection.draftTarget, objects);
}

function draftLabel(target: FeedbackTarget, objects: ReadonlyMap<string, FeedbackCanvasObject>) {
  if (target.kind === 'board') {
    return '画板位置';
  }
  if (target.kind === 'object') {
    return objects.get(target.objectId)?.label || '所选对象';
  }

  return contentLabels[target.content.kind];
}

const contentLabels = { document: '文档段落', todo: '待办事项', html: 'HTML 内部选区' };

interface HostPointOptions {
  readonly request: WhiteboardFeedbackSurfaceProps['pointAnnotationRequest'];
  readonly hostPicking?: boolean;
  readonly annotating: boolean;
  readonly canWrite: boolean;
  readonly onPick: (point: FeedbackPoint) => void;
}

function useHostPoint({ request, hostPicking, annotating, canWrite, onPick }: HostPointOptions) {
  const handled = useRef<number | undefined>(undefined);
  const pick = useEffectEvent(onPick);
  const active = hostPicking && annotating && canWrite;

  useEffect(() => {
    if (!request || !active || handled.current === request.sequence) {
      return;
    }

    handled.current = request.sequence;
    pick(request.point);
  }, [request, active]);
}

export function useFeedbackSurface({
  boardId,
  canEdit,
  viewing,
  objects,
  service,
  createCommandId,
  panelOpen,
  onPanelOpenChange,
  anchor,
  focusWorldPoint,
  annotationActive,
  onAnnotationActiveChange,
  onUnresolvedChange,
  onAttachThread,
  attachmentMode,
  annotationRequest,
  pointAnnotationRequest,
  hostPicking,
  focusedObjectId,
  contentAnnotationRequest,
  contentPoints,
  singleKeys = true,
}: SurfaceStateOptions) {
  const [localAnnotation, setLocalAnnotation] = useState(false);
  const annotating = annotationActive ?? localAnnotation;
  const { selection, setSelection } = useFeedbackSelection(panelOpen, annotating);
  const [createDraft, setCreateDraft] = useState<CreateDraft>();
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftTargetConflict, setDraftTargetConflict] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const triggerPin = useRef<HTMLButtonElement | undefined>(undefined);
  const handledAnnotation = useRef<number | undefined>(undefined);
  const handledContent = useRef<number | undefined>(undefined);
  const objectsById = useMemo(
    () => new Map(objects.map((object) => [object.id, object])),
    [objects],
  );
  const activeThreadId = selection?.id;
  const { threadDraft, draftThreadIds, clearDraft, handleSetThreadDraft } =
    useFeedbackDrafts(activeThreadId);
  const queries = useFeedbackQueries({
    boardId,
    enabled: !viewing,
    panelOpen,
    service,
    threadId: activeThreadId,
  });
  const canWrite = canEdit && queries.canWrite;
  const attachment = useFeedbackAttachment({
    boardId,
    createCommandId,
    onAttachThread,
    attachmentMode,
  });

  const command = useFeedbackCommand({
    boardId,
    service,
    createCommandId,
    onApplied(result, operation, attach) {
      queries.refresh();
      if (operation.kind === 'create') {
        setSelection({ id: result.threadId, placement: 'pin', draftTarget: operation.anchor });
        setCreateDraft(undefined);
        setDraftOpen(false);
        setDraftTargetConflict(false);
      }

      if (result.deleted) {
        setSelection(undefined);
      }

      if (result.deleted || operation.kind === 'reply' || operation.kind === 'edit') {
        clearDraft(result.threadId);
      }
      if (attach && !result.deleted) {
        attachment.request(
          { threadId: result.threadId, threadVersion: result.threadVersion },
          true,
        );
      }
    },
  });
  const blocked = command.progress?.kind === 'unknown' || command.progress?.kind === 'saving';
  const composing = Boolean(createDraft?.text.trim());

  function changeAnnotation(active: boolean) {
    if (annotationActive === undefined) {
      setLocalAnnotation(active);
    }

    onAnnotationActiveChange?.(active);
  }

  function restoreListFocus() {
    if (anchor?.isConnected) {
      anchor.focus({ preventScroll: true });
    }
  }

  function restoreCanvasFocus() {
    const pin = triggerPin.current;
    const target = pin?.isConnected ? pin : stage.current;
    target?.focus({ preventScroll: true });
    triggerPin.current = undefined;
  }

  function handleClosePanel() {
    if (selection?.placement === 'list' && !blocked) {
      setSelection(undefined);
    }

    onPanelOpenChange(false);
  }

  function handleStartPicking() {
    if (!canWrite || blocked) {
      return;
    }

    setSelection(undefined);
    setDraftOpen(composing);
    changeAnnotation(true);
    onPanelOpenChange(false);
  }

  function stopPicking() {
    if (!blocked) {
      changeAnnotation(false);
      setSelection(undefined);
    }
  }

  function handleCloseThread() {
    if (!blocked) {
      setSelection(undefined);
    }
  }

  function handleHideDraft() {
    if (!blocked) {
      setDraftOpen(false);
    }
  }

  function handleEscape() {
    if (draftOpen && annotating) {
      handleHideDraft();
      return;
    }
    if (selection?.placement === 'pin' && !panelOpen) {
      handleCloseThread();
      return;
    }

    stopPicking();
  }

  useFeedbackShortcut({
    stage,
    anchor,
    enabled: !viewing,
    singleKeys: singleKeys && canWrite,
    onBegin: handleStartPicking,
    onCancel: handleEscape,
  });

  function startDraft(target: FeedbackTarget) {
    if (!canWrite || blocked) {
      return;
    }

    setDraftTargetConflict(composing);
    if (!composing) {
      setCreateDraft({
        target,
        text: '',
        label: draftLabel(target, objectsById),
        frozenPoint: locateDraft(target, objectsById),
      });
    }

    setSelection(undefined);
    setDraftOpen(true);
    changeAnnotation(true);
    onPanelOpenChange(false);
  }

  const requestDraft = useEffectEvent(
    ({ objectId, u, v }: NonNullable<WhiteboardFeedbackSurfaceProps['annotationRequest']>) => {
      const target = selectionTarget([objectId], objectsById);
      if (target?.kind === 'object') {
        startDraft({ ...target, u: u ?? target.u, v: v ?? target.v });
      }
    },
  );

  useEffect(() => {
    if (
      !annotationRequest ||
      !canWrite ||
      handledAnnotation.current === annotationRequest.sequence
    ) {
      return;
    }

    handledAnnotation.current = annotationRequest.sequence;
    requestDraft(annotationRequest);
  }, [annotationRequest, canWrite]);

  const requestContent = useEffectEvent((target: FeedbackContentTarget) => startDraft(target));
  useEffect(() => {
    if (
      !contentAnnotationRequest ||
      !canWrite ||
      handledContent.current === contentAnnotationRequest.sequence
    ) {
      return;
    }

    let current = true;
    queueMicrotask(() => {
      if (current) {
        handledContent.current = contentAnnotationRequest.sequence;
        requestContent(contentAnnotationRequest.target);
      }
    });

    return () => {
      current = false;
    };
  }, [contentAnnotationRequest, canWrite]);

  useHostPoint({
    request: pointAnnotationRequest,
    hostPicking,
    annotating,
    canWrite,
    onPick: handlePickLocation,
  });

  const reportUnresolved = useEffectEvent((unresolved: boolean) =>
    onUnresolvedChange?.(unresolved),
  );
  const hasUnresolved = queries.hasUnresolved;
  useEffect(() => {
    if (hasUnresolved !== undefined) {
      reportUnresolved(hasUnresolved);
    }
  }, [hasUnresolved]);

  function handlePickLocation(point: FeedbackPoint) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return;
    }

    if (focusedObjectId) {
      const focused = objectsById.get(focusedObjectId);
      startDraft(targetAt(point, focused ? [focused] : []));
      return;
    }

    startDraft(targetAt(point, objects));
  }

  function handleOpenThread(thread: FeedbackThread, trigger?: HTMLButtonElement) {
    if (blocked) {
      return;
    }

    setDraftOpen(false);
    triggerPin.current = trigger;
    changeAnnotation(true);
    if (trigger) {
      setSelection({ id: thread.id, placement: 'pin', anchor: thread.anchor });
      onPanelOpenChange(false);
    } else {
      setSelection({ id: thread.id, placement: 'list', anchor: thread.anchor });
      focusWorldPoint?.(locateAnchor(thread.anchor, objectsById, contentPoints?.get(thread.id)));
    }
  }

  const threadPoint = locateThread(
    selection,
    queries.detail.page?.thread,
    objectsById,
    contentPoints,
  );

  function handleLocateCurrentThread() {
    if (threadPoint) {
      focusWorldPoint?.(threadPoint);
    }
  }

  function handleCancelDraft() {
    if (!blocked) {
      setCreateDraft(undefined);
      setDraftOpen(false);
      setDraftTargetConflict(false);
    }
  }

  function handleDraftOutside() {
    if (!composing) {
      handleHideDraft();
    }
  }

  const draftShown = annotating && draftOpen && !panelOpen;
  const selectedPin = selection?.placement === 'pin' && !panelOpen;
  const expandedId = selection?.placement === 'list' && panelOpen ? activeThreadId : undefined;
  const picking = annotating && canWrite && !blocked;

  return {
    stage,
    objectsById,
    queries,
    command,
    attachment,
    selectedPin,
    expandedId,
    activeThreadId,
    draftShown,
    draftTargetConflict,
    createDraft,
    threadDraft,
    draftThreadIds,
    threadPoint,
    blocked,
    picking,
    canWrite,
    restoreListFocus,
    restoreCanvasFocus,
    handleClosePanel,
    handleCloseThread,
    handleHideDraft,
    handleCancelDraft,
    handleDraftOutside,
    handleSetThreadDraft,
    handleOpenThread,
    handleLocateCurrentThread,
    handlePickLocation,
    stopPicking,
    setCreateDraft,
  };
}
