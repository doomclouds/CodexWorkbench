import { mergeConfirmedScene } from './confirmed-scene.js';
import type {
  WhiteboardMoveCommand,
  WhiteboardMoveReceipt,
  WhiteboardObject,
  WhiteboardPayload,
  WhiteboardScene,
  WhiteboardService,
} from './contracts.js';
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

interface WhiteboardSession {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => WhiteboardSnapshot;
  readonly open: () => () => void;
  readonly reload: () => void;
  readonly observeVisible: (ids: readonly string[]) => void;
  readonly retryPayloads: () => void;
  readonly submitMove: (command: WhiteboardMoveCommand) => Promise<WhiteboardMoveReceipt>;
  readonly readReceipt: (commandId: string) => Promise<WhiteboardMoveReceipt | undefined>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWhiteboardSession(
  service: WhiteboardService,
  boardId: string,
): WhiteboardSession {
  const listeners = new Set<() => void>();
  let snapshot: WhiteboardSnapshot = { kind: 'loading' };
  let objects = new Map<string, WhiteboardObject>();
  let cache: PayloadCache = new Map();
  let visible: readonly string[] = [];
  let controller: AbortController | undefined;
  let readingPayloads: AbortSignal | undefined;
  let sceneRequest = 0;

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

  async function loadPayloads(requests: readonly PayloadRequest[], signal: AbortSignal) {
    try {
      const results = await service.getPayloads(
        boardId,
        requests.map(({ id }) => id),
        signal,
      );

      if (signal.aborted || snapshot.kind !== 'ready') {
        return;
      }

      cache = mergePayloadCache(cache, visible, objects, requests, results);
      publish({ ...snapshot, payloads: visiblePayloads(cache, objects) });
    } finally {
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

    const requests = missingPayloads(visible, objects, cache);
    if (requests.length === 0) {
      return;
    }

    readingPayloads = signal;
    loadPayloads(requests, signal).then(requestVisible, (error: unknown) =>
      failPayloads(error, signal),
    );
  }

  function acceptScene(scene: WhiteboardScene) {
    objects = new Map(scene.objects.map((object) => [object.id, object]));
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

  async function loadScene(request: number, signal: AbortSignal) {
    const scene = await service.getScene(boardId, signal);
    if (!sceneIsCurrent(request, signal)) {
      return;
    }
    if (scene.boardId !== boardId) {
      throw new Error('服务返回了其他白板。');
    }
    if (snapshot.kind === 'ready' && scene.revision < snapshot.scene.revision) {
      return;
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
    loadScene(request, signal).catch((error: unknown) => failScene(error, request, signal));
  }

  function open() {
    controller?.abort();
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

  function receiveReceipt(receipt: WhiteboardMoveReceipt, commandId: string) {
    if (receipt.boardId !== boardId || receipt.commandId !== commandId) {
      throw new Error('保存回执和当前命令不匹配。');
    }
    if (snapshot.kind !== 'ready') {
      return;
    }

    const scene = mergeConfirmedScene(snapshot.scene, receipt);
    if (scene !== snapshot.scene) {
      acceptScene(scene);
    }
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
    async submitMove(command) {
      const signal = requireSignal();
      if (command.boardId !== boardId) {
        throw new Error('移动命令和当前白板不匹配。');
      }

      const receipt = await service.moveObjects(command, signal);
      signal.throwIfAborted();
      receiveReceipt(receipt, command.commandId);

      return receipt;
    },
    async readReceipt(commandId) {
      const signal = requireSignal();
      const receipt = await service.getReceipt(boardId, commandId, signal);
      signal.throwIfAborted();
      if (receipt) {
        receiveReceipt(receipt, commandId);
      }

      return receipt;
    },
  };
}
