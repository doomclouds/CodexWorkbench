import { expect, test } from 'vitest';
import {
  createWhiteboardSession,
  type WhiteboardObject,
  type WhiteboardPayload,
  type WhiteboardScene,
  type WhiteboardSnapshot,
} from '../../src/data/whiteboard/index.js';

const boardId = 'revision-test-board';
const objectId = 'document';

type WhiteboardSession = ReturnType<typeof createWhiteboardSession>;

function documentObject(label: string, geometryVersion: bigint, payloadVersion: bigint) {
  return {
    id: objectId,
    kind: 'document',
    label,
    geometry: { x: 0, y: 0, width: 160, height: 100, rotation: 0 },
    geometryVersion,
    payloadVersion,
    locked: false,
  } satisfies WhiteboardObject;
}

function boardScene(revision: bigint, object: WhiteboardObject): WhiteboardScene {
  return { boardId, title: '版本核对', canEdit: true, revision, objects: [object] };
}

function deferScene() {
  let deliver: ((scene: WhiteboardScene) => void) | undefined;
  const response = new Promise<WhiteboardScene>((resolve) => {
    deliver = resolve;
  });

  if (!deliver) {
    throw new Error('The deferred scene did not initialize.');
  }

  return { response, deliver };
}

function nextSnapshot(session: WhiteboardSession): Promise<WhiteboardSnapshot> {
  return new Promise((resolve) => {
    const unsubscribe = session.subscribe(() => {
      unsubscribe();
      resolve(session.getSnapshot());
    });
  });
}

function documentPayloads(ids: readonly string[]) {
  return ids.map((id) => ({
    kind: 'loaded' as const,
    payload: { id, version: 0n, body: { kind: 'document' as const, value: { blocks: [] } } },
  }));
}

test('uses the bounded payload page advertised by the scene and follows a deferred suffix', async () => {
  const original = documentObject('正文', 0n, 0n);
  const documents = Array.from({ length: 200 }, (_, index) => ({
    ...original,
    id: String(index),
  }));
  const batchSizes: number[] = [];
  const session = createWhiteboardSession(
    {
      async getScene() {
        return { ...boardScene(0n, original), objects: documents, boundedPayloadRead: true };
      },
      async getPayloads() {
        throw new Error('The scene supports bounded pages.');
      },
      async getPayloadPage(_board: string, ids: readonly string[]) {
        batchSizes.push(ids.length);
        const processed = Math.min(ids.length, 100);

        return { results: documentPayloads(ids.slice(0, processed)), processed };
      },
    },
    boardId,
  );
  const opened = nextSnapshot(session);
  const close = session.open();
  try {
    await opened;
    const first = nextSnapshot(session);
    session.observeVisible(documents.map(({ id }) => id));
    const shown = await first;
    expect(shown.kind === 'ready' && shown.payloads.size).toBe(100);
    const final = await nextSnapshot(session);
    expect(final.kind === 'ready' && final.payloads.size).toBe(200);
    expect(batchSizes).toEqual([192, 100]);
  } finally {
    close();
  }
});

test('loads at most 48 payloads per request and combines rapid follow-up results', async () => {
  const original = documentObject('正文', 0n, 0n);
  const documents = Array.from({ length: 105 }, (_, index) => ({
    ...original,
    id: String(index),
  }));
  const batchSizes: number[] = [];
  const shownSizes: number[] = [];
  const session = createWhiteboardSession(
    {
      async getScene() {
        return { ...boardScene(0n, original), objects: documents };
      },
      async getPayloads(_board, ids) {
        batchSizes.push(ids.length);

        return documentPayloads(ids);
      },
    },
    boardId,
  );
  const opened = nextSnapshot(session);
  const close = session.open();
  try {
    await opened;
    const loaded = new Promise<void>((resolve) => {
      const unsubscribe = session.subscribe(() => {
        const state = session.getSnapshot();
        if (state.kind === 'ready') {
          shownSizes.push(state.payloads.size);
          if (state.payloads.size === documents.length) {
            unsubscribe();
            resolve();
          }
        }
      });
    });
    session.observeVisible(documents.map(({ id }) => id));
    await loaded;
    expect(batchSizes).toEqual([48, 48, 9]);
    expect(shownSizes).toEqual([48, 105]);
  } finally {
    close();
  }
});

