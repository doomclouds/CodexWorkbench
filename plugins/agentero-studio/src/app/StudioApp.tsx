import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SubmitEvent,
} from 'react';
import { OperationNoticeTarget } from './shared/OperationNotice.js';
import { AlertCircle, Check, MessageSquare, X } from 'lucide-react';
import {
  STUDIO_TOOLS,
  type Actor,
  type AgentTaskReleaseTarget,
  type Anchor,
  type Artifact,
  type Feedback,
  type HistoryBatch,
  type HistoryEntry,
  type Operation,
  type Presence,
  type RoomTimer,
  type StudioClient,
  type ViewContext,
} from '../contracts/studio';
import {
  getProduct,
  products,
  type ProductActivity,
  type ProductAnnotation,
  type StudioDocument,
  type Viewport,
} from './products';
import { StudioDialog } from './products/dialog';
import { isAttachmentPending } from './shared/comments/attachment';
import { studioRequest, downloadStudioFile, reportStudioWarning } from './transport';
import './studio.css';
import './editor-shell.css';
import type { ProposalOperation } from '../contracts/proposals';
import { type EditorShareState, type TimerAction } from './shared/editor-panels';
import type { HistoryUnitDiff } from './shared/editor-panels/history-diff';
import { type CommentAction, type CommentActionArguments } from './shared/comments/CommentThread';
import {
  describeCommentTarget,
  liveCommentPoint,
  type CommentPoint,
} from './shared/comments/comment-target';
import { copyPlainText } from './clipboard';
import { newClientId } from './shared/client-id';
import { isAuthenticationFailure, useStudioSession } from './shared/useStudioSession';
import { SessionNotice, useSessionVisibility } from './shared/SessionNotice';
import { claimParticipantColor } from './shared/presence-members';
import { useCollaboration } from './shared/useCollaboration';
import { useViewportFollow } from './shared/useViewportFollow';
import { storePanelReadingView, type RestoredPanelView } from './panel-view-state';
import { useLibraryPreviews } from './library-preview';
import {
  StudioLibraryView,
  StudioUnsupportedArtifact,
  StudioPurgeDialog,
  StudioRenameDialog,
  type LibraryArtifactAction,
  type LibraryFilter,
  type PurgeConfirmation,
  type StudioLibraryViewProps,
  type StudioPurgeDialogProps,
  type StudioRenameDialogProps,
} from './StudioLibraryView';
import {
  StudioEditorView,
  type CommentSelection,
  type EditorPanel,
  type StudioEditorViewProps,
} from './StudioEditorView';

export interface StudioAppProps {
  client: StudioClient;
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

type Theme = 'system' | 'light' | 'dark';

interface ShareState extends EditorShareState {
  [key: string]: unknown;
}

interface ListResult {
  artifacts: Artifact[];
  nextCursor?: string;
}

interface ManageResult {
  artifact: Artifact;
  board?: StudioDocument;
}

interface PurgeFailure {
  artifactId: string;
  code: string;
  message: string;
}

interface PurgeResult {
  deletedIds: string[];
  failures: PurgeFailure[];
}

interface ArtifactRename {
  artifact: Artifact;
  title: string;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.)$/i.test(
    message,
  )
    ? '无法连接作品服务，请重试或重新打开页面。'
    : message;
}

function attachmentResult(attached: boolean, owner: boolean, queuedMessage: string): string {
  if (attached) {
    return '已附加到对话。';
  }
  if (owner) {
    return '请求已保留，请从 Codex 打开白板后附加到对话。';
  }

  return queuedMessage;
}

function savedPreference<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const value = localStorage.getItem(key) as T;

    return allowed.includes(value) ? value : fallback;
  } catch (cause) {
    reportStudioWarning('无法读取 Studio 偏好设置。', cause);

    return fallback;
  }
}

function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch (cause) {
    reportStudioWarning('无法保存 Studio 偏好设置。', cause);
  }
}

function systemTheme(
  media = window.matchMedia?.('(prefers-color-scheme: dark)'),
): 'light' | 'dark' {
  const host = document.documentElement.dataset.theme;
  if (host === 'dark' || host === 'light') {
    return host;
  }

  return media?.matches ? 'dark' : 'light';
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

function appendLibraryPage(previous: Artifact[], incoming: Artifact[]) {
  const loaded = new Set(previous.map((artifact) => artifact.id));

  return [...previous, ...incoming.filter((artifact) => !loaded.has(artifact.id))];
}

function useStudioTrash(
  activeId: string,
  filter: LibraryFilter,
  query: string,
  artifacts: Artifact[],
) {
  const [trashSelection, setTrashSelection] = useState<string[]>([]);
  const [purgeConfirmation, setPurgeConfirmation] = useState<PurgeConfirmation | null>(null);
  const [purgeFailures, setPurgeFailures] = useState<(PurgeFailure & { title: string })[]>([]);
  const [purgeError, setPurgeError] = useState('');
  const purgeRunning = useRef(false);
  const [trashInputs, setTrashInputs] = useState({
    activeId,
    filter,
    query,
    artifacts,
    purgeFailures,
  });

  if (
    trashInputs.activeId !== activeId ||
    trashInputs.filter !== filter ||
    trashInputs.query !== query
  ) {
    const failures: typeof purgeFailures = [];
    setTrashInputs({ activeId, filter, query, artifacts, purgeFailures: failures });
    setTrashSelection([]);
    setPurgeFailures(failures);
    setPurgeError('');
    setPurgeConfirmation(null);
  } else if (trashInputs.artifacts !== artifacts || trashInputs.purgeFailures !== purgeFailures) {
    setTrashInputs({ activeId, filter, query, artifacts, purgeFailures });
    const retained = new Set([
      ...artifacts.filter((item) => item.trashedAt).map((item) => item.id),
      ...purgeFailures.map((item) => item.artifactId),
    ]);
    const selection = trashSelection.filter((id) => retained.has(id));
    if (selection.length !== trashSelection.length) {
      setTrashSelection(selection);
    }
  }

  return {
    trashSelection,
    setTrashSelection,
    purgeConfirmation,
    setPurgeConfirmation,
    purgeFailures,
    setPurgeFailures,
    purgeError,
    setPurgeError,
    purgeRunning,
  };
}

function useAttachmentNotice(activeId: string, feedback: Feedback[], actor: Actor, panel: Panel) {
  const [attachmentNoticeId, setAttachmentNoticeId] = useState('');
  const canReceiveAttachments = actor.role === 'owner' && actor.kind === 'human';
  const pendingAttachments = canReceiveAttachments
    ? feedback.filter((item) => item.artifactId === activeId && isAttachmentPending(item))
    : [];
  const [attachmentInput, setAttachmentInput] = useState({
    activeId,
    feedback,
    canReceiveAttachments,
    actorId: actor.id,
    requests: new Set<string>(),
  });
  const inputChanged =
    attachmentInput.activeId !== activeId || attachmentInput.feedback !== feedback;
  const authorityChanged =
    attachmentInput.canReceiveAttachments !== canReceiveAttachments ||
    attachmentInput.actorId !== actor.id;

  if (inputChanged || authorityChanged) {
    const sameArtifact = attachmentInput.activeId === activeId;
    const requests = sameArtifact ? new Set(attachmentInput.requests) : new Set<string>();
    let nextNotice = sameArtifact ? attachmentNoticeId : '';
    for (const item of pendingAttachments) {
      const key = `${item.id}:${item.attachment?.requestId || 'legacy'}`;
      if (requests.has(key)) {
        continue;
      }

      requests.add(key);
      const requester = item.attachment?.requestedBy || item.author;
      if (panel !== 'feedback' && (requester.kind !== actor.kind || requester.id !== actor.id)) {
        nextNotice = item.id;
      }
    }

    setAttachmentInput({ activeId, feedback, canReceiveAttachments, actorId: actor.id, requests });
    if (nextNotice !== attachmentNoticeId) {
      setAttachmentNoticeId(nextNotice);
    }
  }

  const attachmentNotice = pendingAttachments.find((item) => item.id === attachmentNoticeId);
  useEffect(() => {
    if (!attachmentNoticeId) {
      return;
    }

    const timer = window.setTimeout(() => setAttachmentNoticeId(''), 8000);

    return () => window.clearTimeout(timer);
  }, [attachmentNoticeId]);

  return { attachmentNotice, pendingAttachments, setAttachmentNoticeId };
}

function useStudioPreferences() {
  const [layout, updateLayout] = useState<'grid' | 'list'>(() =>
    savedPreference('agentero-studio-view', 'grid', ['grid', 'list']),
  );
  const [theme, setTheme] = useState<Theme>(() =>
    savedPreference('agentero-studio-theme', 'system', ['system', 'light', 'dark']),
  );
  const [preferredSystemTheme, setPreferredSystemTheme] = useState(systemTheme);
  const resolvedTheme = theme === 'system' ? preferredSystemTheme : theme;
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const update = () => setPreferredSystemTheme(systemTheme(media));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    media?.addEventListener?.('change', update);

    return () => {
      observer.disconnect();
      media?.removeEventListener?.('change', update);
    };
  }, []);

  useEffect(() => {
    savePreference('agentero-studio-theme', theme);
  }, [theme]);

  function handleLayoutChange(value: 'grid' | 'list') {
    updateLayout(value);
    savePreference('agentero-studio-view', value);
  }

  return { layout, handleLayoutChange, setTheme, resolvedTheme };
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

