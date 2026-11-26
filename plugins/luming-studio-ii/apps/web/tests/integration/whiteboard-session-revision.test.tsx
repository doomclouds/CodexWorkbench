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