test('keeps completed payloads visible during a slow request and retries only missing objects', async () => {
  const original = documentObject('正文', 0n, 0n);
  const documents = Array.from({ length: 105 }, (_, index) => ({
    ...original,
    id: String(index),
  }));
  const batchSizes: number[] = [];
  let rejectSlowRequest: ((error: Error) => void) | undefined;
  const slowRequest = new Promise<ReturnType<typeof documentPayloads>>((_resolve, reject) => {
    rejectSlowRequest = reject;
  });
  const session = createWhiteboardSession(
    {
      async getScene() {
        return { ...boardScene(0n, original), objects: documents };
      },
      async getPayloads(_board, ids) {
        batchSizes.push(ids.length);

        return batchSizes.length === 3 ? slowRequest : documentPayloads(ids);
      },
    },
    boardId,
  );
  const opened = nextSnapshot(session);
  const close = session.open();
  try {
    await opened;
    const first = nextSnapshot(session);
    session.observeVisible(documents.map(({ id }) => id));
    const visible = await first;
    expect(visible.kind === 'ready' && visible.payloads.size).toBe(48);
    const intermediate = await nextSnapshot(session);
    expect(intermediate.kind === 'ready' && intermediate.payloads.size).toBe(96);
    const rejected = nextSnapshot(session);
    if (!rejectSlowRequest) {
      throw new Error('The delayed payload request was not initialized.');
    }

    rejectSlowRequest(new Error('正文连接已中断'));
    const error = await rejected;
    expect(error).toMatchObject({ kind: 'ready', payloadError: '正文连接已中断' });
    expect(error.kind === 'ready' && error.payloads.size).toBe(96);
    session.retryPayloads();
    const finished = await nextSnapshot(session);
    expect(finished.kind === 'ready' && finished.payloads.size).toBe(105);
    expect(batchSizes).toEqual([48, 48, 9, 9]);
  } finally {
    close();
  }
});

test('merges a move receipt into scene order without replacing unchanged geometry or payloads', async () => {
  const original = documentObject('正文', 0n, 0n);
  const neighbor = { ...original, id: 'neighbor' };
  const moved = { ...original, geometryVersion: 1n, geometry: { ...original.geometry, x: 48 } };
  const payload: WhiteboardPayload = {
    id: objectId,
    version: 0n,
    body: { kind: 'document', value: { blocks: [] } },
  };
  const session = createWhiteboardSession(
    {
      async getScene() {
        return { ...boardScene(0n, original), objects: [neighbor, original] };
      },
      async getPayloads() {
        return [{ kind: 'loaded', payload }];
      },
      async moveObjects({ commandId }) {
        return { kind: 'applied', boardId, commandId, revision: 1n, objects: [moved] };
      },
    },
    boardId,
  );
  const opened = nextSnapshot(session);
  const close = session.open();
  try {
    await opened;
    const loaded = nextSnapshot(session);
    session.observeVisible([objectId]);
    const before = await loaded;
    await session.submitMove({
      boardId,
      commandId: 'move-geometry',
      targets: [{ id: objectId, expectedGeometryVersion: 0n }],
      delta: { x: 48, y: 0 },
    });
    const after = session.getSnapshot();
    expect(after).toMatchObject({ scene: { revision: 1n, objects: [neighbor, moved] } });
    if (before.kind !== 'ready' || after.kind !== 'ready') {
      throw new Error('The board did not provide both move snapshots.');
    }

    expect(after.payloads).toBe(before.payloads);
    expect(after.scene.objects[0]).toBe(neighbor);
  } finally {
    close();
  }
});

test.each(['submit', 'lookup'] as const)(
  'stages a matching move status before publishing its scene through %s',
  async (route) => {
    const original = documentObject('正文', 0n, 0n);
    const moved = { ...original, geometryVersion: 1n, geometry: { ...original.geometry, x: 30 } };
    const receipt = {
      boardId,
      commandId: 'same-move',
      kind: 'applied' as const,
      revision: 1n,
      objects: [moved],
    };
    const session = createWhiteboardSession(
      {
        async getScene() {
          return boardScene(0n, original);
        },
        async getPayloads() {
          return [];
        },
        async moveObjects() {
          return receipt;
        },
        async getReceipt() {
          return receipt;
        },
      },
      boardId,
    );
    const opened = nextSnapshot(session);
    const close = session.open();
    try {
      await opened;
      const events: string[] = [];
      const stop = session.subscribe(() => events.push('scene-published'));
      try {
        function stage() {
          events.push('feedback-staged');

          return () => {
            events.push('feedback-published');
          };
        }

        await expect(session.readReceipt('another-move', stage)).rejects.toThrow('不匹配');
        expect(events).toEqual([]);
        if (route === 'submit') {
          await session.submitMove(
            {
              boardId,
              commandId: receipt.commandId,
              targets: [{ id: objectId, expectedGeometryVersion: 0n }],
              delta: { x: 30, y: 0 },
            },
            stage,
          );
        } else {
          await session.readReceipt(receipt.commandId, stage);
        }

        expect(events).toEqual(['feedback-staged', 'scene-published', 'feedback-published']);
        expect(session.getSnapshot()).toMatchObject({ scene: { revision: 1n, objects: [moved] } });
      } finally {
        stop();
      }
    } finally {
      close();
    }
  },
);

