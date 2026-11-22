import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  DEFAULT_STYLE,
  LOCAL_ACTOR,
  type Board,
  type BoardElement,
  type Json,
  type RoomMessage,
  type StudioEvent,
} from '../../src/contracts/studio';
import {
  encodeGestureFrame,
  NativeGestureReceiver,
  useNativeGestureSync,
  type NativeGesture,
} from '../../src/app/shared/useNativeGestureSync';
import type { CollaborationRoom, CollaborationStateEvent } from '../../src/contracts/studio';
import { startStudioHost } from '../../src/server/http';
import WhiteboardCanvas from '../../src/app/features/whiteboard/canvas/WhiteboardCanvas';

const board = (elements: BoardElement[] = [], revision = 0): Board => ({
  artifact: {
    id: 'fixture',
    type: 'whiteboard',
    title: 'Protocol',
    revision,
    createdAt: '',
    updatedAt: '',
    pinned: false,
  },
  elements,
  style: DEFAULT_STYLE,
});

function stroke(count: number, fractional = false): BoardElement {
  return {
    id: 'stroke',
    type: 'stroke',
    version: 1,
    x: 100,
    y: 100,
    w: 1,
    h: 1,
    points: Array.from({ length: count }, (_, i) =>
      fractional ? [(i * 3) / 0.73, ((i % 31) * 2) / 0.73] : [i * 3, (i % 31) * 2],
    ).flat(),
  };
}

function packets(element: BoardElement, frame = 1, extra: Partial<NativeGesture> = {}) {
  let seq = frame * 100;

  return encodeGestureFrame(
    { id: 'operation', kind: 'ink', elements: [element], ...extra },
    frame,
    () => ++seq,
  ) as Record<string, any>[];
}

let roomSequence = 0;

function message(data: Json, peerId = 'other', actor = LOCAL_ACTOR): RoomMessage {
  return { peerId, actor, seq: ++roomSequence, topic: 'gesture', data, createdAt: '' };
}

function receive(receiver: NativeGestureReceiver, values: Record<string, any>[]) {
  values.forEach((value) => receiver.receive(message(value as Json)));
}

function richObject(type: 'document' | 'todo'): BoardElement {
  return {
    id: type,
    type,
    version: 2,
    x: 20,
    y: 30,
    w: 180,
    h: 90,
    text: 'Do not transmit this title',
    ...(type === 'document'
      ? { document: { schemaVersion: 1, blocks: [] } }
      : { data: { items: [{ id: 'item', text: 'Keep this task local', checked: false }] } }),
  };
}

function encodeAndReceive(
  receiver: NativeGestureReceiver,
  elements: BoardElement[],
  kind: NativeGesture['kind'],
  origin: NativeGesture['origin'] = 'existing',
) {
  let seq = 0;
  const encoded = encodeGestureFrame(
    { id: 'geometry', kind, origin, baseRevision: 5, elements },
    1,
    () => ++seq,
  );
  encoded.forEach((packet) => receiver.receive(message(packet)));

  return encoded;
}

