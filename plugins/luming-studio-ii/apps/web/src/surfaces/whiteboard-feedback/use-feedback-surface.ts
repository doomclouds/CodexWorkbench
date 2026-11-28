import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type {
  FeedbackAnchor,
  FeedbackContentTarget,
  FeedbackPoint,
  FeedbackTarget,
  FeedbackThread,
} from '../../data/feedback/index.js';
import type { WhiteboardFeedbackSurfaceProps } from './contracts.js';
import type { CreateDraft } from './FeedbackPanelContent.js';
import { locateDraft, selectionTarget, targetAt } from './geometry.js';
import { describeFeedbackTarget, feedbackDraftExcerpt } from './target-description.js';
import { useFeedbackDrafts } from './thread-draft.js';
import { useFeedbackAttachment } from './use-feedback-attachment.js';
import { useFeedbackCommand } from './use-feedback-command.js';
import { useFeedbackContentLocations } from './use-feedback-content-locations.js';
import { useFeedbackQueries } from './use-feedback-queries.js';
import { useFeedbackShortcut } from './use-feedback-shortcut.js';

interface SelectedThread {
  readonly id: string;
  readonly placement: 'list' | 'pin';
  readonly anchor?: FeedbackAnchor;
  readonly draftTarget?: FeedbackTarget;
  readonly draftPoint?: FeedbackPoint;
}

type SurfaceStateOptions = Omit<WhiteboardFeedbackSurfaceProps, 'selectedIds'>;

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

interface HostPointOptions {
  readonly request: WhiteboardFeedbackSurfaceProps['pointAnnotationRequest'];
  readonly hostPicking?: boolean;
  readonly annotating: boolean;
  readonly canWrite: boolean;
  readonly onPick: (point: FeedbackPoint) => void;
}

function useHostRequest<T extends { readonly sequence: number }>(
  request: T | undefined,
  active: boolean,
  receive: (request: T) => void,
) {
  const handled = useRef<number | undefined>(undefined);
  const pick = useEffectEvent(receive);

  useEffect(() => {
    if (!request || !active || handled.current === request.sequence) {
      return;
    }

    handled.current = request.sequence;
    pick(request);
  }, [request, active]);
}

function useHostPoint({ request, hostPicking, annotating, canWrite, onPick }: HostPointOptions) {
  useHostRequest(request, Boolean(hostPicking) && annotating && canWrite, ({ point }) =>
    onPick(point),
  );
}

function useSelectionRequest(
  request: WhiteboardFeedbackSurfaceProps['selectionAnnotationRequest'],
  canWrite: boolean,
  viewing: boolean,
  onPick: (target: FeedbackTarget) => void,
) {
  useHostRequest(request, canWrite && !viewing, ({ target }) => onPick(target));
}

