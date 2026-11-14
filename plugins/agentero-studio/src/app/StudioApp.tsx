import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowLeft, Check, ChevronDown, Clock3, Copy, FileCode2, LayoutGrid, Loader2, MessageSquare, Moon, MoreHorizontal, Pin, Plus, RefreshCw, RotateCcw, Send, Share2, Sun, Trash2, Users, X } from 'lucide-react';
import type { Actor, Anchor, Artifact, Feedback, HistoryBatch, HistoryEntry, Operation, Presence, RoomTimer, StudioClient, ViewContext } from '../contracts/studio';
import { getProduct, products, type ProductActivity, type ProductAnnotation, type StudioDocument, type Viewport } from './products';
import { StudioDialog } from './products/dialog';
import { studioRequest, downloadStudioFile } from './transport';
import './studio.css';
import './editor-shell.css';
import { SuggestionPanel } from './SuggestionPanel';
import { LibraryToolbar } from './LibraryToolbar';
import { LibraryArtifactMenu } from './LibraryArtifactMenu';
import type { ProposalOperation } from '../contracts/proposals';
import { EditorPopover, HistoryPanel, SharePanel, TimerControl, type EditorShareState, type TimerAction } from './shared/editor-panels';
import type { HistoryUnitDiff } from './shared/editor-panels/history-diff';
import { CommentComposer, CommentPopover } from './shared/comments/CommentPopover';
import { CommentThread, type CommentAction, type CommentActionArguments } from './shared/comments/CommentThread';
import { CommentsPanel } from './shared/comments/CommentsPanel';
import { describeCommentTarget, liveCommentPoint, type CommentPoint } from './shared/comments/comment-target';
import { createRegionReaderLink, watchRegionReaderReturn } from './region-reader';
import { copyPlainText } from './clipboard';
import { newClientId } from './shared/client-id';

export interface StudioAppProps {
  client: StudioClient;
  actor: Actor;
  initialArtifactId?: string;
  initialView?: string;
  navigationRevision?: number;
  onViewContext?: (context: ViewContext | null) => void;
  attachContext?: (feedback: Feedback, board: StudioDocument) => Promise<void>;
}

type Panel = 'feedback' | 'history' | 'share' | null;
type Theme = 'system' | 'light' | 'dark';
type LibraryFilter = 'recent' | 'pinned' | 'trash';
interface ShareState extends EditorShareState { [key: string]: unknown }
interface ListResult { artifacts: Artifact[]; nextCursor?: string }
interface ManageResult { artifact: Artifact; board?: StudioDocument }
interface PurgeFailure { artifactId: string; code: string; message: string }
interface PurgeResult { deletedIds: string[]; failures: PurgeFailure[] }
interface PurgeConfirmation { targets: { id: string; title: string }[]; all: boolean }

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.)$/i.test(message) ? '无法连接作品服务，请重试或重新打开页面。' : message;
}
function savedPreference<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try { const value = localStorage.getItem(key) as T; return allowed.includes(value) ? value : fallback; } catch { return fallback; }
}
function relativeTime(value: string): string {
  const stamp = new Date(value).getTime();
  if (!Number.isFinite(stamp)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - stamp) / 60000));
  if (minutes < 1) return '刚刚修改';
  if (minutes < 60) return `${minutes} 分钟前修改`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前修改`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)} 天前修改`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(stamp);
}
function authorName(actor: Actor): string { return actor.kind === 'agent' ? `${actor.name || 'Agent'} · Agent` : actor.name || '协作者'; }
function newId(prefix: string): string { return newClientId(prefix); }
function emptyActivity(): ProductActivity { return { editingIds: [], movingIds: [], dirty: false, issues: [] }; }
function initialPresence() { return { selectedIds: [] as string[], viewport: { x: 0, y: 0, zoom: 1 }, cursor: undefined as { x: number; y: number } | undefined, chat: '', following: '', ...emptyActivity() }; }
function ArtifactPreview({ artifact, cached, client }: { artifact: Artifact; cached?: StudioDocument; client: StudioClient }) {
  const Preview = getProduct(artifact.type)?.Preview;
  return Preview ? <Preview artifact={artifact} cached={cached} client={client} /> : <div className="studio-artifact-preview studio-blank-preview">暂无预览</div>;
}
function ProductGlyph({ type, size = 22 }: { type: string; size?: number }) { const Icon = getProduct(type)?.Icon || FileCode2; return <Icon size={size} />; }

