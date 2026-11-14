import { useEffect, useMemo, useRef, useState } from 'react';
import type { CollaborationRoom, Feedback, Json, Presence, RoomMessage, RoomTimer, StudioClient, StudioEvent, SyncBatch } from '../../contracts/studio';
import { getProduct, type StudioDocument } from '../products';
import { studioRequest } from '../transport';
import { newClientId } from './client-id';

interface Callbacks {
  getDocument: () => StudioDocument | null;
  onDocument: (document: StudioDocument) => void;
  onFeedback: (feedback: Feedback[]) => void;
  onPresence: (peers: Presence[], timer: RoomTimer | null) => void;
  onEvent: (event: StudioEvent) => void;
  onStatus: (status: 'loading' | 'saved' | 'reconnecting') => void;
  onError: (error: unknown) => void;
  onClock?: (offsetMs: number) => void;
  onCursorClear?: () => void;
  onReset?: () => void;
}
interface PageIdentity { epoch: string; presence: number; room: number }
interface Options extends Callbacks { client: StudioClient; polling: boolean; artifactId: string; peerId: string; identity?: PageIdentity }
function position(cursor: string) { const index = cursor.lastIndexOf(':'); return { epoch: cursor.slice(0, index), seq: Number(cursor.slice(index + 1)) }; }
/** Opaque epochs are never ordered against one another. Only reset may change the epoch. */
export function cursorAfter(next: string, previous: string): boolean {
  if (!previous) return !!next;
  const a = position(next), b = position(previous);
  return a.epoch === b.epoch && Number.isSafeInteger(a.seq) && a.seq > b.seq;
}
type PresencePatch = Partial<Pick<Presence, 'context' | 'cursor' | 'following' | 'chat' | 'chatExpiresAt' | 'color' | 'visible'>>;

