import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowLeft, Check, CheckCheck, ChevronDown, Clock3, Copy, Download, FileCode2, LayoutGrid, List, Loader2, MessageSquare, Monitor, Moon, MoreHorizontal, Pin, Plus, RefreshCw, RotateCcw, Search, Send, Share2, Sun, Trash2, Users, X } from 'lucide-react';
import type { Actor, Artifact, Feedback, HistoryEntry, Operation, Presence, RoomTimer, StudioClient, ViewContext } from '../contracts/studio';
import { getProduct, products, type ProductActivity, type ProductAnnotation, type StudioDocument } from './products';
import { StudioDialog } from './products/dialog';
import './studio.css';
import { SuggestionPanel } from './SuggestionPanel';
import type { ProposalOperation } from '../contracts/proposals';

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
interface ShareState { enabled: boolean; links?: Partial<Record<'editor' | 'commenter' | 'viewer', string>>; [key: string]: unknown }
interface VersionDiff { changes?: { id: string; before?: unknown; after?: unknown }[]; [key: string]: unknown }
interface ListResult { artifacts: Artifact[]; nextCursor?: string }
interface ManageResult { artifact: Artifact; board?: StudioDocument }

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
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
function newId(prefix: string): string { return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`; }
function emptyActivity(): ProductActivity { return { editingIds: [], movingIds: [], dirty: false, issues: [] }; }
function initialPresence() { return { selectedIds: [] as string[], viewport: { x: 0, y: 0, zoom: 1 }, cursor: undefined as { x: number; y: number } | undefined, chat: '', following: '', ...emptyActivity() }; }
type TimerAction = 'start' | 'pause' | 'resume' | 'reset';
function SharedTimer({ timer, canEdit, busy, onAction }: { timer: RoomTimer | null; canEdit: boolean; busy: boolean; onAction: (action: TimerAction, durationSeconds?: number) => void }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let interval: number | undefined;
    const update = () => { setNow(Date.now()); if (timer?.deadline !== null && timer?.deadline !== undefined && timer.deadline <= Date.now()) { window.clearInterval(interval); interval = undefined; } };
    const visibility = () => { window.clearInterval(interval); interval = undefined; if (document.visibilityState === 'hidden') return; update(); if (timer && !timer.paused && timer.deadline !== null && timer.deadline > Date.now()) interval = window.setInterval(update, 1000); };
    visibility(); document.addEventListener('visibilitychange', visibility);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', visibility); };
  }, [timer?.deadline, timer?.paused, timer?.remainingMs]);
  const remaining = timer ? Math.max(0, timer.paused || timer.deadline === null ? timer.remainingMs : timer.deadline - now) : 0;
  const seconds = Math.ceil(remaining / 1000), label = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return <section className="studio-room-timer" aria-label="共享计时器"><div className="studio-timer-heading"><strong><Clock3 size={14} />共享计时器</strong>{timer && <span>{remaining === 0 ? '已结束' : timer.paused ? '已暂停' : '计时中'}</span>}</div>{timer ? <><output className="studio-timer-countdown" aria-label="剩余时间">{label}</output><small>{timer.source.name || '协作者'}{timer.paused ? '暂停了计时' : '设置了计时'}</small>{canEdit && <div className="studio-timer-actions"><button className="studio-button studio-compact" disabled={busy || remaining === 0} onClick={() => onAction(timer.paused ? 'resume' : 'pause')}>{timer.paused ? '继续' : '暂停'}</button><button className="studio-link-button" disabled={busy} onClick={() => onAction('reset')}>重置</button></div>}</> : <p>为所有协作者设置倒计时。</p>}{canEdit && <div className="studio-timer-presets">{[1, 5, 10, 15].map(minutes => <button className="studio-button studio-compact" key={minutes} disabled={busy} onClick={() => onAction('start', minutes * 60)}>{minutes} 分钟</button>)}</div>}</section>;
}

function ArtifactPreview({ artifact, cached, client }: { artifact: Artifact; cached?: StudioDocument; client: StudioClient }) {
  const Preview = getProduct(artifact.type)?.Preview;
  return Preview ? <Preview artifact={artifact} cached={cached} client={client} /> : <div className="studio-artifact-preview studio-blank-preview">暂无预览</div>;
}
function ProductGlyph({ type, size = 22 }: { type: string; size?: number }) { const Icon = getProduct(type)?.Icon || FileCode2; return <Icon size={size} />; }

export default function StudioApp({ client, actor, initialArtifactId, initialView, navigationRevision, onViewContext, attachContext }: StudioAppProps) {
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
  const [rename, setRename] = useState<{ artifact: Artifact; title: string } | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackType, setFeedbackType] = useState<'comment' | 'request'>('comment');
  const [annotation, setAnnotation] = useState<ProductAnnotation | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [showResolved, setShowResolved] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [preview, setPreview] = useState<{ board: StudioDocument; version: HistoryEntry; diff: VersionDiff | null } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [share, setShare] = useState<ShareState | null>(null);
  const [exportMenu, setExportMenu] = useState(false);
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
    const close = (event: PointerEvent) => { if (!(event.target as Element | null)?.closest('.studio-menu-anchor')) { setMenuId(''); setExportMenu(false); } };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuId(''); setExportMenu(false); } };
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

  useEffect(() => {
    if (!activeId) return;
    setSync('loading'); void refreshBoard(activeId);
  }, [activeId, refreshBoard]);

  useEffect(() => {
    if (!activeId) return;
    let stream: EventSource | undefined;
    let reconnecting = false;
    const refresh = () => { if (document.visibilityState !== 'hidden') void refreshBoard(activeId); };
    const connect = () => {
      stream?.close(); stream = undefined;
      if (document.visibilityState === 'hidden' || !client.baseUrl || typeof EventSource === 'undefined') return;
      const url = new URL('/api/events', client.baseUrl); url.searchParams.set('artifactId', activeId);
      if (client.token) url.searchParams.set('token', client.token);
      stream = new EventSource(url.href);
      stream.addEventListener('change', refresh);
      stream.onmessage = event => { if (activeRef.current !== activeId) return; try { const message = JSON.parse(event.data); if (message.artifactId && message.artifactId !== activeId) return; if (message.type === 'presence' && Array.isArray(message.peers)) { setPeers(message.peers); if ('timer' in message) setRoomTimer(message.timer); } else refresh(); } catch { refresh(); } };
      stream.onopen = () => { if (activeRef.current !== activeId) return; if (reconnecting) refresh(); reconnecting = false; setSync(boardRef.current ? 'saved' : 'loading'); };
      stream.onerror = () => { if (activeRef.current !== activeId) return; reconnecting = true; setSync('reconnecting'); };
    };
    const visibility = () => { connect(); if (document.visibilityState !== 'hidden') refresh(); };
    connect();
    const poll = window.setInterval(() => { if (!stream || reconnecting) refresh(); }, 7000);
    document.addEventListener('visibilitychange', visibility);
    return () => { stream?.close(); window.clearInterval(poll); document.removeEventListener('visibilitychange', visibility); };
  }, [activeId, client, refreshBoard]);

  useEffect(() => {
    if (!activeId || !client.baseUrl) return;
    const url = new URL('/api/presence', client.baseUrl); url.searchParams.set('artifactId', activeId);
    let stopped = false; let pending: number | undefined; let lastSent = 0;
    const send = async (leave = false) => {
      if (!leave && (stopped || document.visibilityState === 'hidden')) return;
      lastSent = Date.now();
      const state = presenceRef.current;
      try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(client.token ? { Authorization: `Bearer ${client.token}` } : {}) }, body: JSON.stringify({ artifactId: activeId, peerId, ...(leave ? { leave: true } : { context: { viewId: peerId, artifactId: activeId, selectedIds: state.selectedIds, viewport: state.viewport, editingIds: state.editingIds, movingIds: state.movingIds, dirty: state.dirty, issues: state.issues }, cursor: state.cursor, chat: state.chat, following: state.following }) }), keepalive: leave });
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
  async function changeTimer(action: TimerAction, durationSeconds?: number) {
    const id = activeRef.current; if (!id || !canEdit || timerBusy || !client.baseUrl) return;
    setTimerBusy(true);
    try {
      const url = new URL('/api/presence', client.baseUrl);
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(client.token ? { Authorization: `Bearer ${client.token}` } : {}) }, body: JSON.stringify({ artifactId: id, peerId, timer: { action, ...(durationSeconds !== undefined ? { durationSeconds } : {}) } }) });
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
    try { const result = await client.call<{ history: HistoryEntry[] }>('artifact_read', { artifactId: id, mode: 'history' }); if (activeRef.current === id && mounted.current) setHistory([...result.history].sort((a, b) => b.revision - a.revision)); }
    catch (cause) { fail(cause, () => { void loadHistory(); }); }
    finally { if (mounted.current && activeRef.current === id) setHistoryLoading(false); }
  }, [client, fail]);
  const loadShare = useCallback(async () => {
    const id = activeRef.current; if (!id) return;
    try { const result = await client.call<ShareState>('artifact_share', { action: 'status', artifactId: id }); if (activeRef.current === id && mounted.current) setShare(result); }
    catch (cause) { fail(cause, () => { void loadShare(); }); }
  }, [client, fail]);
  useEffect(() => { if (panel === 'history') void loadHistory(); }, [panel, board?.artifact.revision, loadHistory]);
  useEffect(() => { if (panel === 'share') void loadShare(); }, [panel, loadShare]);

  function openArtifact(id: string, ready?: StudioDocument) {
    versionSequence.current += 1; activeRef.current = id; boardRef.current = null;
    presenceRef.current = initialPresence(); activitySources.current = { editor: emptyActivity(), toolbar: emptyActivity() };
    setRoomTimer(null); setTimerBusy(false); publishViewContext();
    setActiveId(id); setBoard(null); setFeedback([]); setPreview(null); setSuggestionPreview(null); suggestionSequence.current += 1; setPanel(null); setSelectedIds([]); setAnnotation(null); setError(''); setMenuId(''); setPeers([]); setFollowing(''); setPresenceOpen(false);
    if (ready) acceptBoard(ready);
  }
  function goHome() {
    activeRef.current = ''; boardRef.current = null; versionSequence.current += 1;
    presenceRef.current = initialPresence(); activitySources.current = { editor: emptyActivity(), toolbar: emptyActivity() };
    setRoomTimer(null); setTimerBusy(false); publishViewContext();
    setActiveId(''); setBoard(null); setPreview(null); setSuggestionPreview(null); suggestionSequence.current += 1; setPanel(null); setAnnotation(null); setSelectedIds([]); setError(''); setPeers([]); setFollowing(''); setPresenceOpen(false);
  }
  async function importArchive(file: File) {
    if (!canManage || busy) return;
    if (file.size > 128 * 1024 * 1024) { fail(new Error('作品备份超过 128 MB。')); return; }
    setBusy('import'); setError('');
    try {
      const response = await fetch(`${client.baseUrl}/api/import`, { method: 'POST', headers: { Authorization: `Bearer ${client.token}`, 'Content-Type': 'application/zip' }, body: file });
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
  async function applyOperations(operations: Operation[], expectedVersions?: Record<string, number>) {
    const current = boardRef.current; if (!current) return;
    const result = await client.call<{ board: StudioDocument }>('artifact_apply', { artifactId: current.artifact.id, operationId: newId('op'), expectedRevision: current.artifact.revision, expectedVersions, operations });
    acceptBoard(result.board); return result.board;
  }
  function togglePanel(next: Panel) { setPanel(previous => previous === next ? null : next); }
  function annotate(selection: ProductAnnotation) { setAnnotation(selection); setFeedbackType('comment'); setPanel('feedback'); }

  async function createFeedback(event: FormEvent) {
    event.preventDefault(); const current = boardRef.current;
    if (!current || !feedbackText.trim() || busy) return;
    const id = current.artifact.id;
    const target = annotation || getProduct(current.artifact.type)?.selectionContext(current, selectedIds) || { anchor: { elementIds: selectedIds } };
    const anchor = target.anchor; const versions = 'versions' in target ? target.versions : undefined;
    setBusy('feedback'); setError('');
    try {
      const existing = new Set(feedback.map(item => item.id));
      let result = await client.call<{ feedback: Feedback[] }>('artifact_feedback', { action: 'create', artifactId: id, type: feedbackType, text: feedbackText.trim(), anchor, versions, targetViewId: peerId });
      const created = result.feedback.find(item => !existing.has(item.id));
      if (feedbackType === 'request' && created) result = await client.call<{ feedback: Feedback[] }>('artifact_feedback', { action: 'send', artifactId: id, feedbackId: created.id });
      if (activeRef.current === id) { setFeedback(result.feedback); setFeedbackText(''); setAnnotation(null); }
      inform(feedbackType === 'request' ? attachContext ? '请求已保存，可附加到当前对话。' : '请求已提交，等待房主附加到对话。' : '批注已保存。');
    } catch (cause) { fail(cause); }
    finally { if (mounted.current) setBusy(''); }
  }
  async function feedbackAction(action: 'reply' | 'resolve' | 'reopen' | 'send', item: Feedback) {
    if (busy) return;
    setBusy(`feedback:${item.id}`); setError('');
    try {
      const result = await client.call<{ feedback: Feedback[] }>('artifact_feedback', { action, artifactId: item.artifactId, feedbackId: item.id, ...(action === 'reply' ? { text: replies[item.id]?.trim() } : {}) });
      if (activeRef.current === item.artifactId) { setFeedback(result.feedback); if (action === 'reply') setReplies(previous => ({ ...previous, [item.id]: '' })); }
      if (action === 'send') inform('请求已提交，等待房主附加到对话。');
    } catch (cause) { fail(cause); }
    finally { if (mounted.current) setBusy(''); }
  }
  async function attachFeedback(item: Feedback) {
    const current = boardRef.current; if (!current || busy) return;
    if (!attachContext) { await feedbackAction('send', item); return; }
    setBusy(`attach:${item.id}`); setError('');
    try { await attachContext(item, current); inform('已附加到对话草稿，请在对话中发送。'); }
    catch (cause) { fail(cause, () => { void attachFeedback(item); }); }
    finally { if (mounted.current) setBusy(''); }
  }
  async function previewVersion(version: HistoryEntry) {
    const id = activeRef.current; const serial = ++versionSequence.current;
    setBusy(`version:${version.id}`); setError('');
    try {
      const results = await Promise.allSettled([
        client.call<{ board: StudioDocument }>('artifact_read', { artifactId: id, mode: 'version', versionId: version.id }),
        client.call<VersionDiff>('artifact_read', { artifactId: id, mode: 'diff', versionId: version.id }),
      ]);
      if (activeRef.current !== id || serial !== versionSequence.current || !mounted.current) return;
      if (results[0].status === 'rejected') throw results[0].reason;
      setPreview({ board: results[0].value.board, version, diff: results[1].status === 'fulfilled' ? results[1].value : null });
    } catch (cause) { fail(cause); }
    finally { if (mounted.current && serial === versionSequence.current) setBusy(''); }
  }
  async function restoreVersion() {
    if (!preview || busy) return;
    setBusy('restore-version'); setError('');
    try { await applyOperations([{ op: 'restore', versionId: preview.version.id }]); setPreview(null); await refreshBoard(); await loadHistory(); inform('已恢复此版本，并保留后续历史记录。'); }
    catch (cause) { fail(cause); }
    finally { if (mounted.current) setBusy(''); }
  }
  async function changeSharing(action: 'start' | 'stop' | 'reset', role?: string) {
    const id = activeRef.current; if (!id || busy) return;
    setBusy('share'); setError('');
    try { const result = await client.call<ShareState>('artifact_share', { artifactId: id, action, ...(role ? { role } : {}) }); if (activeRef.current === id) setShare(result); }
    catch (cause) { fail(cause, () => { void changeSharing(action, role); }); }
    finally { if (mounted.current) setBusy(''); }
  }
  async function copyLink(link: string) {
    try { await navigator.clipboard.writeText(link); inform('链接已复制。'); }
    catch { fail(new Error('浏览器没有允许复制。可以选择链接文本后手动复制。')); }
  }
  async function exportBoard(format: 'png' | 'svg' | 'html' | 'json' | 'zip') {
    const current = boardRef.current; if (!current || busy) return;
    const product = getProduct(current.artifact.type); if (!product) return;
    setExportMenu(false); setBusy('export'); setError('');
    try {
      if (format === 'zip') {
        const result = await client.call<{ filename: string; downloadPath: string }>('artifact_export', { artifactId: current.artifact.id, format });
        const download = new URL(result.downloadPath, client.baseUrl || location.href); if (client.token) download.searchParams.set('token', client.token);
        const link = document.createElement('a'); link.href = download.href; link.download = result.filename; link.rel = 'noopener'; document.body.append(link); link.click(); link.remove();
      } else await product.exportDocument(current, format, client);
      inform('导出已生成。');
    }
    catch (cause) { fail(cause); }
    finally { if (mounted.current) setBusy(''); }
  }

  const visibleArtifacts = useMemo(() => [...artifacts].filter(item => (!query.trim() || item.title.toLowerCase().includes(query.trim().toLowerCase())) && (filter !== 'pinned' || item.pinned)).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)), [artifacts, filter, query]);
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
  const visibleFeedback = feedback.filter(item => showResolved || item.status !== 'resolved');
  const product = getProduct(board?.artifact.type || products[0]!.id)!;
  const ProductEditor = product.Editor; const ProductToolbar = product.Toolbar; const ProductDifference = product.Difference;
  const ThemeIcon = theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun;
  const otherPeers = peers.filter(peer => peer.peerId !== peerId);
  const followedPeer = peers.find(peer => peer.peerId === following);
  const collaboration = client.baseUrl && <div className="studio-presence"><button className="studio-icon-button" aria-label="在线协作" aria-expanded={presenceOpen} onClick={() => setPresenceOpen(previous => !previous)}><Users size={18} />{otherPeers.length > 0 && <small>{otherPeers.length + 1}</small>}</button>{presenceOpen && <div className="studio-presence-menu"><h3>在线协作</h3><p>{otherPeers.length ? `你和 ${otherPeers.length} 位协作者正在这里` : '目前只有你在白板上'}</p>{otherPeers.map(peer => <div className="studio-peer-row" key={peer.peerId}><span className="studio-peer-avatar">{peer.actor.name.slice(0, 1)}</span><span>{peer.actor.name}</span><button className="studio-link-button" disabled={!peer.context?.viewport} onClick={() => { setFollowing(following === peer.peerId ? '' : peer.peerId); setPresenceOpen(false); }}>{following === peer.peerId ? '停止跟随' : '跟随'}</button></div>)}<SharedTimer timer={roomTimer} canEdit={canEdit} busy={timerBusy} onAction={(action, duration) => { void changeTimer(action, duration); }} /><form className="studio-cursor-chat" onSubmit={sendCursorChat}><label htmlFor="studio-cursor-chat">光标聊天</label><div><input id="studio-cursor-chat" value={cursorChat} onChange={event => setCursorChat(event.target.value)} maxLength={240} placeholder="在光标旁说句话…" /><button className="studio-icon-button" aria-label="发送光标消息" disabled={!cursorChat.trim()}><Send size={14} /></button></div><button type="button" className="studio-link-button" onClick={() => { presenceRef.current.chat = ''; requestPresence.current?.(); }}>清除我的消息</button></form></div>}</div>;

  return <div className={`studio ${activeId ? 'studio-editor' : 'studio-library'}`} data-studio-theme={resolvedTheme}>
    {error && <div className="studio-error" role="alert"><AlertCircle size={17} /><span>{error}</span>{retryRef.current && <button onClick={() => { setError(''); retryRef.current?.(); }}>重试</button>}<button className="studio-icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={15} /></button></div>}
    {notice && <div className="studio-notice" role="status"><Check size={15} />{notice}<button className="studio-icon-button" aria-label="关闭通知" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {!activeId ? <main className="studio-library-main">
      <header className="studio-library-header"><div><span className="studio-brand">AGENTERO STUDIO</span><h1>作品</h1></div><div className="studio-header-actions"><label className="studio-theme-control"><ThemeIcon size={16} /><select aria-label="主题" value={theme} onChange={event => setTheme(event.target.value as Theme)}><option value="system">跟随主题</option><option value="light">明亮</option><option value="dark">暗色</option></select></label>{canManage && <button className="studio-button studio-primary" onClick={() => void createBoard()} disabled={!!busy}>{busy === 'create' ? <Loader2 className="studio-spin" size={17} /> : <Plus size={17} />}新建白板</button>}</div></header>
      {canManage ? <>
        {filter !== 'trash' && <section className="studio-create-section" aria-label="新建作品"><h2>新建</h2><div className="studio-product-cards">{products.map(product => <button key={product.id} className="studio-create-card" onClick={() => void createBoard(product.id)} disabled={!!busy}><div className="studio-create-art"><product.Icon size={42} strokeWidth={1.3} /><span className="studio-create-dot studio-create-dot-one" /><span className="studio-create-dot studio-create-dot-two" /></div><span className="studio-create-label">{product.label} <Plus size={17} /></span></button>)}</div></section>}
        <section className="studio-works-section" aria-label="作品管理"><div className="studio-library-toolbar"><button className="studio-button" onClick={() => archiveInput.current?.click()} disabled={!!busy}>{"\u5bfc\u5165\u4f5c\u54c1"}</button><input ref={archiveInput} type="file" accept=".zip,application/zip" hidden aria-label={"\u5bfc\u5165\u4f5c\u54c1"} onChange={event => { const file = event.target.files?.[0]; if (file) void importArchive(file); event.target.value = ""; }} /><nav className="studio-tabs" aria-label="作品范围">{([['recent', '最近作品'], ['pinned', '已固定'], ['trash', '回收站']] as const).map(([value, label]) => <button key={value} aria-current={filter === value ? 'page' : undefined} onClick={() => { setFilter(value); setMenuId(''); }}>{value === 'pinned' ? <Pin size={15} /> : value === 'trash' ? <Trash2 size={15} /> : null}{label}</button>)}</nav><div className="studio-library-controls"><label className="studio-search"><Search size={17} /><input aria-label="搜索作品" placeholder="搜索作品" value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label="清除搜索" className="studio-icon-button" onClick={() => setQuery('')}><X size={14} /></button>}</label><div className="studio-view-switch" aria-label="视图"><button className="studio-icon-button" aria-label="卡片视图" aria-pressed={layout === 'grid'} onClick={() => { setLayout('grid'); try { localStorage.setItem('agentero-studio-view', 'grid'); } catch { /* optional preference */ } }}><LayoutGrid size={18} /></button><button className="studio-icon-button" aria-label="列表视图" aria-pressed={layout === 'list'} onClick={() => { setLayout('list'); try { localStorage.setItem('agentero-studio-view', 'list'); } catch { /* optional preference */ } }}><List size={19} /></button></div></div></div>
          {libraryLoading && !libraryLoaded ? <div className="studio-empty"><Loader2 size={26} className="studio-spin" /><p>正在读取作品</p></div> : libraryLoaded && visibleArtifacts.length === 0 ? <div className="studio-empty">{filter === 'trash' ? <Trash2 size={32} /> : <LayoutGrid size={32} />}<h3>{query ? '没有找到匹配的作品' : filter === 'trash' ? '回收站为空' : filter === 'pinned' ? '还没有固定作品' : '从第一块白板开始'}</h3><p>{query ? '试试其他名称。' : filter === 'trash' ? '移入回收站的作品可以在这里恢复。' : filter === 'pinned' ? '把常用作品固定在这里，方便再次打开。' : '先创建一块空白白板，再与 Codex 一起整理思路。'}</p>{!query && filter === 'recent' && <button className="studio-button" onClick={() => void createBoard()} disabled={!!busy}><Plus size={16} />新建白板</button>}</div> : <div className={`studio-artifacts studio-artifacts-${layout}`} aria-busy={libraryLoading}>
            {visibleArtifacts.map(artifact => <article className={`studio-artifact ${artifact.trashedAt ? 'studio-artifact-trashed' : ''}`} key={artifact.id}>
              <button className="studio-artifact-open" aria-label={`打开${getProduct(artifact.type)?.label || "作品"}：${artifact.title}`} disabled={!!artifact.trashedAt} onClick={() => openArtifact(artifact.id)}>{layout === 'grid' && <ArtifactPreview artifact={artifact} cached={cachedBoards[artifact.id]} client={client} />}<div className="studio-artifact-details"><span className="studio-artifact-icon"><ProductGlyph type={artifact.type} /></span><div><h3>{artifact.title}</h3><p>{filter === 'trash' ? `移入时间 ${new Date(artifact.trashedAt || artifact.updatedAt).toLocaleDateString('zh-CN')}` : relativeTime(artifact.updatedAt)}</p></div></div></button>
              <div className="studio-artifact-actions">{artifact.trashedAt ? <button className="studio-button studio-compact" onClick={() => void manageArtifact('restore', artifact)} disabled={!!busy}><RotateCcw size={15} />恢复</button> : <>{artifact.pinned && <Pin size={15} className="studio-pin-mark" aria-label="已固定" />}<div className="studio-menu-anchor"><button className="studio-icon-button" aria-label={`管理作品：${artifact.title}`} aria-expanded={menuId === artifact.id} onClick={() => setMenuId(previous => previous === artifact.id ? '' : artifact.id)}><MoreHorizontal size={20} /></button>{menuId === artifact.id && <div className="studio-menu" role="menu"><button role="menuitem" onClick={() => void manageArtifact('pin', artifact, { pinned: !artifact.pinned })}><Pin size={16} />{artifact.pinned ? '取消固定' : '固定'}</button><button role="menuitem" onClick={() => { setRename({ artifact, title: artifact.title }); setMenuId(''); }}><FileCode2 size={16} />重命名</button><button role="menuitem" onClick={() => void manageArtifact('duplicate', artifact)}><Copy size={16} />复制作品</button><div className="studio-menu-rule" /><button role="menuitem" className="studio-danger-text" onClick={() => void manageArtifact('trash', artifact)}><Trash2 size={16} />移入回收站</button></div>}</div></>}
              </div>
            </article>)}
          </div>}
          {nextCursor && <div className="studio-load-more"><button className="studio-button" disabled={libraryLoading} onClick={() => void loadLibrary(nextCursor)}>{libraryLoading && <Loader2 className="studio-spin" size={16} />}加载更多</button></div>}
        </section>
      </> : <div className="studio-empty"><Share2 size={30} /><h3>从分享链接打开白板</h3><p>此页面仅显示你获准访问的作品。</p></div>}
    </main> : <>
      <header className="studio-editor-header"><div className="studio-editor-title">{canManage ? <button className="studio-icon-button" aria-label="返回作品中心" onClick={goHome}><ArrowLeft size={20} /></button> : <Share2 size={22} className="studio-guest-brand" />}<input aria-label={`${product.label}名称`} value={titleDraft} readOnly={!canManage || !!preview} onChange={event => setTitleDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { skipTitleBlur.current = true; setTitleDraft(boardRef.current?.artifact.title || ''); event.currentTarget.blur(); } }} onBlur={() => { if (skipTitleBlur.current) { skipTitleBlur.current = false; return; } const title = titleDraft.trim(); if (board && title && title !== board.artifact.title) void manageArtifact('rename', board.artifact, { title }); else if (!title) setTitleDraft(board?.artifact.title || ''); }} /><span className={`studio-save-status ${sync === 'reconnecting' ? 'studio-save-warning' : ''}`} role="status">{sync === 'loading' ? <Loader2 size={13} className="studio-spin" /> : sync === 'reconnecting' ? <RefreshCw size={13} /> : <Check size={13} />}{sync === 'loading' ? '加载中' : sync === 'reconnecting' ? '正在重连' : canEdit ? '已保存' : '只读'}</span></div><div className="studio-editor-actions">{collaboration}{canEdit && board && ProductToolbar && <ProductToolbar key={board.artifact.id} document={board} client={client} actor={actor} selectedIds={selectedIds} disabled={!!busy || !!preview || !!suggestionPreview} onChanged={acceptBoard} onError={fail} onNotice={inform} onActivityChange={toolbarActivityChanged} />}<button className={`studio-icon-button${panel === 'history' ? ' is-active' : ''}`} aria-label="版本历史" aria-pressed={panel === 'history'} onClick={() => togglePanel('history')}><Clock3 size={20} /></button><button className={`studio-icon-button${panel === 'feedback' ? ' is-active' : ''}`} aria-label="批注与请求" aria-pressed={panel === 'feedback'} onClick={() => togglePanel('feedback')}><MessageSquare size={20} />{feedback.some(item => item.status !== 'resolved') && <span className="studio-unread-dot" />}</button>{canManage && <button className={`studio-button studio-text-button${panel === 'share' ? ' is-active' : ''}`} onClick={() => togglePanel('share')}><Share2 size={17} /><span>分享</span></button>}<div className="studio-menu-anchor"><button className="studio-button studio-text-button" disabled={!board || !!busy} aria-label={`导出${product.label}`} aria-expanded={exportMenu} onClick={() => setExportMenu(previous => !previous)}><Download size={17} /><span>导出</span><ChevronDown size={13} /></button>{exportMenu && <div className="studio-menu" role="menu">{[...product.exportFormats, ...(canManage ? [{ format: "zip" as const, label: "\u5b8c\u6574\u4f5c\u54c1\u5907\u4efd (.zip)" }] : [])].map(({ format, label }) => <button role="menuitem" key={format} onClick={() => void exportBoard(format)}><Download size={15} />{label}</button>)}</div>}</div><label className="studio-theme-control studio-editor-theme"><ThemeIcon size={15} /><select aria-label="主题" value={theme} onChange={event => setTheme(event.target.value as Theme)}><option value="system">跟随主题</option><option value="light">明亮</option><option value="dark">暗色</option></select></label></div></header>
      {preview && <div className="studio-preview-banner"><Clock3 size={16} /><span>正在预览版本 {preview.version.revision}，当前白板未改变。</span><button className="studio-button studio-compact" onClick={() => { versionSequence.current += 1; setPreview(null); }}>退出预览</button>{canManage && <button className="studio-button studio-primary studio-compact" disabled={!!busy} onClick={() => void restoreVersion()}><RotateCcw size={14} />恢复此版本</button>}</div>}
      {following && <div className="studio-follow-banner"><Users size={14} /><span>正在跟随 {followedPeer?.actor.name || "协作者"} 的视角</span><button className="studio-link-button" onClick={() => setFollowing('')}>停止跟随</button></div>}
      <div className="studio-workspace"><div className="studio-canvas-area">{board ? <ProductEditor key={board.artifact.id} document={preview?.board || suggestionPreview || board} client={client} actor={actor} onChanged={acceptBoard} onAnnotate={annotate} readOnly={!canEdit || !!preview || !!suggestionPreview} onSelectionChange={selectionChanged} onActivityChange={editorActivityChanged} activities={feedback.filter(item => item.status === 'processing' && !item.proposal)} onViewportChange={viewportChanged} onCursorMove={cursorMoved} presence={peers} selfPeerId={peerId} externalViewport={followedPeer?.context?.viewport} /> : <div className="studio-empty"><Loader2 size={28} className="studio-spin" /><p>{error ? '作品暂时无法读取' : '正在打开作品'}</p>{error && <button className="studio-button" onClick={() => void refreshBoard()}><RefreshCw size={16} />重新加载</button>}</div>}</div>
        {panel && <aside className="studio-side-panel" aria-label={panel === 'feedback' ? '批注与请求面板' : panel === 'history' ? '版本历史面板' : '分享面板'}><div className="studio-panel-heading"><h2>{panel === 'feedback' ? '批注与请求' : panel === 'history' ? '版本历史' : '分享白板'}</h2><button className="studio-icon-button" aria-label="关闭侧面板" onClick={() => setPanel(null)}><X size={18} /></button></div>
          {panel === 'feedback' && <div className="studio-panel-body studio-feedback-panel">{canComment && !preview && <form className="studio-feedback-compose" onSubmit={event => void createFeedback(event)}>{annotation ? <div className="studio-anchor-preview"><div><MessageSquare size={14} /><strong>{annotation.label}</strong><button type="button" className="studio-icon-button" aria-label="取消选区批注" onClick={() => setAnnotation(null)}><X size={13} /></button></div><blockquote>{annotation.anchor.quote || annotation.anchor.excerpt || annotation.anchor.targetIds?.join('、') || annotation.anchor.elementIds?.join('、')}</blockquote><small>{annotation.sourceLabel || '保存时冻结选区上下文'}</small></div> : <div className="studio-compose-target">{selectedIds.length ? `关于选中的 ${selectedIds.length} 个对象` : '关于整块白板'}</div>}<textarea aria-label="批注内容" placeholder={annotation ? '描述希望调整的部分…' : '添加批注或说明希望 Agent 完成的事情…'} value={feedbackText} onChange={event => setFeedbackText(event.target.value)} rows={3} /><div className="studio-compose-footer"><select aria-label="反馈类型" value={feedbackType} onChange={event => setFeedbackType(event.target.value as 'comment' | 'request')}><option value="comment">批注</option><option value="request">Agent 请求</option></select><button className="studio-button studio-primary studio-compact" disabled={!feedbackText.trim() || !!busy} type="submit">{busy === 'feedback' ? <Loader2 size={14} className="studio-spin" /> : <Plus size={14} />}{feedbackType === 'request' ? '提交请求' : '添加批注'}</button></div></form>}<label className="studio-resolved-toggle"><input type="checkbox" checked={showResolved} onChange={event => setShowResolved(event.target.checked)} />显示已解决</label>{!visibleFeedback.length && <div className="studio-panel-empty"><MessageSquare size={24} /><p>还没有{showResolved ? '' : '待处理的'}批注</p><small>选择作品对象，或标注需要讨论的局部内容。</small></div>}{visibleFeedback.map(item => item.proposal ? <SuggestionPanel key={item.id} feedback={item} client={client} artifactId={activeId} onChanged={acceptBoard} onPreview={operations => { void previewSuggestion(item, operations); }} onRefresh={() => { void refreshBoard(); }} onError={fail} /> : <article className="studio-feedback-item" key={item.id} data-feedback-id={item.id}><div className="studio-feedback-meta"><strong>{authorName(item.author)}</strong><span className={`studio-feedback-status studio-feedback-status-${item.status}`}>{item.status === 'resolved' ? '已解决' : item.status === 'pending' ? '待房主处理' : item.status === 'processing' ? '处理中' : item.type === 'request' ? '请求' : '批注'}</span></div>{(item.anchor.quote || item.anchor.excerpt) && <blockquote className="studio-feedback-quote">{item.anchor.quote || item.anchor.excerpt}</blockquote>}<p className="studio-feedback-message">{item.text}</p>{item.anchor.regionId && <small className="studio-source-version">区域选区 · 来源版本 {item.anchor.sourceRevision ?? '—'}</small>}{item.replies.map(reply => <div className="studio-feedback-reply" key={reply.id}><strong>{authorName(reply.author)}</strong><p>{reply.text}</p></div>)}{canComment && <><div className="studio-feedback-actions"><button className="studio-link-button" disabled={!!busy} onClick={() => void attachFeedback(item)}><Send size={13} />{attachContext ? '附加到对话' : '提交给房主'}</button><button className="studio-link-button" disabled={!!busy} onClick={() => void feedbackAction(item.status === 'resolved' ? 'reopen' : 'resolve', item)}>{item.status === 'resolved' ? <RotateCcw size={13} /> : <CheckCheck size={13} />}{item.status === 'resolved' ? '重新打开' : '解决'}</button></div>{item.status !== 'resolved' && <form className="studio-reply-form" onSubmit={event => { event.preventDefault(); if (replies[item.id]?.trim()) void feedbackAction('reply', item); }}><input aria-label={`回复批注：${item.text}`} value={replies[item.id] || ''} onChange={event => setReplies(previous => ({ ...previous, [item.id]: event.target.value }))} placeholder="回复…" /><button className="studio-icon-button" aria-label="发送回复" disabled={!replies[item.id]?.trim() || !!busy}><Send size={14} /></button></form>}</>}</article>)}</div>}
          {panel === 'history' && <div className="studio-panel-body"><p className="studio-panel-intro">每次修改都留下记录。预览旧版本不会改变当前白板。</p><button className="studio-link-button" onClick={() => void loadHistory()} disabled={historyLoading}><RefreshCw size={13} className={historyLoading ? 'studio-spin' : ''} />刷新记录</button>{historyLoading && !history.length && <div className="studio-panel-empty"><Loader2 className="studio-spin" size={23} /></div>}{history.map(version => <button className={`studio-history-item${preview?.version.id === version.id ? ' is-active' : ''}`} key={version.id} onClick={() => void previewVersion(version)} disabled={!!busy}><span className="studio-history-marker" /><span><strong>版本 {version.revision}</strong><span>{version.summary || '白板更新'}</span><small>{authorName(version.actor)} · {new Date(version.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>{version.restoredFrom && <small>从历史版本恢复</small>}</span>{busy === `version:${version.id}` && <Loader2 className="studio-spin" size={15} />}</button>)}{!historyLoading && !history.length && <div className="studio-panel-empty"><Clock3 size={25} /><p>还没有历史记录</p></div>}{preview && board && <>{ProductDifference ? <ProductDifference current={board} previous={preview.board} diff={preview.diff} /> : <p className="studio-small-note">可在画布中预览此版本。</p>}</>}</div>}
          {panel === 'share' && <div className="studio-panel-body">{!share ? <div className="studio-panel-empty"><Loader2 size={23} className="studio-spin" /></div> : <><div className="studio-share-status"><span className={`studio-presence-dot${share.enabled ? ' is-online' : ''}`} /><strong>{share.enabled ? '局域网分享已开启' : '仅自己可访问'}</strong></div><p className="studio-panel-intro">{share.enabled ? '同一局域网中的人可以使用对应链接进入白板，实时查看和共同编辑。' : '开启后，可把不同权限的链接发给同一局域网中的协作者。'}</p>{!share.enabled ? <button className="studio-button studio-primary studio-full-width" disabled={!!busy} onClick={() => void changeSharing('start')}><Share2 size={16} />开启局域网分享</button> : <><div className="studio-share-links">{([['editor', '可编辑', '可以修改白板并参与批注'], ['commenter', '可批注', '可以查看并留下批注或请求'], ['viewer', '仅查看', '可以查看白板内容']] as const).map(([role, label, description]) => <div className="studio-share-role" key={role}><div><strong>{label}</strong><small>{description}</small></div><div className="studio-share-link-field"><input readOnly aria-label={`${label}分享链接`} value={share.links?.[role] || ''} onFocus={event => event.currentTarget.select()} /><button className="studio-icon-button" aria-label={`复制${label}链接`} disabled={!share.links?.[role]} onClick={() => void copyLink(share.links![role]!)}><Copy size={15} /></button></div><button className="studio-link-button" disabled={!!busy} onClick={() => void changeSharing('reset', role)}><RefreshCw size={12} />重置此链接</button></div>)}</div><button className="studio-button studio-full-width studio-danger-text" disabled={!!busy} onClick={() => void changeSharing('stop')}>关闭分享</button><p className="studio-small-note">重置链接后，原链接将失效。关闭分享会停止访客访问。</p></>}</>}
          </div>}
        </aside>}
      </div>
    </>}
    {rename && <StudioDialog title="重命名作品" onClose={() => setRename(null)}><form onSubmit={event => { event.preventDefault(); if (rename.title.trim()) void manageArtifact('rename', rename.artifact, { title: rename.title.trim() }); }}><label className="studio-field-label" htmlFor="studio-rename-title">作品名称</label><input className="studio-text-field" id="studio-rename-title" maxLength={200} value={rename.title} onChange={event => setRename(previous => previous ? { ...previous, title: event.target.value } : null)} /><div className="studio-modal-footer"><button type="button" className="studio-button" onClick={() => setRename(null)}>取消</button><button className="studio-button studio-primary" type="submit" disabled={!rename.title.trim() || !!busy}>保存</button></div></form></StudioDialog>}

  </div>;
}