function studioProduct(board: StudioDocument | null) {
  return getProduct(board?.artifact.type || products[0]!.id)!;
}

function findActiveFeedback(
  feedback: Feedback[],
  selection: { id: string; inList?: boolean } | null,
  panel: Panel,
) {
  if (!selection || (selection.inList && panel !== 'feedback')) {
    return undefined;
  }

  return feedback.find((item) => item.id === selection.id);
}

function useStudioApp({
  client: transportClient,
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
  const session = useStudioSession(transportClient, initialActor, activeId);
  const { client } = session;
  const accessPending = session.status !== 'valid';
  const actor: Actor = accessPending ? { ...session.actor, role: 'viewer' } : session.actor;
  const { ownerId, canManage, canComment, canEdit } = studioPermissions(actor);
  const { previews, rememberPreview, forgetPreviews } = useLibraryPreviews(
    transportClient,
    ownerId,
  );
  const studioRoot = useRef<HTMLDivElement>(null);
  useSessionVisibility(studioRoot, session.status);
  const activeRef = useRef(activeId);
  const initialRoute = useRef({
    id: initialArtifactId,
    view: initialView,
    revision: navigationRevision,
  });
  const [board, setBoard] = useState<StudioDocument | null>(null);
  const [suggestionPreview, setSuggestionPreview] = useState<StudioDocument | null>(null);
  const suggestionSequence = useRef(0);
  const boardRef = useRef<StudioDocument | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [filter, setFilter] = useState<LibraryFilter>(initialView === 'trash' ? 'trash' : 'recent');
  const [query, setQuery] = useState('');
  const { layout, handleLayoutChange, setTheme, resolvedTheme } = useStudioPreferences();
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState('');
  const [operationNoticeTarget, setOperationNoticeTarget] = useState<HTMLDivElement | null>(null);
  const [unsupportedId, setUnsupportedId] = useState('');
  const [notice, setNotice] = useState('');
  const [copyFallback, setCopyFallback] = useState('');
  const [operationBusy, setBusy] = useState('');
  const [previewBusy, setPreviewBusy] = useState('');
  const busy = operationBusy || previewBusy;
  const [sync, setSync] = useState<'loading' | 'saved' | 'reconnecting'>('loading');
  const [saveActivity, setSaveActivity] = useState<
    Pick<ProductActivity, 'dirty' | 'saving' | 'saveError'>
  >({ dirty: false, saving: false, saveError: '' });
  const [editingBusy, setEditingBusy] = useState(false);
  const [menuId, setMenuId] = useState('');
  const {
    trashSelection,
    setTrashSelection,
    purgeConfirmation,
    setPurgeConfirmation,
    purgeFailures,
    setPurgeFailures,
    purgeError,
    setPurgeError,
    purgeRunning,
  } = useStudioTrash(activeId, filter, query, artifacts);
  const [rename, setRename] = useState<ArtifactRename | null>(null);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [attachingId, setAttachingId] = useState('');
  const attachmentInFlight = useRef(false);
  const acceptedAttachments = useRef(new Set<string>());
  const [feedbackText, setFeedbackText] = useState('');
  const [annotation, setAnnotation] = useState<ProductAnnotation | null>(null);
  const [commentOpen, setCommentOpen] = useState(false);
  const [annotationActive, setAnnotationActive] = useState(false);
  const [attachComment, setAttachComment] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [savedComment, setSavedComment] = useState<Feedback | null>(null);
  const [selectedFeedback, setSelectedFeedback] = useState<CommentSelection | null>(null);
  const commentPending = useRef<{
    fingerprint: string;
    args: Record<string, unknown>;
    created?: Feedback;
  } | null>(null);
  const commentSubmitting = useRef(false);
  const canvasArea = useRef<HTMLDivElement>(null);
  const handleCanvasArea = useCallback((node: HTMLDivElement | null) => {
    canvasArea.current = node;
  }, []);
  const [reading, setReading] = useState(false);
  const [readingKind, setReadingKind] = useState<'canvas' | 'document'>('canvas');
  const readingChanged = useCallback((active: boolean, kind: 'canvas' | 'document' = 'canvas') => {
    setReading(active);
    setReadingKind(kind);
  }, []);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const replyAttempts = useRef(new Map<string, { text: string; replyId: string }>());
  const [showResolved, setShowResolved] = useState(false);
  const [history, setHistory] = useState<HistoryBatch[]>([]);
  const [preview, setPreview] = useState<{ board: StudioDocument; version: HistoryEntry } | null>(
    null,
  );
  const [previewRestoreOpen, setPreviewRestoreOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [share, setShare] = useState<ShareState | null>(null);
  const shareSequence = useRef(0);
  const shareAuthorityKey = `${session.actor.id}:${session.actor.role}:${session.status}`;
  useLayoutEffect(() => {
    shareSequence.current += 1;
  }, [shareAuthorityKey]);
  const listSequence = useRef(0);
  const navigationSequence = useRef(0);
  const previewSequence = useRef(0);
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const mounted = useRef(true);

  const [peerId] = useState(() => newId('view'));
  useEffect(() => {
    if (!activeId && transportClient.embedded) {
      storePanelReadingView(peerId, null);
    }
  }, [activeId, peerId, transportClient.embedded]);
  const [peers, setPeers] = useState<Presence[]>([]);
  const [following, setFollowing] = useState('');
  const [roomTimer, setRoomTimer] = useState<RoomTimer | null>(null);
  const [timerBusy, setTimerBusy] = useState(false);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const activitySources = useRef({ editor: emptyActivity(), toolbar: emptyActivity() });
  const requestPresence = useRef<(() => void) | null>(null);
  const { attachmentNotice, pendingAttachments, setAttachmentNoticeId } = useAttachmentNotice(
    activeId,
    feedback,
    actor,
    panel,
  );
  const previewActive = Boolean(preview || suggestionPreview);
  const canReleaseAgentTasks = canManage && actor.kind === 'human' && !previewActive;
  const releaseAgentTask = useCallback(
    async (target: AgentTaskReleaseTarget) => {
      if (!canReleaseAgentTasks || target.artifactId !== activeRef.current) {
        throw new Error('当前界面不能结束此工作区。');
      }

      await client.call(STUDIO_TOOLS.activity, { action: 'release', ...target });
    },
    [client, canReleaseAgentTasks],
  );
  const changeAnnotationMode = useCallback(
    (active: boolean) => {
      const next = active && canComment && !preview && !suggestionPreview;
      setAnnotationActive(next);
      if (next) {
        setPanel(null);
        if (annotation && feedbackText.trim()) {
          setCommentOpen(true);
        }
      } else {
        setCommentOpen(false);
        setSelectedFeedback(null);
      }
    },
    [canComment, preview, suggestionPreview, annotation, feedbackText],
  );
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
  const inform = useCallback((message: string) => {
    setNotice(message);
  }, []);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (
        !(event.target as Element | null)?.closest(
          '.studio-menu-anchor, .studio-library-floating-menu',
        )
      ) {
        setMenuId('');
      }
    };

    document.addEventListener('pointerdown', close);

    return () => {
      document.removeEventListener('pointerdown', close);
    };
  }, []);

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

  const collaboration = useCollaboration({
    client,
    polling: !!transportClient.request,
    artifactId: activeId,
    peerId,
    enabled: !!activeId && !accessPending && unsupportedId !== activeId,
    getDocument: () => boardRef.current,
    onDocument: acceptBoard,
    onFeedback: setFeedback,
    onPresence: (nextPeers, nextTimer) => {
      setPeers(nextPeers);
      setRoomTimer(nextTimer);
    },
    onClock: setClockOffsetMs,
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
        setShare(null);
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
        shareSequence.current += 1;
        session.updateAccess(message.access);
        if (
          message.reason === 'role-changed' &&
          Array.isArray(message.revokedMemberIds) &&
          message.revokedMemberIds.includes(session.actor.id)
        ) {
          void session.check('role-changed').catch(fail);
        }

        setShare((previous) =>
          previous && (message.access === 'local' || message.access === 'lan')
            ? { ...previous, access: message.access }
            : previous,
        );
      }
    },
  });
  const stopFollowMotion = useRef<(() => void) | undefined>(undefined);
  const stopFollowing = useCallback(() => {
    stopFollowMotion.current?.();
    setFollowing('');
  }, []);
  const getCurrentViewport = useCallback(() => presenceRef.current.viewport, [presenceRef]);
  const follow = useViewportFollow({
    actorId: actor.id,
    peerId,
    peers,
    following,
    room: collaboration.room,
    area: canvasArea,
    busy: !!saveActivity.saving || editingBusy,
    onStop: stopFollowing,
    getCurrentViewport,
    document: board,
    clockOffsetMs,
  });
  useLayoutEffect(() => {
    stopFollowMotion.current = follow.stop;
  }, [follow.stop]);
  const followedPeer = follow.peer;
  const refreshBoard = useCallback(
    async (id = activeRef.current) => {
      if (id === activeRef.current && !accessPending) {
        await collaboration.refresh();
      }
    },
    [collaboration, accessPending],
  );
  const acceptFeedback = useCallback(
    (next: Feedback[], changedId: string) => {
      collaboration.feedbackChanged();

      setFeedback((previous) => {
        const changed = next.find((item) => item.id === changedId);
        const current = previous.find((item) => item.id === changedId);
        if (!changed) {
          return previous.filter((item) => item.id !== changedId);
        }
        if (!current) {
          return [...previous, changed];
        }
        if (current.updatedAt > changed.updatedAt) {
          return previous;
        }

        return previous.map((item) => (item.id === changedId ? changed : item));
      });
      collaboration.refreshFeedback();
    },
    [collaboration],
  );
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

  const loadLibrary = useCallback(
    async (cursor?: string) => {
      const serial = ++listSequence.current;
      setLibraryLoading(true);
      try {
        const result = await client.call<ListResult>(STUDIO_TOOLS.list, {
          query: query.trim(),
          trashed: filter === 'trash',
          pinned: filter === 'pinned' ? true : undefined,
          limit: 60,
          cursor,
        });

        if (!mounted.current || serial !== listSequence.current) {
          return;
        }

        setArtifacts((previous) =>
          cursor ? appendLibraryPage(previous, result.artifacts) : result.artifacts,
        );
        setNextCursor(result.nextCursor);
        setLibraryLoaded(true);
      } catch (cause) {
        if (serial === listSequence.current) {
          fail(cause, () => {
            void loadLibrary(cursor).catch(fail);
          });
        }
      } finally {
        if (mounted.current && serial === listSequence.current) {
          setLibraryLoading(false);
        }
      }
    },
    [client, fail, filter, query],
  );

  useEffect(() => {
    if (activeId || !canManage) {
      return;
    }

    const timer = window.setTimeout(
      () => {
        void loadLibrary().catch(fail);
      },
      query ? 180 : 0,
    );

    return () => {
      window.clearTimeout(timer);
      listSequence.current += 1;
    };
  }, [activeId, canManage, loadLibrary, query, fail]);

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
  async function changeTimer(action: TimerAction, durationSeconds?: number, deltaSeconds?: number) {
    if (!canEdit || timerBusy) {
      return;
    }

    setTimerBusy(true);
    try {
      await collaboration.timer({
        action,
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
        ...(deltaSeconds !== undefined ? { deltaSeconds } : {}),
      });
    } catch (cause) {
      fail(cause);
    } finally {
      if (mounted.current) {
        setTimerBusy(false);
      }
    }
  }

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(''), 6000);

    return () => window.clearTimeout(timer);
  }, [notice]);

  const loadHistory = useCallback(async () => {
    const id = activeRef.current;
    if (!id) {
      return;
    }

    setHistoryLoading(true);
    try {
      const result = await client.call(STUDIO_TOOLS.read, {
        artifactId: id,
        mode: 'history',
      });

      if (activeRef.current === id && mounted.current) {
        setHistory([...result.batches].sort((a, b) => b.revision - a.revision));
      }
    } catch (cause) {
      fail(cause, () => {
        void loadHistory().catch(fail);
      });
    } finally {
      if (mounted.current && activeRef.current === id) {
        setHistoryLoading(false);
      }
    }
  }, [client, fail]);
  const loadShare = useCallback(async () => {
    const id = activeRef.current;
    if (!id || busy === 'share') {
      return;
    }

    const serial = ++shareSequence.current;
    try {
      const result = await client.call<ShareState>(STUDIO_TOOLS.share, {
        action: 'status',
        artifactId: id,
      });

      if (activeRef.current === id && mounted.current && serial === shareSequence.current) {
        setShare(result);
      }
    } catch (cause) {
      fail(cause, () => {
        void loadShare().catch(fail);
      });
    }
  }, [client, fail, busy]);
  useEffect(() => {
    if (panel === 'history') {
      void loadHistory().catch(fail);
    }
  }, [panel, board?.artifact.revision, loadHistory, fail]);
  useEffect(() => {
    if (panel !== 'share' || accessPending) {
      return;
    }

    void loadShare().catch(fail);
    const refresh = () => {
      if (document.visibilityState !== 'hidden') {
        void loadShare().catch(fail);
      }
    };

    const timer = window.setInterval(refresh, 4000);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [panel, loadShare, accessPending, canManage, session.access, fail]);

  function rememberCurrentPreview() {
    const current = boardRef.current;
    if (!canManage || !current || current.artifact.trashedAt) {
      return;
    }

    const preview = getProduct(current.artifact.type)?.projectLibraryPreview?.(current);
    if (preview) {
      rememberPreview(current.artifact.id, preview);
    }
  }

  function openArtifact(id: string, ready?: StudioDocument) {
    if (artifacts.some((item) => item.id === id && item.storageStatus === 'unsupported')) {
      return;
    }

    rememberCurrentPreview();
    clearReadingRestore();
    setUnsupportedId('');
    onNavigate?.(id, 'editor');
    navigationSequence.current += 1;
    activeRef.current = id;
    boardRef.current = null;
    presenceRef.current = initialPresence();
    activitySources.current = { editor: emptyActivity(), toolbar: emptyActivity() };
    setRoomTimer(null);
    setTimerBusy(false);
    setSaveActivity({ dirty: false, saving: false, saveError: '' });
    setEditingBusy(false);
    publishViewContext();
    resetComment();
    setAnnotationActive(false);
    setTargetViewport(undefined);
    setTargetSelection(undefined);
    setReading(false);
    setShare(null);
    setHistory([]);
    setActiveId(id);
    setBoard(null);
    setFeedback([]);
    closePreview();
    setSuggestionPreview(null);
    suggestionSequence.current += 1;
    setPanel(null);
    setSelectedIds([]);
    setAnnotation(null);
    setError('');
    setMenuId('');
    setPeers([]);
    setFollowing('');
    if (ready) {
      acceptBoard(ready);
    }
  }

  function goHome(view: 'library' | 'trash' = filter === 'trash' ? 'trash' : 'library') {
    rememberCurrentPreview();
    clearReadingRestore();
    setUnsupportedId('');
    onNavigate?.(undefined, view);
    activeRef.current = '';
    boardRef.current = null;
    navigationSequence.current += 1;
    presenceRef.current = initialPresence();
    activitySources.current = { editor: emptyActivity(), toolbar: emptyActivity() };
    setRoomTimer(null);
    setTimerBusy(false);
    setSaveActivity({ dirty: false, saving: false, saveError: '' });
    setEditingBusy(false);
    publishViewContext();
    resetComment();
    setAnnotationActive(false);
    setTargetViewport(undefined);
    setTargetSelection(undefined);
    setReading(false);
    setActiveId('');
    setBoard(null);
    closePreview();
    setSuggestionPreview(null);
    suggestionSequence.current += 1;
    setPanel(null);
    setAnnotation(null);
    setSelectedIds([]);
    setError('');
    setPeers([]);
    setFollowing('');
  }

  function changeLibraryFilter(value: LibraryFilter) {
    setFilter(value);
    setMenuId('');
    onNavigate?.(undefined, value === 'trash' ? 'trash' : 'library');
  }

  async function importArchive(file: File) {
    if (!canManage || busy) {
      return;
    }

    if (file.size > 128 * 1024 * 1024) {
      fail(new Error('作品备份超过 128 MB。'));

      return;
    }

    const navigation = navigationSequence.current;
    setBusy('import');
    setError('');
    try {
      const response = await studioRequest(client, `${client.baseUrl}/api/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${client.token}`, 'Content-Type': 'application/zip' },
        body: file,
      });
      const result = (await response.json()) as {
        ok: boolean;
        data?: ManageResult & { document?: StudioDocument };
        error?: { message?: string };
      };

      if (!result.ok || !result.data) {
        throw new Error(result.error?.message || '作品备份未能导入。');
      }
      if (!mounted.current) {
        return;
      }

      if (navigation !== navigationSequence.current) {
        inform('作品已导入，可从作品中心打开。');

        return;
      }

      openArtifact(result.data.artifact.id, result.data.document || result.data.board);
      inform('作品已导入，原作品保持完整。');
    } catch (cause) {
      fail(cause);
    } finally {
      if (mounted.current) {
        setBusy('');
      }
    }
  }

  async function createBoard(productId = products[0]!.id) {
    const product = getProduct(productId);
    if (!product) {
      return;
    }
    if (busy) {
      return;
    }

    const navigation = navigationSequence.current;
    setBusy('create');
    setError('');
    try {
      const result = await client.call<ManageResult>(STUDIO_TOOLS.manage, {
        action: 'create',
        type: product.id,
        title: product.defaultTitle,
      });

      if (!mounted.current) {
        return;
      }

      if (navigation === navigationSequence.current) {
        openArtifact(result.artifact.id, result.board);
      } else {
        inform('作品已创建，可从作品中心打开。');
      }
    } catch (cause) {
      fail(cause, () => {
        void createBoard().catch(fail);
      });
    } finally {
      if (mounted.current) {
        setBusy('');
      }
    }
  }

  function finishDuplicate(result: ManageResult, navigation: number) {
    if (!mounted.current) {
      return;
    }

    if (navigation === navigationSequence.current) {
      openArtifact(result.artifact.id, result.board);
      return;
    }
    inform('作品已复制，可从作品中心打开。');
  }

  async function manageArtifact(
    action: string,
    artifact: Artifact,
    extra: Record<string, unknown> = {},
  ) {
    if (busy) {
      return;
    }

    const navigation = navigationSequence.current;
    setBusy(`${action}:${artifact.id}`);
    setError('');
    setMenuId('');
    try {
      const result = await client.call<ManageResult>(STUDIO_TOOLS.manage, {
        action,
        artifactId: artifact.id,
        ...extra,
      });

      if (result.board) {
        acceptBoard(result.board);
      } else if (
        boardRef.current?.artifact.id === artifact.id &&
        result.artifact.revision >= boardRef.current.artifact.revision
      ) {
        acceptBoard({ ...boardRef.current, artifact: result.artifact });
      }
      if (action === 'duplicate') {
        finishDuplicate(result, navigation);

        return;
      }
      if (action === 'trash') {
        if (activeRef.current === artifact.id) {
          goHome();
        }
        forgetPreviews([artifact.id]);
      }
      if (!activeRef.current) {
        await loadLibrary();
      }
      if (action === 'trash') {
        inform(
          artifact.storageStatus === 'unsupported'
            ? '已移入回收站。'
            : '已移入回收站，可以随时恢复。',
        );
      }
      if (action === 'restore') {
        inform('作品已恢复。');
      }
      if (action === 'rename') {
        setRename(null);
      }
    } catch (cause) {
      fail(cause, () => {
        void manageArtifact(action, artifact, extra).catch(fail);
      });
    } finally {
      if (mounted.current) {
        setBusy('');
      }
    }
  }

  function confirmPurge(ids: readonly string[]) {
    if (busy || !canManage) {
      return;
    }

    const unique = [...new Set(ids)];
    if (!unique.length) {
      return;
    }

    setPurgeError('');
    setPurgeConfirmation({
      targets: unique.map((id) => ({
        id,
        title:
          artifacts.find((item) => item.id === id)?.title ||
          purgeFailures.find((item) => item.artifactId === id)?.title ||
          id,
      })),
      all: false,
    });
  }

  async function prepareEmptyTrash() {
    if (busy || !canManage) {
      return;
    }

    setBusy('prepare-purge');
    setPurgeError('');
    try {
      const targets = new Map<string, { id: string; title: string }>();
      let cursor: string | undefined;
      do {
        const result = await client.call<ListResult>(STUDIO_TOOLS.list, {
          trashed: true,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        result.artifacts.forEach((item) =>
          targets.set(item.id, { id: item.id, title: item.title }),
        );
        cursor = result.nextCursor;
      } while (cursor);

      if (mounted.current) {
        if (targets.size) {
          setPurgeConfirmation({ targets: [...targets.values()], all: true });
        } else {
          inform('回收站已经为空。');
        }
      }
    } catch (cause) {
      if (mounted.current) {
        setPurgeError(errorText(cause));
      }
    } finally {
      if (mounted.current) {
        setBusy('');
      }
    }
  }

  async function purgeArtifacts() {
    const confirmation = purgeConfirmation;
    const purgeInProgress = busy || purgeRunning.current;
    if (!confirmation || purgeInProgress || !canManage) {
      return;
    }

    purgeRunning.current = true;
    setBusy('purge');
    setPurgeError('');
    const deleted = new Set<string>();
    const failures: PurgeFailure[] = [];
    try {
      for (let offset = 0; offset < confirmation.targets.length; offset += 100) {
        const ids = confirmation.targets.slice(offset, offset + 100).map((item) => item.id);
        try {
          const result = await client.call<PurgeResult>(STUDIO_TOOLS.manage, {
            action: 'purge',
            ...(ids.length === 1 ? { artifactId: ids[0] } : { artifactIds: ids }),
          });
          result.deletedIds.forEach((id) => deleted.add(id));
          failures.push(...result.failures);
        } catch (cause) {
          failures.push(
            ...ids.map((artifactId) => ({
              artifactId,
              code: 'REQUEST_FAILED',
              message: errorText(cause),
            })),
          );
        }
      }

      if (!mounted.current) {
        return;
      }

      setPurgeFailures(
        failures.map((item) => ({
          ...item,
          title:
            confirmation.targets.find((target) => target.id === item.artifactId)?.title ||
            item.artifactId,
        })),
      );
      setTrashSelection((previous) => [
        ...new Set([
          ...previous.filter((id) => !deleted.has(id)),
          ...failures.map((item) => item.artifactId),
        ]),
      ]);
      setArtifacts((previous) => previous.filter((item) => !deleted.has(item.id)));
      forgetPreviews([...deleted]);
      setPurgeConfirmation(null);
      if (deleted.size) {
        inform(`已永久删除 ${deleted.size} 项作品。`);
      }

      await loadLibrary();
    } finally {
      purgeRunning.current = false;
      if (mounted.current) {
        setBusy('');
      }
    }
  }

  async function applyOperations(
    operations: Operation[],
    expectedVersions?: Record<string, number>,
  ) {
    const current = boardRef.current;
    if (!current) {
      return;
    }

    const result = await client.call<{ board: StudioDocument }>(STUDIO_TOOLS.apply, {
      artifactId: current.artifact.id,
      operationId: newId('op'),
      expectedRevision: current.artifact.revision,
      expectedVersions,
      operations,
    });
    acceptBoard(result.board);

    return result.board;
  }

  function closeCommentsPanel() {
    setPanel(null);
    setSelectedFeedback((previous) => (previous?.inList ? null : previous));
  }

  function togglePanel(next: Panel) {
    if (next === 'feedback') {
      setAttachmentNoticeId('');
      setSelectedFeedback(null);
    } else {
      setSelectedFeedback((previous) => (previous?.inList ? null : previous));
    }

    setPanel((previous) => (previous === next ? null : next));
  }

  function resetComment() {
    setAnnotation(null);
    setCommentOpen(false);
    setFeedbackText('');
    setAttachComment(false);
    setCommentError('');
    setSavedComment(null);
    setSelectedFeedback(null);
    commentPending.current = null;
  }

  function annotate(selection: ProductAnnotation) {
    if (!canComment || preview || suggestionPreview) {
      return;
    }

    setPanel(null);
    setSelectedFeedback(null);
    if (savedComment) {
      setCommentOpen(true);
      inform('当前备注已保存，请先完成附加。');

      return;
    }
    if (annotation && feedbackText.trim()) {
      setCommentOpen(true);
      inform('已有未发送的备注草稿，请先完成或清空当前备注，再选择新目标。');

      return;
    }

    const current = boardRef.current;
    setAnnotation({
      ...selection,
      label: current
        ? describeCommentTarget(current, selection.anchor, selection.label)
        : selection.label,
    });
    setCommentOpen(true);
    setCommentError('');
    commentPending.current = null;
  }

  function locateAnchor(
    anchor: Anchor,
    document = boardRef.current,
  ): { x: number; y: number } | undefined {
    if (!document) {
      return;
    }

    const location = getProduct(document.artifact.type)?.locateAnchor?.(document, anchor);
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

  function selectFeedback(item: Feedback, point?: { x: number; y: number }, inList = false) {
    if (reading && readingKind === 'document' && item.anchor.pin?.coordinateSpace === 'board') {
      inform('这条备注位于画板。返回画板后可查看。');

      return;
    }

    suggestionSequence.current += 1;
    closePreview();
    setSuggestionPreview(null);
    setPreviewRestoreOpen(false);
    stopFollowing();
    setCommentOpen(false);
    setAnnotationActive(true);
    setSelectedFeedback({ id: item.id, point: point || locateAnchor(item.anchor), inList });
    if (!inList) {
      setPanel(null);
    }
  }

  function changeReplyText(id: string, text: string) {
    setReplies((previous) => ({ ...previous, [id]: text }));
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

  async function deliverFeedback(item: Feedback, current: StudioDocument): Promise<boolean> {
    const isCurrent = () => mounted.current && activeRef.current === item.artifactId;
    const result = await client.call<{ feedback: Feedback[] }>(STUDIO_TOOLS.feedback, {
      action: 'send',
      artifactId: item.artifactId,
      feedbackId: item.id,
      targetViewId: peerId,
    });
    const requested = result.feedback.find((entry) => entry.id === item.id);
    if (!requested?.attachment) {
      throw new Error('未取得附加请求，请重试。');
    }

    if (isCurrent()) {
      acceptFeedback(result.feedback, item.id);
    }
    if (requested.attachment.state === 'attached') {
      return true;
    }
    if (!attachContext || !canManage || actor.kind !== 'human') {
      return false;
    }

    const requestId = requested.attachment.requestId;
    const key = JSON.stringify([item.artifactId, item.id, requestId]);
    if (!acceptedAttachments.current.has(key)) {
      if (!isCurrent()) {
        return false;
      }

      setAttachingId(item.id);
      await attachContext(requested, current);

      acceptedAttachments.current.add(key);
    }
    if (isCurrent()) {
      setAttachingId(item.id);
    }

    try {
      const receipt = await client.call<{ feedback: Feedback[] }>(STUDIO_TOOLS.feedback, {
        action: 'attached',
        artifactId: item.artifactId,
        feedbackId: item.id,
        requestId,
      });
      const attached = receipt.feedback.find((entry) => entry.id === item.id);
      if (
        attached?.attachment?.requestId !== requestId ||
        attached.attachment.state !== 'attached'
      ) {
        throw new Error('未收到状态确认。');
      }

      acceptedAttachments.current.delete(key);
      if (isCurrent()) {
        acceptFeedback(receipt.feedback, item.id);
      }
    } catch (cause) {
      throw new Error(
        `已附加到对话，状态尚未保存。请重试补记状态，本页面不会重复附加。${errorText(cause)}`,
        { cause },
      );
    }

    return true;
  }

  function feedbackWritePending() {
    return busy || commentSubmitting.current || attachmentInFlight.current;
  }

  async function persistComment(
    pending: NonNullable<typeof commentPending.current>,
    artifactId: string,
  ): Promise<Feedback> {
    if (pending.created) {
      return pending.created;
    }

    const result = await client.call<{ feedback: Feedback[]; contextId?: string }>(
      STUDIO_TOOLS.feedback,
      pending.args,
    );
    const created = result.feedback.find((item) => item.id === result.contextId);
    if (!created) {
      throw new Error('备注已提交，但未取得保存结果，请重试。');
    }

    pending.created = created;
    if (activeRef.current === artifactId) {
      acceptFeedback(result.feedback, created.id);
      setSavedComment(created);
    }

    return created;
  }

  async function createFeedback(event: SubmitEvent) {
    event.preventDefault();
    const current = boardRef.current;
    const text = feedbackText.trim();
    if (!current || !annotation || feedbackWritePending()) {
      return;
    }
    if (!text) {
      return;
    }

    const id = current.artifact.id;
    const fingerprint = JSON.stringify({
      id,
      text,
      anchor: annotation.anchor,
    });

    if (commentPending.current?.fingerprint !== fingerprint) {
      commentPending.current = {
        fingerprint,
        args: {
          action: 'create',
          operationId: newId('comment'),
          artifactId: id,
          type: 'comment',
          text,
          anchor: annotation.anchor,
          versions: annotation.versions,
          targetViewId: peerId,
        },
      };
    }

    const pending = commentPending.current;
    commentSubmitting.current = true;
    setBusy('feedback');
    setCommentError('');
    try {
      const created = await persistComment(pending, id);
      if (activeRef.current !== id || !mounted.current) {
        return;
      }

      const attached = attachComment ? await deliverFeedback(created, current) : false;
      if (activeRef.current !== id || !mounted.current) {
        return;
      }

      const point = annotation.screenPoint;
      resetComment();
      if (!attachComment) {
        setSelectedFeedback({ id: created.id, point });
      }

      inform(
        attachComment
          ? attachmentResult(attached, canManage, '备注已提交，等待房主附加到对话。')
          : '备注已保存。',
      );
    } catch (cause) {
      if (mounted.current && activeRef.current === id) {
        setCommentError(errorText(cause));
      }
    } finally {
      commentSubmitting.current = false;
      if (mounted.current) {
        setBusy('');
        setAttachingId('');
      }
    }
  }

  async function feedbackAction(
    action: CommentAction,
    item: Feedback,
    args: CommentActionArguments = {},
  ): Promise<Feedback | null> {
    if (busy) {
      throw new Error('正在处理上一项操作，请稍候。');
    }

    const attemptKey = JSON.stringify([actor.kind, actor.id, item.artifactId, item.id]);
    let attempt: { text: string; replyId: string } | undefined;
    if (action === 'reply') {
      const text = args.text?.trim() || '';
      const previous = replyAttempts.current.get(attemptKey);
      attempt =
        previous?.text === text
          ? previous
          : { text, replyId: previous ? newId('reply') : args.replyId || newId('reply') };
      replyAttempts.current.set(attemptKey, attempt);
      args = { ...args, text: attempt.text, replyId: attempt.replyId };
    }

    setBusy(`feedback:${item.id}`);
    setError('');
    try {
      const result = await client.call<{ feedback: Feedback[] }>(STUDIO_TOOLS.feedback, {
        action,
        artifactId: item.artifactId,
        feedbackId: item.id,
        ...args,
      });

      if (activeRef.current === item.artifactId) {
        acceptFeedback(result.feedback, item.id);
        if (action === 'delete' || action === 'resolve') {
          setSelectedFeedback((previous) => (previous?.id === item.id ? null : previous));
        }
      }
      if (action === 'send') {
        inform('请求已提交，等待房主附加到对话。');
      }
      if (attempt && replyAttempts.current.get(attemptKey) === attempt) {
        replyAttempts.current.delete(attemptKey);
      }

      return result.feedback.find((entry) => entry.id === item.id) || null;
    } finally {
      if (mounted.current) {
        setBusy('');
      }
    }
  }

  async function attachFeedback(item: Feedback): Promise<void> {
    const current = boardRef.current;
    if (!current || current.artifact.id !== item.artifactId || feedbackWritePending()) {
      throw new Error('正在处理上一项操作，请稍候。');
    }

    attachmentInFlight.current = true;
    setBusy(`attach:${item.id}`);
    setError('');
    try {
      const attached = await deliverFeedback(item, current);
      if (mounted.current && activeRef.current === item.artifactId) {
        inform(attachmentResult(attached, canManage, '请求已提交，等待房主附加到对话。'));
      }
    } finally {
      attachmentInFlight.current = false;
      if (mounted.current) {
        setBusy('');
        setAttachingId('');
      }
    }
  }

  async function previewVersion(version: HistoryEntry) {
    const id = activeRef.current;
    const serial = ++previewSequence.current;
    const isCurrent = () => mounted.current && serial === previewSequence.current;
    setPreviewRestoreOpen(false);
    setPreviewBusy(`version:${version.id}`);
    setError('');
    try {
      const result = await client.call(STUDIO_TOOLS.read, {
        artifactId: id,
        mode: 'version',
        versionId: version.id,
      });

      if (!isCurrent()) {
        return;
      }

      stopFollowing();
      setPreview({ board: result.board, version });

      return result.board;
    } catch (cause) {
      if (isCurrent()) {
        fail(cause);
      }
    } finally {
      if (isCurrent()) {
        setPreviewBusy('');
      }
    }
  }

  async function loadHistoryChanges(entry: HistoryBatch): Promise<HistoryUnitDiff[]> {
    const result = await client.call(STUDIO_TOOLS.read, {
      artifactId: activeRef.current,
      mode: 'diff',
      ...(entry.beforeVersionId
        ? { fromVersionId: entry.beforeVersionId, toVersionId: entry.id }
        : { versionId: entry.id, adjacent: true as const }),
    });

    return result.units;
  }

  async function restoreVersion(version = preview?.version, unitId?: string): Promise<boolean> {
    if (!version || busy || !canEdit) {
      return false;
    }

    setBusy('restore-version');
    setError('');
    try {
      await applyOperations([
        { op: 'restore', versionId: version.id, ...(unitId ? { id: unitId } : {}) },
      ]);
      setPreview(null);
      await refreshBoard();
      await loadHistory();
      inform(
        unitId ? '已恢复这一处，并保留其他内容和历史记录。' : '已恢复此版本，并保留后续历史记录。',
      );

      return true;
    } catch (cause) {
      fail(cause);

      return false;
    } finally {
      if (mounted.current) {
        setBusy('');
      }
    }
  }

  async function changeSharing(
    action: 'start' | 'stop' | 'reset' | 'link' | 'role' | 'remove' | 'restore' | 'forget',
    options: { role?: string; on?: boolean; memberId?: string; access?: 'local' | 'lan' } = {},
  ): Promise<boolean> {
    const id = activeRef.current;
    if (!id || busy) {
      return false;
    }

    const navigation = navigationSequence.current;
    const isCurrent = () =>
      mounted.current && activeRef.current === id && navigationSequence.current === navigation;
    shareSequence.current += 1;
    setBusy('share');
    setError('');
    try {
      const result = await client.call<ShareState>(STUDIO_TOOLS.share, {
        artifactId: id,
        action,
        ...options,
      });

      if (isCurrent()) {
        setShare(result);
      }

      return true;
    } catch (cause) {
      if (isCurrent()) {
        fail(cause, () => {
          if (isCurrent()) {
            void changeSharing(action, options).catch(fail);
          }
        });
      }

      return false;
    } finally {
      if (mounted.current) {
        setBusy('');
      }
    }
  }

  async function copyLink(link: string) {
    try {
      await copyPlainText(link);
      inform('链接已复制。');
    } catch (cause) {
      reportStudioWarning('即将打开手动复制对话框。', cause);
      setCopyFallback(link);
    }
  }

  async function copyInvitation(link: string | undefined, role: 'editor' | 'commenter' | 'viewer') {
    const id = activeRef.current;
    if (!id || busy) {
      return;
    }

    if (link) {
      await copyLink(link);

      return;
    }
    if (share?.enabled) {
      fail(new Error('该角色的邀请链接不可用，请重新读取分享权限。'));

      return;
    }

    shareSequence.current += 1;
    setBusy('share');
    setError('');
    try {
      const result = await client.call<ShareState>(STUDIO_TOOLS.share, {
        artifactId: id,
        action: 'start',
        access: 'local',
      });

      if (activeRef.current !== id) {
        return;
      }

      setShare(result);
      const invitation = result.links?.[role];
      if (!invitation) {
        throw new Error('该角色的邀请链接不可用，请重新读取分享权限。');
      }

      await copyLink(invitation);
    } catch (cause) {
      fail(cause);
    } finally {
      if (mounted.current) {
        setBusy('');
      }
    }
  }

  async function copyArtifactLink(artifact: Artifact) {
    if (busy) {
      return;
    }

    setMenuId('');
    setBusy(`copy-link:${artifact.id}`);
    try {
      let state = await client.call<ShareState>(STUDIO_TOOLS.share, {
        action: 'status',
        artifactId: artifact.id,
      });

      if (!state.enabled) {
        state = await client.call<ShareState>(STUDIO_TOOLS.share, {
          action: 'start',
          artifactId: artifact.id,
          access: 'local',
        });
      }
      if (state.enabled && state.links?.viewer) {
        await copyLink(state.links.viewer);
      } else {
        openArtifact(artifact.id);
        setPanel('share');
        setShare(state);
        inform('仅查看邀请链接已停用，请在分享面板中启用。');
      }
    } catch (cause) {
      fail(cause);
    } finally {
      if (mounted.current) {
        setBusy('');
      }
    }
  }

  async function exportBoard(format: 'png' | 'svg' | 'html' | 'json' | 'zip') {
    const current = boardRef.current;
    if (!current || busy) {
      return;
    }

    const product = getProduct(current.artifact.type);
    if (!product) {
      return;
    }

    setBusy('export');
    setError('');
    try {
      if (format === 'zip') {
        const result = await client.call<{ filename: string; downloadPath: string }>(
          STUDIO_TOOLS.export,
          { artifactId: current.artifact.id, format },
        );
        await downloadStudioFile(client, result.downloadPath, result.filename);
      } else {
        await product.exportDocument(current, format, client);
      }

      inform('导出已生成。');
    } catch (cause) {
      fail(cause);
    } finally {
      if (mounted.current) {
        setBusy('');
      }
    }
  }

  const visibleArtifacts = useMemo(
    () =>
      [...artifacts]
        .filter(
          (item) =>
            (!query.trim() || item.title.toLowerCase().includes(query.trim().toLowerCase())) &&
            (filter !== 'pinned' || item.pinned),
        )
        .sort(
          (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
        ),
    [artifacts, filter, query],
  );
  async function previewSuggestion(item: Feedback, operations: ProposalOperation[] | null) {
    const sequence = ++suggestionSequence.current;
    if (!operations) {
      setSuggestionPreview(null);

      return;
    }

    const option = item.proposal?.options.find((value) => value.operations === operations);
    if (!option) {
      return;
    }

    try {
      const result = await client.call<{ document: StudioDocument }>(STUDIO_TOOLS.feedback, {
        artifactId: item.artifactId,
        action: 'preview',
        feedbackId: item.id,
        optionId: option.id,
      });

      if (sequence === suggestionSequence.current && activeRef.current === item.artifactId) {
        stopFollowing();
        setSuggestionPreview(result.document);
      }
    } catch (cause) {
      if (sequence === suggestionSequence.current) {
        setSuggestionPreview(null);
        fail(cause);
      }
    }
  }

  const product = studioProduct(board);
  const ProductEditor = product.Editor;
  const activeFeedback = findActiveFeedback(feedback, selectedFeedback, panel);
  function closePreview() {
    previewSequence.current += 1;
    setPreviewBusy('');
    setPreviewRestoreOpen(false);
    setPreview(null);
  }

  const navigateFromHost = useEffectEvent((artifactId?: string, view?: string) => {
    if (artifactId) {
      if (activeRef.current !== artifactId) {
        openArtifact(artifactId);
      }
    } else {
      goHome(view === 'trash' ? 'trash' : 'library');
      setFilter(view === 'trash' ? 'trash' : 'recent');
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
      void manageArtifact('rename', current.artifact, { title }).catch(fail);
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

  function handleRestore() {
    void restoreVersion()
      .then((restored) => {
        if (restored) {
          setPreviewRestoreOpen(false);
        }
      })
      .catch(fail);
  }

  function handleCancelRestore() {
    if (!busy) {
      setPreviewRestoreOpen(false);
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
      historyLoading,
      preview,
      suggestionPreview,
      previewing: previewActive,
      previewRestoreOpen,
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
      externalViewport: follow.viewport || targetViewport,
      targetSelection,
      error,
      activeFeedback,
      feedback,
      pendingAttachments,
      attachingId,
      selectedFeedback,
      annotation,
      annotationActive,
      commentOpen,
      commentError,
      feedbackText,
      attachComment,
      savedComment,
      replies,
      showResolved,
    },
    actions: {
      goHome: () => goHome(),
      submitTitle: handleTitleSubmit,
      changeTheme: setTheme,
      togglePanel,
      closePanel: () => setPanel(null),
      handleFollow,
      stopFollowing,
      releaseAgentTask: canReleaseAgentTasks ? releaseAgentTask : undefined,
      closePreview,
      loadHistory: () => void loadHistory().catch(fail),
      loadHistoryChanges,
      previewVersion: (version) => void previewVersion(version).catch(fail),
      restoreVersion,
      requestRestore: () => setPreviewRestoreOpen(true),
      cancelRestore: handleCancelRestore,
      confirmRestore: handleRestore,
      changeSharing,
      handleCopy: handleShareCopy,
      exportBoard: (format) => void exportBoard(format).catch(fail),
      refreshBoard: () => void refreshBoard().catch(fail),
      handleCanvasArea,
      acceptBoard,
      editorActivityChanged,
      selectionChanged,
      viewportChanged,
      cursorMoved,
      readingChanged,
      changeTimer: (action, durationSeconds, deltaSeconds) =>
        void changeTimer(action, durationSeconds, deltaSeconds).catch(fail),
      fail,
      inform,
      annotate,
      changeAnnotationMode,
      onCommentSurface,
      commentPoint,
      selectFeedback,
      changeReplyText,
      feedbackAction,
      attachFeedback,
      hideCommentDraft: () => setCommentOpen(false),
      changeCommentText: setFeedbackText,
      changeCommentAttachment: setAttachComment,
      createFeedback: (event) => void createFeedback(event).catch(fail),
      changeShowResolved: setShowResolved,
      dismissComment: () => setSelectedFeedback(null),
      collapseListedComment: () =>
        setSelectedFeedback((previous) => (previous?.inList ? null : previous)),
      closeCommentsPanel,
      previewSuggestion: (item, operations) => void previewSuggestion(item, operations).catch(fail),
    },
  };

  function handleShowRecent() {
    changeLibraryFilter('recent');
    setQuery('');
  }

  function handleLoadNextPage() {
    if (nextCursor) {
      void loadLibrary(nextCursor).catch(fail);
    }
  }

  function selectTrashItems(ids: readonly string[], selected: boolean) {
    if (selected) {
      setTrashSelection((previous) => [...new Set([...previous, ...ids])]);
      return;
    }
    const removed = new Set(ids);
    setTrashSelection((previous) => previous.filter((id) => !removed.has(id)));
  }

  function handleStartRename(artifact: Artifact) {
    setRename({ artifact, title: artifact.title });
    setMenuId('');
  }

  function handleArtifactAction(action: LibraryArtifactAction, artifact: Artifact) {
    if (action === 'pin') {
      void manageArtifact('pin', artifact, { pinned: !artifact.pinned }).catch(fail);
      return;
    }
    if (action === 'copyLink') {
      void copyArtifactLink(artifact).catch(fail);
      return;
    }
    void manageArtifact(action, artifact).catch(fail);
  }

  const library: StudioLibraryViewProps = {
    data: {
      busy,
      canManage,
      client,
      filter,
      query,
      layout,
      resolvedTheme,
      visibleArtifacts,
      previews,
      libraryLoaded,
      libraryLoading,
      hasNextPage: Boolean(nextCursor),
      menuId,
      trashSelection,
      purgeFailures,
      purgeError,
    },
    actions: {
      showRecent: handleShowRecent,
      changeFilter: changeLibraryFilter,
      changeQuery: setQuery,
      changeLayout: handleLayoutChange,
      changeTheme: setTheme,
      createBoard: (productId) => void createBoard(productId).catch(fail),
      importArchive: (file) => void importArchive(file).catch(fail),
      openArtifact: (id) => openArtifact(id),
      loadNextPage: handleLoadNextPage,
      prepareEmptyTrash: () => void prepareEmptyTrash().catch(fail),
      selectTrashPage: (selected) =>
        selectTrashItems(
          visibleArtifacts.map((item) => item.id),
          selected,
        ),
      selectTrashItem: (id, selected) => selectTrashItems([id], selected),
      clearTrashSelection: () => setTrashSelection([]),
      confirmPurge,
      changeArtifactMenu: (id, open) => setMenuId(open ? id : ''),
      startRename: handleStartRename,
      runArtifactAction: handleArtifactAction,
    },
  };

  const purgeDialog: StudioPurgeDialogProps | null = purgeConfirmation && {
    busy: !!busy,
    deleting: busy === 'purge',
    confirmation: purgeConfirmation,
    onCancel: () => {
      if (!purgeRunning.current) {
        setPurgeConfirmation(null);
      }
    },
    onConfirm: () => void purgeArtifacts().catch(fail),
  };

  function handleRenameSubmit() {
    const title = rename?.title.trim();
    if (rename && title) {
      void manageArtifact('rename', rename.artifact, { title }).catch(fail);
    }
  }

  const renameDialog: StudioRenameDialogProps | null = rename && {
    busy: !!busy,
    title: rename.title,
    onChange: (title) => setRename((previous) => (previous ? { ...previous, title } : null)),
    onClose: () => setRename(null),
    onSubmit: handleRenameSubmit,
  };

  return {
    accessPending,
    activeId,
    attachmentNotice,
    copyFallback,
    editor,
    error,
    fail,
    library,
    notice,
    operationNoticeTarget,
    panel,
    peerId,
    previewActive,
    purgeDialog,
    reading,
    readingKind,
    renameDialog,
    resolvedTheme,
    retry,
    selectFeedback,
    session,
    setAttachmentNoticeId,
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
    setAttachmentNoticeId,
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
    setAttachmentNoticeId('');
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
            onClick={() => setAttachmentNoticeId('')}
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
