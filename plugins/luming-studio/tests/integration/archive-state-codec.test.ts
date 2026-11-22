import { expect, it } from 'vitest';
import { Readable } from 'node:stream';
import type { Actor, BoardElement } from '../../src/contracts/studio.js';
import type { ArtifactState } from '../../src/core/ports/studio-repository.js';
import {
  decodeArchiveState,
  decodeDeltaArchiveState,
  encodeArchiveState,
  encodeDeltaArchiveState,
  MAX_ARCHIVE_STATE_BYTES,
} from '../../src/infrastructure/archive-state-codec.js';

const owner: Actor = { id: 'owner', name: 'Owner', kind: 'human', role: 'owner' };
const savedAt = '2026-01-01T00:00:00.000Z';
const retainedVersions = 200;
const mebibyte = 1024 * 1024;

interface TestContent {
  elements: BoardElement[];
  style: Record<string, string>;
}

function stateWith<Content>(content: Content): ArtifactState<Content> {
  return {
    schemaVersion: 2,
    artifact: {
      id: 'board',
      type: 'whiteboard',
      title: 'Archive board',
      revision: 0,
      createdAt: savedAt,
      updatedAt: savedAt,
      pinned: false,
    },
    content,
    history: [],
    feedback: [],
    assets: {},
    sources: {},
    sharing: { enabled: false, generation: 0, tokens: {} },
    operations: [],
  };
}

function elementAt(ordinal: number, htmlBytes: number): BoardElement {
  const base = { id: 'unit-' + ordinal, x: ordinal, y: 0, w: 50, h: 50, version: 1 };
  if (ordinal >= 20) {
    return { ...base, type: 'text', text: 'Note ' + ordinal };
  }

  const unitMarker = '<p>Region ' + ordinal;

  return { ...base, type: 'html', html: unitMarker + 'x'.repeat(htmlBytes) + '</p>' };
}

function changedHistory(unitCount: number, contentBytes: number): ArtifactState<TestContent> {
  const baseElements = Array.from({ length: unitCount }, (_, index) => elementAt(index, 0));
  const initial = { elements: baseElements, style: { paper: '#fff' } };
  const remaining = contentBytes - Buffer.byteLength(JSON.stringify(initial)) - 1024;
  const elements = Array.from({ length: unitCount }, (_, index) =>
    elementAt(index, Math.floor(remaining / 20)),
  );
  const state = stateWith({ ...initial, elements });
  state.history = Array.from({ length: retainedVersions }, (_, revision) => ({
    entry: {
      id: 'revision-' + revision,
      revision,
      createdAt: savedAt,
      actor: owner,
      summary: 'Moved the first region',
      changedIds: [elements[0]!.id],
    },
    artifact: { ...state.artifact, revision },
    content: {
      ...initial,
      elements: [{ ...elements[0]!, y: revision, version: revision + 1 }, ...elements.slice(1)],
    },
  }));

  const latest = state.history.at(-1)!;
  state.artifact = { ...latest.artifact };
  state.content = latest.content;

  return state;
}

it.each([
  { units: 2_000, contentBytes: 7.5 * mebibyte },
  { units: 4_000, contentBytes: 15 * mebibyte },
])(
  'shares rich payloads across 200 different $units-object histories',
  ({ units, contentBytes }) => {
    const state = changedHistory(units, contentBytes);
    const encoded = encodeArchiveState(state);
    const restored = decodeArchiveState(encoded) as ArtifactState<TestContent>;

    expect(encoded.byteLength).toBeLessThan(contentBytes + 6 * mebibyte);
    expect(restored.content.elements).toHaveLength(units);
    expect(restored.content).toEqual(state.content);
    expect(restored.history.map((version) => version.entry)).toEqual(
      state.history.map((version) => version.entry),
    );
    expect(restored.history.map((version) => version.content.elements[0]!.y)).toEqual(
      Array.from({ length: retainedVersions }, (_, revision) => revision),
    );
    expect(restored.history.every((version) => version.content.elements.length === units)).toBe(
      true,
    );
    expect(restored.history[0]!.content.elements[1]).toBe(restored.content.elements[1]);
    expect(restored.history.at(-1)!.content).toBe(restored.content);
    expect(restored.history.at(-1)!.artifact).not.toBe(restored.artifact);
    restored.artifact.title = 'Imported board';
    expect(restored.history.at(-1)!.artifact.title).toBe('Archive board');
  },
);

function packed(payload: unknown, texts: unknown[] = []): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      texts,
      payloads: [payload],
      contents: [0],
      properties: [],
      current: 0,
      history: [],
    }),
  );
}

