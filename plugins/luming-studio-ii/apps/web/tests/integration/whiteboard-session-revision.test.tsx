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