describe('bounded native gesture encoding', () => {
  it.each([
    ['document', 'resize'],
    ['todo', 'resize'],
    ['document', 'move'],
    ['todo', 'move'],
  ] as const)('decodes %s %s geometry without sending its content', (type, kind) => {
    const original = richObject(type);
    const dimensions = kind === 'resize' ? { w: 260, h: 130 } : { x: 120, y: 160 };
    const geometry = {
      id: original.id,
      type,
      version: original.version,
      x: original.x,
      y: original.y,
      w: original.w,
      h: original.h,
      ...dimensions,
    };
    const receiver = new NativeGestureReceiver();
    const encoded = encodeAndReceive(receiver, [{ ...original, ...dimensions }], kind);
    const atoms = encoded.flatMap((packet) => (packet as { atoms: unknown[] }).atoms);

    expect(receiver.read(board([original], 5))[0]?.elements).toEqual([geometry]);
    expect(atoms).toEqual([{ element: geometry }]);
  });

  it('displays rich geometry in a mixed frame only when the corresponding objects match', () => {
    const doc = richObject('document');
    const todo = richObject('todo');
    const shape: BoardElement = {
      id: 'shape',
      type: 'shape',
      version: 1,
      x: 0,
      y: 0,
      w: 20,
      h: 20,
    };
    const resized = [doc, todo, shape].map((element) => ({ ...element, w: 260, h: 130 }));
    const receiver = new NativeGestureReceiver();
    encodeAndReceive(receiver, resized, 'resize');

    const partialBoard = board([{ ...doc, type: 'html' }, shape], 5);
    expect(receiver.read(partialBoard)[0]?.elements.map((element) => element.id)).toEqual([
      shape.id,
    ]);

    const matching = receiver.read(board([doc, todo, shape], 5))[0]?.elements;
    expect(matching?.map(({ id, w, h }) => ({ id, w, h }))).toEqual(
      resized.map(({ id, w, h }) => ({ id, w, h })),
    );
  });

  it('keeps placement frames limited to objects that can be created by a transient preview', () => {
    const doc = richObject('document');
    const todo = richObject('todo');
    const shape: BoardElement = {
      id: 'shape',
      type: 'shape',
      version: 1,
      x: 0,
      y: 0,
      w: 20,
      h: 20,
    };
    const receiver = new NativeGestureReceiver();
    encodeAndReceive(receiver, [doc, todo, shape], 'shape', 'create');

    expect(receiver.read(board([], 5))[0]?.elements).toEqual([shape]);
  });

  it('forwards fractional coordinates by actual UTF-8 bytes and keeps pair offsets intact', () => {
    const source = stroke(200, true);
    const encoded = packets(source);
    const receiver = new NativeGestureReceiver();
    expect(encoded.length).toBeGreaterThan(0);
    for (const part of encoded) {
      expect(new TextEncoder().encode(JSON.stringify(part)).length).toBeLessThanOrEqual(4096);
      for (const atom of part.atoms) {
        if (atom.points) {
          expect(atom.points.offset % 2).toBe(0);
          expect(atom.points.values.length % 2).toBe(0);
        }
      }
    }

    receive(receiver, encoded);
    expect(receiver.read(board())[0]?.elements[0]?.points).toEqual(source.points);
  });

  it('uses a bounded preview for a twenty-thousand-point stroke while retaining the original final points', () => {
    const source = stroke(20000, true);
    const before = [...source.points!];
    const encoded = packets(source);
    const receiver = new NativeGestureReceiver();
    expect(encoded.length).toBeGreaterThan(0);
    expect(encoded.length).toBeLessThanOrEqual(24);
    expect(
      encoded.every((value) => new TextEncoder().encode(JSON.stringify(value)).length <= 4096),
    ).toBe(true);
    expect(encoded[0]?.sampled).toBe(true);
    receive(receiver, encoded);
    const preview = receiver.read(board())[0]?.elements[0]?.points;
    expect(preview?.slice(0, 2)).toEqual(source.points?.slice(0, 2));
    expect(preview?.slice(-2)).toEqual(source.points?.slice(-2));
    expect(preview!.length).toBeLessThan(source.points!.length);
    expect(source.points).toEqual(before);
  });

  it('keeps short, single-point and ordinary integer multi-part previews exact', () => {
    for (const count of [1, 20, 2000]) {
      const source = stroke(count);
      const receiver = new NativeGestureReceiver();
      const encoded = packets(source);
      receive(receiver, [...encoded].reverse());
      expect(receiver.read(board())[0]?.elements[0]?.points).toEqual(source.points);
    }
  });

  it('retains a strong interior turn when the long preview is sampled and rejects unrepresentable geometry explicitly', () => {
    const source = stroke(20000);
    source.points = Array.from({ length: 20000 }, (_, index) => [
      index,
      index === 10000 ? 5000 : 0,
    ]).flat();
    const receiver = new NativeGestureReceiver();
    receive(receiver, packets(source));
    const points = receiver.read(board())[0]?.elements[0]?.points ?? [];
    expect(
      points.some(
        (value, index) => index % 2 === 0 && value === 10000 && points[index + 1] === 5000,
      ),
    ).toBe(true);
    expect(() => packets({ ...stroke(2), bends: Array(5000).fill('x') })).toThrow(/预算/);
  });

  it('preserves only a bounded sticker catalog key through encoding and decoding for a new draft', () => {
    for (const stickerIconId of ['smile', 'not-installed']) {
      const source: BoardElement = {
        id: 'sticker',
        type: 'sticker',
        version: 1,
        x: 10,
        y: 20,
        w: 80,
        h: 80,
        text: '🙂',
        data: {
          stickerIconId,
          secret: 'must-not-cross',
          html: '<script>private</script>',
          rows: Array(1000).fill('private-row'),
        },
      };
      const encoded = packets(source, 1, { origin: 'create', kind: 'shape' });
      const receiver = new NativeGestureReceiver();
      expect(JSON.stringify(encoded)).not.toMatch(/must-not-cross|private-row|<script>/);
      const wire = structuredClone(encoded);
      wire[0]!.atoms[0].element.data.secret = 'receive-only-secret';
      receive(receiver, wire);
      expect(receiver.read(board())[0]?.elements[0]?.data).toEqual({ stickerIconId });
    }
  });

  it('preserves safe new-shape visual styles without forwarding arbitrary data or malformed style fields', () => {
    const source: BoardElement = {
      id: 'shape',
      type: 'shape',
      version: 1,
      x: 10,
      y: 20,
      w: 80,
      h: 60,
      hollow: true,
      bold: true,
      italic: true,
      textAlign: 'right',
      fontFamily: 'Arial, sans-serif',
      data: { stickerIconId: 'smile', private: 'secret' },
    };
    const encoded = packets(source, 1, { origin: 'create', kind: 'shape' });
    const receiver = new NativeGestureReceiver();
    receive(receiver, encoded);
    const projected = receiver.read(board())[0]?.elements[0];
    expect(projected).toMatchObject({
      hollow: true,
      bold: true,
      italic: true,
      textAlign: 'right',
      fontFamily: 'Arial, sans-serif',
    });
    expect(projected).not.toHaveProperty('data');
    const malformed = structuredClone(encoded);
    malformed[0]!.id = malformed[0]!.operationId = 'malformed';
    Object.assign(malformed[0]!.atoms[0].element, {
      hollow: { private: true },
      fontFamily: 'f'.repeat(257),
      textAlign: { toString: 'left' },
    });
    const other = new NativeGestureReceiver();
    receive(other, malformed);
    expect(other.read(board())[0]?.elements[0]).not.toHaveProperty('hollow');
    expect(other.read(board())[0]?.elements[0]).not.toHaveProperty('fontFamily');
    expect(other.read(board())[0]?.elements[0]).not.toHaveProperty('textAlign');
  });
});

