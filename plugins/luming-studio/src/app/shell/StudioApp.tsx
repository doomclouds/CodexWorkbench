import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { OperationNoticeTarget } from '../shared/OperationNotice.js';
import { AlertCircle, Check, MessageSquare, X } from 'lucide-react';
import {
  type Actor,
  type AgentTaskReleaseTarget,
  type Anchor,
  type Feedback,
  type Presence,
  type StudioClient,
  type ViewContext,
} from '../../contracts/studio';
import {
  StudioLibraryView,
  StudioUnsupportedArtifact,
  StudioPurgeDialog,
  StudioRenameDialog,
  useStudioLibraryPage,
} from '../pages/library';
import type { ProductActivity, StudioDocument, Viewport } from '../product-contract';
import { StudioDialog } from '../shared/StudioDialog';
import { reportStudioWarning } from '../shared/studio-warning';
import '../studio.css';
import {
  StudioEditorView,
  getEditorProduct,
  locateEditorAnchor,
  useEditorCollaboration,
  useEditorFollowing,
  useEditorPanels,
  useEditorFeedback,
  type EditorPanel,
  type StudioEditorViewProps,
} from '../pages/editor';
import { liveCommentPoint, type CommentPoint } from '../shared/comments/comment-target';
import { copyPlainText } from '../clipboard';
import { newClientId } from '../shared/client-id';
import {
  isAuthenticationFailure,
  useStudioSession,
  type StudioSessionRequest,
} from './useStudioSession';
import { SessionNotice, useSessionVisibility } from '../shared/SessionNotice';
import { claimParticipantColor } from '../shared/presence-members';
import {
  isCurrentStudioViewScope,
  type StudioViewRequests,
  type StudioViewScope,
} from '../shared/studio-view-scope';
import { storePanelReadingView, type RestoredPanelView } from '../panel-view-state';
import { useStudioPreferences } from './preferences';

export interface StudioAppProps {
  client: StudioClient;
  requestStudio: StudioSessionRequest;
  actor: Actor;
  initialArtifactId?: string;
  initialView?: string;
  navigationRevision?: number;
  restoredView?: RestoredPanelView;
  onNavigate?: (artifactId?: string, view?: string) => void;
  onViewContext?: (context: ViewContext | null) => void;
  attachContext?: (feedback: Feedback, board: StudioDocument) => Promise<void>;
}

type Panel = EditorPanel | null;

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.)$/i.test(
    message,
  )
    ? '无法连接作品服务，请重试或重新打开页面。'
    : message;
}

function newId(prefix: string): string {
  return newClientId(prefix);
}

function emptyActivity(): ProductActivity {
  return { editingIds: [], movingIds: [], dirty: false, issues: [] };
}

function initialPresence() {
  return {
    selectedIds: [] as string[],
    viewport: { x: 0, y: 0, zoom: 1 },
    cursor: null as { x: number; y: number; t?: number; surface?: string } | null,
    following: '',
    ...emptyActivity(),
  };
}

function useRestoredView(restoredView?: RestoredPanelView, initialArtifactId?: string) {
  const resumedView = restoredView?.artifactId === initialArtifactId ? restoredView : undefined;
  const pendingContextRef = useRef(Boolean(resumedView?.viewId));
  const [readingSnapshotId, setReadingSnapshotId] = useState(resumedView?.viewId);
  const clearReadingRestore = useCallback(() => {
    pendingContextRef.current = false;
    setReadingSnapshotId(undefined);
  }, []);
  const awaitRestoredContext = useCallback((ready: boolean) => {
    if (!pendingContextRef.current) {
      return false;
    }
    if (!ready) {
      return true;
    }

    pendingContextRef.current = false;
    return false;
  }, []);
  const [selectedIds, setSelectedIds] = useState<string[]>(resumedView?.selectedIds ?? []);
  const [targetViewport, setTargetViewport] = useState<Viewport | undefined>(resumedView?.viewport);
  const [targetSelection, setTargetSelection] = useState<string[] | undefined>(
    resumedView?.selectedIds,
  );
  const presenceRef = useRef({
    ...initialPresence(),
    selectedIds: resumedView?.selectedIds ?? [],
    viewport: resumedView?.viewport ?? { x: 0, y: 0, zoom: 1 },
  });

  return {
    readingSnapshotId,
    clearReadingRestore,
    awaitRestoredContext,
    selectedIds,
    setSelectedIds,
    targetViewport,
    setTargetViewport,
    targetSelection,
    setTargetSelection,
    presenceRef,
  };
}

