import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { StudioService } from '../src/core/service.js';
import { SqliteArtifactRepository } from '../src/core/shared/sqlite-artifact.js';
import type { ArtifactState } from '../src/core/shared/model.js';
import type { WhiteboardContent } from '../src/core/products/whiteboard.js';

let directory: string;
let service: StudioService;
let artifactId: string;
let historyLoads: number[];
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
  'base64',
);

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-sqlite-projection-'));
  service = new StudioService({ dataRoot: directory });
  const created = await service.execute('artifact_manage', {
    action: 'create',
    elements: [{ id: 'text', type: 'text', text: 'Version 199' }],
  });
  artifactId = created.artifact.id;
  const state = await service.store.read(artifactId);
  const content = state.content as WhiteboardContent;
  const initialHistoryId = state.history[0]!.entry.id;
  state.history = Array.from({ length: 200 }, (_, revision) => ({
    entry: {
      id: revision === 0 ? initialHistoryId : randomUUID(),
      revision,
      createdAt: state.artifact.createdAt,
      actor: service.owner,
      summary: `Revision ${revision}`,
      changedIds: ['text'],
    },
    artifact: { ...state.artifact, revision },
    content: {
      ...structuredClone(content),
      elements: [{ ...content.elements[0]!, text: `Version ${revision}`, version: revision + 1 }],
    },
  }));
  state.artifact.revision = 199;
  state.content = structuredClone(state.history.at(-1)!.content);
  state.unitClocks = { text: { version: 200, incarnationStart: 1 } };
  state.assets.image = {
    id: 'image',
    filename: 'sample.png',
    mimeType: 'image/png',
    size: png.length,
  };
  await service.store.write(state);
  const assets = join(service.store.folder(artifactId), 'assets');
  await mkdir(assets, { recursive: true });
  await writeFile(join(assets, 'image'), png);
  historyLoads = [];
  const read = SqliteArtifactRepository.prototype.readState;
  vi.spyOn(SqliteArtifactRepository.prototype, 'readState').mockImplementation(function <C, A, S>(
    this: SqliteArtifactRepository,
    options: { maxExpandedBytes?: number } = {},
  ) {
    const state = read.call(this, options) as ArtifactState<C, A, S>;
    state.history = state.history.map((saved) => ({
      entry: saved.entry,
      artifact: saved.artifact,
      get content() {
        historyLoads.push(saved.entry.revision);

        return saved.content;
      },
    }));

    return state;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await service.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) {
    throw new Error('Unexpected projection test directory');
  }

  await rm(directory, { recursive: true, force: true });
});

it('opens a SQLite document and reads current data and history entries without loading historical contents', async () => {
  await service.execute('studio_open', { artifactId });
  expect(
    (await service.execute('artifact_read', { artifactId, mode: 'board' })).elements[0].text,
  ).toBe('Version 199');
  expect(
    (await service.execute('artifact_read', { artifactId, mode: 'objects', ids: ['text'] }))
      .elements[0].version,
  ).toBe(200);
  expect((await service.execute('artifact_read', { artifactId, mode: 'summary' })).totalCount).toBe(
    1,
  );
  expect(
    (await service.execute('artifact_read', { artifactId, mode: 'history' })).history,
  ).toHaveLength(200);
  expect(
    (await service.execute('artifact_read', { artifactId, mode: 'assets' })).assets,
  ).toHaveLength(1);
  expect(await service.hasShares()).toBe(false);
  expect(Buffer.from((await service.getAsset(artifactId, 'image')).data)).toEqual(png);
  const exported = await service.execute('artifact_export', { artifactId, format: 'json' });
  const data = JSON.parse(
    Buffer.from((await service.getExport(exported.exportId)).data).toString('utf8'),
  );
  expect(data.elements[0].text).toBe('Version 199');
  expect(historyLoads).toEqual([]);
});

it('loads only the requested historical content and returns detached data after closing SQLite', async () => {
  const requested = await service.execute('artifact_read', {
    artifactId,
    mode: 'version',
    revision: 37,
  });
  expect(requested.board.elements[0]).toMatchObject({ text: 'Version 37', version: 38 });
  expect(historyLoads).toEqual([37]);
  requested.board.elements[0].text = 'Caller local edit';
  expect(
    (await service.execute('artifact_read', { artifactId, mode: 'version', revision: 37 })).board
      .elements[0].text,
  ).toBe('Version 37');
  expect(historyLoads).toEqual([37, 37]);
});

it('keeps read argument errors and unavailable historical versions observable', async () => {
  await expect(
    service.execute('artifact_read', { artifactId, mode: 'assets', limit: 101 }),
  ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  await expect(
    service.execute('artifact_read', { artifactId, mode: 'version', revision: 500 }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    service.execute('artifact_read', { artifactId, mode: 'unsupported-mode' }),
  ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  expect(historyLoads).toEqual([]);
});