function authority(
  receiver: NativeGestureReceiver,
  document: Board,
  operationId?: string,
  versions: Record<string, number> = {},
  actorId = LOCAL_ACTOR.id,
) {
  receiver.authority({
    type: 'document',
    document,
    epoch: 'service',
    operationId,
    actorId,
    commitRevision: document.artifact.revision,
    changedIds: Object.keys(versions),
    unitVersions: versions,
  });
}

describe('trusted gesture lifecycle', () => {
  it('keeps the last full frame until every part of a newer frame has arrived', () => {
    const receiver = new NativeGestureReceiver();
    const first = stroke(2000);
    const second = stroke(6000);
    const next = packets(second, 2);
    receive(receiver, packets(first));
    receive(receiver, next.slice(0, -1).reverse());
    expect(receiver.read(board())[0]?.elements[0]?.points).toEqual(first.points);
    receive(receiver, next.slice(-1));
    expect(receiver.read(board())[0]?.elements[0]?.points).toEqual(second.points);
  });

  it('waits for a matching authoritative operation and the displayed document barrier, not a network commit claim', () => {
    const receiver = new NativeGestureReceiver();
    const source = stroke(20);
    const encoded = packets(source, 1, { origin: 'create', baseRevision: 0 });
    receive(receiver, encoded);
    receiver.receive(
      message({
        ...encoded[0],
        atoms: undefined,
        phase: 'end',
        outcome: 'committed',
        seq: 999,
        commitRevision: 999,
      } as unknown as Json),
    );
    expect(receiver.read(board())).toHaveLength(1);
    const saved = board(
      [{ ...source, w: 57, h: 38, points: [...source.points!, ...source.points!.slice(-2)] }],
      1,
    );
    authority(receiver, saved, 'operation', { stroke: 1 });
    expect(receiver.read(board())).toHaveLength(1);
    expect(receiver.read(saved)).toEqual([]);
    receive(receiver, encoded);
    expect(receiver.read(saved)).toEqual([]);
  });

  it('recognizes board-before-end and commit-before-preview without ten-second geometric equality', () => {
    for (const boardFirst of [false, true]) {
      const receiver = new NativeGestureReceiver();
      const source = stroke(20);
      const saved = board([{ ...source, w: 57, h: 38 }], 1);
      const encoded = packets(source, 1, { origin: 'create' });
      if (boardFirst) {
        authority(receiver, saved, 'operation', { stroke: 1 });
      }

      receive(receiver, encoded);
      if (!boardFirst) {
        authority(receiver, saved, 'operation', { stroke: 1 });
      }

      expect(receiver.read(saved)).toEqual([]);
    }
  });

  it('does not retire another region for a copied operation id, actor or unrelated global revision', () => {
    const receiver = new NativeGestureReceiver();
    const a = stroke(20);
    const b = { ...stroke(20), id: 'another' };
    authority(receiver, board([a, b], 1));
    receive(receiver, packets({ ...a, x: 250 }, 1, { origin: 'existing', baseRevision: 1 }));
    const changed = board([a, { ...b, version: 2 }], 2);
    authority(receiver, changed, 'operation', { another: 2 });
    expect(receiver.read(changed)[0]?.elements[0]?.id).toBe('stroke');
    authority(receiver, changed, 'operation', { stroke: 2 }, 'forged-other-actor');
    expect(receiver.read(changed)[0]?.elements[0]?.id).toBe('stroke');
    authority(receiver, changed, 'operation', { stroke: 2 });
    expect(receiver.read(changed)[0]?.elements[0]?.id).toBe('stroke');
  });

  it('clears a deleted target without killing the other region in the same pending gesture', () => {
    const receiver = new NativeGestureReceiver();
    const a = stroke(20);
    const b = { ...stroke(20), id: 'another' };
    const initial = board([a, b], 1);
    authority(receiver, initial);
    let seq = 0;
    receive(
      receiver,
      encodeGestureFrame(
        {
          id: 'multi-operation',
          kind: 'move',
          origin: 'existing',
          baseRevision: 1,
          elements: [
            { ...a, x: 300 },
            { ...b, x: 600 },
          ],
        },
        1,
        () => ++seq,
      ) as Record<string, any>[],
    );
    const deleted = board([b], 2);
    authority(receiver, deleted, 'multi-operation', { stroke: 0 });
    expect(receiver.read(deleted)[0]?.elements.map((element) => element.id)).toEqual(['another']);
  });

  it('clears canonical deletion and rejects late parts after undo recreates the same id', () => {
    const receiver = new NativeGestureReceiver();
    const source = stroke(20);
    const initial = board([source], 1);
    authority(receiver, initial);
    const old = packets({ ...source, x: 250 }, 1, { origin: 'existing', baseRevision: 1 });
    receive(receiver, old);
    expect(receiver.read(initial)).toHaveLength(1);
    authority(receiver, board([], 2), 'delete', { stroke: 0 });
    expect(receiver.read(board([], 2))).toEqual([]);
    const restored = board([{ ...source, version: 3 }], 3);
    authority(receiver, restored, 'undo', { stroke: 3 });
    receive(receiver, old);
    expect(receiver.read(restored)).toEqual([]);
    receive(
      receiver,
      packets({ ...source, version: 3, x: 350 }, 2, {
        id: 'new-operation',
        origin: 'existing',
        baseRevision: 3,
      }),
    );
    expect(receiver.read(restored)[0]?.elements[0]?.x).toBe(350);
  });

  it('does not treat an unpersisted create as deleted and does not let an old create overwrite a new resize', () => {
    const receiver = new NativeGestureReceiver();
    const source = stroke(20);
    const old = packets(source, 1, { origin: 'create' });
    authority(receiver, board());
    receive(receiver, old);
    expect(receiver.read(board())).toHaveLength(1);
    const saved = board([{ ...source, w: 200, h: 100 }], 1);
    authority(receiver, saved, 'operation', { stroke: 1 });
    expect(receiver.read(saved)).toEqual([]);
    receive(
      receiver,
      packets({ ...source, w: 400, h: 200 }, 2, {
        id: 'resize-operation',
        kind: 'resize',
        origin: 'existing',
        baseRevision: 1,
      }),
    );
    receive(receiver, old);
    expect(receiver.read(saved)[0]?.elements[0]).toMatchObject({ w: 400, h: 200 });
  });

  it('clears only known departed peers and old peer epochs, preserving another peer and region', () => {
    const receiver = new NativeGestureReceiver();
    const a = packets(stroke(20), 1, { epoch: 'one' });
    const b = packets({ ...stroke(20), id: 'another' }, 1, {
      id: 'another-operation',
      epoch: 'two',
    });
    a.forEach((packet) => receiver.receive(message(packet as Json, 'a')));
    b.forEach((packet) => receiver.receive(message(packet as Json, 'b')));
    receiver.authority({ type: 'peers', peers: [] });
    expect(receiver.read(board())).toHaveLength(2);
    const peers = ['a', 'b'].map((peerId) => ({
      peerId,
      actor: LOCAL_ACTOR,
      peerEpoch: 'view-1',
      updatedAt: '',
    }));
    receiver.authority({ type: 'peers', peers });
    receiver.authority({ type: 'peers', peers: peers.slice(1) });
    expect(receiver.read(board()).map((value) => value.peerId)).toEqual(['b']);
    a.forEach((packet) => receiver.receive(message(packet as Json, 'a')));
    expect(receiver.read(board()).map((value) => value.peerId)).toEqual(['b']);
    packets(stroke(20), 2, { id: 'new-a', epoch: 'new-view' }).forEach((packet) =>
      receiver.receive(message(packet as Json, 'a')),
    );
    expect(receiver.read(board())).toHaveLength(2);
  });

  it('keeps simultaneous uploads and drawing independent when their producer epochs differ', () => {
    const receiver = new NativeGestureReceiver();
    const upload = packets({ ...stroke(2), id: 'upload-placeholder', type: 'image' }, 1, {
      id: 'upload-op',
      kind: 'upload',
      origin: 'create',
      epoch: 'upload-producer',
    });
    upload.forEach((packet) => receiver.receive({ ...message(packet as Json), topic: 'upload' }));
    receive(receiver, packets(stroke(20), 1, { epoch: 'drawing-producer' }));
    expect(
      receiver
        .read(board())
        .map((value) => value.kind)
        .sort(),
    ).toEqual(['ink', 'upload']);
    receive(receiver, packets(stroke(20), 2, { id: 'new-draw', epoch: 'next-drawing-producer' }));
    expect(
      receiver
        .read(board())
        .map((value) => value.kind)
        .sort(),
    ).toEqual(['ink', 'upload']);
  });

  it('retires a peer that lost write authority while keeping another editor visible', () => {
    const receiver = new NativeGestureReceiver();
    packets(stroke(20), 1, { epoch: 'a-source' }).forEach((packet) =>
      receiver.receive(message(packet as Json, 'a')),
    );
    packets({ ...stroke(20), id: 'other' }, 1, {
      id: 'other-operation',
      epoch: 'b-source',
    }).forEach((packet) => receiver.receive(message(packet as Json, 'b')));
    receiver.authority({
      type: 'peers',
      peers: [
        { peerId: 'a', actor: { ...LOCAL_ACTOR, role: 'viewer' }, updatedAt: '' },
        { peerId: 'b', actor: LOCAL_ACTOR, updatedAt: '' },
      ],
    });
    expect(receiver.read(board()).map((value) => value.peerId)).toEqual(['b']);
  });

  it('distinguishes cancellation and failure, never extends a duplicate end, and fences reset packets', () => {
    let time = 1000;
    const receiver = new NativeGestureReceiver(() => time);
    const encoded = packets(stroke(20));
    receive(receiver, encoded);
    const end = {
      ...encoded[0],
      atoms: undefined,
      seq: 999,
      phase: 'end',
      outcome: 'pending',
    } as unknown as Json;
    receiver.receive(message(end));
    time += 9999;
    receiver.receive(message(end));
    time += 2;
    expect(receiver.read(board())).toEqual([]);
    for (const outcome of ['cancelled', 'failed']) {
      const data = packets(stroke(20), 2, { id: outcome });
      receive(receiver, data);
      receiver.receive(
        message({
          ...data[0],
          atoms: undefined,
          seq: 999,
          phase: 'end',
          outcome,
        } as unknown as Json),
      );
      expect(receiver.read(board())).toEqual([]);
    }

    const next = packets(stroke(20), 3, { id: 'before-reset' });
    receive(receiver, next);
    receiver.authority({ type: 'reset', reason: 'pause' });
    receive(receiver, next);
    expect(receiver.read(board())).toEqual([]);
  });

  it('does not let a retired authority epoch clear a newer source or revive its old packets', () => {
    const receiver = new NativeGestureReceiver();
    const initial = board();
    const old = packets(stroke(20), 1, { id: 'old', origin: 'create', epoch: 'producer-old' });
    receiver.authority({ type: 'document', document: initial, epoch: 'server-old' });
    receive(receiver, old);
    receiver.authority({ type: 'document', document: initial, epoch: 'server-new' });
    receive(
      receiver,
      packets(stroke(20), 2, { id: 'new', origin: 'create', epoch: 'producer-new' }),
    );
    receiver.authority({ type: 'document', document: initial, epoch: 'server-old' });
    receive(receiver, old);
    expect(receiver.read(initial).map((value) => value.id)).toEqual(['new']);
  });
});