export function useFeedbackSurface({
  boardId,
  updateKey,
  canEdit,
  viewing,
  objects,
  viewport,
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
  annotationRequest,
  selectionAnnotationRequest,
  pointAnnotationRequest,
  hostPicking,
  focusedObjectId,
  contentAnnotationRequest,
  contentPoints,
  contentLocations,
  onContentLocationRequests,
  focusContentObject,
  singleKeys = true,
}: SurfaceStateOptions) {
  const [localAnnotation, setLocalAnnotation] = useState(false);
  const annotating = annotationActive ?? localAnnotation;
  const { selection, setSelection } = useFeedbackSelection(panelOpen, annotating);
  const [createDraft, setCreateDraft] = useState<CreateDraft>();
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftTargetConflict, setDraftTargetConflict] = useState(false);
  const draftSequence = useRef(0);
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
    updateKey,
    enabled: !viewing,
    panelOpen,
    service,
    threadId: activeThreadId,
  });
  const draftShown = annotating && draftOpen && !panelOpen;
  const contentLocation = useFeedbackContentLocations({
    viewing,
    contentPoints,
    contentLocations,
    onContentLocationRequests,
    focusWorldPoint,
    focusContentObject,
    focusedObjectId,
    objects: objectsById,
    pinnedThreads: queries.pinnedThreads,
    selection,
    detail: queries.detail.page,
    draft: draftShown ? createDraft : undefined,
  });
  const canWrite = canEdit && queries.canWrite;
  const attachment = useFeedbackAttachment({
    boardId,
    createCommandId,
    onAttachThread,
    service,
    onChanged: queries.refresh,
  });

  const command = useFeedbackCommand({
    boardId,
    service,
    createCommandId,
    onApplied(result, operation, attach) {
      queries.refresh();
      if (operation.kind === 'create') {
        setSelection({
          id: result.threadId,
          placement: 'pin',
          draftTarget: operation.anchor,
          draftPoint: contentLocation.draftPoint ?? createDraft?.frozenPoint,
        });
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
    triggerPin.current = undefined;

    function restore() {
      const target = pin?.isConnected && !pin.hidden ? pin : stage.current;
      target?.focus({ preventScroll: true });
    }

    if (pin?.hidden) {
      queueMicrotask(() => {
        if (!triggerPin.current) {
          restore();
        }
      });
    } else {
      restore();
    }
  }

  function handleClosePanel() {
    if (selection?.placement === 'list' && !blocked) {
      contentLocation.cancel();
      setSelection(undefined);
    }

    onPanelOpenChange(false);
  }

  function handleStartPicking() {
    if (!canWrite || blocked) {
      return;
    }

    contentLocation.cancel();
    setSelection(undefined);
    setDraftOpen(composing);
    changeAnnotation(true);
    onPanelOpenChange(false);
  }

  function stopPicking() {
    if (!blocked) {
      contentLocation.cancel();
      changeAnnotation(false);
      setSelection(undefined);
    }
  }

  function handleCloseThread() {
    if (!blocked) {
      contentLocation.cancel();
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

      return true;
    }
    if (selection?.placement === 'pin' && !panelOpen) {
      handleCloseThread();

      return true;
    }

    stopPicking();

    return annotating;
  }

  useFeedbackShortcut({
    stage,
    anchor,
    enabled: !viewing,
    singleKeys: singleKeys && canWrite,
    cancelOutsideCanvas: annotating,
    onBegin: handleStartPicking,
    onCancel: handleEscape,
  });

  function startDraft(target: FeedbackTarget, excerpt?: string) {
    if (!canWrite || blocked) {
      return;
    }

    setDraftTargetConflict(composing);
    if (!composing) {
      setCreateDraft({
        locationId: 'feedback-draft:' + ++draftSequence.current,
        target,
        text: '',
        label: describeFeedbackTarget(
          target,
          'objectId' in target ? objectsById.get(target.objectId) : undefined,
        ),
        excerpt: feedbackDraftExcerpt(excerpt),
        frozenPoint: locateDraft(target, objectsById),
      });
    }

    contentLocation.cancel();
    setSelection(undefined);
    setDraftOpen(true);
    changeAnnotation(true);
    onPanelOpenChange(false);
  }

  const requestDraft = useEffectEvent(
    ({ objectId, u, v }: NonNullable<WhiteboardFeedbackSurfaceProps['annotationRequest']>) => {
      const target = selectionTarget(
        objectId,
        objectsById,
        viewport,
        stage.current?.getBoundingClientRect(),
      );

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

  const requestContent = useEffectEvent((target: FeedbackContentTarget, excerpt?: string) =>
    startDraft(target, excerpt),
  );
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
        requestContent(contentAnnotationRequest.target, contentAnnotationRequest.excerpt);
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
  useSelectionRequest(selectionAnnotationRequest, canWrite, viewing, startDraft);

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
      contentLocation.cancel();
      setSelection({ id: thread.id, placement: 'pin', anchor: thread.anchor });
      onPanelOpenChange(false);
    } else {
      setSelection({ id: thread.id, placement: 'list', anchor: thread.anchor });
      contentLocation.focusThread(thread);
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
    draftPoint: contentLocation.draftPoint,
    awaitingPostedPoint: contentLocation.awaitingPostedPoint,
    draftTargetConflict,
    createDraft,
    threadDraft,
    draftThreadIds,
    threadPoint: contentLocation.threadPoint,
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
    handleLocateCurrentThread: contentLocation.focusSelected,
    handlePickLocation,
    stopPicking,
    setCreateDraft,
  };
}
