import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  extractZip,
  stageCurrentArchive,
  writeBoardArchive,
} from '../../../src/infrastructure/platform/archives/index.js';

const boardId = 'backup-board';
const maximumBytes = 2 * 1024 * 1024;
const statePath = 'artifact-deltas.ndjson';
const metadata = { id: boardId, title: 'Backup history', type: 'whiteboard', sharing: false };
const richSource = 'Archived HTML text '.repeat(4_500);

async function* bytes(content: Uint8Array): AsyncIterable<Uint8Array> {
  yield content;
}

test('writes a v4 state with retained history, shared rich text, geometry deltas and the exact latest scene', async () => {
  const unchanged = Array.from({ length: 20 }, (_, position) => ({
    id: 'shape-' + position,
    type: 'shape',
    x: position,
  }));
  const past = [{ id: 'html-card', type: 'html', html: richSource, x: 2 }, ...unchanged];
  const elements = [{ id: 'html-card', type: 'html', html: richSource, x: 40 }, ...unchanged];
  const snapshot = {
    boardId,
    properties: { artifact: metadata, assets: {} },
    elements,
    history: [{ entry: { id: 'version-1', revision: 1 }, artifact: metadata, elements: past }],
    assets: new Map(),
  };
  const archive = await writeBoardArchive(snapshot, maximumBytes);
  assert.ok(archive);
  const staged = await stageCurrentArchive(bytes(archive));
  try {
    expect(staged.objects).toEqual(elements);
    expect(staged.title).toBe('Backup history');
    const exportDirectory = join(staged.archivePath, '..', 'inspect');
    await mkdir(exportDirectory);
    const files = await extractZip(staged.archivePath, exportDirectory, () => maximumBytes);
    const state = files.get(statePath);
    assert.ok(state);
    const lines = (await readFile(state.path, 'utf8')).trimEnd().split('\n');
    const header = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    expect(header).toMatchObject({
      version: 2,
      current: 1,
      history: [[0, 1, 0]],
      lengths: [1, 26, 2],
    });
    expect(lines.filter((line) => line.includes(richSource))).toHaveLength(1);
    expect(JSON.parse(lines.at(-1) ?? '')).toMatchObject({
      base: 0,
      length: 21,
      changes: [[0, 24]],
    });
  } finally {
    await staged.dispose();
  }

  expect(await writeBoardArchive(snapshot, 32)).toBeUndefined();
});

test('keeps 200 edits to one rich object within the archive budget and refuses an unreadable live snapshot', async () => {
  const chapter = { id: 'description', type: 'document', text: richSource };
  const boardAt = (revision: number) => [{ ...chapter, x: revision }];
  const snapshot = {
    boardId,
    properties: { artifact: metadata, assets: {} },
    history: Array.from({ length: 200 }, (_, revision) => ({
      entry: { id: 'revision-' + revision, revision },
      artifact: metadata,
      elements: boardAt(revision),
    })),
    elements: boardAt(200),
    assets: new Map(),
  };
  const packed = await writeBoardArchive(snapshot, maximumBytes);
  assert.ok(packed);
  expect(packed.byteLength).toBeLessThan(20 * 1024);
  const restored = await stageCurrentArchive(bytes(packed));
  try {
    expect(restored.objects).toEqual(boardAt(200));
  } finally {
    await restored.dispose();
  }

  const oversized = { ...snapshot, elements: [{ ...chapter, text: 'x'.repeat(16 * 1024 * 1024) }] };
  expect(await writeBoardArchive(oversized, maximumBytes)).toBeUndefined();
});