it('forwards fractional and sampled maximum-length previews through real HTTP room and persists every original point', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-ink-http-test-'));
  const host = await startStudioHost({
    dataRoot: directory,
    html: '<!doctype html><title>fixture</title>',
  });

  try {
    const created = await host.service.execute('artifact_manage', {
      action: 'create',
      title: 'Ink HTTP regression',
    });
    const artifactId = created.artifact.id;
    let current = (await host.service.execute('artifact_read', {
      artifactId,
      mode: 'board',
    })) as Board;
    let cursor = (await host.service.sync(artifactId, {}, LOCAL_ACTOR)).cursor;
    const receiver = new NativeGestureReceiver();
    authority(receiver, current);
    let peerSeq = 0;
    const postGestures = async (encoded: ReturnType<typeof packets>) => {
      let batch: { topic: string; data: Record<string, any> }[] = [];
      let size = 0;
      const flush = async () => {
        if (!batch.length) {
          return;
        }

        const response = await fetch(`${host.origin}/api/room`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${host.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            artifactId,
            peerId: 'http-peer',
            peerEpoch: 'http-epoch',
            peerSeq: ++peerSeq,
            events: batch,
          }),
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ accepted: batch.length, dropped: 0 });
        batch = [];
        size = 0;
      };

      for (const packet of encoded) {
        const event = { topic: 'gesture', data: packet };
        const length = new TextEncoder().encode(JSON.stringify(event)).length;
        if (batch.length >= 16 || size + length > 56000) {
          await flush();
        }

        batch.push(event);
        size += length;
      }

      await flush();
    };

    const receiveRoomEvents = (events: StudioEvent[]) => {
      for (const event of events) {
        if (event.type !== 'room' || !Array.isArray(event.events)) {
          continue;
        }

        for (const value of event.events as RoomMessage[]) {
          expect(value.actor.id).toBe(LOCAL_ACTOR.id);
          receiver.receive(value);
        }
      }
    };

    for (const count of [200, 20000]) {
      const source = { ...stroke(count, true), id: `stroke-${count}` };
      const operationId = `operation-${count}`;
      const encoded = packets(source, 1, {
        id: operationId,
        operationId,
        origin: 'create',
        baseRevision: current.artifact.revision,
      });
      await postGestures(encoded);
      const sync = await host.service.sync(artifactId, { after: cursor }, LOCAL_ACTOR);
      cursor = sync.cursor;
      receiveRoomEvents(sync.events);

      const preview = receiver.read(current).find((value) => value.id === operationId)
        ?.elements[0]?.points;
      expect(preview?.slice(0, 2)).toEqual(source.points?.slice(0, 2));
      expect(preview?.slice(-2)).toEqual(source.points?.slice(-2));
      if (count === 200) {
        expect(preview).toEqual(source.points);
      } else {
        expect(preview!.length).toBeLessThan(source.points!.length);
      }

      const saved = await host.service.execute('artifact_apply', {
        artifactId,
        operationId,
        operations: [{ op: 'add', element: source }],
      });
      expect(
        saved.board.elements.find((element: BoardElement) => element.id === source.id).points,
      ).toEqual(source.points);
      authority(receiver, saved.board, operationId, { [source.id]: 1 });
      expect(receiver.read(current).some((value) => value.id === operationId)).toBe(true);
      current = saved.board;
      expect(receiver.read(current).some((value) => value.id === operationId)).toBe(false);
      const deleted = await host.service.execute('artifact_apply', {
        artifactId,
        operationId: `delete-${count}`,
        expectedVersions: { [source.id]: 1 },
        operations: [{ op: 'delete', id: source.id }],
      });
      current = deleted.board;
      authority(receiver, current, `delete-${count}`, { [source.id]: 0 });
      receive(receiver, encoded);
      expect(receiver.read(current).some((value) => value.id === operationId)).toBe(false);
    }
  } finally {
    await host.close();
    const target = resolve(directory);
    expect(dirname(target)).toBe(resolve(tmpdir()));
    expect(basename(target).startsWith('studio-ink-http-test-')).toBe(true);
    await rm(target, { recursive: true, force: true });
  }
});