it('encodes a baseline followed by ordered deltas and reads them from segmented input', async () => {
  const state = changedHistory(64, mebibyte);
  const chunks: Uint8Array[] = [];
  for await (const chunk of encodeDeltaArchiveState(state)) {
    chunks.push(chunk);
  }

  const first = chunks[0]!;
  const decoded = (await decodeDeltaArchiveState(
    Readable.from([first.subarray(0, 2), first.subarray(2), ...chunks.slice(1)]),
  )) as ArtifactState<TestContent>;
  const lines = Buffer.concat(chunks).toString().split('\n').filter(Boolean);
  const deltas = lines.filter((line) => line.startsWith('{"base":'));
  expect(deltas).toHaveLength(retainedVersions - 1);
  expect(Buffer.concat(chunks).byteLength).toBeLessThan(encodeArchiveState(state).byteLength);
  expect(decoded.content).toEqual(state.content);
  expect(
    decoded.history.map(({ entry, content }) => [entry.revision, content.elements[0]!.y]),
  ).toEqual(state.history.map(({ entry, content }) => [entry.revision, content.elements[0]!.y]));
  expect(decoded.history[0]!.content.elements[1]).toBe(decoded.content.elements[1]);

  const firstDelta = lines.indexOf(deltas[0]!);
  const badDelta = JSON.parse(lines[firstDelta]!);
  badDelta.base = retainedVersions - 1;
  lines[firstDelta] = JSON.stringify(badDelta);
  const broken = Readable.from([Buffer.from(lines.join('\n') + '\n')]);
  await expect(decodeDeltaArchiveState(broken)).rejects.toMatchObject({
    code: 'INVALID_ARCHIVE',
  });
});

it('preserves arbitrary JSON field names, lists and escaped unicode', () => {
  const content = Object.fromEntries([
    ['__proto__', { constructor: '原值\n💬' }],
    ['text', 3],
    ['object', [0, true, null]],
    ['array', [{ quote: '"' }]],
  ]);
  const state = stateWith(content);
  const restored = decodeArchiveState(encodeArchiveState(state)) as typeof state;

  expect(restored).toEqual(state);
  expect(Object.hasOwn(restored.content, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(restored.content)).toBe(Object.prototype);
});

it('rejects invalid references, unreferenced rows and duplicate property names', () => {
  expect(() => decodeArchiveState(packed({ text: 1 }, ['text']))).toThrow(
    expect.objectContaining({ code: 'INVALID_ARCHIVE' }),
  );
  expect(() => decodeArchiveState(packed(null, ['unreferenced']))).toThrow(
    expect.objectContaining({ code: 'INVALID_ARCHIVE' }),
  );
  expect(() =>
    decodeArchiveState(
      packed({
        object: [
          ['repeat', 1],
          ['repeat', 2],
        ],
      }),
    ),
  ).toThrow(expect.objectContaining({ code: 'INVALID_ARCHIVE' }));
});

it('rejects compact text references whose logical expansion exceeds a version or collection budget', () => {
  const text = 'x'.repeat(mebibyte);
  const repeated = { array: Array.from({ length: 17 }, () => ({ text: 0 })) };
  expect(() => decodeArchiveState(packed(repeated, [text]))).toThrow(
    expect.objectContaining({ code: 'TOO_LARGE' }),
  );

  const bytes = Buffer.from(
    JSON.stringify({
      version: 1,
      texts: [text],
      payloads: [null, repeated],
      contents: [0],
      properties: [
        ['feedback', 1],
        ['sources', 1],
        ['assets', 1],
        ['sharing', 1],
      ],
      current: 0,
      history: [],
    }),
  );
  expect(bytes.byteLength).toBeLessThan(2 * mebibyte);
  expect(() => decodeArchiveState(bytes)).toThrow(expect.objectContaining({ code: 'TOO_LARGE' }));
});

it('bounds encoded input, nesting and in-memory cycles before reconstructing state', () => {
  expect(() => decodeArchiveState(new Uint8Array(MAX_ARCHIVE_STATE_BYTES + 1))).toThrow(
    expect.objectContaining({ code: 'TOO_LARGE' }),
  );
  let nested: unknown = null;
  for (let depth = 0; depth < 66; depth++) {
    nested = { array: [nested] };
  }
  expect(() => decodeArchiveState(packed(nested))).toThrow(
    expect.objectContaining({ code: 'INVALID_ARCHIVE' }),
  );

  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  expect(() => encodeArchiveState(stateWith(cycle))).toThrow(
    expect.objectContaining({ code: 'INVALID_ARCHIVE' }),
  );
});
