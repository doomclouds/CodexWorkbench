import {
  mergeConfirmedEdit,
  mergeRoomContent,
  type AppliedBoardEdit,
  type WhiteboardContentChange,
} from './confirmed-edits.js';
import { mergeConfirmedScene } from './confirmed-scene.js';
import type {
  WhiteboardMoveCommand,
  WhiteboardMoveReceipt,
  WhiteboardObject,
  WhiteboardPayload,
  WhiteboardPayloadResult,
  WhiteboardScene,
  WhiteboardService,
} from './contracts.js';
import type { BoardEditReceipt } from './edits-types.js';
import {
  mergePayloadCache,
  missingPayloads,
  visiblePayloads,
  type PayloadCache,
  type PayloadRequest,
} from './payload-cache.js';

export interface WhiteboardReadyState {
  readonly kind: 'ready';
  readonly scene: WhiteboardScene;
  readonly payloads: ReadonlyMap<string, WhiteboardPayload>;
  readonly payloadError?: string;
  readonly sceneError?: string;
}

export type WhiteboardSnapshot =
  | WhiteboardReadyState
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string };

type PrepareMoveReceipt = (receipt: WhiteboardMoveReceipt) => (() => void) | undefined;

interface WhiteboardSession {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => WhiteboardSnapshot;
  readonly open: () => () => void;
  readonly reload: () => void;
  readonly observeVisible: (ids: readonly string[]) => void;
  readonly retryPayloads: () => void;
  readonly acceptEdit: (receipt: AppliedBoardEdit) => void;
  readonly acceptRoomContent: (change: WhiteboardContentChange) => void;
  readonly acceptConflict: (receipt: ConflictingEdit) => void;
  readonly submitMove: (
    command: WhiteboardMoveCommand,
    prepare?: PrepareMoveReceipt,
  ) => Promise<WhiteboardMoveReceipt>;
  readonly readReceipt: (
    commandId: string,
    prepare?: PrepareMoveReceipt,
  ) => Promise<WhiteboardMoveReceipt | undefined>;
}

type OptionalWhiteboardService = Pick<
  WhiteboardService,
  'moveObjects' | 'getReceipt' | 'getPayloadPage'
>;
type WhiteboardSessionService = Pick<WhiteboardService, 'getScene' | 'getPayloads'> &
  Partial<OptionalWhiteboardService>;
type ConflictingEdit = Extract<BoardEditReceipt, { kind: 'conflict' }>;