let mounted: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (mounted) {
    await act(async () => mounted!.unmount());
  }

  mounted = undefined;
  container?.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function hook(
  sendResult = true,
  sendOverride?: (topic: string, data: Json) => Promise<boolean>,
) {
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const incoming = new Map<string, (message: RoomMessage) => void>();
  const states = new Set<(event: CollaborationStateEvent) => void>();
  const send = vi.fn(sendOverride ?? (async (_topic: string, _data: Json) => sendResult));
  const room: CollaborationRoom = {
    send,
    subscribe: (topic, callback) => {
      incoming.set(topic, callback);

      return () => {
        incoming.delete(topic);
      };
    },
    subscribeState: (callback) => {
      states.add(callback);

      return () => {
        states.delete(callback);
      };
    },
  };
  let value!: ReturnType<typeof useNativeGestureSync>;
  function Harness({ document, readOnly = false }: { document: Board; readOnly?: boolean }) {
    value = useNativeGestureSync({ room, document, selfPeerId: 'self', readOnly });

    return null;
  }

  container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);
  const render = async (document = board(), readOnly = false) => {
    await act(async () => mounted!.render(createElement(Harness, { document, readOnly })));
  };

  await render();

  return {
    get value() {
      return value;
    },
    send,
    incoming,
    states,
    render,
  };
}