test('projects the palette changes and distinguishes a cleared palette from an absent receipt field', async () => {
  const object = documentObject('正文', 0n, 0n);
  const original = '#3864A2';
  const session = createWhiteboardSession(
    {
      async getScene() {
        return { ...boardScene(0n, object), customColors: [original] };
      },
      async getPayloads() {
        return [];
      },
    },
    boardId,
  );
  const opened = nextSnapshot(session);
  const close = session.open();
  try {
    expect(await opened).toMatchObject({ scene: { customColors: [original] } });
    const applied = {
      boardId,
      kind: 'applied' as const,
      commandId: 'palette-receipt',
      objects: [],
      removedIds: [],
      order: [],
      payloads: [],
    };
    session.acceptEdit({ ...applied, revision: 1n });
    expect(session.getSnapshot()).toMatchObject({
      scene: { revision: 1n, customColors: [original] },
    });
    session.acceptEdit({ ...applied, revision: 1n, customColors: [] });
    expect(session.getSnapshot()).toMatchObject({
      scene: { revision: 1n, customColors: [], objects: [object] },
    });
  } finally {
    close();
  }
});

test('keeps authoritative conflict details until a complete scene reaches that revision', async () => {
  const initial = documentObject('初始标题', 1n, 5n);
  const stale = documentObject('旧回执标题', 2n, 5n);
  const current = documentObject('最新标题', 2n, 6n);
  const payload: WhiteboardPayload = {
    id: objectId,
    version: current.payloadVersion,
    body: {
      kind: 'document',
      value: { title: current.label, document: { schemaVersion: 1, blocks: [] } },
    },
  };
  const staleRead = deferScene();
  const currentRead = deferScene();
  const reads = [
    Promise.resolve(boardScene(10n, initial)),
    staleRead.response,
    currentRead.response,
  ];
  const session = createWhiteboardSession(
    {
      getScene: () => reads.shift() ?? Promise.reject(new Error('Unexpected scene request.')),
      getPayloads: () => Promise.resolve([]),
    },
    boardId,
  );
  const opened = nextSnapshot(session);
  const close = session.open();
  try {
    expect(await opened).toMatchObject({ kind: 'ready', scene: boardScene(10n, initial) });

    session.acceptConflict({
      kind: 'conflict',
      boardId,
      commandId: 'conflicting-content',
      revision: 12n,
      objects: [current],
      payloads: [{ kind: 'loaded', payload }],
    });
    const conflictSnapshot = session.getSnapshot();
    expect(conflictSnapshot).toMatchObject({
      kind: 'ready',
      scene: boardScene(10n, current),
      payloads: new Map([[objectId, payload]]),
    });

    session.acceptEdit({
      kind: 'applied',
      boardId,
      commandId: 'late-geometry',
      revision: 11n,
      objects: [stale],
      payloads: [],
      removedIds: [],
      order: [],
    });
    expect(session.getSnapshot()).toBe(conflictSnapshot);

    const reportedStaleRead = nextSnapshot(session);
    staleRead.deliver(boardScene(11n, stale));
    expect(await reportedStaleRead).toMatchObject({
      kind: 'ready',
      scene: boardScene(10n, current),
      payloads: new Map([[objectId, payload]]),
      sceneError: expect.stringContaining('早于已确认版次'),
    });

    const caughtUp = nextSnapshot(session);
    session.reload();
    currentRead.deliver(boardScene(12n, current));
    expect(await caughtUp).toEqual({
      kind: 'ready',
      scene: boardScene(12n, current),
      payloads: new Map([[objectId, payload]]),
    });

    const moved = { ...current, geometryVersion: 3n, geometry: { ...current.geometry, x: 40 } };
    session.acceptEdit({
      kind: 'applied',
      boardId,
      commandId: 'current-geometry',
      revision: 13n,
      objects: [moved],
      payloads: [],
      removedIds: [],
      order: [],
    });
    expect(session.getSnapshot()).toMatchObject({
      kind: 'ready',
      scene: boardScene(13n, moved),
      payloads: new Map([[objectId, payload]]),
    });
  } finally {
    close();
  }
});