const maxUnpublishedPayloadBatches = 4;
const payloadPublicationWindowMs = 40;
const maxBoundedPageIds = 192;
const maxBufferedRoomChanges = 32;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWhiteboardSession(
  service: WhiteboardSessionService,
  boardId: string,
): WhiteboardSession {
  const listeners = new Set<() => void>();
  let snapshot: WhiteboardSnapshot = { kind: 'loading' };
  let objects = new Map<string, WhiteboardObject>();
  const positions = new Map<string, number>();
  let cache: PayloadCache = new Map();
  let visible: readonly string[] = [];
  let controller: AbortController | undefined;
  let readingPayloads: AbortSignal | undefined;
  let sceneRequest = 0;
  let readingScene: number | undefined;
  let sceneReloadQueued = false;
  let confirmedRevision = 0n;
  const bufferedRoomChanges = new Map<bigint, WhiteboardContentChange>();

  function rememberRevision(revision: bigint) {
    if (revision < confirmedRevision) {
      return false;
    }

    confirmedRevision = revision;

    return true;
  }

  function publish(next: WhiteboardSnapshot) {
    snapshot = next;
    for (const listener of listeners) {
      listener();
    }
  }

  function failPayloads(error: unknown, signal: AbortSignal) {
    if (!signal.aborted && snapshot.kind === 'ready') {
      publish({ ...snapshot, payloadError: messageOf(error) });
    }
  }

  function nextPayloadRequests() {
    const bounded = snapshot.kind === 'ready' && snapshot.scene.boundedPayloadRead;
    return missingPayloads(
      visible,
      objects,
      cache,
      bounded && service.getPayloadPage ? maxBoundedPageIds : undefined,
    );
  }

  async function fetchPayloads(ids: readonly string[], signal: AbortSignal) {
    if (snapshot.kind === 'ready' && snapshot.scene.boundedPayloadRead && service.getPayloadPage) {
      return service.getPayloadPage(boardId, ids, signal);
    }

    return { results: await service.getPayloads(boardId, ids, signal), processed: ids.length };
  }

  async function loadPayloads(initial: readonly PayloadRequest[], signal: AbortSignal) {
    let unpublished = 0;
    let publishedFirstBatch = false;
    let publicationTimer: ReturnType<typeof setTimeout> | undefined;

    function flushPayloads() {
      clearTimeout(publicationTimer);
      publicationTimer = undefined;
      if (unpublished && !signal.aborted && snapshot.kind === 'ready') {
        publish({ ...snapshot, payloads: visiblePayloads(cache, objects) });
        publishedFirstBatch = true;
      }
      unpublished = 0;
    }

    try {
      let requests = initial;
      while (requests.length && !signal.aborted) {
        const { results, processed } = await fetchPayloads(
          requests.map(({ id }) => id),
          signal,
        );

        if (signal.aborted || snapshot.kind !== 'ready') {
          return;
        }

        cache = mergePayloadCache(cache, visible, objects, requests.slice(0, processed), results);
        unpublished += 1;
        if (!publishedFirstBatch || unpublished === maxUnpublishedPayloadBatches) {
          flushPayloads();
        } else {
          publicationTimer ??= setTimeout(flushPayloads, payloadPublicationWindowMs);
        }

        requests = nextPayloadRequests();
      }
    } finally {
      flushPayloads();
      if (readingPayloads === signal) {
        readingPayloads = undefined;
      }
    }
  }

  function requestVisible() {
    const signal = controller?.signal;
    if (!signal || signal.aborted || readingPayloads === signal) {
      return;
    }
    if (snapshot.kind !== 'ready' || snapshot.payloadError) {
      return;
    }

    const requests = nextPayloadRequests();
    if (requests.length === 0) {
      return;
    }

    readingPayloads = signal;
    loadPayloads(requests, signal).then(requestVisible, (error: unknown) =>
      failPayloads(error, signal),
    );
  }

  function acceptScene(scene: WhiteboardScene, payloads?: readonly WhiteboardPayloadResult[]) {
    objects = new Map();
    positions.clear();
    for (const [position, object] of scene.objects.entries()) {
      objects.set(object.id, object);
      positions.set(object.id, position);
    }
    if (payloads?.length) {
      const requests = payloads.flatMap((result) => {
        if (result.kind !== 'loaded') {
          return [];
        }

        const { id, version } = result.payload;

        return objects.get(id)?.payloadVersion === version ? [{ id, version }] : [];
      });
      cache = mergePayloadCache(cache, visible, objects, requests, payloads);
    }
    publish({ kind: 'ready', scene, payloads: visiblePayloads(cache, objects) });
    requestVisible();
  }

  function sceneIsCurrent(request: number, signal: AbortSignal): boolean {
    return !signal.aborted && request === sceneRequest;
  }

  function failScene(error: unknown, request: number, signal: AbortSignal) {
    if (!sceneIsCurrent(request, signal)) {
      return;
    }

    const message = messageOf(error);
    if (snapshot.kind === 'ready') {
      publish({ ...snapshot, sceneError: message });
      return;
    }

    publish({ kind: 'failed', message });
  }

  function bufferRoomChange(change: WhiteboardContentChange) {
    if (
      !bufferedRoomChanges.has(change.revision) &&
      bufferedRoomChanges.size === maxBufferedRoomChanges
    ) {
      const oldest = bufferedRoomChanges.keys().next();
      if (!oldest.done) {
        bufferedRoomChanges.delete(oldest.value);
      }
    }
    bufferedRoomChanges.set(change.revision, change);
  }

  function replayRoomChanges(base: WhiteboardScene): WhiteboardScene {
    let scene = base;
    while (scene.revision < confirmedRevision) {
      const change = bufferedRoomChanges.get(scene.revision + 1n);
      const updated = change && mergeRoomContent(scene, change);
      if (!updated) {
        break;
      }

      scene = updated;
    }

    return scene;
  }

  async function loadScene(request: number, signal: AbortSignal) {
    const baseline = await service.getScene(boardId, signal);
    if (!sceneIsCurrent(request, signal)) {
      return;
    }
    if (baseline.boardId !== boardId) {
      throw new Error('服务返回了其他白板。');
    }

    const scene = replayRoomChanges(baseline);
    if (!rememberRevision(scene.revision)) {
      const alreadyRecovered =
        snapshot.kind === 'ready' && snapshot.scene.revision >= confirmedRevision;

      if (sceneReloadQueued || alreadyRecovered) {
        return;
      }

      throw new Error('当前白板场景早于已确认版次，请重新读取。');
    }

    acceptScene(scene);
  }

  function reload() {
    const signal = controller?.signal;
    if (!signal || signal.aborted) {
      return;
    }

    if (snapshot.kind === 'failed') {
      publish({ kind: 'loading' });
    }

    const request = ++sceneRequest;
    readingScene = request;
    sceneReloadQueued = false;
    loadScene(request, signal)
      .catch((error: unknown) => failScene(error, request, signal))
      .finally(() => finishScene(request, signal));
  }

  function finishScene(request: number, signal: AbortSignal) {
    if (readingScene !== request) {
      return;
    }

    readingScene = undefined;
    const outOfDate = snapshot.kind !== 'ready' || snapshot.scene.revision < confirmedRevision;
    const needsReload = sceneReloadQueued && !signal.aborted;
    sceneReloadQueued = false;
    if (outOfDate && needsReload) {
      reload();
    } else {
      bufferedRoomChanges.clear();
    }
  }

  function refreshScene() {
    if (readingScene !== undefined) {
      sceneReloadQueued = true;
    } else {
      reload();
    }
  }

  function open() {
    controller?.abort();
    bufferedRoomChanges.clear();
    const lifetime = new AbortController();
    controller = lifetime;
    reload();

    return () => lifetime.abort();
  }

  function requireSignal(): AbortSignal {
    const signal = controller?.signal;
    if (!signal || signal.aborted) {
      throw new Error('白板会话已结束。');
    }

    return signal;
  }

  function receiveReceipt(
    receipt: WhiteboardMoveReceipt,
    commandId: string,
    prepare?: PrepareMoveReceipt,
  ) {
    if (receipt.boardId !== boardId || receipt.commandId !== commandId) {
      throw new Error('保存回执和当前命令不匹配。');
    }

    const publishFeedback = prepare?.(receipt);
    try {
      applyMoveReceipt(receipt);
    } finally {
      publishFeedback?.();
    }
  }

  function applyMoveReceipt(receipt: WhiteboardMoveReceipt) {
    if (snapshot.kind !== 'ready') {
      return;
    }

    const revision = receipt.kind === 'rejected' ? undefined : receipt.revision;
    if (revision === undefined || !rememberRevision(revision)) {
      return;
    }

    if (revision > snapshot.scene.revision + 1n) {
      refreshScene();
      return;
    }

    const scene = mergeConfirmedScene(snapshot.scene, receipt, positions);
    if (scene !== snapshot.scene) {
      acceptMovedObjects(scene, receipt);
    }
  }

  function acceptMovedObjects(scene: WhiteboardScene, receipt: WhiteboardMoveReceipt) {
    if (receipt.kind !== 'applied' || snapshot.kind !== 'ready') {
      return;
    }

    let payloadChanged = false;
    for (const { id } of receipt.objects) {
      const position = positions.get(id);
      const current = position === undefined ? undefined : scene.objects[position];
      if (!current) {
        continue;
      }

      const previous = objects.get(id);
      objects.set(id, current);
      payloadChanged ||= previous?.payloadVersion !== current.payloadVersion;
    }

    const payloads = payloadChanged ? visiblePayloads(cache, objects) : snapshot.payloads;
    const retryPayloads = snapshot.payloadError !== undefined;
    publish({ kind: 'ready', scene, payloads });
    if (payloadChanged || retryPayloads) {
      requestVisible();
    }
  }

  function acceptEdit(receipt: AppliedBoardEdit) {
    if (receipt.boardId !== boardId || controller?.signal.aborted || snapshot.kind !== 'ready') {
      return;
    }
    if (!rememberRevision(receipt.revision)) {
      return;
    }

    if (receipt.detailsExpired) {
      refreshScene();
      return;
    }

    const scene = mergeConfirmedEdit(snapshot.scene, receipt);
    if (!scene) {
      refreshScene();
    } else if (scene !== snapshot.scene) {
      acceptScene(scene, receipt.payloads);
    }
  }

  function acceptRoomContent(change: WhiteboardContentChange) {
    const signal = controller?.signal;
    if (!signal || signal.aborted) {
      return;
    }

    const scene = snapshot.kind === 'ready' ? snapshot.scene : undefined;
    const outdated = scene !== undefined && change.revision <= scene.revision;
    if (outdated) {
      return;
    }

    if (!rememberRevision(change.revision)) {
      if (readingScene !== undefined) {
        bufferRoomChange(change);
      }

      return;
    }

    const updated = scene && mergeRoomContent(scene, change);
    if (updated) {
      acceptScene(updated);
    } else {
      bufferRoomChange(change);
      refreshScene();
    }
  }

  function acceptConflict(receipt: ConflictingEdit) {
    if (receipt.boardId !== boardId || controller?.signal.aborted || snapshot.kind !== 'ready') {
      return;
    }

    const { scene } = snapshot;
    if (receipt.revision !== undefined && !rememberRevision(receipt.revision)) {
      return;
    }

    if (receipt.objects.length) {
      const current = new Map(receipt.objects.map((object) => [object.id, object]));
      acceptScene(
        { ...scene, objects: scene.objects.map((object) => current.get(object.id) ?? object) },
        receipt.payloads,
      );
    }
    reload();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    open,
    reload,
    acceptEdit,
    acceptRoomContent,
    acceptConflict,
    observeVisible(ids) {
      visible = [...new Set(ids)];
      requestVisible();
    },
    retryPayloads() {
      if (snapshot.kind === 'ready') {
        publish({ ...snapshot, payloadError: undefined });
        requestVisible();
      }
    },
    async submitMove(command, prepare) {
      const signal = requireSignal();
      if (command.boardId !== boardId) {
        throw new Error('移动命令和当前白板不匹配。');
      }
      if (!service.moveObjects) {
        throw new Error('当前白板视图为只读。');
      }

      const receipt = await service.moveObjects(command, signal);
      signal.throwIfAborted();
      receiveReceipt(receipt, command.commandId, prepare);

      return receipt;
    },
    async readReceipt(commandId, prepare) {
      const signal = requireSignal();
      const receipt = await service.getReceipt?.(boardId, commandId, signal);
      signal.throwIfAborted();
      if (receipt) {
        receiveReceipt(receipt, commandId, prepare);
      }

      return receipt;
    },
  };
}