export default function StudioApp({ client, actor: initialActor, initialArtifactId, initialView, navigationRevision, onViewContext, attachContext }: StudioAppProps) {
  const [sessionActor, setSessionActor] = useState(initialActor);
  const [accessPending, setAccessPending] = useState(false);
  const actor: Actor = accessPending ? { ...sessionActor, role: 'viewer' } : sessionActor;
  const [activeId, setActiveId] = useState(initialArtifactId || '');
  const activeRef = useRef(activeId);
  const initialRoute = useRef({ id: initialArtifactId, view: initialView, revision: navigationRevision });
  const [board, setBoard] = useState<StudioDocument | null>(null);
  const archiveInput = useRef<HTMLInputElement>(null);
  const [suggestionPreview, setSuggestionPreview] = useState<StudioDocument | null>(null);
  const suggestionSequence = useRef(0);
  const boardRef = useRef<StudioDocument | null>(null);
  const [cachedBoards, setCachedBoards] = useState<Record<string, StudioDocument>>({});
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [filter, setFilter] = useState<LibraryFilter>(initialView === 'trash' ? 'trash' : 'recent');
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState<'grid' | 'list'>(() => savedPreference('agentero-studio-view', 'grid', ['grid', 'list']));
  const [theme, setTheme] = useState<Theme>(() => savedPreference('agentero-studio-theme', 'system', ['system', 'light', 'dark']));
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [sync, setSync] = useState<'loading' | 'saved' | 'reconnecting'>('loading');
  const [menuId, setMenuId] = useState('');
  const [trashSelection, setTrashSelection] = useState<string[]>([]);
  const [purgeConfirmation, setPurgeConfirmation] = useState<PurgeConfirmation | null>(null);
  const [purgeFailures, setPurgeFailures] = useState<(PurgeFailure & { title: string })[]>([]);
  const [purgeError, setPurgeError] = useState('');
  const purgeRunning = useRef(false);
  const [rename, setRename] = useState<{ artifact: Artifact; title: string } | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [feedbackText, setFeedbackText] = useState('');
  const [annotation, setAnnotation] = useState<ProductAnnotation | null>(null);
  const [commentOpen, setCommentOpen] = useState(false);
  const [annotationActive, setAnnotationActive] = useState(false);
  const [attachComment, setAttachComment] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [savedComment, setSavedComment] = useState<Feedback | null>(null);
  const [selectedFeedback, setSelectedFeedback] = useState<{ id: string; point?: { x: number; y: number } } | null>(null);
  const commentPending = useRef<{ fingerprint: string; args: Record<string, unknown>; created?: Feedback } | null>(null);
  const commentSubmitting = useRef(false);
  const canvasArea = useRef<HTMLDivElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null), shareButton = useRef<HTMLButtonElement>(null), commentsButton = useRef<HTMLButtonElement>(null);
  const [targetViewport, setTargetViewport] = useState<Viewport>();
  const [targetSelection, setTargetSelection] = useState<string[]>();
  const [readerSession, setReaderSession] = useState<{ artifactId: string; expiresAt: number } | null>(null);
  const [readerFallback, setReaderFallback] = useState<{ artifactId: string; url: string; expiresAt: number } | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [showResolved, setShowResolved] = useState(false);
  const [history, setHistory] = useState<HistoryBatch[]>([]);
  const [preview, setPreview] = useState<{ board: StudioDocument; version: HistoryEntry } | null>(null);
  const [previewRestoreOpen, setPreviewRestoreOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [share, setShare] = useState<ShareState | null>(null);
  const listSequence = useRef(0);
  const versionSequence = useRef(0);
  const retryRef = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  const skipTitleBlur = useRef(false);
  const [peerId] = useState(() => newId('view'));
  const [peers, setPeers] = useState<Presence[]>([]);
  const [presenceOpen, setPresenceOpen] = useState(false);
  const [cursorChat, setCursorChat] = useState('');
  const [following, setFollowing] = useState('');
  const [roomTimer, setRoomTimer] = useState<RoomTimer | null>(null);
  const [timerBusy, setTimerBusy] = useState(false);
  const presenceRef = useRef(initialPresence());
  const activitySources = useRef({ editor: emptyActivity(), toolbar: emptyActivity() });
  const requestPresence = useRef<(() => void) | null>(null);
  const canManage = actor.role === 'owner';
  const canEdit = actor.role === 'owner' || actor.role === 'editor';
  const canComment = actor.role !== 'viewer';
  const publishViewContext = useCallback(() => {
    const id = activeRef.current;
    const state = presenceRef.current;
    onViewContext?.(id ? { viewId: peerId, artifactId: id, selectedIds: state.selectedIds, viewport: state.viewport, selectedCount: state.selectedIds.length, editingIds: state.editingIds, movingIds: state.movingIds, dirty: state.dirty, issues: state.issues } : null);
  }, [onViewContext, peerId]);
  const reportActivity = useCallback((source: 'editor' | 'toolbar', artifactId: string, state: ProductActivity) => {
    if (!artifactId || artifactId !== activeRef.current) return;
    activitySources.current[source] = state;
    const activities = Object.values(activitySources.current);
    const merged: ProductActivity = { editingIds: [...new Set(activities.flatMap(activity => activity.editingIds))].slice(0, 200), movingIds: [...new Set(activities.flatMap(activity => activity.movingIds))].slice(0, 200), dirty: activities.some(activity => activity.dirty), issues: activities.flatMap(activity => activity.issues ?? []).slice(0, 5) };
    Object.assign(presenceRef.current, merged); requestPresence.current?.(); publishViewContext();
  }, [publishViewContext]);
  const editorActivityChanged = useMemo(() => (state: ProductActivity) => reportActivity('editor', activeId, state), [activeId, reportActivity]);
  const toolbarActivityChanged = useMemo(() => (state: ProductActivity) => reportActivity('toolbar', activeId, state), [activeId, reportActivity]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setSessionActor(initialActor); setAccessPending(false); }, [initialActor]);
  useEffect(() => {
    if (initialRoute.current.id === initialArtifactId && initialRoute.current.view === initialView && initialRoute.current.revision === navigationRevision) return;
    initialRoute.current = { id: initialArtifactId, view: initialView, revision: navigationRevision };
    if (initialArtifactId) { if (activeRef.current !== initialArtifactId) openArtifact(initialArtifactId); }
    else { goHome(); setFilter(initialView === 'trash' ? 'trash' : 'recent'); }
  }, [initialArtifactId, initialView, navigationRevision]);
  const fail = useCallback((cause: unknown, retry?: () => void) => {
    if (!mounted.current) return;
    setError(errorText(cause)); retryRef.current = retry || null;
  }, []);
  const inform = useCallback((message: string) => { setNotice(message); }, []);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const update = () => {
      const host = document.documentElement.dataset.theme;
      setResolvedTheme(theme !== 'system' ? theme : host === 'dark' || host === 'light' ? host : media?.matches ? 'dark' : 'light');
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    media?.addEventListener?.('change', update);
    try { localStorage.setItem('agentero-studio-theme', theme); } catch { /* A host may disallow local storage. */ }
    return () => { observer.disconnect(); media?.removeEventListener?.('change', update); };
  }, [theme]);

  useEffect(() => {
    const close = (event: PointerEvent) => { if (!(event.target as Element | null)?.closest('.studio-menu-anchor, .studio-library-floating-menu')) setMenuId(''); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuId(''); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, []);

  const acceptBoard = useCallback((next: StudioDocument) => {
    if (!mounted.current || next.artifact.id !== activeRef.current) return;
    const existing = boardRef.current;
    if (existing?.artifact.id === next.artifact.id && existing.artifact.revision > next.artifact.revision) return;
    boardRef.current = next; setBoard(next); setSync('saved');
    setCachedBoards(previous => ({ ...previous, [next.artifact.id]: next }));
  }, []);

  const refreshBoard = useCallback(async (id = activeRef.current) => {
    if (!id) return;
    const results = await Promise.allSettled([
      client.call<StudioDocument>('artifact_read', { artifactId: id, mode: 'board' }),
      client.call<{ feedback: Feedback[] }>('artifact_feedback', { action: 'list', artifactId: id }),
    ]);
    if (!mounted.current || activeRef.current !== id) return;
    if (results[0].status === 'fulfilled') acceptBoard(results[0].value);
    else { setSync('reconnecting'); fail(results[0].reason, () => { void refreshBoard(id); }); }
    if (results[1].status === 'fulfilled') setFeedback(results[1].value.feedback);
    else fail(results[1].reason, () => { void refreshBoard(id); });
  }, [acceptBoard, client, fail]);

  const loadLibrary = useCallback(async (cursor?: string) => {
    const serial = ++listSequence.current;
    setLibraryLoading(true);
    try {
      const result = await client.call<ListResult>('artifact_list', { query: query.trim(), trashed: filter === 'trash', pinned: filter === 'pinned' ? true : undefined, limit: 60, cursor });
      if (!mounted.current || serial !== listSequence.current) return;
      setArtifacts(previous => cursor ? [...previous, ...result.artifacts.filter(item => !previous.some(old => old.id === item.id))] : result.artifacts);
      setNextCursor(result.nextCursor); setLibraryLoaded(true);
    } catch (cause) { if (serial === listSequence.current) fail(cause, () => { void loadLibrary(cursor); }); }
    finally { if (mounted.current && serial === listSequence.current) setLibraryLoading(false); }
  }, [client, fail, filter, query]);

  useEffect(() => {
    if (activeId || !canManage) return;
    const timer = window.setTimeout(() => { void loadLibrary(); }, query ? 180 : 0);
    return () => { window.clearTimeout(timer); listSequence.current += 1; };
  }, [activeId, canManage, loadLibrary, query]);

  useEffect(() => { setTrashSelection([]); setPurgeFailures([]); setPurgeError(''); setPurgeConfirmation(null); }, [activeId, filter, query]);
  useEffect(() => {
    const retained = new Set([...artifacts.filter(item => item.trashedAt).map(item => item.id), ...purgeFailures.map(item => item.artifactId)]);
    setTrashSelection(previous => { const next = previous.filter(id => retained.has(id)); return next.length === previous.length ? previous : next; });
  }, [artifacts, purgeFailures]);

  useEffect(() => {
    if (!activeId) return;
    setSync('loading'); void refreshBoard(activeId);
  }, [activeId, refreshBoard]);

  useEffect(() => {
    if (!activeId) return;
    let stream: EventSource | undefined;
    let reconnecting = false;
    let refreshing = false;
    const refresh = () => {
      if (document.visibilityState === 'hidden' || refreshing) return;
      refreshing = true;
      void (async () => {
        if (client.request && boardRef.current) {
          const summary = await client.call<{ artifact: Artifact }>('artifact_read', { artifactId: activeId, mode: 'summary', limit: 1 });
          if (activeRef.current !== activeId) return;
          const presenceUrl = new URL('/api/presence', client.baseUrl); presenceUrl.searchParams.set('artifactId', activeId);
          const presenceResponse = await studioRequest(client, presenceUrl);
          if (presenceResponse.ok && activeRef.current === activeId) {
            const state = await presenceResponse.json() as { peers: Presence[]; timer?: RoomTimer | null };
            setPeers(state.peers); setRoomTimer(state.timer ?? null);
          }
          if (summary.artifact.revision !== boardRef.current?.artifact.revision) await refreshBoard(activeId);
          else {
            const result = await client.call<{ feedback: Feedback[] }>('artifact_feedback', { action: 'list', artifactId: activeId });
            if (activeRef.current === activeId && mounted.current) { setFeedback(result.feedback); setSync('saved'); }
          }
        } else await refreshBoard(activeId);
      })().catch(cause => { if (activeRef.current === activeId) { setSync('reconnecting'); fail(cause); } }).finally(() => { refreshing = false; });
    };
    const connect = () => {
      stream?.close(); stream = undefined;
      if (client.request || document.visibilityState === 'hidden' || !client.baseUrl || typeof EventSource === 'undefined') return;
      const url = new URL('/api/events', client.baseUrl); url.searchParams.set('artifactId', activeId);
      if (client.token) url.searchParams.set('token', client.token);
      stream = new EventSource(url.href);
      stream.addEventListener('change', refresh);
      stream.onmessage = event => {
        if (activeRef.current !== activeId) return;
        try {
          const message = JSON.parse(event.data);
          if (message.artifactId && message.artifactId !== activeId) return;
          if (message.type === 'access-revoked') {
            setAccessPending(true); setAnnotationActive(false); setShare(null); setSync('reconnecting');
            inform(message.reason || '分享权限已变更，正在更新访问权限。');
          } else if (message.type === 'ready' && message.actor) {
            setSessionActor(message.actor); setAccessPending(false); refresh();
          } else if (message.type === 'presence' && Array.isArray(message.peers)) {
            setPeers(message.peers); if ('timer' in message) setRoomTimer(message.timer);
          } else refresh();
        } catch { refresh(); }
      };
      stream.onopen = () => { if (activeRef.current !== activeId) return; if (reconnecting) refresh(); reconnecting = false; setSync(boardRef.current ? 'saved' : 'loading'); };
      stream.onerror = () => { if (activeRef.current !== activeId) return; reconnecting = true; setSync('reconnecting'); };
    };
    const visibility = () => { connect(); if (document.visibilityState !== 'hidden') refresh(); };
    connect();
    const poll = window.setInterval(() => { if (!stream || reconnecting) refresh(); }, client.request ? 3000 : 7000);
    document.addEventListener('visibilitychange', visibility);
    return () => { stream?.close(); window.clearInterval(poll); document.removeEventListener('visibilitychange', visibility); };
  }, [activeId, client, refreshBoard, inform]);

  useEffect(() => {
    if (!activeId || !client.baseUrl) return;
    const url = new URL('/api/presence', client.baseUrl); url.searchParams.set('artifactId', activeId);
    let stopped = false; let pending: number | undefined; let lastSent = 0;
    const send = async (leave = false) => {
      if (!leave && (stopped || document.visibilityState === 'hidden')) return;
      lastSent = Date.now();
      const state = presenceRef.current;
      try {
        const response = await studioRequest(client, url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(client.token ? { Authorization: `Bearer ${client.token}` } : {}) }, body: JSON.stringify({ artifactId: activeId, peerId, ...(leave ? { leave: true } : { context: { viewId: peerId, artifactId: activeId, selectedIds: state.selectedIds, viewport: state.viewport, editingIds: state.editingIds, movingIds: state.movingIds, dirty: state.dirty, issues: state.issues }, cursor: state.cursor, chat: state.chat, following: state.following }) }), keepalive: leave });
        if (!response.ok || leave) return;
        const result = await response.json() as { peers: Presence[]; timer?: RoomTimer | null };
        if (!stopped && activeRef.current === activeId) { setPeers(result.peers); setRoomTimer(result.timer ?? null); }
      } catch { /* Board sync reports connectivity; presence reconnects on the next heartbeat. */ }
    };
    requestPresence.current = () => {
      if (pending !== undefined) return;
      pending = window.setTimeout(() => { pending = undefined; void send(); }, Math.max(0, 200 - (Date.now() - lastSent)));
    };
    const visibility = () => { if (document.visibilityState === 'hidden') void send(true); else void send(); };
    void send();
    const heartbeat = window.setInterval(() => { void send(); }, 15000);
    document.addEventListener('visibilitychange', visibility);
    return () => { stopped = true; requestPresence.current = null; window.clearTimeout(pending); window.clearInterval(heartbeat); document.removeEventListener('visibilitychange', visibility); void send(true); };
  }, [activeId, client, peerId]);
  useEffect(() => { presenceRef.current.selectedIds = selectedIds; requestPresence.current?.(); publishViewContext(); }, [activeId, selectedIds, publishViewContext]);
  useEffect(() => { presenceRef.current.following = following; requestPresence.current?.(); }, [following]);
  const selectionChanged = useCallback((ids: string[]) => { if (activeRef.current === activeId) setSelectedIds(ids); }, [activeId]);
  const viewportChanged = useCallback((viewport: { x: number; y: number; zoom: number }) => { if (activeRef.current !== activeId) return; presenceRef.current.viewport = viewport; requestPresence.current?.(); publishViewContext(); }, [activeId, publishViewContext]);
  const cursorMoved = useCallback((cursor: { x: number; y: number }) => { if (activeRef.current !== activeId) return; presenceRef.current.cursor = cursor; requestPresence.current?.(); }, [activeId]);
  function sendCursorChat(event: FormEvent) {
    event.preventDefault(); presenceRef.current.chat = cursorChat.trim().slice(0, 240); setCursorChat(''); requestPresence.current?.();
  }
  async function changeTimer(action: TimerAction, durationSeconds?: number, deltaSeconds?: number) {
    const id = activeRef.current; if (!id || !canEdit || timerBusy || !client.baseUrl) return;
    setTimerBusy(true);
    try {
      const url = new URL('/api/presence', client.baseUrl);
      const response = await studioRequest(client, url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(client.token ? { Authorization: `Bearer ${client.token}` } : {}) }, body: JSON.stringify({ artifactId: id, peerId, timer: { action, ...(durationSeconds !== undefined ? { durationSeconds } : {}), ...(deltaSeconds !== undefined ? { deltaSeconds } : {}) } }) });
      const result = await response.json() as { peers: Presence[]; timer: RoomTimer | null; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message || '共享计时器未能更新。');
      if (mounted.current && activeRef.current === id) { setRoomTimer(result.timer); setPeers(result.peers); }
    } catch (cause) { if (activeRef.current === id) fail(cause); }
    finally { if (mounted.current && activeRef.current === id) setTimerBusy(false); }
  }

  useEffect(() => { setTitleDraft(board?.artifact.title || ''); }, [board?.artifact.title]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 6000); return () => window.clearTimeout(timer); }, [notice]);

  const loadHistory = useCallback(async () => {
    const id = activeRef.current; if (!id) return;
    setHistoryLoading(true);
    try { const result = await client.call<{ history: HistoryEntry[]; batches: HistoryBatch[] }>('artifact_read', { artifactId: id, mode: 'history' }); if (activeRef.current === id && mounted.current) setHistory([...result.batches].sort((a, b) => b.revision - a.revision)); }
    catch (cause) { fail(cause, () => { void loadHistory(); }); }
    finally { if (mounted.current && activeRef.current === id) setHistoryLoading(false); }
  }, [client, fail]);
  const loadShare = useCallback(async () => {
    const id = activeRef.current; if (!id) return;
    if (!canManage) { setShare(accessPending ? null : { enabled: true }); return; }
    try { const result = await client.call<ShareState>('artifact_share', { action: 'status', artifactId: id }); if (activeRef.current === id && mounted.current) setShare(result); }
    catch (cause) { fail(cause, () => { void loadShare(); }); }
  }, [client, fail, canManage, accessPending]);
  useEffect(() => { if (panel === 'history') void loadHistory(); }, [panel, board?.artifact.revision, loadHistory]);
  useEffect(() => { if (panel === 'share') void loadShare(); }, [panel, loadShare]);

  function openArtifact(id: string, ready?: StudioDocument) {
    versionSequence.current += 1; activeRef.current = id; boardRef.current = null;
    presenceRef.current = initialPresence(); activitySources.current = { editor: emptyActivity(), toolbar: emptyActivity() };
    setRoomTimer(null); setTimerBusy(false); publishViewContext();
    resetComment(); setAnnotationActive(false); setTargetViewport(undefined); setTargetSelection(undefined); setReaderSession(null); setReaderFallback(null); setShare(null); setHistory([]);
    setActiveId(id); setBoard(null); setFeedback([]); setPreview(null); setSuggestionPreview(null); suggestionSequence.current += 1; setPanel(null); setSelectedIds([]); setAnnotation(null); setError(''); setMenuId(''); setPeers([]); setFollowing(''); setPresenceOpen(false);
    if (ready) acceptBoard(ready);
  }
  function goHome() {
    activeRef.current = ''; boardRef.current = null; versionSequence.current += 1;
    presenceRef.current = initialPresence(); activitySources.current = { editor: emptyActivity(), toolbar: emptyActivity() };
    setRoomTimer(null); setTimerBusy(false); publishViewContext();
    resetComment(); setAnnotationActive(false); setTargetViewport(undefined); setTargetSelection(undefined); setReaderSession(null); setReaderFallback(null);
    setActiveId(''); setBoard(null); setPreview(null); setSuggestionPreview(null); suggestionSequence.current += 1; setPanel(null); setAnnotation(null); setSelectedIds([]); setError(''); setPeers([]); setFollowing(''); setPresenceOpen(false);
  }
  async function importArchive(file: File) {
    if (!canManage || busy) return;
    if (file.size > 128 * 1024 * 1024) { fail(new Error('作品备份超过 128 MB。')); return; }
    setBusy('import'); setError('');
    try {
      const response = await studioRequest(client, `${client.baseUrl}/api/import`, { method: 'POST', headers: { Authorization: `Bearer ${client.token}`, 'Content-Type': 'application/zip' }, body: file });
      const result = await response.json() as { ok: boolean; data?: ManageResult & { document?: StudioDocument }; error?: { message?: string } };
      if (!result.ok || !result.data) throw new Error(result.error?.message || '作品备份未能导入。');
      if (!mounted.current) return;
      openArtifact(result.data.artifact.id, result.data.document || result.data.board);
      inform('作品已导入，原作品保持完整。');
    } catch (cause) { fail(cause); }
    finally { if (mounted.current) setBusy(''); }
  }
  async function createBoard(productId = products[0]!.id) {
    const product = getProduct(productId); if (!product) return;
    if (busy) return;
    setBusy('create'); setError('');
    try { const result = await client.call<ManageResult>('artifact_manage', { action: 'create', type: product.id, title: product.defaultTitle }); openArtifact(result.artifact.id, result.board); }
    catch (cause) { fail(cause, () => { void createBoard(); }); }
    finally { if (mounted.current) setBusy(''); }
  }
  async function manageArtifact(action: string, artifact: Artifact, extra: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(`${action}:${artifact.id}`); setError(''); setMenuId('');
    try {
      const result = await client.call<ManageResult>('artifact_manage', { action, artifactId: artifact.id, ...extra });
      if (result.board) acceptBoard(result.board);
      else if (boardRef.current?.artifact.id === artifact.id && result.artifact.revision >= boardRef.current.artifact.revision) acceptBoard({ ...boardRef.current, artifact: result.artifact });
      if (action === 'duplicate') { openArtifact(result.artifact.id, result.board); return; }
      if (action === 'trash' && activeRef.current === artifact.id) goHome();
      if (!activeRef.current) await loadLibrary();
      if (action === 'trash') inform('已移入回收站，可以随时恢复。');
      if (action === 'restore') inform('作品已恢复。');
      if (action === 'rename') setRename(null);
    } catch (cause) { fail(cause, () => { void manageArtifact(action, artifact, extra); }); }
    finally { if (mounted.current) setBusy(''); }
  }
  function confirmPurge(ids: string[]) {
    if (busy || !canManage) return;
    const unique = [...new Set(ids)]; if (!unique.length) return;
    setPurgeError('');
    setPurgeConfirmation({ targets: unique.map(id => ({ id, title: artifacts.find(item => item.id === id)?.title || purgeFailures.find(item => item.artifactId === id)?.title || id })), all: false });
  }
  async function prepareEmptyTrash() {
    if (busy || !canManage) return;
    setBusy('prepare-purge'); setPurgeError('');
    try {
      const targets = new Map<string, { id: string; title: string }>(); let cursor: string | undefined;
      do {
        const result = await client.call<ListResult>('artifact_list', { trashed: true, limit: 100, ...(cursor ? { cursor } : {}) });
        result.artifacts.forEach(item => targets.set(item.id, { id: item.id, title: item.title }));
        cursor = result.nextCursor;
      } while (cursor);
      if (mounted.current) {
        if (targets.size) setPurgeConfirmation({ targets: [...targets.values()], all: true });
        else inform('回收站已经为空。');
      }
    } catch (cause) { if (mounted.current) setPurgeError(errorText(cause)); }
    finally { if (mounted.current) setBusy(''); }
  }
  async function purgeArtifacts() {
    const confirmation = purgeConfirmation;
    if (!confirmation || busy || purgeRunning.current || !canManage) return;
    purgeRunning.current = true; setBusy('purge'); setPurgeError('');
    const deleted = new Set<string>(), failures: PurgeFailure[] = [];
    try {
      for (let offset = 0; offset < confirmation.targets.length; offset += 100) {
        const ids = confirmation.targets.slice(offset, offset + 100).map(item => item.id);
        try {
          const result = await client.call<PurgeResult>('artifact_manage', { action: 'purge', ...(ids.length === 1 ? { artifactId: ids[0] } : { artifactIds: ids }) });
          result.deletedIds.forEach(id => deleted.add(id)); failures.push(...result.failures);
        } catch (cause) { failures.push(...ids.map(artifactId => ({ artifactId, code: 'REQUEST_FAILED', message: errorText(cause) }))); }
      }
      if (!mounted.current) return;
      setPurgeFailures(failures.map(item => ({ ...item, title: confirmation.targets.find(target => target.id === item.artifactId)?.title || item.artifactId })));
      setTrashSelection(previous => [...new Set([...previous.filter(id => !deleted.has(id)), ...failures.map(item => item.artifactId)])]);
      setArtifacts(previous => previous.filter(item => !deleted.has(item.id)));
      setPurgeConfirmation(null);
      if (deleted.size) inform(`已永久删除 ${deleted.size} 项作品。`);
      await loadLibrary();
    } finally { purgeRunning.current = false; if (mounted.current) setBusy(''); }
  }
  async function applyOperations(operations: Operation[], expectedVersions?: Record<string, number>) {
    const current = boardRef.current; if (!current) return;
    const result = await client.call<{ board: StudioDocument }>('artifact_apply', { artifactId: current.artifact.id, operationId: newId('op'), expectedRevision: current.artifact.revision, expectedVersions, operations });
    acceptBoard(result.board); return result.board;
  }
  function togglePanel(next: Panel) { setPanel(previous => previous === next ? null : next); }
  function resetComment() { setAnnotation(null); setCommentOpen(false); setFeedbackText(''); setAttachComment(false); setCommentError(''); setSavedComment(null); setSelectedFeedback(null); commentPending.current = null; }
  function annotate(selection: ProductAnnotation) {
    if (!canComment || preview || suggestionPreview) return;
    setPanel(null); setSelectedFeedback(null);
    if (savedComment) { setCommentOpen(true); inform('当前备注已保存，请先完成附加。'); return; }
    const current = boardRef.current;
    setAnnotation({ ...selection, label: current ? describeCommentTarget(current, selection.anchor, selection.label) : selection.label }); setCommentOpen(true); setCommentError(''); commentPending.current = null;
  }
  function locateAnchor(anchor: Anchor, document = boardRef.current): { x: number; y: number } | undefined {
    if (!document) return;
    const location = getProduct(document.artifact.type)?.locateAnchor?.(document, anchor);
    if (!location) return;
    const rect = canvasArea.current?.getBoundingClientRect(), width = rect?.width || 900, height = rect?.height || 600;
    const { bounds } = location;
    const zoom = Math.max(.12, Math.min(1, (width - 100) / Math.max(1, bounds.w), (height - 120) / Math.max(1, bounds.h)));
    setFollowing(''); setTargetSelection([...location.ids]);
    setTargetViewport({ x: width / 2 - (bounds.x + bounds.w / 2) * zoom, y: height / 2 - (bounds.y + bounds.h / 2) * zoom, zoom });
    return { x: (rect?.left || 0) + width / 2, y: (rect?.top || 60) + height / 2 };
  }
  function selectFeedback(item: Feedback, point?: { x: number; y: number }) {
    setCommentOpen(false); setAnnotationActive(true); setSelectedFeedback({ id: item.id, point: point || locateAnchor(item.anchor) }); setPanel(null);
  }
  function commentPoint(anchor: Anchor, feedbackId?: string, fallback?: CommentPoint) { return liveCommentPoint(canvasArea.current, boardRef.current, anchor, presenceRef.current.viewport, feedbackId, fallback); }
  async function openHtmlReader(regionId: string) {
    const id = activeRef.current; if (!id || busy) return;
    // Reserve the browser tab while the original click still has user activation.
    const browserTab = client.embedded === false ? window.open('about:blank', '_blank') : null;
    if (browserTab) browserTab.opener = null;
    setBusy('reader');
    try {
      const link = await createRegionReaderLink(client, { artifactId: id, regionId, viewId: peerId });
      if (activeRef.current !== id || !mounted.current) { browserTab?.close(); return; }
      setReaderFallback({ artifactId: id, ...link });
      try {
        if (browserTab && !browserTab.closed) browserTab.location.replace(link.url);
        else if (client.openLink) await client.openLink(link.url);
        else { const opened = window.open(link.url, '_blank'); if (!opened) throw new Error('浏览器拦截了新标签。'); opened.opener = null; }
        if (activeRef.current === id) { setReaderSession({ artifactId: id, expiresAt: link.expiresAt }); setReaderFallback(null); }
      } catch (cause) {
        browserTab?.close();
        if (activeRef.current === id) fail(new Error(`${cause instanceof Error ? cause.message : '阅读页未能打开。'} 请点击下方“在新标签打开”。`));
      }
    } catch (cause) { browserTab?.close(); if (activeRef.current === id) fail(cause); }
    finally { if (mounted.current) setBusy(''); }
  }
  useEffect(() => {
    if (!readerSession || readerSession.artifactId !== activeId || readerSession.expiresAt <= Date.now()) return;
    return watchRegionReaderReturn(client, { artifactId: activeId, viewId: peerId }, target => {
      if (activeRef.current !== target.artifactId || target.viewId !== peerId) return;
      const point = locateAnchor({ regionId: target.regionId });
      if (!point) { inform('原区域已移除，请在白板中选择其他区域。'); return; }
      versionSequence.current += 1; suggestionSequence.current += 1; setPreview(null); setSuggestionPreview(null);
      setPanel(null); setCommentOpen(false); setSelectedFeedback(null);
      setAnnotationActive(target.annotate && canComment); inform(target.annotate && canComment ? '已定位原区域，点击图解中的目标添加备注。' : '已定位原区域。');
    });
  }, [readerSession, activeId, client, peerId, canComment]);

  async function createFeedback(event: FormEvent) {
    event.preventDefault(); const current = boardRef.current;
    if (!current || !annotation || !feedbackText.trim() || busy || commentSubmitting.current) return;
    const id = current.artifact.id;
    const fingerprint = JSON.stringify({ id, text: feedbackText.trim(), anchor: annotation.anchor });
    if (commentPending.current?.fingerprint !== fingerprint) commentPending.current = { fingerprint, args: { action: 'create', operationId: newId('comment'), artifactId: id, type: 'comment', text: feedbackText.trim(), anchor: annotation.anchor, versions: annotation.versions, targetViewId: peerId } };
    const pending = commentPending.current;
    commentSubmitting.current = true; setBusy('feedback'); setCommentError('');
    try {
      if (!pending.created) {
        const result = await client.call<{ feedback: Feedback[]; contextId?: string }>('artifact_feedback', pending.args);
        const created = result.feedback.find(item => item.id === result.contextId);
        if (!created) throw new Error('备注已提交，但未取得保存结果，请重试。');
        pending.created = created;
        if (activeRef.current === id) { setFeedback(result.feedback); setSavedComment(created); }
      }
      if (activeRef.current !== id || !mounted.current) return;
      if (attachComment) {
        if (attachContext) await attachContext(pending.created, current);
        else {
          const result = await client.call<{ feedback: Feedback[] }>('artifact_feedback', { action: 'send', artifactId: id, feedbackId: pending.created.id, targetViewId: peerId });
          if (activeRef.current === id) setFeedback(result.feedback);
        }
      }
      if (activeRef.current !== id || !mounted.current) return;
      const created = pending.created, point = annotation.screenPoint;
      resetComment();
      if (!attachComment) setSelectedFeedback({ id: created.id, point });
      inform(attachComment ? attachContext ? '已附加到对话。' : '备注已提交，等待房主附加到对话。' : '备注已保存。');
    } catch (cause) { if (mounted.current && activeRef.current === id) setCommentError(errorText(cause)); }
    finally { commentSubmitting.current = false; if (mounted.current) setBusy(''); }
  }
  async function feedbackAction(action: CommentAction, item: Feedback, args: CommentActionArguments = {}): Promise<Feedback | null> {
    if (busy) throw new Error('正在处理上一项操作，请稍候。');
    setBusy(`feedback:${item.id}`); setError('');
    try {
      const result = await client.call<{ feedback: Feedback[] }>('artifact_feedback', { action, artifactId: item.artifactId, feedbackId: item.id, ...args });
      if (activeRef.current === item.artifactId) { setFeedback(result.feedback); if (action === 'delete' || action === 'resolve') setSelectedFeedback(previous => previous?.id === item.id ? null : previous); }
      if (action === 'send') inform('请求已提交，等待房主附加到对话。');
      return result.feedback.find(entry => entry.id === item.id) || null;
    }
    finally { if (mounted.current) setBusy(''); }
  }
  async function attachFeedback(item: Feedback): Promise<void> {
    const current = boardRef.current; if (!current || busy) throw new Error('正在处理上一项操作，请稍候。');
    if (!attachContext) { await feedbackAction('send', item); return; }
    setBusy(`attach:${item.id}`); setError('');
    try { await attachContext(item, current); inform('已附加到对话。'); }
    finally { if (mounted.current) setBusy(''); }
  }
  async function previewVersion(version: HistoryEntry) {
    const id = activeRef.current; const serial = ++versionSequence.current;
    setPreviewRestoreOpen(false);
    setBusy(`version:${version.id}`); setError('');
    try {
      const result = await client.call<{ board: StudioDocument }>('artifact_read', { artifactId: id, mode: 'version', versionId: version.id });
      if (activeRef.current !== id || serial !== versionSequence.current || !mounted.current) return;
      setPreview({ board: result.board, version });
      return result.board;
    } catch (cause) { fail(cause); }
    finally { if (mounted.current && serial === versionSequence.current) setBusy(''); }
  }
  async function loadHistoryChanges(entry: HistoryBatch): Promise<HistoryUnitDiff[]> {
    const result = await client.call<{ units: HistoryUnitDiff[] }>('artifact_read', { artifactId: activeRef.current, mode: 'diff', ...(entry.beforeVersionId ? { fromVersionId: entry.beforeVersionId, toVersionId: entry.id } : { versionId: entry.id, adjacent: true }) });
    return result.units;
  }
  async function restoreVersion(version = preview?.version, unitId?: string): Promise<boolean> {
    if (!version || busy || !canEdit) return false;
    setBusy('restore-version'); setError('');
    try { await applyOperations([{ op: 'restore', versionId: version.id, ...(unitId ? { id: unitId } : {}) }]); setPreview(null); await refreshBoard(); await loadHistory(); inform(unitId ? '已恢复这一处，并保留其他内容和历史记录。' : '已恢复此版本，并保留后续历史记录。'); return true; }
    catch (cause) { fail(cause); return false; }
    finally { if (mounted.current) setBusy(''); }
  }
  async function changeSharing(action: 'start' | 'stop' | 'reset' | 'link' | 'role' | 'remove', options: { role?: string; on?: boolean; memberId?: string } = {}): Promise<boolean> {
    const id = activeRef.current; if (!id || busy) return false;
    setBusy('share'); setError('');
    try { const result = await client.call<ShareState>('artifact_share', { artifactId: id, action, ...options }); if (activeRef.current === id) setShare(result); return true; }
    catch (cause) { fail(cause, () => { void changeSharing(action, options); }); return false; }
    finally { if (mounted.current) setBusy(''); }
  }
  async function copyLink(link: string) {
    try { await copyPlainText(link); inform('链接已复制。'); }
    catch (cause) { fail(cause); }
  }
  async function copyArtifactLink(artifact: Artifact) {
    if (busy) return;
    setMenuId(''); setBusy(`copy-link:${artifact.id}`);
    try {
      const state = await client.call<ShareState>('artifact_share', { action: 'status', artifactId: artifact.id });
      if (state.enabled && state.links?.viewer) await copyLink(state.links.viewer);
      else {
        openArtifact(artifact.id); setPanel('share'); setShare(state);
        inform('请先开启局域网共享，再复制访问链接。');
      }
    } catch (cause) { fail(cause); }
    finally { if (mounted.current) setBusy(''); }
  }
  async function exportBoard(format: 'png' | 'svg' | 'html' | 'json' | 'zip') {
    const current = boardRef.current; if (!current || busy) return;
    const product = getProduct(current.artifact.type); if (!product) return;
    setBusy('export'); setError('');
    try {
      if (format === 'zip') {
        const result = await client.call<{ filename: string; downloadPath: string }>('artifact_export', { artifactId: current.artifact.id, format });
        await downloadStudioFile(client, result.downloadPath, result.filename);
      } else await product.exportDocument(current, format, client);
      inform('导出已生成。');
    }
    catch (cause) { fail(cause); }
    finally { if (mounted.current) setBusy(''); }
  }

  const visibleArtifacts = useMemo(() => [...artifacts].filter(item => (!query.trim() || item.title.toLowerCase().includes(query.trim().toLowerCase())) && (filter !== 'pinned' || item.pinned)).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)), [artifacts, filter, query]);
  const selectedTrash = new Set(trashSelection), selectedVisible = visibleArtifacts.filter(item => selectedTrash.has(item.id)).length;
  async function previewSuggestion(item: Feedback, operations: ProposalOperation[] | null) {
    const sequence = ++suggestionSequence.current;
    if (!operations) { setSuggestionPreview(null); return; }
    const option = item.proposal?.options.find(value => value.operations === operations);
    if (!option) return;
    try {
      const result = await client.call<{ document: StudioDocument }>('artifact_feedback', { artifactId: item.artifactId, action: 'preview', feedbackId: item.id, optionId: option.id });
      if (sequence === suggestionSequence.current && activeRef.current === item.artifactId) setSuggestionPreview(result.document);
    } catch (cause) { if (sequence === suggestionSequence.current) { setSuggestionPreview(null); fail(cause); } }
  }
  const product = getProduct(board?.artifact.type || products[0]!.id)!;
  const ProductEditor = product.Editor;
  const otherPeers = peers.filter(peer => peer.peerId !== peerId);
  const followedPeer = peers.find(peer => peer.peerId === following);
  const collaboration = client.baseUrl && <div className="studio-presence"><button className="studio-icon-button" aria-label="在线协作" aria-expanded={presenceOpen} onClick={() => setPresenceOpen(previous => !previous)}><Users size={18} />{otherPeers.length > 0 && <small>{otherPeers.length + 1}</small>}</button>{presenceOpen && <div className="studio-presence-menu"><h3>在线协作</h3><p>{otherPeers.length ? `你和 ${otherPeers.length} 位协作者正在这里` : '目前只有你在白板上'}</p>{otherPeers.map(peer => <div className="studio-peer-row" key={peer.peerId}><span className="studio-peer-avatar">{peer.actor.name.slice(0, 1)}</span><span>{peer.actor.name}</span><button className="studio-link-button" disabled={!peer.context?.viewport} onClick={() => { setFollowing(following === peer.peerId ? '' : peer.peerId); setPresenceOpen(false); }}>{following === peer.peerId ? '停止跟随' : '跟随'}</button></div>)}<form className="studio-cursor-chat" onSubmit={sendCursorChat}><label htmlFor="studio-cursor-chat">光标聊天</label><div><input id="studio-cursor-chat" value={cursorChat} onChange={event => setCursorChat(event.target.value)} maxLength={240} placeholder="在光标旁说句话…" /><button className="studio-icon-button" aria-label="发送光标消息" disabled={!cursorChat.trim()}><Send size={14} /></button></div><button type="button" className="studio-link-button" onClick={() => { presenceRef.current.chat = ''; requestPresence.current?.(); }}>清除我的消息</button></form></div>}</div>;

  const activeFeedback = feedback.find(item => item.id === selectedFeedback?.id);
  const closePreview = () => { versionSequence.current += 1; setPreview(null); };
  const historyContent = <div aria-label="版本历史面板"><HistoryPanel history={history} currentRevision={board?.artifact.revision || 0} actor={actor} loading={historyLoading} busy={!!busy} previewId={preview?.version.id} canRestore={canEdit} onRefresh={() => void loadHistory()} onPreview={entry => void previewVersion(entry)} onRestore={restoreVersion} onLoadChanges={loadHistoryChanges} onReturnToCurrent={closePreview} onClose={() => setPanel(null)} /></div>;
  const shareContent = <div aria-label="分享面板"><SharePanel title={board?.artifact.title || '作品'} actor={actor} share={share} busy={!!busy} exportFormats={product.exportFormats} canBackup={canManage} onStart={() => changeSharing('start')} onReset={role => changeSharing('reset', { role })} onStop={() => changeSharing('stop')} onToggleRole={(role, on) => changeSharing('link', { role, on })} onMemberRole={(memberId, role) => changeSharing('role', { memberId, role })} onRemoveMember={memberId => changeSharing('remove', { memberId })} onCopy={link => void copyLink(link)} onExport={format => void exportBoard(format)} extraContent={<div className="studio-editor-secondary"><button className="studio-button studio-text-button" aria-label={resolvedTheme === 'dark' ? '切换为明亮主题' : '切换为暗色主题'} onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>{resolvedTheme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}切换为{resolvedTheme === 'dark' ? '明亮' : '暗色'}主题</button>{collaboration}</div>} /></div>;
  const commentsContent = <CommentsPanel feedback={feedback} actor={actor} busy={!!busy} showResolved={showResolved} onShowResolved={setShowResolved} onOpen={selectFeedback} onAction={feedbackAction} onAttach={attachFeedback} renderSuggestion={item => <SuggestionPanel feedback={item} client={client} artifactId={activeId} onChanged={acceptBoard} onPreview={operations => void previewSuggestion(item, operations)} onRefresh={() => void refreshBoard()} onError={fail} />} />;

  return <div className={`studio ${activeId ? 'studio-editor' : 'studio-library'}`} data-studio-theme={resolvedTheme}>
    {error && <div className="studio-error" role="alert"><AlertCircle size={17} /><span>{error}</span>{retryRef.current && <button onClick={() => { setError(''); retryRef.current?.(); }}>重试</button>}<button className="studio-icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={15} /></button></div>}
    {notice && <div className="studio-notice" role="status"><Check size={15} />{notice}<button className="studio-icon-button" aria-label="关闭通知" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {readerFallback?.artifactId === activeId && <div className="studio-reader-fallback" role="status"><span>请点击链接打开 HTML 阅读页。</span><a href={readerFallback.url} target="_blank" rel="noopener noreferrer" onClick={() => { setReaderSession({ artifactId: activeId, expiresAt: readerFallback.expiresAt }); setReaderFallback(null); }}>在新标签打开</a><button className="studio-icon-button" aria-label="关闭阅读页链接" onClick={() => setReaderFallback(null)}><X size={14} /></button></div>}
    {!activeId ? <main className="studio-library-main">
      <header className="studio-library-header"><div className="studio-library-title">{filter !== 'recent' && <button type="button" className="studio-icon-button" aria-label="返回最近作品" title="返回最近作品" disabled={!!busy} onClick={() => { setFilter('recent'); setQuery(''); }}><ArrowLeft size={21} /></button>}<h1>{filter === 'trash' ? '回收站' : filter === 'pinned' ? '已固定' : '作品'}</h1></div>{canManage && <LibraryToolbar query={query} filter={filter} layout={layout} resolvedTheme={resolvedTheme} busy={!!busy} creating={busy === 'create'} onQueryChange={setQuery} onFilterChange={value => { setFilter(value); setMenuId(''); }} onLayoutChange={value => { setLayout(value); try { localStorage.setItem('agentero-studio-view', value); } catch { /* optional preference */ } }} onThemeChange={setTheme} onCreate={() => void createBoard()} onImport={() => archiveInput.current?.click()} onEmptyTrash={() => void prepareEmptyTrash()} />}</header>
      {canManage ? <>
        {filter !== 'trash' && <section className="studio-create-section" aria-label="新建作品"><h2>新建</h2><div className="studio-product-cards">{products.map(product => <button key={product.id} className="studio-create-card" aria-label={`新建${product.label}`} onClick={() => void createBoard(product.id)} disabled={!!busy}><div className="studio-create-art"><product.Icon size={36} strokeWidth={1.3} /><span className="studio-create-dot studio-create-dot-one" /><span className="studio-create-dot studio-create-dot-two" /></div><span className="studio-create-label">{product.label} <Plus size={16} /></span></button>)}</div></section>}
        <input ref={archiveInput} type="file" accept=".zip,application/zip" hidden aria-label="导入作品" onChange={event => { const file = event.target.files?.[0]; if (file) void importArchive(file); event.target.value = ""; }} />
        <section className="studio-works-section" aria-label={filter === 'trash' ? '回收站作品' : '作品管理'}>
          {filter === 'trash' && (visibleArtifacts.length > 0 || trashSelection.length > 0) && <div className="studio-trash-selection" role="group" aria-label="回收站选择"><label><input type="checkbox" aria-label="全选当前页" disabled={!!busy || !visibleArtifacts.length} checked={visibleArtifacts.length > 0 && selectedVisible === visibleArtifacts.length} ref={node => { if (node) node.indeterminate = selectedVisible > 0 && selectedVisible < visibleArtifacts.length; }} onChange={event => setTrashSelection(previous => event.target.checked ? [...new Set([...previous, ...visibleArtifacts.map(item => item.id)])] : previous.filter(id => !visibleArtifacts.some(item => item.id === id)))} />全选当前页</label><span>{trashSelection.length} 项已选</span><button type="button" className="studio-icon-button" aria-label="永久删除所选作品" title="永久删除所选作品" disabled={!!busy || !trashSelection.length} onClick={() => confirmPurge(trashSelection)}><Trash2 size={17} /></button>{trashSelection.length > 0 && <button type="button" className="studio-icon-button" aria-label="清除选择" title="清除选择" disabled={!!busy} onClick={() => setTrashSelection([])}><X size={15} /></button>}</div>}
          {(purgeError || purgeFailures.length > 0) && <div className="studio-trash-errors" role="alert">{purgeError && <p>{purgeError}</p>}{purgeFailures.length > 0 && <><strong>{purgeFailures.length} 项作品未删除，已保留选择。</strong><ul>{purgeFailures.map(item => <li key={item.artifactId}><span>{item.title}</span><span>{item.message}</span></li>)}</ul></>}</div>}
          {libraryLoading && !libraryLoaded ? <div className="studio-empty"><Loader2 size={26} className="studio-spin" /><p>正在读取作品</p></div> : libraryLoaded && visibleArtifacts.length === 0 ? <div className="studio-empty">{filter === 'trash' ? <Trash2 size={32} /> : <LayoutGrid size={32} />}<h3>{query ? '没有找到匹配的作品' : filter === 'trash' ? '回收站为空' : filter === 'pinned' ? '还没有固定作品' : '从第一块白板开始'}</h3><p>{query ? '试试其他名称。' : filter === 'trash' ? '移入回收站的作品可以在这里恢复。' : filter === 'pinned' ? '把常用作品固定在这里，方便再次打开。' : '先创建一块空白白板，再与 Codex 一起整理思路。'}</p>{!query && filter === 'recent' && <button className="studio-button" onClick={() => void createBoard()} disabled={!!busy}><Plus size={16} />新建白板</button>}</div> : <div className={`studio-artifacts studio-artifacts-${layout}`} aria-busy={libraryLoading}>
            {visibleArtifacts.map(artifact => <article className={`studio-artifact ${artifact.trashedAt ? 'studio-artifact-trashed' : ''}${selectedTrash.has(artifact.id) ? ' is-selected' : ''}`} key={artifact.id}>
              {artifact.trashedAt && <label className="studio-trash-select"><input type="checkbox" aria-label={`选择作品：${artifact.title}`} checked={selectedTrash.has(artifact.id)} disabled={!!busy} onChange={event => setTrashSelection(previous => event.target.checked ? [...new Set([...previous, artifact.id])] : previous.filter(id => id !== artifact.id))} /></label>}
              <button className="studio-artifact-open" aria-label={`打开${getProduct(artifact.type)?.label || "作品"}：${artifact.title}`} disabled={!!artifact.trashedAt} onClick={() => openArtifact(artifact.id)}>{layout === 'grid' && <ArtifactPreview artifact={artifact} cached={cachedBoards[artifact.id]} client={client} />}<div className="studio-artifact-details"><span className="studio-artifact-icon"><ProductGlyph type={artifact.type} /></span><div className="studio-artifact-copy"><h3 title={artifact.title}>{artifact.title}</h3><p>{filter === 'trash' ? `移入时间 ${new Date(artifact.trashedAt || artifact.updatedAt).toLocaleDateString('zh-CN')}` : relativeTime(artifact.updatedAt)}</p></div></div></button>
              <div className="studio-artifact-actions">{artifact.trashedAt ? <><button type="button" className="studio-icon-button" aria-label={`恢复作品：${artifact.title}`} title="恢复" onClick={() => void manageArtifact('restore', artifact)} disabled={!!busy}><RotateCcw size={17} /></button><button type="button" className="studio-icon-button" aria-label={`永久删除作品：${artifact.title}`} title="永久删除" disabled={!!busy} onClick={() => confirmPurge([artifact.id])}><Trash2 size={17} /></button></> : <>{artifact.pinned && <Pin size={15} className="studio-pin-mark" aria-label="已固定" />}<LibraryArtifactMenu artifact={artifact} open={menuId === artifact.id} busy={!!busy} onOpenChange={open => setMenuId(open ? artifact.id : '')} onPin={() => void manageArtifact('pin', artifact, { pinned: !artifact.pinned })} onRename={() => { setRename({ artifact, title: artifact.title }); setMenuId(''); }} onCopyLink={() => void copyArtifactLink(artifact)} onDuplicate={() => void manageArtifact('duplicate', artifact)} onTrash={() => void manageArtifact('trash', artifact)} /></>}
              </div>
            </article>)}
          </div>}
          {nextCursor && <div className="studio-load-more"><button className="studio-button" disabled={libraryLoading} onClick={() => void loadLibrary(nextCursor)}>{libraryLoading && <Loader2 className="studio-spin" size={16} />}加载更多</button></div>}
        </section>
      </> : <div className="studio-empty"><Share2 size={30} /><h3>从分享链接打开白板</h3><p>此页面仅显示你获准访问的作品。</p></div>}
    </main> : <>
      <header className="studio-editor-header"><div className="studio-editor-title">{canManage ? <button className="studio-icon-button" aria-label="返回作品中心" onClick={goHome}><ArrowLeft size={20} /></button> : <Share2 size={22} className="studio-guest-brand" />}<input aria-label={`${product.label}名称`} value={titleDraft} readOnly={!canManage || !!preview} onChange={event => setTitleDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { skipTitleBlur.current = true; setTitleDraft(boardRef.current?.artifact.title || ''); event.currentTarget.blur(); } }} onBlur={() => { if (skipTitleBlur.current) { skipTitleBlur.current = false; return; } const title = titleDraft.trim(); if (board && title && title !== board.artifact.title) void manageArtifact('rename', board.artifact, { title }); else if (!title) setTitleDraft(board?.artifact.title || ''); }} /><span className={`studio-save-status ${sync === 'reconnecting' ? 'studio-save-warning' : ''}`} role="status">{sync === 'loading' ? <Loader2 size={13} className="studio-spin" /> : sync === 'reconnecting' ? <RefreshCw size={13} /> : <Check size={13} />}{sync === 'loading' ? '加载中' : sync === 'reconnecting' ? '正在重连' : canEdit ? '已保存' : '只读'}</span></div><div className="studio-editor-actions">
        <div className="studio-editor-popover-anchor"><button ref={historyButton} className={`studio-icon-button${panel === 'history' ? ' is-active' : ''}`} aria-label="版本历史" title="版本历史" aria-expanded={panel === 'history'} onClick={() => togglePanel('history')}><Clock3 size={20} /></button>{panel === 'history' && <EditorPopover title="版本历史" className="studio-history-popover" hideHeading anchorRef={historyButton} onClose={() => setPanel(null)}>{historyContent}</EditorPopover>}</div>
        <div className="studio-editor-popover-anchor"><button ref={shareButton} className={`studio-button studio-text-button${panel === 'share' ? ' is-active' : ''}`} aria-label="分享" aria-expanded={panel === 'share'} onClick={() => togglePanel('share')}><Share2 size={19} /><span>分享</span></button>{panel === 'share' && <EditorPopover title={board?.artifact.title || '分享作品'} className="studio-share-popover" anchorRef={shareButton} onClose={() => setPanel(null)}>{shareContent}</EditorPopover>}</div>
        <div className="studio-comment-mode-control"><button className={`studio-icon-button${annotationActive ? ' is-active' : ''}`} aria-label="备注" title="点击目标添加备注" aria-pressed={annotationActive} disabled={!board || !canComment || !!preview || !!suggestionPreview} onClick={() => { setPanel(null); setAnnotationActive(previous => !previous); if (annotation && feedbackText.trim()) setCommentOpen(true); }}><MessageSquare size={20} fill={annotationActive ? 'currentColor' : 'none'} /></button><div className="studio-editor-popover-anchor"><button ref={commentsButton} className="studio-icon-button studio-comment-dropdown" aria-label="备注列表" title="备注列表" aria-expanded={panel === 'feedback'} onClick={() => togglePanel('feedback')}><ChevronDown size={15} />{feedback.some(item => item.status !== 'resolved') && <span className="studio-unread-dot" />}</button>{panel === 'feedback' && <EditorPopover title="所有备注" className="studio-comments-panel" anchorRef={commentsButton} onClose={() => setPanel(null)}>{commentsContent}</EditorPopover>}</div></div>
      </div></header>
      {preview && <div className="studio-preview-banner"><Clock3 size={16} /><span>正在预览版本 {preview.version.revision}，当前白板未改变。</span><button className="studio-button studio-compact" onClick={closePreview}>退出预览</button>{canEdit && <button className="studio-button studio-primary studio-compact" disabled={!!busy} onClick={() => setPreviewRestoreOpen(true)}><RotateCcw size={14} />恢复此版本</button>}</div>}
      {previewRestoreOpen && preview && <StudioDialog title="恢复此版本？" onClose={() => { if (!busy) setPreviewRestoreOpen(false); }}><p>将整个作品恢复到版本 {preview.version.revision}。恢复会创建新版本，已有历史记录将保留。</p><div className="studio-modal-footer"><button type="button" className="studio-button" disabled={!!busy} onClick={() => setPreviewRestoreOpen(false)}>取消</button><button type="button" className="studio-button studio-primary" disabled={!!busy} onClick={() => { void restoreVersion().then(restored => { if (restored) setPreviewRestoreOpen(false); }); }}>确认恢复</button></div></StudioDialog>}
      {following && <div className="studio-follow-banner"><Users size={14} /><span>正在跟随 {followedPeer?.actor.name || "协作者"} 的视角</span><button className="studio-link-button" onClick={() => setFollowing('')}>停止跟随</button></div>}
      <div className="studio-workspace"><div ref={canvasArea} className="studio-canvas-area">{board ? <ProductEditor key={board.artifact.id} document={preview?.board || suggestionPreview || board} client={client} actor={actor} onChanged={acceptBoard} onAnnotate={annotate} onError={fail} onNotice={inform} readOnly={!canEdit || !!preview || !!suggestionPreview} annotationActive={annotationActive && !preview && !suggestionPreview} annotationTarget={commentOpen && annotation ? annotation.anchor : activeFeedback?.anchor} onAnnotationModeChange={setAnnotationActive} onSelectionChange={selectionChanged} onActivityChange={editorActivityChanged} activities={feedback.filter(item => item.status !== 'resolved' || showResolved)} onFeedbackSelect={selectFeedback} onOpenHtml={regionId => void openHtmlReader(regionId)} documentControls={client.baseUrl && <TimerControl timer={roomTimer} canEdit={canEdit && !preview && !suggestionPreview} busy={timerBusy} onAction={(action, duration, delta) => void changeTimer(action, duration, delta)} />} onViewportChange={viewportChanged} onCursorMove={cursorMoved} presence={peers} selfPeerId={peerId} externalViewport={followedPeer?.context?.viewport || targetViewport} externalSelectedIds={targetSelection} /> : <div className="studio-empty"><Loader2 size={28} className="studio-spin" /><p>{error ? '作品暂时无法读取' : '正在打开作品'}</p>{error && <button className="studio-button" onClick={() => void refreshBoard()}><RefreshCw size={16} />重新加载</button>}</div>}</div></div>
      {commentOpen && annotation && canComment && <CommentPopover point={annotation.screenPoint} locate={() => commentPoint(annotation.anchor, undefined, annotation.screenPoint)} draft pinLabel={actor.name} label={annotation.label} onClose={() => setCommentOpen(false)} onOutside={() => { if (!feedbackText.trim() && !savedComment) setCommentOpen(false); }}><CommentComposer text={feedbackText} attach={attachComment} busy={busy === 'feedback'} saved={!!savedComment} error={commentError} onTextChange={setFeedbackText} onAttachChange={setAttachComment} onSubmit={event => void createFeedback(event)} /></CommentPopover>}
      {activeFeedback && selectedFeedback && <CommentPopover point={selectedFeedback.point} locate={() => commentPoint(activeFeedback.anchor, activeFeedback.id, selectedFeedback.point)} onClose={() => setSelectedFeedback(null)}><CommentThread feedback={activeFeedback} actor={actor} busy={!!busy} onAction={feedbackAction} onAttach={attachFeedback} onClose={() => setSelectedFeedback(null)} replyText={replies[activeFeedback.id] || ''} onReplyTextChange={value => setReplies(previous => ({ ...previous, [activeFeedback.id]: value }))} /></CommentPopover>}    </>}
    {purgeConfirmation && <StudioDialog title={purgeConfirmation.all ? '清空回收站' : '永久删除作品'} onClose={() => { if (!purgeRunning.current) setPurgeConfirmation(null); }}><p>将永久删除 {purgeConfirmation.targets.length} 项作品，此操作无法恢复。</p>{purgeConfirmation.targets.length === 1 && <p className="studio-purge-target">{purgeConfirmation.targets[0]!.title}</p>}<div className="studio-modal-footer"><button type="button" className="studio-button" disabled={!!busy} onClick={() => setPurgeConfirmation(null)}>取消</button><button type="button" className="studio-button studio-purge-confirm" disabled={!!busy} onClick={() => void purgeArtifacts()}>{busy === 'purge' ? <Loader2 className="studio-spin" size={15} /> : <Trash2 size={15} />}{busy === 'purge' ? '正在删除…' : purgeConfirmation.all ? '清空回收站' : '永久删除'}</button></div></StudioDialog>}
    {rename && <StudioDialog title="重命名作品" onClose={() => setRename(null)}><form onSubmit={event => { event.preventDefault(); if (rename.title.trim()) void manageArtifact('rename', rename.artifact, { title: rename.title.trim() }); }}><label className="studio-field-label" htmlFor="studio-rename-title">作品名称</label><input className="studio-text-field" id="studio-rename-title" maxLength={200} value={rename.title} onChange={event => setRename(previous => previous ? { ...previous, title: event.target.value } : null)} /><div className="studio-modal-footer"><button type="button" className="studio-button" onClick={() => setRename(null)}>取消</button><button className="studio-button studio-primary" type="submit" disabled={!rename.title.trim() || !!busy}>保存</button></div></form></StudioDialog>}

  </div>;
}