describe('gesture sender lifecycle', () => {
  it('exposes sampling and send rejection instead of silently reporting successful live synchronization', async () => {
    const view = await hook(false);
    await act(async () => {
      view.value.publish({
        id: 'op',
        kind: 'ink',
        elements: [stroke(20000, true)],
        origin: 'create',
        baseRevision: 0,
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(view.value.previewStatus).toContain('简化');
    expect(view.value.previewError).toContain('未送达');
  });

  it.each(['confirm', 'fail', 'cancel'])(
    'clears its sampling notice after %s rather than leaving a finished drawing marked active',
    async (outcome) => {
      const view = await hook();
      const intent: NativeGesture = {
        id: 'op',
        kind: 'ink',
        elements: [stroke(20000, true)],
        origin: 'create',
      };
      await act(async () => {
        view.value.publish(intent);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(view.value.previewStatus).toContain('简化');
      await act(async () => {
        view.value.publish(undefined);
        if (outcome === 'confirm') {
          view.value.confirm({ id: 'op', operationId: 'op', revision: 1, versions: { stroke: 1 } });
        } else if (outcome === 'fail') {
          view.value.fail({ id: 'op', operationId: 'op' });
        } else {
          view.value.publish({ ...intent, cancelled: true });
        }
      });
      expect(view.value.previewStatus).toBeNull();
      expect(view.value.previewError).toBeNull();
    },
  );

  it('distinguishes end-awaiting-save, confirmed receipt, failure and user cancellation', async () => {
    const view = await hook();
    const intent: NativeGesture = {
      id: 'op',
      operationId: 'op',
      kind: 'ink',
      elements: [stroke(20)],
      origin: 'create',
      baseRevision: 0,
    };
    await act(async () => {
      view.value.publish(intent);
      await vi.advanceTimersByTimeAsync(0);
      view.value.publish(undefined);
      await vi.advanceTimersByTimeAsync(100);
    });
    const sent = () =>
      view.send.mock.calls.map((call: unknown[]) => call[1] as Record<string, unknown>);
    expect(sent().at(-1)?.outcome).toBe('pending');
    await act(async () =>
      view.value.confirm({ id: 'op', operationId: 'op', revision: 1, versions: { stroke: 1 } }),
    );
    expect(sent().at(-1)).toMatchObject({ phase: 'end', outcome: 'committed', commitRevision: 1 });
    await act(async () => {
      view.value.publish({ ...intent, id: 'fail', operationId: 'fail' });
      view.value.publish(undefined);
      view.value.fail({ id: 'fail', operationId: 'fail' });
    });
    expect(sent().at(-1)?.outcome).toBe('failed');
    await act(async () =>
      view.value.publish({ ...intent, id: 'cancel', operationId: 'cancel', cancelled: true }),
    );
    expect(sent().at(-1)?.outcome).toBe('cancelled');
  });

  it('stops scheduled frames on reset, loss of write access and unmount', async () => {
    const view = await hook();
    const intent: NativeGesture = { id: 'op', kind: 'ink', elements: [stroke(20)] };
    await act(async () => {
      view.value.publish(intent);
      for (const callback of view.states) {
        callback({ type: 'reset', reason: 'pause' });
      }

      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(view.send).not.toHaveBeenCalled();
    await act(async () => view.value.publish({ ...intent, id: 'next' }));
    await view.render(board(), true);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(view.send).not.toHaveBeenCalled();
    await act(async () => mounted!.unmount());
    mounted = undefined;
    await vi.advanceTimersByTimeAsync(2000);
    expect(view.incoming.size).toBe(0);
    expect(view.states.size).toBe(0);
    expect(view.send).not.toHaveBeenCalled();
  });

  it('coalesces a slow room to the latest complete frame instead of queuing every pointer update', async () => {
    let release!: (value: boolean) => void;
    const waiting = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const view = await hook(true, async () => (++calls === 1 ? waiting : true));
    const intent: NativeGesture = {
      id: 'op',
      kind: 'ink',
      elements: [stroke(20)],
      origin: 'create',
    };
    await act(async () => {
      view.value.publish(intent);
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      for (let index = 1; index <= 100; index++) {
        view.value.publish({ ...intent, elements: [{ ...stroke(20), x: index }] });
        await vi.advanceTimersByTimeAsync(10);
      }

      view.value.publish(undefined);
    });
    expect(view.send).toHaveBeenCalledTimes(1);
    await act(async () => {
      release(true);
      await vi.advanceTimersByTimeAsync(100);
    });
    const sent = view.send.mock.calls.map((call) => call[1] as Record<string, any>);
    const frames = sent.filter((packet) => packet.atoms);
    expect(frames).toHaveLength(2);
    expect(frames.at(-1)!.atoms[0].element.x).toBe(100);
    expect(sent.at(-1)?.outcome).toBe('pending');
  });

  it('stops its old source on a trusted authority epoch change and ignores retired epoch callbacks', async () => {
    const view = await hook();
    const intent: NativeGesture = {
      id: 'old',
      kind: 'ink',
      elements: [stroke(20)],
      origin: 'create',
    };
    await act(async () => {
      for (const callback of view.states) {
        callback({ type: 'document', document: board(), epoch: 'server-one' });
      }

      view.value.publish(intent);
      for (const callback of view.states) {
        callback({ type: 'document', document: board(), epoch: 'server-two' });
      }

      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(view.send).not.toHaveBeenCalled();
    await act(async () => {
      view.value.publish({ ...intent, id: 'new' });
      for (const callback of view.states) {
        callback({ type: 'document', document: board(), epoch: 'server-one' });
      }

      await vi.advanceTimersByTimeAsync(0);
    });
    expect(view.send).toHaveBeenCalledTimes(1);
  });

  it('observes an authoritative document prop deletion even before its correlated network event arrives', async () => {
    const view = await hook();
    const source = stroke(20);
    const initial = board([source], 1);
    await view.render(initial);
    await act(async () => {
      for (const packet of packets({ ...source, x: 250 }, 1, {
        origin: 'existing',
        baseRevision: 1,
      })) {
        view.incoming.get('gesture')?.(message(packet as Json));
      }
    });
    expect(view.value.gestures).toHaveLength(1);
    await view.render(board([], 2));
    expect(view.value.gestures).toEqual([]);
  });
});

it.each(['text', 'note'] as const)(
  'keeps all 1500 canonical %s characters while real received move and resize previews carry a shorter label',
  async (type) => {
    const text = '长'.repeat(1500);
    const source: BoardElement = {
      id: 'long-content',
      type,
      version: 1,
      x: 10,
      y: 20,
      w: 300,
      h: 200,
      text,
    };
    let incoming: ((value: RoomMessage) => void) | undefined;
    const room: CollaborationRoom = {
      send: async () => true,
      subscribe: (topic, callback) => {
        if (topic === 'gesture') {
          incoming = callback;
        }

        return () => {
          if (topic === 'gesture') {
            incoming = undefined;
          }
        };
      },
    };
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    container.className = 'studio';
    document.body.append(container);
    mounted = createRoot(container);
    const deliverGestures = (encoded: ReturnType<typeof packets>) =>
      act(async () => {
        for (const packet of encoded) {
          incoming?.(message(packet as Json));
        }
      });

    try {
      await act(async () =>
        mounted!.render(
          createElement(WhiteboardCanvas, {
            board: board([source], 1),
            client: {
              embedded: true,
              call: async () => {
                throw new Error('No persistence call expected');
              },
            },
            actor: { ...LOCAL_ACTOR, id: 'viewer', role: 'viewer' },
            onChanged: () => {},
            onAnnotate: () => {},
            room,
            selfPeerId: 'viewer-peer',
            externalViewport: { x: 0, y: 0, zoom: 1 },
          }),
        ),
      );

      for (const [index, kind] of (['move', 'resize'] as const).entries()) {
        const encoded = packets(
          { ...source, x: 75, ...(kind === 'resize' ? { w: 500 } : {}) },
          index + 1,
          { origin: 'existing', baseRevision: 1, kind },
        );
        expect(encoded[0]!.atoms[0].element.text.length).toBeLessThan(1500);
        await deliverGestures(encoded);
        const target = container!.querySelector<HTMLElement>('[data-element-id="long-content"]')!;
        expect(target.style.left).toBe('75px');
        if (kind === 'resize') {
          expect(target.style.width).toBe('500px');
        }

        expect(target.querySelector('.studio-element-text')?.textContent).toBe(text);
        expect(source.text).toHaveLength(1500);
      }
    } finally {
      await act(async () => mounted!.unmount());
      mounted = undefined;
      container.remove();
      vi.unstubAllGlobals();
    }
  },
);