test.each(['document', 'table', 'shape', 'note'] as const)(
  'keeps confirmed %s content during the room refresh',
  async (kind) => {
    const bodyKind = kind === 'shape' || kind === 'note' ? 'text' : kind;
    const unedited = { ...documentObject('原版正文', 0n, 0n), kind };
    const edited = { ...documentObject('远端改动', 0n, 1n), kind };
    let latest = unedited;
    let sceneReads = 0;
    const payloadReads: (readonly string[])[] = [];
    const session = createWhiteboardSession(
      {
        async getScene() {
          sceneReads++;
          return boardScene(0n, unedited);
        },
        async getPayloads(_board, ids) {
          payloadReads.push(ids);
          return [
            {
              kind: 'loaded',
              payload: {
                id: objectId,
                version: latest.payloadVersion,
                body: { kind: bodyKind, value: { title: latest.label } },
              },
            },
          ];
        },
      },
      boardId,
    );
    const opened = nextSnapshot(session);
    const close = session.open();
    try {
      await opened;
      const before = nextSnapshot(session);
      session.observeVisible([objectId]);
      await before;
      latest = edited;

      session.acceptRoomContent({
        revision: 1n,
        changedObjectIds: [objectId],
        changedObjects: [edited],
        removedObjectIds: [],
        refreshScene: false,
      });
      expect(session.getSnapshot()).toMatchObject({
        kind: 'ready',
        scene: boardScene(1n, edited),
        payloads: new Map([
          [
            objectId,
            { id: objectId, version: 0n, body: { kind: bodyKind, value: { title: '原版正文' } } },
          ],
        ]),
      });
      const reflected = await nextSnapshot(session);
      expect(reflected.kind === 'ready' && reflected.payloads.get(objectId)?.version).toBe(1n);

      const moved = { ...edited, geometryVersion: 1n, geometry: { ...edited.geometry, x: 36 } };
      session.acceptRoomContent({
        revision: 2n,
        changedObjectIds: [objectId],
        changedObjects: [moved],
        removedObjectIds: [],
        refreshScene: false,
      });
      expect(session.getSnapshot()).toMatchObject({ kind: 'ready', scene: boardScene(2n, moved) });
      expect(sceneReads).toBe(1);
      expect(payloadReads).toEqual([[objectId], [objectId]]);
    } finally {
      close();
    }
  },
);

test('coalesces room revision gaps and ordering invalidations while a scene is already fetching', async () => {
  const initial = documentObject('原版正文', 0n, 0n);
  const firstRefresh = deferScene();
  const latestRefresh = deferScene();
  const reloads = [
    Promise.resolve(boardScene(0n, initial)),
    firstRefresh.response,
    latestRefresh.response,
  ];
  let sceneReads = 0;
  let firstRefreshStarted!: () => void;
  let secondRefreshStarted!: () => void;
  const first = new Promise<void>((resolve) => {
    firstRefreshStarted = resolve;
  });
  const second = new Promise<void>((resolve) => {
    secondRefreshStarted = resolve;
  });
  const session = createWhiteboardSession(
    {
      getScene() {
        sceneReads++;
        if (sceneReads === 2) {
          firstRefreshStarted();
        } else if (sceneReads === 3) {
          secondRefreshStarted();
        }

        return reloads.shift() ?? Promise.reject(new Error('Unexpected scene fetch.'));
      },
      async getPayloads() {
        return [];
      },
    },
    boardId,
  );
  const opened = nextSnapshot(session);
  const close = session.open();
  try {
    await opened;
    const change = { changedObjectIds: [], removedObjectIds: [], refreshScene: true };
    session.acceptRoomContent({ ...change, revision: 2n });
    await first;
    session.acceptRoomContent({ ...change, revision: 3n });
    session.acceptRoomContent({ ...change, revision: 4n });
    expect(sceneReads).toBe(2);
    firstRefresh.deliver(boardScene(2n, initial));
    await second;

    const latest = nextSnapshot(session);
    latestRefresh.deliver(boardScene(4n, initial));
    expect(await latest).toMatchObject({ kind: 'ready', scene: boardScene(4n, initial) });
    expect(sceneReads).toBe(3);
  } finally {
    close();
  }
});