function studioPermissions(actor: Actor) {
  const ownerId = actor.role === 'owner' ? actor.id : null;

  return {
    ownerId,
    canManage: ownerId !== null,
    canEdit: actor.role === 'owner' || actor.role === 'editor',
    canComment: actor.role !== 'viewer',
  };
}

function useStudioApp({
  client: transportClient,
  requestStudio,
  actor: initialActor,
  initialArtifactId,
  initialView,
  navigationRevision,
  restoredView,
  onViewContext,
  attachContext,
  onNavigate,
}: StudioAppProps) {
  const {
    readingSnapshotId,
    clearReadingRestore,
    awaitRestoredContext,
    selectedIds,
    setSelectedIds,
    targetViewport,
    setTargetViewport,
    targetSelection,
    setTargetSelection,
    presenceRef,
  } = useRestoredView(restoredView, initialArtifactId);
  const [activeId, setActiveId] = useState(initialArtifactId || '');
  const session = useStudioSession(transportClient, initialActor, activeId, requestStudio);
  const { client } = session;
  const accessPending = session.status !== 'valid';
  const actor: Actor = accessPending ? { ...session.actor, role: 'viewer' } : session.actor;
  const { ownerId, canManage, canComment, canEdit } = studioPermissions(actor);
  const studioRoot = useRef<HTMLDivElement>(null);
  useSessionVisibility(studioRoot, session.status);
  const activeRef = useRef(activeId);
  const initialRoute = useRef({
    id: initialArtifactId,
    view: initialView,
    revision: navigationRevision,
  });
  const [board, setBoard] = useState<StudioDocument | null>(null);
  const boardRef = useRef<StudioDocument | null>(null);
  const { layout, handleLayoutChange, setTheme, resolvedTheme } = useStudioPreferences();
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState('');
  const [operationNoticeTarget, setOperationNoticeTarget] = useState<HTMLDivElement | null>(null);
  const [unsupportedId, setUnsupportedId] = useState('');
  const [notice, setNotice] = useState('');
  const [copyFallback, setCopyFallback] = useState('');
  const [operationBusy, setBusy] = useState('');
  const [sync, setSync] = useState<'loading' | 'saved' | 'reconnecting'>('loading');
  const [saveActivity, setSaveActivity] = useState<
    Pick<ProductActivity, 'dirty' | 'saving' | 'saveError'>
  >({ dirty: false, saving: false, saveError: '' });
  const [editingBusy, setEditingBusy] = useState(false);
  const canvasArea = useRef<HTMLDivElement>(null);
  const handleCanvasArea = useCallback((node: HTMLDivElement | null) => {
    canvasArea.current = node;
  }, []);
  const [reading, setReading] = useState(false);
  const [readingKind, setReadingKind] = useState<'canvas' | 'document'>('canvas');
  const readingChanged = useCallback(
    (active: boolean, kind: 'canvas' | 'document' = 'canvas') => {
      setReading(active);
      setReadingKind(kind);
    },
    [setReading, setReadingKind],
  );
  const shareAuthorityKey = `${session.actor.id}:${session.actor.role}:${session.status}`;
  const navigationSequence = useRef(0);
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const mounted = useRef(true);

  const [peerId] = useState(() => newId('view'));
  const isMounted = useCallback(() => mounted.current, []);
  const captureView = useCallback(
    () => ({
      viewId: peerId,
      artifactId: activeRef.current,
      navigationGeneration: navigationSequence.current,
    }),
    [peerId],
  );
  const isCurrentView = useCallback(
    (request: StudioViewScope) =>
      isCurrentStudioViewScope(request, isMounted() ? captureView() : undefined),
    [captureView, isMounted],
  );
  const viewRequests = useMemo<StudioViewRequests>(
    () => ({ capture: captureView, isCurrent: isCurrentView }),
    [captureView, isCurrentView],
  );
  useEffect(() => {
    if (!activeId && transportClient.embedded) {
      storePanelReadingView(peerId, null);
    }
  }, [activeId, peerId, transportClient.embedded]);
  const [peers, setPeers] = useState<Presence[]>([]);
  const activitySources = useRef({ editor: emptyActivity(), toolbar: emptyActivity() });
  const requestPresence = useRef<(() => void) | null>(null);
  const publishViewContext = useCallback(() => {
    const id = activeRef.current;
    const state = presenceRef.current;

    const canPublishContext = Boolean(boardRef.current) && !accessPending;
    if (id && session.status !== 'denied' && awaitRestoredContext(canPublishContext)) {
      return;
    }

    onViewContext?.(
      id && !accessPending
        ? {
            viewId: peerId,
            artifactId: id,
            selectedIds: state.selectedIds,
            viewport: state.viewport,
            selectedCount: state.selectedIds.length,
            editingIds: state.editingIds,
            movingIds: state.movingIds,
            savingIds: state.savingIds,
            dirty: state.dirty,
            issues: state.issues,
          }
        : null,
    );
  }, [onViewContext, peerId, accessPending, session.status, presenceRef, awaitRestoredContext]);
  const reportActivity = useCallback(
    (source: 'editor' | 'toolbar', artifactId: string, state: ProductActivity) => {
      if (!artifactId || artifactId !== activeRef.current) {
        return;
      }

      activitySources.current[source] = state;
      const activities = Object.values(activitySources.current);
      const merged: ProductActivity = {
        editingIds: [...new Set(activities.flatMap((activity) => activity.editingIds))].slice(
          0,
          200,
        ),
        movingIds: [...new Set(activities.flatMap((activity) => activity.movingIds))].slice(0, 200),
        savingIds: [...new Set(activities.flatMap((activity) => activity.savingIds ?? []))].slice(
          0,
          200,
        ),
        dirty: activities.some((activity) => activity.dirty),
        saving: activities.some((activity) => activity.saving),
        saveError: activities.find((activity) => activity.saveError)?.saveError || '',
        issues: activities.flatMap((activity) => activity.issues ?? []).slice(0, 5),
      };
      setSaveActivity((previous) =>
        previous.dirty === merged.dirty &&
        previous.saving === merged.saving &&
        previous.saveError === merged.saveError
          ? previous
          : { dirty: merged.dirty, saving: merged.saving, saveError: merged.saveError },
      );
      setEditingBusy(merged.editingIds.length > 0 || merged.movingIds.length > 0);
      Object.assign(presenceRef.current, merged);
      requestPresence.current?.();
      publishViewContext();
    },
    [presenceRef, publishViewContext],
  );
  const editorActivityChanged = useMemo(
    () => (state: ProductActivity) => reportActivity('editor', activeId, state),
    [activeId, reportActivity],
  );

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      navigationSequence.current += 1;
    };
  }, []);
  const fail = useCallback((cause: unknown, retry?: () => void) => {
    if (!mounted.current) {
      return;
    }
    if (
      isAuthenticationFailure(cause) ||
      (cause as { code?: string } | null)?.code === 'SESSION_PAUSED'
    ) {
      return;
    }

    if ((cause as { code?: string } | null)?.code === 'UNSUPPORTED_STORAGE') {
      if (activeRef.current) {
        setUnsupportedId(activeRef.current);
        setError('');
      } else {
        setError(errorText(cause));
      }

      setRetry(null);

      return;
    }

    setError(errorText(cause));
    setRetry(() => retry ?? null);
  }, []);
  const inform = useCallback(
    (message: string) => {
      setNotice(message);
    },
    [setNotice],
  );

  const acceptBoard = useCallback((next: StudioDocument) => {
    if (!mounted.current || next.artifact.id !== activeRef.current) {
      return;
    }

    const existing = boardRef.current;
    if (
      existing?.artifact.id === next.artifact.id &&
      existing.artifact.revision > next.artifact.revision
    ) {
      return;
    }

    boardRef.current = next;
    setBoard(next);
    setSync('saved');
  }, []);

  const { collaboration, timer, releaseAgentWorkspace } = useEditorCollaboration(
    viewRequests,
    {
      client,
      polling: !!transportClient.request,
      artifactId: activeId,
      peerId,
      enabled: !!activeId && !accessPending && unsupportedId !== activeId,
      getDocument: () => boardRef.current,
      onDocument: acceptBoard,
      onFeedback: (next) => feedbackPage.receiveFeedback(next),
      onCursorClear: () => {
        presenceRef.current.cursor = null;
      },
      onStatus: setSync,
      onError: (cause) => {
        if (cause instanceof Error && /实时连接/.test(cause.message)) {
          void session.check().catch(fail);
        }

        fail(cause);
      },
      onEvent: (message) => {
        if (message.type === 'access-revoked') {
          clearShare();
          session.revoke(message.reason);
        } else if (message.type === 'ready') {
          session.updateAccess(message.access);
          const nextActor = message.actor as Actor | undefined;
          if (
            nextActor &&
            (nextActor.id !== session.actor.id || nextActor.role !== session.actor.role)
          ) {
            void session.check('role-changed').catch(fail);
          }
        } else if (message.type === 'share') {
          session.updateAccess(message.access);
          if (
            message.reason === 'role-changed' &&
            Array.isArray(message.revokedMemberIds) &&
            message.revokedMemberIds.includes(session.actor.id)
          ) {
            void session.check('role-changed').catch(fail);
          }

          updateShareAccess(message.access);
        }
      },
    },
    setPeers,
  );
  const { roomTimer, timerBusy, clockOffsetMs, resetTimer } = timer;
  const getCurrentViewport = useCallback(() => presenceRef.current.viewport, [presenceRef]);
  const { following, setFollowing, stopFollowing, followedPeer, followedViewport } =
    useEditorFollowing({
      actorId: actor.id,
      peerId,
      peers,
      room: collaboration.room,
      area: canvasArea,
      busy: !!saveActivity.saving || editingBusy,
      getCurrentViewport,
      document: board,
      clockOffsetMs,
    });
  const refreshBoard = useCallback(
    async (id = activeRef.current) => {
      if (id === activeRef.current && !accessPending) {
        await collaboration.refresh();
      }
    },
    [collaboration, accessPending],
  );
  const setHistoryBusy = useCallback(
    (value: string) => {
      if (mounted.current) {
        setBusy(value);
      }
    },
    [setBusy],
  );
  const clearHistoryError = useCallback(() => setError(''), [setError]);
  const panels = useEditorPanels(panel, {
    history: {
      client,
      scope: viewRequests,
      revision: board?.artifact.revision,
      canEdit,
      operationBusy,
      setOperationBusy: setHistoryBusy,
      clearError: clearHistoryError,
      reportError: fail,
      inform,
      stopFollowing,
      getDocument: () => boardRef.current,
      acceptDocument: acceptBoard,
      refreshBoard,
    },
    sharing: {
      client,
      scope: viewRequests,
      authorityKey: shareAuthorityKey,
      access: session.access,
      setBusy,
      setError,
      reportFailure: fail,
      copyLink,
    },
    accessPending,
  });
  const { view: history, reset: resetHistory } = panels.history;
  const { preview, closePreview } = history;
  const {
    share,
    setShare,
    changeSharing,
    copyInvitation,
    clear: clearShare,
    updateAccess: updateShareAccess,
  } = panels.sharing;
  const { busy } = panels;
  const closePanel = useCallback(() => setPanel(null), [setPanel]);
  const feedbackPage = useEditorFeedback(panel, {
    activeId,
    actor,
    busy,
    canComment,
    canManage,
    client,
    historyPreview: Boolean(preview),
    readingDocument: reading && readingKind === 'document',
    scope: viewRequests,
    isMounted,
    attachContext,
    closePanel,
    closeHistoryPreview: closePreview,
    describeError: errorText,
    feedbackChanged: collaboration.feedbackChanged,
    getDocument: () => boardRef.current,
    inform,
    locateAnchor,
    refreshFeedback: collaboration.refreshFeedback,
    reportError: fail,
    setBusy,
    setError,
    stopFollowing,
  });
  const { suggestionPreview } = feedbackPage;
  const libraryPage = useStudioLibraryPage({
    client,
    previewClient: transportClient,
    ownerId,
    activeId,
    initialView,
    canManage,
    busy,
    setBusy,
    clearError: clearHistoryError,
    reportError: fail,
    describeError: errorText,
    inform,
    scope: viewRequests,
    isMounted,
    getDocument: () => boardRef.current,
    acceptDocument: acceptBoard,
    openArtifact,
    goHome,
    navigateHome: (view) => onNavigate?.(undefined, view),
    layout,
    resolvedTheme,
    changeLayout: handleLayoutChange,
    changeTheme: setTheme,
    copyLink,
    revealSharing(artifactId, state) {
      openArtifact(artifactId);
      setPanel('share');
      setShare(state);
      inform('仅查看邀请链接已停用，请在分享面板中启用。');
    },
  });
  const previewActive = Boolean(preview || suggestionPreview);
  const canReleaseAgentTasks = canManage && actor.kind === 'human' && !previewActive;
  const releaseAgentTask = useCallback(
    (target: AgentTaskReleaseTarget) => releaseAgentWorkspace(target, canReleaseAgentTasks),
    [releaseAgentWorkspace, canReleaseAgentTasks],
  );
  useLayoutEffect(() => {
    requestPresence.current = () => {
      const state = presenceRef.current;
      const area = canvasArea.current;
      collaboration.presence({
        context: {
          viewId: peerId,
          artifactId: activeId,
          selectedIds: state.selectedIds,
          viewport: state.viewport,
          surface: {
            w: area?.clientWidth || window.innerWidth,
            h: area?.clientHeight || window.innerHeight,
          },
          editingIds: state.editingIds,
          movingIds: state.movingIds,
          savingIds: state.savingIds,
          dirty: state.dirty,
          issues: state.issues,
        },
        following: state.following,
      });
    };

    return () => {
      requestPresence.current = null;
    };
  }, [activeId, collaboration, peerId, presenceRef]);

  useEffect(() => {
    presenceRef.current.selectedIds = selectedIds;
    requestPresence.current?.();
    publishViewContext();
  }, [activeId, selectedIds, publishViewContext, presenceRef]);
  useEffect(() => {
    presenceRef.current.following = followedPeer?.peerId || '';
    requestPresence.current?.();
  }, [followedPeer?.peerId, presenceRef]);
  useEffect(() => {
    collaboration.presence({ color: claimParticipantColor(session.actor, peerId, peers) });
  }, [collaboration, session.actor, peerId, peers]);
  const selectionChanged = useCallback(
    (ids: string[]) => {
      if (activeRef.current === activeId) {
        setSelectedIds(ids);
      }
    },
    [activeId, setSelectedIds],
  );
  const viewportChanged = useCallback(
    (viewport: Viewport) => {
      if (activeRef.current !== activeId) {
        return;
      }

      presenceRef.current.viewport = viewport;
      requestPresence.current?.();
      publishViewContext();
    },
    [activeId, presenceRef, publishViewContext],
  );
  const cursorMoved = useCallback(
    (cursor: { x: number; y: number } | null) => {
      if (activeRef.current !== activeId) {
        return;
      }

      const previous = presenceRef.current.cursor;
      if (cursor && previous) {
        const dx = Math.abs(cursor.x - previous.x);
        const dy = Math.abs(cursor.y - previous.y);
        if (dx < 0.002 && dy < 0.002) {
          return;
        }
      }

      presenceRef.current.cursor = cursor ? { ...cursor, t: Date.now(), surface: 'board' } : null;
      collaboration.presence({ cursor: presenceRef.current.cursor });
    },
    [activeId, collaboration, presenceRef],
  );
  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(''), 6000);

    return () => window.clearTimeout(timer);
  }, [notice]);

  function openArtifact(id: string, ready?: StudioDocument): void {
    if (!libraryPage.canOpenArtifact(id)) {
      return;
    }

    libraryPage.rememberDocument(boardRef.current);
    clearReadingRestore();
    setUnsupportedId('');
    onNavigate?.(id, 'editor');
    navigationSequence.current += 1;
    activeRef.current = id;
    boardRef.current = null;
    presenceRef.current = initialPresence();
    activitySources.current = { editor: emptyActivity(), toolbar: emptyActivity() };
    resetTimer();
    setSaveActivity({ dirty: false, saving: false, saveError: '' });
    setEditingBusy(false);
    publishViewContext();
    feedbackPage.resetRoute();
    setTargetViewport(undefined);
    setTargetSelection(undefined);
    setReading(false);
    clearShare();
    setActiveId(id);
    setBoard(null);
    feedbackPage.receiveFeedback([]);
    resetHistory();
    setPanel(null);
    setSelectedIds([]);
    setError('');
    libraryPage.closeMenu();
    setPeers([]);
    setFollowing('');
    if (ready) {
      acceptBoard(ready);
    }
  }

  function goHome(
    view: 'library' | 'trash' = libraryPage.view.data.filter === 'trash' ? 'trash' : 'library',
  ): void {
    libraryPage.rememberDocument(boardRef.current);
    clearReadingRestore();
    setUnsupportedId('');
    onNavigate?.(undefined, view);
    activeRef.current = '';
    boardRef.current = null;
    navigationSequence.current += 1;
    presenceRef.current = initialPresence();
    activitySources.current = { editor: emptyActivity(), toolbar: emptyActivity() };
    resetTimer();
    setSaveActivity({ dirty: false, saving: false, saveError: '' });
    setEditingBusy(false);
    publishViewContext();
    feedbackPage.resetRoute();
    setTargetViewport(undefined);
    setTargetSelection(undefined);
    setReading(false);
    clearShare();
    setActiveId('');
    setBoard(null);
    resetHistory();
    setPanel(null);
    setSelectedIds([]);
    setError('');
    setPeers([]);
    setFollowing('');
  }

  function closeCommentsPanel() {
    setPanel(null);
    feedbackPage.actions.collapseListedComment();
  }

  function togglePanel(next: Panel) {
    feedbackPage.changePanel(next === 'feedback');
    setPanel((previous) => (previous === next ? null : next));
  }

  function locateAnchor(
    anchor: Anchor,
    document = boardRef.current,
  ): { x: number; y: number } | undefined {
    if (!document) {
      return;
    }

    const location = locateEditorAnchor(document, anchor);
    const bounds =
      anchor.pin?.coordinateSpace === 'board'
        ? { x: anchor.pin.x, y: anchor.pin.y, w: 0, h: 0 }
        : location?.bounds;

    if (!bounds) {
      return;
    }

    const rect = canvasArea.current?.getBoundingClientRect();
    const width = rect?.width || 900;
    const height = rect?.height || 600;
    const zoom = Math.max(
      0.12,
      Math.min(1, (width - 100) / Math.max(1, bounds.w), (height - 120) / Math.max(1, bounds.h)),
    );
    setFollowing('');
    setTargetSelection([...(location?.ids ?? [])]);
    setTargetViewport({
      x: width / 2 - (bounds.x + bounds.w / 2) * zoom,
      y: height / 2 - (bounds.y + bounds.h / 2) * zoom,
      zoom,
    });

    return { x: (rect?.left || 0) + width / 2, y: (rect?.top || 60) + height / 2 };
  }

  const onCommentSurface = (anchor?: Anchor) =>
    !reading ||
    (readingKind === 'document' &&
      anchor?.coordinateSpace === 'document' &&
      anchor.pin?.coordinateSpace !== 'board');
  function commentPoint(anchor: Anchor, feedbackId?: string, fallback?: CommentPoint) {
    return liveCommentPoint(
      canvasArea.current,
      boardRef.current,
      anchor,
      presenceRef.current.viewport,
      feedbackId,
      fallback,
    );
  }

  async function copyLink(link: string, request: StudioViewScope = viewRequests.capture()) {
    try {
      await copyPlainText(link);
      if (viewRequests.isCurrent(request)) {
        inform('链接已复制。');
      }
    } catch (cause) {
      if (viewRequests.isCurrent(request)) {
        reportStudioWarning('即将打开手动复制对话框。', cause);
        setCopyFallback(link);
      }
    }
  }

  const product = getEditorProduct(board);
  const ProductEditor = product.Editor;
  const navigateFromHost = useEffectEvent((artifactId?: string, view?: string) => {
    if (artifactId) {
      if (activeRef.current !== artifactId) {
        openArtifact(artifactId);
      }
    } else {
      goHome(view === 'trash' ? 'trash' : 'library');
      libraryPage.setFilter(view === 'trash' ? 'trash' : 'recent');
    }
  });
  useEffect(() => {
    if (
      initialRoute.current.id === initialArtifactId &&
      initialRoute.current.view === initialView &&
      initialRoute.current.revision === navigationRevision
    ) {
      return;
    }

    initialRoute.current = {
      id: initialArtifactId,
      view: initialView,
      revision: navigationRevision,
    };
    navigateFromHost(initialArtifactId, initialView);
  }, [initialArtifactId, initialView, navigationRevision]);

  function handleTitleSubmit(artifactId: string, title: string) {
    const current = boardRef.current;
    if (!canManage || current?.artifact.id !== artifactId) {
      return;
    }

    if (title !== current.artifact.title) {
      libraryPage.renameArtifact(current.artifact, title);
    }
  }

  function handleFollow(id: string) {
    setTargetViewport(undefined);
    if (id) {
      setFollowing(id);
    } else {
      stopFollowing();
    }
  }

  function handleShareCopy(link: string | undefined, role?: 'editor' | 'commenter' | 'viewer') {
    if (role) {
      void copyInvitation(link, role).catch(fail);
    } else if (link) {
      void copyLink(link).catch(fail);
    }
  }

  const editor: StudioEditorViewProps = {
    data: {
      ProductEditor,
      productLabel: product.label,
      exportFormats: product.exportFormats,
      activeId,
      actor,
      board,
      client,
      busy,
      canComment,
      canEdit,
      canManage,
      sessionStatus: session.status,
      resolvedTheme,
      saveActivity,
      sync,
      panel,
      share,
      sessionShareAccess: session.access,
      history,
      suggestionPreview,
      previewing: previewActive,
      clockOffsetMs,
      following,
      followedPeer,
      peers,
      peerId,
      room: collaboration.room,
      roomTimer,
      timerBusy,
      readingSnapshotId,
      panelViewId: transportClient.embedded ? peerId : undefined,
      externalViewport: followedViewport || targetViewport,
      targetSelection,
      error,
      ...feedbackPage.data,
    },
    actions: {
      goHome: () => goHome(),
      submitTitle: handleTitleSubmit,
      changeTheme: setTheme,
      togglePanel,
      closePanel,
      handleFollow,
      stopFollowing,
      releaseAgentTask: canReleaseAgentTasks ? releaseAgentTask : undefined,
      changeSharing,
      handleCopy: handleShareCopy,
      exportBoard: (format) => void libraryPage.exportBoard(format).catch(fail),
      refreshBoard: () => void refreshBoard().catch(fail),
      handleCanvasArea,
      acceptBoard,
      editorActivityChanged,
      selectionChanged,
      viewportChanged,
      cursorMoved,
      readingChanged,
      changeTimer: (action, durationSeconds, deltaSeconds) =>
        void timer
          .changeTimer(
            collaboration.timer,
            canEdit,
            { action, durationSeconds, deltaSeconds },
            fail,
          )
          .catch(fail),
      fail,
      inform,
      ...feedbackPage.actions,
      onCommentSurface,
      commentPoint,
      closeCommentsPanel,
    },
  };

  return {
    accessPending,
    activeId,
    attachmentNotice: feedbackPage.attachmentNotice,
    copyFallback,
    editor,
    error,
    fail,
    library: libraryPage.view,
    notice,
    operationNoticeTarget,
    panel,
    peerId,
    previewActive,
    purgeDialog: libraryPage.purgeDialog,
    reading,
    readingKind,
    renameDialog: libraryPage.renameDialog,
    resolvedTheme,
    retry,
    selectFeedback: feedbackPage.actions.selectFeedback,
    session,
    dismissAttachmentNotice: feedbackPage.dismissAttachmentNotice,
    setCopyFallback,
    setError,
    setNotice,
    setOperationNoticeTarget,
    studioRoot,
    unsupportedId,
    onUnsupportedBack: canManage ? () => goHome('library') : undefined,
  };
}