/** Owns one visible page's transport, watermarks and bounded ephemeral outboxes. Content writes stay in the product queue. */
export function createCollaboration(options: Options) {
  const { client, artifactId, peerId } = options;
  const identity = options.identity || { epoch: newClientId('epoch'), presence: 0, room: 0 }, peerEpoch = identity.epoch;
  let closed = false, connected = false, generation = 0, cursor = '', peerCursor = '', authorityCursor = '';
  let stream: EventSource | undefined, pollAbort: AbortController | undefined, presenceAbort: AbortController | undefined, roomAbort: AbortController | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined, presenceTimer: ReturnType<typeof setTimeout> | undefined, roomTimer: ReturnType<typeof setTimeout> | undefined, idleTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: PresencePatch = {}, published: PresencePatch = {}, presenceBusy = false, roomBusy = false, lastPresence = 0;
  let peers: Presence[] = [], timer: RoomTimer | null = null;
  let feedbackVersion = 0, feedbackReading = false, feedbackAgain = false, snapshotReading = false, snapshotAgain = false;
  let feedbackTicket = 0, snapshotTicket = 0;
  let processing = Promise.resolve();
  let queued = 0, queuedBytes = 0, overflowCursor: string | undefined;
  let overflowReading = false;
  const listeners = new Map<string, Set<(message: RoomMessage) => void>>(), seenRooms = new Map<string, number>();
  const handledControls = new WeakSet<StudioEvent>();
  const roomOutbox: { topic: string; data: Json; resolve: (accepted: boolean) => void }[] = [];
  const timerOutbox: { data: Record<string, unknown>; resolve: () => void; reject: (error: unknown) => void }[] = [];
  const reads = new Set<AbortController>();
  const url = (path: string) => { const value = new URL(path, client.baseUrl); value.searchParams.set('artifactId', artifactId); return value; };
  const headers = () => ({ ...(client.token ? { Authorization: `Bearer ${client.token}` } : {}), 'Content-Type': 'application/json' });
  const alive = (serial: number) => !closed && generation === serial && document.visibilityState !== 'hidden';
  async function json(response: Response) {
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error?.message || `作品服务请求失败（${response.status}）`), { status: response.status, ...result.error });
    return result;
  }
  async function readTool<T>(name: 'artifact_read' | 'artifact_feedback', args: Record<string, unknown>): Promise<T> {
    if (!client.baseUrl) return client.call<T>(name, args);
    const abort = new AbortController(); reads.add(abort);
    try {
      const result = await json(await studioRequest(client, new URL(`/api/tools/${name}`, client.baseUrl), { method: 'POST', headers: headers(), signal: abort.signal, body: JSON.stringify(args) }));
      return result.data as T;
    } finally { reads.delete(abort); }
  }
  function acceptPresence(result: { peers?: Presence[]; timer?: RoomTimer | null; cursor?: string; serverTime?: number }, reset = false) {
    if (!Array.isArray(result.peers)) return;
    if (result.cursor && peerCursor) {
      const sameEpoch = position(result.cursor).epoch === position(peerCursor).epoch;
      if (sameEpoch ? !cursorAfter(result.cursor, peerCursor) : !reset) return;
    }
    if (typeof result.serverTime === 'number') options.onClock?.(result.serverTime - Date.now());
    if (result.cursor) peerCursor = result.cursor;
    peers = result.peers; if ('timer' in result) timer = result.timer ?? null;
    options.onPresence(peers, timer);
  }
  function deliver(messages: RoomMessage[]) {
    for (const message of messages) {
      if (!message || message.peerId === peerId || typeof message.topic !== 'string') continue;
      const key = `${message.peerId}:${message.seq}`;
      if (seenRooms.has(key)) continue;
      seenRooms.set(key, Date.now());
      if (seenRooms.size > 1024) seenRooms.delete(seenRooms.keys().next().value!);
      for (const listener of listeners.get(message.topic) || []) listener(message);
    }
  }
  async function readFeedback(serial = generation) {
    if (feedbackReading) { feedbackAgain = true; return; }
    feedbackReading = true;
    const ticket = ++feedbackTicket;
    try {
      do {
        feedbackAgain = false;
        const version = feedbackVersion;
        const result = await readTool<{ feedback: Feedback[] }>('artifact_feedback', { action: 'list', artifactId });
        if (!alive(serial)) return;
        if (version === feedbackVersion) options.onFeedback(result.feedback); else feedbackAgain = true;
      } while (feedbackAgain && alive(serial));
    } finally { if (ticket === feedbackTicket) feedbackReading = false; }
  }
  async function snapshot(serial = generation) {
    if (snapshotReading) { snapshotAgain = true; return; }
    snapshotReading = true;
    const ticket = ++snapshotTicket;
    try {
      do {
        snapshotAgain = false;
        const next = await readTool<StudioDocument>('artifact_read', { artifactId, mode: 'board' });
        if (!alive(serial)) return;
        const current = options.getDocument();
        if (!current || next.artifact.revision >= current.artifact.revision) options.onDocument(next);
        await readFeedback(serial);
      } while (snapshotAgain && alive(serial));
    } finally { if (ticket === snapshotTicket) snapshotReading = false; }
  }
  async function event(message: StudioEvent, serial: number) {
    if (!alive(serial) || message.artifactId && message.artifactId !== artifactId) return;
    if (!handledControls.has(message)) options.onEvent(message);
    if (message.type === 'access-revoked') { pause(false); return; }
    if (message.type === 'room' && Array.isArray(message.events)) { deliver(message.events as RoomMessage[]); return; }
    if (message.type === 'presence') { acceptPresence(message as unknown as SyncBatch); return; }
    if (message.type === 'feedback') { await readFeedback(serial); return; }
    if (typeof message.revision === 'number' || message.units) {
      const current = options.getDocument();
      if (current && Number(message.revision) <= current.artifact.revision) return;
      const next = current && message.revision === current.artifact.revision + 1 && message.units ? getProduct(current.artifact.type)?.applyRemoteEvent?.(current, message) : undefined;
      if (next) options.onDocument(next); else await snapshot(serial);
    } else if (!['ready', 'share', 'presence', 'room'].includes(message.type)) await snapshot(serial);
  }
  async function batch(result: Partial<SyncBatch> & StudioEvent, serial: number) {
    if (!alive(serial)) return;
    if (result.cursor && cursor && !result.reset && !cursorAfter(result.cursor, cursor)) return;
    if (result.reset) { cursor = result.cursor || ''; await snapshot(serial); }
    if (!alive(serial)) return;
    if (result.type === 'room') await event(result, serial);
    else if (Array.isArray(result.events)) for (const message of result.events) await event(message, serial);
    else if (result.type && result.type !== 'reset') await event(result, serial);
    if (!alive(serial)) return;
    if (result.cursor) cursor = result.cursor;
    connected = true; options.onStatus('saved'); flushPresence(); flushRoom();
  }
  function enqueue(result: Partial<SyncBatch> & StudioEvent, serial: number) {
    if (!alive(serial)) return Promise.resolve();
    const revocation = result.type === 'access-revoked' ? result : result.events?.find(message => message.type === 'access-revoked');
    if (revocation) { options.onEvent(revocation); pause(false); return Promise.resolve(); }
    if ((result.actor || result.type === 'ready') && (!result.cursor || !authorityCursor || result.cursor === authorityCursor || cursorAfter(result.cursor, authorityCursor) || result.reset && position(result.cursor).epoch !== position(authorityCursor).epoch)) {
      if (result.cursor) authorityCursor = result.cursor;
      options.onEvent({ type: 'ready', artifactId, actor: result.actor, access: result.access, cursor: result.cursor });
    }
    if (result.reset) { seenRooms.clear(); options.onReset?.(); }
    if (typeof result.serverTime === 'number' && (!result.cursor || !peerCursor || result.cursor === peerCursor || cursorAfter(result.cursor, peerCursor) || result.reset && position(result.cursor).epoch !== position(peerCursor).epoch)) options.onClock?.(result.serverTime - Date.now());
    for (const message of result.type === 'share' ? [result] : result.events || []) if (message.type === 'share') { options.onEvent(message); handledControls.add(message); }
    // Presence and room updates are independent of slow snapshot reads.
    acceptPresence(result, !!result.reset);
    if (result.type === 'room' && Array.isArray(result.events)) deliver(result.events as unknown as RoomMessage[]);
    else for (const message of result.events || []) if (message.type === 'room' && Array.isArray(message.events)) deliver(message.events as RoomMessage[]);
    const bytes = JSON.stringify(result).length;
    if (queued >= 64 || queuedBytes + bytes > 4 * 1024 * 1024) {
      overflowCursor = result.cursor || overflowCursor || cursor;
      if (!queued && !overflowReading) processing = processing.then(() => drainOverflow(serial)).catch(error => { if (alive(serial)) lost(error); });
      return processing;
    }
    queued += 1; queuedBytes += bytes;
    processing = processing.then(async () => {
      try { await batch(result, serial); }
      finally { if (generation === serial) { queued -= 1; queuedBytes -= bytes; } }
      await drainOverflow(serial);
    }).catch(error => { if (alive(serial)) lost(error); });
    return processing;
  }
  async function drainOverflow(serial: number) {
    if (overflowReading) return;
    overflowReading = true;
    try {
      while (!queued && overflowCursor !== undefined && alive(serial)) {
        const barrier = overflowCursor; overflowCursor = undefined;
        await snapshot(serial); if (alive(serial)) cursor = barrier;
      }
    } finally { if (generation === serial) overflowReading = false; }
  }
  async function polling(serial: number) {
    while (alive(serial)) {
      pollAbort = new AbortController();
      const endpoint = url('/api/sync'); endpoint.searchParams.set('wait', '20000'); endpoint.searchParams.set('peerId', peerId); endpoint.searchParams.set('peerEpoch', peerEpoch); if (cursor) endpoint.searchParams.set('after', cursor);
      try {
        const result = await json(await studioRequest(client, endpoint, { headers: headers(), signal: pollAbort.signal }));
        if (!alive(serial)) return;
        await enqueue(result, serial);
        // A synchronous mock or an empty immediate response must not spin the UI thread.
        if (alive(serial)) await new Promise(resolve => setTimeout(resolve, 10));
      } catch (error) { if (alive(serial) && !pollAbort.signal.aborted) lost(error); return; }
    }
  }
  function connect() {
    if (closed || document.visibilityState === 'hidden') return;
    const serial = ++generation;
    // Re-entry always takes an authoritative snapshot before replaying subsequent events.
    cursor = ''; peerCursor = ''; authorityCursor = '';
    pending = { ...published, ...pending, visible: true };
    connected = false; options.onStatus(options.getDocument() ? 'reconnecting' : 'loading');
    if (!client.baseUrl) { void snapshot(serial).then(() => { if (alive(serial)) options.onStatus('saved'); }, options.onError); return; }
    if (options.polling || typeof EventSource === 'undefined') { void polling(serial); return; }
    const endpoint = url('/api/events'); endpoint.searchParams.set('peerId', peerId); endpoint.searchParams.set('peerEpoch', peerEpoch); if (client.token) endpoint.searchParams.set('token', client.token); if (cursor) endpoint.searchParams.set('after', cursor);
    stream = new EventSource(endpoint.href);
    stream.onmessage = message => { if (!alive(serial)) return; try { void enqueue(JSON.parse(message.data), serial); } catch (error) { lost(error); } };
    stream.addEventListener('change', message => { if (!alive(serial)) return; try { void enqueue(JSON.parse((message as MessageEvent).data), serial); } catch { void refresh(); } });
    stream.addEventListener('reset', message => { if (!alive(serial)) return; try { void enqueue({ ...JSON.parse((message as MessageEvent).data), reset: true }, serial); } catch { cursor = ''; void refresh(); } });
    stream.onerror = () => { if (alive(serial)) lost(new Error('实时连接已中断，正在重新连接。')); };
  }
  function lost(error: unknown) {
    pause(false); options.onStatus('reconnecting'); options.onError(error);
    if (!closed && document.visibilityState !== 'hidden') reconnect = setTimeout(connect, 1000);
  }
  function pause(leave: boolean) {
    generation += 1; connected = false; stream?.close(); stream = undefined; pollAbort?.abort(); presenceAbort?.abort(); roomAbort?.abort();
    clearTimeout(reconnect); clearTimeout(presenceTimer); clearTimeout(roomTimer);
    presenceTimer = roomTimer = undefined;
    reads.forEach(read => read.abort()); reads.clear();
    snapshotTicket += 1; feedbackTicket += 1; snapshotReading = feedbackReading = false;
    processing = Promise.resolve(); queued = queuedBytes = 0; overflowCursor = undefined; overflowReading = false;
    for (const outgoing of roomOutbox.splice(0)) outgoing.resolve(false);
    for (const outgoing of timerOutbox.splice(0)) outgoing.reject(new Error('连接已暂停，计时操作未提交。'));
    pending = { ...pending, cursor: null, chat: '', visible: false }; presenceBusy = roomBusy = false;
    if (leave) options.onCursorClear?.();
    if (leave && client.baseUrl) void studioRequest(client, url('/api/presence'), { method: 'POST', headers: headers(), body: JSON.stringify({ artifactId, peerId, peerEpoch, peerSeq: ++identity.presence, leave: true }), keepalive: !options.polling }).catch(() => {});
  }
  async function flushPresence() {
    if (!connected || closed || presenceBusy || !Object.keys(pending).length && !timerOutbox.length) return;
    const delay = timerOutbox.length ? 0 : Math.max(0, 33 - (Date.now() - lastPresence));
    if (delay) { presenceTimer ??= setTimeout(() => { presenceTimer = undefined; void flushPresence(); }, delay); return; }
    const patch = pending, action = timerOutbox.shift(); pending = {}; presenceBusy = true; lastPresence = Date.now(); const serial = generation;
    presenceAbort = new AbortController();
    try {
      const result = await json(await studioRequest(client, url('/api/presence'), { method: 'POST', headers: headers(), signal: presenceAbort.signal, body: JSON.stringify({ artifactId, peerId, peerEpoch, peerSeq: ++identity.presence, ...patch, ...(action ? { timer: action.data } : {}) }) }));
      if (alive(serial)) { acceptPresence(result); action?.resolve(); } else action?.reject(new Error('连接已变更，计时操作结果未确认。'));
    } catch (error) { action?.reject(error); if (alive(serial) && !presenceAbort.signal.aborted) options.onError(error); }
    finally { if (generation === serial) { presenceBusy = false; void flushPresence(); } }
  }
  function presence(patch: PresencePatch) {
    if (closed) return;
    const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => JSON.stringify(published[key as keyof PresencePatch]) !== JSON.stringify(value))) as PresencePatch;
    published = { ...published, ...changed }; pending = { ...pending, ...changed };
    if (patch.cursor) { clearTimeout(idleTimer); idleTimer = setTimeout(() => presence({ cursor: null }), 15 * 60_000); }
    void flushPresence();
  }
  async function flushRoom() {
    if (!connected || closed || roomBusy || !roomOutbox.length) return;
    roomBusy = true; const serial = generation, outgoing: typeof roomOutbox = [];
    let size = 0;
    while (roomOutbox.length && outgoing.length < 16) {
      const candidate = roomOutbox[0]!, bytes = new TextEncoder().encode(JSON.stringify({ topic: candidate.topic, data: candidate.data })).length;
      if (size + bytes > 56_000 && outgoing.length) break;
      size += bytes; outgoing.push(roomOutbox.shift()!);
    }
    roomAbort = new AbortController();
    try {
      const result = await json(await studioRequest(client, url('/api/room'), { method: 'POST', headers: headers(), signal: roomAbort.signal, body: JSON.stringify({ artifactId, peerId, peerEpoch, peerSeq: ++identity.room, events: outgoing.map(({ topic, data }) => ({ topic, data })) }) }));
      outgoing.forEach(item => item.resolve(alive(serial) && (typeof result.accepted === 'number' ? result.accepted === outgoing.length : result.accepted !== false)));
    } catch (error) { outgoing.forEach(item => item.resolve(false)); if (alive(serial) && !roomAbort.signal.aborted) options.onError(error); }
    finally { if (generation === serial) { roomBusy = false; void flushRoom(); } }
  }
  const room: CollaborationRoom = {
    send(topic, data) {
      if (closed || !connected || document.visibilityState === 'hidden' || !['gesture', 'upload', 'chat', 'follow'].includes(topic) || new TextEncoder().encode(JSON.stringify(data)).length > 4096) return Promise.resolve(false);
      if (roomOutbox.length >= 80 && data && typeof data === 'object' && !Array.isArray(data) && data.phase === 'end') {
        const index = roomOutbox.findIndex(item => item.data && typeof item.data === 'object' && !Array.isArray(item.data) && item.data.phase !== 'end');
        if (index >= 0) roomOutbox.splice(index, 1)[0]!.resolve(false);
      }
      if (roomOutbox.length >= 80) return Promise.resolve(false);
      return new Promise(resolve => { roomOutbox.push({ topic, data, resolve }); roomTimer ??= setTimeout(() => { roomTimer = undefined; void flushRoom(); }, 0); });
    },
    subscribe(topic, listener) { const group = listeners.get(topic) || new Set(); group.add(listener); listeners.set(topic, group); return () => { group.delete(listener); if (!group.size) listeners.delete(topic); }; },
  };
  function refresh() { const serial = generation; processing = processing.then(() => snapshot(serial)).catch(error => { if (alive(serial)) lost(error); }); return processing; }
  const clearCursor = () => { options.onCursorClear?.(); presence({ cursor: null, chat: '' }); };
  const visibility = () => { if (document.visibilityState === 'hidden') pause(true); else { pending = { ...pending, visible: true }; connect(); } };
  const pagehide = () => pause(true);
  const heartbeat = setInterval(() => { if (connected) { pending.visible = true; void flushPresence(); } }, 15000);
  document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', pagehide); window.addEventListener('blur', clearCursor); document.documentElement.addEventListener('pointerleave', clearCursor);
  connect();
  return {
    room, presence, refresh,
    refreshFeedback: () => readFeedback(),
    timer(data: Record<string, unknown>): Promise<void> { if (!connected) return Promise.reject(new Error('请在连接恢复后重试计时操作。')); return new Promise((resolve, reject) => { timerOutbox.push({ data, resolve, reject }); void flushPresence(); }); },
    feedbackChanged() { feedbackVersion += 1; feedbackAgain = true; },
    close() { if (closed) return; pause(true); closed = true; clearInterval(heartbeat); clearTimeout(idleTimer); listeners.clear(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pagehide); window.removeEventListener('blur', clearCursor); document.documentElement.removeEventListener('pointerleave', clearCursor); },
  };
}

