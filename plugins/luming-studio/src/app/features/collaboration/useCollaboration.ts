import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  STUDIO_TOOLS,
  type ArtifactUnits,
  type CollaborationRoom,
  type CollaborationStateEvent,
  type Feedback,
  type Json,
  type Presence,
  type RoomMessage,
  type RoomTimer,
  type StudioClient,
  type StudioEvent,
  type SyncBatch,
} from '../../../contracts/studio';
import type { StudioDocument } from '../../product-contract';
import { createStudioToolCall } from '../../transport/tool-response';
import { studioRequest } from '../../transport/client';
import {
  openCollaborationStream,
  requestCollaborationPoll,
  requestCollaborationReplay,
  requestCollaborationRevision,
} from '../../transport/collaboration-channel';
import { reportStudioWarning } from '../../shared/studio-warning';
import { newClientId } from '../../shared/client-id';
import type { StudioViewRequests } from '../../shared/studio-view-scope';
import { isRecord } from '../../../shared/is-record';
import { missedRevisions } from './revision-recovery';

interface Callbacks {
  getDocument: () => StudioDocument | null;
  applyRemoteEvent: (document: StudioDocument, event: StudioEvent) => StudioDocument | undefined;
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
interface PageIdentity {
  epoch: string;
  presence: number;
  room: number;
}
interface Options extends Callbacks {
  client: StudioClient;
  polling: boolean;
  artifactId: string;
  peerId: string;
  identity?: PageIdentity;
  isCurrent?: () => boolean;
}

function position(cursor: string) {
  const index = cursor.lastIndexOf(':');
  return { epoch: cursor.slice(0, index), seq: Number(cursor.slice(index + 1)) };
}

export function cursorAfter(next: string, previous: string): boolean {
  if (!previous) {
    return !!next;
  }

  const a = position(next);
  const b = position(previous);
  return a.epoch === b.epoch && Number.isSafeInteger(a.seq) && a.seq > b.seq;
}

type PresencePatch = Partial<
  Pick<Presence, 'context' | 'cursor' | 'following' | 'color' | 'visible'>
>;
type IncomingBatch = Partial<SyncBatch> & StudioEvent;

function cursorCanAdvance(next: string | undefined, previous: string, reset?: boolean) {
  if (!next || !previous || cursorAfter(next, previous)) {
    return true;
  }

  return !!reset && position(next).epoch !== position(previous).epoch;
}

function roomData(data: Json): data is Record<string, Json> {
  return data !== null && typeof data === 'object' && !Array.isArray(data);
}

function isNextRevision(
  document: StudioDocument | null,
  revision: unknown,
): document is StudioDocument {
  return !!document && document.artifact.revision + 1 === revision;
}

function validRecovery(result: ArtifactUnits, artifactId: string, revision: number, ids: string[]) {
  if (result.artifact.id !== artifactId || result.artifact.revision !== revision) {
    return false;
  }

  const { units } = result;
  if (!Array.isArray(units) || units.length !== ids.length) {
    return false;
  }

  const unique = new Set(units.map((unit) => unit.id));
  return (
    unique.size === ids.length && units.every((unit) => ids.includes(unit.id) && 'after' in unit)
  );
}

export function createCollaboration(options: Options) {
  const { client, artifactId, peerId } = options;
  const isCurrent = options.isCurrent ?? (() => true);
  const identity = options.identity || { epoch: newClientId('epoch'), presence: 0, room: 0 };
  const peerEpoch = identity.epoch;
  let closed = false;
  let connected = false;
  let generation = 0;
  let cursor = '';
  let receivedCursor = '';
  let peerCursor = '';
  let authorityCursor = '';
  let documentCursor = '';
  let syncStatus: Parameters<Callbacks['onStatus']>[0] = 'loading';
  let stream: ReturnType<typeof openCollaborationStream>;
  let pollAbort: AbortController | undefined;
  let revisionAbort: AbortController | undefined;
  let presenceAbort: AbortController | undefined;
  let roomAbort: AbortController | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let presenceTimer: ReturnType<typeof setTimeout> | undefined;
  let roomTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: PresencePatch = {};
  let published: PresencePatch = {};
  let presenceBusy = false;
  let roomBusy = false;
  let lastPresence = 0;
  let peers: Presence[] = [];
  let timer: RoomTimer | null = null;
  let feedbackVersion = 0;
  let feedbackReading = false;
  let feedbackAgain = false;
  let snapshotReading = false;
  let snapshotAgain = false;
  let feedbackTicket = 0;
  let snapshotTicket = 0;
  let processing = Promise.resolve();
  let queued = 0;
  let queuedBytes = 0;
  let overflowCursor: string | undefined;
  let overflowReading = false;
  const listeners = new Map<string, Set<(message: RoomMessage) => void>>();
  const seenRooms = new Map<string, number>();
  const stateListeners = new Set<(event: CollaborationStateEvent) => void>();
  const handledControls = new WeakSet<StudioEvent>();
  const roomOutbox: { topic: string; data: Json; resolve: (accepted: boolean) => void }[] = [];
  const timerOutbox: {
    data: Record<string, unknown>;
    resolve: () => void;
    reject: (error: unknown) => void;
  }[] = [];
  const reads = new Set<AbortController>();
  const url = (path: string) => {
    const value = new URL(path, client.baseUrl);
    value.searchParams.set('artifactId', artifactId);
    return value;
  };
  const headers = () => ({
    ...(client.token ? { Authorization: `Bearer ${client.token}` } : {}),
    'Content-Type': 'application/json',
  });
  const alive = (serial: number) => {
    const sameConnection = !closed && generation === serial;

    return sameConnection && document.visibilityState !== 'hidden' && isCurrent();
  };
  const inReceivedEpoch = (next?: string) =>
    !next || position(next).epoch === position(receivedCursor).epoch;
  function runInConnection(task: Promise<unknown>, serial = generation) {
    task.catch((error) => loseIfCurrent(error, serial));
  }
  const localState = (event: CollaborationStateEvent) => {
    for (const listener of stateListeners) {
      listener(event);
    }
  };
  const reportStatus = (status: typeof syncStatus) => {
    syncStatus = status;
    options.onStatus(status);
  };

  function advanceDocumentCursor(next?: string) {
    if (next && inReceivedEpoch(next) && cursorCanAdvance(next, documentCursor, true)) {
      documentCursor = next;
    }
  }
  function documentState(message?: StudioEvent, appliedRevision = 0) {
    const document = options.getDocument();
    if (!document || document.artifact.id !== artifactId) {
      return;
    }

    const {
      cursor: receiptCursor,
      revision,
      operationId,
      actorId,
      changedIds,
      unitVersions,
    } = message ?? {};
    const minimumRevision = Math.max(appliedRevision, revision ?? 0);
    if (document.artifact.revision < minimumRevision || !inReceivedEpoch(receiptCursor)) {
      return;
    }

    if (message?.type === 'board') {
      advanceDocumentCursor(receiptCursor);
    }

    const watermark = receiptCursor || receivedCursor;
    const epoch = position(watermark).epoch;
    localState({
      type: 'document',
      document,
      ...(watermark ? { cursor: watermark, epoch } : {}),
      ...(operationId ? { operationId, ...(actorId ? { actorId } : {}) } : {}),
      ...(revision !== undefined ? { commitRevision: revision } : {}),
      ...(changedIds ? { changedIds } : {}),
      ...(unitVersions ? { unitVersions } : {}),
    });
  }
  async function json(response: Response) {
    const result = await response.json();
    if (!response.ok) {
      throw Object.assign(
        new Error(result.error?.message || `作品服务请求失败（${response.status}）`),
        { status: response.status, ...result.error },
      );
    }

    return result;
  }
  const queryClient = client.baseUrl
    ? {
        call: createStudioToolCall(async (name, args, read) => {
          const abort = new AbortController();
          reads.add(abort);
          try {
            const response = await studioRequest(
              client,
              new URL(`/api/tools/${name}`, client.baseUrl),
              {
                method: 'POST',
                headers: headers(),
                signal: abort.signal,
                body: JSON.stringify(args),
              },
            );

            return await read(response);
          } finally {
            reads.delete(abort);
          }
        }),
      }
    : client;
  function acceptPresence(
    result: { peers?: Presence[]; timer?: RoomTimer | null; cursor?: string; serverTime?: number },
    reset = false,
  ) {
    if (!Array.isArray(result.peers)) {
      return;
    }

    if (result.cursor && peerCursor) {
      const sameEpoch = position(result.cursor).epoch === position(peerCursor).epoch;
      if (sameEpoch ? !cursorAfter(result.cursor, peerCursor) : !reset) {
        return;
      }
    }
    if (typeof result.serverTime === 'number') {
      options.onClock?.(result.serverTime - Date.now());
    }
    if (result.cursor) {
      peerCursor = result.cursor;
    }
    peers = result.peers;
    if ('timer' in result) {
      timer = result.timer ?? null;
    }
    options.onPresence(peers, timer);
    localState({ type: 'peers', peers });
  }
  function deliver(messages: RoomMessage[]) {
    for (const message of messages) {
      if (!message || message.peerId === peerId || typeof message.topic !== 'string') {
        continue;
      }

      const key = `${message.peerId}:${message.seq}`;
      if (seenRooms.has(key)) {
        continue;
      }

      seenRooms.set(key, Date.now());
      if (seenRooms.size > 1024) {
        seenRooms.delete(seenRooms.keys().next().value!);
      }
      for (const listener of listeners.get(message.topic) || []) {
        listener(message);
      }
    }
  }
  async function readFeedback(serial = generation) {
    if (!alive(serial)) {
      return;
    }

    if (feedbackReading) {
      feedbackAgain = true;
      return;
    }
    feedbackReading = true;
    const ticket = ++feedbackTicket;
    try {
      do {
        feedbackAgain = false;
        const version = feedbackVersion;
        const result = await queryClient.call<{ feedback: Feedback[] }>(STUDIO_TOOLS.feedback, {
          action: 'list',
          artifactId,
        });

        if (!alive(serial)) {
          return;
        }

        if (version === feedbackVersion) {
          options.onFeedback(result.feedback);
        } else {
          feedbackAgain = true;
        }
      } while (feedbackAgain && alive(serial));
    } finally {
      if (ticket === feedbackTicket) {
        feedbackReading = false;
      }
    }
  }
  function requestFeedback(serial: number) {
    runInConnection(readFeedback(serial), serial);
  }
  async function snapshot(serial = generation) {
    if (!alive(serial)) {
      return;
    }

    if (snapshotReading) {
      snapshotAgain = true;
      return;
    }
    snapshotReading = true;
    const ticket = ++snapshotTicket;
    const epoch = position(receivedCursor).epoch;
    try {
      do {
        snapshotAgain = false;
        const barrier = cursor;
        const next = await queryClient.call(STUDIO_TOOLS.read, {
          artifactId,
          mode: 'board',
        });

        if (!alive(serial) || epoch !== position(receivedCursor).epoch) {
          return;
        }
        if (next.artifact.id !== artifactId) {
          throw new Error('作品快照对应了其他白板。');
        }

        const current = options.getDocument();
        if (!current || next.artifact.revision >= current.artifact.revision) {
          advanceDocumentCursor(barrier);
          options.onDocument(next);
          documentState(undefined, next.artifact.revision);
        }
        requestFeedback(serial);
      } while (snapshotAgain && alive(serial));
    } finally {
      if (ticket === snapshotTicket) {
        snapshotReading = false;
      }
    }
  }
  async function recoverUnits(message: StudioEvent, serial: number) {
    const current = options.getDocument();
    const revision = Number(message.revision);
    const ids = [
      ...new Set(
        Array.isArray(message.changedIds)
          ? message.changedIds
          : message.units?.map((unit) => unit.id),
      ),
    ];
    const validIds =
      ids.length > 0 && ids.length <= 200 && ids.every((id) => typeof id === 'string');

    if (!isNextRevision(current, revision) || !validIds) {
      await snapshot(serial);
      documentState(message);
      return;
    }
    try {
      const result = await queryClient.call(STUDIO_TOOLS.read, {
        artifactId,
        mode: 'units',
        ids,
        atRevision: revision,
      });

      if (!alive(serial) || !inReceivedEpoch(message.cursor)) {
        return;
      }

      const latest = options.getDocument();
      if (latest && latest.artifact.revision >= revision) {
        documentState(message);
        return;
      }
      if (!isNextRevision(latest, revision)) {
        await snapshot(serial);
        documentState(message);
        return;
      }
      if (!validRecovery(result, artifactId, revision, ids)) {
        throw new Error('作品单元读取返回了不匹配的版本。');
      }

      const next = options.applyRemoteEvent(latest, {
        ...message,
        artifact: result.artifact,
        units: result.units,
      });

      if (!next) {
        throw new Error('作品单元读取返回了无效的内容。');
      }

      options.onDocument(next);
      documentState(message);
    } catch (error) {
      if ((error as { code?: string })?.code !== 'VERSION_NOT_FOUND') {
        throw error;
      }

      await snapshot(serial);
      documentState(message);
    }
  }
  async function applyContentEvent(message: StudioEvent, serial: number) {
    const current = options.getDocument();
    if (current && Number(message.revision) <= current.artifact.revision) {
      documentState(message);
      return;
    }
    const next = isNextRevision(current, message.revision)
      ? applyRemoteRevision(current, message)
      : undefined;

    if (next) {
      options.onDocument(next);
      documentState(message);
      return;
    }
    await recoverUnits(message, serial);
  }

  function applyRemoteRevision(current: StudioDocument, message: StudioEvent) {
    const emptyChanges = message.units?.length === 0 && message.changedIds?.length === 0;
    const metadata = message.artifact;
    if (emptyChanges && metadata?.id === artifactId && metadata.revision === message.revision) {
      return { ...current, artifact: metadata };
    }

    return message.units ? options.applyRemoteEvent(current, message) : undefined;
  }

  async function recoverRevision(target: number, serial: number, signal: AbortSignal) {
    const previous = options.getDocument();
    if (!alive(serial) || previous?.artifact.id !== artifactId) {
      return;
    }
    if (previous.artifact.revision >= target) {
      return;
    }

    const after = documentCursor || cursor;
    const replay = (await json(
      await requestCollaborationReplay(
        client,
        { artifactId, after },
        { headers: headers(), signal },
      ),
    )) as SyncBatch;

    if (!alive(serial)) {
      return;
    }

    const current = options.getDocument();
    if (!current || current.artifact.id !== artifactId || current.artifact.revision >= target) {
      return;
    }

    const replayable =
      !replay.reset && inReceivedEpoch(replay.cursor) && Array.isArray(replay.events);
    const changes = replayable
      ? missedRevisions(replay.events, artifactId, current.artifact.revision, target)
      : undefined;

    if (!changes) {
      await snapshot(serial);
      return;
    }

    for (const message of changes) {
      if (!alive(serial)) {
        return;
      }

      await applyContentEvent(message, serial);
    }
  }

  function reportRevisionFailure(error: unknown, serial: number) {
    if (!alive(serial)) {
      return;
    }

    const denied = isRecord(error) && (error.status === 401 || error.status === 403);
    if (denied) {
      const reason = isRecord(error.details) ? error.details.reason : undefined;
      options.onEvent({ type: 'access-revoked', artifactId, reason });
      pause(false);
      return;
    }

    reportStudioWarning('未能校对作品版次，稍后会重新检查。', error);
  }

  async function checkRevision(serial: number) {
    const controller = new AbortController();
    revisionAbort = controller;
    const deadline = setTimeout(() => controller.abort(), 4000);
    try {
      const head: unknown = await json(
        await requestCollaborationRevision(client, artifactId, {
          headers: headers(),
          signal: controller.signal,
        }),
      );

      if (!alive(serial) || !isRecord(head) || head.artifactId !== artifactId) {
        return;
      }

      const { revision } = head;
      if (typeof revision !== 'number' || !Number.isSafeInteger(revision)) {
        return;
      }

      processing = processing
        .then(() => recoverRevision(revision, serial, controller.signal))
        .catch((error) => reportRevisionFailure(error, serial));
      await processing;
    } catch (error) {
      reportRevisionFailure(error, serial);
    } finally {
      clearTimeout(deadline);
      if (revisionAbort === controller) {
        revisionAbort = undefined;
      }
    }
  }

  async function event(message: StudioEvent, serial: number) {
    const wrongArtifact = message.artifactId && message.artifactId !== artifactId;
    if (!alive(serial) || wrongArtifact || !inReceivedEpoch(message.cursor)) {
      return;
    }

    if (!handledControls.has(message)) {
      options.onEvent(message);
    }
    if (message.type === 'access-revoked') {
      pause(false);
      return;
    }
    if (message.type === 'room' && Array.isArray(message.events)) {
      deliver(message.events as RoomMessage[]);
      return;
    }
    if (message.type === 'presence') {
      acceptPresence(message as unknown as SyncBatch);
      return;
    }
    if (message.type === 'feedback') {
      feedbackVersion += 1;
      requestFeedback(serial);
      return;
    }
    if (typeof message.revision === 'number' || message.units) {
      await applyContentEvent(message, serial);
      return;
    }
    if (!['ready', 'share', 'presence', 'room'].includes(message.type)) {
      await snapshot(serial);
    }
  }

  function flushConnectionOutboxes(serial: number) {
    runInConnection(flushPresence(), serial);
    runInConnection(flushRoom(), serial);
  }

  async function batch(result: IncomingBatch, serial: number) {
    if (!alive(serial) || !inReceivedEpoch(result.cursor)) {
      return;
    }
    if (!result.reset && !cursorCanAdvance(result.cursor, cursor)) {
      return;
    }

    if (result.reset) {
      cursor = result.cursor || '';
      await snapshot(serial);
    }
    if (!alive(serial) || !inReceivedEpoch(result.cursor)) {
      return;
    }

    if (result.type === 'room') {
      await event(result, serial);
    } else if (Array.isArray(result.events)) {
      for (const message of result.events) {
        await event(message, serial);
      }
    } else if (result.type && result.type !== 'reset') {
      await event(result, serial);
    }
    if (!alive(serial) || !inReceivedEpoch(result.cursor)) {
      return;
    }

    if (result.cursor) {
      cursor = result.cursor;
    }
    connected = true;
    reportStatus('saved');
    flushConnectionOutboxes(serial);
  }

  function updateBatchAuthority(result: IncomingBatch) {
    const announcesAuthority = result.actor || result.type === 'ready';
    const authorityAdvances =
      result.cursor === authorityCursor ||
      cursorCanAdvance(result.cursor, authorityCursor, result.reset);

    if (announcesAuthority && authorityAdvances) {
      if (result.cursor) {
        authorityCursor = result.cursor;
      }
      options.onEvent({
        type: 'ready',
        artifactId,
        actor: result.actor,
        access: result.access,
        cursor: result.cursor,
      });
    }
    if (result.reset) {
      seenRooms.clear();
      localState({ type: 'reset', reason: 'reset' });
      options.onReset?.();
    }
    const clockAdvances =
      result.cursor === peerCursor || cursorCanAdvance(result.cursor, peerCursor, result.reset);

    if (typeof result.serverTime === 'number' && clockAdvances) {
      options.onClock?.(result.serverTime - Date.now());
    }
    for (const message of result.type === 'share' ? [result] : result.events || []) {
      if (message.type === 'share') {
        options.onEvent(message);
        handledControls.add(message);
      }
    }
  }

  function deliverRoomEvents(result: IncomingBatch) {
    if (result.type === 'room' && Array.isArray(result.events)) {
      deliver(result.events as unknown as RoomMessage[]);
      return;
    }
    for (const message of result.events || []) {
      if (message.type === 'room' && Array.isArray(message.events)) {
        deliver(message.events as RoomMessage[]);
      }
    }
  }

  function loseIfCurrent(error: unknown, serial: number) {
    if (alive(serial)) {
      lost(error);
    }
  }

  function enqueueOverflow(result: IncomingBatch, serial: number) {
    overflowCursor = result.cursor || overflowCursor || cursor;
    if (!queued && !overflowReading) {
      processing = processing
        .then(() => drainOverflow(serial))
        .catch((error) => loseIfCurrent(error, serial));
    }
    return processing;
  }

  function enqueue(result: IncomingBatch, serial: number) {
    if (!alive(serial)) {
      return Promise.resolve();
    }

    const revocation =
      result.type === 'access-revoked'
        ? result
        : result.events?.find((message) => message.type === 'access-revoked');

    if (revocation) {
      options.onEvent(revocation);
      pause(false);
      return Promise.resolve();
    }
    if (!cursorCanAdvance(result.cursor, receivedCursor, result.reset)) {
      return Promise.resolve();
    }

    if (result.cursor) {
      receivedCursor = result.cursor;
    }
    updateBatchAuthority(result);
    acceptPresence(result, !!result.reset);
    deliverRoomEvents(result);
    if (options.getDocument()) {
      connected = true;
      flushConnectionOutboxes(serial);
    }
    const bytes = new TextEncoder().encode(JSON.stringify(result)).length;
    if (queued >= 64 || queuedBytes + bytes > 4 * 1024 * 1024) {
      return enqueueOverflow(result, serial);
    }

    queued += 1;
    queuedBytes += bytes;
    processing = processing
      .then(async () => {
        try {
          if (inReceivedEpoch(result.cursor)) {
            await batch(result, serial);
          }
        } finally {
          if (generation === serial) {
            queued -= 1;
            queuedBytes -= bytes;
          }
        }
        await drainOverflow(serial);
      })
      .catch((error) => loseIfCurrent(error, serial));

    return processing;
  }
  async function drainOverflow(serial: number) {
    if (!alive(serial) || overflowReading) {
      return;
    }

    overflowReading = true;
    try {
      while (!queued && overflowCursor !== undefined && alive(serial)) {
        const barrier = overflowCursor;
        overflowCursor = undefined;
        await snapshot(serial);
        if (alive(serial) && position(barrier).epoch === position(receivedCursor).epoch) {
          cursor = barrier;
        }
      }
    } finally {
      if (generation === serial) {
        overflowReading = false;
      }
    }
  }
  async function polling(serial: number) {
    while (alive(serial)) {
      pollAbort = new AbortController();
      const request = requestCollaborationPoll(
        client,
        { artifactId, peerId, peerEpoch, after: receivedCursor },
        { headers: headers(), signal: pollAbort.signal },
      );

      try {
        const result = await json(await request);

        if (!alive(serial)) {
          return;
        }

        runInConnection(enqueue(result, serial), serial);

        if (alive(serial)) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 10);
          });
        }
      } catch (error) {
        if (alive(serial) && !pollAbort.signal.aborted) {
          lost(error);
        }
        return;
      }
    }
  }
  function connect() {
    if (closed || document.visibilityState === 'hidden') {
      return;
    }

    const serial = ++generation;

    cursor = '';
    receivedCursor = '';
    peerCursor = '';
    authorityCursor = '';
    documentCursor = '';
    pending = { ...published, ...pending, visible: true };
    connected = false;

    reportStatus(syncStatus === 'reconnecting' ? 'reconnecting' : 'loading');
    if (!client.baseUrl) {
      snapshot(serial).then(
        () => {
          if (alive(serial)) {
            reportStatus('saved');
          }
        },
        (error) => {
          if (!alive(serial)) {
            return;
          }

          reportStatus('reconnecting');
          options.onError(error);
        },
      );

      return;
    }
    const nextStream = options.polling ? undefined : connectStream(serial);
    if (nextStream) {
      stream = nextStream;
    } else {
      runInConnection(polling(serial), serial);
    }
  }
  function connectStream(serial: number) {
    return openCollaborationStream(
      client,
      { artifactId, peerId, peerEpoch, after: cursor },
      {
        message(data) {
          if (!alive(serial)) {
            return;
          }

          try {
            runInConnection(enqueue(JSON.parse(data), serial), serial);
          } catch (error) {
            lost(error);
          }
        },
        change(data) {
          if (!alive(serial)) {
            return;
          }

          try {
            runInConnection(enqueue(JSON.parse(data), serial), serial);
          } catch (error) {
            reportStudioWarning('无法解析实时变更，正在重新读取白板。', error);
            runInConnection(refresh(), serial);
          }
        },
        reset(data) {
          if (!alive(serial)) {
            return;
          }

          try {
            const reset = { ...JSON.parse(data), reset: true };
            runInConnection(enqueue(reset, serial), serial);
          } catch (error) {
            reportStudioWarning('无法解析实时重置，正在重新读取白板。', error);
            cursor = '';
            runInConnection(refresh(), serial);
          }
        },
        disconnected() {
          if (alive(serial)) {
            lost(new Error('实时连接已中断，正在重新连接。'));
          }
        },
      },
    );
  }
  function lost(error: unknown) {
    pause(false);
    reportStatus('reconnecting');
    options.onError(error);
    if (!closed && document.visibilityState !== 'hidden') {
      reconnect = setTimeout(connect, 1000);
    }
  }
  function pause(leave: boolean, reason: 'pause' | 'close' = 'pause') {
    generation += 1;
    connected = false;
    stream?.close();
    stream = undefined;
    pollAbort?.abort();
    revisionAbort?.abort();
    revisionAbort = undefined;
    presenceAbort?.abort();
    roomAbort?.abort();
    clearTimeout(reconnect);
    clearTimeout(presenceTimer);
    clearTimeout(roomTimer);
    presenceTimer = roomTimer = undefined;
    reads.forEach((read) => read.abort());
    reads.clear();
    snapshotTicket += 1;
    feedbackTicket += 1;
    snapshotReading = feedbackReading = false;
    processing = Promise.resolve();
    queued = queuedBytes = 0;
    overflowCursor = undefined;
    overflowReading = false;
    for (const outgoing of roomOutbox.splice(0)) {
      outgoing.resolve(false);
    }
    for (const outgoing of timerOutbox.splice(0)) {
      outgoing.reject(new Error('连接已暂停，计时操作未提交。'));
    }
    pending = { ...pending, cursor: null, visible: false };
    presenceBusy = roomBusy = false;
    peers = [];
    if (isCurrent()) {
      options.onPresence(peers, timer);
      localState({ type: 'reset', reason });
      if (leave) {
        options.onCursorClear?.();
      }
    }
    if (leave && client.baseUrl) {
      const serial = generation;
      studioRequest(client, url('/api/presence'), {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          artifactId,
          peerId,
          peerEpoch,
          peerSeq: ++identity.presence,
          leave: true,
        }),
        keepalive: !options.polling,
      }).catch((error) => {
        if (alive(serial)) {
          options.onError(error);
        }
      });
    }
  }
  async function flushPresence() {
    if (!connected || closed || presenceBusy) {
      return;
    }
    if (!Object.keys(pending).length && !timerOutbox.length) {
      return;
    }

    const delay = timerOutbox.length ? 0 : Math.max(0, 33 - (Date.now() - lastPresence));
    if (delay) {
      presenceTimer ??= setTimeout(() => {
        presenceTimer = undefined;
        runInConnection(flushPresence());
      }, delay);

      return;
    }
    const patch = pending;
    const action = timerOutbox.shift();
    pending = {};
    presenceBusy = true;
    lastPresence = Date.now();
    const serial = generation;
    presenceAbort = new AbortController();
    try {
      const result = await json(
        await studioRequest(client, url('/api/presence'), {
          method: 'POST',
          headers: headers(),
          signal: presenceAbort.signal,
          body: JSON.stringify({
            artifactId,
            peerId,
            peerEpoch,
            peerSeq: ++identity.presence,
            ...patch,
            ...(action ? { timer: action.data } : {}),
          }),
        }),
      );

      if (alive(serial)) {
        acceptPresence(result);
        action?.resolve();
      } else {
        action?.reject(new Error('连接已变更，计时操作结果未确认。'));
      }
    } catch (error) {
      action?.reject(error);
      if (alive(serial) && !presenceAbort.signal.aborted) {
        options.onError(error);
      }
    } finally {
      if (generation === serial) {
        presenceBusy = false;
        runInConnection(flushPresence(), serial);
      }
    }
  }
  function presence(patch: PresencePatch) {
    if (closed) {
      return;
    }

    const changed = Object.fromEntries(
      Object.entries(patch).filter(
        ([key, value]) =>
          JSON.stringify(published[key as keyof PresencePatch]) !== JSON.stringify(value),
      ),
    ) as PresencePatch;
    published = { ...published, ...changed };
    pending = { ...pending, ...changed };
    if (patch.cursor) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => presence({ cursor: null }), 15 * 60_000);
    }
    runInConnection(flushPresence());
  }
  async function flushRoom() {
    const available = connected && !closed && !roomBusy;
    if (!available || !roomOutbox.length) {
      return;
    }

    roomBusy = true;
    const serial = generation;
    const outgoing: typeof roomOutbox = [];
    let size = 0;
    while (roomOutbox.length && outgoing.length < 16) {
      const candidate = roomOutbox[0]!;
      const bytes = new TextEncoder().encode(
        JSON.stringify({ topic: candidate.topic, data: candidate.data }),
      ).length;

      if (size + bytes > 56_000 && outgoing.length) {
        break;
      }

      size += bytes;
      outgoing.push(roomOutbox.shift()!);
    }
    roomAbort = new AbortController();
    try {
      const result = await json(
        await studioRequest(client, url('/api/room'), {
          method: 'POST',
          headers: headers(),
          signal: roomAbort.signal,
          body: JSON.stringify({
            artifactId,
            peerId,
            peerEpoch,
            peerSeq: ++identity.room,
            events: outgoing.map(({ topic, data }) => ({ topic, data })),
          }),
        }),
      );
      outgoing.forEach((item) =>
        item.resolve(
          alive(serial) &&
            (typeof result.accepted === 'number'
              ? result.accepted === outgoing.length
              : result.accepted !== false),
        ),
      );
    } catch (error) {
      outgoing.forEach((item) => item.resolve(false));
      if (alive(serial) && !roomAbort.signal.aborted) {
        options.onError(error);
      }
    } finally {
      if (generation === serial) {
        roomBusy = false;
        runInConnection(flushRoom(), serial);
      }
    }
  }
  const room: CollaborationRoom = {
    send(topic, data) {
      if (closed || !connected || document.visibilityState === 'hidden') {
        return Promise.resolve(false);
      }
      if (!['gesture', 'upload', 'follow'].includes(topic)) {
        return Promise.resolve(false);
      }
      if (new TextEncoder().encode(JSON.stringify(data)).length > 4096) {
        return Promise.resolve(false);
      }

      if (roomOutbox.length >= 80 && roomData(data) && data.phase === 'end') {
        const index = roomOutbox.findIndex(
          (item) => roomData(item.data) && item.data.phase !== 'end',
        );

        if (index >= 0) {
          roomOutbox.splice(index, 1)[0]!.resolve(false);
        }
      }
      if (roomOutbox.length >= 80) {
        return Promise.resolve(false);
      }

      return new Promise((resolve) => {
        roomOutbox.push({ topic, data, resolve });
        roomTimer ??= setTimeout(() => {
          roomTimer = undefined;
          runInConnection(flushRoom());
        }, 0);
      });
    },
    subscribe(topic, listener) {
      const group = listeners.get(topic) || new Set();
      group.add(listener);
      listeners.set(topic, group);
      return () => {
        group.delete(listener);
        if (!group.size) {
          listeners.delete(topic);
        }
      };
    },
    subscribeState(listener) {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
  };
  function refresh() {
    const serial = generation;
    processing = processing
      .then(() => snapshot(serial))
      .catch((error) => {
        if (alive(serial)) {
          lost(error);
        }
      });

    return processing;
  }
  const clearCursor = () => {
    options.onCursorClear?.();
    presence({ cursor: null });
  };
  const visibility = () => {
    if (document.visibilityState === 'hidden') {
      pause(true);
    } else {
      pending = { ...pending, visible: true };
      connect();
    }
  };
  const pagehide = () => pause(true);
  const heartbeat = setInterval(() => {
    if (connected) {
      pending.visible = true;
      runInConnection(flushPresence());
    }
  }, 15000);
  const revisionCheck = setInterval(() => {
    const serial = generation;
    const online = connected && Boolean(client.baseUrl) && alive(serial);
    if (online && artifactId && !revisionAbort) {
      void checkRevision(serial).catch((error) => reportRevisionFailure(error, serial));
    }
  }, 2000);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', pagehide);
  window.addEventListener('blur', clearCursor);
  document.documentElement.addEventListener('pointerleave', clearCursor);
  connect();
  return {
    room,
    presence,
    refresh,
    refreshFeedback: () => requestFeedback(generation),
    timer(data: Record<string, unknown>): Promise<void> {
      if (!connected) {
        return Promise.reject(new Error('请在连接恢复后重试计时操作。'));
      }

      return new Promise((resolve, reject) => {
        timerOutbox.push({ data, resolve, reject });
        runInConnection(flushPresence());
      });
    },
    feedbackChanged() {
      feedbackVersion += 1;
      feedbackAgain = true;
    },
    close() {
      if (closed) {
        return;
      }

      pause(true, 'close');
      closed = true;
      clearInterval(heartbeat);
      clearInterval(revisionCheck);
      clearTimeout(idleTimer);
      listeners.clear();
      stateListeners.clear();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('blur', clearCursor);
      document.documentElement.removeEventListener('pointerleave', clearCursor);
    },
  };
}