type StudioShellProps = { state: ReturnType<typeof useStudioApp> };

function StudioFrame({ state }: StudioShellProps) {
  const {
    accessPending,
    activeId,
    copyFallback,
    operationNoticeTarget,
    peerId,
    previewActive,
    purgeDialog,
    reading,
    readingKind,
    renameDialog,
    resolvedTheme,
    session,
    setCopyFallback,
    studioRoot,
  } = state;

  return (
    <OperationNoticeTarget.Provider value={previewActive ? null : operationNoticeTarget}>
      <div
        ref={studioRoot}
        className={`studio ${activeId ? 'studio-editor' : 'studio-library'}${session.status === 'denied' ? ' studio-session-denied' : ''}${reading && readingKind === 'canvas' ? ' studio-reading' : ''}${reading && readingKind === 'document' ? ' studio-document-reading' : ''}`}
        data-session-status={session.status}
        data-studio-theme={resolvedTheme}
        data-studio-view-id={activeId && session.status !== 'denied' ? peerId : undefined}
      >
        <SessionNotice
          status={session.status}
          reason={session.reason}
          onRetry={() => void session.check().catch(state.fail)}
        />
        <div
          className="studio-session-content"
          hidden={session.status === 'denied'}
          aria-hidden={session.status === 'denied' ? true : undefined}
          inert={accessPending}
        >
          <StudioNotifications state={state} />
          <StudioRoute state={state} />
          {purgeDialog && <StudioPurgeDialog {...purgeDialog} />}
          {copyFallback && (
            <StudioDialog title="手动复制链接" onClose={() => setCopyFallback('')}>
              <p>浏览器未能自动复制，请复制下面的邀请链接。</p>
              <input
                className="studio-text-field"
                aria-label="邀请链接"
                readOnly
                value={copyFallback}
                onFocus={(event) => event.currentTarget.select()}
                autoFocus
              />
              <div className="studio-modal-footer">
                <button className="studio-button" onClick={() => setCopyFallback('')}>
                  完成
                </button>
              </div>
            </StudioDialog>
          )}
          {renameDialog && <StudioRenameDialog {...renameDialog} />}
        </div>
      </div>
    </OperationNoticeTarget.Provider>
  );
}