export function useCollaboration(options: Options & { enabled: boolean }) {
  const callbacks = useRef(options); callbacks.current = options;
  const controller = useRef<ReturnType<typeof createCollaboration> | undefined>(undefined);
  const identity = useRef<PageIdentity>({ epoch: newClientId('epoch'), presence: 0, room: 0 });
  const [resetVersion, resetRoom] = useState(0);
  const subscriptions = useRef(new Map<string, Set<(message: RoomMessage) => void>>());
  const room = useMemo<CollaborationRoom>(() => ({
    send: (topic, data) => controller.current?.room.send(topic, data) || Promise.resolve(false),
    subscribe(topic, listener) { const group = subscriptions.current.get(topic) || new Set(); group.add(listener); subscriptions.current.set(topic, group); return () => { group.delete(listener); if (!group.size) subscriptions.current.delete(topic); }; },
  }), [options.artifactId, options.enabled, resetVersion]);
  useEffect(() => {
    if (!options.enabled || !options.artifactId) return;
    const active = createCollaboration({ ...options, identity: identity.current, getDocument: () => callbacks.current.getDocument(), onDocument: value => callbacks.current.onDocument(value), onFeedback: value => callbacks.current.onFeedback(value), onPresence: (peers, timer) => callbacks.current.onPresence(peers, timer), onEvent: event => callbacks.current.onEvent(event), onStatus: status => callbacks.current.onStatus(status), onError: error => callbacks.current.onError(error), onClock: offset => callbacks.current.onClock?.(offset), onCursorClear: () => callbacks.current.onCursorClear?.(), onReset: () => resetRoom(value => value + 1) });
    controller.current = active;
    const unsubscribes = ['gesture', 'upload', 'chat', 'follow'].map(topic => active.room.subscribe(topic, message => { for (const listener of subscriptions.current.get(topic) || []) listener(message); }));
    return () => { controller.current = undefined; unsubscribes.forEach(unsubscribe => unsubscribe()); active.close(); };
  }, [options.client, options.polling, options.artifactId, options.peerId, options.enabled]);
  return useMemo(() => ({ room, presence: (patch: PresencePatch) => controller.current?.presence(patch), refresh: () => controller.current?.refresh() || Promise.resolve(), refreshFeedback: () => controller.current?.refreshFeedback() || Promise.resolve(), timer: (data: Record<string, unknown>) => controller.current?.timer(data) || Promise.reject(new Error('白板连接尚未建立。')), feedbackChanged: () => controller.current?.feedbackChanged() }), [room]);
}