export function useCollaboration(
  options: Options & { enabled: boolean; scope?: StudioViewRequests },
) {
  const { artifactId, client, enabled, peerId, polling, scope } = options;
  const callbacks = useRef(options);
  useLayoutEffect(() => {
    callbacks.current = options;
  }, [options]);
  const controller = useRef<
    { artifactId: string; transport: ReturnType<typeof createCollaboration> } | undefined
  >(undefined);
  const identity = useRef<PageIdentity | undefined>(undefined);
  const roomVersion = useRef(0);
  const [resetVersion, resetRoom] = useState(0);
  const subscriptions = useRef(new Map<string, Set<(message: RoomMessage) => void>>());
  const stateSubscriptions = useRef(new Set<(event: CollaborationStateEvent) => void>());
  const room = useMemo<CollaborationRoom>(
    () => ({
      send(topic, data) {
        const active = controller.current;
        if (!enabled || active?.artifactId !== artifactId || roomVersion.current !== resetVersion) {
          return Promise.resolve(false);
        }

        return active.transport.room.send(topic, data);
      },
      subscribe(topic, listener) {
        const group = subscriptions.current.get(topic) || new Set();
        group.add(listener);
        subscriptions.current.set(topic, group);
        return () => {
          group.delete(listener);
          if (!group.size) {
            subscriptions.current.delete(topic);
          }
        };
      },
      subscribeState(listener) {
        stateSubscriptions.current.add(listener);
        return () => {
          stateSubscriptions.current.delete(listener);
        };
      },
    }),
    [artifactId, enabled, resetVersion],
  );
  useEffect(() => {
    if (!enabled || !artifactId) {
      return;
    }

    identity.current ??= { epoch: newClientId('epoch'), presence: 0, room: 0 };
    const view = scope?.capture();
    const active = createCollaboration({
      artifactId,
      client,
      peerId,
      polling,
      identity: identity.current,
      isCurrent: () => {
        const next = callbacks.current;
        const sameScope = next.client === client && next.artifactId === artifactId && next.enabled;
        const sameView = !scope || (view !== undefined && scope.isCurrent(view));

        return sameScope && sameView;
      },
      getDocument: () => callbacks.current.getDocument(),
      applyRemoteEvent: (current, event) => callbacks.current.applyRemoteEvent(current, event),
      onDocument: (value) => callbacks.current.onDocument(value),
      onFeedback: (value) => callbacks.current.onFeedback(value),
      onPresence: (peers, timer) => callbacks.current.onPresence(peers, timer),
      onEvent: (event) => callbacks.current.onEvent(event),
      onStatus: (status) => callbacks.current.onStatus(status),
      onError: (error) => callbacks.current.onError(error),
      onClock: (offset) => callbacks.current.onClock?.(offset),
      onCursorClear: () => callbacks.current.onCursorClear?.(),
      onReset: () => resetRoom(++roomVersion.current),
    });
    controller.current = { artifactId, transport: active };
    const unsubscribes = ['gesture', 'upload', 'follow'].map((topic) =>
      active.room.subscribe(topic, (message) => {
        for (const listener of subscriptions.current.get(topic) || []) {
          listener(message);
        }
      }),
    );
    unsubscribes.push(
      active.room.subscribeState!((event) => {
        for (const listener of stateSubscriptions.current) {
          listener(event);
        }
      }),
    );

    return () => {
      controller.current = undefined;
      active.close();
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [artifactId, client, enabled, peerId, polling, scope]);

  return useMemo(
    () => ({
      room,
      presence: (patch: PresencePatch) => controller.current?.transport.presence(patch),
      refresh: () => controller.current?.transport.refresh() || Promise.resolve(),
      refreshFeedback: () => controller.current?.transport.refreshFeedback(),
      timer: (data: Record<string, unknown>) =>
        controller.current?.transport.timer(data) ||
        Promise.reject(new Error('白板连接尚未建立。')),
      feedbackChanged: () => controller.current?.transport.feedbackChanged(),
    }),
    [room],
  );
}