function StudioNotifications({ state }: StudioShellProps) {
  const {
    attachmentNotice,
    error,
    notice,
    panel,
    reading,
    retry,
    selectFeedback,
    dismissAttachmentNotice,
    setError,
    setNotice,
    setOperationNoticeTarget,
  } = state;
  function handleRetry() {
    setError('');
    retry?.();
  }

  function handleViewAttachment() {
    if (!attachmentNotice) {
      return;
    }

    selectFeedback(attachmentNotice);
    dismissAttachmentNotice();
  }

  return (
    <>
      <div
        ref={setOperationNoticeTarget}
        className="studio-operation-notices"
        role="region"
        aria-label="操作通知"
      >
        {error && (
          <div className="studio-error" role="alert">
            <AlertCircle size={17} />
            <span>{error}</span>
            {retry && <button onClick={handleRetry}>重试</button>}
            <button
              className="studio-icon-button"
              aria-label="关闭错误提示"
              onClick={() => setError('')}
            >
              <X size={15} />
            </button>
          </div>
        )}
      </div>
      {notice && (
        <div className="studio-notice" role="status">
          <Check size={15} />
          {notice}
          <button
            className="studio-icon-button"
            aria-label="关闭通知"
            onClick={() => setNotice('')}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {attachmentNotice && !reading && panel !== 'feedback' && (
        <div className="studio-attachment-notice" role="status">
          <MessageSquare size={16} />
          <span>
            {attachmentNotice.attachment?.requestedBy.name ||
              attachmentNotice.author.name ||
              '协作者'}{' '}
            请求附加备注到对话
          </span>
          <button
            className="studio-link-button"
            aria-label="查看待附加备注"
            onClick={handleViewAttachment}
          >
            查看
          </button>
          <button
            className="studio-icon-button"
            aria-label="关闭附加请求提醒"
            onClick={() => dismissAttachmentNotice()}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}

function StudioRoute({ state }: StudioShellProps) {
  const { activeId, unsupportedId, library, editor, onUnsupportedBack, reading, readingKind } =
    state;

  if (!activeId) {
    return <StudioLibraryView {...library} />;
  }
  if (unsupportedId === activeId) {
    return <StudioUnsupportedArtifact onBack={onUnsupportedBack} />;
  }

  const documentFocusActive = reading && readingKind === 'document';

  return <StudioEditorView {...editor} documentFocusActive={documentFocusActive} />;
}

export default function StudioApp(props: StudioAppProps) {
  const state = useStudioApp(props);

  return <StudioFrame state={state} />;
}
